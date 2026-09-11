"""Die Leiter: welche Einstellung als Nächstes probiert wird.

Jede Runde kostet einen Neustart, eine BIOS-Eingabe und die Testzeit - eine
Runde ist also teuer. Die Suche ist deshalb nicht stur, sondern nach Ertrag
sortiert und halbiert ihre Schrittweite:

  1. Ein Timing wird um die Startschrittweite verschärft und getestet.
  2. Bestanden  -> im selben Schritt weiter, das Timing hat noch Luft.
  3. Fehler     -> zurück auf den letzten stabilen Wert, Schrittweite halbieren
                   und erneut versuchen. Unterschreitet die Schrittweite das
                   Mindestmaß, gilt das Timing als ausgereizt.

Dadurch braucht ein Timing typischerweise vier bis sechs Runden statt zwanzig,
und der gefundene Wert liegt trotzdem dicht an der Grenze.

Abgearbeitet wird nach Hebelwirkung: erst das, was für 1%-Perzentile viel
bringt (tRFC, tREFI, die SCL-Timings), zuletzt das Beiwerk.
"""

from . import config, profiles
from .state import BESTANDEN

# Startschrittweite und Mindestschrittweite je Timing.
SCHRITTE = {
    "tCL": (2, 2), "tRCD": (2, 1), "tRP": (2, 1), "tRAS": (4, 2), "tRC": (4, 2),
    "tRFC": (48, 8), "tRFC2": (32, 8), "tRFCsb": (24, 8),
    "tREFI": (8000, 2000),
    "tRRD_S": (1, 1), "tRRD_L": (2, 1), "tFAW": (4, 2),
    "tWTR_S": (1, 1), "tWTR_L": (2, 1), "tWR": (8, 4), "tRTP": (2, 1),
    "tRDRDSCL": (1, 1), "tWRWRSCL": (1, 1), "tRDWR": (2, 1), "tWRRD": (1, 1),
    "tRDRDSD": (1, 1), "tRDRDDD": (1, 1), "tWRWRSD": (1, 1), "tWRWRDD": (1, 1),
}

# Wie gründlich gesucht wird: Mindest-Hebelwirkung der behandelten Timings.
UMFANG = {
    "schnell": 4,      # nur die großen Hebel, rund ein Tag
    "gruendlich": 2,   # der sinnvolle Normalfall
    "vollstaendig": 1, # auch das Beiwerk
}

# Timings, die gemeinsam bewegt werden - einzeln bringen sie nichts.
GEKOPPELT = {
    "tRCD": ["tRP"],          # laufen auf AM5 praktisch immer im Gleichschritt
    "tRDRDSCL": ["tWRWRSCL"], # die Gemeinde setzt beide gleich
}


def timing_reihenfolge(umfang="gruendlich"):
    """Alle behandelten Timings, sortiert nach Abschnitt und Hebelwirkung."""
    mindesthebel = UMFANG.get(umfang, 2)
    geplant = []
    for abschnitt in profiles.ABSCHNITTE:
        kandidaten = [
            (name, regel) for name, regel in profiles.TIMINGS.items()
            if regel["stufe"] == abschnitt and regel["hebel"] >= mindesthebel
        ]
        # Innerhalb eines Abschnitts zuerst der größte Hebel.
        kandidaten.sort(key=lambda paar: -paar[1]["hebel"])
        for name, _ in kandidaten:
            # Mitgekoppelte Timings tauchen nicht eigenständig auf.
            if any(name in partner for partner in GEKOPPELT.values()):
                continue
            geplant.append(name)
    return geplant


def trefi_obergrenze(temperatur):
    """Deckelt tREFI nach der Modultemperatur.

    Das ist keine Vorsicht um der Vorsicht willen: Ein zu hohes tREFI bei zu
    warmem Speicher erzeugt Datenfehler, die kein Stresstest sichtbar macht.
    Ohne Temperaturmessung bleibt das Cockpit beim Ausgangswert.
    """
    if temperatur is None:
        return 40000, ("Ohne Temperaturmessung bleibt tREFI bei 40000. "
                       "Mit HWiNFO-Protokoll wird hier mehr möglich.")
    grenzen = config.TEMPERATUR
    if temperatur < grenzen["trefi_voll"]:
        return 65535, f"Speicher bei {temperatur:.0f} °C - tREFI darf ans Maximum."
    if temperatur < grenzen["trefi_gedeckelt"]:
        return 50000, f"Speicher bei {temperatur:.0f} °C - tREFI bis 50000."
    if temperatur < grenzen["trefi_notfall"]:
        return 40000, f"Speicher bei {temperatur:.0f} °C - tREFI bleibt bei 40000."
    return 32768, (
        f"Speicher bei {temperatur:.0f} °C - zu warm. tREFI wird zurückgenommen; "
        "sinnvoller als jede Timing-Feinarbeit wäre hier ein Lüfter über den Modulen."
    )


class Leiter:
    """Hält den Suchfortschritt und liefert den jeweils nächsten Kandidaten."""

    def __init__(self, zustand, laufbuch, umfang="gruendlich", temperatur=None):
        self.zustand = zustand
        self.laufbuch = laufbuch
        self.umfang = umfang
        self.temperatur = temperatur
        self.reihenfolge = timing_reihenfolge(umfang)
        # Fortschritt lebt im Zustand, damit er Neustarts übersteht.
        self.fortschritt = (zustand.hardware or {}).get("leiter") or {}

    # ------------------------------------------------------------ Hilfsmittel

    def _fortschritt_sichern(self):
        if self.zustand.hardware is None:
            self.zustand.hardware = {}
        self.zustand.hardware["leiter"] = self.fortschritt
        self.zustand.speichern()

    def _eintrag(self, timing):
        if timing not in self.fortschritt:
            start, mindest = SCHRITTE.get(timing, (1, 1))
            self.fortschritt[timing] = {
                "schritt": start, "mindestschritt": mindest,
                "fertig": False, "versuche": 0,
            }
        return self.fortschritt[timing]

    def _grenze(self, timing, basiswert):
        """Untergrenze eines Timings - aus Regelwerk, Chip und Temperatur."""
        regel = profiles.TIMINGS[timing]
        chip = profiles.CHIPS.get(self.zustand.hardware.get("chip", "unbekannt"),
                                  profiles.CHIPS["unbekannt"])
        mclk = (self.zustand.letzter_stabiler or {}).get("mclk", 6000)

        if timing == "tREFI":
            return trefi_obergrenze(self.temperatur)[0]
        if timing == "tRFC":
            return profiles.trfc_takte(chip["trfc_ns"][0], mclk)
        if timing == "tCL":
            return max(regel["min"], int(chip["cl_untergrenze"] * mclk / 6000.0))
        if timing in ("tRCD", "tRP"):
            return max(regel["min"], int(chip["rcd_untergrenze"] * mclk / 6000.0))
        return regel["min"]

    # -------------------------------------------------------- Nächster Schritt

    def naechster_kandidat(self):
        """Liefert (kandidat, begruendung) oder (None, Abschlussgrund)."""
        basis = self.zustand.letzter_stabiler
        if not basis:
            return None, "Es gibt noch keine stabile Ausgangseinstellung."

        for timing in self.reihenfolge:
            eintrag = self._eintrag(timing)
            if eintrag["fertig"]:
                continue

            aktuell = basis["timings"].get(timing)
            if aktuell is None:
                eintrag["fertig"] = True
                continue

            regel = profiles.TIMINGS[timing]
            grenze = self._grenze(timing, aktuell)
            schritt = eintrag["schritt"]

            # Richtung: die meisten Timings werden kleiner, tREFI wird größer.
            if regel["richtung"] < 0:
                neuer_wert = aktuell - schritt
                ausgereizt = neuer_wert < grenze
            else:
                neuer_wert = aktuell + schritt
                ausgereizt = neuer_wert > grenze

            if ausgereizt:
                # Feiner werden, statt aufzugeben.
                if schritt > eintrag["mindestschritt"]:
                    eintrag["schritt"] = max(eintrag["mindestschritt"], schritt // 2)
                    self._fortschritt_sichern()
                    return self.naechster_kandidat()
                eintrag["fertig"] = True
                self._fortschritt_sichern()
                continue

            kandidat = self._kandidat_bauen(basis, timing, neuer_wert)
            if kandidat is None:
                eintrag["fertig"] = True
                self._fortschritt_sichern()
                continue

            if self.laufbuch.schon_versucht(kandidat):
                eintrag["fertig"] = True
                self._fortschritt_sichern()
                continue

            eintrag["versuche"] += 1
            self._fortschritt_sichern()

            partner = GEKOPPELT.get(timing, [])
            begruendung = (
                f"{timing}: {aktuell} -> {neuer_wert}"
                + (f" (mit {', '.join(partner)})" if partner else "")
                + f". {regel['text']}"
            )
            return kandidat, begruendung

        return None, "Alle vorgesehenen Timings sind ausgereizt."

    def _kandidat_bauen(self, basis, timing, wert):
        """Erzeugt den neuen Kandidaten und prüft ihn gegen die Regeln."""
        timings = dict(basis["timings"])
        timings[timing] = wert

        # Mitgekoppelte Timings gleich mitziehen.
        for partner in GEKOPPELT.get(timing, []):
            if partner in timings:
                timings[partner] = wert

        # tRC hängt an tRAS und tRP und wird automatisch nachgezogen.
        if timing in ("tRAS", "tRP") and "tRC" in timings:
            mindest = timings.get("tRAS", 0) + timings.get("tRP", 0)
            if timings["tRC"] < mindest:
                timings["tRC"] = mindest

        # tRFC2 und tRFCsb folgen tRFC im festen Verhältnis.
        if timing == "tRFC":
            if "tRFC2" in timings:
                timings["tRFC2"] = int(wert * 0.62)
            if "tRFCsb" in timings:
                timings["tRFCsb"] = int(wert * 0.42)

        if profiles.abhaengigkeiten_pruefen(timings):
            return None

        return {
            "id": f"r{self.zustand.runde + 1:03d}",
            "mclk": basis["mclk"],
            "fclk": basis["fclk"],
            "timings": timings,
            "spannungen": dict(basis.get("spannungen", {})),
            "herkunft": f"{timing} verschärft",
            "eltern": basis.get("id"),
        }

    # ---------------------------------------------------------- Rückmeldung

    def ergebnis_verarbeiten(self, kandidat, ergebnis):
        """Nimmt das Testergebnis auf und stellt die Schrittweite nach."""
        timing = (kandidat.get("herkunft") or "").split(" ")[0]
        if timing not in self.fortschritt:
            return

        eintrag = self.fortschritt[timing]
        if ergebnis == BESTANDEN:
            # Hat gehalten - Schrittweite bleibt, es geht weiter.
            pass
        else:
            # Zu weit gegangen: feiner nachfassen, sonst Timing abschließen.
            if eintrag["schritt"] > eintrag["mindestschritt"]:
                eintrag["schritt"] = max(eintrag["mindestschritt"], eintrag["schritt"] // 2)
            else:
                eintrag["fertig"] = True
        self._fortschritt_sichern()

    # ------------------------------------------------------------- Übersicht

    def stand(self):
        offen = [t for t in self.reihenfolge if not self.fortschritt.get(t, {}).get("fertig")]
        fertig = [t for t in self.reihenfolge if self.fortschritt.get(t, {}).get("fertig")]
        return {
            "gesamt": len(self.reihenfolge),
            "fertig": len(fertig),
            "offen": offen,
            "naechstes": offen[0] if offen else None,
        }


# ----------------------------------------------------- Taktstufen (MCLK)

def naechste_taktstufe(aktueller_mclk, bestueckung):
    """Der nächste Schritt auf der Taktleiter, oder None am Ende."""
    leiter = (config.MCLK_LEITER_2X32 if bestueckung.get("dual_rank")
              else config.MCLK_LEITER_2X16)
    for takt in leiter:
        if takt > aktueller_mclk:
            return takt
    return None


# -------------------------------------------------- Anleitung fürs BIOS

def bios_anleitung(neu, alt=None):
    """Nur die Felder, die sich ändern - alles andere bleibt stehen.

    Das ist der eine Handgriff pro Runde, der nicht zu automatisieren ist,
    deshalb soll er so kurz wie möglich sein.
    """
    zeilen = []
    alt = alt or {}

    if alt.get("mclk") != neu.get("mclk"):
        zeilen.append(("DRAM Frequency", f"DDR5-{neu['mclk']}", "OC Tweaker"))
    if alt.get("fclk") != neu.get("fclk"):
        zeilen.append(("FCLK Frequency", f"{neu['fclk']} MHz", "OC Tweaker"))

    alte_timings = alt.get("timings", {})
    for name, wert in neu.get("timings", {}).items():
        if alte_timings.get(name) != wert:
            regel = profiles.TIMINGS.get(name, {})
            zeilen.append((
                regel.get("agesa", name), str(wert),
                f"DRAM Timing Configuration ({name})",
            ))

    alte_spannungen = alt.get("spannungen", {})
    for name, wert in neu.get("spannungen", {}).items():
        if alte_spannungen.get(name) != wert:
            beschreibung = config.SPANNUNGEN.get(name, {})
            zeilen.append((
                beschreibung.get("name", name), f"{wert:.3f} V", "Voltage Configuration",
            ))

    return zeilen


def spannungen_pruefen(spannungen):
    """Warnt, bevor eine Spannung eingetippt wird, die Hardware kostet."""
    warnungen = []
    for name, wert in (spannungen or {}).items():
        grenze = config.SPANNUNGEN.get(name)
        if not grenze:
            continue
        if wert >= grenze["stop"]:
            warnungen.append(
                f"STOPP: {grenze['name']} = {wert:.3f} V erreicht die harte Grenze "
                f"von {grenze['stop']} V. {grenze['hinweis']}"
            )
        elif wert >= grenze["warn"]:
            warnungen.append(
                f"Achtung: {grenze['name']} = {wert:.3f} V liegt über dem "
                f"empfohlenen Alltagswert von {grenze['warn']} V. {grenze['hinweis']}"
            )
    return warnungen
