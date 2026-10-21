/**
 * Lernstand auf dem Gerät (localStorage). Kein Konto, kein Server.
 * Alles liegt unter einem eigenen Schlüssel, damit andere Apps derselben Adresse nichts berühren.
 */
import { dayKey } from './srs.js';

const KEY = 'parliamo.v1';

function defaults() {
  return {
    v: 1,
    created: Date.now(),
    profile: {
      name: '',
      sex: null, // 'm' | 'f' – für Mustersätze wie „sono stanco/stanca“
      level: null, // 'A2' | 'B1' | 'B2'
      placement: null, // Ergebnis des Einstufungstests
      onboarded: false,
      installSkipped: false,
      soundOk: null,
      speechOk: null, // false = Spracherkennung auf diesem Gerät nicht nutzbar
    },
    settings: {
      tempo: 'normal', // 'normal' | 'calm' | 'slow'
      voiceA: null,
      voiceB: null,
      newPerDay: 10,
      speechMode: 'auto', // 'auto' = Mikrofon-Knopf, 'keyboard' = Diktieren über die Tastatur
      sfx: true,
      minutes: 15,
      focus: null, // Bereich für neue Wörter, null = automatisch
    },
    cards: {}, // Eintrags-ID → Wiederholungszustand
    days: {}, // 'JJJJ-MM-TT' → { sec, newW, rev, ok, bad }
    done: { listen: {}, role: {}, notes: {}, pron: {}, drill: {} },
    quiz: { games: 0, best: 0, bank: 0, millions: 0, blitzBest: 0, blitzGames: 0, seen: {}, area: {} },
    hints: { block: 0 },
  };
}

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, data) {
  for (const k of Object.keys(data || {})) {
    const v = data[k];
    if (isObj(v) && isObj(base[k])) base[k] = merge(base[k], v);
    else base[k] = v;
  }
  return base;
}

let state = null;
let timer = null;
let storageOk = true;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? merge(defaults(), JSON.parse(raw)) : defaults();
  } catch {
    state = defaults();
    storageOk = false;
  }
  return state;
}

export function S() {
  return state || load();
}

function flush() {
  if (!state) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    storageOk = true;
    return true;
  } catch {
    storageOk = false;
    return false;
  }
}

export function save(now = false) {
  clearTimeout(timer);
  if (now) return flush();
  timer = setTimeout(flush, 250);
  return true;
}

export function storageWorks() {
  return storageOk;
}

export function today() {
  const k = dayKey();
  const days = S().days;
  if (!days[k]) days[k] = { sec: 0, newW: 0, rev: 0, ok: 0, bad: 0 };
  return days[k];
}

export function addTime(sec) {
  if (sec > 0 && sec < 3600) {
    today().sec += Math.round(sec);
    save();
  }
}

function dayDone(k) {
  const d = S().days[k];
  return !!d && (d.sec >= 60 || d.done > 0);
}

/** Lerntage am Stück (heute zählt mit, sobald gelernt wurde). */
export function streak() {
  const d = new Date();
  let n = 0;
  if (!dayDone(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  while (dayDone(dayKey(d.getTime())) && n < 3650) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function exportJSON() {
  return JSON.stringify({ app: 'parliamo', version: 1, exported: new Date().toISOString(), data: S() });
}

export function importJSON(text) {
  const o = JSON.parse(text);
  const data = o && o.app === 'parliamo' ? o.data : null;
  if (!isObj(data) || !isObj(data.cards)) throw new Error('Das ist keine Parliamo-Sicherung.');
  state = merge(defaults(), data);
  flush();
}

export function resetAll() {
  state = defaults();
  flush();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
