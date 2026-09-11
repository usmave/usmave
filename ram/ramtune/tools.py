"""Findet die externen Werkzeuge, ohne die das Cockpit nichts messen kann.

Absichtlich wird nichts heruntergeladen und nichts installiert: Diese
Programme greifen tief ins System, die Entscheidung darüber gehört dem
Menschen davor. Das Cockpit sagt nur, was fehlt und wo es herkommt.
"""

import json
import os
import shutil
from pathlib import Path

from . import config

WERKZEUGE = {
    "ycruncher": {
        "name": "y-cruncher",
        "datei": "y-cruncher.exe",
        "pflicht": True,
        "zweck": "Findet Instabilität des Speichercontrollers am schnellsten.",
        "quelle": "http://www.numberworld.org/y-cruncher/",
        "kosten": "kostenlos",
    },
    "tm5": {
        "name": "TestMem5",
        "datei": "TM5.exe",
        "pflicht": True,
        "zweck": "Der DDR5-Standardtest. Braucht die Konfigurationen von anta777.",
        "quelle": "https://github.com/CoolCmd/TestMem5",
        "kosten": "kostenlos",
    },
    "karhu": {
        "name": "Karhu RAMTest",
        "datei": "RAMTest.exe",
        "pflicht": False,
        "zweck": "Beste Fehlerausbeute pro Stunde. Das einzige Bezahlwerkzeug, das sich lohnt.",
        "quelle": "https://www.karhusoftware.com/ramtest/",
        "kosten": "rund 10 Euro",
    },
    "mlc": {
        "name": "Intel Memory Latency Checker",
        "datei": "mlc.exe",
        "pflicht": True,
        "zweck": "Misst Latenz und Bandbreite. Läuft trotz des Namens auf AMD.",
        "quelle": "https://www.intel.com/content/www/us/en/download/736633/",
        "kosten": "kostenlos",
    },
    "zentimings": {
        "name": "ZenTimings",
        "datei": "ZenTimings.exe",
        "pflicht": False,
        "zweck": "Liest die tatsächlich anliegenden Timings und Spannungen aus.",
        "quelle": "https://github.com/irusanov/ZenTimings",
        "kosten": "kostenlos",
    },
    "ryzenmaster": {
        "name": "AMD Ryzen Master",
        "datei": "AMD Ryzen Master.exe",
        "pflicht": False,
        "zweck": ("Kann auf AM5 Speichereinstellungen vorgeben. Für ein Programm "
                  "nicht ansteuerbar - das AMD-SDK liest nur."),
        "quelle": "https://www.amd.com/en/products/software/ryzen-master.html",
        "kosten": "kostenlos",
    },
    "hwinfo": {
        "name": "HWiNFO64",
        "datei": "HWiNFO64.exe",
        "pflicht": False,
        "zweck": "Liefert die Modultemperatur - entscheidend für tREFI.",
        "quelle": "https://www.hwinfo.com/download/",
        "kosten": "kostenlos",
    },
}

# Wo gesucht wird, wenn in werkzeuge.json nichts hinterlegt ist.
SUCHORTE = [
    config.WURZEL / "werkzeuge",
    Path("C:/") / "RamTune",
    Path(os.environ.get("ProgramFiles", "C:/Program Files")),
    Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")),
    Path(os.environ.get("USERPROFILE", "C:/Users/Default")) / "Downloads",
    Path(os.environ.get("USERPROFILE", "C:/Users/Default")) / "Desktop",
]

EIGENE_PFADE = config.DATEN / "werkzeuge.json"


def _hinterlegte_pfade():
    if not EIGENE_PFADE.exists():
        return {}
    try:
        with open(EIGENE_PFADE, encoding="utf-8") as datei:
            return json.load(datei)
    except (json.JSONDecodeError, OSError):
        return {}


def pfad_hinterlegen(schluessel, pfad):
    """Merkt sich einen selbst gewählten Ablageort dauerhaft."""
    pfade = _hinterlegte_pfade()
    pfade[schluessel] = str(pfad)
    EIGENE_PFADE.parent.mkdir(parents=True, exist_ok=True)
    with open(EIGENE_PFADE, "w", encoding="utf-8") as datei:
        json.dump(pfade, datei, indent=2, ensure_ascii=False)


def suchen(schluessel):
    """Sucht ein Werkzeug und gibt den Pfad zurück, oder None."""
    beschreibung = WERKZEUGE.get(schluessel)
    if not beschreibung:
        return None

    hinterlegt = _hinterlegte_pfade().get(schluessel)
    if hinterlegt and Path(hinterlegt).exists():
        return Path(hinterlegt)

    # Liegt es im Suchpfad?
    treffer = shutil.which(beschreibung["datei"])
    if treffer:
        return Path(treffer)

    # Sonst die üblichen Orte absuchen, eine Ebene tief.
    for ort in SUCHORTE:
        try:
            if not ort.exists():
                continue
            direkt = ort / beschreibung["datei"]
            if direkt.exists():
                return direkt
            for unterordner in ort.iterdir():
                if not unterordner.is_dir():
                    continue
                kandidat = unterordner / beschreibung["datei"]
                if kandidat.exists():
                    return kandidat
        except (OSError, PermissionError):
            continue
    return None


def bestandsaufnahme():
    """Was ist da, was fehlt? Grundlage für den Startbericht."""
    ergebnis = {}
    for schluessel, beschreibung in WERKZEUGE.items():
        pfad = suchen(schluessel)
        ergebnis[schluessel] = {
            **beschreibung,
            "pfad": str(pfad) if pfad else None,
            "vorhanden": pfad is not None,
        }
    return ergebnis


def fehlende_pflicht(bestand=None):
    bestand = bestand or bestandsaufnahme()
    return [
        s for s, w in bestand.items() if w["pflicht"] and not w["vorhanden"]
    ]
