#!/usr/bin/env python3
"""RamTune - Speicherabstimmung für AM5 (Ryzen 9000) begleiten.

Aufruf:
    python ramtune.py pruefen     Werkzeuge und Hardware ansehen, nichts ändern
    python ramtune.py start       Vorgang beginnen (misst zuerst EXPO als Bezug)
    python ramtune.py weiter      nach jedem Neustart: auswerten und weiterplanen
    python ramtune.py bericht     HTML-Bericht erzeugen und öffnen
    python ramtune.py rettung     letzte stabile Einstellung ausgeben
    python ramtune.py autostart   nach dem Anmelden selbst weitermachen

Der einzige Handgriff, den dieses Programm nicht übernehmen kann, ist die
Eingabe im BIOS: Auf AM5 lassen sich Timings nicht aus Windows heraus setzen.
Alles davor und danach macht es selbst.
"""

import argparse
import sys
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ramtune import (bench, config, detect, plan, profiles, report, state,
                     stress, system, tools)
from ramtune.state import (ABGESTUERZT, AUSGEWERTET, BESTANDEN, FEHLER, LAEUFT,
                           Laufbuch, WARTET_AUF_BIOS, Zustand)

TRENNER = "-" * 68


def kopf(text):
    print(f"\n{TRENNER}\n  {text}\n{TRENNER}")


# --------------------------------------------------------------- Prüfen

def befehl_pruefen(args):
    kopf("Bestandsaufnahme")

    bestand = tools.bestandsaufnahme()
    print("\n  Werkzeuge:")
    for schluessel, werkzeug in bestand.items():
        zeichen = "[ja]" if werkzeug["vorhanden"] else ("[FEHLT]" if werkzeug["pflicht"] else "[-]")
        print(f"    {zeichen:8} {werkzeug['name']}")
        if not werkzeug["vorhanden"]:
            print(f"             {werkzeug['zweck']}")
            print(f"             {werkzeug['quelle']} ({werkzeug['kosten']})")

    fehlend = tools.fehlende_pflicht(bestand)
    if fehlend:
        print(f"\n  Ohne {', '.join(bestand[s]['name'] for s in fehlend)} kann das "
              "Cockpit nicht messen oder testen.")
        print("  Die Programme irgendwo ablegen und den Ordner unter")
        print(f"  {config.WURZEL / 'werkzeuge'} bekannt machen.")

    if not system.ist_windows():
        print("\n  Hinweis: Dies ist kein Windows. Auslesen und Testen sind hier "
              "nicht möglich, die Planung lässt sich aber durchspielen.")
        return 0

    hardware = detect.hardware_erfassen(args.zentimings, args.hwinfo)
    print(f"\n  Prozessor: {hardware['prozessor']}")
    bestueckung = hardware["bestueckung"]
    print(f"  Speicher:  {bestueckung['art']}, {bestueckung['gesamt_gb']} GB, "
          f"{'Doppelrang' if bestueckung['dual_rank'] else 'Einzelrang'}")
    print(f"  Chips:     {hardware['chip_name']}"
          + ("" if hardware["chip_sicher"] else "  (mit Thaiphoon Burner genauer bestimmbar)"))

    for modul in hardware["module"]:
        print(f"    - {modul['steckplatz'] or '?'}: {modul['kapazitaet_gb']} GB "
              f"{modul['hersteller']} {modul['teilenummer']} @ {modul['aktuell_mts']} MT/s")

    for warnung in bestueckung["warnungen"]:
        print(f"\n  !! {warnung}")

    if hardware["dram_temperatur"]:
        grenze, hinweis = plan.trefi_obergrenze(hardware["dram_temperatur"])
        print(f"\n  Modultemperatur: {hardware['dram_temperatur']:.0f} °C - {hinweis}")

    if hardware["ist_zustand"]:
        ist = hardware["ist_zustand"]
        print(f"\n  Aktuell anliegend: DDR5-{ist.get('mclk')} "
              f"{'-'.join(str(ist['timings'].get(n, '?')) for n in ('tCL','tRCD','tRP','tRAS'))}")
    else:
        print("\n  Keine ZenTimings-Ausgabe angegeben - die tatsächlich anliegenden "
              "Timings sind daher unbekannt.")
        print("  Mit: python ramtune.py pruefen --zentimings <Datei>")

    return 0


# ---------------------------------------------------------------- Start

def befehl_start(args):
    kopf("Vorgang beginnen")

    zustand = Zustand.laden()
    if zustand.phase != state.LEER and not args.neu:
        print(f"\n  Es läuft bereits ein Vorgang (Runde {zustand.runde}, Phase "
              f"{zustand.phase}).")
        print("  Fortsetzen mit: python ramtune.py weiter")
        print("  Neu beginnen mit: python ramtune.py start --neu")
        return 1

    if args.neu:
        for datei in (config.ZUSTAND, config.LAEUFE):
            if datei.exists():
                datei.unlink()
        zustand = Zustand.laden()

    fehlend = tools.fehlende_pflicht()
    if fehlend and not args.ohne_werkzeuge:
        print("\n  Es fehlen Pflichtwerkzeuge. Erst 'pruefen' ausführen.")
        return 1

    hardware = detect.hardware_erfassen(args.zentimings, args.hwinfo)
    zustand.hardware = hardware
    zustand.ziel = args.ziel
    zustand.bestueckung = "2x32" if hardware["bestueckung"]["dual_rank"] else "2x16"

    for warnung in hardware["bestueckung"]["warnungen"]:
        print(f"\n  !! {warnung}")

    # Ausgangsmessung: ohne sie ist später kein Vergleich möglich.
    print("\n  Ausgangsmessung mit der jetzigen Einstellung (EXPO).")
    print("  Bitte nichts anderes am Rechner tun, das verfälscht die Werte.")
    system.energieplan_hoechstleistung()
    basis = bench.messen(melden=print)

    if not basis.get("latenz_ns") and not basis.get("bandbreite_mbs"):
        print(f"\n  {basis.get('hinweis', 'Messung fehlgeschlagen.')}")
        print("  Ohne Ausgangsmessung kann nichts verglichen werden - Abbruch.")
        return 1

    zustand.basis = basis
    print(f"\n  Ausgangswert: Latenz {basis.get('latenz_ns', 0):.1f} ns, "
          f"Bandbreite {basis.get('bandbreite_mbs', 0):.0f} MB/s")

    # Startkandidat aus der Wissensbasis.
    ist = hardware.get("ist_zustand") or {}
    mclk = ist.get("mclk") or 6000
    timings = profiles.startsatz(hardware["chip"], mclk,
                                 hardware["bestueckung"]["dual_rank"])
    startkandidat = {
        "id": "r000", "mclk": mclk, "fclk": config.FCLK["typisch"],
        "timings": timings, "spannungen": ist.get("spannungen", {}),
        "herkunft": "Startsatz aus der Wissensbasis", "eltern": None,
    }

    zustand.letzter_stabiler = startkandidat
    zustand.kandidat_setzen(startkandidat, "sichtung")
    zustand.speichern()

    _kandidat_ausgeben(startkandidat, ist, "sichtung", hardware)
    return 0


# --------------------------------------------------------------- Weiter

def befehl_weiter(args):
    zustand = Zustand.laden()
    laufbuch = Laufbuch()

    if zustand.phase == state.LEER:
        print("\n  Noch kein Vorgang begonnen: python ramtune.py start")
        return 1

    hardware = zustand.hardware or {}
    temperatur = None
    if args.hwinfo:
        temperatur = detect.hwinfo_temperatur(args.hwinfo)
    leiter = plan.Leiter(zustand, laufbuch, args.umfang, temperatur)

    # --- Fall 1: Der letzte Lauf hat das System umgebracht. -----------------
    if state.absturz_erkennen(zustand, system.letzter_start()):
        kopf("Der letzte Versuch hat das System zum Absturz gebracht")
        gescheitert = zustand.kandidat
        print(f"\n  {gescheitert.get('herkunft', 'unbekannte Änderung')} war zu viel.")
        laufbuch.anhaengen({
            "kandidat": gescheitert, "stufe": zustand.stufe,
            "ergebnis": ABGESTUERZT, "punkte": None, "messwerte": None,
            "hinweis": "System ist während des Tests abgestürzt oder neu gestartet.",
        })
        leiter.ergebnis_verarbeiten(gescheitert, ABGESTUERZT)
        zustand.runde_beenden()
        return _naechste_runde(zustand, laufbuch, leiter, hardware)

    # --- Fall 2: Werte sind gesetzt, jetzt wird getestet. -------------------
    if zustand.phase == WARTET_AUF_BIOS:
        kandidat = zustand.kandidat
        kopf(f"Runde {zustand.runde}: prüfen und testen")

        # Wurde im BIOS wirklich gesetzt, was vorgeschlagen war?
        if args.zentimings:
            ist = detect.zentimings_lesen(args.zentimings)
            abweichungen = _abweichungen(kandidat, ist)
            if abweichungen:
                print("\n  Die anliegenden Werte weichen vom Vorschlag ab:")
                for zeile in abweichungen[:8]:
                    print(f"    - {zeile}")
                print("\n  Wahrscheinlich hat das BIOS einen Wert nicht übernommen "
                      "(oder das Speichertraining hat ihn verworfen).")
                if not args.trotzdem:
                    print("  Mit --trotzdem wird dennoch getestet.")
                    return 1
        else:
            print("\n  Hinweis: ohne --zentimings kann nicht geprüft werden, ob das "
                  "BIOS die Werte übernommen hat.")

        zustand.test_beginnt()
        system.energieplan_hoechstleistung()

        ergebnis = stress.stufe_fahren(zustand.stufe, melden=print)

        messwerte = None
        punkte = None
        if ergebnis["ergebnis"] in (BESTANDEN, stress.UNSICHER):
            print("\n  Messung:")
            messwerte = bench.messen(melden=print)
            punkte = bench.punkte_berechnen(messwerte, zustand.basis, zustand.ziel)

        lauf = {
            "kandidat": kandidat, "stufe": zustand.stufe,
            "ergebnis": BESTANDEN if ergebnis["ergebnis"] == BESTANDEN else (
                FEHLER if ergebnis["ergebnis"] == stress.FEHLER else ergebnis["ergebnis"]),
            "test": ergebnis, "messwerte": messwerte, "punkte": punkte,
        }
        laufbuch.anhaengen(lauf)

        print(f"\n  Ergebnis: {ergebnis['ergebnis']}")
        print(f"  {ergebnis['whea_text']}")
        if messwerte:
            print(f"  {bench.vergleich_text(messwerte, zustand.basis)}")
            if punkte:
                print(f"  Punkte: {punkte:.1f} (100 = wie EXPO)")

        if lauf["ergebnis"] == BESTANDEN:
            # Nur übernehmen, wenn es auch schneller ist. Eine stabile, aber
            # langsamere Einstellung ist kein Fortschritt.
            vorher = zustand.letzter_stabiler
            besser = punkte is None or _ist_besser(punkte, vorher, laufbuch)
            if besser:
                zustand.stabil_vermerken(kandidat)
                print("  Als neuer Rückfallpunkt vermerkt.")
            else:
                print("  Stabil, aber nicht schneller - der bisherige Stand bleibt.")

        leiter.ergebnis_verarbeiten(kandidat, lauf["ergebnis"])
        zustand.runde_beenden()
        return _naechste_runde(zustand, laufbuch, leiter, hardware)

    # --- Fall 3: Runde abgeschlossen, nächster Vorschlag. -------------------
    return _naechste_runde(zustand, laufbuch, leiter, hardware)


def _ist_besser(punkte, vorheriger_kandidat, laufbuch):
    """Vergleicht mit der Punktzahl des bisherigen Rückfallpunkts."""
    if not vorheriger_kandidat:
        return True
    frueher = laufbuch.fuer_kandidat(vorheriger_kandidat.get("id"))
    bewertet = [e["punkte"] for e in frueher if e.get("punkte")]
    if not bewertet:
        return True
    # Ein halber Punkt Unterschied liegt im Messrauschen.
    return punkte >= max(bewertet) - 0.5


def _abweichungen(kandidat, ist):
    """Welche vorgeschlagenen Werte liegen nicht an?"""
    if not ist:
        return []
    zeilen = []
    if ist.get("mclk") and kandidat.get("mclk") and ist["mclk"] != kandidat["mclk"]:
        zeilen.append(f"DRAM-Takt: erwartet DDR5-{kandidat['mclk']}, anliegend DDR5-{ist['mclk']}")
    for name, wert in kandidat.get("timings", {}).items():
        anliegend = ist.get("timings", {}).get(name)
        if anliegend is not None and anliegend != wert:
            zeilen.append(f"{name}: erwartet {wert}, anliegend {anliegend}")
    return zeilen


def _naechste_runde(zustand, laufbuch, leiter, hardware):
    kandidat, begruendung = leiter.naechster_kandidat()

    if kandidat is None:
        # Timings ausgereizt - lohnt sich noch eine Taktstufe?
        aktuell = (zustand.letzter_stabiler or {}).get("mclk", 6000)
        bestueckung = hardware.get("bestueckung", {})
        hoeher = plan.naechste_taktstufe(aktuell, bestueckung)

        if hoeher and not getattr(zustand, "_takt_versucht", False):
            kopf(f"Timings ausgereizt - jetzt DDR5-{hoeher} versuchen")
            print(f"\n  {begruendung}")
            print(f"\n  Der nächste Schritt ist mehr Takt. Dabei werden die Timings "
                  f"wieder gelockert, weil DDR5-{hoeher} für sich schon anspruchsvoll ist.")
            print("  Läuft es nicht im 1:1-Betrieb (UCLK = MCLK), ist der Versuch "
                  "sinnlos - 2:1 kostet beim X3D mehr, als der Takt bringt.")
            neuer_satz = profiles.startsatz(hardware.get("chip", "unbekannt"), hoeher,
                                            bestueckung.get("dual_rank", True))
            kandidat = {
                "id": f"r{zustand.runde + 1:03d}", "mclk": hoeher,
                "fclk": config.FCLK["typisch"], "timings": neuer_satz,
                "spannungen": dict((zustand.letzter_stabiler or {}).get("spannungen", {})),
                "herkunft": f"Taktstufe DDR5-{hoeher}",
                "eltern": (zustand.letzter_stabiler or {}).get("id"),
            }
            zustand.kandidat_setzen(kandidat, "sichtung")
            _kandidat_ausgeben(kandidat, zustand.letzter_stabiler, "sichtung", hardware)
            return 0

        return _abschluss(zustand, laufbuch, hardware, begruendung)

    # Vor der Abschlussprüfung: einmal lange testen, was gewonnen wurde.
    stand = leiter.stand()
    stufe = "sichtung"
    if stand["fertig"] > 0 and stand["fertig"] % 4 == 0:
        stufe = "solide"

    zustand.kandidat_setzen(kandidat, stufe)
    kopf(f"Runde {zustand.runde}: nächster Versuch")
    print(f"\n  {begruendung}")
    print(f"  Fortschritt: {stand['fertig']} von {stand['gesamt']} Timings ausgereizt.")
    _kandidat_ausgeben(kandidat, zustand.letzter_stabiler, stufe, hardware)
    return 0


def _abschluss(zustand, laufbuch, hardware, grund):
    kopf("Abstimmung abgeschlossen")
    print(f"\n  {grund}")

    bester = laufbuch.bester()
    if not bester:
        print("\n  Keine stabile Einstellung gefunden, die besser war als EXPO.")
        return 0

    kandidat = bester["kandidat"]
    print(f"\n  Beste Einstellung: DDR5-{kandidat['mclk']} "
          f"{'-'.join(str(kandidat['timings'].get(n, '?')) for n in ('tCL','tRCD','tRP','tRAS'))}")
    print(f"  {bench.vergleich_text(bester.get('messwerte', {}), zustand.basis)}")
    print(f"\n  Diese Einstellung ist auf Stufe '{bester.get('stufe')}' geprüft.")
    print("  Vor dem Dauerbetrieb einmal über Nacht die Stufe 'alltag' laufen lassen:")
    print("    python ramtune.py dauertest")

    pfad = report.erzeugen(zustand, laufbuch, hardware)
    print(f"\n  Bericht: {pfad}")
    return 0


def _kandidat_ausgeben(kandidat, vorher, stufe, hardware):
    """Die BIOS-Anleitung für diese Runde - der eine Handgriff von Hand."""
    print("\n  Jetzt im BIOS eintragen (nur diese Felder, der Rest bleibt):\n")

    zeilen = plan.bios_anleitung(kandidat, vorher)
    if not zeilen:
        print("    (keine Änderung gegenüber der jetzigen Einstellung)")
    else:
        breite = max(len(z[0]) for z in zeilen)
        for feld, wert, ort in zeilen:
            print(f"    {feld:<{breite}}  =  {wert:<12} {ort}")

    warnungen = plan.spannungen_pruefen(kandidat.get("spannungen"))
    for warnung in warnungen:
        print(f"\n  !! {warnung}")

    print(f"\n  Bei ASRock: OC Tweaker -> DRAM Configuration -> DRAM Timing Configuration.")
    print(f"  Danach speichern, neu starten und:  python ramtune.py weiter")
    print(f"  Der Test dauert dann etwa {config.STUFEN[stufe]['dauer_min']} Minuten.")
    print("\n  Startet der Rechner nicht mehr: kurz ausschalten und zweimal beim "
          "Hochfahren abwürgen,\n  dann setzt das Board das BIOS zurück. Danach "
          "'python ramtune.py rettung' für die\n  letzte stabile Einstellung.")


# ------------------------------------------------------- Weitere Befehle

def befehl_dauertest(args):
    kopf("Dauertest der besten Einstellung")
    zustand = Zustand.laden()
    laufbuch = Laufbuch()
    bester = laufbuch.bester()
    if not bester:
        print("\n  Noch keine stabile Einstellung vorhanden.")
        return 1

    print(f"\n  Diese Einstellung wird jetzt {config.STUFEN['alltag']['dauer_min']} "
          "Minuten lang geprüft.")
    print("  Die Werte müssen dafür bereits im BIOS stehen.")

    zustand.test_beginnt()
    ergebnis = stress.stufe_fahren("alltag", melden=print)
    laufbuch.anhaengen({
        "kandidat": bester["kandidat"], "stufe": "alltag",
        "ergebnis": BESTANDEN if ergebnis["ergebnis"] == BESTANDEN else FEHLER,
        "test": ergebnis, "messwerte": bester.get("messwerte"),
        "punkte": bester.get("punkte"),
    })
    zustand.runde_beenden()

    print(f"\n  Ergebnis: {ergebnis['ergebnis']}")
    print(f"  {ergebnis['whea_text']}")
    if ergebnis["ergebnis"] == BESTANDEN:
        print("\n  Diese Einstellung ist alltagstauglich.")
    else:
        print("\n  Nicht bestanden - die vorletzte stabile Einstellung nehmen:")
        print("    python ramtune.py rettung")
    return 0


def befehl_bericht(args):
    zustand = Zustand.laden()
    laufbuch = Laufbuch()
    pfad = report.erzeugen(zustand, laufbuch, zustand.hardware)
    print(f"Bericht: {pfad}")
    if not args.nicht_oeffnen:
        webbrowser.open(pfad.as_uri())
    return 0


def befehl_rettung(args):
    kopf("Letzte stabile Einstellung")
    zustand = Zustand.laden()
    stabil = zustand.letzter_stabiler
    if not stabil:
        print("\n  Keine stabile Einstellung vermerkt. Im BIOS EXPO laden.")
        return 1
    print(f"\n  DDR5-{stabil['mclk']}, FCLK {stabil['fclk']} MHz\n")
    for feld, wert, ort in plan.bios_anleitung(stabil):
        print(f"    {feld:<14} = {wert:<12} {ort}")
    return 0


def befehl_autostart(args):
    if args.aus:
        system.aufgabe_entfernen(config.AUFGABE)
        print("Autostart entfernt.")
        return 0
    befehl = f'python "{Path(__file__).resolve()}" weiter'
    erfolg, meldung = system.aufgabe_anlegen(config.AUFGABE, befehl)
    print("Autostart eingerichtet." if erfolg else f"Fehlgeschlagen: {meldung}")
    return 0 if erfolg else 1


# ------------------------------------------------------------------ Einstieg

def main(argv=None):
    zerleger = argparse.ArgumentParser(
        description="RamTune - Speicherabstimmung für AM5 begleiten",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    unterbefehle = zerleger.add_subparsers(dest="befehl")

    def gemeinsam(teil):
        teil.add_argument("--zentimings", help="Pfad zu einem ZenTimings-Export")
        teil.add_argument("--hwinfo", help="Pfad zu einem HWiNFO-Protokoll (CSV)")

    p = unterbefehle.add_parser("pruefen", help="Werkzeuge und Hardware ansehen")
    gemeinsam(p)
    p.set_defaults(funktion=befehl_pruefen)

    p = unterbefehle.add_parser("start", help="Vorgang beginnen")
    gemeinsam(p)
    p.add_argument("--ziel", default="spiele",
                   choices=["spiele", "anwendung", "gemischt", "stabil"])
    p.add_argument("--neu", action="store_true", help="alten Vorgang verwerfen")
    p.add_argument("--ohne-werkzeuge", action="store_true",
                   help="auch ohne alle Pflichtwerkzeuge beginnen")
    p.set_defaults(funktion=befehl_start)

    p = unterbefehle.add_parser("weiter", help="auswerten und nächsten Schritt planen")
    gemeinsam(p)
    p.add_argument("--umfang", default="gruendlich",
                   choices=["schnell", "gruendlich", "vollstaendig"])
    p.add_argument("--trotzdem", action="store_true",
                   help="auch testen, wenn das BIOS die Werte nicht übernommen hat")
    p.set_defaults(funktion=befehl_weiter)

    p = unterbefehle.add_parser("dauertest", help="beste Einstellung über Nacht prüfen")
    p.set_defaults(funktion=befehl_dauertest)

    p = unterbefehle.add_parser("bericht", help="HTML-Bericht erzeugen")
    p.add_argument("--nicht-oeffnen", action="store_true")
    p.set_defaults(funktion=befehl_bericht)

    p = unterbefehle.add_parser("rettung", help="letzte stabile Einstellung zeigen")
    p.set_defaults(funktion=befehl_rettung)

    p = unterbefehle.add_parser("autostart", help="nach dem Anmelden weitermachen")
    p.add_argument("--aus", action="store_true")
    p.set_defaults(funktion=befehl_autostart)

    args = zerleger.parse_args(argv)
    if not getattr(args, "funktion", None):
        zerleger.print_help()
        return 0
    return args.funktion(args)


if __name__ == "__main__":
    sys.exit(main())
