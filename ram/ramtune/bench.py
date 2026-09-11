"""Messung: Latenz und Bandbreite, und wie beides zu einer Zahl wird.

Für Spiele zählt die Latenz deutlich mehr als die Bandbreite - beim 9800X3D
noch stärker als sonst, weil der große Zwischenspeicher Bandbreite ohnehin
abfängt. Die Gewichtung in config.BEWERTUNG_SPIELE bildet das ab.

Gemessen wird gegen die EXPO-Ausgangsmessung: Eine Punktzahl von 100 heißt
"so gut wie EXPO", 108 heißt "acht Prozent besser". Das ist ehrlicher als
absolute Nanosekunden, die sich zwischen Systemen nicht vergleichen lassen.
"""

import re
import subprocess
import time

from . import config, tools


def _mlc_aufrufen(argument, timeout=600):
    pfad = tools.suchen("mlc")
    if not pfad:
        return None
    try:
        ergebnis = subprocess.run(
            [str(pfad), argument], capture_output=True, text=True,
            timeout=timeout, cwd=str(pfad.parent),
        )
        return (ergebnis.stdout or "") + "\n" + (ergebnis.stderr or "")
    except (subprocess.TimeoutExpired, OSError):
        return None


def latenz_messen():
    """Leerlauf-Latenz in Nanosekunden."""
    ausgabe = _mlc_aufrufen("--idle_latency")
    if not ausgabe:
        return None
    # "Each iteration took 205.6 core clocks ( 68.5 ns)"
    treffer = re.search(r"\(\s*([0-9]+(?:\.[0-9]+)?)\s*ns\s*\)", ausgabe)
    if treffer:
        return float(treffer.group(1))
    treffer = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*ns", ausgabe)
    return float(treffer.group(1)) if treffer else None


def bandbreite_messen():
    """Lesebandbreite in MB/s."""
    ausgabe = _mlc_aufrufen("--max_bandwidth")
    if not ausgabe:
        return None
    treffer = re.search(r"ALL\s+Reads\s*:?\s*([0-9]+(?:\.[0-9]+)?)", ausgabe, re.I)
    if treffer:
        return float(treffer.group(1))
    # Notnagel: die größte plausible Zahl aus der Ausgabe.
    zahlen = [float(z) for z in re.findall(r"\b([0-9]{4,6}(?:\.[0-9]+)?)\b", ausgabe)]
    return max(zahlen) if zahlen else None


def ycruncher_zeit(groesse="1b"):
    """Rechenzeit als Querprüfung - unabhängig von MLC."""
    pfad = tools.suchen("ycruncher")
    if not pfad:
        return None
    beginn = time.time()
    try:
        subprocess.run(
            [str(pfad), "custom", groesse, "-o", "."],
            capture_output=True, text=True, timeout=1800, cwd=str(pfad.parent),
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    return round(time.time() - beginn, 2)


def messen(mit_rechenprobe=False, melden=print):
    """Eine vollständige Messung."""
    melden("    -> Latenz messen ...")
    latenz = latenz_messen()
    melden("    -> Bandbreite messen ...")
    bandbreite = bandbreite_messen()

    messwerte = {"latenz_ns": latenz, "bandbreite_mbs": bandbreite}

    if mit_rechenprobe:
        melden("    -> Rechenprobe ...")
        messwerte["ycruncher_s"] = ycruncher_zeit()

    if latenz is None and bandbreite is None:
        messwerte["hinweis"] = (
            "Keine Messwerte - Intel MLC fehlt oder lief ohne Administratorrechte. "
            "Ohne Messung kann das Cockpit Einstellungen nicht vergleichen."
        )
    return messwerte


def punkte_berechnen(messwerte, basis, ziel="spiele"):
    """Rechnet Messwerte gegen die Ausgangsmessung in eine Punktzahl um.

    100 = so gut wie die EXPO-Ausgangsmessung. Mehr ist besser.
    """
    if not basis or not messwerte:
        return None

    gewichtung = {
        "spiele": config.BEWERTUNG_SPIELE,
        "anwendung": config.BEWERTUNG_ANWENDUNG,
        "gemischt": config.BEWERTUNG_GEMISCHT,
        "stabil": config.BEWERTUNG_GEMISCHT,
    }.get(ziel, config.BEWERTUNG_SPIELE)

    anteile = []
    gewichte = []

    basis_latenz = basis.get("latenz_ns")
    latenz = messwerte.get("latenz_ns")
    if basis_latenz and latenz:
        # Kleinere Latenz ist besser, deshalb Basis geteilt durch Messwert.
        anteile.append(basis_latenz / latenz)
        gewichte.append(gewichtung["latenz"])

    basis_bandbreite = basis.get("bandbreite_mbs")
    bandbreite = messwerte.get("bandbreite_mbs")
    if basis_bandbreite and bandbreite:
        anteile.append(bandbreite / basis_bandbreite)
        gewichte.append(gewichtung["bandbreite"])

    if not anteile:
        return None

    summe = sum(g for g in gewichte)
    gewichtet = sum(a * g for a, g in zip(anteile, gewichte)) / summe
    return round(gewichtet * 100, 2)


def vergleich_text(messwerte, basis):
    """Ein Satz, der den Unterschied zur Ausgangsmessung beschreibt."""
    if not basis or not messwerte:
        return "Kein Vergleich möglich."
    teile = []
    if basis.get("latenz_ns") and messwerte.get("latenz_ns"):
        # Vorzeichen aus Sicht des Messwerts: minus heißt weniger Latenz,
        # also besser. Andersherum läse sich eine Verbesserung wie ein Verlust.
        unterschied = messwerte["latenz_ns"] - basis["latenz_ns"]
        prozent = unterschied / basis["latenz_ns"] * 100
        teile.append(
            f"Latenz {messwerte['latenz_ns']:.1f} ns "
            f"({unterschied:+.1f} ns / {prozent:+.1f} % gegenüber EXPO, weniger ist besser)"
        )
    if basis.get("bandbreite_mbs") and messwerte.get("bandbreite_mbs"):
        prozent = (messwerte["bandbreite_mbs"] / basis["bandbreite_mbs"] - 1) * 100
        teile.append(
            f"Bandbreite {messwerte['bandbreite_mbs']:.0f} MB/s ({prozent:+.1f} %)"
        )
    return ", ".join(teile) if teile else "Kein Vergleich möglich."
