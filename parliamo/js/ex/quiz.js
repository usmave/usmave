/**
 * „Il Milione“ – 15 Fragen bis zur Million, mit Sicherheitsstufen und drei Jokern.
 * Dazu die Blitzrunde: 60 Sekunden, so viele richtige Antworten wie möglich.
 */
import { h, ico, spk, say, rich, itText, shuffle, pick, sfx, euro, fmt, sheet, sleep, stopSpeaking, confirmSheet } from '../ui.js';
import { frame, runFlow, tapOnce } from '../flow.js';
import { items, quizQs, areaById, distractors, clozeOptions, QUIZ_CATS, levelRank } from '../content.js';
import { S, save } from '../store.js';
import { g } from '../text.js';
import { startItem, userLevel } from '../session.js';
import { unlock } from '../speech.js';

export const LADDER = [50, 100, 200, 300, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 125000, 500000, 1000000];
const SAFE = [4, 9];
const DIFF = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5];
const G = (t) => g(t, S().profile.sex);

/* ---------------- Fragen bauen ---------------- */

function levelsFor(d) {
  return { 1: ['A2'], 2: ['A2', 'B1'], 3: ['B1'], 4: ['B1', 'B2'], 5: ['B2'] }[d] || ['A2'];
}

function optFromText(t, ok) {
  const m = String(t).match(/^«([^»]+)»$/);
  if (m) return { text: G(m[1]), ok, it: true, say: m[1] };
  return { text: rich(t, { tap: false }), ok, raw: t };
}

function handQuestion(qq) {
  return {
    kind: 'hand',
    id: qq.id,
    d: qq.d,
    cat: QUIZ_CATS[qq.cat] || '',
    q: qq.q,
    options: shuffle(qq.a.map((t, i) => optFromText(t, i === 0))),
    x: qq.x,
  };
}

function autoQuestion(item, d) {
  const types = item.kind === 'p' ? ['pmeaning', 'pmeaning', 'pword'] : ['meaning', 'word'];
  if (item.kind === 'w' && item.cloze) types.push('cloze');
  if (item.kind === 'w' && item.cloze && d >= 4) types.push('cloze');
  let type = pick(types);
  const xItem = { item, x: item.note || '' };
  if (type === 'cloze') {
    const others = clozeOptions(item, S().profile.sex);
    if (others.length >= 3) {
      const c = item.cloze;
      return {
        kind: 'auto',
        d,
        ...xItem,
        cat: 'Lückensatz',
        q: 'Welches Wort passt in die Lücke?',
        it: `${G(c.pre)}___${G(c.post)}`,
        say: null,
        sub: item.exde,
        options: shuffle([{ text: G(c.word), ok: true, it: true }, ...others.map((w) => ({ text: w, it: true }))]),
      };
    }
    type = 'meaning';
  }
  const ds = distractors(item);
  if (ds.length < 3) return null;
  if (type === 'meaning' || type === 'pmeaning') {
    return {
      kind: 'auto',
      d,
      ...xItem,
      cat: item.kind === 'p' ? 'Was heißt das?' : 'Wortschatz',
      q: item.kind === 'p' ? 'Was bedeutet dieser Satz?' : 'Was bedeutet das?',
      it: item.it,
      say: item.alts.join(' / '),
      options: shuffle([{ text: item.de, ok: true }, ...ds.map((x) => ({ text: x.de }))]),
    };
  }
  return {
    kind: 'auto',
    d,
    ...xItem,
    cat: 'Wortschatz',
    q: `Wie sagt man „${item.de}“ auf Italienisch?`,
    options: shuffle([
      { text: G(item.alts[0]), ok: true, it: true, say: item.alts[0] },
      ...ds.map((x) => ({ text: G(x.alts[0]), it: true, say: x.alts[0] })),
    ]),
  };
}

function makeQuestion(step, ctx) {
  const d = DIFF[step];
  const takeHand = (anyDiff) => {
    let c = ctx.hand.filter((x) => x.d === d && !ctx.usedHand.has(x.id));
    if (!c.length && anyDiff) c = ctx.hand.filter((x) => Math.abs(x.d - d) <= 1 && !ctx.usedHand.has(x.id));
    if (!c.length) return null;
    const unseen = c.filter((x) => !S().quiz.seen[x.id]);
    const qq = pick(unseen.length ? unseen : c);
    ctx.usedHand.add(qq.id);
    S().quiz.seen[qq.id] = Date.now();
    return handQuestion(qq);
  };
  const takeAuto = () => {
    const lv = levelsFor(d);
    let cands = ctx.pool.filter((x) => lv.includes(x.lvl) && !ctx.used.has(x.id));
    if (d <= 2) {
      const known = cands.filter((x) => S().cards[x.id]);
      if (known.length >= 6) cands = known;
    }
    if (!cands.length) cands = ctx.pool.filter((x) => !ctx.used.has(x.id));
    for (let tries = 0; tries < 6 && cands.length; tries++) {
      const item = pick(cands);
      ctx.used.add(item.id);
      const q = autoQuestion(item, d);
      if (q) return q;
    }
    return null;
  };
  const wantHand = Math.random() < 0.55;
  return (wantHand && takeHand(false)) || takeAuto() || takeHand(true) || takeAuto();
}

/* ---------------- Joker ---------------- */

const FRIENDS = [
  { name: 'Nonna Rosa', icon: '👵', city: 'Neapel', hello: 'Pronto? Ciao, tesoro!' },
  { name: 'Marco', icon: '🧔', city: 'Mailand', hello: 'Ciao! Dimmi tutto.' },
  { name: 'Giulia', icon: '👩', city: 'Bologna', hello: 'Pronto? Ah, sei tu!' },
  { name: 'Zio Franco', icon: '👨‍🍳', city: 'Palermo', hello: 'Eh, pronto! Chi è?' },
];

const SAYS = {
  sure: ['Ma certo! Das ist {X}. Sicurissimo!', 'Facile! Ich sage {X} – da bin ich mir ganz sicher.', 'Ah, das weiß ich: {X}!'],
  mid: ['Mmh … ich glaube, es ist {X}. Ziemlich sicher.', 'Ich würde {X} nehmen – aber ohne Garantie.', 'Spontan sage ich {X}.'],
  unsure: ['Mamma mia, schwierig! Vielleicht {X}? Ich weiß es wirklich nicht.', 'Boh … ich rate mal: {X}.', 'Uff! Wenn überhaupt, dann {X}. Aber ich bin mir unsicher.'],
};

function phoneAnswer(q, visible, d) {
  const ci = q.options.findIndex((o) => o.ok);
  const pRight = [0.96, 0.9, 0.8, 0.68, 0.55][d - 1] || 0.6;
  const right = Math.random() < pRight;
  const pickIdx = right ? ci : pick(visible.filter((i) => i !== ci));
  let tone;
  const r = Math.random();
  if (right) tone = r < [0.8, 0.65, 0.45, 0.3, 0.2][d - 1] ? 'sure' : r < 0.85 ? 'mid' : 'unsure';
  else tone = r < 0.15 ? 'sure' : r < 0.5 ? 'mid' : 'unsure';
  return { idx: pickIdx, text: pick(SAYS[tone]).replace('{X}', 'ABCD'[pickIdx]) };
}

function audienceVotes(q, visible, d) {
  const ci = q.options.findIndex((o) => o.ok);
  const base = [0.76, 0.64, 0.52, 0.43, 0.36][d - 1] || 0.4;
  let share = Math.min(0.92, Math.max(0.24, base + (Math.random() - 0.5) * 0.16));
  if (visible.length === 2) share = Math.min(0.95, share + 0.12);
  let top = ci;
  if (d >= 4 && Math.random() < 0.18) top = pick(visible.filter((i) => i !== ci));
  const rem = visible.filter((i) => i !== top);
  const ws = rem.map(() => Math.random() + 0.35);
  const sum = ws.reduce((a, b) => a + b, 0);
  const votes = [0, 0, 0, 0];
  votes[top] = share;
  rem.forEach((i, k) => (votes[i] = ((1 - share) * ws[k]) / sum));
  // auf ganze Prozent runden, Summe 100
  const pct = votes.map((v) => Math.floor(v * 100));
  let diff = 100 - pct.reduce((a, b) => a + b, 0);
  for (const i of visible) {
    if (diff <= 0) break;
    pct[i]++;
    diff--;
  }
  return pct;
}

/* ---------------- Spiel ---------------- */

function ladderView(current, { compact = false } = {}) {
  const rows = [];
  for (let i = LADDER.length - 1; i >= 0; i--) {
    rows.push(
      h(
        'li.lad-row' + (SAFE.includes(i) ? '.safe' : '') + (i === current ? '.now' : '') + (i < current ? '.won' : ''),
        h('span.lad-n', String(i + 1)),
        h('span.lad-v', euro(LADDER[i])),
      ),
    );
  }
  return h('ol.ladder' + (compact ? '.compact' : ''), rows);
}

function askQuestion(flow, q, s, life) {
  return new Promise((resolve) => {
    const { body, foot } = frame(flow, 'mq');
    const visible = [0, 1, 2, 3];
    const amount = h('div.mq-amount', euro(LADDER[s]));
    const top = h('div.mq-top', h('div.mq-step', `Frage ${s + 1} von 15`), amount);
    const lifeBtn = (key, content, label, fn) => {
      const b = h('button.mq-joker' + (life[key] ? '' : '.used'), { type: 'button', 'aria-label': label, disabled: !life[key] }, content);
      b.addEventListener('click', () => {
        if (!life[key]) return;
        life[key] = false;
        b.classList.add('used');
        b.disabled = true;
        fn();
      });
      return b;
    };
    const btns = [];
    const lifeRow = h(
      'div.mq-life',
      lifeBtn('fifty', h('span.mq-j50', '50:50'), 'Joker 50:50', () => {
        const ci = q.options.findIndex((o) => o.ok);
        const wrong = shuffle(visible.filter((i) => i !== ci)).slice(0, 2);
        for (const i of wrong) {
          btns[i].classList.add('gone');
          btns[i].disabled = true;
          visible.splice(visible.indexOf(i), 1);
        }
        sfx('tick');
      }),
      lifeBtn('audience', ico('people'), 'Publikumsjoker', () => {
        const pct = audienceVotes(q, visible, q.d);
        sheet({
          title: 'Das Publikum stimmt ab',
          cls: 'stage-sheet',
          body: h(
            'div.poll',
            [0, 1, 2, 3].map((i) =>
              h(
                'div.poll-col' + (visible.includes(i) ? '' : '.off'),
                h('div.poll-bar', h('div.poll-fill', { style: { height: `${pct[i]}%` } })),
                h('div.poll-pct', visible.includes(i) ? `${pct[i]} %` : ''),
                h('div.poll-l', 'ABCD'[i]),
              ),
            ),
          ),
          actions: [{ label: 'Zurück zur Frage', value: true, primary: true }],
        });
      }),
      lifeBtn('phone', ico('phone'), 'Telefonjoker', () => {
        const fr = pick(FRIENDS);
        const ans = phoneAnswer(q, visible, q.d);
        const msg = h('p.phone-msg', '');
        const box = h(
          'div.phone',
          h('div.phone-who', h('span.phone-ico', fr.icon), h('div', h('b', fr.name), h('div.small', `aus ${fr.city}`))),
          h('p.phone-hello', rich(`«${fr.hello}»`, { tap: false })),
          msg,
        );
        sheet({ title: 'Telefonjoker', cls: 'stage-sheet', body: box, actions: [{ label: 'Grazie, ciao!', value: true, primary: true }] });
        // Antwort Wort für Wort „sprechen“
        const words = ans.text.split(' ');
        let i = 0;
        const tick = () => {
          if (i >= words.length) return;
          msg.textContent += (i ? ' ' : '') + words[i++];
          setTimeout(tick, 110);
        };
        setTimeout(tick, 900);
      }),
    );
    const itLine = q.it
      ? h('div.mq-it', h('span', itText(q.it)), q.say ? spk(q.say) : null)
      : null;
    const qBox = h(
      'div.mq-q',
      q.cat && h('div.mq-cat', q.cat),
      h('p.mq-text', rich(q.q)),
      itLine,
      q.sub ? h('p.mq-sub', q.sub) : null,
    );
    if (q.say) setTimeout(() => say(q.say), 300);
    const opts = h('div.mq-opts');
    q.options.forEach((o, i) => {
      const b = h(
        'button.mq-opt' + (o.it ? '.it' : ''),
        { type: 'button', onClick: () => lock(i) },
        h('span.mq-letter', 'ABCD'[i]),
        h('span.mq-otext', o.text),
      );
      btns.push(b);
    });
    opts.append(...btns);
    body.append(top, lifeRow, qBox, opts);
    const walkBtn =
      s > 0
        ? h(
            'button.btn.stage-ghost',
            {
              type: 'button',
              onClick: async () => {
                const ok = await confirmSheet(
                  'Aussteigen?',
                  `Du nimmst ${euro(LADDER[s - 1])} mit und das Spiel ist vorbei.`,
                  'Aussteigen',
                  { cancel: 'Weiterspielen' },
                );
                if (ok) resolve('walk');
              },
            },
            `Aussteigen mit ${euro(LADDER[s - 1])}`,
          )
        : h('p.small.stage-muted.center', 'Ab Frage 5 sind 500 € sicher, ab Frage 10 sind es 16.000 €.');
    foot.replaceChildren(walkBtn);

    async function lock(i) {
      unlock();
      btns.forEach((b) => (b.disabled = true));
      btns[i].classList.add('locked');
      lifeRow.classList.add('off');
      foot.replaceChildren(h('p.small.stage-muted.center', 'Eingeloggt …'));
      await sleep(1200);
      const ok = !!q.options[i].ok;
      const ci = q.options.findIndex((o) => o.ok);
      btns[i].classList.remove('locked');
      btns[ci].classList.add('right');
      if (!ok) btns[i].classList.add('wrong');
      sfx(ok ? (s === 14 ? 'win' : 'ok') : 'bad');
      const right = q.options[ci];
      if (right.it) say(right.say || (typeof right.text === 'string' ? right.text : ''));
      const xp = explain(q, ok);
      const label = ok ? (s === 14 ? 'Zum Gewinn' : SAFE.includes(s) ? 'Weiter' : `Weiter zur Frage um ${euro(LADDER[s + 1])}`) : 'Zum Ergebnis';
      const b = h('button.btn.big.gold', { type: 'button' }, label);
      foot.replaceChildren(xp, b);
      await tapOnce(b);
      resolve(ok);
    }
  });
}

function explain(q, ok) {
  const parts = [];
  parts.push(h('div.mq-verdict.' + (ok ? 'good' : 'bad'), ok ? G(pick(['Esatto!', 'Giusto!', 'Bravo!', 'Perfetto!', 'Bravissim{o|a}!'])) : 'Leider falsch.'));
  if (q.item) {
    const it = q.item;
    parts.push(h('p.mq-x', h('span.itq', itText(it.it)), ' heißt „', it.de, '“.'));
    if (it.ex) parts.push(h('p.mq-x.small', h('span.itq', G(it.ex)), it.exde ? ` – ${it.exde}` : ''));
    if (it.note) parts.push(h('p.mq-x.small', rich(it.note)));
  } else if (q.x) parts.push(h('p.mq-x', rich(q.x)));
  const box = h('div.mq-explain', parts);
  if (q.item && !S().cards[q.item.id]) {
    const add = h('button.chip.stage-chip', { type: 'button' }, '+ Zu meinen Wörtern');
    add.addEventListener('click', () => {
      startItem(q.item);
      add.textContent = 'Gemerkt ✓';
      add.disabled = true;
    });
    box.append(add);
  }
  return box;
}

async function safeScreen(flow, s) {
  const { body, foot } = frame(flow, 'mq');
  body.append(
    h('div.mq-safe', h('div.mq-safe-ico', '🔒'), h('h2', `${euro(LADDER[s])} sind dir sicher!`), h('p', 'Selbst bei einer falschen Antwort gehst du nicht mehr leer aus.')),
    ladderView(s + 1, { compact: true }),
  );
  const b = h('button.btn.big.gold', { type: 'button' }, `Weiter zur Frage um ${euro(LADDER[s + 1])}`);
  foot.replaceChildren(b);
  await tapOnce(b);
}

function safeAmount(failedAt) {
  if (failedAt > SAFE[1]) return LADDER[SAFE[1]];
  if (failedAt > SAFE[0]) return LADDER[SAFE[0]];
  return 0;
}

async function finish(flow, won, how, areaId) {
  const qz = S().quiz;
  qz.games++;
  qz.bank += won;
  const record = won > qz.best;
  qz.best = Math.max(qz.best, won);
  if (won >= 1000000) qz.millions++;
  if (areaId) qz.area[areaId] = Math.max(qz.area[areaId] || 0, won);
  save(true);
  const { body, foot } = frame(flow, 'mq');
  if (won >= 1000000) sfx('win');
  const title =
    won >= 1000000 ? G('Il Milione! Sei un genio!') : how === 'walk' ? 'Klug ausgestiegen!' : won > 0 ? 'Gut gespielt!' : 'Schade!';
  body.append(
    h(
      'div.mq-end',
      h('div.mq-end-ico', won >= 1000000 ? '🏆' : how === 'walk' ? '🤝' : won > 0 ? '💶' : '🍀'),
      h('h2', title),
      h('p.mq-end-l', 'Dein Gewinn'),
      h('div.mq-end-v', euro(won)),
      record && won > 0 ? h('p.mq-record', 'Neuer Rekord!') : null,
      h('p.stage-muted', `Bestwert: ${euro(qz.best)}`),
      h('p.stage-muted', `Kontostand aus allen Spielen: ${euro(qz.bank)}`),
    ),
  );
  return new Promise((resolve) => {
    foot.replaceChildren(
      h('button.btn.big.gold', { type: 'button', onClick: () => resolve('again') }, 'Nochmal spielen'),
      h('button.btn.stage-ghost', { type: 'button', onClick: () => resolve('done') }, 'Fertig'),
    );
  });
}

async function introScreen(flow, areaId) {
  const { body, foot } = frame(flow, 'mq');
  const area = areaId ? areaById.get(areaId) : null;
  body.append(
    h(
      'div.mq-intro',
      h('h1.mq-title', 'Il Milione'),
      h('p.mq-lead', area ? `${area.icon} ${area.title}` : 'Alle Lebensbereiche'),
      h('p.stage-muted', '15 Fragen, jede ein bisschen schwerer. Bei 500 € und 16.000 € ist dein Gewinn sicher. Du hast drei Joker und kannst jederzeit aussteigen.'),
      h(
        'div.mq-jokers',
        h('div', h('span.mq-j50', '50:50'), h('small', 'zwei falsche Antworten weg')),
        h('div', ico('people'), h('small', 'das Publikum fragen')),
        h('div', ico('phone'), h('small', 'jemanden anrufen')),
      ),
    ),
    ladderView(-1, { compact: true }),
  );
  const b = h('button.btn.big.gold', { type: 'button' }, 'Spiel starten');
  foot.replaceChildren(b);
  await tapOnce(b);
}

async function game(flow, areaId) {
  const area = areaId ? areaById.get(areaId) : null;
  const ctx = {
    pool: area ? area.items : items,
    hand: area ? area.quiz : quizQs,
    used: new Set(),
    usedHand: new Set(),
  };
  const life = { fifty: true, audience: true, phone: true };
  for (let s = 0; s < 15; s++) {
    const q = makeQuestion(s, ctx);
    if (!q) return finish(flow, s ? LADDER[s - 1] : 0, 'walk', areaId);
    const res = await askQuestion(flow, q, s, life);
    if (res === 'walk') return finish(flow, LADDER[s - 1] || 0, 'walk', areaId);
    if (!res) return finish(flow, safeAmount(s), 'wrong', areaId);
    if (s === 14) return finish(flow, LADDER[14], 'million', areaId);
    if (SAFE.includes(s)) await safeScreen(flow, s);
  }
  return 'done';
}

/** Startet „Il Milione“ – für alle Bereiche oder einen bestimmten. */
export async function startMilione(areaId = null) {
  const steps = [];
  const play = async (flow) => {
    const r = await game(flow, areaId);
    if (r === 'again') flow.add(play);
    return { game: true };
  };
  steps.push(async (flow) => {
    await introScreen(flow, areaId);
    return { intro: true };
  });
  steps.push(play);
  return runFlow({ steps, theme: 'stage', bar: false, label: 'Il Milione', confirmClose: true });
}

/* ---------------- Blitzrunde ---------------- */

function blitzPool() {
  const learned = items.filter((x) => S().cards[x.id] && x.kind === 'w');
  if (learned.length >= 12) return learned;
  const L = levelRank(userLevel());
  return items.filter((x) => x.kind === 'w' && levelRank(x.lvl) <= L);
}

function blitzQuestion(pool, recent) {
  for (let t = 0; t < 8; t++) {
    const item = pick(pool);
    if (recent.includes(item.id)) continue;
    const ds = distractors(item);
    if (ds.length < 3) continue;
    recent.push(item.id);
    if (recent.length > 20) recent.shift();
    const dir = Math.random() < 0.5;
    return dir
      ? { item, q: itText(item.it), qIt: true, options: shuffle([{ text: item.de, ok: true }, ...ds.map((x) => ({ text: x.de }))]) }
      : { item, q: item.de, qIt: false, options: shuffle([{ text: G(item.alts[0]), ok: true, it: true }, ...ds.map((x) => ({ text: G(x.alts[0]), it: true }))]) };
  }
  return null;
}

async function blitzGame(flow, loop = true) {
  {
    const { body, foot } = frame(flow, 'mq');
    body.append(
      h(
        'div.mq-intro',
        h('h1.mq-title', 'Blitzrunde'),
        h('p.mq-lead', '60 Sekunden'),
        h('p.stage-muted', 'So viele richtige Antworten wie möglich. Abwechselnd Italienisch → Deutsch und Deutsch → Italienisch.'),
        h('p.stage-muted', `Dein Rekord: ${S().quiz.blitzBest} richtige`),
      ),
    );
    const b = h('button.btn.big.gold', { type: 'button' }, 'Los!');
    foot.replaceChildren(b);
    await tapOnce(b);
  }
  const pool = blitzPool();
  const recent = [];
  const missed = [];
  let score = 0;
  let total = 0;
  const end = Date.now() + 60000;
  const { body, foot } = frame(flow, 'mq blitz');
  const fill = h('div.blitz-fill');
  const scoreEl = h('div.blitz-score', '0');
  const qEl = h('div.blitz-q');
  const opts = h('div.mq-opts');
  body.append(h('div.blitz-top', h('div.blitz-bar', fill), scoreEl), qEl, opts);
  foot.replaceChildren();
  let timeUp = false;
  const timer = setInterval(() => {
    const left = Math.max(0, end - Date.now());
    fill.style.width = `${(left / 60000) * 100}%`;
    if (left <= 10000) fill.classList.add('hurry');
    if (left <= 0) {
      timeUp = true;
      clearInterval(timer);
      if (resolveCur) resolveCur(null);
    }
  }, 100);
  let resolveCur = null;
  try {
    while (!timeUp && !flow.closed) {
      const q = blitzQuestion(pool, recent);
      if (!q) break;
      qEl.replaceChildren(h(q.qIt ? 'div.blitz-it' : 'div.blitz-de', q.q));
      const res = await new Promise((resolve) => {
        resolveCur = resolve;
        opts.replaceChildren(
          ...q.options.map((o, i) =>
            h('button.mq-opt' + (o.it ? '.it' : ''), { type: 'button', onClick: () => resolve(i) }, h('span.mq-otext', o.text)),
          ),
        );
      });
      resolveCur = null;
      if (res === null) break;
      total++;
      const btns = [...opts.children];
      const ci = q.options.findIndex((o) => o.ok);
      btns.forEach((b) => (b.disabled = true));
      btns[ci].classList.add('right');
      if (q.options[res].ok) {
        score++;
        scoreEl.textContent = String(score);
        sfx('tick');
        await sleep(260);
      } else {
        btns[res].classList.add('wrong');
        missed.push(q.item);
        sfx('bad');
        await sleep(900);
      }
    }
  } finally {
    clearInterval(timer);
  }
  const qz = S().quiz;
  qz.blitzGames++;
  const rec = score > qz.blitzBest;
  qz.blitzBest = Math.max(qz.blitzBest, score);
  save(true);
  const fr = frame(flow, 'mq');
  if (rec && score > 0) sfx('win');
  const uniq = [...new Map(missed.map((m) => [m.id, m])).values()];
  fr.body.append(
    h(
      'div.mq-end',
      h('div.mq-end-ico', '⚡'),
      h('h2', score >= 20 ? G('Fantastic{o|a}!') : score >= 10 ? 'Stark!' : 'Gut gemacht!'),
      h('div.mq-end-v', `${score} richtig`),
      h('p.stage-muted', `${total} Fragen in 60 Sekunden`),
      rec && score > 0 ? h('p.mq-record', 'Neuer Rekord!') : h('p.stage-muted', `Rekord: ${qz.blitzBest}`),
    ),
    uniq.length
      ? h(
          'div.blitz-missed',
          h('h3', 'Daneben lagst du bei'),
          uniq.slice(0, 10).map((m) => h('p', h('span.itq', itText(m.it)), ` – ${m.de}`)),
        )
      : null,
  );
  return new Promise((resolve) => {
    const again = loop ? h('button.btn.big.gold', { type: 'button', onClick: () => resolve('again') }, 'Nochmal') : null;
    const done = h('button.btn' + (loop ? '.stage-ghost' : '.big.gold'), { type: 'button', onClick: () => resolve('done') }, loop ? 'Fertig' : 'Weiter');
    const add = uniq.some((m) => !S().cards[m.id])
      ? h(
          'button.btn.stage-ghost',
          {
            type: 'button',
            onClick: (e) => {
              for (const m of uniq) startItem(m);
              e.currentTarget.textContent = 'Gemerkt ✓';
              e.currentTarget.disabled = true;
            },
          },
          'Diese Wörter lernen',
        )
      : null;
    fr.foot.replaceChildren(again, add, done);
  });
}

/** Blitzrunde als eigene Übung oder als Baustein im Tagesprogramm. */
export function blitzStep(loop = true) {
  const step = async (flow) => {
    const r = await blitzGame(flow, loop);
    if (r === 'again' && loop) flow.add(step);
    return { blitz: true };
  };
  return step;
}

export function startBlitz() {
  return runFlow({ steps: [blitzStep(true)], theme: 'stage', bar: false, label: 'Blitzrunde', confirmClose: false });
}
