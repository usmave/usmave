import * as S from './store.js';
import { esc, html, toast, sheet, confirmSheet, promptSheet, pickerSheet, actionSheet } from './ui.js';

let viewEl = document.getElementById('view');
const topbarEl = document.getElementById('topbar');
const tabbarEl = document.getElementById('tabbar');

/** Aktuelle Ansicht. `sub` ist eine Detailseite innerhalb eines Tabs. */
let route = { tab: 'training', sub: null, id: null };

/* ------------------------------------------------------------------- Helfer */

const num = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const fmtW = (w) => (w == null ? '–' : String(w).replace('.', ','));

/** "40 kg × 12" bzw. "40 kg × 12/11" bei einarmigen Übungen */
function setLabel(set, unilateral) {
  const w = set.weight != null ? `${fmtW(set.weight)} kg` : '– kg';
  const reps = unilateral ? `${set.repsL ?? '–'}/${set.repsR ?? '–'}` : `${set.reps ?? '–'}`;
  return `${w} <span class="u">×</span> ${reps}`;
}

const fmtInt = (n) => Math.round(n).toLocaleString('de-DE');

function setsSummary(sets, unilateral, best = null) {
  return sets
    .map((s) => `<span class="chip${best && s.id === best.id ? ' best' : ''}">${setLabel(s, unilateral)}</span>`)
    .join('');
}

function go(tab, sub = null, id = null) {
  route = { tab, sub, id };
  render();
  viewEl.scrollTop = 0;
}

function back() {
  go(route.tab);
}

/* ------------------------------------------------------------------ Rendern */

function render() {
  // Frischer Container pro Ansicht: so verschwinden die Listener der alten Ansicht
  // mit ihr, statt sich bei jedem Render zu stapeln.
  const fresh = viewEl.cloneNode(false);
  viewEl.replaceWith(fresh);
  viewEl = fresh;

  for (const btn of tabbarEl.querySelectorAll('.tab')) {
    btn.classList.toggle('active', btn.dataset.tab === route.tab);
  }
  const views = {
    training: viewTraining,
    plan: viewPlan,
    verlauf: viewVerlauf,
    mehr: viewMehr,
  };
  const subs = {
    day: viewDay,
    exercise: viewExerciseHistory,
    session: viewSessionDetail,
    exercises: viewExerciseList,
  };
  const fn = route.sub ? subs[route.sub] : views[route.tab];
  fn();
}

function setTop({ title, sub, left, right }) {
  topbarEl.innerHTML = html`
    ${left ? `<button class="topbar-btn ${left.kind || 'ghost'}" data-top="left" type="button">${esc(left.label)}</button>` : ''}
    <h1>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</h1>
    ${right ? `<button class="topbar-btn ${right.kind || ''}" data-top="right" type="button">${esc(right.label)}</button>` : ''}
  `;
  topbarEl.querySelector('[data-top="left"]')?.addEventListener('click', left.run);
  topbarEl.querySelector('[data-top="right"]')?.addEventListener('click', right.run);
}

/* =================================================================== TRAINING */

function viewTraining() {
  const session = S.activeSession();
  if (session) return viewSession(session);

  setTop({ title: 'Training' });

  if (!S.db.days.length) {
    viewEl.innerHTML = html`
      <div class="empty">
        <span class="big">🏋️</span>
        <p>Noch kein Trainingsplan angelegt.<br>Tag A und Tag B stehen bereit — ein Tipp genügt.</p>
      </div>
      <button class="btn primary" data-seed type="button">Meinen Plan anlegen</button>
      <button class="btn quiet" data-new-day type="button">Lieber selbst anlegen</button>
    `;
    viewEl.querySelector('[data-new-day]').addEventListener('click', () => newDay());
    viewEl.querySelector('[data-seed]').addEventListener('click', () => {
      S.seedMyPlan();
      toast('Tag A und Tag B angelegt');
      go('plan');
    });
    return;
  }

  const done = S.finishedSessions();
  const next = S.suggestNextDay();
  const last = done[0] || null;
  const others = S.db.days.filter((d) => d.id !== (next && next.id));

  viewEl.innerHTML = html`
    ${
      next
        ? html`
            <section class="next-card">
              <div class="next-k">Dran ist</div>
              <h2 class="next-name">${esc(next.name)}</h2>
              <div class="next-ex">
                ${next.slots.length ? esc(next.slots.map((s) => S.exerciseName(s.exerciseId)).join(' · ')) : 'Noch keine Übungen in diesem Tag'}
              </div>
              <button class="btn primary" data-start="${next.id}" type="button">Training starten</button>
              <div class="next-hint">
                ${
                  last
                    ? `Zuletzt: ${esc(last.dayName)} · ${esc(S.relativeDate(last.date))}`
                    : 'Noch kein Training protokolliert'
                }
              </div>
            </section>
          `
        : ''
    }
    ${
      others.length
        ? html`
            <div class="section-title">Doch ein anderer Tag</div>
            <div class="list">
              ${others
                .map((day) => {
                  const l = S.lastSessionForDay(day.id);
                  return html`
                    <button class="row" data-start="${day.id}" type="button">
                      <div class="row-main">
                        <div class="row-title">${esc(day.name)}</div>
                        <div class="row-sub">${l ? `Zuletzt ${esc(S.relativeDate(l.date))}` : 'Noch nie trainiert'}</div>
                      </div>
                      <span class="row-chev">›</span>
                    </button>
                  `;
                })
                .join('')}
            </div>
          `
        : ''
    }
    ${done.length ? `<div class="section-title">Letzte Trainings</div><div class="list">${recentRows(done.slice(0, 5))}</div>` : ''}
  `;

  viewEl.addEventListener('click', (e) => {
    const start = e.target.closest('[data-start]');
    if (start) {
      const day = S.dayById(start.dataset.start);
      if (!day.slots.length) {
        toast('Dieser Tag hat noch keine Übungen');
        return go('plan', 'day', day.id);
      }
      S.startSession(day.id);
      return render();
    }
    const open = e.target.closest('[data-session]');
    if (open) go('training', 'session', open.dataset.session);
  });
}

function recentRows(sessions) {
  return sessions
    .map((s) => {
      const sets = s.entries.reduce((n, e) => n + e.sets.length, 0);
      const min = S.sessionDuration(s);
      const vol = Math.round(S.sessionVolume(s));
      return html`
        <button class="row" data-session="${s.id}" type="button">
          <div class="row-main">
            <div class="row-title">${esc(s.dayName)}</div>
            <div class="row-sub">${esc(S.formatDate(s.date))} · ${esc(S.relativeDate(s.date))}</div>
            <div class="row-sub">${s.entries.length} Übungen · ${sets} Sätze · ${vol} kg${min ? ` · ${min} Min` : ''}</div>
          </div>
          <span class="row-chev">›</span>
        </button>
      `;
    })
    .join('');
}

/* ------------------------------------------------------- Laufendes Training */

function viewSession(session) {
  setTop({
    title: session.dayName,
    sub: `${S.formatDate(session.date)} · ${S.countDoneSets(session)} Sätze erledigt`,
    left: { label: '⋯', kind: 'round', run: () => sessionMenu(session) },
    right: { label: 'Beenden', kind: 'primary', run: () => finishFlow(session) },
  });

  viewEl.innerHTML =
    session.entries.map((entry) => entryCard(session, entry)).join('') +
    html`
      <button class="btn quiet" data-add-exercise type="button">＋ Übung zu diesem Training hinzufügen</button>
      <div class="fab-space"></div>
      <button class="btn good" data-finish type="button">Training beenden</button>
    `;

  bindSessionEvents(session);
}

/**
 * Eine Übung im laufenden Training. Bewusst reduziert: Name, Ziel, Sätze.
 * Die Werte vom letzten Mal stehen blass als Vorschlag in den Feldern und
 * werden beim Abhaken übernommen — kein zusätzlicher Textblock nötig.
 */
function entryCard(session, entry) {
  const ex = S.exerciseById(entry.exerciseId);
  const uni = !!entry.unilateral;
  const substituted = entry.plannedExerciseId && entry.plannedExerciseId !== entry.exerciseId;
  const target = entry.targetReps ? `${entry.targetSets}×${entry.targetReps}` : `${entry.targetSets} Sätze`;
  const complete = entry.sets.length > 0 && entry.sets.every((s) => s.done);

  return html`
    <section class="card ex-card ${complete ? 'complete' : ''}" data-entry-card="${entry.id}">
      <div class="card-head">
        <div class="card-title">${esc(ex ? ex.name : '?')}</div>
        ${target ? `<span class="target">${esc(target)}</span>` : ''}
        <button class="icon-btn" data-entry-menu="${entry.id}" type="button" aria-label="Optionen">⋯</button>
      </div>
      ${substituted ? `<div class="sub-note">Ersatz für ${esc(S.exerciseName(entry.plannedExerciseId))}</div>` : ''}
      <div class="card-body">
        <div class="sets">
          ${uni ? '<div class="set-head uni"><span></span><span>Gewicht</span><span>Wdh L</span><span>Wdh R</span><span></span></div>' : ''}
          ${entry.sets.map((set, i) => setRow(entry, set, i, uni)).join('')}
        </div>
        <button class="add-set" data-add-set="${entry.id}" type="button">＋ Satz</button>
      </div>
    </section>
  `;
}

function setRow(entry, set, i, uni) {
  const sug = set.suggest || {};
  const inp = (field, value, fallback) => {
    const hint = sug[field] != null ? fmtW(sug[field]) : fallback;
    return html`
      <input type="text" inputmode="${field === 'weight' ? 'decimal' : 'numeric'}"
             data-set-field="${field}" data-entry="${entry.id}" data-set="${set.id}"
             value="${value == null ? '' : esc(fmtW(value))}" placeholder="${esc(hint)}"
             autocomplete="off" enterkeyhint="next" aria-label="${field === 'weight' ? 'Gewicht' : 'Wiederholungen'}">
    `;
  };
  return html`
    <div class="set-row ${uni ? 'uni' : ''} ${set.done ? 'done' : ''}" data-set-row="${set.id}">
      <div class="set-no">${i + 1}</div>
      ${inp('weight', set.weight, 'kg')}
      ${uni ? inp('repsL', set.repsL, 'L') + inp('repsR', set.repsR, 'R') : inp('reps', set.reps, 'Wdh')}
      <button class="set-check" data-toggle="${set.id}" data-entry="${entry.id}" type="button"
              aria-label="Satz abhaken">✓</button>
    </div>
  `;
}

function bindSessionEvents(session) {
  // Eingaben nur ins Modell schreiben — kein Re-Render, sonst springt die Tastatur zu.
  viewEl.addEventListener('input', (e) => {
    const input = e.target.closest('[data-set-field]');
    if (!input) return;
    S.updateSet(session, input.dataset.entry, input.dataset.set, {
      [input.dataset.setField]: num(input.value),
    });
  });

  viewEl.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const entry = S.entryById(session, toggle.dataset.entry);
      const set = entry.sets.find((s) => s.id === toggle.dataset.toggle);
      if (!set.done && !S.setHasValue(set, entry.unilateral)) {
        return toast('Erst Gewicht/Wiederholungen eintragen');
      }
      S.setDone(session, entry.id, set.id, !set.done);
      // Beim Abhaken können Vorschläge in die Felder gewandert sein -> Zeile neu.
      const row = toggle.closest('.set-row');
      const index = entry.sets.findIndex((s) => s.id === set.id);
      row.outerHTML = setRow(entry, set, index, entry.unilateral);
      const card = viewEl.querySelector(`[data-entry-card="${entry.id}"]`);
      if (card) card.classList.toggle('complete', entry.sets.every((s) => s.done));
      updateSessionSubtitle(session);
      return;
    }

    const addSet = e.target.closest('[data-add-set]');
    if (addSet) {
      S.addSet(session, addSet.dataset.addSet);
      return refreshEntry(session, addSet.dataset.addSet);
    }

    const menu = e.target.closest('[data-entry-menu]');
    if (menu) return entryMenu(session, menu.dataset.entryMenu);

    if (e.target.closest('[data-add-exercise]')) return addExerciseToSession(session);
    if (e.target.closest('[data-finish]')) return finishFlow(session);
  });
}

function refreshEntry(session, entryId) {
  const entry = S.entryById(session, entryId);
  const el = viewEl.querySelector(`[data-entry-card="${entryId}"]`);
  if (!entry || !el) return render();
  el.outerHTML = entryCard(session, entry);
}

function updateSessionSubtitle(session) {
  const sub = topbarEl.querySelector('.sub');
  if (sub) sub.textContent = `${S.formatDate(session.date)} · ${S.countDoneSets(session)} Sätze erledigt`;
}

/** Die beiden Eigenschaften einer Übung, als Menüeinträge. */
function flagActions(exerciseId, after) {
  const ex = S.exerciseById(exerciseId);
  return [
    {
      label: ex && ex.unilateral ? 'Einarmig (L/R) ausschalten' : 'Als einarmig markieren (L/R)',
      sub: 'Wiederholungen getrennt für links und rechts.',
      run: () => {
        S.updateExercise(exerciseId, { unilateral: !(ex && ex.unilateral) });
        after();
      },
    },
    {
      label: ex && ex.assisted ? 'Unterstützungsgewicht aus' : 'Als Unterstützungsgewicht markieren',
      sub: 'Mehr Gewicht = mehr Hilfe (Klimmzugmaschine). Dreht Bestwert und Fortschritt um.',
      run: () => {
        S.updateExercise(exerciseId, { assisted: !(ex && ex.assisted) });
        after();
      },
    },
  ];
}

function entryMenu(session, entryId) {
  const entry = S.entryById(session, entryId);
  const ex = S.exerciseById(entry.exerciseId);
  const substituted = entry.plannedExerciseId && entry.plannedExerciseId !== entry.exerciseId;

  const actions = [
    {
      label: 'Andere Übung — nur heute',
      sub: 'Gerät besetzt? Ersatz wählen. Der Plan bleibt unverändert.',
      run: () => pickSubstitute(session, entry),
    },
  ];

  if (substituted) {
    actions.push({
      label: `Zurück zu „${S.exerciseName(entry.plannedExerciseId)}“`,
      run: () => {
        S.substituteEntry(session, entry.id, entry.plannedExerciseId);
        render();
      },
    });
  }

  if (entry.sets.length > 1) {
    actions.push({
      label: 'Letzten Satz entfernen',
      run: () => {
        const last = entry.sets[entry.sets.length - 1];
        S.removeSet(session, entry.id, last.id);
        refreshEntry(session, entry.id);
        updateSessionSubtitle(session);
      },
    });
  }

  actions.push(
    ...flagActions(entry.exerciseId, () => {
      const updated = S.exerciseById(entry.exerciseId);
      entry.unilateral = !!(updated && updated.unilateral);
      S.save();
      render();
    }),
    { label: 'Verlauf dieser Übung', run: () => go('verlauf', 'exercise', entry.exerciseId) },
    {
      label: 'Übung aus diesem Training entfernen',
      danger: true,
      run: () =>
        confirmSheet({
          title: 'Entfernen?',
          text: 'Die Übung wird nur aus dem heutigen Training entfernt, nicht aus dem Plan.',
          confirmLabel: 'Entfernen',
          danger: true,
          onConfirm: () => {
            S.removeEntry(session, entry.id);
            render();
          },
        }),
    }
  );

  actionSheet({ title: ex ? ex.name : 'Übung', actions });
}

function pickSubstitute(session, entry) {
  const used = new Set(session.entries.map((e) => e.exerciseId));
  const items = S.activeExercises()
    .filter((e) => e.id !== entry.exerciseId)
    .map((e) => ({
      id: e.id,
      label: e.name,
      sub: lastHint(e.id),
      badge: used.has(e.id) ? 'heute dabei' : '',
    }));

  pickerSheet({
    title: 'Ersatzübung für heute',
    items,
    emptyText: 'Keine weiteren Übungen angelegt.',
    createLabel: 'Neue Übung anlegen',
    onPick: (id) => {
      const result = S.substituteEntry(session, entry.id, id);
      render();
      toast(
        result && result.id !== entry.id
          ? 'Ergänzt — die abgehakten Sätze bleiben bei der alten Übung'
          : 'Nur für heute getauscht'
      );
    },
    onCreate: (name) =>
      newExerciseSheet(name, (ex) => {
        S.substituteEntry(session, entry.id, ex.id);
        render();
        toast('Nur für heute getauscht');
      }),
  });
}

function lastHint(exerciseId) {
  const last = S.lastPerformance(exerciseId);
  if (!last) return 'Noch kein Verlauf';
  const best = S.bestSet(last.sets, last.unilateral, S.isAssisted(exerciseId));
  return `Zuletzt ${S.relativeDate(last.date)} · ${best ? stripTags(setLabel(best, last.unilateral)) : ''}`;
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, '');
}

function addExerciseToSession(session) {
  pickerSheet({
    title: 'Übung hinzufügen',
    items: S.activeExercises().map((e) => ({ id: e.id, label: e.name, sub: lastHint(e.id) })),
    emptyText: 'Noch keine Übungen angelegt.',
    createLabel: 'Neue Übung anlegen',
    onPick: (id) => {
      S.addEntry(session, id);
      render();
    },
    onCreate: (name) =>
      newExerciseSheet(name, (ex) => {
        S.addEntry(session, ex.id);
        render();
      }),
  });
}

function sessionMenu(session) {
  actionSheet({
    title: 'Training',
    actions: [
      { label: 'Datum ändern', sub: S.formatDate(session.date), run: () => changeDate(session) },
      { label: 'Übung hinzufügen', run: () => addExerciseToSession(session) },
      {
        label: 'Training verwerfen',
        danger: true,
        run: () =>
          confirmSheet({
            title: 'Training verwerfen?',
            text: 'Alle heute eingetragenen Sätze gehen verloren.',
            confirmLabel: 'Verwerfen',
            danger: true,
            onConfirm: () => {
              S.discardSession(session.id);
              go('training');
            },
          }),
      },
    ],
  });
}

function changeDate(session) {
  sheet({
    title: 'Datum ändern',
    body: html`
      <div class="field">
        <label for="d">Trainingsdatum</label>
        <input id="d" type="date" value="${esc(session.date)}">
      </div>
      <button class="btn primary" data-ok type="button">Übernehmen</button>
    `,
    onMount(root, close) {
      root.querySelector('[data-ok]').addEventListener('click', () => {
        const v = root.querySelector('#d').value;
        if (v) {
          session.date = v;
          S.writeNow();
        }
        close();
        render();
      });
    },
  });
}

function finishFlow(session) {
  const done = S.countDoneSets(session);
  const open = session.entries.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
  if (!done) {
    return confirmSheet({
      title: 'Nichts abgehakt',
      text: 'Es ist kein einziger Satz abgehakt. Training verwerfen?',
      confirmLabel: 'Verwerfen',
      danger: true,
      onConfirm: () => {
        S.discardSession(session.id);
        go('training');
      },
    });
  }
  confirmSheet({
    title: 'Training beenden?',
    text: `${done} Sätze werden gespeichert.${open ? ` ${open} nicht abgehakte Sätze werden verworfen.` : ''}`,
    confirmLabel: 'Beenden & speichern',
    onConfirm: () => {
      S.finishSession(session);
      toast('Training gespeichert 💪');
      go('training');
    },
  });
}

/* ======================================================================= PLAN */

function viewPlan() {
  setTop({
    title: 'Plan',
    right: { label: '＋ Tag', run: () => newDay() },
  });

  if (!S.db.days.length) {
    viewEl.innerHTML = html`
      <div class="empty">
        <span class="big">📋</span>
        <p>Ein Trainingsplan besteht aus Trainingstagen,<br>die jeweils mehrere Übungen enthalten.</p>
      </div>
      <button class="btn primary" data-seed type="button">Meinen Plan anlegen</button>
      <button class="btn quiet" data-new-day type="button">Lieber selbst anlegen</button>
    `;
    viewEl.querySelector('[data-new-day]').addEventListener('click', () => newDay());
    viewEl.querySelector('[data-seed]').addEventListener('click', () => {
      S.seedMyPlan();
      toast('Tag A und Tag B angelegt');
      render();
    });
    return;
  }

  viewEl.innerHTML = html`
    <div class="list">
      ${S.db.days
        .map(
          (day) => html`
            <button class="row" data-day="${day.id}" type="button">
              <div class="row-main">
                <div class="row-title">${esc(day.name)}</div>
                <div class="row-sub">${day.slots.length} Übungen${day.slots.length ? ' · ' + esc(day.slots.map((s) => S.exerciseName(s.exerciseId)).join(' · ')) : ''}</div>
              </div>
              <span class="row-chev">›</span>
            </button>
          `
        )
        .join('')}
    </div>
    <button class="btn quiet" data-new-day type="button">＋ Trainingstag</button>
    <div class="section-title">Übungen</div>
    <div class="list">
      <button class="row" data-exercises type="button">
        <div class="row-main">
          <div class="row-title">Alle Übungen verwalten</div>
          <div class="row-sub">${S.activeExercises().length} aktiv · ${S.db.exercises.filter((e) => e.archived).length} archiviert</div>
        </div>
        <span class="row-chev">›</span>
      </button>
    </div>
  `;

  viewEl.addEventListener('click', (e) => {
    const day = e.target.closest('[data-day]');
    if (day) return go('plan', 'day', day.dataset.day);
    if (e.target.closest('[data-new-day]')) return newDay();
    if (e.target.closest('[data-exercises]')) return go('plan', 'exercises');
  });
}

function newDay() {
  promptSheet({
    title: 'Neuer Trainingstag',
    label: 'Name',
    placeholder: 'z. B. Tag A — Oberkörper',
    confirmLabel: 'Anlegen',
    onSubmit: (name) => {
      const day = S.addDay(name);
      go('plan', 'day', day.id);
    },
  });
}

function viewDay() {
  const day = S.dayById(route.id);
  if (!day) return go('plan');

  setTop({
    title: day.name,
    sub: `${day.slots.length} Übungen`,
    left: { label: '‹ Plan', run: back },
    right: { label: '⋯', run: () => dayMenu(day) },
  });

  viewEl.innerHTML = html`
    ${
      day.slots.length
        ? `<div class="list">${day.slots
            .map(
              (slot, i) => html`
                <button class="row" data-slot="${slot.id}" type="button">
                  <div class="set-no">${i + 1}</div>
                  <div class="row-main">
                    <div class="row-title">${esc(S.exerciseName(slot.exerciseId))}</div>
                    <div class="row-sub">
                      ${slot.targetReps ? `Ziel ${slot.targetSets}×${esc(slot.targetReps)}` : `${slot.targetSets} Sätze`}${S.exerciseById(slot.exerciseId)?.unilateral ? ' · einarmig' : ''} · ${esc(lastHint(slot.exerciseId))}
                    </div>
                  </div>
                  <span class="row-chev">⋯</span>
                </button>
              `
            )
            .join('')}</div>`
        : `<div class="empty"><p>Noch keine Übungen in diesem Tag.</p></div>`
    }
    <button class="btn primary" data-add-slot type="button">＋ Übung hinzufügen</button>
    ${day.slots.length ? '<button class="btn" data-start-day type="button">Training mit diesem Tag starten</button>' : ''}
  `;

  viewEl.addEventListener('click', (e) => {
    const slot = e.target.closest('[data-slot]');
    if (slot) return slotMenu(day, slot.dataset.slot);
    if (e.target.closest('[data-add-slot]')) return addSlotFlow(day);
    if (e.target.closest('[data-start-day]')) {
      const active = S.activeSession();
      if (active) {
        toast('Es läuft schon ein Training');
        return go('training');
      }
      S.startSession(day.id);
      return go('training');
    }
  });
}

function dayMenu(day) {
  actionSheet({
    title: day.name,
    actions: [
      {
        label: 'Tag umbenennen',
        run: () =>
          promptSheet({
            title: 'Tag umbenennen',
            label: 'Name',
            value: day.name,
            onSubmit: (name) => {
              S.updateDay(day.id, { name });
              render();
            },
          }),
      },
      { label: 'Nach oben schieben', run: () => { S.moveDay(day.id, -1); render(); } },
      { label: 'Nach unten schieben', run: () => { S.moveDay(day.id, 1); render(); } },
      {
        label: 'Tag löschen',
        danger: true,
        sub: 'Trainings-Verlauf bleibt erhalten.',
        run: () =>
          confirmSheet({
            title: 'Tag löschen?',
            text: 'Der Trainingstag wird aus dem Plan entfernt. Bereits protokollierte Trainings bleiben im Verlauf erhalten.',
            confirmLabel: 'Löschen',
            danger: true,
            onConfirm: () => {
              S.deleteDay(day.id);
              go('plan');
            },
          }),
      },
    ],
  });
}

function addSlotFlow(day) {
  pickerSheet({
    title: 'Übung hinzufügen',
    items: S.allExercises().map((e) => ({
      id: e.id,
      label: e.name,
      sub: lastHint(e.id),
      badge: e.archived ? 'archiviert' : '',
    })),
    emptyText: 'Noch keine Übungen angelegt.',
    createLabel: 'Neue Übung anlegen',
    onPick: (id) => {
      S.updateExercise(id, { archived: false });
      S.addSlot(day.id, { exerciseId: id });
      render();
    },
    onCreate: (name) =>
      newExerciseSheet(name, (ex) => {
        S.addSlot(day.id, { exerciseId: ex.id });
        render();
      }),
  });
}

function slotMenu(day, slotId) {
  const slot = day.slots.find((s) => s.id === slotId);
  const ex = S.exerciseById(slot.exerciseId);

  actionSheet({
    title: ex ? ex.name : 'Übung',
    actions: [
      {
        label: 'Umbenennen',
        sub: 'Gleiche Übung, Verlauf läuft weiter. Für neue Gerätenamen o. Ä.',
        run: () =>
          promptSheet({
            title: 'Übung umbenennen',
            label: 'Name',
            value: ex ? ex.name : '',
            hint: 'Der komplette bisherige Verlauf bleibt an dieser Übung hängen.',
            onSubmit: (name) => {
              S.updateExercise(slot.exerciseId, { name });
              render();
            },
          }),
      },
      {
        label: 'Durch andere Übung ersetzen',
        sub: 'Neue Übung startet mit eigenem Verlauf, alter bleibt archiviert erhalten.',
        run: () => replaceSlotFlow(day, slot),
      },
      {
      label: 'Sätze / Wiederholungen ändern',
      sub: slot.targetReps ? `${slot.targetSets}×${slot.targetReps}` : `${slot.targetSets} Sätze, kein Wdh-Ziel`,
      run: () => editTarget(day, slot),
    },
      ...flagActions(slot.exerciseId, render),
      { label: 'Verlauf ansehen', run: () => go('verlauf', 'exercise', slot.exerciseId) },
      { label: 'Nach oben schieben', run: () => { S.moveSlot(day.id, slot.id, -1); render(); } },
      { label: 'Nach unten schieben', run: () => { S.moveSlot(day.id, slot.id, 1); render(); } },
      {
        label: 'Aus dem Plan nehmen',
        danger: true,
        sub: 'Verlauf der Übung bleibt erhalten.',
        run: () => {
          S.removeSlot(day.id, slot.id);
          render();
        },
      },
    ],
  });
}

function replaceSlotFlow(day, slot) {
  const oldName = S.exerciseName(slot.exerciseId);
  pickerSheet({
    title: `„${oldName}“ ersetzen durch`,
    items: S.allExercises()
      .filter((e) => e.id !== slot.exerciseId)
      .map((e) => ({ id: e.id, label: e.name, sub: lastHint(e.id), badge: e.archived ? 'archiviert' : '' })),
    emptyText: 'Keine andere Übung vorhanden — leg eine neue an.',
    createLabel: 'Neue Übung anlegen',
    onPick: (id) => {
      S.replaceSlotExercise(day.id, slot.id, id);
      render();
      toast(`„${oldName}“ archiviert — Verlauf bleibt erhalten`);
    },
    onCreate: (name) =>
      newExerciseSheet(name, (ex) => {
        S.replaceSlotExercise(day.id, slot.id, ex.id);
        render();
        toast(`„${oldName}“ archiviert — Verlauf bleibt erhalten`);
      }),
  });
}

function editTarget(day, slot) {
  sheet({
    title: 'Ziel ändern',
    body: html`
      <div class="two-cols">
        <div class="field">
          <label for="ts">Sätze</label>
          <input id="ts" type="number" inputmode="numeric" min="1" max="20" value="${slot.targetSets}">
        </div>
        <div class="field">
          <label for="tr">Wiederholungen</label>
          <input id="tr" type="text" value="${esc(slot.targetReps)}" placeholder="z. B. 8-12">
        </div>
      </div>
      <p class="tiny muted" style="margin:-6px 0 14px">Wiederholungen dürfen leer bleiben — dann steht in der Übung nur die Satzzahl.</p>
      <button class="btn primary" data-ok type="button">Speichern</button>
    `,
    onMount(root, close) {
      root.querySelector('[data-ok]').addEventListener('click', () => {
        S.updateSlot(day.id, slot.id, {
          targetSets: root.querySelector('#ts').value,
          targetReps: root.querySelector('#tr').value,
        });
        close();
        render();
      });
    },
  });
}

/** Sheet zum Anlegen einer neuen Übung (Name + Eigenschaften). */
function newExerciseSheet(prefill, onDone) {
  sheet({
    title: 'Neue Übung',
    body: html`
      <div class="field">
        <label for="ex-name">Name</label>
        <input id="ex-name" type="text" value="${esc(prefill || '')}" placeholder="z. B. Beinpresse"
               autocomplete="off" autocapitalize="sentences" enterkeyhint="done">
      </div>
      <label class="check-row">
        <input id="ex-uni" type="checkbox">
        <span>
          <div class="t">Einarmige Übung (L/R)</div>
          <div class="s">Wiederholungen werden getrennt für links und rechts erfasst.</div>
        </span>
      </label>
      <label class="check-row">
        <input id="ex-assist" type="checkbox">
        <span>
          <div class="t">Unterstützungsgewicht</div>
          <div class="s">Mehr Gewicht = mehr Hilfe (z. B. Klimmzugmaschine). Bestwert und Fortschritt zählen dann andersherum.</div>
        </span>
      </label>
      <button class="btn primary" data-ok type="button">Anlegen</button>
    `,
    onMount(root, close) {
      const input = root.querySelector('#ex-name');
      const submit = () => {
        const name = input.value.trim();
        if (!name) return input.focus();
        const existing = S.findExerciseByName(name);
        if (existing) {
          close();
          S.updateExercise(existing.id, { archived: false });
          toast('Übung gab es schon — Verlauf wiederverwendet');
          return onDone(existing);
        }
        const ex = S.addExercise({
          name,
          unilateral: root.querySelector('#ex-uni').checked,
          assisted: root.querySelector('#ex-assist').checked,
        });
        close();
        onDone(ex);
      };
      root.querySelector('[data-ok]').addEventListener('click', submit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
      setTimeout(() => input.focus(), 60);
    },
  });
}

/* -------------------------------------------------------- Übungsverwaltung */

function viewExerciseList() {
  setTop({
    title: 'Übungen',
    left: { label: '‹ Zurück', run: back },
    right: { label: '＋ Neu', run: () => newExerciseSheet('', () => render()) },
  });

  const active = S.activeExercises();
  const archived = S.db.exercises.filter((e) => e.archived).sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const rows = (list) =>
    list
      .map(
        (ex) => html`
          <button class="row" data-ex="${ex.id}" type="button">
            <div class="row-main">
              <div class="row-title">${esc(ex.name)}</div>
              <div class="row-sub">${esc(lastHint(ex.id))} · ${S.exerciseUsageCount(ex.id)} Sätze gesamt</div>
            </div>
            ${ex.unilateral ? '<span class="row-badge">L/R</span>' : ''}
            <span class="row-chev">⋯</span>
          </button>
        `
      )
      .join('');

  viewEl.innerHTML = html`
    ${active.length ? `<div class="section-title">Aktiv</div><div class="list">${rows(active)}</div>` : ''}
    ${
      archived.length
        ? `<div class="section-title">Archiviert</div>
           <p class="tiny muted" style="margin:-4px 4px 8px">Nicht mehr im Plan, aber der Verlauf bleibt. Kommt die Übung zurück, sind die alten Gewichte sofort wieder da.</p>
           <div class="list">${rows(archived)}</div>`
        : ''
    }
    ${!S.db.exercises.length ? '<div class="empty"><p>Noch keine Übungen angelegt.</p></div>' : ''}
  `;

  viewEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ex]');
    if (btn) exerciseMenu(btn.dataset.ex);
  });
}

function exerciseMenu(id) {
  const ex = S.exerciseById(id);
  if (!ex) return;
  const inPlan = S.exerciseInPlan(id);
  const usage = S.exerciseUsageCount(id);

  const actions = [
    {
      label: 'Umbenennen',
      sub: 'Verlauf läuft weiter.',
      run: () =>
        promptSheet({
          title: 'Übung umbenennen',
          label: 'Name',
          value: ex.name,
          onSubmit: (name) => {
            S.updateExercise(id, { name });
            render();
          },
        }),
    },
    ...flagActions(id, render),
    { label: 'Verlauf ansehen', sub: `${usage} Sätze protokolliert`, run: () => go('verlauf', 'exercise', id) },
  ];

  if (ex.archived) {
    actions.push({
      label: 'Aus dem Archiv holen',
      run: () => {
        S.updateExercise(id, { archived: false });
        render();
      },
    });
  } else if (!inPlan) {
    actions.push({
      label: 'Archivieren',
      sub: 'Verschwindet aus den Auswahllisten, Verlauf bleibt.',
      run: () => {
        S.updateExercise(id, { archived: true });
        render();
      },
    });
  }

  actions.push({
    label: 'Übung löschen',
    danger: true,
    sub: usage ? `Achtung: ${usage} protokollierte Sätze gehen verloren.` : 'Kein Verlauf vorhanden.',
    run: () =>
      confirmSheet({
        title: 'Übung löschen?',
        text: usage
          ? `„${ex.name}“ hat ${usage} protokollierte Sätze. Die bleiben zwar in den alten Trainings sichtbar, aber die Übung verschwindet aus Plan und Auswahl. Besser wäre archivieren.`
          : `„${ex.name}“ wird gelöscht.`,
        confirmLabel: 'Trotzdem löschen',
        danger: true,
        onConfirm: () => {
          S.deleteExercise(id);
          render();
        },
      }),
  });

  actionSheet({ title: ex.name, actions });
}

/* ==================================================================== VERLAUF */

let verlaufMode = 'training';

function viewVerlauf() {
  setTop({ title: 'Verlauf' });
  const sessions = S.finishedSessions();

  viewEl.innerHTML = html`
    <div class="seg">
      <button data-mode="training" class="${verlaufMode === 'training' ? 'active' : ''}" type="button">Nach Training</button>
      <button data-mode="uebung" class="${verlaufMode === 'uebung' ? 'active' : ''}" type="button">Nach Übung</button>
    </div>
    <div data-content></div>
  `;

  const content = viewEl.querySelector('[data-content]');
  if (verlaufMode === 'training') {
    content.innerHTML = sessions.length
      ? `<div class="list">${recentRows(sessions)}</div>`
      : '<div class="empty"><span class="big">📈</span><p>Noch keine abgeschlossenen Trainings.</p></div>';
  } else {
    const list = S.allExercises().filter((e) => S.exerciseUsageCount(e.id) > 0 || !e.archived);
    content.innerHTML = list.length
      ? `<div class="list">${list
          .map(
            (ex) => html`
              <button class="row" data-ex="${ex.id}" type="button">
                <div class="row-main">
                  <div class="row-title">${esc(ex.name)}${ex.archived ? ' <span class="row-badge">archiviert</span>' : ''}</div>
                  <div class="row-sub">${esc(lastHint(ex.id))}</div>
                </div>
                <span class="row-chev">›</span>
              </button>
            `
          )
          .join('')}</div>`
      : '<div class="empty"><p>Noch keine Übungen.</p></div>';
  }

  viewEl.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-mode]');
    if (mode) {
      verlaufMode = mode.dataset.mode;
      return render();
    }
    const ses = e.target.closest('[data-session]');
    if (ses) return go('verlauf', 'session', ses.dataset.session);
    const ex = e.target.closest('[data-ex]');
    if (ex) return go('verlauf', 'exercise', ex.dataset.ex);
  });
}

/**
 * Verlaufsgraph des schwersten Satzes über die Zeit. Eine Serie, deshalb keine
 * Legende; beschriftet werden nur Bestwert und aktueller Stand. Die vollständigen
 * Zahlen stehen direkt darunter in der Liste.
 */
function sparkline(points) {
  const W = 320;
  const H = 76;
  const PX = 14;
  const PY = 18;
  const n = points.length;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;

  const px = (i) => (n === 1 ? W / 2 : PX + (i * (W - 2 * PX)) / (n - 1));
  const py = (v) => (max === min ? H / 2 : H - PY - ((v - min) / span) * (H - 2 * PY));
  const pts = points.map((p, i) => [px(i), py(p.value)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${d} L${pts[n - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;

  const maxIdx = vals.lastIndexOf(max);
  const lastIdx = n - 1;
  const clampX = (x) => Math.min(Math.max(x, 22), W - 22);
  const dots = pts
    .map(([x, y], i) => {
      const key = i === maxIdx || i === lastIdx;
      if (!key && n > 14) return '';
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${key ? 4 : 2.5}"
                fill="${key ? 'var(--accent)' : 'var(--bg-elev)'}" stroke="var(--accent)" stroke-width="2"/>`;
    })
    .join('');

  const label = (i, dy, text) =>
    `<text x="${clampX(pts[i][0]).toFixed(1)}" y="${(pts[i][1] + dy).toFixed(1)}"
       text-anchor="middle" font-size="11" font-weight="600" fill="var(--text-dim)">${esc(text)}</text>`;

  return html`
    <svg class="spark" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Verlauf des schwersten Satzes: ${esc(points.map((p) => `${S.formatDate(p.date)} ${fmtW(p.value)} kg`).join(', '))}">
      <path d="${area}" fill="var(--accent-soft)"/>
      <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      ${maxIdx !== lastIdx ? label(maxIdx, -10, `${fmtW(max)} kg`) : ''}
      ${label(lastIdx, pts[lastIdx][1] < 24 ? 18 : -10, `${fmtW(vals[lastIdx])} kg`)}
    </svg>
  `;
}

function deltaTag(delta) {
  if (!delta) return '';
  const value = `${delta.value > 0 ? '+' : '−'}${fmtW(Math.abs(delta.value))} ${delta.kind}`;
  // Grün heißt "besser" — bei Unterstützungsgewicht ist das ein Minus.
  return `<span class="delta ${delta.better ? 'up' : 'down'}">${esc(value)}</span>`;
}

function viewExerciseHistory() {
  const ex = S.exerciseById(route.id);
  if (!ex) return back();
  const prog = S.exerciseProgress(ex.id);

  const assisted = !!ex.assisted;

  setTop({
    title: ex.name,
    sub: `${prog.length} Einträge${ex.unilateral ? ' · einarmig (L/R)' : ''}${assisted ? ' · weniger Gewicht = besser' : ''}`,
    left: { label: '‹ Zurück', run: back },
  });

  if (!prog.length) {
    viewEl.innerHTML = '<div class="empty"><p>Für diese Übung ist noch nichts protokolliert.</p></div>';
    return;
  }

  const allSets = prog.flatMap((h) => h.sets);
  const record = S.bestSet(allSets, ex.unilateral, assisted);
  const latest = prog[0];
  const chrono = [...prog].reverse();
  const totalSets = allSets.length;
  const points = chrono.filter((h) => h.top != null).map((h) => ({ date: h.date, value: h.top }));

  viewEl.innerHTML = html`
    <div class="stat-grid">
      <div class="stat">
        <div class="k">${assisted ? 'Bestwert (wenigste Hilfe)' : 'Bestwert'}</div>
        <div class="v">${record ? setLabel(record, ex.unilateral) : '–'}</div>
      </div>
      <div class="stat"><div class="k">Letztes Mal</div><div class="v">${latest.best ? setLabel(latest.best, ex.unilateral) : '–'}</div></div>
      <div class="stat"><div class="k">Einträge · Sätze</div><div class="v">${prog.length} · ${totalSets}</div></div>
      ${
        assisted
          ? `<div class="stat"><div class="k">Sätze gesamt</div><div class="v">${totalSets}</div></div>`
          : `<div class="stat"><div class="k">Volumen zuletzt</div><div class="v">${fmtInt(latest.volume || 0)} kg</div></div>`
      }
    </div>

    ${
      points.length > 1
        ? html`
            <div class="section-title">${assisted ? 'Unterstützung im Verlauf' : 'Schwerster Satz im Verlauf'}</div>
            ${assisted ? '<p class="tiny muted" style="margin:-4px 4px 8px">Weniger Gewicht heißt weniger Hilfe — hier ist eine fallende Linie der Fortschritt.</p>' : ''}
            <div class="chart-card">
              ${sparkline(points)}
              <div class="chart-foot">
                <span>${esc(S.formatDate(points[0].date))}</span>
                <span>${esc(S.formatDate(points[points.length - 1].date))}</span>
              </div>
            </div>
          `
        : ''
    }

    <div class="section-title">Alle Einträge</div>
    <div class="list">
      ${prog
        .map(
          (h) => html`
            <div class="hist-entry">
              <div class="hist-date">
                <span>${esc(S.formatDate(h.date))}</span>
                <span class="muted tiny">${esc(h.dayName)} · ${esc(S.relativeDate(h.date))}</span>
                ${h.isRecord ? '<span class="badge-pr">Bestwert</span>' : ''}
                ${h.wasSubstitute ? '<span class="badge-sub">als Ersatz</span>' : ''}
              </div>
              <div class="hist-sets">${setsSummary(h.sets, ex.unilateral, h.best)}</div>
              <div class="hist-meta">
                <span>${h.sets.length} Sätze${h.volume != null ? ` · ${fmtInt(h.volume)} kg Volumen` : ''}</span>
                ${deltaTag(h.delta)}
              </div>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

function viewSessionDetail() {
  const session = S.sessionById(route.id);
  if (!session) return back();

  setTop({
    title: session.dayName,
    sub: `${S.formatDate(session.date)} · ${S.relativeDate(session.date)}`,
    left: { label: '‹ Zurück', run: back },
    right: { label: '⋯', run: () => pastSessionMenu(session) },
  });

  const minutes = S.sessionDuration(session);

  viewEl.innerHTML = html`
    <div class="stat-grid">
      <div class="stat"><div class="k">Übungen</div><div class="v">${session.entries.length}</div></div>
      <div class="stat"><div class="k">Sätze</div><div class="v">${session.entries.reduce((n, e) => n + e.sets.length, 0)}</div></div>
      <div class="stat"><div class="k">Volumen</div><div class="v">${fmtInt(S.sessionVolume(session))} kg</div></div>
      <div class="stat"><div class="k">Dauer</div><div class="v">${minutes ? `${minutes} Min` : '–'}</div></div>
    </div>
    <div class="list">
      ${session.entries
        .map((entry) => {
          const wasSub = entry.plannedExerciseId && entry.plannedExerciseId !== entry.exerciseId;
          const info = S.exerciseProgress(entry.exerciseId).find((h) => h.entryId === entry.id);
          const best = info ? info.best : S.bestSet(entry.sets, entry.unilateral, S.isAssisted(entry.exerciseId));
          const vol = S.entryVolume(entry);
          return html`
            <button class="hist-entry tappable" data-ex="${entry.exerciseId}" type="button">
              <div class="hist-date">
                <span>${esc(S.exerciseName(entry.exerciseId))}</span>
                ${info && info.isRecord ? '<span class="badge-pr">Bestwert</span>' : ''}
                ${wasSub ? `<span class="badge-sub">Ersatz für ${esc(S.exerciseName(entry.plannedExerciseId))}</span>` : ''}
              </div>
              <div class="hist-sets">${setsSummary(entry.sets, entry.unilateral, best)}</div>
              <div class="hist-meta">
                <span>${entry.sets.length} Sätze${vol != null ? ` · ${fmtInt(vol)} kg Volumen` : ''}</span>
                ${deltaTag(info && info.delta)}
              </div>
            </button>
          `;
        })
        .join('')}
    </div>
    <p class="tiny muted" style="text-align:center;margin-top:14px">Übung antippen für ihren kompletten Verlauf</p>
  `;

  viewEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ex]');
    if (btn) go(route.tab, 'exercise', btn.dataset.ex);
  });
}

function pastSessionMenu(session) {
  actionSheet({
    title: `${session.dayName} · ${S.formatDate(session.date)}`,
    actions: [
      {
        label: 'Training löschen',
        danger: true,
        run: () =>
          confirmSheet({
            title: 'Training löschen?',
            text: 'Dieses Training wird komplett aus dem Verlauf entfernt.',
            confirmLabel: 'Löschen',
            danger: true,
            onConfirm: () => {
              S.discardSession(session.id);
              back();
            },
          }),
      },
    ],
  });
}

/* ======================================================================= MEHR */

function viewMehr() {
  setTop({ title: 'Mehr' });
  const sessions = S.finishedSessions();
  const sets = sessions.reduce((n, s) => n + s.entries.reduce((m, e) => m + e.sets.length, 0), 0);

  viewEl.innerHTML = html`
    <div class="stat-grid">
      <div class="stat"><div class="k">Trainings</div><div class="v">${sessions.length}</div></div>
      <div class="stat"><div class="k">Sätze gesamt</div><div class="v">${sets}</div></div>
      <div class="stat"><div class="k">Übungen</div><div class="v">${S.db.exercises.length}</div></div>
      <div class="stat"><div class="k">Seit</div><div class="v">${sessions.length ? esc(S.formatDate(sessions[sessions.length - 1].date)) : '–'}</div></div>
    </div>

    <div class="section-title">Verwaltung</div>
    <div class="list">
      <button class="row" data-exercises type="button">
        <div class="row-main"><div class="row-title">Übungen verwalten</div>
        <div class="row-sub">Umbenennen, archivieren, Eigenschaften ändern</div></div>
        <span class="row-chev">›</span>
      </button>
    </div>

    <div class="section-title">Backup</div>
    <p class="tiny muted" style="margin:-4px 4px 10px">Die Daten liegen nur auf diesem iPhone. Sicher sie regelmäßig als Datei – z.&nbsp;B. in „Dateien“ oder iCloud Drive.</p>
    <div class="list">
      <button class="row" data-export type="button">
        <div class="row-main"><div class="row-title">Daten exportieren</div>
        <div class="row-sub">Sicherungsdatei speichern oder teilen</div></div>
        <span class="row-chev">›</span>
      </button>
      <button class="row" data-import type="button">
        <div class="row-main"><div class="row-title">Daten importieren</div>
        <div class="row-sub">Sicherung wiederherstellen</div></div>
        <span class="row-chev">›</span>
      </button>
    </div>

    <div class="section-title">Zurücksetzen</div>
    <button class="btn danger" data-reset type="button">Alle Daten löschen</button>

    <p class="tiny muted" style="text-align:center;margin-top:26px">
      Trainingsplan · läuft offline · Daten bleiben auf dem Gerät
    </p>
  `;

  viewEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-exercises]')) return go('mehr', 'exercises');
    if (e.target.closest('[data-export]')) return exportFlow();
    if (e.target.closest('[data-import]')) return importFlow();
    if (e.target.closest('[data-reset]')) {
      return confirmSheet({
        title: 'Wirklich alles löschen?',
        text: 'Plan, Übungen und der komplette Verlauf werden unwiderruflich gelöscht. Vorher exportieren!',
        confirmLabel: 'Alles löschen',
        danger: true,
        onConfirm: () => {
          S.resetAll();
          go('training');
        },
      });
    }
  });
}

function exportFlow() {
  const text = S.exportJson();
  const name = `trainingsplan-backup-${S.todayISO()}.json`;
  const file = new File([text], name, { type: 'application/json' });

  sheet({
    title: 'Daten exportieren',
    body: html`
      <p class="muted tiny" style="margin-top:0">Enthält Plan, Übungen und den kompletten Verlauf.</p>
      ${navigator.canShare && navigator.canShare({ files: [file] }) ? '<button class="btn primary" data-share type="button">Teilen / in Dateien sichern</button>' : ''}
      <button class="btn" data-download type="button">Als Datei laden</button>
      <button class="btn quiet" data-copy type="button">In die Zwischenablage kopieren</button>
    `,
    onMount(root, close) {
      root.querySelector('[data-share]')?.addEventListener('click', async () => {
        try {
          await navigator.share({ files: [file], title: name });
          close();
        } catch (err) {
          if (err && err.name !== 'AbortError') toast('Teilen nicht möglich');
        }
      });
      root.querySelector('[data-download]').addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        close();
      });
      root.querySelector('[data-copy]').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast('In die Zwischenablage kopiert');
          close();
        } catch {
          toast('Kopieren nicht möglich');
        }
      });
    },
  });
}

function importFlow() {
  sheet({
    title: 'Daten importieren',
    body: html`
      <p class="muted tiny" style="margin-top:0">Wähle eine zuvor exportierte <code>.json</code>-Datei.</p>
      <div class="field">
        <input id="imp-file" type="file" accept=".json,application/json">
      </div>
      <label class="check-row">
        <input id="imp-merge" type="checkbox">
        <span>
          <div class="t">Zusammenführen statt ersetzen</div>
          <div class="s">Behält die aktuellen Daten und ergänzt nur, was fehlt.</div>
        </span>
      </label>
      <button class="btn primary" data-ok type="button">Importieren</button>
    `,
    onMount(root, close) {
      root.querySelector('[data-ok]').addEventListener('click', async () => {
        const input = root.querySelector('#imp-file');
        const file = input.files && input.files[0];
        if (!file) return toast('Bitte zuerst eine Datei wählen');
        try {
          const text = await file.text();
          S.importJson(text, { merge: root.querySelector('#imp-merge').checked });
          close();
          toast('Import erfolgreich');
          go('training');
        } catch (err) {
          toast(err.message || 'Datei konnte nicht gelesen werden');
        }
      });
    },
  });
}

/* ======================================================================= INIT */

tabbarEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (btn) go(btn.dataset.tab);
});

function boot() {
  S.load();
  render();
}

window.addEventListener('pagehide', () => S.writeNow());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') S.writeNow();
});

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
