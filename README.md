# Trainingsplan

Eine kleine Web-App fürs iPhone: Trainingsplan führen und pro Übung Datum, Gewichte
und Wiederholungen protokollieren. Läuft offline, die Daten bleiben auf dem Gerät.

## Aufs iPhone holen

1. In den GitHub-Repo-Einstellungen **Settings → Pages** öffnen.
2. Bei *Source* **Deploy from a branch** wählen, als Branch den Branch dieser App
   (`claude/iphone-trainingsplan-app-wb0ci8`, oder `main` nach dem Zusammenführen),
   Ordner `/ (root)`, **Save**.
3. Nach ein bis zwei Minuten steht die Adresse dort. Weil dieses Repo so heißt wie der
   Account, ist das **https://usmave.github.io/**.
4. Diese Adresse im **Safari** auf dem iPhone öffnen (nicht Chrome — nur Safari kann Apps auf den Home-Bildschirm legen).
5. Teilen-Symbol → **Zum Home-Bildschirm**. Fertig: eigenes Icon, kein Browser-Rahmen, funktioniert ohne Empfang.

Hinweis: GitHub Pages braucht bei kostenlosen Konten ein öffentliches Repo. Öffentlich
ist dann nur der Programmcode — die Trainingsdaten stehen nirgends im Repo, die bleiben
ausschließlich auf dem iPhone.

## Dein Plan

Beim ersten Start legt **Meinen Plan anlegen** Tag A fertig an:

| # | Übung | Sätze |
|---|---|---|
| 1 | Bankdrückmaschine flach | 2 |
| 2 | Butterflymaschine | 2 |
| 3 | Bankdrückmaschine sitzend | 2 |
| 4 | Schulterdrücken Maschine sitzend | 2 |
| 5 | Seitheben Kabel | 2 |
| 6 | Trizepsdrücken Kabel | 2 |
| 7 | Dips | 3 |

Wiederholungsziele stehen bewusst leer, weil keine vorgegeben waren — in der Übung
steht dann einfach „2 Sätze". Nachtragen geht jederzeit über
Plan → Übung → *Sätze / Wiederholungen ändern*.

Tag B ist noch nicht hinterlegt. Bis dahin: Plan → **＋ Tag** → Übungen hinzufügen.
Der Tagesvorschlag auf der Startseite wechselt automatisch zwischen allen
angelegten Tagen, sobald zwei da sind.

## Wie der Übungswechsel gedacht ist

Die App trennt **Übung** (Name + Verlauf) und **Platz im Plan**. Daraus ergeben sich drei Wege:

| Situation | Weg in der App | Was mit dem Verlauf passiert |
| --- | --- | --- |
| Übung heißt jetzt anders, ist aber dieselbe | Plan → Übung antippen → **Umbenennen** | Läuft ununterbrochen weiter |
| Neuer Plan, Übung fliegt raus, neue kommt rein | Plan → Übung antippen → **Durch andere Übung ersetzen** | Neue Übung startet eigenen Verlauf; die alte wandert ins Archiv und behält alles. Kommt sie in ein paar Monaten zurück, sind die alten Gewichte sofort wieder da |
| Gerät besetzt, heute eine Alternative | Im laufenden Training → **⋯ → Andere Übung — nur heute** | Wird unter der Ersatzübung protokolliert (mit Vermerk „als Ersatz"), der Plan bleibt unverändert — nächstes Mal steht wieder das Original da |

Wenn bei der ursprünglichen Übung schon ein Satz abgehakt war, bevor du wechselst,
wandert dieser Satz **nicht** mit: er bleibt bei der Übung, bei der du ihn gemacht hast,
und die Alternative kommt als eigener Eintrag darunter. Sonst würde der Verlauf
Gewichte der einen Übung der anderen zuschreiben.

## Bedienung im Studio

Die Trainingsansicht ist bewusst karg gehalten — Übungsname, Ziel, Satzzeilen, sonst nichts.

- **Der nächste Tag wird vorgeschlagen.** Die App merkt sich, welcher Tag zuletzt
  protokolliert wurde, und schlägt beim Öffnen den nächsten in der Reihenfolge vor:
  nach Tag B kommt Tag A. Ein anderer Tag ist trotzdem immer einen Tipp entfernt.
- **Die Werte vom letzten Mal stehen blass in den Feldern.** Sie sind nicht
  eingetragen, sondern ein Vorschlag: Tippst du auf **✓**, werden sie übernommen.
  Hat sich etwas geändert, tippst du vorher die neue Zahl drüber. So sieht man auf
  einen Blick, was heute schon wirklich steht.
- Nur abgehakte Sätze landen im Verlauf; nicht abgehakte werden beim Beenden verworfen.
- **＋ Satz** hängt eine Zeile an, *Letzten Satz entfernen* im ⋯-Menü nimmt eine weg.
- Einseitige Übungen (Kurzhantel, einarmiges Rudern …) haben getrennte Felder für
  **Wdh L** und **Wdh R** — dafür die Übung als *einseitig* markieren
  (⋯-Menü an der Übung oder Plan → Übung → *Als einseitig markieren*).

## Was der Verlauf zeigt

**Pro Übung:** Bestwert, letzter Stand, Anzahl Einträge und Sätze, Volumen; darunter ein
Graph des schwersten Satzes über die Zeit und jeder einzelne Eintrag mit Datum,
Trainingstag, allen Sätzen (bester hervorgehoben), Volumen und der Veränderung zum
Mal davor (z. B. `+2,5 kg`). Bestwerte sind markiert.

**Pro Training:** Übungen, Sätze, Gesamtvolumen und Dauer, dann jede Übung mit ihren
Sätzen, ihrem Volumen und ihrer Veränderung. Ein Tipp auf eine Übung springt in deren
kompletten Verlauf.

## Daten & Backup

Alles liegt in `localStorage` auf dem iPhone — kein Konto, kein Server, keine Kosten.
Das heißt aber auch: **Handy weg = Daten weg.** Darum ab und zu unter
**Mehr → Daten exportieren** eine Sicherungsdatei in „Dateien"/iCloud Drive legen.
**Mehr → Daten importieren** spielt sie zurück (wahlweise ersetzend oder zusammenführend).

Wenn iOS lange nicht benutzte Web-Apps aufräumt, kann der Speicher geleert werden —
ein regelmäßiger Export ist die Versicherung dagegen.

## Aufbau

```
index.html              App-Gerüst
css/styles.css          Styles (dauerhaft dunkel)
js/store.js             Datenmodell, Speichern, Verlauf-Abfragen, Export/Import
js/ui.js                Sheets, Toasts, Auswahllisten
js/app.js               Ansichten: Training, Plan, Verlauf, Mehr
sw.js                   Service Worker (Offline-Betrieb)
manifest.webmanifest    Home-Bildschirm-Metadaten
icons/                  App-Icons
tools/make-icons.py     erzeugt die Icons neu
tools/smoke-test.mjs    Durchlauf durch alle Kernabläufe im Browser
```

Es gibt keinen Build-Schritt — die Dateien werden so ausgeliefert, wie sie hier liegen.
Nach Änderungen an den Dateien in `sw.js` die `CACHE`-Version hochzählen, damit das
iPhone die neue Fassung zieht.

### Tests laufen lassen

```bash
npm i playwright
node tools/smoke-test.mjs
```

Prüft den kompletten Ablauf: Plan anlegen, Training protokollieren (auch L/R),
Ersatzübung, Beenden, Verlauf, Übung ersetzen/archivieren/umbenennen, Reload.
