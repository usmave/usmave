/**
 * Lernstand auswerten: fällige Wiederholungen, neue Einträge, Stufen je Bereich,
 * Lernkurve. Und das Ergebnis einer Abfrage verbuchen.
 */
import { S, save, today } from './store.js';
import { schedule, freshCard, knownCard, strength, dayKey, DAY } from './srs.js';
import { areas, areaById, items, itemById, levelRank } from './content.js';

export function card(item) {
  return S().cards[item.id] || null;
}

export function userLevel() {
  return S().profile.level || 'A2';
}

/** Neuen Eintrag beginnen (nach der Vorstellung). */
export function startItem(item) {
  if (!S().cards[item.id]) {
    S().cards[item.id] = freshCard();
    today().newW++;
    save();
  }
  return S().cards[item.id];
}

/** „Kenne ich schon“ */
export function markKnown(item) {
  const isNew = !S().cards[item.id];
  S().cards[item.id] = knownCard();
  if (isNew) today().newW++;
  save();
}

/** Ergebnis einer Abfrage verbuchen. outcome: again | hard | good | easy */
export function record(item, outcome) {
  const c = S().cards[item.id] || freshCard();
  S().cards[item.id] = schedule(c, outcome);
  const t = today();
  t.rev++;
  if (outcome === 'again') t.bad++;
  else t.ok++;
  save();
  return S().cards[item.id];
}

export function resetItem(item) {
  delete S().cards[item.id];
  save();
}

/** Fällige Einträge: Lernende zuerst, dann am längsten überfällige. */
export function dueItems(now = Date.now(), areaId = null) {
  const out = [];
  for (const [id, c] of Object.entries(S().cards)) {
    if (c.due > now) continue;
    const it = itemById.get(id);
    if (!it || (areaId && it.area !== areaId)) continue;
    out.push([c.learning ? 0 : 1, c.due, it]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out.map((x) => x[2]);
}

export function dueCount(areaId = null) {
  return dueItems(Date.now(), areaId).length;
}

/** Reihenfolge der Niveaus für neue Einträge, je nach eigenem Niveau. */
function levelOrder() {
  const L = levelRank(userLevel());
  return (item) => {
    const r = levelRank(item.lvl);
    if (r === L) return 0;
    if (r < L) return 1;
    return 2 + (r - L);
  };
}

/**
 * Neue Einträge eines Bereichs: erst das eigene Niveau, dann leichtere, dann schwerere;
 * auf vier Wörter kommt etwa ein Satz.
 */
export function newItems(areaId, n, { wave = null } = {}) {
  const area = areaById.get(areaId);
  if (!area || n <= 0) return [];
  const rank = levelOrder();
  const fresh = area.items.filter((x) => !S().cards[x.id] && (wave == null || inWave(x, wave)));
  const sorted = fresh.slice().sort((a, b) => rank(a) - rank(b) || a.n - b.n);
  const words = sorted.filter((x) => x.kind === 'w');
  const phrases = sorted.filter((x) => x.kind === 'p');
  const out = [];
  while (out.length < n && (words.length || phrases.length)) {
    const wantPhrase = phrases.length && (out.length % 5 === 4 || !words.length);
    out.push(wantPhrase ? phrases.shift() : words.shift());
  }
  return out;
}

export function newLeft(areaId) {
  const area = areaById.get(areaId);
  return area ? area.items.filter((x) => !S().cards[x.id]).length : 0;
}

/* ---------------- Lernpfad in Runden ----------------
 * Runde 1: in allen Bereichen das eigene Niveau und alles Leichtere.
 * Danach je eine Runde pro schwererem Niveau (B1, dann B2) – wieder durch alle Bereiche.
 * So kennt man früh die Grundwörter aller Themen, statt erst einen Bereich bis B2 auszureizen.
 */
const TOP = 2; // B2

function inWave(item, w) {
  const L = levelRank(userLevel());
  const r = levelRank(item.lvl);
  return w <= L ? r <= L : r === w;
}

function waveLeft(area, w) {
  return area.items.filter((x) => !S().cards[x.id] && inWave(x, w)).length;
}

function waveProgress(area, w) {
  const inW = area.items.filter((x) => inWave(x, w));
  return inW.filter((x) => S().cards[x.id]).length / Math.max(1, inW.length);
}

/** Aktuelle Runde des Lernpfads (0 = A2, 1 = B1, 2 = B2) oder null, wenn alles kennengelernt ist. */
export function pathWave() {
  const L = levelRank(userLevel());
  for (let w = L; w <= TOP; w++) if (areas.some((a) => waveLeft(a, w) > 0)) return w;
  return null;
}

/** Bereich für neue Einträge: der gewählte Fokus oder der nächste im Lernpfad. */
export function focusArea() {
  const f = S().settings.focus;
  if (f && areaById.has(f) && newLeft(f) > 0) return areaById.get(f);
  const w = pathWave();
  if (w == null) return areas[0] || null;
  const open = areas.filter((a) => waveLeft(a, w) > 0);
  // In dieser Runde angefangene Bereiche zuerst fertig machen, dann der nächste in der Reihenfolge
  const started = open.filter((a) => a.items.some((x) => S().cards[x.id] && inWave(x, w)));
  if (started.length) {
    started.sort((a, b) => waveProgress(b, w) - waveProgress(a, w) || a.n - b.n);
    return started[0];
  }
  return open[0];
}

/**
 * Neue Einträge für „Heute lernen“: aus dem Fokus-Bereich (alle Niveaus)
 * oder aus dem Lernpfad (nur die aktuelle Runde, bei Bedarf aus dem nächsten Bereich aufgefüllt).
 */
export function pathItems(n) {
  const area = focusArea();
  if (!area || n <= 0) return [];
  if (S().settings.focus === area.id) return newItems(area.id, n);
  const w = pathWave();
  if (w == null) return [];
  const out = newItems(area.id, n, { wave: w });
  for (const a of areas) {
    if (out.length >= n) break;
    if (a === area || a.n < area.n) continue;
    out.push(...newItems(a.id, n - out.length, { wave: w }));
  }
  return out;
}

/* ---------------- Stufen je Bereich ---------------- */

export const STAGES = ['Noch nicht begonnen', 'Erste Schritte', 'Gut dabei', 'Sicher', 'Meisterhaft'];

export function areaStats(area) {
  const counts = [0, 0, 0, 0, 0]; // neu, in Arbeit, frisch, sitzt, fest
  for (const it of area.items) counts[strength(S().cards[it.id])]++;
  const total = area.items.length || 1;
  const seen = total - counts[0];
  const learned = counts[2] + counts[3] + counts[4];
  const solid = counts[3] + counts[4];
  const dlgDone = area.dialogs.filter((d) => S().done.listen[d.id]).length;
  const roleDone = area.roles.filter((r) => S().done.role[r.id]).length;
  const quizBest = S().quiz.area[area.id] || 0;
  const needDlg = area.dialogs.length > 0;
  const needRole = area.roles.length > 0;
  const c1 = seen / total >= 0.25;
  const c2 = learned / total >= 0.6 && (!needDlg || dlgDone > 0);
  const c3 = learned / total >= 0.85 && (!needRole || roleDone > 0) && quizBest >= 16000;
  const c4 = solid / total >= 0.85 && quizBest >= 125000;
  const stage = c1 ? (c2 ? (c3 ? (c4 ? 4 : 3) : 2) : 1) : 0;
  return { counts, total, seen, learned, solid, dlgDone, roleDone, quizBest, stage, needDlg, needRole };
}

/** Was fehlt zur nächsten Stufe? (für die Lernkurve im Bereich) */
export function nextStageHint(area, st = areaStats(area)) {
  const t = st.total;
  const miss = [];
  if (st.stage === 0) {
    miss.push(`Lerne ${Math.max(1, Math.ceil(t * 0.25) - st.seen)} Einträge kennen.`);
  } else if (st.stage === 1) {
    const n = Math.ceil(t * 0.6) - st.learned;
    if (n > 0) miss.push(`Festige noch ${n} Einträge (einmal richtig wiederholen).`);
    if (st.needDlg && !st.dlgDone) miss.push('Hör dir den Dialog an.');
  } else if (st.stage === 2) {
    const n = Math.ceil(t * 0.85) - st.learned;
    if (n > 0) miss.push(`Festige noch ${n} Einträge.`);
    if (st.needRole && !st.roleDone) miss.push('Spiel das Rollenspiel durch.');
    if (st.quizBest < 16000) miss.push('Erreiche im Quiz mindestens 16.000 €.');
  } else if (st.stage === 3) {
    const n = Math.ceil(t * 0.85) - st.solid;
    if (n > 0) miss.push(`Bring ${n} Einträge auf „sitzt“ (mehrmals über Tage richtig).`);
    if (st.quizBest < 125000) miss.push('Erreiche im Quiz mindestens 125.000 €.');
  }
  return miss;
}

/* ---------------- Gesamtzahlen & Lernkurve ---------------- */

export function totalsNow() {
  const counts = [0, 0, 0, 0, 0];
  let seen = 0;
  for (const it of items) {
    const s = strength(S().cards[it.id]);
    counts[s]++;
    if (s > 0) seen++;
  }
  return { counts, seen, learned: counts[2] + counts[3] + counts[4] };
}

/** Kumulierte Zahl kennengelernter Einträge pro Tag, die letzten `days` Tage. */
export function curve(days = 30) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const perDay = new Array(days).fill(0);
  let before = 0;
  for (const c of Object.values(S().cards)) {
    const t = c.seen || 0;
    const idx = Math.floor((t - start.getTime()) / DAY);
    if (idx < 0) before++;
    else if (idx < days) perDay[idx]++;
    else perDay[days - 1]++;
  }
  const out = [];
  let sum = before;
  for (const v of perDay) {
    sum += v;
    out.push(sum);
  }
  return out;
}

export function minutesSeries(days = 14) {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  const out = [];
  for (let i = 0; i < days; i++) {
    const x = S().days[dayKey(d.getTime())];
    out.push({ key: dayKey(d.getTime()), min: Math.round(((x && x.sec) || 0) / 60), day: d.getDay() });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Wort des Tages: gleichbleibend für den Tag, bevorzugt aus angefangenen Bereichen. */
export function wordOfDay() {
  const key = dayKey();
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const pool = items.filter((x) => x.kind === 'w' && levelRank(x.lvl) <= levelRank(userLevel()) + 1);
  return pool.length ? pool[hash % pool.length] : null;
}
