"""Erzeugt den HTML-Bericht: was probiert wurde und was dabei herauskam."""

import html
import json
from datetime import datetime

from . import bench, config, plan, profiles
from .state import ABGESTUERZT, BESTANDEN, FEHLER

STIL = """
:root{color-scheme:dark;--bg:#101317;--karte:#171c22;--rand:#252c35;--text:#e7edf4;
--leise:#96a3b2;--gut:#4ade80;--schlecht:#f87171;--warn:#fbbf24;--akzent:#4f9dff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
padding:24px 16px 64px}
.huelle{max-width:1000px;margin:0 auto}
h1{font-size:1.5rem;margin:0 0 4px}
h2{font-size:1.05rem;margin:32px 0 12px;color:var(--leise);
text-transform:uppercase;letter-spacing:.08em;font-weight:600}
.leise{color:var(--leise);font-size:.9rem}
.karte{background:var(--karte);border:1px solid var(--rand);border-radius:12px;
padding:16px;margin-bottom:12px}
.gitter{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.kennzahl{font-size:1.6rem;font-weight:650;letter-spacing:-.02em}
.kennzahl.gut{color:var(--gut)}
.tabelle-huelle{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;font-size:.88rem;min-width:620px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--rand);
white-space:nowrap}
th{color:var(--leise);font-weight:600;font-size:.78rem;text-transform:uppercase;
letter-spacing:.05em}
tr.beste{background:rgba(79,157,255,.1)}
.marke{display:inline-block;padding:2px 8px;border-radius:999px;font-size:.78rem;
font-weight:600}
.marke.gut{background:rgba(74,222,128,.16);color:var(--gut)}
.marke.schlecht{background:rgba(248,113,113,.16);color:var(--schlecht)}
.marke.warn{background:rgba(251,191,36,.16);color:var(--warn)}
code{background:#0c0f13;padding:2px 6px;border-radius:5px;font-size:.86rem}
.hinweis{border-left:3px solid var(--warn);padding:10px 14px;margin:10px 0;
background:rgba(251,191,36,.07);border-radius:0 8px 8px 0}
ul{margin:8px 0;padding-left:20px}
li{margin:4px 0}
@media(max-width:520px){body{padding:16px 12px 48px}.kennzahl{font-size:1.35rem}}
"""


def _marke(ergebnis):
    if ergebnis == BESTANDEN:
        return '<span class="marke gut">bestanden</span>'
    if ergebnis in (FEHLER, ABGESTUERZT):
        text = "abgestürzt" if ergebnis == ABGESTUERZT else "fehlgeschlagen"
        return f'<span class="marke schlecht">{text}</span>'
    return f'<span class="marke warn">{html.escape(str(ergebnis))}</span>'


def _timing_spalte(kandidat):
    t = kandidat.get("timings", {})
    haupt = [t.get(n) for n in ("tCL", "tRCD", "tRP", "tRAS")]
    return "-".join(str(w) if w is not None else "?" for w in haupt)


def erzeugen(zustand, laufbuch, hardware=None, pfad=None):
    """Schreibt den Bericht und gibt den Pfad zurück."""
    pfad = pfad or config.BERICHT
    eintraege = laufbuch.eintraege
    bester = laufbuch.bester()
    basis = zustand.basis or {}
    hardware = hardware or zustand.hardware or {}

    teile = [
        "<title>RamTune - Bericht</title>",
        f"<style>{STIL}</style>",
        '<div class="huelle">',
        "<h1>RamTune</h1>",
        f'<p class="leise">Stand {html.escape(datetime.now().strftime("%d.%m.%Y %H:%M"))}'
        f" &middot; {len(eintraege)} Läufe &middot; Runde {zustand.runde}</p>",
    ]

    # --- Kopfzahlen ---------------------------------------------------------
    bestanden = len(laufbuch.bestandene())
    gewinn = "-"
    if bester and bester.get("punkte"):
        gewinn = f"{bester['punkte'] - 100:+.1f} %"

    teile.append('<div class="gitter">')
    for beschriftung, wert, klasse in [
        ("Läufe", str(len(eintraege)), ""),
        ("davon stabil", str(bestanden), ""),
        ("bester Gewinn", gewinn, "gut" if bester else ""),
        ("Ausgangslatenz", f"{basis.get('latenz_ns', 0):.1f} ns" if basis.get("latenz_ns") else "-", ""),
    ]:
        teile.append(
            f'<div class="karte"><div class="leise">{beschriftung}</div>'
            f'<div class="kennzahl {klasse}">{html.escape(wert)}</div></div>'
        )
    teile.append("</div>")

    # --- Hardware -----------------------------------------------------------
    if hardware:
        teile.append("<h2>System</h2><div class='karte'>")
        teile.append(f"<div>{html.escape(str(hardware.get('prozessor', 'unbekannt')))}</div>")
        bestueckung = hardware.get("bestueckung", {})
        if bestueckung:
            teile.append(
                f'<div class="leise">{html.escape(bestueckung.get("art", ""))}'
                f' &middot; {bestueckung.get("gesamt_gb", "?")} GB'
                f' &middot; {"Doppelrang" if bestueckung.get("dual_rank") else "Einzelrang"}</div>'
            )
        if hardware.get("chip_name"):
            teile.append(f'<div class="leise">{html.escape(hardware["chip_name"])}</div>')
        for warnung in bestueckung.get("warnungen", []):
            teile.append(f'<div class="hinweis">{html.escape(warnung)}</div>')
        teile.append("</div>")

    # --- Beste Einstellung --------------------------------------------------
    if bester:
        kandidat = bester["kandidat"]
        teile.append("<h2>Beste stabile Einstellung</h2><div class='karte'>")
        teile.append(
            f'<div class="kennzahl gut">DDR5-{kandidat.get("mclk")} '
            f'{_timing_spalte(kandidat)}</div>'
        )
        teile.append(
            f'<div class="leise">{html.escape(bench.vergleich_text(bester.get("messwerte", {}), basis))}</div>'
        )
        trfc = kandidat.get("timings", {}).get("tRFC")
        if trfc:
            nanosekunden = profiles.trfc_nanosekunden(trfc, kandidat.get("mclk", 6000))
            teile.append(
                f'<div class="leise">tRFC {trfc} ({nanosekunden:.0f} ns) '
                f'&middot; tREFI {kandidat.get("timings", {}).get("tREFI", "?")}</div>'
            )

        teile.append("<h2>Diese Werte ins BIOS</h2><div class='tabelle-huelle'><table>")
        teile.append("<tr><th>BIOS-Feld</th><th>Wert</th><th>wo / welches Timing</th></tr>")
        for feld, wert, ort in plan.bios_anleitung(kandidat):
            teile.append(
                f"<tr><td><code>{html.escape(feld)}</code></td>"
                f"<td><strong>{html.escape(wert)}</strong></td>"
                f"<td class='leise'>{html.escape(ort)}</td></tr>"
            )
        teile.append("</table></div></div>")

    # --- Alle Läufe ---------------------------------------------------------
    teile.append("<h2>Alle Läufe</h2><div class='karte tabelle-huelle'><table>")
    teile.append(
        "<tr><th>#</th><th>Takt</th><th>Timings</th><th>geändert</th>"
        "<th>Stufe</th><th>Ergebnis</th><th>Latenz</th><th>Punkte</th></tr>"
    )
    for nummer, eintrag in enumerate(eintraege, 1):
        kandidat = eintrag.get("kandidat", {})
        messwerte = eintrag.get("messwerte") or {}
        ist_bester = bester is not None and eintrag is bester
        latenz = (f"{messwerte['latenz_ns']:.1f} ns"
                  if messwerte.get("latenz_ns") else "-")
        punkte = f"{eintrag['punkte']:.1f}" if eintrag.get("punkte") else "-"
        teile.append(
            f'<tr class="{"beste" if ist_bester else ""}">'
            f"<td>{nummer}</td>"
            f'<td>DDR5-{kandidat.get("mclk", "?")}</td>'
            f"<td>{html.escape(_timing_spalte(kandidat))}</td>"
            f'<td class="leise">{html.escape(str(kandidat.get("herkunft", "-")))}</td>'
            f'<td class="leise">{html.escape(str(eintrag.get("stufe", "-")))}</td>'
            f"<td>{_marke(eintrag.get('ergebnis'))}</td>"
            f"<td>{latenz}</td><td>{punkte}</td></tr>"
        )
    teile.append("</table></div>")

    # --- Fortschritt --------------------------------------------------------
    leiterstand = (hardware or {}).get("leiter") or {}
    if leiterstand:
        fertig = [t for t, e in leiterstand.items() if e.get("fertig")]
        offen = [t for t, e in leiterstand.items() if not e.get("fertig")]
        teile.append("<h2>Fortschritt der Leiter</h2><div class='karte'>")
        teile.append(f'<div>Ausgereizt: {html.escape(", ".join(fertig)) or "noch keins"}</div>')
        teile.append(f'<div class="leise">Offen: {html.escape(", ".join(offen)) or "keins"}</div>')
        teile.append("</div>")

    teile.append("</div>")

    pfad.parent.mkdir(parents=True, exist_ok=True)
    pfad.write_text("\n".join(teile), encoding="utf-8")
    return pfad
