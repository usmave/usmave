/**
 * Die Ansichten der fünf Reiter: Heute, Bereiche, Quiz, Üben, Mehr –
 * plus Bereichsseite, Wortliste, Statistik, Einstellungen und Hilfe.
 */
import {
  h, ico, spk, say, rich, itText, fmt, euro, count, sheet, confirmSheet, toast, bar, strengthBar, sparkline, ring, btn, shuffle,
} from './ui.js';
import { S, save, today, streak, exportJSON, importJSON, resetAll, storageWorks } from './store.js';
import {
  GROUPS, areas, areaById, items, dialogs, roles, quizQs, areasOf, LEVELS, LEVEL_NAMES, totals,
} from './content.js';
import {
  areaStats, nextStageHint, STAGES, totalsNow, curve, minutesSeries, wordOfDay, dueCount, focusArea, newLeft, card,
  markKnown, resetItem, userLevel,
} from './session.js';
import { strength, dayKey, DAY, startOfDay } from './srs.js';
import { planToday, startToday, startAreaLearn, startReview, startItems, startQuickCheck, DURATIONS } from './today.js';
import { startMilione, startBlitz, LADDER } from './ex/quiz.js';
import { startDialog, startDictation } from './ex/listen.js';
import { startRole, startShadowing } from './ex/speak.js';
import { DRILLS, startDrill, PRON_SETS, startPron } from './ex/drill.js';
import { startPlacement } from './ex/placement.js';
import { exampleBlock } from './ex/vocab.js';
import { italianVoices, voiceLabel, speak, RATES, sttAvailable, ttsAvailable } from './speech.js';
import { g, norm } from './text.js';

let nav = null;
export function setNav(n) {
  nav = n;
}

const G = (t) => g(t, S().profile.sex);
const STRENGTH = ['Neu', 'In Arbeit', 'Frisch gelernt', 'Sitzt', 'Sitzt fest'];

/** Startet eine Übungsfolge und zeichnet danach die aktuelle Ansicht neu. */
async function play(p) {
  if (!p) return;
  await p;
  nav.refresh();
}

function header(title, { back = false, sub = '' } = {}) {
  return h(
    'header.page-head',
    back ? h('button.back', { type: 'button', onClick: () => nav.back(), 'aria-label': 'Zurück' }, ico('back'), h('span', 'Zurück')) : null,
    h('h1.page-title', title),
    sub ? h('p.page-sub', sub) : null,
  );
}

function row(main, sub, { onClick, right = null, icon = null, cls = '' } = {}) {
  return h(
    'button.row' + (cls ? '.' + cls : ''),
    { type: 'button', onClick },
    icon ? h('span.row-ico', icon) : null,
    h('span.row-main', h('span.row-title', main), sub ? h('span.row-sub', sub) : null),
    right,
    ico('chevron', 'row-chev'),
  );
}

function stageDots(stage) {
  return h(
    'span.dots',
    { 'aria-label': `Stufe ${stage} von 4` },
    [1, 2, 3, 4].map((i) => h('span.dot' + (i <= stage ? '.on' : ''))),
  );
}

/* ================================================================ Heute */

function greeting() {
  const hr = new Date().getHours();
  if (hr >= 4 && hr < 12) return ['Buongiorno', 'Guten Morgen'];
  if (hr >= 12 && hr < 17) return ['Buon pomeriggio', 'Schönen Nachmittag'];
  return ['Buonasera', 'Guten Abend'];
}

export function renderHome(view) {
  const [it, de] = greeting();
  const name = S().profile.name;
  const minutes = S().settings.minutes || 15;
  const t = today();
  const doneMin = Math.round(t.sec / 60);
  const plan = planToday(minutes);
  const tot = totalsNow();
  const st = streak();

  const awning = h('div.awning', { 'aria-hidden': 'true' }, h('div.awning-stripes'), h('div.awning-edge'));
  const hello = h('section.hello', h('h1.hello-it', name ? `${it}, ${name}!` : `${it}!`), h('p.hello-de', de));

  // Tageskarte
  const chips = h(
    'div.seg',
    DURATIONS.map((m) =>
      h(
        'button.seg-btn' + (m === minutes ? '.on' : ''),
        {
          type: 'button',
          onClick: () => {
            S().settings.minutes = m;
            save();
            nav.refresh();
          },
        },
        `${m} Min.`,
      ),
    ),
  );
  const parts = [];
  if (plan.reviews.length) parts.push(count(plan.reviews.length, 'Wiederholung', 'Wiederholungen'));
  if (plan.fresh.length) parts.push(`${count(plan.fresh.length, 'neuer Eintrag', 'neue Einträge')} aus „${plan.area.title}“`);
  const planText = parts.length
    ? `Heute dran: ${parts.join(' und ')}${plan.blocks ? ', dazu etwas zur Abwechslung.' : '.'}`
    : 'Alles wiederholt und das Tagesziel für neue Wörter erreicht. Jetzt gibt es Übungen zur Abwechslung.';
  const goal = Math.min(1, doneMin / minutes);
  const todayCard = h(
    'section.card.today',
    h(
      'div.today-top',
      ring(goal, h('span', String(doneMin))),
      h('div', h('h2.card-title', 'Heute lernen'), h('p.small.muted', doneMin ? `Heute schon ${doneMin} von ${minutes} Minuten` : `Wie viel Zeit hast du?`)),
    ),
    chips,
    h('p.today-plan', planText),
    h('button.btn.big.primary', { type: 'button', onClick: () => play(startToday(minutes)) }, doneMin >= minutes ? 'Noch eine Runde' : 'Los geht’s'),
  );

  // Lernkurve
  const values = curve(30);
  const curveCard = h(
    'section.card.curve',
    h(
      'div.curve-head',
      h('h2.card-title', 'Deine Lernkurve'),
      st ? h('span.streak', ico('flame'), ` ${st} ${st === 1 ? 'Tag' : 'Tage'} in Folge`) : null,
    ),
    sparkline(values, { labels: ['vor 30 Tagen', 'heute'] }),
    h('p.small', tot.seen ? `${fmt(tot.seen)} Einträge kennengelernt, davon ${fmt(tot.learned)} gefestigt.` : `${fmt(totals.items)} Wörter und Sätze warten auf dich.`),
  );

  // Weiter im Bereich
  const fa = focusArea();
  const cont = fa
    ? (() => {
        const s = areaStats(fa);
        return h(
          'button.card.area-cont',
          { type: 'button', onClick: () => nav.show((v) => renderArea(v, fa.id)) },
          h('span.area-emoji', fa.icon),
          h(
            'span.area-cont-main',
            h('span.small.muted', S().settings.focus === fa.id ? 'Dein Fokus-Bereich' : 'Als Nächstes im Lernpfad'),
            h('span.area-cont-title', fa.title),
            h('span.area-cont-sub', `${STAGES[s.stage]} – ${s.learned} von ${s.total} gefestigt`),
          ),
          ico('chevron', 'row-chev'),
        );
      })()
    : null;

  // Quiz-Teaser
  const qz = S().quiz;
  const quiz = h(
    'button.card.quiz-teaser',
    { type: 'button', onClick: () => play(startMilione()) },
    h('span.qt-title', 'Il Milione'),
    h('span.qt-sub', qz.games ? `Dein Bestwert: ${euro(qz.best)}` : '15 Fragen bis zur Million'),
    h('span.qt-cta', 'Spielen'),
  );

  // Wort des Tages
  const w = wordOfDay();
  const wotd = w
    ? h(
        'section.card.wotd',
        h('p.small.muted', 'Wort des Tages'),
        h('div.wotd-row', h('span.wotd-it', itText(w.it)), spk(w.alts.join(' / '))),
        h('p.wotd-de', w.de),
        w.ex ? h('p.small.it-soft', G(w.ex)) : null,
      )
    : null;

  view.append(awning, hello, todayCard, curveCard, cont, quiz, wotd);
  if (!storageWorks()) view.prepend(h('div.warn', 'Achtung: Dein Lernstand kann auf diesem Gerät nicht gespeichert werden (privater Modus?).'));
}

/* ================================================================ Bereiche */

export function renderAreas(view) {
  view.append(header('Lebensbereiche', { sub: 'Jede Situation hat Wörter, Sätze, „Gut zu wissen“ und ein Quiz – dazu meist einen Dialog und ein Rollenspiel.' }));
  const search = h('input.search', { type: 'search', placeholder: 'Wort suchen – deutsch oder italienisch', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' });
  const results = h('div.search-results');
  const groups = h('div.groups');
  search.addEventListener('input', () => {
    const q = norm(search.value);
    results.replaceChildren();
    groups.hidden = q.length >= 2;
    if (q.length < 2) return;
    const hits = items
      .filter((x) => norm(x.alts.join(' ')).includes(q) || norm(x.de).includes(q))
      .slice(0, 40);
    if (!hits.length) results.append(h('p.small.muted.pad', 'Nichts gefunden.'));
    for (const x of hits) results.append(itemRow(x, true));
  });
  view.append(h('div.search-wrap', search), results);
  for (const gr of GROUPS) {
    const list = areasOf(gr.id);
    if (!list.length) continue;
    groups.append(
      h('section.group', h('h2.group-title', gr.title), h('p.group-sub', gr.sub), h('div.area-grid', list.map(areaTile))),
    );
  }
  view.append(groups);
}

function areaTile(area) {
  const s = areaStats(area);
  return h(
    'button.area-tile' + (S().settings.focus === area.id ? '.focus' : ''),
    { type: 'button', onClick: () => nav.show((v) => renderArea(v, area.id)) },
    h('span.area-emoji', area.icon),
    h('span.area-name', area.title),
    h('span.area-meta', stageDots(s.stage), h('span.small.muted', `${s.learned}/${s.total}`)),
  );
}

/* ================================================================ Bereichsseite */

export function renderArea(view, areaId) {
  const area = areaById.get(areaId);
  if (!area) return nav.back();
  const s = areaStats(area);
  const due = dueCount(area.id);
  const fresh = newLeft(area.id);
  view.append(header(`${area.icon} ${area.title}`, { back: true }));

  // Lernkurve des Bereichs
  const path = h(
    'ol.stage-path',
    [1, 2, 3, 4].map((i) => h('li.lstep' + (i <= s.stage ? '.done' : '') + (i === s.stage + 1 ? '.next' : ''), h('span.lstep-dot'), h('span.lstep-name', STAGES[i]))),
  );
  const hints = nextStageHint(area, s);
  const curveBox = h(
    'section.card',
    h('h2.card-title', 'Lernkurve'),
    path,
    s.stage < 4 && hints.length ? h('div.next-stage', h('p.small.muted', `Für „${STAGES[s.stage + 1]}“:`), h('ul.hint-list', hints.map((x) => h('li', x)))) : h('p.small', 'Diesen Bereich beherrschst du. Complimenti!'),
    strengthBar(s.counts),
    h('p.small.muted', `${s.seen} von ${s.total} kennengelernt, ${s.learned} gefestigt, ${s.solid} sitzen.`),
  );

  // Hauptaktion
  const learnLabel = fresh ? 'Lernen' : due ? 'Wiederholen' : 'Alles gelernt';
  const learnSub = [fresh ? `${fresh} neu` : '', due ? `${due} fällig` : ''].filter(Boolean).join(', ');
  const main = h(
    'section.card.area-actions',
    h(
      'button.btn.big.primary',
      { type: 'button', disabled: !fresh && !due, onClick: () => play(fresh ? startAreaLearn(area) : startReview(area.id)) },
      learnLabel,
      learnSub ? h('span.btn-sub', learnSub) : null,
    ),
    fresh >= 8 && s.seen < s.total * 0.5
      ? h('button.btn.ghost', { type: 'button', onClick: () => play(startQuickCheck(area)) }, 'Schnell-Check: Was kenne ich schon?')
      : null,
    focusToggle(area),
  );

  // Aktivitäten
  const acts = h('section.acts');
  acts.append(
    h(
      'button.act',
      { type: 'button', onClick: () => nav.show((v) => renderItemList(v, area.id)) },
      h('span.act-ico', '📚'),
      h('span.act-title', 'Wörter & Sätze'),
      h('span.act-sub', `${area.items.filter((x) => x.kind === 'w').length} Wörter, ${area.items.filter((x) => x.kind === 'p').length} Sätze`),
    ),
  );
  for (const d of area.dialogs) {
    const dn = S().done.listen[d.id];
    acts.append(
      h(
        'button.act',
        { type: 'button', onClick: () => play(startDialog(d)) },
        h('span.act-ico', '🎧'),
        h('span.act-title', d.title),
        h('span.act-sub', dn ? `Gehört – ${dn.best} % richtig` : `${d.kind} zum Zuhören`),
      ),
    );
  }
  for (const r of area.roles) {
    const dn = S().done.role[r.id];
    acts.append(
      h(
        'button.act',
        { type: 'button', onClick: () => play(startRole(r)) },
        h('span.act-ico', '🎭'),
        h('span.act-title', r.title),
        h('span.act-sub', dn ? `Gespielt – ${dn.best} % erfüllt` : 'Rollenspiel zum Sprechen'),
      ),
    );
  }
  if (area.items.length >= 12) {
    const best = S().quiz.area[area.id];
    acts.append(
      h(
        'button.act.act-quiz',
        { type: 'button', onClick: () => play(startMilione(area.id)) },
        h('span.act-ico', '🏆'),
        h('span.act-title', 'Quiz: Il Milione'),
        h('span.act-sub', best != null ? `Bestwert ${euro(best)}` : '15 Fragen zu diesem Bereich'),
      ),
    );
  }

  // Gut zu wissen
  const notesBox = area.notes.length
    ? h(
        'section.notes',
        h('h2.section-title', 'Gut zu wissen'),
        area.notes.map((n) => {
          const d = h('details.note', h('summary', ico('bulb'), h('span', n.t)), h('p', rich(n.x)));
          d.addEventListener('toggle', () => {
            if (d.open) {
              S().done.notes[n.id] = S().done.notes[n.id] || Date.now();
              save();
            }
          });
          return d;
        }),
      )
    : null;

  view.append(main, curveBox, acts, notesBox);
}

function focusToggle(area) {
  const on = S().settings.focus === area.id;
  return h(
    'label.switch-row',
    h('span', h('b', 'Fokus für „Heute lernen“'), h('span.small.muted', 'Neue Wörter im Tagesprogramm kommen dann aus diesem Bereich.')),
    h('input.switch', {
      type: 'checkbox',
      checked: on,
      onChange: (e) => {
        S().settings.focus = e.target.checked ? area.id : null;
        save();
        toast(e.target.checked ? `Fokus: ${area.title}` : 'Fokus aufgehoben – der Lernpfad entscheidet.');
      },
    }),
  );
}

/* ================================================================ Wortliste */

function strengthMark(item) {
  const st = strength(card(item));
  return h('span.smark.s' + st, { title: STRENGTH[st] });
}

function itemRow(item, showArea = false) {
  const area = areaById.get(item.area);
  return h(
    'div.item-row',
    { onClick: () => itemSheet(item) },
    strengthMark(item),
    h('div.item-main', h('div.item-it', itText(item.it)), h('div.item-de', item.de, showArea && area ? h('span.item-area', ` – ${area.icon} ${area.title}`) : null)),
    spk(item.alts.join(' / ')),
  );
}

export function renderItemList(view, areaId) {
  const area = areaById.get(areaId);
  view.append(header(`${area.icon} Wörter & Sätze`, { back: true, sub: area.title }));
  const filters = [
    ['alle', 'Alle'],
    ['w', 'Wörter'],
    ['p', 'Sätze'],
    ['neu', 'Neu'],
    ['gelernt', 'Gelernt'],
  ];
  let f = 'alle';
  const list = h('div.item-list');
  const chips = h('div.chips.scroll');
  const paint = () => {
    chips.replaceChildren(...filters.map(([k, l]) => h('button.chip' + (k === f ? '.on' : ''), { type: 'button', onClick: () => { f = k; paint(); } }, l)));
    const shown = area.items.filter((x) => {
      const st = strength(card(x));
      if (f === 'w') return x.kind === 'w';
      if (f === 'p') return x.kind === 'p';
      if (f === 'neu') return st === 0;
      if (f === 'gelernt') return st >= 2;
      return true;
    });
    list.replaceChildren();
    let lvl = null;
    for (const x of shown) {
      if (x.lvl !== lvl) {
        lvl = x.lvl;
        list.append(h('h3.lvl-head', `${lvl} – ${LEVEL_NAMES[lvl]}`));
      }
      list.append(itemRow(x));
    }
    if (!shown.length) list.append(h('p.small.muted.pad', 'Hier ist gerade nichts.'));
  };
  paint();
  view.append(chips, list);
}

function nextDueText(c) {
  if (!c) return 'Noch nicht gelernt';
  if (c.learning) return 'Wird gerade gelernt';
  const days = Math.round((startOfDay(c.due) - startOfDay()) / DAY);
  if (days <= 0) return 'Heute fällig';
  if (days === 1) return 'Nächste Wiederholung morgen';
  return `Nächste Wiederholung in ${days} Tagen`;
}

export function itemSheet(item) {
  const c = card(item);
  const st = strength(c);
  const body = h(
    'div.item-sheet',
    h('div.head-it', h('div.' + (item.kind === 'p' ? 'phrase-it' : 'word-it'), itText(item.it)), h('div.tools', spk(item.alts.join(' / ')), spk(item.alts.join(' / '), { slow: true }))),
    h('p.word-de', item.de),
    exampleBlock(item),
    item.note ? h('div.why', h('div.why-head', ico('bulb'), item.kind === 'p' ? 'Warum so?' : 'Gut zu merken'), h('p', rich(item.note))) : null,
    h('div.item-status', h('span.smark.s' + st), h('span', `${STRENGTH[st]}. ${nextDueText(c)}.`), h('span.lvl-badge', item.lvl)),
  );
  const actions = [];
  if (!c) {
    actions.push({ label: 'Jetzt lernen', value: 'learn', primary: true });
    actions.push({ label: 'Kenne ich schon', value: 'known' });
  } else actions.push({ label: 'Von vorn lernen', value: 'reset' });
  actions.push({ label: 'Schließen', value: null });
  sheet({ body, actions }).then((v) => {
    if (v === 'learn') play(startItems([item]));
    else if (v === 'known') {
      markKnown(item);
      toast('Abgehakt – kommt in drei Wochen zur Kontrolle.');
      nav.refresh();
    } else if (v === 'reset') {
      resetItem(item);
      toast('Zurückgesetzt.');
      nav.refresh();
    }
  });
}

/* ================================================================ Quiz */

export function renderQuiz(view) {
  const qz = S().quiz;
  view.append(header('Quiz'));
  const hero = h(
    'section.card.stage-card',
    h('h2.mq-title', 'Il Milione'),
    h('p', '15 Fragen, jede ein bisschen schwerer: Vokabeln, Redewendungen, falsche Freunde, Grammatik und Land & Leute. Mit drei Jokern und zwei Sicherheitsstufen.'),
    h(
      'div.stage-stats',
      statBox(euro(qz.best), 'Bestwert'),
      statBox(fmt(qz.games), qz.games === 1 ? 'Spiel' : 'Spiele'),
      statBox(fmt(qz.millions), qz.millions === 1 ? 'Million' : 'Millionen'),
    ),
    h('button.btn.big.gold', { type: 'button', onClick: () => play(startMilione()) }, 'Spielen – alle Bereiche'),
    h('button.btn.stage-ghost', { type: 'button', onClick: () => chooseArea() }, 'Bereich auswählen'),
  );
  const blitz = h(
    'section.card.blitz-card',
    h('div.blitz-head', h('span.blitz-ico', '⚡'), h('div', h('h2.card-title', 'Blitzrunde'), h('p.small.muted', '60 Sekunden, so viele richtige Antworten wie möglich.'))),
    h('p.small', qz.blitzGames ? `Dein Rekord: ${qz.blitzBest} richtige` : 'Noch nicht gespielt.'),
    h('button.btn.primary', { type: 'button', onClick: () => play(startBlitz()) }, 'Blitzrunde starten'),
  );
  const bank = qz.games
    ? h('p.small.muted.center', `Kontostand aus allen Spielen: ${euro(qz.bank)}`)
    : h('p.small.muted.center', `${fmt(quizQs.length)} handverlesene Fragen und Tausende Vokabelfragen.`);
  view.append(hero, blitz, bank);
}

function statBox(v, l) {
  return h('div.sbox', h('div.sbox-v', v), h('div.sbox-l', l));
}

function chooseArea() {
  const body = h(
    'div.area-pick',
    GROUPS.map((gr) => {
      const list = areasOf(gr.id).filter((a) => a.items.length >= 12);
      if (!list.length) return null;
      return [
        h('h3.lvl-head', gr.title),
        list.map((a) =>
          h(
            'button.row.compact',
            {
              type: 'button',
              onClick: (e) => {
                e.currentTarget.closest('.sheet-wrap').closeSheet(null);
                play(startMilione(a.id));
              },
            },
            h('span.row-ico', a.icon),
            h('span.row-main', h('span.row-title', a.title), S().quiz.area[a.id] != null ? h('span.row-sub', `Bestwert ${euro(S().quiz.area[a.id])}`) : null),
          ),
        ),
      ];
    }),
  );
  sheet({ title: 'Welcher Bereich?', body, actions: [{ label: 'Abbrechen', value: null }] });
}

/* ================================================================ Üben */

export function renderPractice(view) {
  view.append(header('Üben', { sub: 'Hören, sprechen, Zahlen und Aussprache – quer durch alle Bereiche.' }));
  const due = dueCount();
  const list = h('div.rows');
  list.append(
    row('Wiederholen', due ? `${due} Einträge sind fällig` : 'Gerade ist nichts fällig', { icon: '🔁', onClick: () => (due ? play(startReview()) : toast('Gerade ist nichts fällig.')) }),
    row('Dialoge & Durchsagen', `${dialogs.length} Hörtexte mit Fragen`, { icon: '🎧', onClick: () => nav.show(renderDialogList) }),
    row('Rollenspiele', `${roles.length} Situationen zum Sprechen`, { icon: '🎭', onClick: () => nav.show(renderRoleList) }),
    row('Nachsprechen', 'Sätze anhören und laut nachsprechen', { icon: '🗣️', onClick: () => play(startShadowing()) }),
    row('Diktat', 'Hören und aufschreiben', { icon: '✍️', onClick: () => play(startDictation()) }),
    row('Zahlen, Preise & Uhrzeiten', 'Mit unbegrenzt neuen Aufgaben', { icon: '🔢', onClick: () => nav.show(renderDrillList) }),
    row('Aussprache', 'Wörter, die fast gleich klingen', { icon: '👂', onClick: () => nav.show(renderPronList) }),
    row('Einstufungstest', S().profile.level ? `Dein Niveau: ${S().profile.level}` : 'Finde dein Niveau heraus', { icon: '🎯', onClick: () => play(startPlacement()) }),
  );
  view.append(list);
}

function byArea(list, render) {
  const out = [];
  for (const gr of GROUPS) {
    const sub = list.filter((x) => (areaById.get(x.area) || {}).group === gr.id);
    if (!sub.length) continue;
    out.push(h('h3.lvl-head', gr.title));
    out.push(...sub.map(render));
  }
  return out;
}

export function renderDialogList(view) {
  view.append(header('Dialoge & Durchsagen', { back: true }));
  view.append(
    h(
      'div.rows',
      byArea(dialogs, (d) => {
        const dn = S().done.listen[d.id];
        const a = areaById.get(d.area);
        return row(d.title, `${a.icon} ${a.title} – ${d.lvl}${dn ? ` – ✓ ${dn.best} %` : ''}`, { onClick: () => play(startDialog(d)) });
      }),
    ),
  );
}

export function renderRoleList(view) {
  view.append(header('Rollenspiele', { back: true }));
  view.append(
    h(
      'div.rows',
      byArea(roles, (r) => {
        const dn = S().done.role[r.id];
        const a = areaById.get(r.area);
        return row(r.title, `${a.icon} ${a.title} – ${r.lvl}${dn ? ` – ✓ ${dn.best} %` : ''}`, { onClick: () => play(startRole(r)) });
      }),
    ),
  );
}

export function renderDrillList(view) {
  view.append(header('Zahlen, Preise & Uhrzeiten', { back: true, sub: 'Du hörst eine Zahl und schreibst sie auf. Bei manchen kannst du auch selbst sprechen.' }));
  view.append(
    h(
      'div.rows',
      DRILLS.map((d) =>
        h(
          'div.drill-row',
          h('span.row-ico', d.icon),
          h('span.row-main', h('span.row-title', d.title)),
          h('button.chip', { type: 'button', onClick: () => play(startDrill(d.id, 'listen')) }, 'Hören'),
          d.speakable ? h('button.chip', { type: 'button', onClick: () => play(startDrill(d.id, 'speak')) }, 'Sprechen') : null,
        ),
      ),
    ),
  );
}

export function renderPronList(view) {
  view.append(header('Aussprache', { back: true, sub: 'Du hörst ein Wort und entscheidest, welches es war.' }));
  view.append(h('div.rows', PRON_SETS.map((p) => row(p.title, `${p.pairs.length} Wortpaare`, { icon: p.icon || '👂', onClick: () => play(startPron(p.id)) }))));
}

/* ================================================================ Mehr */

export function renderMore(view) {
  view.append(header('Mehr'));
  view.append(
    h(
      'div.rows',
      row('Statistik', 'Lernkurve, Minuten, Quiz', { icon: '📈', onClick: () => nav.show(renderStats) }),
      row('Einstellungen', 'Stimme, Tempo, neue Wörter pro Tag', { icon: '⚙️', onClick: () => nav.show(renderSettings) }),
      row('Hilfe', 'Installieren, Ton, Mikrofon, Tastatur', { icon: '❓', onClick: () => nav.show(renderHelp) }),
      row('Sicherung', 'Lernstand sichern oder zurückholen', { icon: '💾', onClick: () => nav.show(renderData) }),
    ),
    h(
      'p.small.muted.center.about',
      `Parliamo – ${fmt(totals.words)} Wörter, ${fmt(totals.phrases)} Sätze, ${areas.length} Lebensbereiche, ${dialogs.length} Dialoge, ${roles.length} Rollenspiele, ${fmt(quizQs.length)} Quizfragen.`,
    ),
  );
}

export function renderStats(view) {
  view.append(header('Statistik', { back: true }));
  const tot = totalsNow();
  const series = minutesSeries(14);
  const maxMin = Math.max(5, ...series.map((x) => x.min));
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const qz = S().quiz;
  view.append(
    h(
      'section.card',
      h('h2.card-title', 'Lernkurve'),
      h('p.small.muted', 'Kennengelernte Wörter und Sätze, letzte 60 Tage'),
      sparkline(curve(60), { labels: ['vor 60 Tagen', 'heute'], height: 110 }),
    ),
    h(
      'section.card',
      h('h2.card-title', 'Minuten pro Tag'),
      h(
        'div.mbars',
        series.map((x) =>
          h('div.mbar', h('div.mbar-fill', { style: { height: `${(x.min / maxMin) * 100}%` } }), h('div.mbar-v', x.min ? String(x.min) : ''), h('div.mbar-l', WD[x.day])),
        ),
      ),
      h('p.small.muted', `${streak()} ${streak() === 1 ? 'Tag' : 'Tage'} in Folge`),
    ),
    h(
      'section.card',
      h('h2.card-title', 'Wie gut sitzt was?'),
      strengthBar(tot.counts),
      h(
        'ul.legend',
        [1, 2, 3, 4].map((i) => h('li', h('span.smark.s' + i), `${STRENGTH[i]}: ${fmt(tot.counts[i])}`)),
        h('li', h('span.smark.s0'), `Noch neu: ${fmt(tot.counts[0])}`),
      ),
    ),
    h(
      'section.card',
      h('h2.card-title', 'Quiz'),
      h('p.small', `Il Milione: ${fmt(qz.games)} Spiele, Bestwert ${euro(qz.best)}, ${fmt(qz.millions)}× die Million.`),
      h('p.small', `Blitzrunde: Rekord ${qz.blitzBest} richtige in ${fmt(qz.blitzGames)} Runden.`),
    ),
  );
}

function seg(options, value, onPick) {
  return h(
    'div.seg',
    options.map(([v, l]) => h('button.seg-btn' + (v === value ? '.on' : ''), { type: 'button', onClick: () => onPick(v) }, l)),
  );
}

export function renderSettings(view) {
  view.append(header('Einstellungen', { back: true }));
  const st = S().settings;
  const pr = S().profile;
  const set = (fn) => {
    fn();
    save();
    nav.refresh();
  };
  const voices = italianVoices();
  const voiceSel = (key) => {
    const sel = h(
      'select.select',
      { onChange: (e) => set(() => (st[key] = e.target.value || null)) },
      h('option', { value: '' }, 'Automatisch'),
      voices.map((v) => h('option', { value: v.voiceURI, selected: st[key] === v.voiceURI }, voiceLabel(v))),
    );
    return sel;
  };
  const test = (which) =>
    h('button.chip', { type: 'button', onClick: () => import('./ui.js').then((m) => m.say(which === 'A' ? 'Ciao! Come stai? Io sto benissimo.' : 'Buongiorno! Un caffè, per favore.', { voice: which })) }, 'Probehören');

  view.append(
    h(
      'section.card.settings',
      h('h2.card-title', 'Sprechtempo'),
      seg([['normal', 'Normal'], ['calm', 'Ruhig'], ['slow', 'Langsam']], st.tempo, (v) => set(() => (st.tempo = v))),
      h('h2.card-title', 'Stimmen'),
      voices.length
        ? [
            h('label.field', h('span', 'Stimme 1 (Erzähler, Gegenüber)'), h('div.field-row', voiceSel('voiceA'), test('A'))),
            h('label.field', h('span', 'Stimme 2 (zweite Person im Dialog)'), h('div.field-row', voiceSel('voiceB'), test('B'))),
            h('p.small.muted', 'Schönere Stimmen kannst du in den iPhone-Einstellungen laden – siehe Hilfe.'),
          ]
        : h('p.small', ttsAvailable ? 'Keine italienische Stimme gefunden. Es wird die Standardstimme verwendet – siehe Hilfe, wie du eine italienische Stimme lädst.' : 'Dieses Gerät kann nicht vorlesen.'),
      h('h2.card-title', 'Neue Einträge pro Tag'),
      seg([[5, '5'], [10, '10'], [15, '15'], [20, '20']], st.newPerDay, (v) => set(() => (st.newPerDay = v))),
      h('h2.card-title', 'Form in Mustersätzen'),
      h('p.small.muted', 'Zum Beispiel «Sono stanco» (männlich) oder «Sono stanca» (weiblich).'),
      seg([['m', 'stanco'], ['f', 'stanca']], pr.sex || 'm', (v) => set(() => (pr.sex = v))),
      h('h2.card-title', 'Sprechen'),
      seg([['auto', 'Mikrofon-Knopf'], ['keyboard', 'Tastatur-Diktat']], st.speechMode, (v) => set(() => (st.speechMode = v))),
      h(
        'p.small.muted',
        !sttAvailable
          ? 'Dieses Gerät bietet keine Spracherkennung im Browser an – gesprochen wird über die Mikrofon-Taste der Tastatur.'
          : pr.speechOk === false
            ? 'Die Spracherkennung hat hier nicht funktioniert. Du kannst sie erneut versuchen.'
            : 'Mit dem Mikrofon-Knopf prüft die App deine Aussprache direkt.',
      ),
      pr.speechOk === false ? h('button.chip', { type: 'button', onClick: () => set(() => (pr.speechOk = null)) }, 'Spracherkennung erneut versuchen') : null,
      h('h2.card-title', 'Töne'),
      seg([[true, 'An'], [false, 'Aus']], st.sfx !== false, (v) => set(() => (st.sfx = v))),
      h('h2.card-title', 'Dein Niveau'),
      seg(LEVELS.map((l) => [l, l]), userLevel(), (v) => set(() => (pr.level = v))),
      h('p.small.muted', LEVEL_NAMES[userLevel()]),
      h('button.chip', { type: 'button', onClick: () => play(startPlacement()) }, 'Einstufungstest machen'),
      h('h2.card-title', 'Dein Name'),
      (() => {
        const inp = h('input.text', { type: 'text', value: pr.name || '', placeholder: 'Vorname', autocomplete: 'given-name' });
        inp.addEventListener('change', () => {
          pr.name = inp.value.trim().slice(0, 30);
          save();
          toast('Gespeichert.');
        });
        return inp;
      })(),
    ),
  );
}

const HELP = [
  [
    'Die App auf den Home-Bildschirm legen',
    [
      'Öffne die Seite in Safari. Hast du den Link in WhatsApp angetippt, wähle zuerst „In Safari öffnen“ (über „⋯“ oder das Kompass-Symbol).',
      'Tippe auf das Teilen-Symbol – das Quadrat mit dem Pfeil nach oben. Bei neueren iPhones steckt es hinter den drei Punkten „⋯“ unten rechts.',
      'Wische in der Liste nach unten und tippe auf „Zum Home-Bildschirm“.',
      'Tippe oben rechts auf „Hinzufügen“. Ab jetzt startest du Parliamo über das Symbol auf dem Home-Bildschirm.',
    ],
  ],
  [
    'Ich höre nichts',
    [
      'Mach das iPhone lauter (Taste links am Gerät).',
      'Prüfe den Stummschalter bzw. die Aktionstaste – im Stumm-Modus bleiben manche Töne still.',
      'Ist ein Bluetooth-Kopfhörer verbunden, kommt der Ton vielleicht dort heraus.',
      'Tippe im Zweifel unter „Einstellungen“ auf „Probehören“.',
    ],
  ],
  [
    'Eine schönere italienische Stimme',
    [
      'Öffne die iPhone-Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen → Italienisch.',
      'Lade eine Stimme in verbesserter Qualität, zum Beispiel „Federica“ oder „Luca“.',
      'Wähle sie danach in Parliamo unter „Einstellungen“ → „Stimmen“ aus.',
    ],
  ],
  [
    'Das Mikrofon klappt nicht',
    [
      'Wenn das iPhone fragt, ob Parliamo das Mikrofon benutzen darf, tippe auf „Erlauben“.',
      'Hast du es einmal abgelehnt: iPhone-Einstellungen → Apps → Safari → Mikrofon → „Fragen“ (bei älteren iOS-Versionen direkt unter Einstellungen → Safari).',
      'Die Spracherkennung braucht „Siri“ bzw. die Diktierfunktion: Einstellungen → Allgemein → Tastatur → „Diktierfunktion aktivieren“.',
      'Klappt es trotzdem nicht, stell unter „Einstellungen“ → „Sprechen“ auf „Tastatur-Diktat“. Dann sprichst du über die Mikrofon-Taste der Tastatur.',
    ],
  ],
  [
    'Italienische Tastatur hinzufügen',
    [
      'Einstellungen → Allgemein → Tastatur → Tastaturen → „Tastatur hinzufügen …“ → Italienisch.',
      'Beim Schreiben wechselst du mit der Weltkugel unten links zwischen Deutsch und Italienisch.',
      'Mit der italienischen Tastatur versteht auch das Diktieren über die Tastatur Italienisch.',
      'Akzente wie à, è oder ù gibt es auch direkt über dem Eingabefeld zum Antippen.',
    ],
  ],
  [
    'Wie geht der Lernpfad?',
    [
      'Unter „Heute lernen“ kommen neue Wörter aus dem Lernpfad – Bereich für Bereich in einer sinnvollen Reihenfolge.',
      'In der ersten Runde lernst du in allen Bereichen die Wörter deines Niveaus und die leichteren. Danach geht es mit den schwereren Wörtern noch einmal durch alle Bereiche – erst Mittelstufe, dann Fortgeschritten.',
      'Willst du ein Thema vorziehen, öffne den Bereich und schalte „Fokus für Heute lernen“ ein. Dann kommen die neuen Wörter komplett aus diesem Bereich.',
      'Mit „Lernen“ in einem Bereich kannst du jederzeit zusätzlich Wörter aus genau diesem Bereich lernen.',
    ],
  ],
  [
    'Wo ist mein Lernstand gespeichert?',
    [
      'Nur auf diesem iPhone – es gibt kein Konto und nichts wird hochgeladen.',
      'Wenn du die App vom Home-Bildschirm löschst, ist auch der Lernstand weg. Unter „Sicherung“ kannst du ihn vorher als Datei speichern.',
    ],
  ],
];

export function renderHelp(view) {
  view.append(header('Hilfe', { back: true }));
  view.append(
    h(
      'section.notes',
      HELP.map(([t, steps]) => h('details.note', h('summary', h('span', t)), h('ol.help-steps', steps.map((s) => h('li', s))))),
    ),
  );
}

export function renderData(view) {
  view.append(header('Sicherung', { back: true, sub: 'Dein Lernstand liegt nur auf diesem iPhone. Speichere ihn ab und zu als Datei, z. B. in „Dateien“ oder iCloud Drive.' }));
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const text = await f.text();
    const ok = await confirmSheet('Sicherung laden?', 'Dein aktueller Lernstand wird dabei ersetzt.', 'Laden', { danger: true });
    if (!ok) return;
    try {
      importJSON(text);
      toast('Sicherung geladen.');
      nav.refresh();
    } catch (e) {
      toast(e.message || 'Die Datei konnte nicht gelesen werden.');
    }
  });
  view.append(
    h(
      'section.card',
      h('button.btn.primary', { type: 'button', onClick: exportBackup }, 'Sicherung speichern'),
      h('button.btn.ghost', { type: 'button', onClick: () => file.click() }, 'Sicherung laden'),
      file,
    ),
    h(
      'section.card',
      h('h2.card-title', 'Neu anfangen'),
      h('p.small.muted', 'Löscht den kompletten Lernstand auf diesem Gerät.'),
      h(
        'button.btn.danger',
        {
          type: 'button',
          onClick: async () => {
            const ok = await confirmSheet('Alles löschen?', 'Alle gelernten Wörter, Statistiken und Einstellungen gehen verloren.', 'Alles löschen', { danger: true });
            if (!ok) return;
            resetAll();
            location.reload();
          },
        },
        'Lernstand löschen',
      ),
    ),
  );
}

async function exportBackup() {
  const json = exportJSON();
  const name = `parliamo-sicherung-${dayKey()}.json`;
  try {
    const f = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      await navigator.share({ files: [f], title: 'Parliamo-Sicherung' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1500);
}
