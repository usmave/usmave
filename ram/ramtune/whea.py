"""Hardwarefehler aus dem Windows-Ereignisprotokoll - richtig eingeordnet.

Wozu das gut ist: Ein Speicher kann eine Nacht lang jeden Stresstest bestehen
und trotzdem instabil sein. Der Prozessor korrigiert einzelne Fehler selbst
und meldet sie nur hierhin. Wer nicht nachsieht, hält so eine Einstellung für
alltagstauglich.

Wozu es NICHT gut ist - und das ist genauso wichtig:

  * Ein leeres Protokoll beweist keine Stabilität. Es beweist nur, dass nichts
    aufgefallen ist. Der On-Die-ECC von DDR5 schützt die Zellen im Baustein,
    nicht die Übertragung zum Speichercontroller, und ohne echtes ECC bleibt
    ein Teil der Fehler schlicht unbemerkt. Das Protokoll ist ein zusätzliches
    Ausschlusskriterium, kein Freibrief.

  * Nicht jeder WHEA-Eintrag kommt vom Speicher. Ereignis 17 stammt meist von
    PCI Express - einer Grafikkarte, einer NVMe-SSD, einer Netzwerkkarte.
    Würde man das dem Speicher zuschreiben, verwürfe man stabile Einstellungen
    wegen einer zickigen Steckkarte. Deshalb wird hier nach Domäne getrennt.

Die Schlussrichtung ist also einseitig und nur in dieser Richtung gültig:
ein speicherrelevanter Fehler macht den Lauf ungültig - kein Fehler macht ihn
nicht gültig.
"""

import re
from datetime import datetime

from . import system

ANBIETER_WHEA = "Microsoft-Windows-WHEA-Logger"
ANBIETER_KERNEL = "Microsoft-Windows-Kernel-Power"

# Korrigierte Fehler: bleiben ohne Absturz und damit meist unbemerkt.
# 17 wird mitgelesen, aber nicht ungeprüft dem Speicher zugerechnet.
IDS_KORRIGIERT = [17, 19, 46, 47]
IDS_TOEDLICH = [18, 20]

ID_UNSAUBERER_NEUSTART = 41

# Woran sich die Domäne eines Eintrags erkennen lässt.
MUSTER_PCIE = re.compile(
    r"(pci\s*express|pcie|root\s*port|\bPCI\\VEN|endpoint|bus/interconnect.*pci)", re.I)
MUSTER_SPEICHER = re.compile(
    r"(machine\s*check|memory\s*controller|cache\s*hierarchy|bus/interconnect|"
    r"\bdram\b|memory\s*error|speicher)", re.I)


def _domaene(eintrag):
    """Ordnet einen Eintrag ein: 'speicher', 'pcie' oder 'unklar'.

    Die Ereignisnummer allein reicht nicht - entscheidend ist der Meldungstext.
    """
    kennung = eintrag.get("Id")
    text = eintrag.get("Message") or ""

    # 46/47 betreffen ausdrücklich Speicherseiten.
    if kennung in (46, 47):
        return "speicher"

    if MUSTER_PCIE.search(text):
        return "pcie"
    if MUSTER_SPEICHER.search(text):
        return "speicher"

    # 19 ohne verwertbaren Text ist eine korrigierte Machine-Check-Ausnahme und
    # damit prozessornah - im Zweifel dem Speicher zurechnen.
    if kennung == 19:
        return "speicher"
    # 17 ohne verwertbaren Text bleibt unklar statt fälschlich "Speicher".
    return "unklar"


def fehler_seit(zeitpunkt):
    """Alle Hardwarefehler seit einem Zeitpunkt, nach Domäne getrennt."""
    korrigiert = system.ereignisse(ANBIETER_WHEA, IDS_KORRIGIERT, seit=zeitpunkt)
    toedlich = system.ereignisse(ANBIETER_WHEA, IDS_TOEDLICH, seit=zeitpunkt)

    aufbereitet = []
    for eintrag in korrigiert + toedlich:
        aufbereitet.append({
            "id": eintrag.get("Id"),
            "zeit": eintrag.get("TimeCreated"),
            "stufe": eintrag.get("LevelDisplayName"),
            "domaene": _domaene(eintrag),
            "toedlich": eintrag.get("Id") in IDS_TOEDLICH,
            "text": (eintrag.get("Message") or "")[:300],
        })

    speicher = [e for e in aufbereitet if e["domaene"] == "speicher"]
    pcie = [e for e in aufbereitet if e["domaene"] == "pcie"]
    unklar = [e for e in aufbereitet if e["domaene"] == "unklar"]

    return {
        "speicherrelevant": len(speicher),
        "pcie": len(pcie),
        "unklar": len(unklar),
        "toedlich": len([e for e in aufbereitet if e["toedlich"]]),
        "eintraege": aufbereitet,
    }


def unsauberer_neustart_seit(zeitpunkt):
    return len(system.ereignisse(ANBIETER_KERNEL, [ID_UNSAUBERER_NEUSTART],
                                 seit=zeitpunkt)) > 0


class Wache:
    """Merkt sich den Startzeitpunkt und wertet am Ende aus."""

    def __init__(self):
        self.beginn = datetime.now()

    def auswerten(self):
        befund = fehler_seit(self.beginn)
        befund["unsauberer_neustart"] = unsauberer_neustart_seit(self.beginn)

        # Was den Lauf ungültig macht. Reine PCIe-Fehler gehören nicht dazu -
        # die kommen von woanders her.
        befund["belastend"] = (
            befund["speicherrelevant"] > 0
            or befund["toedlich"] > 0
            or befund["unsauberer_neustart"]
        )
        # Ausdrücklich NICHT "stabil": nur "nichts aufgefallen".
        befund["ohne_befund"] = (
            not befund["belastend"] and befund["pcie"] == 0 and befund["unklar"] == 0
        )
        return befund


def befund_erklaeren(befund):
    """Klartext, der die Aussagekraft nicht überzeichnet."""
    if befund.get("ohne_befund"):
        return ("Keine Hardwarefehler im Ereignisprotokoll. Das ist kein Beweis "
                "für Stabilität, nur ein fehlender Gegenbeweis.")

    teile = []
    if befund.get("toedlich"):
        teile.append(
            f"{befund['toedlich']} nicht korrigierbare Hardwarefehler - "
            "diese Einstellung ist eindeutig instabil."
        )
    if befund.get("speicherrelevant"):
        teile.append(
            f"{befund['speicherrelevant']} korrigierte speichernahe Fehler "
            "(Machine Check oder Speicherseite). Der Stresstest hat nichts "
            "gemeldet, der Prozessor musste aber Fehler ausbügeln - für ein "
            "Alltagsprofil reicht das nicht."
        )
    if befund.get("unsauberer_neustart"):
        teile.append("Das System wurde unsauber neu gestartet (Kernel-Power 41).")
    if befund.get("pcie"):
        teile.append(
            f"Außerdem {befund['pcie']} Fehler von PCI Express (Grafikkarte, "
            "SSD oder Netzwerkkarte). Die zählen hier nicht gegen den Speicher, "
            "sind aber einen eigenen Blick wert."
        )
    if befund.get("unklar"):
        teile.append(
            f"{befund['unklar']} Einträge ließen sich keiner Komponente zuordnen "
            "- sie werden protokolliert, aber nicht gewertet."
        )
    return " ".join(teile)
