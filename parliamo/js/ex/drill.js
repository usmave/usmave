/**
 * Trainings ohne Wortliste: Zahlen, Preise, Uhrzeiten, Datum, Telefonnummern –
 * und Aussprache mit Minimalpaaren.
 */
import { h, ico, spk, say, rich, shuffle, pick, sfx, stopSpeaking } from '../ui.js';
import { frame, prompt, choices, verdict, typeAnswer, speakAnswer, runFlow, playButton, slowButton } from '../flow.js';
import { numIt, priceIt, parsePrice, timeColloquial, timeDigital, MONTHS, MONTHS_DE, norm, g } from '../text.js';
import { S, save } from '../store.js';
import PRON from '../../data/pron.js';
import { summaryStep } from './vocab.js';

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const digits = (s) => String(s ?? '').replace(/\D+/g, '');
const pad = (n) => String(n).padStart(2, '0');

function dayWord(d) {
  return d === 1 ? 'primo' : numIt(d);
}
function dateIt(d, m) {
  const art = d === 8 || d === 11 ? "l'" : 'il ';
  return `${art}${dayWord(d)} ${MONTHS[m - 1]}`;
}
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function parseTime(s) {
  const t = String(s ?? '').trim().replace(/\s*uhr$/i, '');
  let m = t.match(/^(\d{1,2})\s*[:.,h ]\s*(\d{2})$/);
  if (!m) m = t.match(/^(\d{1,2})(\d{2})$/);
  if (m) return +m[1] * 60 + +m[2];
  m = t.match(/^(\d{1,2})$/);
  if (m) return +m[1] * 60;
  return null;
}

function parseDate(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\s*[./\-\s]\s*(\d{1,2})\.?$/);
  return m ? [+m[1], +m[2]] : null;
}

/** Aufgaben-Erzeuger. Jede Aufgabe: { say, show, check(input), write, placeholder } */
export const DRILLS = [
  {
    id: 'zahlen',
    title: 'Zahlen bis 100',
    icon: '🔢',
    speakable: true,
    gen() {
      const n = Math.random() < 0.3 ? rnd(0, 20) : rnd(21, 100);
      return { n, say: numIt(n), show: String(n), write: numIt(n), check: (t) => digits(t) === String(n), placeholder: 'Zahl, z. B. 47' };
    },
  },
  {
    id: 'grosse',
    title: 'Große Zahlen',
    icon: '💯',
    speakable: true,
    gen() {
      const r = Math.random();
      const n = r < 0.4 ? rnd(101, 999) : r < 0.8 ? rnd(1000, 9999) : rnd(10000, 250000);
      return { n, say: numIt(n), show: n.toLocaleString('de-DE'), write: numIt(n), check: (t) => digits(t) === String(n), placeholder: 'Zahl' };
    },
  },
  {
    id: 'preise',
    title: 'Preise',
    icon: '💶',
    gen() {
      const e = Math.random() < 0.5 ? rnd(1, 15) : rnd(16, 89);
      const c = pick([0, 0, 10, 20, 30, 40, 50, 50, 60, 70, 80, 90, 95, 99, 5, 25, 45, 75]);
      const cents = e * 100 + c;
      const ctx = pick(['Sono', 'Fanno', 'Costa', 'In tutto fanno', 'Il conto è di', 'Viene']);
      const shown = `${e},${pad(c)} €`;
      return {
        say: `${ctx} ${priceIt(cents)}.`,
        show: shown,
        write: priceIt(cents),
        check: (t) => parsePrice(t) === cents,
        placeholder: 'Betrag, z. B. 12,40',
      };
    },
  },
  {
    id: 'uhrzeit',
    title: 'Uhrzeiten',
    icon: '🕰️',
    gen() {
      const hh = rnd(0, 23);
      const mm = pick([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
      const shown = `${hh}:${pad(mm)}`;
      if (Math.random() < 0.5) {
        const t = timeColloquial(hh, mm);
        const ok = (inp) => {
          const v = parseTime(inp);
          if (v == null) return false;
          const target = hh * 60 + mm;
          return v % 720 === target % 720;
        };
        return { say: `${t.copula} ${t.phrase}.`, show: shown, write: `${t.copula.toLowerCase()} ${t.phrase}`, check: ok, placeholder: 'Uhrzeit, z. B. 7:30', note: 'Umgangssprachlich – 7:30 und 19:30 zählen beide.' };
      }
      const ctx = pick(['Il treno parte', 'Il volo arriva', 'Ci vediamo', 'Il museo chiude', 'La farmacia apre', 'Il pullman parte']);
      return {
        say: `${ctx} ${timeDigital(hh, mm)}.`,
        show: shown,
        write: timeDigital(hh, mm),
        check: (inp) => parseTime(inp) === hh * 60 + mm,
        placeholder: 'Uhrzeit, z. B. 18:45',
        note: 'Bei Fahrplänen und Öffnungszeiten zählt man bis 24.',
      };
    },
  },
  {
    id: 'datum',
    title: 'Datum',
    icon: '📅',
    gen() {
      const m = rnd(1, 12);
      const d = rnd(1, DAYS_IN[m - 1]);
      const ctx = pick(['Arriviamo', 'Partiamo', 'Il compleanno è', 'La festa è', 'Torno']);
      return {
        say: `${ctx} ${dateIt(d, m)}.`,
        show: `${d}. ${MONTHS_DE[m - 1]}`,
        write: dateIt(d, m),
        check: (t) => {
          const p = parseDate(t);
          return !!p && p[0] === d && p[1] === m;
        },
        placeholder: 'Tag.Monat, z. B. 23.3.',
        note: 'Nur der Erste heißt „il primo“ – alle anderen Tage zählt man normal.',
      };
    },
  },
  {
    id: 'jahre',
    title: 'Jahreszahlen',
    icon: '🗓️',
    speakable: true,
    gen() {
      const n = Math.random() < 0.8 ? rnd(1950, 2035) : pick([1492, 1861, 1946, 1968, 1871, 1300, 1555, 1789]);
      return { n, say: `Nel ${numIt(n)}.`, show: String(n), write: numIt(n), check: (t) => digits(t) === String(n), placeholder: 'Jahr' };
    },
  },
  {
    id: 'telefon',
    title: 'Telefonnummern',
    icon: '☎️',
    gen() {
      const num = `3${rnd(20, 93)}${rnd(1000000, 9999999)}`;
      const groups = [num.slice(0, 3), num.slice(3, 6), num.slice(6)];
      const spoken = groups.map((gp) => gp.split('').map((d) => numIt(+d)).join(' ')).join(', ');
      return {
        say: `Il mio numero è: ${spoken}.`,
        show: groups.join(' '),
        write: spoken,
        check: (t) => digits(t) === num,
        placeholder: 'Nummer',
        note: 'Handynummern beginnen in Italien mit 3. Man liest sie meist Ziffer für Ziffer.',
      };
    },
  },
];

function drillStep(drill, mode) {
  return async (flow) => {
    const task = drill.gen();
    const { body, foot } = frame(flow);
    if (mode === 'speak') {
      body.append(prompt('Sag es auf Italienisch'), h('div.head-de', h('div.word-de-big', task.show)));
      const r = await speakAnswer(body, foot, { placeholder: 'Als Wort oder Zahl …' });
      const heard = (r.alts || [r.text]).filter(Boolean);
      const ok = heard.some((t) => (digits(t) ? digits(t) === String(task.n) : norm(t).includes(norm(numIt(task.n)))));
      say(task.say);
      await verdict(foot, {
        ok: r.gaveUp ? false : ok,
        title: ok ? g(pick(['Esatto!', 'Giusto!', 'Perfetto!']), S().profile.sex) : 'So heißt es:',
        body: [h('p.v-line', h('span.it-strong', task.write), ' ', spk(task.say)), r.text ? h('p.small', 'Verstanden: „', h('i', r.text), '“') : null],
      });
      return { drill: drill.id, outcome: ok ? 'good' : 'again' };
    }
    body.append(prompt('Hör zu und schreib die Zahl auf'), h('div.listen-box', playButton(task.say, { auto: true }), slowButton(task.say)));
    if (task.note) body.append(h('p.small.muted.center', task.note));
    const r = await typeAnswer(body, foot, { placeholder: task.placeholder });
    const ok = !r.gaveUp && task.check(r.text);
    await verdict(foot, {
      ok,
      title: ok ? g(pick(['Esatto!', 'Giusto!', 'Perfetto!', 'Bravo!']), S().profile.sex) : 'Gesucht war:',
      body: [h('p.v-line', h('b', task.show), ' – ', h('span.it-strong', task.write), ' ', spk(task.say)), !ok && r.text ? h('p.small', 'Deine Antwort: ', h('s', r.text)) : null],
    });
    return { drill: drill.id, outcome: ok ? 'good' : 'again' };
  };
}

export function drillSteps(id, n = 10, mode = 'listen') {
  const drill = DRILLS.find((d) => d.id === id) || DRILLS[0];
  return Array.from({ length: n }, () => drillStep(drill, mode));
}

export function startDrill(id, mode = 'listen') {
  const drill = DRILLS.find((d) => d.id === id) || DRILLS[0];
  S().done.drill[id] = Date.now();
  save();
  return runFlow({ steps: [...drillSteps(id, 10, mode), summaryStep({ title: `${drill.title} – geschafft!` })] });
}

/* ---------------- Aussprache ---------------- */

export const PRON_SETS = PRON;

function pronStep(set, pair) {
  return async (flow) => {
    const [a, aDe, b, bDe] = pair;
    const target = Math.random() < 0.5 ? 0 : 1;
    const word = target === 0 ? a : b;
    const { body, foot } = frame(flow);
    body.append(prompt('Welches Wort hörst du?'), h('div.listen-box', playButton(word, { auto: true }), slowButton(word)));
    const opts = [
      { text: h('span.pron-opt', h('span.it-strong', a), h('small', aDe)), ok: target === 0 },
      { text: h('span.pron-opt', h('span.it-strong', b), h('small', bDe)), ok: target === 1 },
    ];
    const r = await choices(body, opts, { cls: 'two' });
    await verdict(foot, {
      ok: r.ok,
      title: r.ok ? g(pick(['Esatto!', 'Bravo!', 'Giusto!']), S().profile.sex) : `Das war „${word}“`,
      body: [
        h('p.v-line', h('span.it-strong', a), ` – ${aDe} `, spk(a)),
        h('p.v-line', h('span.it-strong', b), ` – ${bDe} `, spk(b)),
        h('p.small.muted', set.tip),
      ],
    });
    return { pron: set.id, outcome: r.ok ? 'good' : 'again' };
  };
}

export function pronSteps(setId, n = 10) {
  const set = PRON.find((s) => s.id === setId) || PRON[0];
  const pairs = [];
  while (pairs.length < n) pairs.push(...shuffle(set.pairs));
  return pairs.slice(0, n).map((p) => pronStep(set, p));
}

export function startPron(setId) {
  const set = PRON.find((s) => s.id === setId) || PRON[0];
  S().done.pron[set.id] = Date.now();
  save();
  const intro = async (flow) => {
    const { body, foot } = frame(flow, 'note');
    body.append(
      h('div.note-card', h('div.note-kicker', ico('speaker'), 'Aussprache'), h('h2.note-title', set.title), h('p.note-text', rich(set.tip)), set.more ? h('p.note-text', rich(set.more)) : null),
    );
    const b = h('button.btn.big.primary', { type: 'button' }, 'Los geht’s');
    foot.replaceChildren(b);
    await new Promise((r) => b.addEventListener('click', r, { once: true }));
    return { intro: true };
  };
  return runFlow({ steps: [intro, ...pronSteps(set.id, 10), summaryStep({ title: 'Gut gehört!' })] });
}
