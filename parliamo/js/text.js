/**
 * Textwerkzeuge: Normalisieren, Vergleichen, italienische Zahlen und Uhrzeiten.
 * Reine Funktionen ohne DOM – laufen auch in Node (tools/check-content.mjs).
 */

const UNITS = ['zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove',
  'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette',
  'diciotto', 'diciannove'];
const TENS = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];

export const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
  'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
  'September', 'Oktober', 'November', 'Dezember'];

function below1000(n) {
  if (n < 20) return UNITS[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    let w = TENS[t];
    if (u === 0) return w;
    if (u === 1 || u === 8) w = w.slice(0, -1); // ventuno, ventotto
    return w + UNITS[u];
  }
  const h = Math.floor(n / 100);
  const r = n % 100;
  let w = h === 1 ? 'cento' : UNITS[h] + 'cento';
  if (r === 0) return w;
  if (r === 8 || (r >= 80 && r < 90)) w = w.slice(0, -1); // centotto, centottanta
  return w + below1000(r);
}

/** Ganze Zahl als italienisches Zahlwort: 23 → "ventitré", 1998 → "millenovecentonovantotto". */
export function numIt(value) {
  const n = Math.floor(Math.abs(Number(value)));
  if (!Number.isFinite(n)) return '';
  let out;
  if (n < 1000) out = below1000(n);
  else if (n < 1000000) {
    const k = Math.floor(n / 1000);
    const r = n % 1000;
    out = (k === 1 ? 'mille' : below1000(k) + 'mila') + (r ? below1000(r) : '');
  } else if (n < 1e9) {
    const m = Math.floor(n / 1e6);
    const r = n % 1e6;
    out = (m === 1 ? 'un milione' : numIt(m) + ' milioni') + (r ? ' ' + numIt(r) : '');
  } else return String(n);
  // Zusammengesetzte Zahlen auf -tre tragen einen Akzent: ventitré, centotré, milletré
  if (n > 20 && n % 10 === 3 && n % 100 !== 13) out = out.replace(/tre$/, 'tré');
  return out;
}

/** Ziffern im Text in Zahlwörter umwandeln (nur für Vergleiche). */
export function numbersToWords(s) {
  return String(s)
    .replace(/(\d{1,2})[:.](\d{2})(?!\d)/g, (_, h, m) => numIt(+h) + (+m ? ' e ' + numIt(+m) : ''))
    .replace(/(\d+),(\d{1,2})(?!\d)/g, (_, a, b) => numIt(+a) + ' ' + numIt(+(b.length === 1 ? b + '0' : b)))
    .replace(/\d+/g, (d) => (d.length <= 9 ? numIt(+d) : d))
    .replace(/€/g, ' euro ')
    .replace(/%/g, ' per cento ');
}

export function stripAccents(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
}

const QUOTES = /[’‘`´ʼ′]/g;
const PUNCT = /[.,!?;:"“”„‟«»‹›()[\]{}…–—\-_/\\¿¡*+=<>@#&^~|]/g;

/**
 * Vergleichsform: klein, ohne Satzzeichen, Apostroph trennt (l'albergo → l albergo),
 * Ziffern als Wörter, standardmäßig ohne Akzente.
 */
export function norm(s, keepAccents = false) {
  let t = String(s ?? '').toLowerCase().replace(QUOTES, "'");
  t = numbersToWords(t);
  t = t.replace(PUNCT, ' ').replace(/'/g, ' ').replace(/\s+/g, ' ').trim();
  return keepAccents ? t : stripAccents(t);
}

export function tokens(s) {
  const n = norm(s);
  return n ? n.split(' ') : [];
}

/** Levenshtein-Distanz. */
export function lev(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/* ---------- Getippte (oder einzeln gesprochene) Vokabel prüfen ---------- */

function prep(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(QUOTES, "'")
    .replace(PUNCT, ' ')
    .replace(/\s*'\s*/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const ART = /^(il|lo|la|i|gli|le|un|uno|una)\s+(.+)$|^(l|un)'(.+)$/;
function splitArt(s) {
  const m = s.match(ART);
  if (!m) return { art: '', rest: s };
  return m[1] ? { art: m[1], rest: m[2] } : { art: m[3] + "'", rest: m[4] };
}
const flat = (s) => s.replace(/['\s]/g, '');

function closeEnough(a, b) {
  const L = b.length;
  const d = lev(a, b);
  return (L >= 5 && d <= 1) || (L >= 9 && d <= 2);
}

function checkOne(input, target) {
  const a = prep(input);
  const b = prep(target);
  if (!a) return 'empty';
  if (flat(a) === flat(b)) return 'exact';
  const A = stripAccents(a);
  const B = stripAccents(b);
  if (flat(A) === flat(B)) return 'accent';
  const ta = splitArt(A);
  const tb = splitArt(B);
  if (tb.art && flat(ta.rest) === flat(tb.rest)) return 'article';
  if (closeEnough(flat(A), flat(B))) return 'typo';
  if (tb.art && closeEnough(flat(ta.rest), flat(tb.rest))) return 'article';
  return 'wrong';
}

const RANK = { exact: 5, accent: 4, typo: 3, article: 2, wrong: 0, empty: -1 };

/**
 * Prüft eine Antwort gegen die Zielform. Mehrere richtige Formen sind mit " / " getrennt.
 * kind: exact | accent (nur Akzent fehlt) | typo (Tippfehler) | article (Artikel fehlt/falsch) | wrong | empty
 */
export function checkTyped(input, target) {
  const alts = splitAlts(target);
  let best = { kind: 'empty', target: alts[0] };
  for (const t of alts) {
    const kind = checkOne(input, t);
    if (RANK[kind] > RANK[best.kind]) best = { kind, target: t };
  }
  return best;
}

export function splitAlts(target) {
  return String(target).split(' / ').map((s) => s.trim()).filter(Boolean);
}

/** Bewertung einer Prüfung für die Wiederholungsplanung. */
export function outcomeOf(kind) {
  if (kind === 'exact' || kind === 'accent') return 'good';
  if (kind === 'typo' || kind === 'article') return 'hard';
  return 'again';
}

/* ---------- Gesprochenen Satz Wort für Wort abgleichen ---------- */

function near(a, b) {
  if (a === b) return true;
  const L = Math.max(a.length, b.length);
  const d = lev(a, b);
  return (L >= 4 && d <= 1) || (L >= 8 && d <= 2);
}

/**
 * Gleicht einen Zielsatz mit dem Erkannten ab.
 * Rückgabe: { words: [{ w, st: 'ok' | 'near' | 'miss' | 'skip' }], score: 0..1 }
 */
export function alignWords(target, spoken) {
  // Schlüssel = letzter Teil nach einem Apostroph („l'albergo“ → „albergo“)
  const words = String(target).split(/\s+/).filter(Boolean).map((w) => ({ w, key: norm(w).split(' ').pop() || '' }));
  const units = words.filter((u) => u.key);
  const S = tokens(spoken);
  const n = units.length;
  const m = S.length;
  const score = (a, b) => (a === b ? 2 : near(a, b) ? 1 : 0);
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = score(units[i - 1].key, S[j - 1]);
      dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], s ? dp[i - 1][j - 1] + s : -1);
    }
  }
  let i = n;
  let j = m;
  for (const u of units) u.st = 'miss';
  while (i > 0 && j > 0) {
    const s = score(units[i - 1].key, S[j - 1]);
    if (s && dp[i][j] === dp[i - 1][j - 1] + s) {
      units[i - 1].st = s === 2 ? 'ok' : 'near';
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  let pts = 0;
  for (const u of units) pts += u.st === 'ok' ? 1 : u.st === 'near' ? 0.6 : 0;
  for (const w of words) if (!w.key) w.st = 'skip';
  return { words: words.map(({ w, st }) => ({ w, st })), score: n ? pts / n : 0 };
}

/* ---------- Rollenspiel: Inhaltspunkte erkennen ---------- */

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const patCache = new Map();
function patternRe(p) {
  let re = patCache.get(p);
  if (!re) {
    const parts = String(p).trim().split(/\s+/).map((w) => {
      const star = w.endsWith('*');
      const base = norm(w.replace(/\*+$/, '')).replace(/ /g, ' ');
      return escapeRe(base) + (star ? '[a-z]*' : '');
    });
    re = new RegExp(' ' + parts.join(' ') + ' ');
    patCache.set(p, re);
  }
  return re;
}

export function hasPattern(text, pattern) {
  return patternRe(pattern).test(' ' + norm(text) + ' ');
}

/**
 * Prüft, welche Inhaltspunkte eine Antwort enthält.
 * needs: [{ h: 'Hinweis auf Deutsch', a: ['muster', 'präfix*', 'zwei wörter'] }]
 */
export function matchNeeds(text, needs) {
  const t = ' ' + norm(text) + ' ';
  const res = needs.map((g) => ({ h: g.h, ok: g.a.some((p) => patternRe(p).test(t)) }));
  const hit = res.filter((r) => r.ok).length;
  return { res, all: hit === res.length, score: res.length ? hit / res.length : 1 };
}

/* ---------- Männliche/weibliche Form in Mustersätzen ---------- */

/** "Sono stanc{o|a}." → je nach Einstellung "stanco" oder "stanca". */
export function g(text, sex) {
  return String(text ?? '').replace(/\{([^{}|]*)\|([^{}|]*)\}/g, (_, m, f) => (sex === 'f' ? f : m));
}

/* ---------- Uhrzeiten und Preise sprechen ---------- */

function hourWord(h) {
  if (h === 0 || h === 24) return 'mezzanotte';
  if (h === 12) return 'mezzogiorno';
  const h12 = h % 12;
  return h12 === 1 ? "l'una" : 'le ' + numIt(h12);
}

/**
 * Umgangssprachliche Uhrzeit: { phrase: "le sette e mezza", copula: "Sono" }.
 * h: 0–23, m: 0–59 (in Fünferschritten am natürlichsten)
 */
export function timeColloquial(h, m) {
  let hour = h;
  let rest = '';
  if (m === 0) rest = '';
  else if (m === 15) rest = ' e un quarto';
  else if (m === 30) rest = ' e mezza';
  else if (m === 45) {
    hour = (h + 1) % 24;
    rest = ' meno un quarto';
  } else if (m > 30) {
    hour = (h + 1) % 24;
    rest = ' meno ' + numIt(60 - m);
  } else rest = ' e ' + numIt(m);
  const hw = hourWord(hour);
  const singular = hw === "l'una" || hw === 'mezzogiorno' || hw === 'mezzanotte';
  return { phrase: hw + rest, copula: singular ? 'È' : 'Sono' };
}

/** "alle diciotto e quarantacinque" (24-Stunden-Form, wie in Durchsagen). */
export function timeDigital(h, m) {
  const head = h === 1 ? "all'una" : h === 0 ? 'a mezzanotte' : `alle ${numIt(h)}`;
  return head + (m ? ' e ' + numIt(m) : '');
}

/** Preis als Sprechform: 12,40 → "dodici euro e quaranta". */
export function priceIt(cents) {
  const e = Math.floor(cents / 100);
  const c = cents % 100;
  if (e === 0) return numIt(c) + ' centesimi';
  const euro = e === 1 ? 'un euro' : numIt(e) + ' euro';
  return c ? `${euro} e ${numIt(c)}` : euro;
}

/** Eingabe wie "12,40", "12.4", "12 40", "12" in Cent umrechnen (oder null). */
export function parsePrice(input) {
  const s = String(input ?? '').trim().replace(/€|euro/gi, '').trim();
  const m = s.match(/^(\d{1,4})(?:[,.\s](\d{1,2}))?$/);
  if (!m) return null;
  const cents = m[2] ? (m[2].length === 1 ? +m[2] * 10 : +m[2]) : 0;
  return +m[1] * 100 + cents;
}
