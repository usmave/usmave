/**
 * Vorlesen (Sprachausgabe des iPhones) und Spracherkennung (Safari).
 * Beides wird beim Start geprüft; fehlt etwas, weicht die App aus.
 */

const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
let voices = [];
let unlocked = false;

export const ttsAvailable = !!synth;

function refresh() {
  if (!synth) return;
  try {
    voices = synth.getVoices().filter((v) => /^it([-_]|$)/i.test(v.lang || ''));
  } catch {
    voices = [];
  }
}

if (synth) {
  refresh();
  try {
    synth.onvoiceschanged = refresh;
  } catch {
    /* ältere Systeme */
  }
}

function quality(v) {
  const id = `${v.voiceURI || ''} ${v.name || ''}`.toLowerCase();
  if (id.includes('premium')) return 3;
  if (id.includes('enhanced') || id.includes('erweitert') || id.includes('verbessert')) return 2;
  return v.localService === false ? 0.5 : 1;
}

/** Italienische Stimmen, beste zuerst. */
export function italianVoices() {
  refresh();
  return voices.slice().sort((a, b) => quality(b) - quality(a));
}

export function voiceLabel(v) {
  if (!v) return 'Standardstimme';
  const q = quality(v);
  const name = (v.name || 'Stimme').replace(/\s*\(.*\)\s*$/, '');
  return q >= 3 ? `${name} (Premium)` : q >= 2 ? `${name} (verbessert)` : name;
}

/** Stimme A (Erzähler/Gegenüber) und B (zweite Person im Dialog). */
export function voiceFor(which, settings = {}) {
  const list = italianVoices();
  if (!list.length) return null;
  const want = which === 'B' ? settings.voiceB : settings.voiceA;
  const picked = want && list.find((x) => x.voiceURI === want);
  if (picked) return picked;
  const a = (settings.voiceA && list.find((x) => x.voiceURI === settings.voiceA)) || list[0];
  if (which === 'A') return a;
  return list.find((x) => x.voiceURI !== a.voiceURI && quality(x) >= quality(a) - 1) || a;
}

export const RATES = { normal: 0.95, calm: 0.8, slow: 0.62 };

/** iOS lässt Sprachausgabe erst nach einer Berührung zu – einmal stumm anstoßen. */
export function unlock() {
  if (unlocked || !synth) return;
  unlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.lang = 'it-IT';
    synth.speak(u);
  } catch {
    /* nichts */
  }
}

let current = null;

/** Liest einen Text vor; das Promise erfüllt sich am Ende (oder nach einer Sicherheitsfrist). */
export function speak(text, { rate = RATES.normal, voice = null, pitch = 1 } = {}) {
  return new Promise((resolve) => {
    if (!synth || !text) {
      resolve(false);
      return;
    }
    let done = false;
    let guard = null;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = (voice && voice.lang) || 'it-IT';
    if (voice) u.voice = voice;
    u.rate = rate;
    u.pitch = pitch;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      if (current === u) current = null;
      resolve(ok);
    };
    u.onend = () => finish(true);
    u.onerror = () => finish(false);
    guard = setTimeout(() => finish(true), 2000 + (String(text).length * 95) / rate);
    current = u; // Referenz halten, sonst bricht manche Engine ab
    try {
      if (synth.paused) synth.resume();
      synth.speak(u);
    } catch {
      finish(false);
    }
  });
}

export function stopSpeaking() {
  if (!synth) return;
  try {
    synth.cancel();
  } catch {
    /* nichts */
  }
  current = null;
}

export function isSpeaking() {
  return !!(synth && synth.speaking);
}

/* ---------------- Spracherkennung ---------------- */

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const sttAvailable = !!SR;
let rec = null;

/** Fehler, nach denen der Mikrofon-Knopf in diesem Gerät nicht mehr angeboten wird. */
export const FATAL_STT = ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'unsupported', 'start-failed'];

/**
 * Hört einmal zu. Erfüllt sich mit { text, alts } oder lehnt mit { code } ab
 * (z. B. 'no-speech', 'not-allowed', 'network', 'aborted').
 */
export function listen({ onPartial, maxMs = 12000, lang = 'it-IT' } = {}) {
  return new Promise((resolve, reject) => {
    if (!SR) {
      reject({ code: 'unsupported' });
      return;
    }
    abortListening();
    let r;
    try {
      r = new SR();
    } catch {
      reject({ code: 'unsupported' });
      return;
    }
    rec = r;
    let timer = null;
    let settled = false;
    let finalText = '';
    let interim = '';
    let alts = [];
    const end = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (rec === r) rec = null;
      fn();
    };
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 3;
    r.onresult = (e) => {
      let fin = '';
      interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          fin += res[0].transcript;
          alts = Array.from(res).map((a) => a.transcript);
        } else interim += res[0].transcript;
      }
      if (fin) finalText = fin;
      if (onPartial) onPartial(`${finalText} ${interim}`.trim());
    };
    r.onerror = (e) => end(() => reject({ code: (e && e.error) || 'error' }));
    r.onend = () =>
      end(() => {
        const text = (finalText || interim).trim();
        if (!text) reject({ code: 'no-speech' });
        else resolve({ text, alts: alts.length ? alts : [text] });
      });
    timer = setTimeout(() => {
      try {
        r.stop();
      } catch {
        /* nichts */
      }
    }, maxMs);
    try {
      r.start();
    } catch {
      end(() => reject({ code: 'start-failed' }));
    }
  });
}

/** Zuhören beenden und das bisher Gehörte auswerten. */
export function stopListening() {
  if (rec) {
    try {
      rec.stop();
    } catch {
      /* nichts */
    }
  }
}

export function abortListening() {
  if (rec) {
    const r = rec;
    rec = null;
    try {
      r.abort();
    } catch {
      /* nichts */
    }
  }
}
