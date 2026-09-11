"""Wissensbasis: Speicherchips, Timings und was sie auf AM5 bewirken.

Die Werte stammen aus dem, was die Übertakter-Gemeinde für Zen 4/5 als
belastbar erarbeitet hat (insbesondere die Timing-Sets von buildzoid und die
AM5-Sammelthreads auf Overclock.net). Sie sind Startpunkte, keine Garantien -
jedes Kit ist anders, und genau deshalb testet das Cockpit jeden Schritt nach.

Die Feldnamen unter "agesa" sind die Bezeichnungen, die im BIOS auftauchen.
Bei ASRock stehen sie unter:
    OC Tweaker -> DRAM Configuration -> DRAM Timing Configuration
oder unter:
    Advanced -> AMD Overclocking -> DDR Options -> DDR Timing Configuration
"""

# --------------------------------------------------------------- Speicherchips

# "guete" ordnet grob ein, wie weit sich ein Chip treiben lässt; "trfc_ns"
# nennt den erreichbaren Bereich für tRFC in Nanosekunden (der Takt-Wert hängt
# von der Geschwindigkeit ab und wird daraus berechnet).
CHIPS = {
    "hynix_a": {
        "name": "SK Hynix A-die (16 Gbit)",
        "guete": 5,
        "cl_bei_6000": 28,
        "cl_untergrenze": 26,
        "rcd_bei_6000": 36,
        "rcd_untergrenze": 34,
        "trfc_ns": (148, 185),
        "hinweis": "Der beste DDR5-Chip. Verträgt niedrige Latenzen und hohe Taktraten.",
    },
    "hynix_m": {
        "name": "SK Hynix M-die (16 Gbit)",
        "guete": 4,
        "cl_bei_6000": 30,
        "cl_untergrenze": 28,
        "rcd_bei_6000": 38,
        "rcd_untergrenze": 36,
        "trfc_ns": (165, 200),
        "hinweis": (
            "Sehr verbreitet, auch in 2x32-GB-Kits. tCL geht gut runter, "
            "tRCD bleibt stur - dort nicht zu viel Zeit investieren."
        ),
    },
    "samsung_b": {
        "name": "Samsung B-die (DDR5, nicht mit DDR4 verwechseln)",
        "guete": 3,
        "cl_bei_6000": 32,
        "cl_untergrenze": 30,
        "rcd_bei_6000": 38,
        "rcd_untergrenze": 36,
        "trfc_ns": (160, 200),
        "hinweis": "Mittelfeld. Reagiert ordentlich auf Spannung, nicht auf Zureden.",
    },
    "micron_a": {
        "name": "Micron A-die / B-die",
        "guete": 2,
        "cl_bei_6000": 34,
        "cl_untergrenze": 32,
        "rcd_bei_6000": 40,
        "rcd_untergrenze": 38,
        "trfc_ns": (110, 150),
        "hinweis": (
            "Schwach bei tCL, dafür außergewöhnlich niedriges tRFC - das holt "
            "einen guten Teil des Rückstands wieder herein."
        ),
    },
    "unbekannt": {
        "name": "Chip nicht erkannt",
        "guete": 2,
        "cl_bei_6000": 32,
        "cl_untergrenze": 28,
        "rcd_bei_6000": 38,
        "rcd_untergrenze": 36,
        "trfc_ns": (175, 210),
        "hinweis": "Ohne Chip-Kenntnis geht das Cockpit vorsichtig vor.",
    },
}


def chip_erkennen(hersteller, teilenummer, dichte_gbit=None):
    """Ordnet SPD-Angaben einem Chiptyp zu.

    Thaiphoon Burner liest den Chip direkt aus; ohne dieses Werkzeug bleibt nur
    der Umweg über Hersteller und Teilenummer, der beim Hynix-Untertyp (A oder
    M) oft nicht eindeutig ist. Im Zweifel wird die vorsichtigere Variante
    gewählt - ein zu zahmer Startwert kostet eine Runde, ein zu scharfer kostet
    einen Absturz.
    """
    text = f"{hersteller or ''} {teilenummer or ''}".lower()

    if "hynix" in text or text.startswith("sk"):
        if "a-die" in text or "adie" in text:
            return "hynix_a"
        if "m-die" in text or "mdie" in text:
            return "hynix_m"
        return "hynix_m"
    if "samsung" in text:
        return "samsung_b"
    if "micron" in text or "crucial" in text:
        return "micron_a"
    return "unbekannt"


# -------------------------------------------------------------------- Timings

# hebel: wie stark das Timing die Spielleistung beeinflusst (1-5).
# stufe:  in welchem Abschnitt der Leiter es angefasst wird.
# richtung: -1 = kleinere Werte sind besser, +1 = größere Werte sind besser.
TIMINGS = {
    # --- Primär -------------------------------------------------------------
    "tCL": {
        "agesa": "Tcl", "stufe": "primaer", "hebel": 4, "richtung": -1,
        "min": 24, "max": 46, "gerade": True,
        "text": "Zugriffslatenz. Der bekannteste Wert - und nicht der wichtigste.",
    },
    "tRCD": {
        "agesa": "Trcd", "stufe": "primaer", "hebel": 4, "richtung": -1,
        "min": 30, "max": 50,
        "text": "Zeile öffnen. Bei Hynix M-die der sturste Wert im ganzen Satz.",
    },
    "tRP": {
        "agesa": "Trp", "stufe": "primaer", "hebel": 3, "richtung": -1,
        "min": 30, "max": 50,
        "text": "Zeile schließen. Läuft meist im Gleichschritt mit tRCD.",
    },
    "tRAS": {
        "agesa": "Tras", "stufe": "primaer", "hebel": 2, "richtung": -1,
        "min": 28, "max": 64,
        "text": "Mindestdauer einer offenen Zeile. Zu klein kostet Stabilität ohne Ertrag.",
    },
    "tRC": {
        "agesa": "Trc", "stufe": "primaer", "hebel": 2, "richtung": -1,
        "min": 60, "max": 120,
        "text": "Voller Zeilenzyklus, mindestens tRAS + tRP.",
    },

    # --- Auffrischung: der größte Hebel fürs Spielen ------------------------
    "tRFC": {
        "agesa": "Trfc1", "stufe": "refresh", "hebel": 5, "richtung": -1,
        "min": 200, "max": 1000,
        "text": (
            "Dauer einer Auffrischung. Mit tREFI zusammen der größte Gewinn für "
            "1%-Perzentile, weil währenddessen kein Zugriff möglich ist."
        ),
    },
    "tRFC2": {
        "agesa": "Trfc2", "stufe": "refresh", "hebel": 1, "richtung": -1,
        "min": 150, "max": 800,
        "text": "Nur im Sparmodus aktiv, üblicherweise etwa 62 % von tRFC.",
    },
    "tRFCsb": {
        "agesa": "Trfcsb", "stufe": "refresh", "hebel": 2, "richtung": -1,
        "min": 100, "max": 600,
        "text": "Auffrischung je Bank-Gruppe, etwa 42 % von tRFC.",
    },
    "tREFI": {
        "agesa": "Trefi", "stufe": "refresh", "hebel": 5, "richtung": 1,
        "min": 5000, "max": 65535,
        "text": (
            "Abstand zwischen Auffrischungen - hier ist mehr besser. ACHTUNG: "
            "hängt an der Modultemperatur. Zu hoch bei zu warmem Speicher gibt "
            "stille Datenfehler, die kein Stresstest findet."
        ),
    },

    # --- Sekundär -----------------------------------------------------------
    "tRRD_S": {
        "agesa": "TrrdS", "stufe": "sekundaer", "hebel": 2, "richtung": -1,
        "min": 4, "max": 12, "text": "Zeilenwechsel zwischen Bank-Gruppen.",
    },
    "tRRD_L": {
        "agesa": "TrrdL", "stufe": "sekundaer", "hebel": 2, "richtung": -1,
        "min": 4, "max": 16, "text": "Zeilenwechsel innerhalb einer Bank-Gruppe.",
    },
    "tFAW": {
        "agesa": "Tfaw", "stufe": "sekundaer", "hebel": 2, "richtung": -1,
        "min": 16, "max": 48, "text": "Fenster für vier Zeilenöffnungen, mindestens 4x tRRD_S.",
    },
    "tWTR_S": {
        "agesa": "TwtrS", "stufe": "sekundaer", "hebel": 1, "richtung": -1,
        "min": 2, "max": 16, "text": "Schreiben zu Lesen, andere Bank-Gruppe.",
    },
    "tWTR_L": {
        "agesa": "TwtrL", "stufe": "sekundaer", "hebel": 2, "richtung": -1,
        "min": 8, "max": 32, "text": "Schreiben zu Lesen, gleiche Bank-Gruppe.",
    },
    "tWR": {
        "agesa": "Twr", "stufe": "sekundaer", "hebel": 1, "richtung": -1,
        "min": 24, "max": 96, "text": "Schreib-Erholzeit.",
    },
    "tRTP": {
        "agesa": "Trtp", "stufe": "sekundaer", "hebel": 1, "richtung": -1,
        "min": 8, "max": 24, "text": "Lesen bis Zeilenschluss.",
    },

    # --- Tertiär: auf AM5 unterschätzt --------------------------------------
    "tRDRDSCL": {
        "agesa": "TrdrdScL", "stufe": "tertiaer", "hebel": 4, "richtung": -1,
        "min": 2, "max": 16,
        "text": (
            "Lesen nach Lesen, gleiche Bank-Gruppe. Steht ab Werk auf 5 und ist "
            "einer der größten unbeachteten Hebel auf AM5."
        ),
    },
    "tWRWRSCL": {
        "agesa": "TwrwrScL", "stufe": "tertiaer", "hebel": 4, "richtung": -1,
        "min": 2, "max": 16, "text": "Schreiben nach Schreiben, gleiche Bank-Gruppe. Wie oben.",
    },
    "tRDWR": {
        "agesa": "Trdwr", "stufe": "tertiaer", "hebel": 2, "richtung": -1,
        "min": 8, "max": 24, "text": "Umschalten von Lesen auf Schreiben.",
    },
    "tWRRD": {
        "agesa": "Twrrd", "stufe": "tertiaer", "hebel": 1, "richtung": -1,
        "min": 1, "max": 16, "text": "Umschalten von Schreiben auf Lesen.",
    },
    "tRDRDSD": {
        "agesa": "TrdrdSd", "stufe": "tertiaer", "hebel": 2, "richtung": -1,
        "min": 1, "max": 16, "text": "Lesen zwischen den Rängen eines Moduls (bei 2x32 GB relevant).",
    },
    "tRDRDDD": {
        "agesa": "TrdrdDd", "stufe": "tertiaer", "hebel": 2, "richtung": -1,
        "min": 1, "max": 16, "text": "Lesen zwischen den Modulen.",
    },
    "tWRWRSD": {
        "agesa": "TwrwrSd", "stufe": "tertiaer", "hebel": 1, "richtung": -1,
        "min": 1, "max": 16, "text": "Schreiben zwischen den Rängen eines Moduls.",
    },
    "tWRWRDD": {
        "agesa": "TwrwrDd", "stufe": "tertiaer", "hebel": 1, "richtung": -1,
        "min": 1, "max": 16, "text": "Schreiben zwischen den Modulen.",
    },
}

# Reihenfolge, in der die Abschnitte abgearbeitet werden. Erst das, was viel
# bringt und wenig Stabilität kostet.
ABSCHNITTE = ["primaer", "refresh", "tertiaer", "sekundaer"]


def trfc_takte(nanosekunden, mclk_mts):
    """Rechnet tRFC von Nanosekunden in Takte um.

    Der Speichertakt ist die halbe Übertragungsrate: DDR5-6000 sind 3000 MHz.
    """
    return int(round(nanosekunden * mclk_mts / 2000.0))


def trfc_nanosekunden(takte, mclk_mts):
    return takte * 2000.0 / mclk_mts


def startsatz(chip_id, mclk, dual_rank=True):
    """Erzeugt einen vorsichtigen, lauffähigen Startsatz für eine Geschwindigkeit.

    Bewusst nicht das Maximum: Der erste Satz soll booten und eine ehrliche
    Ausgangsmessung liefern. Das Feilen übernimmt danach die Leiter in plan.py.
    """
    chip = CHIPS.get(chip_id, CHIPS["unbekannt"])

    # Primärtimings skalieren grob mit der Geschwindigkeit.
    faktor = mclk / 6000.0
    tcl = int(round(chip["cl_bei_6000"] * faktor))
    if tcl % 2:
        tcl += 1  # AM5 mag gerade tCL-Werte
    trcd = int(round(chip["rcd_bei_6000"] * faktor))
    trp = trcd
    tras = max(28, int(round(30 * faktor)))
    trc = tras + trp

    # tRFC: am oberen (sicheren) Ende des Chip-Bereichs beginnen.
    trfc = trfc_takte(chip["trfc_ns"][1], mclk)

    # Dual-Rank-Module brauchen mehr Luft bei den Rang-Timings.
    rang = 8 if dual_rank else 6

    # tRDRDSCL/tWRWRSCL stehen ab Werk auf 5. 4 ist bei zwei Doppelrang-Modulen
    # ein belegter, ruhiger Startwert; 2-3 sind das Ziel, aber nicht der Anfang.
    scl = 4 if dual_rank else 3

    return {
        "tCL": tcl, "tRCD": trcd, "tRP": trp, "tRAS": tras, "tRC": trc,
        "tRFC": trfc, "tRFC2": int(trfc * 0.62), "tRFCsb": int(trfc * 0.42),
        # 40000 ist der uebliche Einstieg. Hoeher lohnt sich, haengt aber an der
        # Modultemperatur - darum hebt erst die Leiter diesen Wert an.
        "tREFI": 40000,
        "tRRD_S": 4, "tRRD_L": 8, "tFAW": 20,
        "tWTR_S": 6, "tWTR_L": 16, "tWR": 48, "tRTP": 12,
        "tRDRDSCL": scl, "tWRWRSCL": scl, "tRDWR": 18, "tWRRD": 4,
        "tRDRDSD": rang, "tRDRDDD": rang, "tWRWRSD": rang, "tWRWRDD": rang,
    }


def abhaengigkeiten_pruefen(timings):
    """Prüft die Regeln, die zwischen Timings gelten.

    Verstöße lassen das System oft gar nicht erst booten, kosten also eine
    volle Runde - das Cockpit fängt sie vorher ab.
    """
    fehler = []
    t = timings

    if "tRC" in t and "tRAS" in t and "tRP" in t:
        mindest = t["tRAS"] + t["tRP"]
        if t["tRC"] < mindest:
            fehler.append(f"tRC ({t['tRC']}) muss mindestens tRAS + tRP = {mindest} sein.")

    # Die aus DDR4 bekannte Regel tRAS >= tRCD + tRTP gilt auf AM5 nicht: AGESA
    # erzwingt sie nicht, und die gängigen Sets laufen bewusst darunter
    # (tRAS 30 bei tRCD 38). Geprüft wird nur die Untergrenze des Controllers,
    # die ältere BIOS-Fassungen noch durchsetzen.
    if "tRAS" in t and t["tRAS"] < 28:
        fehler.append(
            f"tRAS ({t['tRAS']}) unter 28 wird von vielen BIOS-Fassungen abgelehnt."
        )

    if "tWRWRSCL" in t and "tRDRDSCL" in t and t["tWRWRSCL"] < t["tRDRDSCL"]:
        fehler.append(
            f"tWRWRSCL ({t['tWRWRSCL']}) sollte nicht kleiner als tRDRDSCL "
            f"({t['tRDRDSCL']}) sein."
        )

    if "tFAW" in t and "tRRD_S" in t:
        mindest = 4 * t["tRRD_S"]
        if t["tFAW"] < mindest:
            fehler.append(f"tFAW ({t['tFAW']}) muss mindestens 4 x tRRD_S = {mindest} sein.")

    if "tCL" in t and t["tCL"] % 2:
        fehler.append(f"tCL ({t['tCL']}) sollte auf AM5 gerade sein.")

    if "tREFI" in t and t["tREFI"] > 65535:
        fehler.append("tREFI ist auf 65535 begrenzt.")

    for schluessel, wert in t.items():
        regel = TIMINGS.get(schluessel)
        if regel and not (regel["min"] <= wert <= regel["max"]):
            fehler.append(
                f"{schluessel} = {wert} liegt außerhalb des sinnvollen Bereichs "
                f"({regel['min']}-{regel['max']})."
            )

    return fehler
