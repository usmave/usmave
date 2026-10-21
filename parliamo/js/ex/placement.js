/**
 * Einstufungstest: bis zu drei Teile (A2, B1, B2) mit je 8 Aufgaben.
 * Ein Teil gilt mit 6 von 8 als bestanden, dann geht es zum nächsten.
 */
import { h, ico, rich, shuffle, pick, sleep, itText, say } from '../ui.js';
import { frame, prompt, next, runFlow, tapOnce, playButton } from '../flow.js';
import { items, distractors, otherSentences, LEVELS, LEVEL_NAMES } from '../content.js';
import { S, save } from '../store.js';
import { g } from '../text.js';
import GRAMMAR from '../../data/placement.js';

const G = (t) => g(t, S().profile.sex);

function parseGrammar() {
  const out = { A2: [], B1: [], B2: [] };
  for (const raw of GRAMMAR.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const [lvl, q, ...a] = line.split('|').map((s) => s.trim());
    if (out[lvl] && a.length >= 4) out[lvl].push({ q, a });
  }
  return out;
}

function tasksFor(lvl, grammar) {
  const tasks = [];
  for (const gq of shuffle(grammar[lvl]).slice(0, 4)) {
    tasks.push({
      kind: 'g',
      render: () => [prompt('Was passt in die Lücke?'), h('p.cloze-it', G(gq.q).replace('___', '_____'))],
      options: shuffle(gq.a.map((t, i) => ({ text: G(t), ok: i === 0, it: true }))),
    });
  }
  const words = shuffle(items.filter((x) => x.kind === 'w' && x.lvl === lvl));
  for (const it of words.slice(0, 2)) {
    const ds = distractors(it);
    if (ds.length < 3) continue;
    tasks.push({
      kind: 'w',
      render: () => [prompt('Was bedeutet das?'), h('div.word-it.center', itText(it.it))],
      options: shuffle([{ text: it.de, ok: true }, ...ds.map((x) => ({ text: x.de }))]),
    });
  }
  const sents = shuffle(items.filter((x) => x.ex && x.exde && x.lvl === lvl && x.ex.split(' ').length >= 5));
  for (const it of sents.slice(0, 2)) {
    const others = otherSentences(it);
    if (others.length < 3) continue;
    tasks.push({
      kind: 'l',
      render: () => [prompt('Hör zu: Was bedeutet der Satz?'), h('div.listen-box', playButton(it.ex, { auto: true }))],
      options: shuffle([{ text: it.exde, ok: true }, ...others.map((t) => ({ text: t }))]),
    });
  }
  return shuffle(tasks).slice(0, 8);
}

async function ask(flow, task, label) {
  const { body, foot } = frame(flow, 'placement');
  body.append(h('p.small.muted', label), ...task.render());
  const list = h('div.choices');
  return new Promise((resolve) => {
    const btns = task.options.map((o) =>
      h('button.choice' + (o.it ? '.it' : ''), { type: 'button' }, h('span.choice-text', o.text)),
    );
    btns.forEach((b, i) =>
      b.addEventListener('click', async () => {
        btns.forEach((x) => (x.disabled = true));
        b.classList.add('picked');
        await sleep(260);
        resolve(!!task.options[i].ok);
      }),
    );
    list.append(...btns);
    body.append(list);
    foot.replaceChildren(
      h('button.btn.ghost', { type: 'button', onClick: () => resolve(false) }, 'Weiß ich nicht'),
    );
  });
}

export function placementStep() {
  return async (flow) => {
    {
      const { body, foot } = frame(flow, 'note');
      body.append(
        h(
          'div.note-card',
          h('div.note-kicker', ico('star'), 'Einstufung'),
          h('h2.note-title', 'Wo stehst du?'),
          h('p.note-text', 'Bis zu drei kurze Teile mit je 8 Aufgaben: Grammatik, Wörter und Hören. Wenn ein Teil gut klappt, geht es mit dem nächsten weiter.'),
          h('p.note-text', 'Rate nicht wild – wenn du etwas nicht weißt, tippe auf „Weiß ich nicht“. So passt das Ergebnis besser.'),
        ),
      );
      await next(foot, 'Test starten');
    }
    const grammar = parseGrammar();
    const scores = {};
    let passed = -1;
    for (let li = 0; li < LEVELS.length; li++) {
      const lvl = LEVELS[li];
      const tasks = tasksFor(lvl, grammar);
      let right = 0;
      for (let ti = 0; ti < tasks.length; ti++) {
        if (await ask(flow, tasks[ti], `Teil ${li + 1} von 3, Aufgabe ${ti + 1} von ${tasks.length}`)) right++;
      }
      scores[lvl] = `${right}/${tasks.length}`;
      if (right >= Math.ceil(tasks.length * 0.75)) passed = li;
      else break;
    }
    const level = LEVELS[Math.min(LEVELS.length - 1, passed + 1)];
    S().profile.level = level;
    S().profile.placement = { scores, at: Date.now(), level };
    save(true);
    const { body, foot } = frame(flow, 'summary');
    const text = {
      A2: 'Du startest mit dem Grundwortschatz der Alltagssituationen. Was du schon kennst, überspringst du mit „Kenne ich schon“.',
      B1: 'Neue Wörter kommen zuerst aus der Mittelstufe. Leichtere Wörter, die du schon kennst, überspringst du mit „Kenne ich schon“ – oder du nutzt im Bereich den Schnell-Check.',
      B2: 'Respekt! Neue Wörter kommen zuerst aus der Oberstufe. Mit dem Schnell-Check in jedem Bereich hakst du Bekanntes in Sekunden ab.',
    }[level];
    body.append(
      h(
        'div.summary',
        h('div.summary-badge', '🎯'),
        h('p.small.muted', 'Dein Niveau'),
        h('h2.summary-title', `${level} – ${LEVEL_NAMES[level]}`),
        h('p', text),
        h('p.small.muted', 'Du kannst das Niveau jederzeit unter „Mehr“ ändern oder den Test wiederholen.'),
      ),
    );
    await next(foot, 'Los geht’s');
    return { placement: level };
  };
}

export function startPlacement() {
  return runFlow({ steps: [placementStep()], bar: false, label: 'Einstufung' });
}
