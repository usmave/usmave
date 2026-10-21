/**
 * Hören: Dialoge und Durchsagen mit Verständnisfragen, außerdem Diktat.
 */
import { h, ico, spk, say, rich, itText, shuffle, pick, sfx, sleep, stopSpeaking } from '../ui.js';
import { frame, prompt, choices, verdict, next, tapOnce, typeAnswer, alignView, runFlow, slowButton, playButton } from '../flow.js';
import { items, levelRank, areaById } from '../content.js';
import { S, save } from '../store.js';
import { alignWords, g } from '../text.js';
import { userLevel } from '../session.js';
import { unlock } from '../speech.js';
import { summaryStep } from './vocab.js';

const G = (t) => g(t, S().profile.sex);
const VOICES = [
  { voice: 'A', pitch: 1 },
  { voice: 'B', pitch: 1 },
  { voice: 'A', pitch: 1.22 },
  { voice: 'B', pitch: 0.86 },
];

function avatar(name, v) {
  return h('span.avatar.v' + (v % 4), name.slice(0, 1).toUpperCase());
}

/** Spielt die Zeilen nacheinander ab. token.stop = true bricht ab. */
async function playLines(lines, { onLine, slow = false, token }) {
  for (let i = 0; i < lines.length; i++) {
    if (token.stop) return false;
    onLine(i);
    const o = VOICES[lines[i].v % 4];
    await say(lines[i].it, { slow, voice: o.voice, pitch: o.pitch });
    if (token.stop) return false;
    await sleep(320);
  }
  onLine(-1);
  return true;
}

function bubbles(dlg, { showText }) {
  const wrap = h('div.dlg');
  const els = dlg.lines.map((l) => {
    const textEl = h('p.bub-it', showText ? G(l.it) : '…');
    const deEl = h('p.bub-de.hidden', l.de);
    const b = h(
      'div.bub' + (l.v % 2 ? '.right' : ''),
      avatar(l.who, l.v),
      h('div.bub-body', h('div.bub-who', l.who), textEl, deEl),
    );
    b._text = textEl;
    b._de = deEl;
    b._line = l;
    return b;
  });
  wrap.append(...els);
  return { wrap, els };
}

/** Kompletter Ablauf für einen Dialog: Einführung, Hören, Fragen, Text. */
export function dialogStep(dlg) {
  return async (flow) => {
    const area = areaById.get(dlg.area);
    // 1. Einführung
    {
      const { body, foot } = frame(flow, 'dlg-intro');
      body.append(
        h('p.ex-prompt', `${dlg.kind}, Niveau ${dlg.lvl}`),
        h('h2.dlg-title', dlg.title),
        area ? h('p.small.muted', `${area.icon} ${area.title}`) : null,
        h('p.dlg-situation', rich(dlg.intro)),
        h('div.tipbox', ico('bulb'), h('span', 'Hör erst einmal nur zu, ohne mitzulesen. Danach kommen ein paar Fragen, und zum Schluss siehst du den Text mit Übersetzung.')),
      );
      await next(foot, 'Anhören');
    }
    // 2. Hören
    let showText = false;
    let slow = false;
    {
      const { body, foot } = frame(flow, 'dlg-play');
      const view = bubbles(dlg, { showText });
      body.append(h('h2.dlg-title.small-title', dlg.title), view.wrap);
      let token = { stop: false };
      const status = h('p.small.muted.center', '');
      const toggle = h('button.chip', { type: 'button' }, 'Text zeigen');
      const tempo = h('button.chip', { type: 'button' }, '🐢 Langsamer');
      const replay = h('button.chip', { type: 'button' }, ico('replay'), ' Von vorn');
      const go = h('button.btn.big.primary', { type: 'button' }, 'Zu den Fragen');
      foot.replaceChildren(h('div.chips', replay, tempo, toggle), status, go);
      const mark = (i) => {
        view.els.forEach((b, j) => b.classList.toggle('now', j === i));
        if (i >= 0) view.els[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      const start = async () => {
        token.stop = true;
        stopSpeaking();
        await sleep(60);
        token = { stop: false };
        status.textContent = 'Läuft …';
        const ok = await playLines(dlg.lines, { onLine: mark, slow, token });
        if (ok) status.textContent = 'Fertig angehört. Noch einmal hören oder weiter zu den Fragen.';
      };
      toggle.addEventListener('click', () => {
        showText = !showText;
        toggle.textContent = showText ? 'Text verbergen' : 'Text zeigen';
        view.els.forEach((b) => (b._text.textContent = showText ? G(b._line.it) : '…'));
      });
      tempo.addEventListener('click', () => {
        slow = !slow;
        tempo.textContent = slow ? 'Normales Tempo' : '🐢 Langsamer';
        start();
      });
      replay.addEventListener('click', () => {
        unlock();
        start();
      });
      start();
      await tapOnce(go);
      token.stop = true;
      stopSpeaking();
    }
    // 3. Fragen
    let right = 0;
    for (let qi = 0; qi < dlg.qs.length; qi++) {
      const q = dlg.qs[qi];
      const { body, foot } = frame(flow);
      const again = h('button.chip', { type: 'button' }, ico('replay'), ' Nochmal hören');
      let token = { stop: false };
      again.addEventListener('click', () => {
        unlock();
        token.stop = true;
        stopSpeaking();
        token = { stop: false };
        playLines(dlg.lines, { onLine: () => {}, slow, token });
      });
      body.append(prompt(`Frage ${qi + 1} von ${dlg.qs.length}`), h('p.q-text', rich(q.q)), h('div.chips.center', again));
      const opts = shuffle(q.a.map((t, i) => ({ text: rich(t, { tap: false }), ok: i === 0 })));
      const r = await choices(body, opts);
      token.stop = true;
      stopSpeaking();
      if (r.ok) right++;
      await verdict(foot, { ok: r.ok, title: r.ok ? G(pick(['Esatto!', 'Giusto!', 'Bravo!'])) : 'Leider nicht', body: r.ok ? null : h('p', 'Richtig: ', rich(q.a[0], { tap: false })) });
    }
    // 4. Text mit Übersetzung
    {
      const { body, foot } = frame(flow, 'dlg-text');
      const view = bubbles(dlg, { showText: true });
      for (const b of view.els) {
        const l = b._line;
        const o = VOICES[l.v % 4];
        const sp = h('button.spk.mini', { type: 'button', 'aria-label': 'Vorlesen' }, ico('speaker'));
        sp.addEventListener('click', (e) => {
          e.stopPropagation();
          unlock();
          stopSpeaking();
          say(l.it, { voice: o.voice, pitch: o.pitch });
        });
        b.querySelector('.bub-who').append(sp);
        b.addEventListener('click', () => b._de.classList.toggle('hidden'));
      }
      const pct = dlg.qs.length ? Math.round((right / dlg.qs.length) * 100) : 100;
      body.append(
        h('div.dlg-result', h('b', `${right} von ${dlg.qs.length} Fragen richtig`), h('span.small.muted', 'Tippe eine Zeile an, um die Übersetzung zu sehen.')),
        view.wrap,
      );
      const prev = S().done.listen[dlg.id];
      S().done.listen[dlg.id] = { best: Math.max(pct, (prev && prev.best) || 0), at: Date.now(), n: ((prev && prev.n) || 0) + 1 };
      save();
      await next(foot, 'Fertig');
      return { dialog: dlg.id, right, total: dlg.qs.length };
    }
  };
}

export function startDialog(dlg) {
  return runFlow({ steps: [dialogStep(dlg)], bar: false, label: dlg.title });
}

/* ---------------- Diktat ---------------- */

function dictationPool() {
  const L = levelRank(userLevel());
  const fits = (x) => x.ex && levelRank(x.lvl) <= L + (L < 2 ? 0 : 0) && wordsOf(x.ex) >= 4 && wordsOf(x.ex) <= 12;
  const seen = items.filter((x) => S().cards[x.id] && fits(x));
  if (seen.length >= 12) return seen;
  return items.filter(fits);
}

function wordsOf(s) {
  return String(s).split(/\s+/).filter(Boolean).length;
}

export function dictationStep(item) {
  return async (flow) => {
    const target = G(item.ex);
    const { body, foot } = frame(flow);
    body.append(
      prompt('Hör zu und schreib den Satz auf'),
      h('div.listen-box', playButton(target, { auto: true }), slowButton(target)),
      h('p.small.muted.center', 'Satzzeichen und Großschreibung sind egal.'),
    );
    const r = await typeAnswer(body, foot, { placeholder: 'Was hast du gehört?' });
    const a = alignWords(target, r.gaveUp ? '' : r.text);
    const ok = a.score >= 0.95 ? true : a.score >= 0.7 ? 'hard' : false;
    await verdict(foot, {
      ok,
      title: ok === true ? G('Perfetto!') : ok === 'hard' ? `Gut – ${Math.round(a.score * 100)} % richtig` : r.gaveUp ? 'So lautet der Satz:' : `${Math.round(a.score * 100)} % richtig`,
      body: [alignView(a), item.exde ? h('p.small.muted', item.exde) : null],
    });
    return { dictation: item.id, score: a.score, outcome: ok === false ? 'again' : 'good' };
  };
}

export function startDictation(n = 8) {
  const pool = shuffle(dictationPool()).slice(0, n);
  return runFlow({ steps: [...pool.map(dictationStep), summaryStep({ title: 'Diktat geschafft!' })] });
}

export function dictationSteps(n = 4) {
  return shuffle(dictationPool()).slice(0, n).map(dictationStep);
}
