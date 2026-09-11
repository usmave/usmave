"""Machbarkeitsnachweis: Trägt der Weg, bevor darauf gebaut wird?

Bevor ein Suchlauf über Dutzende Runden Sinn ergibt, muss ein einziger
Durchgang nachweislich funktionieren:

    auslesen -> eine kontrollierte Änderung anwenden -> neu starten ->
    prüfen, was tatsächlich anliegt -> Ausgangszustand wiederherstellen

Zwei Entwurfsentscheidungen, die dabei wichtig sind:

1. Die Teständerung LOCKERT ein Timing, sie verschärft es nicht. Geprüft wird
   der Mechanismus - ob eine Vorgabe überhaupt ankommt -, nicht die Stabilität
   des Speichers. Ein gelockertes tRFC kann nicht zu einem Fehlstart führen,
   also ist ein Fehlschlag hier eindeutig dem Weg zuzuschreiben und nicht dem
   Speicher.

2. Der Ausgangszustand wird vollständig gesichert, bevor irgendetwas passiert.
   Das ist der Rückweg, und er muss stehen, bevor der Hinweg begangen wird.

Ohne ZenTimings ist dieser Nachweis nicht führbar: Es gäbe keine Möglichkeit
zu prüfen, ob eine Vorgabe tatsächlich angekommen ist - und genau das ist die
Frage.
"""

import json
from datetime import datetime

from . import config, detect, profiles, state, tools

DATEI = config.DATEN / "machbarkeit.json"

# Schritte des Nachweises.
NICHT_BEGONNEN = "nicht_begonnen"
AENDERUNG_ANGEFORDERT = "aenderung_angefordert"
RUECKWEG_ANGEFORDERT = "rueckweg_angefordert"
ABGESCHLOSSEN = "abgeschlossen"


def _laden():
    if not DATEI.exists():
        return {"schritt": NICHT_BEGONNEN}
    try:
        with open(DATEI, encoding="utf-8") as datei:
            return json.load(datei)
    except (json.JSONDecodeError, OSError):
        return {"schritt": NICHT_BEGONNEN}


def _speichern(daten):
    DATEI.parent.mkdir(parents=True, exist_ok=True)
    with open(DATEI, "w", encoding="utf-8") as datei:
        json.dump(daten, datei, indent=2, ensure_ascii=False)


def wege_erkunden():
    """Welche Wege zum Setzen stehen auf diesem System überhaupt zur Verfügung?

    Bewusst als Bestandsaufnahme formuliert, nicht als Zusage: Ob ein Weg
    trägt, entscheidet der Nachweis, nicht diese Liste.
    """
    wege = [{
        "name": "BIOS von Hand",
        "vorhanden": True,
        "automatisierbar": False,
        "anmerkung": (
            "Funktioniert immer und setzt alles. Ein Handgriff pro Runde."
        ),
    }]

    ryzen_master = tools.suchen("ryzenmaster")
    wege.append({
        "name": "AMD Ryzen Master",
        "vorhanden": ryzen_master is not None,
        "automatisierbar": "ungeprüft",
        "anmerkung": (
            "Kann auf AM5 Speichertakt, Fabric-Takt, UCLK-Modus, Spannungen "
            "und Timings vorgeben; ein EXPO-Profil sogar ohne Neustart, "
            "Timings in der Regel mit. Für ein Programm ist das aber nicht "
            "ansteuerbar: Das offizielle Ryzen-Master-SDK ist ein reines "
            "Monitoring-SDK - es liest Speichertakt, VDDIO, RAS, CAS, tRCD "
            "und tRP, es schreibt sie nicht. Bliebe die Fernsteuerung der "
            "Oberfläche, wie sie Bastelskripte in der Gemeinde machen. Ob das "
            "auf diesem Board zuverlässig genug ist, klärt genau dieser "
            "Nachweis."
        ),
    })

    return wege


def testaenderung_waehlen(ist_zustand):
    """Sucht ein Timing, das sich gefahrlos lockern lässt.

    Gesucht wird bewusst in der sicheren Richtung: Der Nachweis soll am Weg
    scheitern können, nicht am Speicher.
    """
    timings = (ist_zustand or {}).get("timings", {})

    # tRFC zuerst: in ZenTimings eindeutig ablesbar, großer Zahlenraum, und
    # ein höherer Wert ist immer harmloser als der jetzige.
    if "tRFC" in timings:
        return {
            "timing": "tRFC",
            "agesa": profiles.TIMINGS["tRFC"]["agesa"],
            "vorher": timings["tRFC"],
            "nachher": timings["tRFC"] + 32,
            "begruendung": (
                "tRFC wird um 32 Takte gelockert. Das macht den Speicher "
                "minimal langsamer und kann keinen Fehlstart verursachen - "
                "geprüft wird nur, ob die Vorgabe ankommt."
            ),
        }

    if "tCL" in timings:
        return {
            "timing": "tCL",
            "agesa": profiles.TIMINGS["tCL"]["agesa"],
            "vorher": timings["tCL"],
            "nachher": timings["tCL"] + 2,
            "begruendung": "tCL wird um zwei Takte gelockert (sichere Richtung).",
        }

    return None


def beginnen(zentimings_export):
    """Schritt 1: Ausgangszustand sichern und die Teständerung benennen."""
    if not zentimings_export:
        return None, (
            "Für den Nachweis wird ein ZenTimings-Export gebraucht - sonst "
            "lässt sich nicht prüfen, ob eine Vorgabe angekommen ist, und "
            "genau das ist die Frage."
        )

    ausgang = detect.zentimings_lesen(zentimings_export)
    if not ausgang or not ausgang.get("timings"):
        return None, (
            f"Aus {zentimings_export} ließen sich keine Timings lesen. In "
            "ZenTimings exportieren und den Pfad angeben."
        )

    aenderung = testaenderung_waehlen(ausgang)
    if not aenderung:
        return None, "Kein Timing gefunden, das sich gefahrlos lockern ließe."

    daten = {
        "schritt": AENDERUNG_ANGEFORDERT,
        "begonnen": datetime.now().isoformat(timespec="seconds"),
        "ausgangszustand": ausgang,
        "aenderung": aenderung,
        "protokoll": [],
    }
    _speichern(daten)
    return daten, None


def aenderung_pruefen(zentimings_export):
    """Schritt 2: Kam die Vorgabe an?"""
    daten = _laden()
    if daten["schritt"] != AENDERUNG_ANGEFORDERT:
        return daten, "In diesem Schritt ist keine Prüfung der Änderung vorgesehen."

    jetzt = detect.zentimings_lesen(zentimings_export)
    if not jetzt:
        return daten, "Kein lesbarer ZenTimings-Export."

    aenderung = daten["aenderung"]
    anliegend = jetzt.get("timings", {}).get(aenderung["timing"])
    erfolg = anliegend == aenderung["nachher"]

    daten["protokoll"].append({
        "schritt": "aenderung",
        "erwartet": aenderung["nachher"],
        "anliegend": anliegend,
        "erfolg": erfolg,
        "zeit": datetime.now().isoformat(timespec="seconds"),
    })
    daten["schritt"] = RUECKWEG_ANGEFORDERT if erfolg else ABGESCHLOSSEN
    daten["aenderung_erfolg"] = erfolg
    _speichern(daten)
    return daten, None


def rueckweg_pruefen(zentimings_export):
    """Schritt 3: Ist der Ausgangszustand wirklich wieder da?"""
    daten = _laden()
    if daten["schritt"] != RUECKWEG_ANGEFORDERT:
        return daten, "In diesem Schritt ist keine Prüfung des Rückwegs vorgesehen."

    jetzt = detect.zentimings_lesen(zentimings_export)
    if not jetzt:
        return daten, "Kein lesbarer ZenTimings-Export."

    ausgang = daten["ausgangszustand"]["timings"]
    anliegend = jetzt.get("timings", {})

    abweichungen = [
        f"{name}: erwartet {wert}, anliegend {anliegend.get(name)}"
        for name, wert in ausgang.items()
        if name in anliegend and anliegend[name] != wert
    ]
    erfolg = not abweichungen

    daten["protokoll"].append({
        "schritt": "rueckweg",
        "abweichungen": abweichungen,
        "erfolg": erfolg,
        "zeit": datetime.now().isoformat(timespec="seconds"),
    })
    daten["schritt"] = ABGESCHLOSSEN
    daten["rueckweg_erfolg"] = erfolg
    _speichern(daten)
    return daten, None


def urteil(daten):
    """Was der Nachweis ergeben hat - ohne Beschönigung."""
    if daten.get("schritt") != ABGESCHLOSSEN:
        return "offen", "Der Nachweis ist noch nicht abgeschlossen."

    hin = daten.get("aenderung_erfolg")
    zurueck = daten.get("rueckweg_erfolg")

    if hin and zurueck:
        return "getragen", (
            "Der Durchgang hat funktioniert: Die Vorgabe kam an, und der "
            "Ausgangszustand ließ sich wiederherstellen. Damit ist die "
            "Grundlage für den Suchlauf nachgewiesen - für diesen einen Weg, "
            "auf diesem Board, mit dieser BIOS-Fassung."
        )
    if hin and not zurueck:
        return "halb", (
            "Die Vorgabe kam an, aber der Ausgangszustand ist nicht sauber "
            "wiederhergestellt. Das ist der gefährlichere der beiden "
            "Fehlschläge: Ein Suchlauf ohne verlässlichen Rückweg kann in "
            "einem Zustand enden, aus dem nur noch das Zurücksetzen des BIOS "
            "heraushilft. Vor dem Weitermachen klären."
        )
    if not hin:
        return "nicht_getragen", (
            "Die Vorgabe ist nicht angekommen. Entweder wurde sie nicht "
            "gesetzt, oder das Speichertraining hat sie verworfen. Weil die "
            "Änderung bewusst in die sichere Richtung ging, liegt es nicht am "
            "Speicher - der Weg selbst trägt nicht."
        )
    return "unklar", "Der Nachweis ließ sich nicht eindeutig auswerten."


def zuruecksetzen():
    if DATEI.exists():
        DATEI.unlink()
