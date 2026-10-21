/**
 * Prüft alle Inhalte: Format, Dubletten, Quizfragen, Dialoge, Rollenspiele
 * (Musterantwort muss die eigenen Inhaltspunkte erfüllen) und typische
 * Rechtschreibfehler im Italienischen.
 *
 *   node tools/check-content.mjs          Übersicht + Fehler
 *   node tools/check-content.mjs --all    auch Hinweise (Warnungen) zeigen
 */
import * as C from '../js/content.js';
import { matchNeeds, norm, g, numIt, timeColloquial, priceIt } from '../js/text.js';

const showAll = process.argv.includes('--all');
const errors = [];
const warns = [];
const err = (w, m) => errors.push(`${w}: ${m}`);
const warn = (w, m) => warns.push(`${w}: ${m}`);

for (const p of C.problems) err('Format', p);

/* ---------- Rechtschreibung ---------- */

const B = '(?<![a-zà-öø-ÿ])';
const E = '(?![a-zà-öø-ÿ])';
const IT_RULES = [
  [new RegExp(`${B}il (s[bcdfgklmnpqrtvz]|z|gn|ps|pn|x)`, 'i'), '„il“ vor s+Konsonant/z/gn/ps → „lo“'],
  [new RegExp(`${B}un (s[bcdfgklmnpqrtvz]|z|gn|ps)`, 'i'), '„un“ vor s+Konsonant/z/gn/ps → „uno“'],
  [new RegExp(`${B}il [aeiouàèéìòùh]`, 'i'), '„il“ vor Vokal → „l’“'],
  [new RegExp(`${B}i [aeiouàèéìòù]`, 'i'), '„i“ vor Vokal → „gli“'],
  [new RegExp(`${B}i (s[bcdfgklmnpqrtvz]|z|gn|ps)`, 'i'), '„i“ vor s+Konsonant/z → „gli“'],
  [new RegExp(`${B}qual'`, 'i'), '„qual è“ ohne Apostroph'],
  [new RegExp(`${B}(perchè|poichè|affinchè|benchè|finchè|nè|sè|cioé|pò)${E}`, 'i'), 'falscher Akzent'],
  [/(^|\s)é(\s|$)/, '„è“ statt „é“'],
  [new RegExp(`${B}po${E}(?!['’])`, 'i'), '„po’“ mit Apostroph'],
  [new RegExp(`${B}e'(\\s|$)`, 'i'), '„è“ statt „e’“'],
  [new RegExp(`${B}(piu|perche|citta|caffe|cosi|gia|puo|lunedi|martedi|mercoledi|giovedi|venerdi|universita|verita|liberta)${E}`, 'i'), 'Akzent fehlt?'],
  [/[äöüß]/i, 'deutscher Umlaut im Italienischen'],
  [/ {2,}/, 'doppeltes Leerzeichen'],
  [/\s[,.!?;:]/, 'Leerzeichen vor Satzzeichen'],
];

function checkIt(where, text) {
  if (!text) return;
  const t = String(text);
  for (const [re, msg] of IT_RULES) {
    if (msg && re.test(t)) warn(where, `${msg}: „${t.slice(0, 70)}“`);
  }
  if ((t.match(/«/g) || []).length !== (t.match(/»/g) || []).length) err(where, `«» unausgeglichen: ${t.slice(0, 60)}`);
  if ((t.match(/\[/g) || []).length !== (t.match(/\]/g) || []).length) err(where, `[] unausgeglichen: ${t.slice(0, 60)}`);
  if (/\{[^}|]*\}/.test(t)) err(where, `{x|y} unvollständig: ${t.slice(0, 60)}`);
}

function checkDe(where, text) {
  if (!text) return;
  const t = String(text);
  if (/"/.test(t)) warn(where, `gerade Anführungszeichen statt „…“: ${t.slice(0, 60)}`);
  if (/\.\.\./.test(t)) warn(where, `„...“ statt „…“: ${t.slice(0, 60)}`);
  if ((t.match(/„/g) || []).length !== (t.match(/“/g) || []).length) warn(where, `„“ unausgeglichen: ${t.slice(0, 60)}`);
  if ((t.match(/«/g) || []).length !== (t.match(/»/g) || []).length) err(where, `«» unausgeglichen: ${t.slice(0, 60)}`);
  if (/ {2,}/.test(t)) warn(where, `doppeltes Leerzeichen: ${t.slice(0, 60)}`);
  // Italienisches in «…» mitprüfen
  for (const m of t.matchAll(/«([^»]+)»/g)) checkIt(where, m[1]);
}

/* ---------- Einträge ---------- */

const seenForm = new Map();
for (const it of C.items) {
  const w = it.id;
  checkIt(w, it.it.replace(/\([^)]*\)/g, ""));
  checkIt(w, it.ex);
  checkDe(w, it.de);
  checkDe(w, it.exde);
  checkDe(w, it.note);
  if (!C.LEVELS.includes(it.lvl)) err(w, `Niveau ${it.lvl}`);
  if (it.kind === 'w') {
    if (!it.ex) warn(w, 'Wort ohne Beispielsatz');
    else if (!it.exde) warn(w, 'Beispielsatz ohne Übersetzung');
    if (it.ex && !it.cloze) warn(w, `Wort im Beispielsatz nicht gefunden – [Klammern] setzen: ${it.ex.slice(0, 50)}`);
    if (it.ex && !/[.!?…]$/.test(it.ex.trim())) warn(w, 'Beispielsatz ohne Satzzeichen am Ende');
  }
  const key = norm(it.alts[0]);
  if (seenForm.has(key) && seenForm.get(key) !== it.area) warn(w, `auch in Bereich „${seenForm.get(key)}“`);
  else seenForm.set(key, it.area);
}

/* ---------- Bereiche ---------- */

const rows = [];
for (const a of C.areas) {
  const w = a.items.filter((x) => x.kind === 'w').length;
  const p = a.items.filter((x) => x.kind === 'p').length;
  const lv = C.LEVELS.map((l) => a.items.filter((x) => x.lvl === l).length).join('/');
  rows.push(`${a.icon} ${a.id.padEnd(14)} ${String(w).padStart(3)} W ${String(p).padStart(3)} S  ${lv.padEnd(9)} ${a.notes.length} N ${a.dialogs.length} D ${a.roles.length} R ${String(a.quiz.length).padStart(2)} Q`);
  if (!C.GROUPS.some((gr) => gr.id === a.group)) err(a.id, `Gruppe unbekannt: ${a.group}`);
  if (a.items.length < 20) warn(a.id, `nur ${a.items.length} Einträge`);
  if (a.notes.length < 2) warn(a.id, 'weniger als 2 Notizen');
  if (a.group !== 'basis' && !a.dialogs.length) warn(a.id, 'kein Dialog');
  if (a.group !== 'basis' && !a.roles.length) warn(a.id, 'kein Rollenspiel');
  if (a.quiz.length < 5) warn(a.id, `nur ${a.quiz.length} Quizfragen`);
  for (const n of a.notes) {
    checkDe(n.id, n.t);
    checkDe(n.id, n.x);
  }
}

/* ---------- Quiz ---------- */

for (const q of C.quizQs) {
  const w = q.id;
  if (q.a.length !== 4) err(w, `${q.a.length} Antworten statt 4`);
  const keys = q.a.map((x) => norm(x));
  if (new Set(keys).size !== keys.length) err(w, 'Antworten doppelt');
  if (!C.QUIZ_CATS[q.cat]) err(w, `Kategorie „${q.cat}“`);
  checkDe(w, q.q);
  for (const x of q.a) checkDe(w, x);
  checkDe(w, q.x);
  if (!q.x) warn(w, 'Quizfrage ohne Erklärung');
}

/* ---------- Dialoge ---------- */

for (const d of C.dialogs) {
  if (d.lines.length < 4) err(d.id, 'zu wenige Zeilen');
  if (d.qs.length < 2) warn(d.id, 'weniger als 2 Fragen');
  if (d.speakers.length > 4) warn(d.id, 'mehr als 4 Sprecher');
  if (!d.intro) warn(d.id, 'ohne Einleitung');
  for (const l of d.lines) {
    checkIt(d.id, l.it);
    checkDe(d.id, l.de);
    if (!l.de) warn(d.id, `Zeile ohne Übersetzung: ${l.it.slice(0, 40)}`);
  }
  for (const q of d.qs) {
    if (q.a.length !== 4) err(d.id, `Frage mit ${q.a.length} Antworten: ${q.q}`);
    const keys = q.a.map((x) => norm(x));
    if (new Set(keys).size !== keys.length) err(d.id, `Antworten doppelt: ${q.q}`);
    checkDe(d.id, q.q);
  }
}

/* ---------- Rollenspiele ---------- */

for (const r of C.roles) {
  if (r.steps.length < 3) warn(r.id, `nur ${r.steps.length} Schritte`);
  if (!r.intro) warn(r.id, 'ohne Einleitung');
  r.steps.forEach((s, i) => {
    const w = `${r.id}#${i + 1}`;
    if (!s.p || !s.task || !s.model) err(w, 'P, T oder M fehlt');
    if (!s.need.length) err(w, 'keine Inhaltspunkte (N)');
    checkIt(w, s.p);
    checkIt(w, s.model);
    checkDe(w, s.task);
    checkDe(w, s.pde);
    checkDe(w, s.mde);
    for (const sex of ['m', 'f']) {
      const m = matchNeeds(g(s.model, sex), s.need);
      if (!m.all) err(w, `Musterantwort (${sex}) erfüllt nicht: ${m.res.filter((x) => !x.ok).map((x) => x.h).join(', ')} – „${s.model}“`);
    }
    for (const alt of s.alts) {
      const m = matchNeeds(g(alt, 'm'), s.need);
      if (!m.all) warn(w, `Alternative erfüllt nicht: ${m.res.filter((x) => !x.ok).map((x) => x.h).join(', ')} – „${alt}“`);
      checkIt(w, alt);
    }
  });
}

/* ---------- Zahlen ---------- */

const NUM = { 21: 'ventuno', 23: 'ventitré', 28: 'ventotto', 101: 'centouno', 108: 'centotto', 180: 'centottanta', 1000: 'mille', 1998: 'millenovecentonovantotto', 2023: 'duemilaventitré', 21000: 'ventunomila', 113: 'centotredici' };
for (const [n, wd] of Object.entries(NUM)) if (numIt(+n) !== wd) err('Zahlen', `${n} → ${numIt(+n)} statt ${wd}`);
const tc = timeColloquial(12, 45);
if (tc.phrase !== "l'una meno un quarto" || tc.copula !== 'È') err('Uhrzeit', JSON.stringify(tc));
if (priceIt(1240) !== 'dodici euro e quaranta') err('Preis', priceIt(1240));

/* ---------- Ausgabe ---------- */

console.log(rows.join('\n'));
console.log(
  `\n${C.areas.length} Bereiche, ${C.totals.words} Wörter, ${C.totals.phrases} Sätze, ${C.notes.length} Notizen, ${C.dialogs.length} Dialoge, ${C.roles.length} Rollenspiele, ${C.quizQs.length} Quizfragen`,
);
if (warns.length) {
  console.log(`\n${warns.length} Hinweise${showAll ? ':' : ' (mit --all anzeigen)'}`);
  if (showAll) console.log(warns.map((x) => '  · ' + x).join('\n'));
}
if (errors.length) {
  console.log(`\n${errors.length} FEHLER:`);
  console.log(errors.map((x) => '  ✗ ' + x).join('\n'));
  process.exit(1);
}
console.log('\nKeine Fehler.');
