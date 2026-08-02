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

## Wie der Übungswechsel gedacht ist

Die App trennt **Übung** (Name + Verlauf) und **Platz im Plan**. Daraus ergeben sich drei Wege:

| Situation | Weg in der App | Was mit dem Verlauf passiert |
| --- | --- | --- |
| Übung heißt jetzt anders, ist aber dieselbe | Plan → Übung antippen → **Umbenennen** | Läuft ununterbrochen weiter |
| Neuer Plan, Übung fliegt raus, neue kommt rein | Plan → Übung antippen → **Durch andere Übung ersetzen** | Neue Übung startet eigenen Verlauf; die alte wandert ins Archiv und behält alles. Kommt sie in ein paar Monaten zurück, sind die alten Gewichte sofort wieder da |
| Gerät besetzt, heute eine Alternative | Im laufenden Training → **⋯ → Andere Übung — nur heute** | Wird unter der Ersatzübung protokolliert (mit Vermerk „als Ersatz"), der Plan bleibt unverändert — nächstes Mal steht wieder das Original da |

## Bedienung im Studio

- **Training** → Tag wählen → los. Gewicht und Wiederholungen sind bereits mit den
  Werten vom letzten Mal vorbelegt; nur ändern, was sich geändert hat.
- Nach jedem Satz auf **✓** tippen. Nur abgehakte Sätze landen im Verlauf,
  nicht abgehakte werden beim Beenden verworfen.
- **＋ Satz** / **− Satz**, wenn es mal mehr oder weniger werden.
- Einseitige Übungen (Kurzhantel, einarmiges Rudern …) haben getrennte Felder für
  **Wdh L** und **Wdh R** — dafür die Übung als *einseitig* markieren
  (⋯-Menü an der Übung oder Plan → Übung → *Als einseitig markieren*).

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
