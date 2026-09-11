"""Überwachung stiller Fehler - der Teil, den die meisten auslassen.

Ein Speicher kann eine Nacht lang jeden Stresstest bestehen und trotzdem
instabil sein: Der Prozessor korrigiert einzelne Fehler selbst und meldet sie
nur ins Windows-Ereignisprotokoll. Sichtbar wird das erst, wenn man dort
nachsieht - und genau das tut dieses Modul nach jedem Testabschnitt.

Ein einziger korrigierter Fehler (WHEA-Logger 19) während eines Laufs macht
den Lauf ungültig, egal was der Stresstest sagt.
"""

from datetime import datetime

from . import system

ANBIETER_WHEA = "Microsoft-Windows-WHEA-Logger"
ANBIETER_KERNEL = "Microsoft-Windows-Kernel-Power"

# 17/19/47 werden korrigiert und bleiben oft unbemerkt - sie sind das Ziel.
# 18/20 sind bereits tödlich und führen ohnehin zum Absturz.
IDS_KORRIGIERT = [17, 19, 47]
IDS_TOEDLICH = [18, 20]

# 41 = das System wurde neu gestartet, ohne sauber herunterzufahren.
ID_UNSAUBERER_NEUSTART = 41


def fehler_seit(zeitpunkt):
    """Alle Hardwarefehler seit einem Zeitpunkt."""
    korrigiert = system.ereignisse(ANBIETER_WHEA, IDS_KORRIGIERT, seit=zeitpunkt)
    toedlich = system.ereignisse(ANBIETER_WHEA, IDS_TOEDLICH, seit=zeitpunkt)
    return {
        "korrigiert": len(korrigiert),
        "toedlich": len(toedlich),
        "eintraege": [
            {
                "id": e.get("Id"),
                "zeit": e.get("TimeCreated"),
                "stufe": e.get("LevelDisplayName"),
                "text": (e.get("Message") or "")[:300],
            }
            for e in (korrigiert + toedlich)
        ],
    }


def unsauberer_neustart_seit(zeitpunkt):
    """Gab es seit dem Zeitpunkt einen Absturz statt eines Herunterfahrens?"""
    eintraege = system.ereignisse(ANBIETER_KERNEL, [ID_UNSAUBERER_NEUSTART], seit=zeitpunkt)
    return len(eintraege) > 0


class Wache:
    """Merkt sich den Startzeitpunkt und zählt am Ende zusammen."""

    def __init__(self):
        self.beginn = datetime.now()

    def auswerten(self):
        befund = fehler_seit(self.beginn)
        befund["unsauberer_neustart"] = unsauberer_neustart_seit(self.beginn)
        befund["sauber"] = (
            befund["korrigiert"] == 0
            and befund["toedlich"] == 0
            and not befund["unsauberer_neustart"]
        )
        return befund


def befund_erklaeren(befund):
    """Klartext für den Bericht."""
    if befund.get("sauber"):
        return "Keine Hardwarefehler im Ereignisprotokoll."

    teile = []
    if befund.get("toedlich"):
        teile.append(
            f"{befund['toedlich']} nicht korrigierbare Hardwarefehler - "
            "diese Einstellung ist eindeutig instabil."
        )
    if befund.get("korrigiert"):
        teile.append(
            f"{befund['korrigiert']} korrigierte Hardwarefehler (WHEA 19 o. ä.). "
            "Das System lief weiter und der Stresstest hat nichts gemeldet, "
            "aber der Speichercontroller musste Fehler ausbügeln. Für ein "
            "Alltagsprofil ist das nicht gut genug."
        )
    if befund.get("unsauberer_neustart"):
        teile.append("Das System wurde unsauber neu gestartet (Kernel-Power 41).")
    return " ".join(teile)
