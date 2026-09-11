"""Zugriff auf Windows: PowerShell, Ereignisprotokoll, geplante Aufgaben.

Gekapselt, damit der Rest des Cockpits ohne Windows importierbar und damit
testbar bleibt. Jede Funktion hier ist so geschrieben, dass sie auf einem
Nicht-Windows-System nicht abstürzt, sondern ein leeres Ergebnis liefert.
"""

import json
import os
import platform
import subprocess
from datetime import datetime, timedelta


def ist_windows():
    return platform.system() == "Windows"


def powershell(befehl, timeout=60):
    """Führt PowerShell aus und gibt (erfolg, ausgabe) zurück.

    Fehler werden bewusst nicht geworfen: das Cockpit läuft oft stundenlang
    unbeaufsichtigt, ein fehlendes Werkzeug darf den Lauf nicht beenden.
    """
    if not ist_windows():
        return False, "kein Windows"
    try:
        ergebnis = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", befehl],
            capture_output=True, text=True, timeout=timeout,
        )
        if ergebnis.returncode != 0:
            return False, (ergebnis.stderr or ergebnis.stdout).strip()
        return True, ergebnis.stdout.strip()
    except subprocess.TimeoutExpired:
        return False, "Zeitüberschreitung"
    except OSError as fehler:
        return False, str(fehler)


def powershell_json(befehl, timeout=60):
    """Wie powershell(), erwartet aber JSON und gibt immer eine Liste zurück."""
    erfolg, ausgabe = powershell(befehl + " | ConvertTo-Json -Depth 4 -Compress", timeout)
    if not erfolg or not ausgabe:
        return []
    try:
        daten = json.loads(ausgabe)
    except json.JSONDecodeError:
        return []
    # ConvertTo-Json liefert bei genau einem Treffer kein Array.
    return daten if isinstance(daten, list) else [daten]


def ist_administrator():
    """Manche Messwerkzeuge (Intel MLC) brauchen erhöhte Rechte."""
    if not ist_windows():
        return False
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


# ----------------------------------------------------------- Ereignisprotokoll

def ereignisse(anbieter, ids, seit_minuten=None, seit=None):
    """Liest Einträge eines Anbieters aus dem Systemprotokoll.

    seit_minuten oder seit (datetime) grenzt den Zeitraum ein. Ohne Angabe
    werden die letzten 24 Stunden gelesen.
    """
    if seit is None:
        minuten = seit_minuten if seit_minuten is not None else 24 * 60
        seit = datetime.now() - timedelta(minutes=minuten)
    zeitstempel = seit.strftime("%Y-%m-%dT%H:%M:%S")
    id_liste = ",".join(str(i) for i in ids)
    befehl = (
        "$ErrorActionPreference='SilentlyContinue';"
        f"Get-WinEvent -FilterHashtable @{{LogName='System';"
        f"ProviderName='{anbieter}';ID={id_liste};"
        f"StartTime=[datetime]'{zeitstempel}'}} -MaxEvents 200 |"
        " Select-Object Id,TimeCreated,LevelDisplayName,Message"
    )
    return powershell_json(befehl)


def letzter_start():
    """Zeitpunkt des letzten Systemstarts."""
    erfolg, ausgabe = powershell(
        "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o')"
    )
    if not erfolg or not ausgabe:
        return None
    try:
        return datetime.fromisoformat(ausgabe.strip().split(".")[0])
    except ValueError:
        return None


# ------------------------------------------------------------ Geplante Aufgabe

def aufgabe_anlegen(name, befehl):
    """Legt eine Aufgabe an, die bei der Anmeldung läuft (ohne Adminrechte)."""
    aufgabe_entfernen(name)
    erfolg, ausgabe = powershell(
        f'schtasks /create /tn "{name}" /tr "{befehl}" /sc onlogon /f /rl limited'
    )
    return erfolg, ausgabe


def aufgabe_entfernen(name):
    return powershell(f'schtasks /delete /tn "{name}" /f')[0]


def aufgabe_vorhanden(name):
    return powershell(f'schtasks /query /tn "{name}"')[0]


# ------------------------------------------------------------------ Sonstiges

def neustarten(verzoegerung_s=10):
    """Startet den Rechner neu, damit die nächste BIOS-Runde beginnen kann."""
    return powershell(f"shutdown /r /t {verzoegerung_s} /c \"RamTune: naechste Runde\"")[0]


def energieplan_hoechstleistung():
    """Setzt den Energieplan auf Höchstleistung - sonst streuen die Messwerte."""
    erfolg, _ = powershell(
        "powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"
    )
    return erfolg


def prozessorname():
    erfolg, ausgabe = powershell("(Get-CimInstance Win32_Processor).Name")
    if erfolg and ausgabe:
        return ausgabe.strip()
    return os.environ.get("PROCESSOR_IDENTIFIER", "unbekannt")
