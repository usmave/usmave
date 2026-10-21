# Parliamo – Italienisch für Reisen und Alltag

Eine Web-App fürs iPhone zum Italienischlernen, ohne Konto, ohne Server und ohne KI im Hintergrund. Sie läuft offline, der Lernstand bleibt auf dem Gerät.

**Adresse:** https://usmave.github.io/usmave/parliamo/

## Auf ein iPhone bringen

1. Den Link oben per WhatsApp schicken (oder in Safari eintippen).
2. In **Safari** öffnen. Wer aus WhatsApp kommt, wählt zuerst „In Safari öffnen“.
3. Teilen-Symbol (Quadrat mit Pfeil nach oben, bei neueren iPhones hinter „⋯“) → **Zum Home-Bildschirm** → **Hinzufügen**.
4. Ab jetzt Parliamo über das neue Symbol starten. Die App führt beim ersten Start durch Name, Ton-Test und Einstufungstest.

Die App erklärt die Installation beim ersten Öffnen im Browser selbst Schritt für Schritt.

Wichtig: Was man im Safari-Tab lernt und was in der installierten App, sind auf dem iPhone getrennte Speicher. Darum am besten gleich installieren und dann nur noch die App benutzen.

## Was drin ist

- **Lebensbereiche** (Unterwegs, Essen & Trinken, Erledigungen, Unter Leuten, Alltag, Gesundheit, Grundwortschatz). Jeder Bereich hat Wörter mit Beispielsatz, typische Sätze mit „Warum so?“, „Gut zu wissen“ und ein eigenes Quiz; die Situationsbereiche zusätzlich einen Dialog zum Hören und ein Rollenspiel zum Sprechen. Insgesamt 43 Bereiche mit rund 2.400 Wörtern und Sätzen.
- **Lernkurve:** Wiederholung nach der Vergessenskurve (vereinfachtes SM-2), vier Stufen je Bereich, Gesamtkurve auf der Startseite.
- **Heute lernen** in 5, 15 oder 30 Minuten: Wiederholungen, neue Einträge aus dem Lernpfad, dazu wechselnd Dialog, Rollenspiel, Blitzrunde, Zahlen, Diktat, Nachsprechen oder Aussprache.
- **Il Milione:** 15 Fragen bis zur Million mit Sicherheitsstufen bei 500 € und 16.000 € und drei Jokern (50:50, Publikum, Telefon). Dazu eine 60-Sekunden-Blitzrunde.
- **Üben:** Dialoge, Rollenspiele, Nachsprechen, Diktat, Zahlen/Preise/Uhrzeiten/Datum/Telefonnummern, Minimalpaare zur Aussprache, Einstufungstest.

Vorlesen läuft über die Stimmen des iPhones, Sprechen über die Spracherkennung von Safari. Klappt die nicht, wird automatisch auf Tippen bzw. das Diktieren der Tastatur umgestellt.

## Updates

Neue Inhalte oder Korrekturen einfach in diesen Ordner pushen. Die App lädt sie im Hintergrund und zeigt sie beim nächsten Öffnen. Vorher immer:

```bash
node tools/check-content.mjs   # Inhalte prüfen
node tools/gen-sw.mjs          # Offline-Liste und Version neu erzeugen
```

## Inhalte bearbeiten

Jeder Lebensbereich ist eine Datei in `data/areas/`. Das Format steht in [CONTENT.md](CONTENT.md). Die Reihenfolge des Lernpfads legt `data/index.js` fest.

## Aufbau

```
index.html, manifest.webmanifest, sw.js   App-Gerüst, Offline-Betrieb (sw.js wird erzeugt)
css/styles.css                            Gestaltung (hell/dunkel)
fonts/                                    Bodoni Moda (SIL Open Font License) für alles Italienische
js/app.js                                 Start, Reiter, Installationshilfe, erster Start
js/views.js                               Ansichten der Reiter
js/flow.js                                Übungsrahmen, Antwort-Bausteine
js/today.js, js/session.js, js/srs.js     Tagesprogramm, Lernstand, Wiederholungsplanung
js/content.js                             Einlesen der Inhalte
js/text.js, js/speech.js, js/store.js     Textvergleich, Zahlen, Vorlesen/Spracherkennung, Speicher
js/ex/                                    Übungen: Vokabeln, Quiz, Hören, Sprechen, Zahlen, Einstufung
data/                                     Inhalte
tools/                                    Prüfen, Service Worker erzeugen, Browser-Test, Icons
```

Browser-Test: `npm i playwright` und `node tools/smoke-test.mjs`.
