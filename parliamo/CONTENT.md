# Inhalte schreiben – Format

Jeder Lebensbereich ist eine Datei `data/areas/<id>.js`, die einen Text exportiert:

```js
export default `
@ restaurant | Im Restaurant | 🍽️ | essen
...
`;
```

Keine Backticks und kein `${` im Text verwenden.

## Zeilenarten

| Zeile | Bedeutung |
|---|---|
| `@ id \| Titel \| Emoji \| Gruppe` | Kopf des Bereichs (erste Zeile). Gruppen: reisen, essen, erledigen, leute, alltag, gesundheit, basis |
| `! Titel \| Text` | „Gut zu wissen“-Notiz (2–4 Sätze) |
| `#A2` / `#B1` / `#B2` | Niveau für die folgenden Einträge |
| `it \| de \| Beispielsatz \| Übersetzung \| Hinweis?` | Wort. Im Beispielsatz die Wortform in `[eckige Klammern]`, sonst wird sie automatisch gesucht |
| `> it \| de \| Warum so?` | Typischer Satz mit kurzer Erklärung |
| `Q Schwierigkeit 1–5 \| Kategorie \| Frage \| richtig \| falsch \| falsch \| falsch \| Erklärung` | Quizfrage. Kategorien: k Kultur, r Redewendung, f falscher Freund, g Grammatik, s Situation, w Wortschatz |
| `D id \| Titel \| Niveau \| Art` … `/D` | Dialog zum Hören |
| `R id \| Titel \| Niveau` … `/R` | Rollenspiel |
| `// …` | Kommentar |

### Im Wort-/Satzfeld

- `(…)` ist eine Anmerkung, wird angezeigt, aber nicht abgefragt und nicht vorgelesen: `l'albergo (m)`, `l'uovo (pl. le uova)`
- ` / ` trennt gleichwertige Formen: `il biglietto / il ticket`
- `{o|a}` steht für männliche/weibliche Form der lernenden Person: `Sono stanc{o|a}.`
- Italienisches in deutschen Texten in «Guillemets» – die App setzt es kursiv und liest es auf Antippen vor. Deutsche Zitate in „…“.

### Dialog

```
D tavolo | Einen Tisch reservieren | A2 | Telefonat
= Situation auf Deutsch.
Cameriera: Trattoria da Gino, buonasera! || Trattoria da Gino, guten Abend!
Cliente: Buonasera, vorrei prenotare un tavolo. || Guten Abend, ich möchte einen Tisch reservieren.
? Frage | richtige Antwort | falsch | falsch | falsch
/D
```

Sprecher bekommen in der Reihenfolge ihres Auftretens Stimme 1, Stimme 2, …

### Rollenspiel

```
R ordinare | Bestellen | A2
= Situation auf Deutsch.
P Satz des Gegenübers || Übersetzung
T Aufgabe auf Deutsch
N Hinweis: muster, präfix*, zwei wörter ; Hinweis: muster
M Musterantwort || Übersetzung
A weitere mögliche Antwort
E Schlusssatz des Gegenübers || Übersetzung
/R
```

`N`: Inhaltspunkte, durch `;` getrennt. Jeder Punkt hat einen Hinweis und Muster (durch Komma getrennt). `*` am Wortende = beliebige Endung. Zahlen dürfen als Wort geschrieben werden (2 = due). Die Musterantwort muss alle Punkte erfüllen – `node tools/check-content.mjs` prüft das.
