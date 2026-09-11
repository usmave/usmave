"""Zustand, der Neustarts und Abstürze überlebt.

Der Kern des Cockpits: Eine RAM-Einstellung lässt sich auf AM5 nur im BIOS
setzen, also besteht jede Runde aus Neustart, Test und Auswertung. Wenn der
Test das System zum Absturz bringt - was bei diesem Vorhaben der Normalfall
und nicht der Ausnahmefall ist - muss das Cockpit nach dem Hochfahren wissen,
was es gerade versucht hat und dass genau dieser Versuch gescheitert ist.

Deshalb wird der Zustand vor jedem Test auf die Platte geschrieben und beim
Start wieder eingelesen. Ein Lauf, der als "laeuft" vorgefunden wird, obwohl
das System seitdem neu gestartet ist, gilt als abgestürzt.
"""

import json
import os
import tempfile
from datetime import datetime

from . import config

# Phasen einer Runde.
LEER = "leer"                      # noch nichts vorgeschlagen
WARTET_AUF_BIOS = "wartet_auf_bios"  # Kandidat steht, Eingabe im BIOS fehlt
LAEUFT = "laeuft"                  # Test läuft gerade
AUSGEWERTET = "ausgewertet"        # Runde abgeschlossen

# Ergebnisse eines Laufs.
BESTANDEN = "bestanden"
FEHLER = "fehlgeschlagen"
ABGESTUERZT = "abgestuerzt"
ABGEBROCHEN = "abgebrochen"
NICHT_GEBOOTET = "nicht_gebootet"


def _jetzt():
    return datetime.now().isoformat(timespec="seconds")


def _sicher_schreiben(pfad, daten):
    """Erst in eine Nebendatei, dann umbenennen.

    Ein Absturz mitten im Schreiben darf den Zustand nicht zerstören - sonst
    ist genau die Information weg, die den Absturz erklären würde.
    """
    pfad.parent.mkdir(parents=True, exist_ok=True)
    griff, zwischenpfad = tempfile.mkstemp(dir=str(pfad.parent), suffix=".tmp")
    try:
        with os.fdopen(griff, "w", encoding="utf-8") as datei:
            json.dump(daten, datei, indent=2, ensure_ascii=False)
            datei.flush()
            os.fsync(datei.fileno())
        os.replace(zwischenpfad, pfad)
    except Exception:
        if os.path.exists(zwischenpfad):
            os.unlink(zwischenpfad)
        raise


def _lesen(pfad, standard):
    if not pfad.exists():
        return standard
    try:
        with open(pfad, encoding="utf-8") as datei:
            return json.load(datei)
    except (json.JSONDecodeError, OSError):
        return standard


class Zustand:
    """Der laufende Vorgang: was gerade versucht wird und was bisher war."""

    def __init__(self, daten=None):
        daten = daten or {}
        self.phase = daten.get("phase", LEER)
        self.kandidat = daten.get("kandidat")
        self.stufe = daten.get("stufe", "rauch")
        self.test_begonnen = daten.get("test_begonnen")
        self.ziel = daten.get("ziel", "spiele")
        self.bestueckung = daten.get("bestueckung", "2x32")
        self.letzter_stabiler = daten.get("letzter_stabiler")
        self.basis = daten.get("basis")          # EXPO-Referenzmessung
        self.hardware = daten.get("hardware")    # einmal erkannt, dann fest
        self.runde = daten.get("runde", 0)
        self.abbruchgrund = daten.get("abbruchgrund")

    def als_dict(self):
        return {
            "phase": self.phase,
            "kandidat": self.kandidat,
            "stufe": self.stufe,
            "test_begonnen": self.test_begonnen,
            "ziel": self.ziel,
            "bestueckung": self.bestueckung,
            "letzter_stabiler": self.letzter_stabiler,
            "basis": self.basis,
            "hardware": self.hardware,
            "runde": self.runde,
            "abbruchgrund": self.abbruchgrund,
            "gespeichert": _jetzt(),
        }

    # -------------------------------------------------------------- Speichern

    def speichern(self):
        _sicher_schreiben(config.ZUSTAND, self.als_dict())

    @classmethod
    def laden(cls):
        return cls(_lesen(config.ZUSTAND, {}))

    # ----------------------------------------------------------- Rundenablauf

    def kandidat_setzen(self, kandidat, stufe):
        self.runde += 1
        self.kandidat = kandidat
        self.stufe = stufe
        self.phase = WARTET_AUF_BIOS
        self.test_begonnen = None
        self.speichern()

    def test_beginnt(self):
        self.phase = LAEUFT
        self.test_begonnen = _jetzt()
        self.speichern()

    def runde_beenden(self):
        self.phase = AUSGEWERTET
        self.test_begonnen = None
        self.speichern()

    def stabil_vermerken(self, kandidat):
        """Der Rückfallpunkt: die beste Einstellung, die eine Stufe bestanden hat."""
        self.letzter_stabiler = kandidat
        self.speichern()


class Laufbuch:
    """Alle bisherigen Läufe - die eigentliche Ausbeute des Vorgangs."""

    def __init__(self):
        self.eintraege = _lesen(config.LAEUFE, [])

    def anhaengen(self, lauf):
        self.eintraege.append(lauf)
        _sicher_schreiben(config.LAEUFE, self.eintraege)

    def letzter(self):
        return self.eintraege[-1] if self.eintraege else None

    def bestandene(self):
        return [e for e in self.eintraege if e.get("ergebnis") == BESTANDEN]

    def fuer_kandidat(self, kandidat_id):
        return [e for e in self.eintraege if e.get("kandidat", {}).get("id") == kandidat_id]

    def bester(self, gewichtung=None):
        """Der beste bestandene Lauf nach Punkten."""
        bestanden = [e for e in self.bestandene() if e.get("punkte") is not None]
        if not bestanden:
            return None
        return max(bestanden, key=lambda e: e["punkte"])

    def schon_versucht(self, kandidat):
        """Verhindert, dass dieselbe Einstellung zweimal getestet wird."""
        kennung = kandidat_kennung(kandidat)
        return any(
            kandidat_kennung(e.get("kandidat", {})) == kennung for e in self.eintraege
        )


def kandidat_kennung(kandidat):
    """Vergleichbare Kennung einer Einstellung, unabhängig von der Reihenfolge."""
    if not kandidat:
        return ""
    teile = [str(kandidat.get("mclk")), str(kandidat.get("fclk"))]
    for schluessel in sorted(kandidat.get("timings", {})):
        teile.append(f"{schluessel}={kandidat['timings'][schluessel]}")
    for schluessel in sorted(kandidat.get("spannungen", {})):
        teile.append(f"{schluessel}={kandidat['spannungen'][schluessel]}")
    return "|".join(teile)


def absturz_erkennen(zustand, bootzeit):
    """Ist seit dem Teststart neu gestartet worden?

    Genau das ist der Fall, den kein Stresstest melden kann: Das System war so
    instabil, dass es keine Gelegenheit mehr hatte, ein Ergebnis zu schreiben.
    """
    if zustand.phase != LAEUFT or not zustand.test_begonnen:
        return False
    if bootzeit is None:
        # Ohne Bootzeit bleibt nur der Umstand, dass ein Lauf offen ist -
        # das Cockpit läuft schließlich gerade neu an.
        return True
    try:
        begonnen = datetime.fromisoformat(zustand.test_begonnen)
    except ValueError:
        return True
    return bootzeit > begonnen
