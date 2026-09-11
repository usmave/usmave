"""Liest den Ist-Zustand aus: Module, Bestückung, Timings, Temperaturen.

Drei Quellen, absteigend nach Genauigkeit:
  1. ZenTimings-Export - die tatsächlich anliegenden Timings und Spannungen.
  2. HWiNFO-Protokoll   - Modultemperaturen, die es sonst nirgends gibt.
  3. Windows/WMI        - Bestückung, Kapazität, Teilenummern. Immer verfügbar.

Fehlt eine Quelle, arbeitet das Cockpit mit dem weiter, was da ist, und sagt
im Bericht, welche Angabe auf welcher Grundlage steht.
"""

import csv
import re
from pathlib import Path

from . import profiles, system


# ------------------------------------------------------------------- Module

def module_auslesen():
    """Bestückung über WMI: Kapazität, Hersteller, Teilenummer, Steckplatz."""
    eintraege = system.powershell_json(
        "Get-CimInstance Win32_PhysicalMemory |"
        " Select-Object Capacity,Manufacturer,PartNumber,Speed,"
        "ConfiguredClockSpeed,DeviceLocator,BankLabel"
    )
    module = []
    for eintrag in eintraege:
        try:
            kapazitaet_gb = int(eintrag.get("Capacity", 0)) // (1024 ** 3)
        except (TypeError, ValueError):
            kapazitaet_gb = 0
        module.append({
            "kapazitaet_gb": kapazitaet_gb,
            "hersteller": (eintrag.get("Manufacturer") or "").strip(),
            "teilenummer": (eintrag.get("PartNumber") or "").strip(),
            "spd_mts": eintrag.get("Speed"),
            "aktuell_mts": eintrag.get("ConfiguredClockSpeed"),
            "steckplatz": (eintrag.get("DeviceLocator") or "").strip(),
            "bank": (eintrag.get("BankLabel") or "").strip(),
        })
    return module


def bestueckung_bewerten(module):
    """Beurteilt die Bestückung - inklusive des Steckplatz-Fehlers.

    Auf AM5 gehören zwei Module in die jeweils zweiten Steckplätze (A2 und B2,
    die weiter von der CPU entfernten). Stecken sie in A1/B1, kostet das Takt,
    ohne dass es irgendwo eine Fehlermeldung gäbe - ein Fehler, der sich durch
    keine noch so gute Einstellung ausgleichen lässt.
    """
    anzahl = len(module)
    gesamt_gb = sum(m["kapazitaet_gb"] for m in module)
    dual_rank = any(m["kapazitaet_gb"] >= 32 for m in module)

    warnungen = []
    if anzahl == 2:
        art = "2 Module"
        korridor = "gut"
        plaetze = " ".join(m["steckplatz"].upper() for m in module)
        # Die Bezeichnungen unterscheiden sich je Hersteller; gesucht wird die
        # Ziffer 2 im Steckplatznamen beider Module.
        ziffern = re.findall(r"[AB]?(\d)", plaetze)
        if ziffern and all(z == "1" for z in ziffern):
            warnungen.append(
                "Die Module scheinen in den ERSTEN Steckplätzen (A1/B1) zu sitzen. "
                "Auf AM5 gehören zwei Module in A2 und B2 - also die beiden "
                "Steckplätze weiter weg von der CPU. In A1/B1 verlieren viele "
                "Systeme mehrere hundert MT/s, ohne dass es eine Fehlermeldung gibt. "
                "Das ist die eine Sache, die vor allem anderen zu prüfen ist."
            )
    elif anzahl == 4:
        art = "4 Module"
        korridor = "schwierig"
        warnungen.append(
            "Vier Module sind auf AM5 die härteste Belastung für den "
            "Speichercontroller. Der erreichbare Takt liegt deutlich niedriger, "
            "das Cockpit geht entsprechend vorsichtiger vor."
        )
    elif anzahl == 1:
        art = "1 Modul"
        korridor = "einkanalig"
        warnungen.append(
            "Nur ein Modul erkannt - das halbiert die Speicherbandbreite. "
            "Vor jeder Feinabstimmung sollte das zweite Modul hinein."
        )
    else:
        art = f"{anzahl} Module"
        korridor = "unklar"

    return {
        "anzahl": anzahl,
        "gesamt_gb": gesamt_gb,
        "art": art,
        "dual_rank": dual_rank,
        "korridor": korridor,
        "warnungen": warnungen,
    }


# -------------------------------------------------------------- ZenTimings

# Die Exportdatei von ZenTimings ist eine schlichte Liste aus Bezeichnung und
# Wert. Die Schreibweisen schwanken zwischen den Fassungen, deshalb wird je
# Timing eine Reihe möglicher Namen akzeptiert.
ZEN_NAMEN = {
    "tCL": ["cl", "tcl", "cas latency"],
    "tRCD": ["trcd", "trcdrd", "rcd"],
    "tRP": ["trp", "rp"],
    "tRAS": ["tras", "ras"],
    "tRC": ["trc"],
    "tRFC": ["trfc", "trfc1"],
    "tRFC2": ["trfc2"],
    "tRFCsb": ["trfcsb", "trfc4"],
    "tREFI": ["trefi", "refi"],
    "tRRD_S": ["trrds", "trrd_s"],
    "tRRD_L": ["trrdl", "trrd_l"],
    "tFAW": ["tfaw", "faw"],
    "tWTR_S": ["twtrs", "twtr_s"],
    "tWTR_L": ["twtrl", "twtr_l"],
    "tWR": ["twr"],
    "tRTP": ["trtp"],
    "tRDRDSCL": ["trdrdscl", "trdrd_scl"],
    "tWRWRSCL": ["twrwrscl", "twrwr_scl"],
    "tRDWR": ["trdwr"],
    "tWRRD": ["twrrd"],
    "tRDRDSD": ["trdrdsd"],
    "tRDRDDD": ["trdrddd"],
    "tWRWRSD": ["twrwrsd"],
    "tWRWRDD": ["twrwrdd"],
}

ZEN_SPANNUNGEN = {
    "vsoc": ["vsoc", "soc voltage", "cpu vsoc"],
    "vddio": ["vddio", "vddio mem", "vdd misc", "cpu vddio"],
    "vdd": ["vdd", "mem vdd", "dram vdd"],
    "vddq": ["vddq", "mem vddq", "dram vddq"],
}


def _normalisieren(text):
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def zentimings_lesen(pfad):
    """Parst einen ZenTimings-Export (Text oder JSON) zu einem Kandidaten."""
    pfad = Path(pfad)
    if not pfad.exists():
        return None

    try:
        inhalt = pfad.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    # Jede "Name: Wert"-Zeile einsammeln, egal in welchem Format.
    paare = {}
    for treffer in re.finditer(r'"?([A-Za-z][A-Za-z0-9 _\-]{1,28})"?\s*[:=]\s*"?([0-9]+(?:[.,][0-9]+)?)',
                               inhalt):
        paare[_normalisieren(treffer.group(1))] = treffer.group(2).replace(",", ".")

    def suche(namen, ganzzahl=True):
        for name in namen:
            wert = paare.get(_normalisieren(name))
            if wert is not None:
                try:
                    return int(float(wert)) if ganzzahl else float(wert)
                except ValueError:
                    continue
        return None

    timings = {}
    for schluessel, namen in ZEN_NAMEN.items():
        wert = suche(namen)
        if wert is not None:
            timings[schluessel] = wert

    spannungen = {}
    for schluessel, namen in ZEN_SPANNUNGEN.items():
        wert = suche(namen, ganzzahl=False)
        if wert is not None:
            # ZenTimings zeigt teils Millivolt.
            spannungen[schluessel] = wert / 1000.0 if wert > 10 else wert

    if not timings:
        return None

    # Speichertakt: ZenTimings nennt MCLK in MHz, die Übertragungsrate ist das Doppelte.
    mclk_mhz = suche(["frequency", "mclk", "memclk"])
    mclk_mts = None
    if mclk_mhz:
        mclk_mts = int(mclk_mhz * 2) if mclk_mhz < 4500 else int(mclk_mhz)

    return {
        "mclk": mclk_mts,
        "fclk": suche(["fclk", "fclkfreq"]),
        "uclk": suche(["uclk"]),
        "timings": timings,
        "spannungen": spannungen,
        "quelle": str(pfad),
    }


# ----------------------------------------------------------- Modultemperatur

def hwinfo_temperatur(csv_pfad):
    """Höchste Modultemperatur aus einem HWiNFO-Protokoll.

    HWiNFO schreibt sehr breite CSV-Dateien; gesucht werden Spalten, deren
    Überschrift sowohl auf ein Modul als auch auf eine Temperatur hindeutet.
    """
    pfad = Path(csv_pfad)
    if not pfad.exists():
        return None

    try:
        with open(pfad, newline="", encoding="utf-8", errors="replace") as datei:
            leser = csv.reader(datei)
            try:
                kopf = next(leser)
            except StopIteration:
                return None

            spalten = [
                i for i, name in enumerate(kopf)
                if re.search(r"(dimm|dram|spd|memory|modul)", name, re.I)
                and re.search(r"(temp|°c)", name, re.I)
            ]
            if not spalten:
                return None

            hoechste = None
            for zeile in leser:
                for i in spalten:
                    if i >= len(zeile):
                        continue
                    rohwert = zeile[i].strip().replace(",", ".")
                    try:
                        wert = float(rohwert)
                    except ValueError:
                        continue
                    if 0 < wert < 150 and (hoechste is None or wert > hoechste):
                        hoechste = wert
            return hoechste
    except OSError:
        return None


# ------------------------------------------------------------ Gesamtaufnahme

def hardware_erfassen(zentimings_export=None, hwinfo_csv=None):
    """Fasst alles zusammen, was über das System bekannt ist."""
    module = module_auslesen()
    bestueckung = bestueckung_bewerten(module)

    hersteller = module[0]["hersteller"] if module else ""
    teilenummer = module[0]["teilenummer"] if module else ""
    chip, sicherheit = profiles.chip_erkennen(hersteller, teilenummer)

    aufnahme = {
        "prozessor": system.prozessorname(),
        "module": module,
        "bestueckung": bestueckung,
        "chip": chip,
        "chip_name": profiles.CHIPS[chip]["name"],
        "chip_sicherheit": sicherheit,
        "chip_sicher": sicherheit == "sicher",
        "chip_hinweis": profiles.CHIPS[chip]["hinweis"],
        "ist_zustand": None,
        "dram_temperatur": None,
    }

    if zentimings_export:
        aufnahme["ist_zustand"] = zentimings_lesen(zentimings_export)
    if hwinfo_csv:
        aufnahme["dram_temperatur"] = hwinfo_temperatur(hwinfo_csv)

    return aufnahme
