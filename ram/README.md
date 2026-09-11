# RamTune

Begleitet die Speicherabstimmung auf einem AM5-System (Ryzen 9000) — vorschlagen,
prüfen, messen, protokollieren und nach einem Absturz von selbst weitermachen.

Ausgelegt auf **Ryzen 7 9800X3D, 2×32 GB, ASRock-Board, Windows 11** mit dem Ziel
**niedrige Latenz für Spiele**. Andere Bestückungen erkennt es und rechnet anders.

## Das Wichtigste zuerst

**Auf AM5 kann kein Programm unter Windows Speichertimings setzen.** Taktrate,
Timings und Spannungen werden im BIOS gesetzt und beim Einschalten vom
Speichertraining übernommen. Wer etwas anderes verspricht, kann es nicht halten.

RamTune automatisiert deshalb alles *außer* dem einen Handgriff:

| Schritt | wer |
| --- | --- |
| Hardware und Chiptyp erkennen | RamTune |
| nächste sinnvolle Einstellung berechnen | RamTune |
| **Werte im BIOS eintragen** | **du, einmal pro Runde** |
| prüfen, ob das BIOS die Werte übernommen hat | RamTune |
| Stabilität testen, stille Fehler mitlesen | RamTune |
| Latenz und Bandbreite messen | RamTune |
| Absturz erkennen, Schuldigen vermerken, weiterplanen | RamTune |
| Ergebnisse sammeln und vergleichbar machen | RamTune |

Pro Runde tippst du wenige Zahlen ab — meist genau eine, weil immer nur ein
Timing auf einmal bewegt wird.

## Was gebraucht wird

Python 3.10 oder neuer, sonst nichts aus dem Python-Umfeld: keine Bibliotheken,
kein Installationsschritt.

Dazu die Werkzeuge, die die eigentliche Arbeit machen. Sie werden **nicht**
automatisch heruntergeladen — diese Programme greifen tief ins System, die
Entscheidung gehört dir:

| Werkzeug | wofür | nötig? |
| --- | --- | --- |
| [y-cruncher](http://www.numberworld.org/y-cruncher/) | findet Instabilität des Speichercontrollers am schnellsten | ja |
| [TestMem5](https://github.com/CoolCmd/TestMem5) + anta777-Konfigurationen | der DDR5-Standardtest | ja |
| [Intel MLC](https://www.intel.com/content/www/us/en/download/736633/) | misst Latenz und Bandbreite (läuft trotz des Namens auf AMD) | ja |
| [ZenTimings](https://github.com/irusanov/ZenTimings) | liest die tatsächlich anliegenden Werte | dringend empfohlen |
| [HWiNFO64](https://www.hwinfo.com/download/) | Modultemperatur — entscheidet über tREFI | dringend empfohlen |
| [Karhu RAMTest](https://www.karhusoftware.com/ramtest/) | beste Fehlerausbeute pro Stunde (ca. 10 €) | optional |
| [Thaiphoon Burner](https://www.softnology.biz/files.html) | bestimmt den Speicherchip eindeutig | optional |

Die Programme irgendwo ablegen und den Ordner `ram/werkzeuge/` nennen, oder sie
dort hineinkopieren — RamTune sucht dort, im Suchpfad und in den üblichen Ordnern.

```
python ramtune.py pruefen
```

zeigt, was gefunden wurde und was fehlt.

## Ablauf

### 1. Bestandsaufnahme

```bash
python ramtune.py pruefen --zentimings zen.txt --hwinfo hwinfo.csv
```

Zeigt Prozessor, Bestückung, Chiptyp, Temperatur und die anliegenden Timings.

**Hier steht die wichtigste Einzelprüfung überhaupt:** Sitzen zwei Module in den
Steckplätzen **A2 und B2** (die beiden weiter von der CPU entfernten)? In A1/B1
verlieren viele AM5-Systeme mehrere hundert MT/s, ohne dass irgendwo eine
Fehlermeldung erscheint. Das lässt sich durch keine noch so gute Einstellung
ausgleichen — nur durch Umstecken.

### 2. Beginnen

```bash
python ramtune.py start --ziel spiele
```

Misst zuerst die jetzige EXPO-Einstellung als Bezugspunkt. Ohne diese Messung
wäre später kein Vergleich möglich. Danach kommt der erste Vorschlag: ein
vorsichtiger, lauffähiger Startsatz für deinen Chiptyp.

### 3. Die Runde, die sich wiederholt

RamTune nennt die Felder, die sich ändern:

```
  Jetzt im BIOS eintragen (nur diese Felder, der Rest bleibt):

    Trfc  =  552          DRAM Timing Configuration (tRFC)

  Bei ASRock: OC Tweaker -> DRAM Configuration -> DRAM Timing Configuration.
  Danach speichern, neu starten und:  python ramtune.py weiter
```

Eintragen, speichern, neu starten, dann:

```bash
python ramtune.py weiter --zentimings zen.txt --hwinfo hwinfo.csv
```

RamTune prüft zuerst, ob das BIOS die Werte *wirklich* übernommen hat — das
Speichertraining verwirft stillschweigend, was ihm nicht passt, und man misst
sonst stundenlang die alte Einstellung. Dann testet und misst es und nennt den
nächsten Schritt.

Mit `python ramtune.py autostart` macht es das nach dem Anmelden von selbst.

### 4. Abschluss

Wenn nichts mehr zu holen ist, schlägt RamTune die nächste Taktstufe vor
(6000 → 6200 → 6400) und beginnt dort mit gelockerten Timings von vorn. Danach:

```bash
python ramtune.py dauertest    # eine Nacht lang die beste Einstellung
python ramtune.py bericht      # HTML-Übersicht aller Läufe
```

## Wie die Suche vorgeht

Eine Runde kostet einen Neustart und die Testzeit — sie ist teuer. Deshalb ist
die Suche nicht stur:

1. Ein Timing wird um die Startschrittweite verschärft und getestet.
2. **Bestanden** → im selben Schritt weiter, da ist noch Luft.
3. **Fehlgeschlagen** → zurück auf den letzten stabilen Wert, Schrittweite
   halbieren, erneut versuchen. Unterschreitet sie das Mindestmaß, gilt das
   Timing als ausgereizt und das nächste kommt dran.

Ein Timing braucht so vier bis sechs Runden statt zwanzig. Im Selbsttest gegen
einen simulierten Speicher mit verborgenen Grenzen findet die Leiter alle
Grenzwerte exakt und braucht dafür 32 Runden.

Abgearbeitet wird nach Ertrag, nicht nach Alphabet. Für Spiele zählen
`tRFC`, `tREFI` und die `SCL`-Timings mehr als das berühmte `tCL`:

```bash
--umfang schnell       # nur die großen Hebel, rund ein Tag
--umfang gruendlich    # der sinnvolle Normalfall (Vorgabe)
--umfang vollstaendig  # auch das Beiwerk
```

## Sicherheit

**Spannungen.** RamTune warnt vor jeder Eingabe und verweigert Vorschläge über
der harten Grenze:

| Spannung | Alltag | hart |
| --- | --- | --- |
| SoC (VSOC) | 1,25 V | **1,30 V** — darüber hat AMD auf AM5 Prozessoren zerstört |
| DRAM VDD/VDDQ | 1,45 V | 1,55 V |
| VDDIO | 1,30 V | 1,40 V |

Für 1:1-Betrieb bei 6000–6400 reichen fast immer 1,20–1,25 V SoC. Mehr Spannung
ersetzt keinen guten Speichercontroller.

**tREFI und Wärme.** `tREFI` ist der größte Einzelhebel für Spielleistung und der
einzige, bei dem Hitze zu Datenfehlern führt, die **kein Stresstest findet**.
RamTune deckelt `tREFI` deshalb hart nach der gemessenen Modultemperatur — ohne
HWiNFO-Protokoll bleibt es beim Ausgangswert 40000.

**Stille Fehler.** Nach jedem Testabschnitt wird das Windows-Ereignisprotokoll
auf korrigierte Hardwarefehler (WHEA-Logger 19 und verwandte) gelesen. Ein
System kann eine Nacht lang jeden Stresstest bestehen und trotzdem instabil
sein — der Prozessor bügelt die Fehler selbst aus und meldet sie nur dorthin.
**Ein einziger solcher Fehler macht den Lauf ungültig**, egal was der Test sagt.

**Wenn nichts mehr geht.** Rechner ausschalten, zweimal beim Hochfahren
abwürgen — dann setzt das Board das BIOS zurück. Danach:

```bash
python ramtune.py rettung
```

nennt die letzte Einstellung, die nachweislich stabil war. Der Zustand wird vor
jedem Test auf die Platte geschrieben und übersteht jeden Absturz.

## Was realistisch dabei herauskommt

Für einen 9800X3D mit 2×32 GB:

- **1:1-Betrieb (UCLK = MCLK)** ist das Ziel. Realistisch 6000, mit gutem Kit
  6200–6400. 6400 im 1:1 ist bereits selten, 6600 Glückssache.
- **Enge Timings bringen mehr als hohe Taktraten.** Die 96 MB Zwischenspeicher
  des X3D fangen Bandbreite ohnehin ab. Der Gewinn liegt bei den
  1%-Perzentilen, nicht beim Durchschnitts-FPS.
- **Größenordnung:** EXPO etwa 68–75 ns, gut abgestimmt etwa 58–63 ns.
- **Der 2:1-Modus** (DDR5-8000 und höher) ist auf einem X3D fürs Spielen meist
  ein Rückschritt, trotz der größeren Zahl.
- Doppelrang-Module (2×32 GB) fordern den Speichercontroller mehr als 2×16 GB
  und laufen deutlich wärmer.

## Selbsttest

```bash
python selbsttest.py
```

Prüft ohne Hardware, was ohne Hardware prüfbar ist: die Regeln zwischen den
Timings, die Spannungsgrenzen, den Temperaturdeckel, beide Dateiparser, die
Bewertung, das Verhalten nach einem Absturz und — als eigentlichen Test — ob
die Suchstrategie gegen einen simulierten Speicher mit verborgenen Grenzen
konvergiert, ohne sie zu überschreiten.

## Aufbau

```
ramtune.py            Bedienung (pruefen, start, weiter, dauertest, bericht, rettung)
selbsttest.py         Prüfung der Logik ohne Hardware
ramtune/config.py     Sicherheitsgrenzen, Teststufen, Ablageorte
ramtune/state.py      Zustand, der Neustarts und Abstürze übersteht
ramtune/profiles.py   Wissensbasis: Speicherchips, Timings, BIOS-Feldnamen
ramtune/plan.py       die Leiter: was als Nächstes probiert wird
ramtune/detect.py     Module, Bestückung, ZenTimings, Temperatur
ramtune/stress.py     Stabilitätstests starten und auswerten
ramtune/bench.py      Latenz, Bandbreite, Punktzahl
ramtune/whea.py       stille Hardwarefehler aus dem Ereignisprotokoll
ramtune/report.py     HTML-Bericht
ramtune/system.py     Windows-Zugriffe (gekapselt, damit der Rest testbar bleibt)
ramtune/tools.py      findet die externen Werkzeuge
daten/                Zustand, Läufe, Protokolle, Bericht (entsteht beim Laufen)
```

## Woher die Werte stammen

Die Startwerte und Grenzen kommen aus dem, was die Übertakter-Gemeinde für
Zen 4/5 erarbeitet hat — insbesondere die Timing-Sets von
[buildzoid / Actually Hardcore Overclocking](https://www.patreon.com/buildzoid)
und die AM5-Sammelthreads auf [Overclock.net](https://www.overclock.net/).
Es sind Startpunkte, keine Zusagen: Jedes Kit ist anders, und genau deshalb
testet RamTune jeden einzelnen Schritt nach.

Nicht verwendet wird der vielerorts noch empfohlene *DRAM Calculator for Ryzen* —
er kennt nur Zen 2/3 und kein DDR5.
