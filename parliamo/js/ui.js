/**
 * Kleine DOM-Werkzeuge, Symbole, Vorlesen, Töne, Bottom-Sheets und Hinweise.
 */
import { S } from './store.js';
import { speak, stopSpeaking, voiceFor, RATES, unlock } from './speech.js';
import { g } from './text.js';

/* ---------------- DOM ---------------- */

/** h('button.btn.primary', { onClick }, 'Text', kind, …) */
export function h(tag, props, ...kids) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    kids.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = el.className ? `${el.className} ${v}` : v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false || k === true) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : String(k));
  }
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export function pick(a) {
  return a[Math.floor(Math.random() * a.length)];
}

export function fmt(n) {
  return Number(n).toLocaleString('de-DE');
}

export function euro(n) {
  return n >= 1000000 ? `${fmt(n / 1000000)} Million €` : `${fmt(n)} €`;
}

/** „1 Wort“ / „3 Wörter“ */
export function count(n, one, many) {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

/* ---------------- Symbole ---------------- */

const PATHS = {
  speaker: '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mic: '<rect x="9" y="3" width="6" height="11.5" rx="3" fill="currentColor" stroke="none"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cross: '<path d="M7 7l10 10M17 7L7 17"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
  chevron: '<path d="M9.5 6l6 6-6 6"/>',
  back: '<path d="M14.5 6l-6 6 6 6"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13" stroke-width="3"/>',
  replay: '<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4.5V9h4.5"/>',
  home: '<path d="M4 11.5L12 5l8 6.5"/><path d="M6.5 10v9h11v-9"/><path d="M10.5 19v-4.5h3V19"/>',
  areas: '<path d="M4 6.5l5-2 6 2 5-2v13l-5 2-6-2-5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  trophy: '<path d="M8 4.5h8v5a4 4 0 0 1-8 0z"/><path d="M8 6.5H5a3 3 0 0 0 3 4M16 6.5h3a3 3 0 0 1-3 4M12 13.5V17M8.5 20h7M9.5 17h5v3h-5z"/>',
  practice: '<path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2"/><rect x="3.5" y="13.5" width="4" height="6" rx="1.5" fill="currentColor" stroke="none"/><rect x="16.5" y="13.5" width="4" height="6" rx="1.5" fill="currentColor" stroke="none"/>',
  more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  share: '<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M8.5 10.5H6.5v9.5h11v-9.5h-2"/>',
  plusSquare: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-3.2 2.2-5.1 3.6-7.1.4 1.7 1.3 2.8 2.4 3.3-.2-3.2 1-5.9 3.4-8.1.3 3.2 1.9 4.9 3.1 6.7 1 1.5 1.5 3 1.5 5.1 0 3.6-3 6.2-7.5 6.2z" fill="currentColor" stroke="none"/>',
  bulb: '<path d="M9 17.5h6M10 20.5h4"/><path d="M8.5 14.5c-1.6-1.2-2.5-3-2.5-5a6 6 0 0 1 12 0c0 2-.9 3.8-2.5 5-.6.5-1 1.1-1 1.9v.6H9.5v-.6c0-.8-.4-1.4-1-1.9z"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4.5 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z"/>',
  people: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.5 14.2a4.6 4.6 0 0 1 5.5 4.8"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z" fill="currentColor" stroke="none"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
};

export function ico(name, cls = '') {
  const span = document.createElement('span');
  span.className = `ico ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
  return span;
}

/* ---------------- Vorlesen ---------------- */

/** Text für die Sprachausgabe säubern: Anmerkungen, Klammern, Guillemets raus. */
export function cleanSay(text) {
  return g(String(text ?? ''), S().profile.sex)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[[\]«»]/g, '')
    .replace(/\s\/\s/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Italienisch vorlesen – mit den Einstellungen zu Stimme und Tempo. */
export function say(text, { slow = false, voice = 'A', pitch = 1 } = {}) {
  const st = S().settings;
  const rate = slow ? RATES.slow : RATES[st.tempo] || RATES.normal;
  return speak(cleanSay(text), { rate, voice: voiceFor(voice, st), pitch });
}

export { stopSpeaking };

/** Runder Lautsprecher-Knopf. Langes Drücken liest langsam vor. */
export function spk(text, { slow = false, big = false, label = '', voice = 'A' } = {}) {
  const b = h(
    'button.spk' + (big ? '.big' : '') + (label ? '.labeled' : ''),
    { type: 'button', 'aria-label': slow ? 'Langsam vorlesen' : 'Vorlesen' },
    slow ? h('span.spk-slow', '🐢') : ico('speaker'),
    label && h('span.spk-label', label),
  );
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    unlock();
    stopSpeaking();
    b.classList.add('on');
    await say(text, { slow, voice });
    b.classList.remove('on');
  });
  return b;
}

/**
 * Text mit «italienischen» Stellen: diese werden kursiv in Bodoni gesetzt
 * und lassen sich antippen, um sie zu hören.
 */
export function rich(text, { tap = true } = {}) {
  const frag = document.createDocumentFragment();
  const parts = String(text ?? '').split(/(«[^»]+»)/);
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith('«') && p.endsWith('»')) {
      const inner = g(p.slice(1, -1), S().profile.sex);
      const span = h('span.itq', inner);
      if (tap) {
        span.setAttribute('role', 'button');
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          unlock();
          stopSpeaking();
          say(inner);
        });
      }
      frag.append(span);
    } else frag.append(p);
  }
  return frag;
}

/** Italienischer Text mit Anmerkungen in Klammern (kleiner gesetzt). */
export function itText(text) {
  const frag = document.createDocumentFragment();
  const t = g(String(text ?? ''), S().profile.sex);
  for (const p of t.split(/(\([^)]*\))/)) {
    if (!p) continue;
    if (p.startsWith('(')) frag.append(h('span.it-note', p.slice(1, -1)));
    else frag.append(p);
  }
  return frag;
}

/* ---------------- Töne ---------------- */

let actx = null;
let suspendTimer = null;

export function sfx(kind) {
  if (S().settings.sfx === false) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = actx || new AC();
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime + 0.01;
    const seq = {
      ok: [[659, 0], [880, 0.09]],
      meh: [[523, 0], [587, 0.1]],
      bad: [[247, 0], [208, 0.13]],
      win: [[523, 0], [659, 0.11], [784, 0.22], [1047, 0.34]],
      tick: [[1200, 0]],
    }[kind] || [];
    for (const [f, d] of seq) {
      const o = actx.createOscillator();
      const gain = actx.createGain();
      o.type = kind === 'bad' ? 'triangle' : 'sine';
      o.frequency.value = f;
      const vol = kind === 'tick' ? 0.05 : 0.16;
      gain.gain.setValueAtTime(0.0001, t + d);
      gain.gain.exponentialRampToValueAtTime(vol, t + d + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + d + (kind === 'tick' ? 0.06 : 0.24));
      o.connect(gain).connect(actx.destination);
      o.start(t + d);
      o.stop(t + d + 0.3);
    }
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => actx && actx.suspend && actx.suspend().catch(() => {}), 900);
  } catch {
    /* Töne sind Beiwerk */
  }
}

/* ---------------- Sheets & Hinweise ---------------- */

/**
 * Bottom-Sheet. actions: [{ label, value, primary, danger }]
 * Erfüllt sich mit dem value der gewählten Aktion (oder null beim Wegtippen).
 */
export function sheet({ title = '', body = null, actions = [], dismiss = true, cls = '' } = {}) {
  return new Promise((resolve) => {
    const host = document.getElementById('sheet-host');
    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 260);
      resolve(val);
    };
    const btns = actions.map((a) =>
      h(
        'button.btn' + (a.primary ? '.primary' : a.danger ? '.danger' : '.ghost'),
        { type: 'button', onClick: () => close(a.value) },
        a.label,
      ),
    );
    const panel = h(
      'div.sheet' + (cls ? '.' + cls : ''),
      { role: 'dialog', 'aria-modal': 'true' },
      h('div.sheet-grip'),
      title && h('h2.sheet-title', title),
      body && h('div.sheet-body', body),
      btns.length > 0 && h('div.sheet-actions', btns),
    );
    const wrap = h('div.sheet-wrap', panel);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap && dismiss) close(null);
    });
    wrap.closeSheet = close;
    host.append(wrap);
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  });
}

export function confirmSheet(title, text, okLabel = 'Ja', { danger = false, cancel = 'Abbrechen' } = {}) {
  return sheet({
    title,
    body: text ? h('p', text) : null,
    actions: [
      { label: okLabel, value: true, primary: !danger, danger },
      { label: cancel, value: false },
    ],
  }).then((v) => v === true);
}

export function closeSheets() {
  for (const w of document.querySelectorAll('.sheet-wrap')) w.closeSheet && w.closeSheet(null);
}

export function toast(msg, ms = 2600) {
  const host = document.getElementById('toast-host');
  const t = h('div.toast', msg);
  host.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

/* ---------------- Bausteine ---------------- */

export function btn(label, onClick, cls = 'primary') {
  return h('button.btn.' + cls.split(' ').join('.'), { type: 'button', onClick }, label);
}

/** Fortschrittsbalken 0..1 */
export function bar(frac, cls = '') {
  const pct = Math.round(Math.max(0, Math.min(1, frac || 0)) * 100);
  return h('div.bar' + (cls ? '.' + cls : ''), h('div.bar-fill', { style: { width: pct + '%' } }));
}

/** Segmentierter Balken für Wortstärken: [neu, inArbeit, frisch, sitzt, fest] */
export function strengthBar(counts) {
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const segs = ['s1', 's2', 's3', 's4'];
  return h(
    'div.sbar',
    segs.map((c, i) => {
      const n = counts[i + 1] || 0;
      return n ? h('div.sbar-seg.' + c, { style: { width: (n / total) * 100 + '%' } }) : null;
    }),
  );
}

/** Kleine Liniengrafik (SVG) für die Lernkurve. values: Zahlenfolge */
export function sparkline(values, { width = 320, height = 84, labels = null } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('preserveAspectRatio', 'none');
  const max = Math.max(1, ...values);
  const n = values.length;
  const pad = 6;
  const x = (i) => pad + (i * (width - 2 * pad)) / Math.max(1, n - 1);
  const y = (v) => height - pad - (v / max) * (height - 2 * pad);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = document.createElementNS(ns, 'path');
  area.setAttribute('d', `M${x(0)},${height - pad} L${pts.join(' L')} L${x(n - 1)},${height - pad} Z`);
  area.setAttribute('class', 'spark-area');
  const line = document.createElementNS(ns, 'path');
  line.setAttribute('d', `M${pts.join(' L')}`);
  line.setAttribute('class', 'spark-line');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', x(n - 1));
  dot.setAttribute('cy', y(values[n - 1] || 0));
  dot.setAttribute('r', 4.5);
  dot.setAttribute('class', 'spark-dot');
  svg.append(area, line, dot);
  const wrap = h('div.spark-wrap', svg);
  if (labels) wrap.append(h('div.spark-labels', h('span', labels[0]), h('span', labels[1])));
  return wrap;
}

/** Kreis-Fortschritt für Minuten heute. */
export function ring(frac, inner) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 44 44');
  svg.setAttribute('class', 'ring-svg');
  const r = 19;
  const c = 2 * Math.PI * r;
  const bg = document.createElementNS(ns, 'circle');
  bg.setAttribute('cx', 22);
  bg.setAttribute('cy', 22);
  bg.setAttribute('r', r);
  bg.setAttribute('class', 'ring-bg');
  const fg = document.createElementNS(ns, 'circle');
  fg.setAttribute('cx', 22);
  fg.setAttribute('cy', 22);
  fg.setAttribute('r', r);
  fg.setAttribute('class', 'ring-fg');
  fg.setAttribute('stroke-dasharray', `${(Math.min(1, frac) * c).toFixed(1)} ${c.toFixed(1)}`);
  svg.append(bg, fg);
  return h('div.ring', svg, h('div.ring-in', inner));
}
