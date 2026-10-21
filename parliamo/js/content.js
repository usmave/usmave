/**
 * Liest alle Lebensbereiche (data/areas/*.js) ein und baut die Verzeichnisse auf.
 * Format: siehe CONTENT.md. Läuft auch in Node (tools/check-content.mjs).
 */
import { norm, splitAlts, g } from './text.js';
import AREA_TEXTS from '../data/index.js';

export const GROUPS = [
  { id: 'reisen', title: 'Unterwegs', sub: 'Reisen, Verkehr, Unterkunft' },
  { id: 'essen', title: 'Essen & Trinken', sub: 'Bar, Restaurant, Markt' },
  { id: 'erledigen', title: 'Einkaufen & Erledigungen', sub: 'Geschäfte, Bank, Post' },
  { id: 'leute', title: 'Unter Leuten', sub: 'Freunde, Smalltalk, Gefühle' },
  { id: 'alltag', title: 'Alltag & Zuhause', sub: 'Wohnen, Arbeit, Freizeit' },
  { id: 'gesundheit', title: 'Gesundheit & Notfälle', sub: 'Apotheke, Arzt, Hilfe' },
  { id: 'basis', title: 'Grundwortschatz', sub: 'Verben, Adjektive, kleine Wörter' },
];

export const LEVELS = ['A2', 'B1', 'B2'];
export const LEVEL_NAMES = { A2: 'Grundlagen', B1: 'Mittelstufe', B2: 'Fortgeschritten' };

export const QUIZ_CATS = {
  k: 'Land & Leute',
  r: 'Redewendung',
  f: 'Falscher Freund',
  g: 'Grammatik',
  s: 'Was sagt man?',
  w: 'Wortschatz',
};

export const problems = [];
export const areas = [];
export const areaById = new Map();
export const items = [];
export const itemById = new Map();
export const dialogs = [];
export const dialogById = new Map();
export const roles = [];
export const roleById = new Map();
export const quizQs = [];
export const notes = [];

function warn(where, msg) {
  problems.push(`${where}: ${msg}`);
}

/** Felder an „|“ trennen – aber nicht innerhalb von {o|a}. */
function fields(s) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (const ch of String(s)) {
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === '|' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const LETTER = /[a-zà-öø-ÿ]/i;

/** Wortform im Satz suchen (ganze Wörter, Groß/klein egal). */
function findForm(sentence, form) {
  const s = sentence.toLowerCase();
  const f = form.toLowerCase();
  if (!f) return -1;
  let from = 0;
  for (;;) {
    const i = s.indexOf(f, from);
    if (i < 0) return -1;
    const before = i > 0 ? s[i - 1] : ' ';
    const after = i + f.length < s.length ? s[i + f.length] : ' ';
    if (!LETTER.test(before) && !LETTER.test(after)) return i;
    from = i + 1;
  }
}

/** Artikel vorn abschneiden: „la camera“ → „camera“, „l'albergo“ → „albergo“ */
export function bare(form) {
  return String(form)
    .replace(/^(il|lo|la|i|gli|le|un|uno|una)\s+/i, '')
    .replace(/^(l|un)'/i, '')
    .trim();
}

function posOf(form, note) {
  if (/\b(agg|avv|adj)/i.test(note)) return 'a';
  if (/\bverb/i.test(note)) return 'v';
  const t = form.toLowerCase();
  if (/^(il|lo|la|i|gli|le|un|uno|una)\s/.test(t) || /^(l|un)'/.test(t)) return 'n';
  if (!t.includes(' ') && /(are|ere|ire|rre|rsi)$/.test(t)) return 'v';
  if (t.includes(' ')) return 'x';
  return 'a';
}

function addItem(area, lvl, kind, f, where) {
  const [itRaw = '', de = '', a3 = '', a4 = '', a5 = ''] = f;
  if (!itRaw || !de) {
    warn(where, 'Italienisch oder Deutsch fehlt');
    return;
  }
  const extra = (itRaw.match(/\(([^)]*)\)/g) || []).map((s) => s.slice(1, -1)).join(' ');
  const plain = itRaw.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const alts = splitAlts(plain);
  const item = {
    id: '',
    area: area.id,
    kind, // 'w' Wort, 'p' Satz
    lvl,
    it: itRaw,
    de,
    alts,
    extra,
    pos: kind === 'p' ? 'p' : posOf(alts[0], extra),
    ex: '',
    exde: '',
    note: '',
    cloze: null,
  };
  if (kind === 'p') item.note = a3;
  else {
    item.ex = a3;
    item.exde = a4;
    item.note = a5;
  }
  item.id = `${area.id}:${kind === 'p' ? '>' : ''}${norm(alts[0], true).replace(/ /g, '_')}`;
  if (item.ex) {
    const m = item.ex.match(/\[([^\]]+)\]/);
    if (m) {
      item.cloze = { pre: item.ex.slice(0, m.index), word: m[1], post: item.ex.slice(m.index + m[0].length) };
      item.ex = item.ex.replace(/\[([^\]]+)\]/g, '$1');
    } else {
      for (const a of alts) {
        const form = bare(a);
        const i = findForm(item.ex, form);
        if (i >= 0) {
          item.cloze = { pre: item.ex.slice(0, i), word: item.ex.slice(i, i + form.length), post: item.ex.slice(i + form.length) };
          break;
        }
      }
    }
  }
  if (itemById.has(item.id)) {
    warn(where, `doppelt im Bereich: ${alts[0]}`);
    return;
  }
  item.n = area.items.length;
  area.items.push(item);
  items.push(item);
  itemById.set(item.id, item);
}

function parseNeeds(spec) {
  return String(spec)
    .split(';')
    .map((part) => {
      const i = part.indexOf(':');
      if (i < 0) return null;
      const h = part.slice(0, i).trim();
      const a = part
        .slice(i + 1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return h && a.length ? { h, a } : null;
    })
    .filter(Boolean);
}

function splitPair(s) {
  const i = s.indexOf('||');
  if (i < 0) return [s.trim(), ''];
  return [s.slice(0, i).trim(), s.slice(i + 2).trim()];
}

function parseArea(txt, fileNo) {
  let area = null;
  let lvl = 'A2';
  let dlg = null;
  let role = null;
  let step = null;
  const lines = String(txt).split('\n');
  lines.forEach((raw, n) => {
    const line = raw.trim();
    const where = `${area ? area.id : `Datei ${fileNo + 1}`}:${n + 1}`;
    if (!line || line.startsWith('//')) return;

    if (dlg) {
      if (line === '/D') {
        const voices = new Map();
        for (const l of dlg.lines) {
          if (!voices.has(l.who)) voices.set(l.who, voices.size);
          l.v = voices.get(l.who);
        }
        dlg.speakers = [...voices.keys()];
        dialogs.push(dlg);
        dialogById.set(dlg.id, dlg);
        area.dialogs.push(dlg);
        dlg = null;
      } else if (line.startsWith('= ')) dlg.intro = line.slice(2).trim();
      else if (line.startsWith('? ')) {
        const f = fields(line.slice(2));
        if (f.length < 4) warn(where, 'Dialogfrage braucht Frage und mind. 3 Antworten');
        else dlg.qs.push({ q: f[0], a: f.slice(1) });
      } else {
        const m = line.match(/^([^:|]{1,30}):\s*(.+)$/);
        if (!m) warn(where, `Dialogzeile unverständlich: ${line.slice(0, 40)}`);
        else {
          const [it, de] = splitPair(m[2]);
          dlg.lines.push({ who: m[1].trim(), it, de });
        }
      }
      return;
    }

    if (role) {
      if (line === '/R') {
        if (step) role.steps.push(step);
        roles.push(role);
        roleById.set(role.id, role);
        area.roles.push(role);
        role = null;
        step = null;
        return;
      }
      const tag = line[0];
      const rest = line.slice(1).trim();
      if (tag === '=') role.intro = rest;
      else if (tag === 'P') {
        if (step) role.steps.push(step);
        const [p, pde] = splitPair(rest);
        step = { p, pde, task: '', need: [], model: '', mde: '', alts: [] };
      } else if (tag === 'E') {
        const [e, ede] = splitPair(rest);
        role.end = e;
        role.endde = ede;
      } else if (!step) warn(where, 'Rollenspiel: zuerst eine P-Zeile');
      else if (tag === 'T') step.task = rest;
      else if (tag === 'N') step.need = parseNeeds(rest);
      else if (tag === 'M') {
        const [m, mde] = splitPair(rest);
        step.model = m;
        step.mde = mde;
      } else if (tag === 'A') step.alts.push(rest);
      else warn(where, `Rollenspiel-Zeile unbekannt: ${line.slice(0, 30)}`);
      return;
    }

    if (line.startsWith('@')) {
      const [id, title, icon, group] = fields(line.slice(1));
      area = { id, title, icon, group, n: areas.length, items: [], notes: [], dialogs: [], roles: [], quiz: [] };
      if (areaById.has(id)) warn(where, `Bereich doppelt: ${id}`);
      areas.push(area);
      areaById.set(id, area);
      lvl = 'A2';
      return;
    }
    if (!area) {
      warn(where, 'Zeile vor dem Bereichskopf');
      return;
    }
    if (/^#(A1|A2|B1|B2|C1)$/.test(line)) {
      lvl = line.slice(1) === 'A1' ? 'A2' : line.slice(1) === 'C1' ? 'B2' : line.slice(1);
      return;
    }
    if (line.startsWith('! ')) {
      const [t, x] = fields(line.slice(2));
      const note = { id: `${area.id}:${area.notes.length}`, area: area.id, t, x };
      area.notes.push(note);
      notes.push(note);
      return;
    }
    if (line.startsWith('> ')) {
      addItem(area, lvl, 'p', fields(line.slice(2)), where);
      return;
    }
    if (/^Q\s+\d/.test(line)) {
      const f = fields(line.slice(1));
      const [d, cat, q, ...rest] = f;
      const ans = rest.slice(0, 4);
      const q0 = {
        id: `${area.id}:q${area.quiz.length}`,
        area: area.id,
        d: Math.max(1, Math.min(5, parseInt(d, 10) || 1)),
        cat: cat || 'w',
        q,
        a: ans,
        x: rest[4] || '',
      };
      if (ans.length < 4) warn(where, 'Quizfrage braucht 4 Antworten');
      area.quiz.push(q0);
      quizQs.push(q0);
      return;
    }
    if (/^D\s/.test(line)) {
      const [id, title, l, kind] = fields(line.slice(2));
      dlg = { id: `${area.id}:${id}`, area: area.id, title, lvl: l || lvl, kind: kind || 'Dialog', intro: '', lines: [], qs: [] };
      return;
    }
    if (/^R\s/.test(line)) {
      const [id, title, l] = fields(line.slice(2));
      role = { id: `${area.id}:${id}`, area: area.id, title, lvl: l || lvl, intro: '', steps: [], end: '', endde: '' };
      step = null;
      return;
    }
    addItem(area, lvl, 'w', fields(line), where);
  });
  if (dlg) warn(`${area && area.id}`, 'Dialog ohne /D');
  if (role) warn(`${area && area.id}`, 'Rollenspiel ohne /R');
}

AREA_TEXTS.forEach((t, i) => parseArea(t, i));

/* ---------------- Abfragen ---------------- */

export function levelRank(l) {
  return LEVELS.indexOf(l);
}

export function areasOf(groupId) {
  return areas.filter((a) => a.group === groupId);
}

/** Zufällige Reihenfolge, lazy – für große Listen. */
function* randomOrder(arr) {
  const idx = arr.map((_, i) => i);
  for (let i = idx.length - 1; i >= 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
    yield arr[idx[i]];
  }
}

const STOP_DE = new Set([
  'eine', 'einen', 'einem', 'einer', 'eines', 'sich', 'etwas', 'jemand', 'jemanden', 'jemandem', 'nicht',
  'sein', 'haben', 'werden', 'oder', 'und', 'mit', 'für', 'von', 'auf', 'aus', 'beim', 'zum', 'zur', 'ganz',
  'sehr', 'mehr', 'viel', 'noch', 'schon', 'machen', 'gehen', 'geben', 'nach', 'über', 'unter', 'kein', 'keine',
]);

function deWords(s) {
  return String(s)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-zäöüß]+/)
    .filter((w) => w.length >= 4 && !STOP_DE.has(w));
}

/** Haben zwei deutsche Bedeutungen ein gemeinsames Kernwort? (dann als Antwortoption ungeeignet) */
export function overlapDe(a, b) {
  const A = new Set(deWords(a));
  return deWords(b).some((w) => A.has(w));
}

/** Ablenker für Multiple Choice: möglichst gleicher Bereich und gleiche Wortart. */
export function distractors(item, n = 3) {
  const out = [];
  const seenDe = new Set([norm(item.de)]);
  const seenIt = new Set([norm(item.alts[0])]);
  const area = areaById.get(item.area);
  const same = (x) => x.kind === item.kind && (item.kind === 'p' || x.pos === item.pos);
  const pools = [
    area ? area.items.filter(same) : [],
    items.filter((x) => same(x) && x.lvl === item.lvl),
    items.filter(same),
    items.filter((x) => x.kind === item.kind),
  ];
  for (const pool of pools) {
    for (const x of randomOrder(pool)) {
      if (out.length >= n) return out;
      if (x === item) continue;
      const d = norm(x.de);
      const i = norm(x.alts[0]);
      if (seenDe.has(d) || seenIt.has(i)) continue;
      if (overlapDe(x.de, item.de)) continue;
      if (out.some((o) => overlapDe(o.de, x.de))) continue;
      seenDe.add(d);
      seenIt.add(i);
      out.push(x);
    }
  }
  return out;
}

function suffixLen(a, b) {
  let k = 0;
  while (k < 3 && k < a.length && k < b.length && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
  return k;
}

/** Andere Wortformen für Lückensätze – ähnliche Endung, damit die Grammatik nicht verrät. */
export function clozeOptions(item, sex, n = 3) {
  const target = g(item.cloze.word, sex);
  const tw = norm(target);
  const words = target.split(/\s+/).length;
  const cands = [];
  for (const x of items) {
    if (x === item || !x.cloze || x.kind !== item.kind || x.pos !== item.pos) continue;
    const w = g(x.cloze.word, sex);
    const nw = norm(w);
    if (!nw || nw === tw) continue;
    if (overlapDe(x.de, item.de)) continue;
    const score =
      suffixLen(nw, tw) + (x.area === item.area ? 1.5 : 0) + (w.split(/\s+/).length === words ? 1 : 0) + Math.random() * 1.2;
    cands.push([score, w]);
  }
  cands.sort((a, b) => b[0] - a[0]);
  const out = [];
  const seen = new Set([tw]);
  for (const [, w] of cands) {
    const k = norm(w);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
    if (out.length >= n) break;
  }
  return out;
}

/** Ablenker für Satz-Bedeutungen (Dialog-/Beispielsätze). */
export function otherSentences(item, n = 3) {
  const out = [];
  const seen = new Set([norm(item.exde)]);
  for (const x of randomOrder(items)) {
    if (out.length >= n) break;
    if (x === item || !x.exde || x.lvl !== item.lvl) continue;
    const k = norm(x.exde);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x.exde);
  }
  return out;
}

export const totals = {
  get items() {
    return items.length;
  },
  get words() {
    return items.filter((x) => x.kind === 'w').length;
  },
  get phrases() {
    return items.filter((x) => x.kind === 'p').length;
  },
};
