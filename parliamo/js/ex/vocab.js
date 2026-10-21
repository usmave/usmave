/**
 * Übungen für Wörter und Sätze: Vorstellen, Auswahl, Hören, Lückensatz, Tippen,
 * Sprechen, Satzbau, Paare finden, Schnell-Check.
 */
import { h, ico, spk, say, rich, itText, shuffle, pick, sfx, stopSpeaking } from '../ui.js';
import {
  frame, prompt, choices, verdict, next, typeAnswer, speakAnswer, micUsable, whyBox, playButton, slowButton,
  alignView, tapOnce,
} from '../flow.js';
import { distractors, clozeOptions } from '../content.js';
import { checkTyped, outcomeOf, alignWords, g, norm } from '../text.js';
import { S, save, today, streak } from '../store.js';
import { startItem, markKnown, record, card } from '../session.js';
import { strength } from '../srs.js';
import { unlock } from '../speech.js';

const sex = () => S().profile.sex;
const G = (t) => g(t, sex());
const sayItem = (item) => item.alts.join(' / ');

export const PRAISE = ['Bravo!', 'Esatto!', 'Giusto!', 'Perfetto!', 'Benissimo!', 'Ottimo!', 'Bravissim{o|a}!', 'Molto bene!'];
const praise = () => G(pick(PRAISE));
const SORRY = ['Nicht ganz', 'Leider falsch', 'Knapp daneben', 'Fast'];

/* ---------------- Anzeige-Bausteine ---------------- */

function headIt(item, { autoplay = true } = {}) {
  const el = h(
    'div.head-it',
    h('div.' + (item.kind === 'p' ? 'phrase-it' : 'word-it'), itText(item.it)),
    h('div.tools', spk(sayItem(item)), spk(sayItem(item), { slow: true })),
  );
  if (autoplay) setTimeout(() => say(sayItem(item)), 220);
  return el;
}

function headDe(item) {
  return h('div.head-de', h('div.word-de-big', item.de), item.pos === 'n' ? h('p.small.muted', 'mit Artikel') : null);
}

function marked(item) {
  const c = item.cloze;
  if (!c) return G(item.ex);
  return [G(c.pre), h('mark', G(c.word)), G(c.post)];
}

export function exampleBlock(item) {
  if (!item.ex) return null;
  return h(
    'div.example',
    h('p.example-it', marked(item), ' ', spk(item.ex)),
    item.exde ? h('p.example-de', item.exde) : null,
  );
}

function noteBox(item) {
  if (!item.note) return null;
  if (item.kind === 'p') return whyBox(item.note);
  return h('div.why', h('div.why-head', ico('bulb'), 'Gut zu merken'), h('p', rich(item.note)));
}

function answerLine(item) {
  return h('p.v-line', h('span.it-strong', itText(item.it)), h('span.v-eq', ' = '), item.de, ' ', spk(sayItem(item)));
}

/* ---------------- Vorstellen ---------------- */

export function introStep(item) {
  return async (flow) => {
    const { body, foot } = frame(flow, 'intro');
    const isP = item.kind === 'p';
    body.append(
      prompt(isP ? 'Neuer Satz' : 'Neues Wort'),
      h(
        'div.intro-card',
        headIt(item),
        h('p.word-de', item.de),
        exampleBlock(item),
        noteBox(item),
      ),
    );
    return new Promise((resolve) => {
      const known = h(
        'button.btn.ghost',
        {
          type: 'button',
          onClick: () => {
            markKnown(item);
            (flow.data.known || (flow.data.known = new Set())).add(item.id);
            resolve({ item: item.id, known: true });
          },
        },
        'Kenne ich schon',
      );
      const go = h(
        'button.btn.big.primary',
        {
          type: 'button',
          onClick: () => {
            startItem(item);
            resolve({ item: item.id, intro: true });
          },
        },
        'Verstanden',
      );
      foot.replaceChildren(known, go);
    });
  };
}

/* ---------------- Übungsarten ---------------- */

async function exMeaning(flow, item, { listenOnly = false } = {}) {
  const { body, foot } = frame(flow);
  if (listenOnly) {
    const text = sayItem(item);
    body.append(prompt('Hör zu – was bedeutet das?'), h('div.listen-box', playButton(text, { auto: true }), slowButton(text)));
  } else body.append(prompt('Was bedeutet das?'), headIt(item));
  const opts = shuffle([{ text: item.de, ok: true }, ...distractors(item).map((x) => ({ text: x.de }))]);
  const r = await choices(body, opts);
  if (r.ok) {
    await verdict(foot, { ok: true, title: praise(), body: [listenOnly ? answerLine(item) : null, exampleBlock(item)] });
    return 'good';
  }
  await verdict(foot, { ok: false, title: pick(SORRY), body: [answerLine(item), exampleBlock(item)] });
  return 'again';
}

async function exWord(flow, item) {
  const { body, foot } = frame(flow);
  body.append(prompt('Wie heißt das auf Italienisch?'), h('div.head-de', h('div.word-de-big', item.de)));
  const opts = shuffle([
    { text: itText(item.alts[0]), ok: true, it: true },
    ...distractors(item).map((x) => ({ text: itText(x.alts[0]), it: true })),
  ]);
  const r = await choices(body, opts);
  say(sayItem(item));
  if (r.ok) {
    await verdict(foot, { ok: true, title: praise(), body: [answerLine(item), exampleBlock(item)] });
    return 'good';
  }
  await verdict(foot, { ok: false, title: pick(SORRY), body: [answerLine(item), exampleBlock(item)] });
  return 'again';
}

async function exCloze(flow, item) {
  const others = clozeOptions(item, sex());
  if (others.length < 3) return exWord(flow, item);
  const { body, foot } = frame(flow);
  const c = item.cloze;
  body.append(
    prompt('Welches Wort fehlt?'),
    h('div.cloze', h('p.cloze-it', G(c.pre), h('span.gap', '      '), G(c.post)), item.exde && h('p.example-de', item.exde)),
  );
  const opts = shuffle([{ text: G(c.word), ok: true, it: true }, ...others.map((w) => ({ text: w, it: true }))]);
  const r = await choices(body, opts);
  say(item.ex);
  const res = [h('p.example-it', marked(item), ' ', spk(item.ex)), answerLine(item)];
  if (r.ok) {
    await verdict(foot, { ok: true, title: praise(), body: res });
    return 'good';
  }
  await verdict(foot, { ok: false, title: pick(SORRY), body: res });
  return 'again';
}

function firstLetters(form) {
  const t = G(form);
  const words = t.split(' ');
  // Artikel ganz zeigen, vom Wort die ersten zwei Buchstaben
  return words.map((w, i) => (i === 0 && words.length > 1 && /^(il|lo|la|i|gli|le|un|uno|una)$/i.test(w) ? w : w.slice(0, 2) + '…')).join(' ');
}

const KIND_TEXT = {
  exact: '',
  accent: 'Achte auf den Akzent.',
  typo: 'Kleiner Tippfehler.',
  article: 'Achte auf den Artikel.',
};

function judgeTyped(text, target) {
  const best = checkTyped(text, G(target));
  return { ...best, outcome: outcomeOf(best.kind) };
}

async function exType(flow, item) {
  const { body, foot } = frame(flow);
  body.append(prompt('Schreib es auf Italienisch'), headDe(item));
  const r = await typeAnswer(body, foot, { hint: () => `Beginnt mit: ${firstLetters(item.alts[0])}` });
  return judgeAndShow(foot, item, r, item.alts.join(' / '));
}

async function exClozeType(flow, item) {
  const { body, foot } = frame(flow);
  const c = item.cloze;
  body.append(
    prompt('Ergänze den Satz'),
    h('div.cloze', h('p.cloze-it', G(c.pre), h('span.gap', '      '), G(c.post)), item.exde && h('p.example-de', item.exde)),
    h('p.small.muted.center', `Gesucht: ${item.de}`),
  );
  const r = await typeAnswer(body, foot, { hint: () => `Beginnt mit: ${G(c.word).slice(0, 2)}…` });
  return judgeAndShow(foot, item, r, c.word, true);
}

async function judgeAndShow(foot, item, r, target, sentence = false) {
  say(sentence ? item.ex : sayItem(item));
  const shown = sentence ? [h('p.example-it', marked(item), ' ', spk(item.ex)), answerLine(item)] : [answerLine(item), exampleBlock(item)];
  if (r.gaveUp || !r.text) {
    await verdict(foot, { ok: false, title: 'So heißt es:', body: shown });
    return 'again';
  }
  const j = judgeTyped(r.text, target);
  let outcome = j.outcome;
  if (r.usedHint && outcome === 'good') outcome = 'hard';
  if (outcome === 'again') {
    await verdict(foot, { ok: false, title: pick(SORRY), body: [h('p.small', 'Deine Antwort: ', h('s', r.text)), ...shown] });
    return 'again';
  }
  const note = KIND_TEXT[j.kind];
  await verdict(foot, {
    ok: outcome === 'good' ? true : 'hard',
    title: outcome === 'good' ? praise() : 'Fast richtig',
    body: [note ? h('p.small', note, ' Richtig ist: ', h('b.it-strong', G(j.target))) : null, ...shown],
  });
  return outcome;
}

async function exSpeak(flow, item) {
  const { body, foot } = frame(flow);
  body.append(prompt('Sag es auf Italienisch'), headDe(item));
  const r = await speakAnswer(body, foot, {});
  if (r.typed) return judgeAndShow(foot, item, r, item.alts.join(' / '));
  say(sayItem(item));
  if (r.gaveUp) {
    await verdict(foot, { ok: false, title: 'So heißt es:', body: [answerLine(item), exampleBlock(item)] });
    return 'again';
  }
  let best = null;
  for (const t of r.alts) {
    const j = judgeTyped(t, item.alts.join(' / '));
    if (!best || rankKind(j.kind) > rankKind(best.kind)) best = { ...j, heard: t };
  }
  // Beim Sprechen sind Akzente egal; Artikel-Fehler zählen als „fast“
  const outcome = best.kind === 'wrong' || best.kind === 'empty' ? 'again' : best.kind === 'article' ? 'hard' : 'good';
  const heard = h('p.small', 'Verstanden: „', h('i', best.heard), '“');
  if (outcome === 'again') {
    await verdict(foot, { ok: false, title: pick(SORRY), body: [heard, answerLine(item), h('p.small.muted', 'Hör es dir an und sprich es nach.')] });
    return 'again';
  }
  await verdict(foot, { ok: outcome === 'good' ? true : 'hard', title: outcome === 'good' ? praise() : 'Fast richtig', body: [heard, answerLine(item)] });
  return outcome;
}

function rankKind(k) {
  return { exact: 5, accent: 4, typo: 3, article: 2, wrong: 0, empty: -1 }[k] ?? 0;
}

/** Satz aus Wortkärtchen bauen. */
async function exOrder(flow, item) {
  const target = G(item.alts[0]);
  const end = (target.match(/[.!?…]+$/) || [''])[0];
  const words = target.replace(/[.!?…]+$/, '').split(/\s+/).filter(Boolean);
  if (words.length < 3 || words.length > 10 || / – /.test(target)) return exMeaning(flow, item);
  const { body, foot } = frame(flow);
  body.append(prompt('Bau den Satz auf Italienisch'), h('div.head-de', h('div.word-de-big.smaller', item.de)));
  const line = h('div.order-line');
  const pool = h('div.order-pool');
  body.append(line, pool);
  let tiles = words.map((w, i) => ({ w, i }));
  let order = shuffle(tiles);
  for (let k = 0; k < 4 && order.every((t, j) => t.i === j); k++) order = shuffle(tiles);
  const placed = [];
  const render = () => {
    line.replaceChildren(
      ...(placed.length
        ? placed.map((t, j) =>
            h('button.tile.it', { type: 'button', onClick: () => { placed.splice(j, 1); render(); } }, t.w),
          )
        : [h('span.order-empty', 'Tippe die Wörter in der richtigen Reihenfolge an')]),
    );
    pool.replaceChildren(
      ...order.map((t) =>
        h(
          'button.tile.it' + (placed.includes(t) ? '.used' : ''),
          { type: 'button', disabled: placed.includes(t), onClick: () => { placed.push(t); render(); } },
          t.w,
        ),
      ),
    );
    check.disabled = placed.length !== words.length;
  };
  const check = h('button.btn.big.primary', { type: 'button' }, 'Prüfen');
  const dunno = h('button.btn.ghost', { type: 'button' }, 'Weiß ich nicht');
  foot.replaceChildren(dunno, check);
  render();
  const gaveUp = await new Promise((r) => {
    check.addEventListener('click', () => r(false));
    dunno.addEventListener('click', () => r(true));
  });
  const built = placed.map((t) => t.w).join(' ');
  const ok = !gaveUp && norm(built) === norm(words.join(' '));
  say(target);
  const res = [h('p.v-line', h('span.it-strong', target), ' ', spk(target)), h('p.small.muted', item.de), whyBox(item.note)];
  if (ok) {
    await verdict(foot, { ok: true, title: praise(), body: res });
    return 'good';
  }
  if (!gaveUp) res.unshift(h('p.small', 'Deine Reihenfolge: ', h('s', built + end)));
  await verdict(foot, { ok: false, title: gaveUp ? 'So heißt es:' : pick(SORRY), body: res });
  return 'again';
}

/** Satz sprechen (oder tippen) und Wort für Wort vergleichen. */
async function exSpeakPhrase(flow, item) {
  const target = G(item.alts[0]);
  const { body, foot } = frame(flow);
  body.append(prompt('Sag den Satz auf Italienisch'), h('div.head-de', h('div.word-de-big.smaller', item.de)));
  const r = await speakAnswer(body, foot, { placeholder: 'Satz auf Italienisch …' });
  say(target);
  if (r.gaveUp || !r.text) {
    await verdict(foot, { ok: false, title: 'So heißt es:', body: [h('p.v-line', h('span.it-strong', target), ' ', spk(target)), whyBox(item.note)] });
    return 'again';
  }
  let best = null;
  for (const t of r.alts) {
    const a = alignWords(target, t);
    if (!best || a.score > best.score) best = a;
  }
  const outcome = best.score >= 0.9 ? 'good' : best.score >= 0.7 ? 'hard' : 'again';
  const res = [
    alignView(best),
    h('p.small.muted', `${Math.round(best.score * 100)} % der Wörter getroffen`),
    h('p.v-line', h('span.it-strong', target), ' ', spk(target)),
    whyBox(item.note),
  ];
  await verdict(foot, {
    ok: outcome === 'good' ? true : outcome === 'hard' ? 'hard' : false,
    title: outcome === 'good' ? praise() : outcome === 'hard' ? 'Fast richtig' : pick(SORRY),
    body: res,
  });
  return outcome;
}

const RUN = {
  meaning: (f, i) => exMeaning(f, i),
  listen: (f, i) => exMeaning(f, i, { listenOnly: true }),
  word: exWord,
  cloze: (f, i) => (i.cloze ? exCloze(f, i) : exWord(f, i)),
  type: exType,
  clozeType: (f, i) => (i.cloze ? exClozeType(f, i) : exType(f, i)),
  speak: exSpeak,
  order: exOrder,
  speakP: exSpeakPhrase,
};

export function runExercise(flow, item, type) {
  return (RUN[type] || RUN.meaning)(flow, item);
}

function pickType(item, s) {
  const mic = micUsable();
  if (item.kind === 'p') {
    if (s <= 1) return pick(['meaning', 'listen']);
    if (s === 2) return pick(['order', 'listen', 'meaning', 'order']);
    return pick(mic ? ['speakP', 'order', 'speakP', 'listen'] : ['order', 'listen', 'speakP']);
  }
  if (s <= 1) return pick(['word', 'meaning', 'listen']);
  if (s === 2) return pick(item.cloze ? ['cloze', 'listen', 'type', 'word'] : ['listen', 'type', 'word']);
  const pool = ['type', 'listen', mic ? 'speak' : 'type'];
  if (item.cloze) pool.push('clozeType', 'cloze');
  return pick(pool);
}

const easyType = (item) => (item.kind === 'p' ? 'meaning' : pick(['word', 'meaning']));

/* ---------------- Schritte für Lernfolgen ---------------- */

/** Abfrage direkt nach dem Kennenlernen (Runde 1 erkennen, Runde 2 abrufen). */
export function checkStep(item, round) {
  return async (flow) => {
    if (flow.data.known && flow.data.known.has(item.id)) return { skip: true };
    const type =
      round === 1
        ? item.kind === 'p'
          ? 'meaning'
          : pick(['meaning', 'listen'])
        : item.kind === 'p'
          ? pick(['order', 'listen'])
          : pick(item.cloze ? ['word', 'cloze'] : ['word']);
    const outcome = await runExercise(flow, item, type);
    if (outcome === 'again') {
      record(item, 'again');
      const n = flow.retries.get(item.id) || 0;
      if (n < 2) {
        flow.retries.set(item.id, n + 1);
        flow.addSoon(checkStep(item, round), 3);
      }
    } else if (round >= 2) {
      record(item, 'good');
    }
    return { item: item.id, outcome, fresh: true };
  };
}

/** Wiederholung eines fälligen Eintrags, Übungsart nach Stärke. */
export function reviewStep(item) {
  return async (flow) => {
    const s = strength(card(item));
    const outcome = await runExercise(flow, item, pickType(item, s));
    record(item, outcome);
    if (outcome === 'again') {
      const n = flow.retries.get(item.id) || 0;
      if (n < 1) {
        flow.retries.set(item.id, n + 1);
        flow.addSoon(retryStep(item), 4);
      }
    }
    return { item: item.id, outcome };
  };
}

function retryStep(item) {
  return async (flow) => {
    const outcome = await runExercise(flow, item, easyType(item));
    record(item, outcome === 'again' ? 'again' : 'good');
    return { item: item.id, outcome, retry: true };
  };
}

/** Paare finden – Italienisch links, Deutsch rechts. */
export function pairsStep(group) {
  return async (flow) => {
    const list = group.filter((x) => !(flow.data.known && flow.data.known.has(x.id))).slice(0, 5);
    if (list.length < 3) return { skip: true };
    const { body, foot } = frame(flow, 'pairs');
    body.append(prompt('Finde die Paare'));
    const L = shuffle(list);
    const R = shuffle(list);
    let selL = null;
    let selR = null;
    let matched = 0;
    let mistakes = 0;
    const grid = h('div.pairs-grid');
    const colL = h('div.pairs-col');
    const colR = h('div.pairs-col');
    grid.append(colL, colR);
    body.append(grid);
    return new Promise((resolve) => {
      const tryMatch = () => {
        if (!selL || !selR) return;
        const a = selL;
        const b = selR;
        selL = selR = null;
        if (a.item === b.item) {
          a.el.classList.remove('sel');
          b.el.classList.remove('sel');
          a.el.classList.add('done');
          b.el.classList.add('done');
          a.el.disabled = b.el.disabled = true;
          matched++;
          sfx('tick');
          if (matched === list.length) {
            sfx('ok');
            setTimeout(() => {
              foot.replaceChildren(h('p.center.good-text', mistakes ? 'Geschafft!' : G('Perfetto – alles richtig!')));
              resolve({ pairs: true, mistakes });
            }, 650);
          }
        } else {
          mistakes++;
          for (const x of [a, b]) {
            x.el.classList.remove('sel');
            x.el.classList.add('shake');
            setTimeout(() => x.el.classList.remove('shake'), 450);
          }
          sfx('bad');
        }
      };
      for (const it of L) {
        const el = h('button.pair.it', { type: 'button' }, G(it.alts[0]));
        el.addEventListener('click', () => {
          unlock();
          if (selL) selL.el.classList.remove('sel');
          selL = { item: it, el };
          el.classList.add('sel');
          stopSpeaking();
          say(sayItem(it));
          tryMatch();
        });
        colL.append(el);
      }
      for (const it of R) {
        const el = h('button.pair', { type: 'button' }, it.de);
        el.addEventListener('click', () => {
          if (selR) selR.el.classList.remove('sel');
          selR = { item: it, el };
          el.classList.add('sel');
          tryMatch();
        });
        colR.append(el);
      }
      foot.replaceChildren(h('p.small.muted.center', 'Tippe links ein italienisches Wort und rechts die passende Bedeutung.'));
    });
  };
}

/** Neue Einträge in Vierergruppen: vorstellen, Paare, erkennen, abrufen. */
export function learnSteps(list) {
  const steps = [];
  for (let i = 0; i < list.length; i += 4) {
    const group = list.slice(i, i + 4);
    for (const it of group) steps.push(introStep(it));
    const words = group.filter((x) => x.kind === 'w' && x.alts[0].length <= 28);
    if (words.length >= 3) steps.push(pairsStep(words));
    for (const it of shuffle(group)) steps.push(checkStep(it, 1));
    for (const it of shuffle(group)) steps.push(checkStep(it, 2));
  }
  return steps;
}

/** Schnell-Check: Was kenne ich schon? */
export function quickCheckStep(item) {
  return async (flow) => {
    const { body, foot } = frame(flow, 'quick');
    body.append(prompt('Kennst du das?'), headIt(item));
    const reveal = h('button.btn.big.primary', { type: 'button' }, 'Aufdecken');
    foot.replaceChildren(reveal);
    await tapOnce(reveal);
    body.append(h('p.word-de', item.de), exampleBlock(item));
    return new Promise((resolve) => {
      foot.replaceChildren(
        h(
          'div.row2',
          h('button.btn.ghost', { type: 'button', onClick: () => resolve({ item: item.id, knew: false }) }, 'Wusste ich nicht'),
          h(
            'button.btn.primary',
            {
              type: 'button',
              onClick: () => {
                markKnown(item);
                resolve({ item: item.id, knew: true });
              },
            },
            'Wusste ich',
          ),
        ),
      );
    });
  };
}

/** „Gut zu wissen“ als Zwischenkarte. */
export function noteStep(note) {
  return async (flow) => {
    const { body, foot } = frame(flow, 'note');
    body.append(
      h(
        'div.note-card',
        h('div.note-kicker', ico('bulb'), 'Gut zu wissen'),
        h('h2.note-title', note.t),
        h('p.note-text', rich(note.x)),
      ),
    );
    S().done.notes[note.id] = Date.now();
    save();
    await next(foot, 'Verstanden');
    return { note: note.id };
  };
}

/** Abschluss einer Lerneinheit. */
export function summaryStep({ title = 'Ben fatto!' } = {}) {
  return async (flow) => {
    const res = flow.results.filter((r) => r && r.outcome);
    const ok = res.filter((r) => r.outcome !== 'again').length;
    const fresh = new Set(flow.results.filter((r) => r && r.intro).map((r) => r.item)).size;
    const reviews = flow.results.filter((r) => r && r.outcome && !r.fresh && !r.retry).length;
    const pct = res.length ? Math.round((ok / res.length) * 100) : 100;
    const t = today();
    t.done = (t.done || 0) + 1;
    save();
    const st = streak();
    const { body, foot } = frame(flow, 'summary');
    sfx('win');
    body.append(
      h(
        'div.summary',
        h('div.summary-badge', '🎉'),
        h('h2.summary-title', G(pct >= 90 ? 'Bravissim{o|a}!' : title)),
        h(
          'div.summary-grid',
          stat(`${pct} %`, 'richtig'),
          stat(String(fresh), fresh === 1 ? 'neuer Eintrag' : 'neue Einträge'),
          stat(String(reviews), reviews === 1 ? 'Wiederholung' : 'Wiederholungen'),
          stat(`${Math.max(1, Math.round(t.sec / 60))} Min.`, 'heute gelernt'),
        ),
        h('p.summary-streak', ico('flame'), st > 1 ? ` ${st} Tage in Folge – weiter so!` : ' Tag 1 deiner Serie – bis morgen!'),
      ),
    );
    await next(foot, 'Fertig');
    return { summary: true };
  };
}

function stat(v, label) {
  return h('div.stat', h('div.stat-v', v), h('div.stat-l', label));
}
