"""RamTune - Cockpit für die Speicherabstimmung auf AM5 (Ryzen 9000).

Vorgeben lassen sich Speichereinstellungen auf dieser Plattform über das BIOS
und über AMD Ryzen Master. Für ein Programm ansteuerbar ist davon nichts: Das
offizielle Ryzen-Master-SDK liest nur. Ob sich die Oberfläche fernsteuern
lässt und ob der Rückweg zu einer startfähigen Konfiguration verlässlich
funktioniert, klärt der Befehl "machbarkeit" - vor dem ersten Suchlauf und
nicht als Annahme.

Alles andere - vorschlagen, prüfen ob eine Vorgabe angekommen ist, testen,
messen, protokollieren und nach einem Absturz wieder aufsetzen - übernimmt
dieses Programm selbst.
"""

__version__ = "1.1"
