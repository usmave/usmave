"""Konfiguration, Sicherheitsgrenzen und Ablageorte des Cockpits.

Alle Grenzwerte hier sind auf AM5 / Zen 5 (Ryzen 9000) bezogen und bewusst
konservativ. Sie dienen nicht dazu, etwas zu verhindern, sondern dazu, dass
das Cockpit warnt, bevor eine Eingabe im BIOS Hardware kostet.
"""

from pathlib import Path

# ---------------------------------------------------------------- Ablageorte

# Alles, was einen Neustart überleben muss, liegt neben dem Programm und nicht
# im Temp-Verzeichnis: ein abgestürzter Lauf soll nach dem Reboot wiederfindbar
# sein, auch wenn Windows zwischendurch aufgeräumt hat.
WURZEL = Path(__file__).resolve().parent.parent
DATEN = WURZEL / "daten"
ZUSTAND = DATEN / "zustand.json"
LAEUFE = DATEN / "laeufe.json"
PROTOKOLLE = DATEN / "protokolle"
BERICHT = DATEN / "bericht.html"

# Name der geplanten Aufgabe, die das Cockpit nach einem Neustart fortsetzt.
AUFGABE = "RamTune-Fortsetzen"


# ------------------------------------------------------- Spannungsgrenzen (V)

# "warn" = ab hier meldet sich das Cockpit, "stop" = darüber verweigert es den
# Vorschlag. Die Stop-Werte orientieren sich an AMDs eigenen Vorgaben nach den
# SoC-Ausfällen der ersten AM5-Generation.
SPANNUNGEN = {
    "vsoc": {
        "name": "SoC-Spannung (VSOC)",
        "typisch": 1.15,
        "warn": 1.25,
        "stop": 1.30,
        "hinweis": (
            "Über 1,30 V hat AMD auf AM5 Prozessoren zerstört. 1:1 bei 6000-6400 "
            "braucht fast nie mehr als 1,20-1,25 V. Mehr Spannung ersetzt keinen "
            "guten Speichercontroller."
        ),
    },
    "vddio": {
        "name": "VDDIO / VDD_MISC",
        "typisch": 1.20,
        "warn": 1.30,
        "stop": 1.40,
        "hinweis": "Hilft beim Speichertraining, selten über 1,25 V nötig.",
    },
    "vdd": {
        "name": "DRAM VDD",
        "typisch": 1.35,
        "warn": 1.45,
        "stop": 1.55,
        "hinweis": (
            "Bis 1,45 V im Dauerbetrieb vertretbar, wenn Luft über die Module "
            "streicht. Darüber steigt die Temperatur schneller als der Ertrag."
        ),
    },
    "vddq": {
        "name": "DRAM VDDQ",
        "typisch": 1.35,
        "warn": 1.45,
        "stop": 1.55,
        "hinweis": "In der Regel gleich VDD oder minimal darunter.",
    },
}


# ------------------------------------------------------------ Temperaturen (°C)

# tREFI ist der größte Einzelhebel für Spielleistung - und der einzige, bei dem
# Hitze zu Datenfehlern führt, die kein Stresstest zuverlässig findet. Deshalb
# hängt die tREFI-Empfehlung hart an der gemessenen Modultemperatur.
TEMPERATUR = {
    "trefi_voll": 50.0,       # darunter ist hohes tREFI vertretbar
    "trefi_gedeckelt": 60.0,  # darüber wird tREFI zurückgenommen
    "trefi_notfall": 65.0,    # darüber nur noch der Grundwert
    "abbruch": 70.0,          # darüber bricht das Cockpit Tests ab
}


# ------------------------------------------------------------------- Taktraten

# Zen 5 entkoppelt FCLK von der Speichergeschwindigkeit. Der alte Gleichlauf aus
# Zen-2/3-Zeiten gilt nicht mehr; 2000-2133 MHz ist der nutzbare Bereich.
FCLK = {"min": 1800, "typisch": 2000, "max": 2133}

# Realistischer 1:1-Korridor für zwei Dual-Rank-Module (2x32 GB) am 9800X3D.
# 6400 im 1:1-Betrieb ist bereits selten, 6600 Glückssache.
MCLK_LEITER_2X32 = [6000, 6200, 6400, 6600]
MCLK_LEITER_2X16 = [6000, 6200, 6400, 6600, 6800]


# ------------------------------------------------------------------ Teststufen

# Jede Stufe ist eine Wette auf Zeit gegen Sicherheit. Früh wird billig
# aussortiert, teuer getestet wird nur, was es bis dahin geschafft hat.
STUFEN = {
    "rauch": {
        "name": "Rauchtest",
        "dauer_min": 6,
        "zweck": "Bootet und rechnet es überhaupt? Sortiert offensichtlichen Müll in Minuten aus.",
        "tests": [("ycruncher", {"tests": ["VT3"], "minuten": 5})],
    },
    "sichtung": {
        "name": "Sichtung",
        "dauer_min": 25,
        "zweck": "Fängt den Großteil der instabilen Kandidaten, bevor Zeit investiert wird.",
        "tests": [
            ("ycruncher", {"tests": ["VT3"], "minuten": 12}),
            ("tm5", {"konfig": "absolut", "zyklen": 1, "minuten": 12}),
        ],
    },
    "solide": {
        "name": "Solide",
        "dauer_min": 120,
        "zweck": "Genug für einen Alltagsverdacht, noch nicht genug fürs Vertrauen.",
        "tests": [
            ("tm5", {"konfig": "absolut", "zyklen": 3, "minuten": 60}),
            ("karhu", {"abdeckung": 2000, "minuten": 45}),
            ("ycruncher", {"tests": ["VT3", "N64"], "minuten": 15}),
        ],
    },
    "alltag": {
        "name": "Alltagstauglich",
        "dauer_min": 420,
        "zweck": "Die Stufe, nach der eine Einstellung als Alltagsprofil gelten darf.",
        "tests": [
            ("karhu", {"abdeckung": 10000, "minuten": 240}),
            ("tm5", {"konfig": "extreme", "zyklen": 3, "minuten": 150}),
            ("ycruncher", {"tests": ["VT3", "N64", "C17"], "minuten": 30}),
        ],
    },
}

STUFEN_REIHE = ["rauch", "sichtung", "solide", "alltag"]

# y-cruncher hat den früher überall empfohlenen Test VST in Fassung 0.8.3
# entfernt; VT3 ist sein neu geschriebener Nachfolger und gilt als der
# schärfere Test. Alte Anleitungen im Netz nennen weiterhin VST - ein Aufruf
# damit scheitert auf jeder aktuellen Fassung.
YCRUNCHER_TESTS = ["BKT", "BBP", "SFT", "SFTv", "SNT", "SVT", "FFT",
                   "N32", "N64", "HNT", "C17", "VT3"]
YCRUNCHER_ENTFERNT = {"VST": "VT3"}


# ------------------------------------------------------------------ Benchmarks

# Für Spiele zählt Latenz, nicht Bandbreite. Die Reihenfolge spiegelt das:
# gewichtet wird nach Latenz, Bandbreite läuft als Kontrollwert mit.
BEWERTUNG_SPIELE = {"latenz": 0.75, "bandbreite": 0.25}
BEWERTUNG_ANWENDUNG = {"latenz": 0.35, "bandbreite": 0.65}
BEWERTUNG_GEMISCHT = {"latenz": 0.55, "bandbreite": 0.45}
