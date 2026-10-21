/**
 * Übungsfolgen im Vollbild und die gemeinsamen Antwort-Bausteine
 * (Auswahl, Tippen, Sprechen, Ergebnisleiste).
 */
import { h, ico, sfx, confirmSheet, rich, say, stopSpeaking } from './ui.js';
import { addTime, S, save } from './store.js';
import { abortListening, listen, stopListening, sttAvailable, FATAL_STT, unlock } from './speech.js';

let active = null;

export function inFlow() {
  return !!active;
}

export function closeActiveFlow() {
  if (active) active.close();
}

class Flow {
  constructor({ steps = [], theme = '', confirmClose = true, bar = true, label = '', closable = true }) {
    this.steps = steps.slice();
    this.i = 0;
    this.results = [];
    this.closed = false;
    this.finished = false;
    this.confirmClose = confirmClose;
    this.retries = new Map();
    this.data = {};
    this.el = h('div.flow' + (theme ? '.' + theme : ''));
    this.fill = h('div.flow-bar-fill');
    this.head = h(
      'header.flow-head',
      closable
        ? h('button.flow-close', { type: 'button', 'aria-label': 'Beenden', onClick: () => this.requestClose() }, ico('close'))
        : h('span.flow-close-space'),
      bar ? h('div.flow-bar', this.fill) : h('div.flow-label', label),
    );
    this.stage = h('div.flow-stage');
    this.el.append(this.head, this.stage);
    this.closedP = new Promise((r) => (this._resolveClosed = r));
  }

  /** Schritt ans Ende anhängen. */
  add(step) {
    this.steps.push(step);
    this.progress();
  }

  /** Schritt ein paar Plätze später einschieben (z. B. Wiederholung nach einem Fehler). */
  addSoon(step, gap = 3) {
    const at = Math.min(this.steps.length, this.i + 1 + gap);
    this.steps.splice(at, 0, step);
    this.progress();
  }

  progress() {
    const n = this.steps.length || 1;
    this.fill.style.width = `${Math.round((this.i / n) * 100)}%`;
  }

  setLabel(text) {
    const l = this.head.querySelector('.flow-label');
    if (l) l.textContent = text;
  }

  async requestClose() {
    if (this.closed) return;
    if (this.confirmClose && this.i > 0 && !this.finished) {
      const ok = await confirmSheet('Übung beenden?', 'Was du bis hierher gelernt hast, ist gespeichert.', 'Beenden', {
        cancel: 'Weiterlernen',
      });
      if (!ok) return;
    }
    this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    stopSpeaking();
    abortListening();
    this._resolveClosed({ closed: true });
  }

  async run() {
    const host = document.getElementById('flow-host');
    host.append(this.el);
    document.body.classList.add('in-flow');
    requestAnimationFrame(() => this.el.classList.add('open'));
    try {
      while (this.i < this.steps.length && !this.closed) {
        this.progress();
        this.stage.replaceChildren();
        this.stage.scrollTop = 0;
        const t0 = Date.now();
        const step = this.steps[this.i];
        let res;
        try {
          res = await Promise.race([Promise.resolve().then(() => step(this)), this.closedP]);
        } catch (e) {
          console.error(e);
          res = { error: String(e && e.message) };
        }
        addTime(Math.min(150, (Date.now() - t0) / 1000));
        if (this.closed) break;
        this.results.push(res);
        this.i++;
      }
      this.finished = true;
      this.progress();
      return { completed: !this.closed, results: this.results, data: this.data };
    } finally {
      stopSpeaking();
      abortListening();
      save(true);
      this.el.classList.remove('open');
      document.body.classList.remove('in-flow');
      setTimeout(() => this.el.remove(), 280);
      if (active === this) active = null;
    }
  }
}

/** Startet eine Übungsfolge. Erfüllt sich am Ende mit { completed, results, data }. */
export function runFlow(opts) {
  if (active) active.close();
  const f = new Flow(opts);
  active = f;
  return f.run();
}

/* ---------------- Bühne ---------------- */

/** Leerer Aufgabenrahmen: body (scrollt) + foot (Knöpfe unten). */
export function frame(flow, cls = '') {
  const body = h('div.ex-body');
  const foot = h('div.ex-foot');
  const wrap = h('div.ex' + (cls ? '.' + cls : ''), body, foot);
  flow.stage.replaceChildren(wrap);
  return { wrap, body, foot };
}

export function tapOnce(el) {
  return new Promise((r) => el.addEventListener('click', () => r(), { once: true }));
}

/** Großer Knopf unten; erfüllt sich beim Antippen. */
export async function next(foot, label = 'Weiter', cls = 'primary') {
  const b = h('button.btn.big.' + cls, { type: 'button' }, label);
  foot.replaceChildren(b);
  await tapOnce(b);
}

/** Aufgabenzeile über dem Inhalt („Was bedeutet das?“). */
export function prompt(text) {
  return h('p.ex-prompt', text);
}

/**
 * Ergebnisleiste: ok = true | 'hard' | false
 * Spielt einen Ton, zeigt Titel und Inhalt und wartet auf „Weiter“.
 */
export async function verdict(foot, { ok, title, body = null, label = 'Weiter', extra = null }) {
  const cls = ok === true ? 'good' : ok === 'hard' ? 'hard' : 'bad';
  const panel = h(
    'div.verdict.' + cls,
    h('div.verdict-title', ico(ok === true ? 'check' : ok === 'hard' ? 'dot' : 'cross'), h('span', title)),
    body && h('div.verdict-body', body),
  );
  const b = h('button.btn.big.primary', { type: 'button' }, label);
  foot.replaceChildren(panel, extra, b);
  sfx(ok === true ? 'ok' : ok === 'hard' ? 'meh' : 'bad');
  await tapOnce(b);
}

/** „Warum so?“-Kasten */
export function whyBox(text) {
  if (!text) return null;
  return h('div.why', h('div.why-head', ico('bulb'), 'Warum so?'), h('p', rich(text)));
}

/* ---------------- Auswahl ---------------- */

/**
 * Antwortknöpfe. options: [{ text: string|Node, ok: bool, it: bool }]
 * Erfüllt sich mit { index, ok } nach dem Antippen.
 */
export function choices(body, options, { letters = false, cls = '' } = {}) {
  return new Promise((resolve) => {
    const list = h('div.choices' + (cls ? '.' + cls : ''));
    const btns = options.map((o, i) =>
      h(
        'button.choice' + (o.it ? '.it' : ''),
        { type: 'button', onClick: () => choose(i) },
        letters && h('span.choice-letter', 'ABCD'[i]),
        h('span.choice-text', o.text),
      ),
    );
    list.append(...btns);
    body.append(list);
    function choose(i) {
      btns.forEach((b, j) => {
        b.disabled = true;
        if (options[j].ok) b.classList.add('right');
        else if (j === i) b.classList.add('wrong');
        else b.classList.add('dim');
      });
      resolve({ index: i, ok: !!options[i].ok });
    }
  });
}

/* ---------------- Tippen ---------------- */

const ACCENTS = ['à', 'è', 'é', 'ì', 'ò', 'ù'];

export function inputField({ placeholder = 'Auf Italienisch …', value = '' } = {}) {
  const input = h('input.answer-input', {
    type: 'text',
    placeholder,
    value,
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    lang: 'it',
  });
  const accents = h(
    'div.accents',
    ACCENTS.map((a) =>
      h(
        'button.accent',
        {
          type: 'button',
          tabindex: '-1',
          onPointerdown: (e) => e.preventDefault(),
          onClick: () => {
            const s = input.selectionStart ?? input.value.length;
            const e2 = input.selectionEnd ?? s;
            input.value = input.value.slice(0, s) + a + input.value.slice(e2);
            input.focus();
            input.setSelectionRange(s + 1, s + 1);
          },
        },
        a,
      ),
    ),
  );
  return { input, accents, wrap: h('div.answer', input, accents) };
}

/**
 * Antwort tippen. Erfüllt sich mit { text, gaveUp }.
 * hint: Funktion, die einen Tipp-Text liefert (Knopf „Tipp“), optional.
 */
export function typeAnswer(body, foot, { placeholder, hint = null, dictateHint = false } = {}) {
  return new Promise((resolve) => {
    const f = inputField({ placeholder });
    body.append(f.wrap);
    if (dictateHint) body.append(h('p.small.muted.center', 'Tipp: Mit der Mikrofon-Taste der Tastatur kannst du auch sprechen.'));
    let usedHint = false;
    const hintOut = h('p.hint-out');
    if (hint) body.append(hintOut);
    const done = (gaveUp) => {
      f.input.blur();
      resolve({ text: f.input.value.trim(), gaveUp, usedHint });
    };
    const check = h('button.btn.big.primary', { type: 'button', onClick: () => f.input.value.trim() && done(false) }, 'Prüfen');
    const dunno = h('button.btn.ghost', { type: 'button', onClick: () => done(true) }, 'Weiß ich nicht');
    const row = [dunno];
    if (hint) {
      row.unshift(
        h(
          'button.btn.ghost',
          {
            type: 'button',
            onClick: (e) => {
              usedHint = true;
              hintOut.textContent = hint();
              e.currentTarget.disabled = true;
            },
          },
          'Tipp',
        ),
      );
    }
    foot.replaceChildren(h('div.row2', row), check);
    f.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && f.input.value.trim()) {
        e.preventDefault();
        done(false);
      }
    });
    setTimeout(() => f.input.focus({ preventScroll: true }), 80);
  });
}

/* ---------------- Sprechen ---------------- */

/** Kann diese Ansicht den Mikrofon-Knopf anbieten? */
export function micUsable() {
  return sttAvailable && S().profile.speechOk !== false && S().settings.speechMode !== 'keyboard';
}

const STT_MSG = {
  'no-speech': 'Ich habe nichts gehört. Tippe auf das Mikrofon und sprich gleich los.',
  network: 'Die Spracherkennung braucht gerade Internet. Du kannst stattdessen tippen.',
  aborted: 'Abgebrochen.',
};

/**
 * Antwort sprechen (mit Ausweichen aufs Tippen).
 * Erfüllt sich mit { text, alts, gaveUp, typed }.
 */
export function speakAnswer(body, foot, { placeholder } = {}) {
  return new Promise((resolve) => {
    const area = h('div.speak-area');
    body.append(area);
    const toTyping = (note) => {
      area.replaceChildren();
      if (note) area.append(h('p.small.muted.center', note));
      typeAnswer(area, foot, { placeholder, dictateHint: true }).then((r) => resolve({ ...r, alts: [r.text], typed: true }));
    };
    if (!micUsable()) {
      toTyping();
      return;
    }
    const live = h('p.live', ' ');
    const status = h('p.small.muted.center', 'Tippe auf das Mikrofon und sprich.');
    const mic = h('button.mic', { type: 'button', 'aria-label': 'Sprechen' }, ico('mic'));
    area.append(mic, live, status);
    let listening = false;
    mic.addEventListener('click', async () => {
      unlock();
      if (listening) {
        stopListening();
        return;
      }
      stopSpeaking();
      listening = true;
      mic.classList.add('on');
      status.textContent = 'Ich höre zu … Tippe nochmal, wenn du fertig bist.';
      live.textContent = ' ';
      try {
        const r = await listen({ onPartial: (t) => (live.textContent = t) });
        listening = false;
        mic.classList.remove('on');
        S().profile.speechOk = true;
        save();
        resolve({ text: r.text, alts: r.alts, gaveUp: false, typed: false });
      } catch (e) {
        listening = false;
        mic.classList.remove('on');
        const code = (e && e.code) || 'error';
        if (FATAL_STT.includes(code)) {
          S().profile.speechOk = false;
          save();
          toTyping('Die Spracherkennung ist auf diesem Gerät nicht verfügbar. Tippe die Antwort – oder sprich über die Mikrofon-Taste der Tastatur.');
        } else if (code === 'network') {
          toTyping(STT_MSG.network);
        } else {
          status.textContent = STT_MSG[code] || 'Das hat nicht geklappt. Versuch es nochmal.';
        }
      }
    });
    foot.replaceChildren(
      h(
        'div.row2',
        h('button.btn.ghost', { type: 'button', onClick: () => { abortListening(); toTyping(); } }, 'Lieber tippen'),
        h('button.btn.ghost', { type: 'button', onClick: () => { abortListening(); resolve({ text: '', alts: [], gaveUp: true, typed: false }); } }, 'Weiß ich nicht'),
      ),
    );
  });
}

/* ---------------- Kleinteile ---------------- */

/** Großer runder Play-Knopf, der einen Text vorliest. */
export function playButton(text, { label = 'Anhören', auto = false } = {}) {
  const b = h('button.play-big', { type: 'button' }, ico('play'), h('span', label));
  const run = async () => {
    unlock();
    stopSpeaking();
    b.classList.add('on');
    await say(text);
    b.classList.remove('on');
  };
  b.addEventListener('click', run);
  if (auto) setTimeout(run, 250);
  return b;
}

export function slowButton(text) {
  const b = h('button.chip', { type: 'button' }, '🐢 Langsam');
  b.addEventListener('click', () => {
    unlock();
    stopSpeaking();
    say(text, { slow: true });
  });
  return b;
}

/** Farbige Wort-für-Wort-Anzeige aus alignWords(). */
export function alignView(res) {
  return h(
    'p.align',
    res.words.map((w) => [h('span.w.' + (w.st || 'skip'), w.w), ' ']),
  );
}
