# Übergabe: Parliamo weiterbauen

Diese Datei ist nur für die Weiterarbeit gedacht. Vor dem Veröffentlichen löschen.

## Stand

- 66 Bereiche, 3.184 Wörter, 877 Sätze (zusammen 4.061 Einträge), 264 Notizen, 60 Dialoge, 59 Rollenspiele, 768 Quizfragen.
- `node tools/check-content.mjs` meldet keine Fehler.
- Neu gegenüber der Live-Version (Branch `claude/iphone-trainingsplan-app-wb0ci8`): 23 Bereiche (erzaehlen, beschreiben, diskutieren, gespraech, vorschlaege, beziehungen, schule, technik, medien, umwelt, tiere, kleidung, stadt, geld, kultur, gesellschaft, geschichte, lebensmittel, haushalt, wellness, verben2, verben3, nomen), neue Gruppen „Fließend sprechen“ (`sprechen`) und „Themen für Gespräche“ (`themen`) in `js/content.js`, Lernpfad in Runden nach Niveau (`js/session.js`, `js/today.js`), Hilfetext „Wie geht der Lernpfad?“ (`js/views.js`), `tools/dupcheck.py`.

## Auftrag von Markus

„Mach mehr Wörter, damit am Ende fließend gesprochen werden kann.“ Ziel: rund 4.500 Einträge bis Niveau B2. Die App läuft ohne Claude auf einem fremden iPhone; die Nutzerin bzw. der Nutzer ist technisch unerfahren.

## Regeln von Markus

- Antworten auf Deutsch, knapp, nur deutsche Satzzeichen („…“, –).
- Nicht eigenständig im Internet recherchieren; bei Unklarheiten nachfragen. Inhalte nur mit gut gesichertem Wissen schreiben.
- Das Hochladen in den Ordner `parliamo/` ist freigegeben. Außerhalb davon nichts ändern: Die Trainingsplan-App im Wurzelordner bleibt unberührt. Die falsche Adresse im Wurzel-README (https://usmave.github.io/ statt https://usmave.github.io/usmave/) nur nach seiner Zustimmung korrigieren.

## Offene Aufgaben

1. Bereich `falsche-freunde` schreiben (Gruppe `basis`, ohne Dialog und Rollenspiel, Emoji z. B. 🙃). Noch nicht im Bestand: il magazzino, l'autista, il pullman, il mobile, lo studio, la stanza, tante, il golf, la nota, fine, la salsa, il cartone, il prospetto, la stampa, il concorso, la promozione, eventualmente, lo speck, l'arma, sensibile, la ditta, l'azienda, la rendita, il preservativo, il mister, il beauty, il box, il fallimento, il dottorato, l'opuscolo, lo scatolone, i conservanti, la pancetta. Schon vorhanden, also nur im Quiz verwenden: caldo, la camera, la firma, la cantina, la patente, le tasse, i confetti, il latte, la panna, la mappa, il tema, l'asilo, educato, il premio, largo, lo stipendio, avere torto.
2. Weitere Bereiche bis etwa 4.500 Einträge, z. B. „Adjektive 2“ (Basis), Zeitangaben und Häufigkeit, Sport und Bewegung, Urlaub planen. Vorher immer Dubletten prüfen: `printf "la parola\nil cane\n" | python3 tools/dupcheck.py`.
3. Reihenfolge in `data/index.js` prüfen. Der Lernpfad läuft in Runden nach Niveau; innerhalb einer Runde gilt die Reihenfolge der Liste.
4. `README.md` (im Ordner `parliamo/`): Zahl der Bereiche und Einträge aktualisieren. `CONTENT.md`: Gruppen `sprechen` und `themen` ergänzen.
5. Prüfen: `node tools/check-content.mjs --all` (Hinweise auf gleiche Bedeutung in mehreren Bereichen auflösen), `node tools/gen-sw.mjs`, dann `timeout 600 node tools/smoke-test.mjs`, falls Playwright und Chromium verfügbar sind.
6. Veröffentlichen: diese Datei löschen und den Stand in den Branch `claude/iphone-trainingsplan-app-wb0ci8` übernehmen (Quelle von GitHub Pages). Live prüfen: https://usmave.github.io/usmave/parliamo/data/index.js – die App liegt unter https://usmave.github.io/usmave/parliamo/.
7. Markus kurz mit den neuen Zahlen informieren.

## Hinweise zum Schreiben

- Format: siehe `CONTENT.md`. Keine Backticks und kein `${` in den Bereichsdateien.
- Pro Themenbereich: 4 Notizen, 50 bis 80 Wörter über A2, B1 und B2, typische Sätze mit kurzem „Warum so?“, ein Dialog mit 4 Fragen, ein Rollenspiel mit etwa 5 Schritten, 12 Quizfragen.
- Ich-Sätze mit Adjektiv oder Mittelwort brauchen `{o|a}`, z. B. «Sono stanc{o|a}.»
- Quizantworten dürfen sich nicht nur durch Akzente unterscheiden („rido“ und „ridò“ gelten als gleich). Falsche Antworten dürfen nicht zufällig auch richtig sein.
- Keine Markennamen, politisch neutral bleiben.
