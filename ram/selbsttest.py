#!/usr/bin/env python3
"""Prüft die Logik des Cockpits ohne AM5-Hardware.

Getestet wird das, was ohne echten Speicher prüfbar ist und wo Fehler teuer
wären: die Regeln zwischen den Timings, die Suchstrategie, das Verhalten nach
einem Absturz und die Bewertung. Ein simulierter Speicher hat je Timing eine
verborgene Grenze - die Leiter muss sie finden, ohne sie zu überschreiten.

Aufruf:  python selbsttest.py
"""

import shutil
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ramtune import bench, config, detect, plan, profiles, report, state
from ramtune.state import ABGESTUERZT, BESTANDEN, FEHLER, Laufbuch, Zustand

BESTANDEN_ZAEHLER = {"ok": 0, "fehler": 0}


def pruefe(bedingung, beschreibung):
    if bedingung:
        BESTANDEN_ZAEHLER["ok"] += 1
        print(f"  [ok]     {beschreibung}")
    else:
        BESTANDEN_ZAEHLER["fehler"] += 1
        print(f"  [FEHLER] {beschreibung}")
    return bedingung


# ------------------------------------------------------ Simulierter Speicher

class SimulierterSpeicher:
    """Ein Speicher mit verborgenen Grenzen, wie ihn die Leiter vorfindet."""

    # Je Timing der gerade noch stabile Wert.
    GRENZEN = {
        "tCL": 28, "tRCD": 36, "tRP": 36, "tRAS": 30, "tRC": 66,
        "tRFC": 520, "tRFC2": 322, "tRFCsb": 218, "tREFI": 50000,
        "tRRD_S": 4, "tRRD_L": 8, "tFAW": 20,
        "tWTR_S": 4, "tWTR_L": 12, "tWR": 40, "tRTP": 10,
        "tRDRDSCL": 3, "tWRWRSCL": 3, "tRDWR": 16, "tWRRD": 3,
        "tRDRDSD": 6, "tRDRDDD": 6, "tWRWRSD": 6, "tWRWRDD": 6,
    }

    def __init__(self, absturz_ab=None):
        # Timings, deren Überschreitung nicht nur fehlschlägt, sondern das
        # System abstürzen lässt.
        self.absturz_ab = absturz_ab or {"tRFC": 480, "tCL": 26}

    def testen(self, kandidat):
        """Gibt (ergebnis, latenz_ns) zurück."""
        for name, wert in kandidat["timings"].items():
            grenze = self.GRENZEN.get(name)
            if grenze is None:
                continue
            richtung = profiles.TIMINGS.get(name, {}).get("richtung", -1)
            zu_scharf = wert < grenze if richtung < 0 else wert > grenze
            if zu_scharf:
                absturzgrenze = self.absturz_ab.get(name)
                if absturzgrenze is not None and wert < absturzgrenze:
                    return ABGESTUERZT, None
                return FEHLER, None
        return BESTANDEN, self._latenz(kandidat)

    def _latenz(self, kandidat):
        """Je schärfer die Timings, desto niedriger die Latenz."""
        t = kandidat["timings"]
        takt = kandidat["mclk"]
        grundlatenz = 78.0 * (6000.0 / takt)
        # Die großen Hebel wirken stärker als das Beiwerk.
        gewinn = (
            (40 - t.get("tCL", 40)) * 0.18
            + (46 - t.get("tRCD", 46)) * 0.12
            + (700 - t.get("tRFC", 700)) * 0.012
            + (t.get("tREFI", 32768) - 32768) * 0.00012
            + (6 - t.get("tRDRDSCL", 6)) * 0.55
        )
        return round(grundlatenz - gewinn, 2)


# ------------------------------------------------------------------ Prüfungen

def test_timingregeln():
    print("\nRegeln zwischen den Timings")

    satz = profiles.startsatz("hynix_m", 6000, dual_rank=True)
    pruefe(not profiles.abhaengigkeiten_pruefen(satz),
           "Startsatz Hynix M-die @6000 ist in sich stimmig")

    pruefe(satz["tRC"] >= satz["tRAS"] + satz["tRP"],
           "tRC ist mindestens tRAS + tRP")
    pruefe(satz["tCL"] % 2 == 0, "tCL ist gerade")
    pruefe(satz["tFAW"] >= 4 * satz["tRRD_S"], "tFAW ist mindestens 4 x tRRD_S")

    # Die DDR4-Regel tRAS >= tRCD + tRTP darf NICHT erzwungen werden - die
    # gängigen AM5-Sets laufen bewusst darunter (tRAS 30 bei tRCD 38).
    pruefe(satz["tRAS"] < satz["tRCD"] + satz["tRTP"],
           "tRAS liegt wie üblich unter tRCD + tRTP und gilt trotzdem als gültig")

    kaputt = dict(satz)
    kaputt["tRC"] = 40
    pruefe(profiles.abhaengigkeiten_pruefen(kaputt), "zu kleines tRC wird erkannt")

    kaputt = dict(satz)
    kaputt["tREFI"] = 90000
    pruefe(profiles.abhaengigkeiten_pruefen(kaputt), "tREFI über 65535 wird erkannt")

    for takt in (6000, 6200, 6400, 6600):
        satz = profiles.startsatz("hynix_a", takt, dual_rank=True)
        if not pruefe(not profiles.abhaengigkeiten_pruefen(satz),
                      f"Startsatz Hynix A-die @{takt} ist stimmig"):
            print(f"           {profiles.abhaengigkeiten_pruefen(satz)}")

    # tRFC muss über die Taktstufen hinweg in Nanosekunden konstant bleiben.
    ns_6000 = profiles.trfc_nanosekunden(profiles.startsatz("hynix_m", 6000)["tRFC"], 6000)
    ns_6400 = profiles.trfc_nanosekunden(profiles.startsatz("hynix_m", 6400)["tRFC"], 6400)
    pruefe(abs(ns_6000 - ns_6400) < 6,
           f"tRFC bleibt über Taktstufen hinweg gleich lang ({ns_6000:.0f} / {ns_6400:.0f} ns)")


def test_spannungsgrenzen():
    print("\nSpannungsgrenzen")
    pruefe(not plan.spannungen_pruefen({"vsoc": 1.15}), "1,15 V SoC gilt als unbedenklich")
    pruefe(plan.spannungen_pruefen({"vsoc": 1.27}), "1,27 V SoC wird angemahnt")
    warnungen = plan.spannungen_pruefen({"vsoc": 1.35})
    pruefe(warnungen and "STOPP" in warnungen[0], "1,35 V SoC wird hart gestoppt")
    pruefe(plan.spannungen_pruefen({"vdd": 1.50}), "1,50 V DRAM wird angemahnt")


def test_temperaturdeckel():
    print("\ntREFI nach Modultemperatur")
    pruefe(plan.trefi_obergrenze(42)[0] == 65535, "kühl: tREFI darf ans Maximum")
    pruefe(plan.trefi_obergrenze(55)[0] == 50000, "mittel: tREFI bis 50000")
    pruefe(plan.trefi_obergrenze(68)[0] == 32768, "heiß: tREFI wird zurückgenommen")
    pruefe(plan.trefi_obergrenze(None)[0] == 40000, "ohne Messung bleibt es beim Ausgangswert")
    pruefe(plan.trefi_obergrenze(42)[0] > plan.trefi_obergrenze(68)[0],
           "kühler Speicher erlaubt immer mehr als heißer")


def test_bewertung():
    print("\nBewertung")
    basis = {"latenz_ns": 72.0, "bandbreite_mbs": 62000}
    pruefe(bench.punkte_berechnen(basis, basis, "spiele") == 100.0,
           "die Ausgangsmessung selbst ergibt genau 100 Punkte")

    besser = bench.punkte_berechnen({"latenz_ns": 62.0, "bandbreite_mbs": 64000}, basis, "spiele")
    schlechter = bench.punkte_berechnen({"latenz_ns": 80.0, "bandbreite_mbs": 60000}, basis, "spiele")
    pruefe(besser > 100 > schlechter, "besser ergibt mehr, schlechter weniger als 100")

    # Für Spiele muss Latenz schwerer wiegen als Bandbreite.
    nur_latenz = bench.punkte_berechnen({"latenz_ns": 62.0, "bandbreite_mbs": 62000}, basis, "spiele")
    nur_bandbreite = bench.punkte_berechnen({"latenz_ns": 72.0, "bandbreite_mbs": 72000}, basis, "spiele")
    pruefe(nur_latenz > nur_bandbreite,
           "beim Ziel 'Spiele' wiegt weniger Latenz schwerer als mehr Bandbreite")

    anwendung = bench.punkte_berechnen({"latenz_ns": 72.0, "bandbreite_mbs": 72000}, basis, "anwendung")
    pruefe(anwendung > nur_bandbreite,
           "beim Ziel 'Anwendung' zählt dieselbe Bandbreite mehr")

    pruefe(bench.punkte_berechnen({}, None) is None, "ohne Ausgangsmessung keine Punkte")


def test_bestueckung():
    print("\nBestückung")
    gut = detect.bestueckung_bewerten([
        {"kapazitaet_gb": 32, "steckplatz": "DIMM A2"},
        {"kapazitaet_gb": 32, "steckplatz": "DIMM B2"},
    ])
    pruefe(gut["dual_rank"] and gut["gesamt_gb"] == 64, "2x32 GB wird als Doppelrang erkannt")
    pruefe(not gut["warnungen"], "A2/B2 gibt keine Warnung")

    falsch = detect.bestueckung_bewerten([
        {"kapazitaet_gb": 32, "steckplatz": "DIMM A1"},
        {"kapazitaet_gb": 32, "steckplatz": "DIMM B1"},
    ])
    pruefe(any("A2 und B2" in w for w in falsch["warnungen"]),
           "A1/B1 wird als falsche Steckplätze gemeldet")

    vier = detect.bestueckung_bewerten([{"kapazitaet_gb": 16, "steckplatz": f"DIMM {s}"}
                                        for s in ("A1", "A2", "B1", "B2")])
    pruefe(vier["korridor"] == "schwierig" and vier["warnungen"],
           "vier Module werden als schwieriger Fall gekennzeichnet")


def test_zentimings_parser():
    print("\nZenTimings-Auswertung")
    with tempfile.TemporaryDirectory() as ordner:
        datei = Path(ordner) / "zen.txt"
        datei.write_text(
            "Frequency: 3000 MHz\nFCLK: 2000\nUCLK: 3000\n"
            "CL: 30\ntRCD: 36\ntRP: 36\ntRAS: 30\ntRC: 66\n"
            "tRFC: 520\ntREFI: 50000\ntRDRDSCL: 3\n"
            "VSOC: 1.150\nVDD: 1.400\n", encoding="utf-8")
        gelesen = detect.zentimings_lesen(datei)

    pruefe(gelesen is not None, "Export wird gelesen")
    pruefe(gelesen["mclk"] == 6000, "3000 MHz Speichertakt werden zu DDR5-6000")
    pruefe(gelesen["timings"]["tCL"] == 30, "tCL wird erkannt")
    pruefe(gelesen["timings"]["tRDRDSCL"] == 3, "tRDRDSCL wird erkannt")
    pruefe(abs(gelesen["spannungen"]["vsoc"] - 1.15) < 0.001, "VSOC wird erkannt")
    pruefe(detect.zentimings_lesen(Path("/gibt/es/nicht.txt")) is None,
           "fehlende Datei ergibt kein Ergebnis statt eines Absturzes")


def test_hwinfo_parser():
    print("\nHWiNFO-Auswertung")
    with tempfile.TemporaryDirectory() as ordner:
        datei = Path(ordner) / "hwinfo.csv"
        datei.write_text(
            "Time,CPU [°C],DIMM 1 Temperature [°C],DIMM 2 Temperature [°C]\n"
            "10:00,65,44.5,46.0\n10:01,66,45.0,52.5\n", encoding="utf-8")
        pruefe(detect.hwinfo_temperatur(datei) == 52.5,
               "höchste Modultemperatur wird gefunden (52,5 °C)")


def test_leiter_findet_grenzen():
    """Der eigentliche Test: Konvergiert die Suche gegen die verborgenen Grenzen?"""
    print("\nSuchstrategie gegen einen simulierten Speicher")

    ordner = Path(tempfile.mkdtemp())
    alte_pfade = (config.ZUSTAND, config.LAEUFE)
    config.ZUSTAND = ordner / "zustand.json"
    config.LAEUFE = ordner / "laeufe.json"

    try:
        speicher = SimulierterSpeicher()
        zustand = Zustand()
        zustand.ziel = "spiele"
        zustand.basis = {"latenz_ns": 78.0, "bandbreite_mbs": 62000}
        zustand.hardware = {"chip": "hynix_m",
                            "bestueckung": {"dual_rank": True, "gesamt_gb": 64}}
        start = {
            "id": "r000", "mclk": 6000, "fclk": 2000,
            "timings": profiles.startsatz("hynix_m", 6000, True),
            "spannungen": {"vsoc": 1.15, "vdd": 1.40},
            "herkunft": "Startsatz", "eltern": None,
        }
        ergebnis, latenz = speicher.testen(start)
        pruefe(ergebnis == BESTANDEN,
               "der Startsatz aus der Wissensbasis läuft auf dem Simulator stabil")

        zustand.letzter_stabiler = start
        zustand.speichern()
        laufbuch = Laufbuch()
        laufbuch.anhaengen({"kandidat": start, "stufe": "sichtung",
                            "ergebnis": BESTANDEN,
                            "messwerte": {"latenz_ns": latenz, "bandbreite_mbs": 62000},
                            "punkte": bench.punkte_berechnen(
                                {"latenz_ns": latenz, "bandbreite_mbs": 62000},
                                zustand.basis, "spiele")})

        leiter = plan.Leiter(zustand, laufbuch, "gruendlich", temperatur=46.0)

        abstuerze = 0
        runden = 0
        while runden < 400:
            kandidat, _ = leiter.naechster_kandidat()
            if kandidat is None:
                break
            runden += 1
            zustand.runde += 1

            ergebnis, latenz = speicher.testen(kandidat)
            if ergebnis == ABGESTUERZT:
                abstuerze += 1

            messwerte = ({"latenz_ns": latenz, "bandbreite_mbs": 62000}
                         if latenz else None)
            punkte = (bench.punkte_berechnen(messwerte, zustand.basis, "spiele")
                      if messwerte else None)
            laufbuch.anhaengen({"kandidat": kandidat, "stufe": "sichtung",
                                "ergebnis": ergebnis, "messwerte": messwerte,
                                "punkte": punkte})

            if ergebnis == BESTANDEN:
                zustand.letzter_stabiler = kandidat
            leiter.ergebnis_verarbeiten(kandidat, ergebnis)

        pruefe(runden < 400, f"die Suche endet von selbst (nach {runden} Runden)")
        pruefe(runden < 90, f"die Suche bleibt bezahlbar ({runden} Runden)")

        endstand = zustand.letzter_stabiler["timings"]
        print(f"\n    gefunden: tCL {endstand['tCL']} (Grenze {speicher.GRENZEN['tCL']}), "
              f"tRCD {endstand['tRCD']} ({speicher.GRENZEN['tRCD']}), "
              f"tRFC {endstand['tRFC']} ({speicher.GRENZEN['tRFC']}), "
              f"tREFI {endstand['tREFI']} ({speicher.GRENZEN['tREFI']}), "
              f"SCL {endstand['tRDRDSCL']} ({speicher.GRENZEN['tRDRDSCL']})\n")

        # Nichts darf unter der wahren Grenze liegen: das wäre eine instabile
        # Einstellung, die das Cockpit für stabil hält.
        zu_scharf = [
            name for name, wert in endstand.items()
            if name in speicher.GRENZEN
            and (wert < speicher.GRENZEN[name]
                 if profiles.TIMINGS.get(name, {}).get("richtung", -1) < 0
                 else wert > speicher.GRENZEN[name])
        ]
        pruefe(not zu_scharf, f"das Endergebnis ist wirklich stabil (kritisch: {zu_scharf})")

        # Und sie muss nah genug herankommen, sonst war die Mühe umsonst.
        pruefe(endstand["tCL"] <= speicher.GRENZEN["tCL"] + 2,
               f"tCL kommt an die Grenze heran ({endstand['tCL']} vs. {speicher.GRENZEN['tCL']})")
        pruefe(endstand["tRFC"] <= speicher.GRENZEN["tRFC"] + 48,
               f"tRFC kommt an die Grenze heran ({endstand['tRFC']} vs. {speicher.GRENZEN['tRFC']})")
        pruefe(endstand["tRDRDSCL"] <= speicher.GRENZEN["tRDRDSCL"] + 1,
               f"tRDRDSCL kommt an die Grenze heran ({endstand['tRDRDSCL']})")
        pruefe(endstand["tREFI"] >= speicher.GRENZEN["tREFI"] - 8000,
               f"tREFI kommt an die Grenze heran ({endstand['tREFI']})")

        bester = laufbuch.bester()
        pruefe(bester is not None and bester["punkte"] > 100,
               f"das Ergebnis ist messbar besser als EXPO ({bester['punkte']:.1f} Punkte)")
        pruefe(all(profiles.abhaengigkeiten_pruefen(e["kandidat"]["timings"]) == []
                   for e in laufbuch.eintraege),
               "kein einziger Vorschlag verletzte die Timing-Regeln")

        gescheitert = [e for e in laufbuch.eintraege if e["ergebnis"] != BESTANDEN]
        print(f"    {len(laufbuch.bestandene())} stabil, {len(gescheitert)} verworfen, "
              f"davon {abstuerze} Abstürze")

        # Der Bericht muss sich aus echten Daten erzeugen lassen.
        config.BERICHT = ordner / "bericht.html"
        pfad = report.erzeugen(zustand, laufbuch, zustand.hardware, config.BERICHT)
        inhalt = pfad.read_text(encoding="utf-8")
        pruefe(len(inhalt) > 2000, "der HTML-Bericht entsteht")
        pruefe("Diese Werte ins BIOS" in inhalt, "der Bericht enthält die BIOS-Anleitung")
        pruefe("<script" not in inhalt.lower(), "der Bericht kommt ohne Skripte aus")

    finally:
        config.ZUSTAND, config.LAEUFE = alte_pfade
        shutil.rmtree(ordner, ignore_errors=True)


def test_absturz_ueberlebt_neustart():
    print("\nVerhalten nach einem Absturz")

    ordner = Path(tempfile.mkdtemp())
    alte_pfade = (config.ZUSTAND, config.LAEUFE)
    config.ZUSTAND = ordner / "zustand.json"
    config.LAEUFE = ordner / "laeufe.json"

    try:
        zustand = Zustand()
        kandidat = {"id": "r007", "mclk": 6000, "fclk": 2000,
                    "timings": {"tCL": 26}, "spannungen": {},
                    "herkunft": "tCL verschärft"}
        stabil = {"id": "r006", "mclk": 6000, "fclk": 2000,
                  "timings": {"tCL": 28}, "spannungen": {}}
        zustand.letzter_stabiler = stabil
        zustand.kandidat_setzen(kandidat, "sichtung")
        zustand.test_beginnt()

        # Hier stürzt das System ab. Der Zustand liegt bereits auf der Platte.
        neu_geladen = Zustand.laden()
        pruefe(neu_geladen.phase == state.LAEUFT,
               "der offene Lauf ist nach dem Neustart noch vermerkt")
        pruefe(neu_geladen.kandidat["id"] == "r007",
               "der abgestürzte Kandidat ist bekannt")
        pruefe(neu_geladen.letzter_stabiler["id"] == "r006",
               "der Rückfallpunkt ist erhalten")

        spaeter = datetime.now() + timedelta(minutes=5)
        pruefe(state.absturz_erkennen(neu_geladen, spaeter),
               "ein Start nach dem Testbeginn wird als Absturz erkannt")

        frueher = datetime.now() - timedelta(hours=3)
        pruefe(not state.absturz_erkennen(neu_geladen, frueher),
               "ein Start vor dem Testbeginn ist kein Absturz")

        fertig = Zustand.laden()
        fertig.runde_beenden()
        pruefe(not state.absturz_erkennen(Zustand.laden(), spaeter),
               "eine abgeschlossene Runde gilt nicht mehr als Absturz")

        # Beschädigte Zustandsdatei darf nicht zum Absturz des Programms führen.
        config.ZUSTAND.write_text("{kaputt", encoding="utf-8")
        pruefe(Zustand.laden().phase == state.LEER,
               "eine beschädigte Zustandsdatei wird verkraftet")

    finally:
        config.ZUSTAND, config.LAEUFE = alte_pfade
        shutil.rmtree(ordner, ignore_errors=True)


def test_bios_anleitung():
    print("\nBIOS-Anleitung")
    alt = {"mclk": 6000, "fclk": 2000, "timings": {"tCL": 30, "tRCD": 38, "tRFC": 600},
           "spannungen": {"vsoc": 1.15}}
    neu = {"mclk": 6000, "fclk": 2000, "timings": {"tCL": 28, "tRCD": 38, "tRFC": 600},
           "spannungen": {"vsoc": 1.15}}
    zeilen = plan.bios_anleitung(neu, alt)
    pruefe(len(zeilen) == 1, "nur das eine geänderte Feld wird genannt")
    pruefe(zeilen[0][0] == "Tcl", "der Feldname entspricht der BIOS-Bezeichnung (Tcl)")
    pruefe(zeilen[0][1] == "28", "der neue Wert steht dabei")

    alle = plan.bios_anleitung(neu)
    pruefe(len(alle) > len(zeilen), "ohne Vorgänger werden alle Felder genannt")


def test_kandidat_kennung():
    print("\nWiedererkennung von Einstellungen")
    a = {"mclk": 6000, "fclk": 2000, "timings": {"tCL": 30, "tRCD": 36}, "spannungen": {}}
    b = {"mclk": 6000, "fclk": 2000, "timings": {"tRCD": 36, "tCL": 30}, "spannungen": {}}
    c = {"mclk": 6000, "fclk": 2000, "timings": {"tCL": 28, "tRCD": 36}, "spannungen": {}}
    pruefe(state.kandidat_kennung(a) == state.kandidat_kennung(b),
           "dieselbe Einstellung wird trotz anderer Reihenfolge erkannt")
    pruefe(state.kandidat_kennung(a) != state.kandidat_kennung(c),
           "eine andere Einstellung bekommt eine andere Kennung")


def main():
    print("=" * 68)
    print("  RamTune - Selbsttest (ohne Hardware)")
    print("=" * 68)

    test_timingregeln()
    test_spannungsgrenzen()
    test_temperaturdeckel()
    test_bewertung()
    test_bestueckung()
    test_zentimings_parser()
    test_hwinfo_parser()
    test_bios_anleitung()
    test_kandidat_kennung()
    test_absturz_ueberlebt_neustart()
    test_leiter_findet_grenzen()

    print("\n" + "=" * 68)
    gesamt = BESTANDEN_ZAEHLER["ok"] + BESTANDEN_ZAEHLER["fehler"]
    print(f"  {BESTANDEN_ZAEHLER['ok']} von {gesamt} Prüfungen bestanden")
    print("=" * 68)
    return 1 if BESTANDEN_ZAEHLER["fehler"] else 0


if __name__ == "__main__":
    sys.exit(main())
