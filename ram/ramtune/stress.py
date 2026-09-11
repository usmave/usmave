"""Stabilitätstests starten, überwachen und ehrlich auswerten.

Wichtig zur Einordnung: Nur y-cruncher lässt sich vollständig über die
Kommandozeile steuern. TestMem5 und Karhu sind Fensterprogramme ohne saubere
Schnittstelle - sie werden gestartet, über die Laufzeit beobachtet und
anschließend über ihre Protokolldateien ausgewertet. Wo diese Auswertung
unsicher bleibt, sagt das Cockpit das im Ergebnis ("unsicher") statt zu raten.

Über allem liegt die WHEA-Wache: Sie merkt auch dann etwas, wenn ein Test
zufrieden ist.
"""

import re
import subprocess
import time
from datetime import datetime
from pathlib import Path

from . import config, tools, whea

BESTANDEN = "bestanden"
FEHLER = "fehlgeschlagen"
UNSICHER = "unsicher"
NICHT_MOEGLICH = "nicht_moeglich"

# Zeichenketten, die in Protokollen einen Fehler anzeigen.
FEHLERMUSTER = re.compile(
    r"(error|fehler|fail|failed|mismatch|corrupt|incorrect|instab)", re.I
)
# Gegenmuster: "0 errors" ist kein Fehler.
ENTWARNUNG = re.compile(r"\b(0|no|keine)\s+(errors?|fehler)\b", re.I)


def _protokoll_schreiben(name, inhalt):
    config.PROTOKOLLE.mkdir(parents=True, exist_ok=True)
    stempel = datetime.now().strftime("%Y%m%d-%H%M%S")
    pfad = config.PROTOKOLLE / f"{stempel}-{name}.txt"
    pfad.write_text(inhalt, encoding="utf-8", errors="replace")
    return pfad


def _text_bewerten(text):
    """Sucht Fehlermeldungen, ohne auf 'keine Fehler' hereinzufallen."""
    treffer = []
    for zeile in text.splitlines():
        if FEHLERMUSTER.search(zeile) and not ENTWARNUNG.search(zeile):
            treffer.append(zeile.strip())
    return treffer


# ------------------------------------------------------------- y-cruncher

def ycruncher(minuten, tests=None, threads=None):
    """Vollautomatisch: startet, wartet, wertet aus."""
    pfad = tools.suchen("ycruncher")
    if not pfad:
        return {"test": "y-cruncher", "ergebnis": NICHT_MOEGLICH,
                "hinweis": "y-cruncher nicht gefunden."}

    tests = tests or ["VT3"]
    sekunden = int(minuten * 60)
    befehl = [str(pfad), "stress", f"-D:{sekunden}"]
    if threads:
        befehl.append(f"-T:{threads}")
    befehl.extend(tests)

    beginn = time.time()
    try:
        ergebnis = subprocess.run(
            befehl, capture_output=True, text=True,
            timeout=sekunden + 300, cwd=str(pfad.parent),
        )
        ausgabe = (ergebnis.stdout or "") + "\n" + (ergebnis.stderr or "")
        rueckgabe = ergebnis.returncode
    except subprocess.TimeoutExpired as abbruch:
        ausgabe = str(abbruch.stdout or "") + "\nZeitüberschreitung."
        rueckgabe = -1
    except OSError as fehler:
        return {"test": "y-cruncher", "ergebnis": NICHT_MOEGLICH, "hinweis": str(fehler)}

    dauer = (time.time() - beginn) / 60.0
    protokoll = _protokoll_schreiben("ycruncher", ausgabe)
    treffer = _text_bewerten(ausgabe)

    # y-cruncher bricht bei einem Rechenfehler vorzeitig ab. Eine Laufzeit
    # deutlich unter der Vorgabe ist deshalb selbst ein Warnzeichen.
    zu_frueh = dauer < minuten * 0.8

    if treffer or rueckgabe not in (0, None) or zu_frueh:
        return {
            "test": "y-cruncher", "ergebnis": FEHLER, "dauer_min": round(dauer, 1),
            "protokoll": str(protokoll), "treffer": treffer[:5],
            "hinweis": "Vorzeitig beendet." if zu_frueh else "Fehler gemeldet.",
        }
    return {"test": "y-cruncher", "ergebnis": BESTANDEN, "dauer_min": round(dauer, 1),
            "protokoll": str(protokoll), "tests": tests}


# ---------------------------------------------------- Fensterprogramme (TM5)

def _logdateien_seit(ordner, zeitpunkt):
    """Protokolle, die seit dem Teststart geschrieben wurden."""
    gefunden = []
    try:
        for muster in ("*.log", "*.txt", "*.LOG"):
            for datei in Path(ordner).glob(muster):
                if datei.stat().st_mtime >= zeitpunkt:
                    gefunden.append(datei)
    except OSError:
        pass
    return gefunden


def fensterprogramm(schluessel, anzeigename, minuten, argumente=None):
    """Startet ein Fensterprogramm, wartet die Laufzeit ab und wertet Logs aus."""
    pfad = tools.suchen(schluessel)
    if not pfad:
        return {"test": anzeigename, "ergebnis": NICHT_MOEGLICH,
                "hinweis": f"{anzeigename} nicht gefunden."}

    beginn = time.time()
    try:
        prozess = subprocess.Popen(
            [str(pfad)] + (argumente or []), cwd=str(pfad.parent),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except OSError as fehler:
        return {"test": anzeigename, "ergebnis": NICHT_MOEGLICH, "hinweis": str(fehler)}

    wache = whea.Wache()
    vorzeitig_beendet = False
    ende = beginn + minuten * 60

    while time.time() < ende:
        if prozess.poll() is not None:
            # Selbst beendet: bei TM5 heißt das in aller Regel Fehler oder
            # Absturz, nicht "fertig".
            vorzeitig_beendet = True
            break
        time.sleep(5)

    if prozess.poll() is None:
        prozess.terminate()
        try:
            prozess.wait(timeout=30)
        except subprocess.TimeoutExpired:
            prozess.kill()

    dauer = (time.time() - beginn) / 60.0
    befund = wache.auswerten()

    # Protokolle des Programms durchsehen.
    treffer = []
    gelesen = []
    for datei in _logdateien_seit(pfad.parent, beginn):
        try:
            inhalt = datei.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        gelesen.append(datei.name)
        treffer.extend(_text_bewerten(inhalt))

    if treffer or vorzeitig_beendet or not befund["sauber"]:
        return {
            "test": anzeigename, "ergebnis": FEHLER, "dauer_min": round(dauer, 1),
            "treffer": treffer[:5], "whea": befund,
            "hinweis": ("Programm hat sich vorzeitig beendet." if vorzeitig_beendet
                        else whea.befund_erklaeren(befund) if not befund["sauber"]
                        else "Fehler im Protokoll."),
        }

    if not gelesen:
        # Kein Protokoll gefunden: das Cockpit weiß es schlicht nicht.
        return {
            "test": anzeigename, "ergebnis": UNSICHER, "dauer_min": round(dauer, 1),
            "hinweis": (
                f"{anzeigename} lief {round(dauer)} Minuten ohne Absturz und ohne "
                "Hardwarefehler im Ereignisprotokoll, hat aber kein auswertbares "
                "Protokoll hinterlassen. Bitte im Fenster selbst nachsehen, ob "
                "Fehler gezählt wurden."
            ),
        }

    return {"test": anzeigename, "ergebnis": BESTANDEN, "dauer_min": round(dauer, 1),
            "protokolle": gelesen}


def tm5(minuten, konfig="absolut", zyklen=1):
    """TestMem5 mit einer anta777-Konfiguration."""
    konfig_datei = None
    pfad = tools.suchen("tm5")
    if pfad:
        # Die Konfigurationen liegen üblicherweise neben dem Programm.
        for kandidat in Path(pfad.parent).rglob("*.cfg"):
            if konfig.lower() in kandidat.name.lower():
                konfig_datei = kandidat
                break
    argumente = [str(konfig_datei)] if konfig_datei else []
    ergebnis = fensterprogramm("tm5", f"TestMem5 ({konfig})", minuten, argumente)
    if not konfig_datei and ergebnis.get("ergebnis") != NICHT_MOEGLICH:
        ergebnis["hinweis"] = (
            (ergebnis.get("hinweis", "") + " ")
            + f"Keine Konfiguration '{konfig}' gefunden - TM5 lief mit seiner "
              "Voreinstellung, die für DDR5 zu schwach ist. Die Konfigurationen "
              "von anta777 in den TM5-Ordner legen."
        ).strip()
    return ergebnis


def karhu(minuten, abdeckung=2000):
    """Karhu RAMTest - läuft über die Zeit, Abdeckung wird im Fenster abgelesen."""
    ergebnis = fensterprogramm("karhu", "Karhu RAMTest", minuten)
    ergebnis["abdeckung_ziel"] = abdeckung
    return ergebnis


# ----------------------------------------------------------------- Ablauf

AUSFUEHRER = {
    "ycruncher": lambda p: ycruncher(p.get("minuten", 10), p.get("tests")),
    "tm5": lambda p: tm5(p.get("minuten", 30), p.get("konfig", "absolut"),
                         p.get("zyklen", 1)),
    "karhu": lambda p: karhu(p.get("minuten", 45), p.get("abdeckung", 2000)),
}


def stufe_fahren(stufe, abbruch_bei_fehler=True, melden=print):
    """Fährt alle Tests einer Stufe und fasst zusammen."""
    beschreibung = config.STUFEN[stufe]
    wache = whea.Wache()
    beginn = time.time()
    einzelergebnisse = []

    melden(f"\n  Stufe '{beschreibung['name']}' - etwa {beschreibung['dauer_min']} Minuten")
    melden(f"  {beschreibung['zweck']}")

    for name, parameter in beschreibung["tests"]:
        melden(f"    -> {name} ({parameter.get('minuten', '?')} min) ...")
        ergebnis = AUSFUEHRER[name](parameter)
        einzelergebnisse.append(ergebnis)
        melden(f"       {ergebnis['ergebnis']}"
               + (f" - {ergebnis['hinweis']}" if ergebnis.get("hinweis") else ""))
        if abbruch_bei_fehler and ergebnis["ergebnis"] == FEHLER:
            melden("       Abbruch: weitere Tests sind sinnlos, die Einstellung ist instabil.")
            break

    befund = wache.auswerten()
    dauer = (time.time() - beginn) / 60.0

    hat_fehler = any(e["ergebnis"] == FEHLER for e in einzelergebnisse)
    hat_unsicher = any(e["ergebnis"] == UNSICHER for e in einzelergebnisse)
    lief_etwas = any(e["ergebnis"] != NICHT_MOEGLICH for e in einzelergebnisse)

    if hat_fehler or not befund["sauber"]:
        gesamt = FEHLER
    elif not lief_etwas:
        gesamt = NICHT_MOEGLICH
    elif hat_unsicher:
        gesamt = UNSICHER
    else:
        gesamt = BESTANDEN

    return {
        "stufe": stufe,
        "ergebnis": gesamt,
        "dauer_min": round(dauer, 1),
        "einzeltests": einzelergebnisse,
        "whea": befund,
        "whea_text": whea.befund_erklaeren(befund),
    }
