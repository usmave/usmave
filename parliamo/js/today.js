/**
 * Das Tagesprogramm („Heute lernen“) und die Lerneinheiten eines Bereichs.
 */
import { S, save, today } from './store.js';
import { dueItems, newItems, focusArea, pathItems, userLevel, newLeft } from './session.js';
import { learnSteps, reviewStep, noteStep, summaryStep, quickCheckStep } from './ex/vocab.js';
import { dialogStep, dictationSteps } from './ex/listen.js';
import { roleStep, shadowSteps } from './ex/speak.js';
import { blitzStep } from './ex/quiz.js';
import { drillSteps, pronSteps, DRILLS, PRON_SETS } from './ex/drill.js';
import { runFlow, frame, next } from './flow.js';
import { h } from './ui.js';
import { areas, areaById, dialogs, roles, levelRank } from './content.js';
import { shuffle, pick } from './ui.js';

export const DURATIONS = [5, 15, 30];

function seenShare(area) {
  if (!area || !area.items.length) return 0;
  return area.items.filter((x) => S().cards[x.id]).length / area.items.length;
}

/** Wie viele neue Einträge heute noch sinnvoll sind. */
function newBudget(minutes) {
  const per = S().settings.newPerDay || 10;
  const left = Math.max(0, per - today().newW);
  if (minutes <= 5) return Math.min(4, left);
  if (minutes >= 30) return left + Math.round(per / 2);
  return left;
}

export function planToday(minutes = S().settings.minutes || 15) {
  const due = dueItems();
  const cap = minutes <= 5 ? 12 : minutes >= 30 ? 60 : 30;
  const area = focusArea();
  const fresh = area ? pathItems(newBudget(minutes)) : [];
  return {
    minutes,
    reviews: due.slice(0, cap),
    dueTotal: due.length,
    fresh,
    area,
    blocks: minutes <= 5 ? 0 : minutes >= 30 ? 2 : 1,
  };
}

const L = () => levelRank(userLevel());

function pickDialog(area) {
  const fits = (d) => levelRank(d.lvl) <= L() + 1;
  const undone = (d) => !S().done.listen[d.id];
  if (area) {
    const own = area.dialogs.filter((d) => undone(d) && fits(d));
    if (own.length) return own[0];
  }
  const started = dialogs.filter((d) => undone(d) && fits(d) && seenShare(areaById.get(d.area)) > 0);
  if (started.length) return pick(started);
  const any = dialogs.filter((d) => undone(d) && levelRank(d.lvl) <= L());
  if (any.length) return pick(any);
  const all = dialogs.filter(fits);
  return all.length ? pick(all) : null;
}

function pickRole(area) {
  const ready = (r) => seenShare(areaById.get(r.area)) >= 0.4 && levelRank(r.lvl) <= L() + 1;
  const undone = (r) => !S().done.role[r.id];
  if (area) {
    const own = area.roles.filter((r) => ready(r) && undone(r));
    if (own.length) return own[0];
  }
  const cands = roles.filter((r) => ready(r) && undone(r));
  if (cands.length) return pick(cands);
  const again = roles.filter(ready);
  return again.length ? pick(again) : null;
}

function pickNote(area) {
  const unread = (n) => !S().done.notes[n.id];
  if (area) {
    const own = area.notes.filter(unread);
    if (own.length && seenShare(area) > 0) return own[0];
  }
  const started = areas.filter((a) => seenShare(a) > 0).flatMap((a) => a.notes.filter(unread));
  return started.length ? started[0] : null;
}

const ROTATION = ['dialog', 'blitz', 'role', 'numbers', 'dictation', 'shadow', 'pron'];

function blockSteps(kind, area) {
  switch (kind) {
    case 'dialog': {
      const d = pickDialog(area);
      return d ? [dialogStep(d)] : null;
    }
    case 'role': {
      const r = pickRole(area);
      return r ? [roleStep(r)] : null;
    }
    case 'blitz':
      return Object.keys(S().cards).length >= 12 ? [blitzStep(false)] : null;
    case 'numbers':
      return drillSteps(pick(DRILLS).id, 5);
    case 'dictation':
      return Object.keys(S().cards).length >= 20 ? dictationSteps(3) : null;
    case 'shadow':
      return shadowSteps(3);
    case 'pron':
      return PRON_SETS.length ? pronSteps(pick(PRON_SETS).id, 5) : null;
    default:
      return null;
  }
}

/** Kleine Ansage, bevor ein neuer Baustein beginnt. */
function headerStep(title, text) {
  return async (flow) => {
    const { body, foot } = frame(flow, 'block-head');
    body.append(h('div.block-head', h('h2', title), h('p', text)));
    await next(foot, 'Los');
    return { header: true };
  };
}

const BLOCK_INTRO = {
  dialog: ['Hörverstehen', 'Jetzt ein kurzer Dialog zum Zuhören.'],
  role: ['Sprechen', 'Jetzt bist du dran: ein kleines Rollenspiel.'],
  blitz: ['Blitzrunde', '60 Sekunden – so viele richtige Antworten wie möglich.'],
  numbers: ['Zahlen & Co.', 'Ein paar Zahlen, Preise oder Uhrzeiten zum Mithören.'],
  dictation: ['Diktat', 'Hör dir drei Sätze an und schreib sie auf.'],
  shadow: ['Nachsprechen', 'Drei Sätze anhören und laut nachsprechen.'],
  pron: ['Aussprache', 'Fünf Wortpaare, die fast gleich klingen.'],
};

export function buildSession(minutes) {
  const p = planToday(minutes);
  const steps = [];
  for (const it of p.reviews) steps.push(reviewStep(it));
  const note = pickNote(p.area);
  if (note) steps.splice(Math.min(steps.length, 6), 0, noteStep(note));
  if (p.fresh.length) steps.push(...learnSteps(p.fresh));
  let k = S().hints.block || 0;
  let added = 0;
  for (let guard = 0; added < p.blocks && guard < ROTATION.length; guard++) {
    const kind = ROTATION[k % ROTATION.length];
    k++;
    const b = blockSteps(kind, p.area);
    if (b && b.length) {
      steps.push(headerStep(...BLOCK_INTRO[kind]), ...b);
      added++;
    }
  }
  S().hints.block = k;
  save();
  if (!steps.length) {
    const b = blockSteps('blitz') || blockSteps('numbers');
    steps.push(...b);
  }
  steps.push(summaryStep());
  return steps;
}

export function startToday(minutes) {
  S().settings.minutes = minutes;
  save();
  return runFlow({ steps: buildSession(minutes) });
}

/* ---------------- Lernen in einem Bereich ---------------- */

export function startAreaLearn(area, n = 8) {
  const due = dueItems(Date.now(), area.id).slice(0, 25);
  const fresh = newItems(area.id, n);
  const steps = [...due.map(reviewStep)];
  const unread = area.notes.find((x) => !S().done.notes[x.id]);
  if (unread && (fresh.length || due.length)) steps.push(noteStep(unread));
  steps.push(...learnSteps(fresh));
  if (!steps.length) return null;
  steps.push(summaryStep());
  return runFlow({ steps });
}

/** Nur fällige Wiederholungen eines Bereichs (oder alle). */
export function startReview(areaId = null) {
  const due = dueItems(Date.now(), areaId).slice(0, 40);
  if (!due.length) return null;
  return runFlow({ steps: [...due.map(reviewStep), summaryStep({ title: 'Wiederholt!' })] });
}

/** Ausgewählte Einträge lernen (z. B. aus der Wortliste). */
export function startItems(list) {
  if (!list.length) return null;
  return runFlow({ steps: [...learnSteps(list), summaryStep()] });
}

/** Schnell-Check: unbekannte Einträge eines Bereichs durchsehen. */
export function startQuickCheck(area) {
  const fresh = area.items.filter((x) => !S().cards[x.id]).slice(0, 30);
  if (!fresh.length) return null;
  const end = async (flow) => {
    const knew = flow.results.filter((r) => r && r.knew).length;
    const { body, foot } = frame(flow, 'summary');
    body.append(
      h(
        'div.summary',
        h('div.summary-badge', '⚡'),
        h('h2.summary-title', 'Schnell-Check fertig'),
        h('p', `${knew} von ${fresh.length} kanntest du schon – die kommen erst in ein paar Wochen zur Kontrolle wieder.`),
        h('p.small.muted', 'Die anderen lernst du ganz normal über „Lernen“.'),
      ),
    );
    await next(foot, 'Fertig');
    return { summary: true };
  };
  return runFlow({ steps: [...fresh.map(quickCheckStep), end] });
}

export { newLeft };
