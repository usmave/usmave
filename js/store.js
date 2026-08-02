/**
 * Datenhaltung der Trainings-App.
 *
 * Zwei Dinge sind bewusst getrennt:
 *   - Übung  (exercise): Name + Verlauf. Existiert unabhängig vom Plan.
 *   - Platz  (slot):     Position im Trainingstag, zeigt auf genau eine Übung.
 *
 * Dadurch gibt es drei saubere Wege, eine Übung zu wechseln:
 *   1. Umbenennen         -> gleiche Übung, Verlauf läuft weiter.
 *   2. Übung ersetzen     -> Platz zeigt auf eine andere Übung, alter Verlauf
 *                            bleibt unter der alten Übung erhalten.
 *   3. Alternative (heute) -> nur der Sessioneintrag zeigt woanders hin,
 *                            der Plan bleibt unverändert.
 */

const KEY = 'trainingsplan.v1';
const SCHEMA = 1;

/** @type {any} */
export let db = emptyDb();

function emptyDb() {
  return {
    schema: SCHEMA,
    exercises: [],
    days: [],
    sessions: [],
    settings: { unit: 'kg' },
  };
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) db = migrate(JSON.parse(raw));
  } catch (err) {
    console.error('Daten konnten nicht gelesen werden', err);
  }
  return db;
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 120);
}

export function writeNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (err) {
    console.error('Speichern fehlgeschlagen', err);
    alert('Speichern fehlgeschlagen — evtl. ist der Speicher voll. Bitte ein Backup exportieren.');
  }
}

function migrate(data) {
  const base = emptyDb();
  if (!data || typeof data !== 'object') return base;
  return {
    ...base,
    ...data,
    schema: SCHEMA,
    exercises: Array.isArray(data.exercises) ? data.exercises : [],
    days: Array.isArray(data.days) ? data.days : [],
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    settings: { ...base.settings, ...(data.settings || {}) },
  };
}

/* ------------------------------------------------------------------ Übungen */

export function exerciseById(id) {
  return db.exercises.find((e) => e.id === id) || null;
}

export function exerciseName(id) {
  const ex = exerciseById(id);
  return ex ? ex.name : 'Unbekannte Übung';
}

export function activeExercises() {
  return db.exercises.filter((e) => !e.archived).sort(byName);
}

export function allExercises() {
  return [...db.exercises].sort(byName);
}

function byName(a, b) {
  return a.name.localeCompare(b.name, 'de');
}

export function addExercise({ name, unilateral = false }) {
  const ex = {
    id: uid(),
    name: name.trim(),
    unilateral: !!unilateral,
    archived: false,
    createdAt: new Date().toISOString(),
  };
  db.exercises.push(ex);
  save();
  return ex;
}

/** Findet eine Übung mit gleichem Namen (unabhängig von Groß/Klein). */
export function findExerciseByName(name) {
  const n = name.trim().toLowerCase();
  return db.exercises.find((e) => e.name.trim().toLowerCase() === n) || null;
}

export function updateExercise(id, patch) {
  const ex = exerciseById(id);
  if (!ex) return null;
  if (typeof patch.name === 'string') ex.name = patch.name.trim();
  if (typeof patch.unilateral === 'boolean') ex.unilateral = patch.unilateral;
  if (typeof patch.archived === 'boolean') ex.archived = patch.archived;
  save();
  return ex;
}

/** Anzahl protokollierter Sätze — entscheidet, ob eine Übung löschbar ist. */
export function exerciseUsageCount(id) {
  let n = 0;
  for (const s of db.sessions) {
    for (const e of s.entries) {
      if (e.exerciseId === id) n += e.sets.filter((set) => set.done).length;
    }
  }
  return n;
}

export function exerciseInPlan(id) {
  return db.days.some((d) => d.slots.some((s) => s.exerciseId === id));
}

export function deleteExercise(id) {
  db.exercises = db.exercises.filter((e) => e.id !== id);
  for (const d of db.days) d.slots = d.slots.filter((s) => s.exerciseId !== id);
  save();
}

/* ------------------------------------------------------------- Trainingstage */

export function dayById(id) {
  return db.days.find((d) => d.id === id) || null;
}

export function addDay(name) {
  const day = { id: uid(), name: name.trim(), slots: [] };
  db.days.push(day);
  save();
  return day;
}

export function updateDay(id, patch) {
  const day = dayById(id);
  if (!day) return null;
  if (typeof patch.name === 'string') day.name = patch.name.trim();
  save();
  return day;
}

export function deleteDay(id) {
  db.days = db.days.filter((d) => d.id !== id);
  save();
}

export function moveDay(id, dir) {
  move(db.days, db.days.findIndex((d) => d.id === id), dir);
  save();
}

/* -------------------------------------------------------------- Plan-Plätze */

export function addSlot(dayId, { exerciseId, targetSets = 3, targetReps = '10' }) {
  const day = dayById(dayId);
  if (!day) return null;
  const slot = { id: uid(), exerciseId, targetSets, targetReps: String(targetReps) };
  day.slots.push(slot);
  save();
  return slot;
}

export function updateSlot(dayId, slotId, patch) {
  const day = dayById(dayId);
  const slot = day && day.slots.find((s) => s.id === slotId);
  if (!slot) return null;
  if (patch.exerciseId) slot.exerciseId = patch.exerciseId;
  if (patch.targetSets != null) slot.targetSets = Number(patch.targetSets) || 1;
  if (patch.targetReps != null) slot.targetReps = String(patch.targetReps);
  save();
  return slot;
}

export function removeSlot(dayId, slotId) {
  const day = dayById(dayId);
  if (!day) return;
  day.slots = day.slots.filter((s) => s.id !== slotId);
  save();
}

export function moveSlot(dayId, slotId, dir) {
  const day = dayById(dayId);
  if (!day) return;
  move(day.slots, day.slots.findIndex((s) => s.id === slotId), dir);
  save();
}

function move(arr, i, dir) {
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  const [item] = arr.splice(i, 1);
  arr.splice(j, 0, item);
}

/**
 * Ersetzt die Übung eines Plan-Platzes. Der Verlauf der alten Übung bleibt
 * unangetastet; sie wird nur archiviert, wenn sie in keinem Plan mehr vorkommt.
 */
export function replaceSlotExercise(dayId, slotId, newExerciseId, { archiveOld = true } = {}) {
  const day = dayById(dayId);
  const slot = day && day.slots.find((s) => s.id === slotId);
  if (!slot) return;
  const oldId = slot.exerciseId;
  slot.exerciseId = newExerciseId;
  const old = exerciseById(oldId);
  if (archiveOld && old && oldId !== newExerciseId && !exerciseInPlan(oldId)) {
    old.archived = true;
  }
  const next = exerciseById(newExerciseId);
  if (next) next.archived = false;
  save();
}

/* ----------------------------------------------------------------- Sessions */

export function activeSession() {
  return db.sessions.find((s) => !s.finishedAt) || null;
}

export function sessionById(id) {
  return db.sessions.find((s) => s.id === id) || null;
}

export function finishedSessions() {
  return db.sessions
    .filter((s) => s.finishedAt)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));
}

/** Letztes abgeschlossenes Training eines Tages. */
export function lastSessionForDay(dayId) {
  return finishedSessions().find((s) => s.dayId === dayId) || null;
}

/**
 * Welcher Tag ist dran? Bei A/B-Wechsel also: nach Tag B kommt Tag A.
 * Nie trainierte Tage haben Vorrang, danach der Reihe nach im Plan.
 */
export function suggestNextDay() {
  if (!db.days.length) return null;
  const done = finishedSessions();
  if (!done.length) return db.days[0];

  const untrained = db.days.filter((d) => !done.some((s) => s.dayId === d.id));
  if (untrained.length) return untrained[0];

  const idx = db.days.findIndex((d) => d.id === done[0].dayId);
  if (idx === -1) {
    // Der zuletzt trainierte Tag steht nicht mehr im Plan: den ältesten nehmen.
    return [...db.days].sort((a, b) => {
      const la = lastSessionForDay(a.id);
      const lb = lastSessionForDay(b.id);
      return String(la ? la.date : '').localeCompare(String(lb ? lb.date : ''));
    })[0];
  }
  return db.days[(idx + 1) % db.days.length];
}

export function startSession(dayId) {
  const day = dayById(dayId);
  if (!day) return null;
  const session = {
    id: uid(),
    dayId: day.id,
    dayName: day.name,
    date: todayISO(),
    createdAt: new Date().toISOString(),
    finishedAt: null,
    entries: day.slots.map((slot) => makeEntry(slot)),
  };
  db.sessions.push(session);
  save();
  return session;
}

function makeEntry(slot) {
  const ex = exerciseById(slot.exerciseId);
  const last = lastPerformance(slot.exerciseId);
  // Lieber eine Zeile zu viel als eine zu wenig — leere Zeilen werden beim
  // Beenden ohnehin verworfen, eine fehlende müsste man nachtippen.
  const count = Math.max(last ? last.sets.length : 0, slot.targetSets || 3);
  return {
    id: uid(),
    slotId: slot.id,
    plannedExerciseId: slot.exerciseId,
    exerciseId: slot.exerciseId,
    targetSets: slot.targetSets,
    targetReps: slot.targetReps,
    unilateral: !!(ex && ex.unilateral),
    sets: Array.from({ length: count }, (_, i) => blankSet(pickSet(last, i), ex)),
  };
}

/** Satz i vom letzten Mal — hat man heute mehr Sätze, gilt der letzte weiter. */
function pickSet(last, i) {
  if (!last || !last.sets.length) return null;
  return last.sets[Math.min(i, last.sets.length - 1)];
}

/**
 * Neuer, leerer Satz. Die Werte vom letzten Mal landen nicht im Feld, sondern in
 * `suggest` — sie stehen blass als Vorschlag drin und werden beim Abhaken
 * übernommen. So bleibt die Trainingsansicht ruhig und man sieht sofort,
 * was heute wirklich schon eingetragen ist.
 */
function blankSet(template, ex) {
  const uni = !!(ex && ex.unilateral);
  const src = template ? (template.done ? template : template.suggest) : null;
  return {
    id: uid(),
    weight: null,
    reps: null,
    repsL: null,
    repsR: null,
    done: false,
    suggest: src
      ? {
          weight: src.weight ?? null,
          reps: uni ? null : src.reps ?? null,
          repsL: uni ? src.repsL ?? src.reps ?? null : null,
          repsR: uni ? src.repsR ?? src.reps ?? null : null,
        }
      : null,
  };
}

/** Ist für diesen Satz etwas da — eingetippt oder als Vorschlag? */
export function setHasValue(set, unilateral) {
  const has = (a, b) => a != null || (set.suggest && set.suggest[b] != null);
  return unilateral
    ? has(set.repsL, 'repsL') || has(set.repsR, 'repsR') || has(set.weight, 'weight')
    : has(set.reps, 'reps') || has(set.weight, 'weight');
}

/** Abhaken: leere Felder werden mit dem Vorschlag vom letzten Mal gefüllt. */
export function setDone(session, entryId, setId, done) {
  const entry = entryById(session, entryId);
  const set = entry && entry.sets.find((s) => s.id === setId);
  if (!set) return null;
  if (done && set.suggest) {
    const s = set.suggest;
    if (set.weight == null) set.weight = s.weight;
    if (entry.unilateral) {
      if (set.repsL == null) set.repsL = s.repsL;
      if (set.repsR == null) set.repsR = s.repsR;
    } else if (set.reps == null) {
      set.reps = s.reps;
    }
  }
  set.done = done;
  save();
  return set;
}

export function entryById(session, entryId) {
  return session.entries.find((e) => e.id === entryId) || null;
}

export function addSet(session, entryId) {
  const entry = entryById(session, entryId);
  if (!entry) return;
  const ex = exerciseById(entry.exerciseId);
  const last = entry.sets[entry.sets.length - 1];
  entry.sets.push(blankSet(last, ex));
  save();
}

export function removeSet(session, entryId, setId) {
  const entry = entryById(session, entryId);
  if (!entry) return;
  entry.sets = entry.sets.filter((s) => s.id !== setId);
  save();
}

export function updateSet(session, entryId, setId, patch) {
  const entry = entryById(session, entryId);
  const set = entry && entry.sets.find((s) => s.id === setId);
  if (!set) return null;
  Object.assign(set, patch);
  save();
  return set;
}

/**
 * Tauscht die Übung nur für dieses eine Training aus. Der Plan bleibt gleich.
 *
 * Sind schon Sätze abgehakt, werden sie NICHT mitgenommen — sie gehören zur
 * ursprünglichen Übung. Die Alternative kommt dann als eigener Eintrag direkt
 * dahinter, damit im Verlauf jede Übung nur ihre eigenen Sätze bekommt.
 */
export function substituteEntry(session, entryId, exerciseId) {
  const entry = entryById(session, entryId);
  if (!entry) return null;
  const ex = exerciseById(exerciseId);
  const last = lastPerformance(exerciseId, session.id);
  const doneSets = entry.sets.filter((s) => s.done);

  if (doneSets.length) {
    entry.sets = doneSets;
    const rest = Math.max(1, (entry.targetSets || 3) - doneSets.length);
    const fresh = {
      id: uid(),
      slotId: entry.slotId,
      plannedExerciseId: entry.plannedExerciseId,
      exerciseId,
      targetSets: rest,
      targetReps: entry.targetReps,
      unilateral: !!(ex && ex.unilateral),
      sets: Array.from({ length: rest }, (_, i) => blankSet(pickSet(last, i), ex)),
    };
    session.entries.splice(session.entries.indexOf(entry) + 1, 0, fresh);
    save();
    return fresh;
  }

  entry.exerciseId = exerciseId;
  entry.unilateral = !!(ex && ex.unilateral);
  const count = Math.max(last ? last.sets.length : 0, entry.targetSets || 3);
  entry.sets = Array.from({ length: count }, (_, i) => blankSet(pickSet(last, i), ex));
  save();
  return entry;
}

export function addEntry(session, exerciseId) {
  const ex = exerciseById(exerciseId);
  const last = lastPerformance(exerciseId, session.id);
  const count = last ? Math.max(last.sets.length, 1) : 3;
  const entry = {
    id: uid(),
    slotId: null,
    plannedExerciseId: null,
    exerciseId,
    targetSets: count,
    targetReps: '',
    unilateral: !!(ex && ex.unilateral),
    sets: Array.from({ length: count }, (_, i) => blankSet(pickSet(last, i), ex)),
  };
  session.entries.push(entry);
  save();
  return entry;
}

export function removeEntry(session, entryId) {
  session.entries = session.entries.filter((e) => e.id !== entryId);
  save();
}

/** Beendet das Training und verwirft alle nicht abgehakten Sätze. */
export function finishSession(session) {
  for (const entry of session.entries) {
    entry.sets = entry.sets.filter((s) => s.done);
    for (const set of entry.sets) delete set.suggest; // Vorschläge sind nur zur Laufzeit interessant
  }
  session.entries = session.entries.filter((e) => e.sets.length > 0);
  session.finishedAt = new Date().toISOString();
  writeNow();
  return session;
}

/** Dauer in Minuten — nur plausible Werte (nicht: Training tagelang offen gelassen). */
export function sessionDuration(session) {
  if (!session.finishedAt || !session.createdAt) return null;
  const min = Math.round((new Date(session.finishedAt) - new Date(session.createdAt)) / 60000);
  return min > 0 && min <= 300 ? min : null;
}

export function sessionVolume(session) {
  return session.entries.reduce(
    (n, e) => n + e.sets.reduce((m, s) => m + setVolume(s, e.unilateral), 0),
    0
  );
}

export function entryVolume(entry) {
  return entry.sets.reduce((n, s) => n + setVolume(s, entry.unilateral), 0);
}

export function topWeight(sets) {
  return sets.reduce((max, s) => Math.max(max, Number(s.weight) || 0), 0);
}

export function discardSession(sessionId) {
  db.sessions = db.sessions.filter((s) => s.id !== sessionId);
  writeNow();
}

export function countDoneSets(session) {
  return session.entries.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
}

/* ------------------------------------------------------------------ Verlauf */

/**
 * Letzte protokollierte Leistung einer Übung.
 * @returns {{date:string, sets:Array}|null}
 */
export function lastPerformance(exerciseId, excludeSessionId = null) {
  const hits = exerciseHistory(exerciseId).filter((h) => h.sessionId !== excludeSessionId);
  return hits.length ? hits[0] : null;
}

/**
 * Alle Trainings, in denen die Übung vorkam — neueste zuerst.
 * Enthält auch Einsätze als spontane Alternative.
 */
export function exerciseHistory(exerciseId) {
  const out = [];
  for (const session of db.sessions) {
    if (!session.finishedAt) continue;
    for (const entry of session.entries) {
      if (entry.exerciseId !== exerciseId) continue;
      const sets = entry.sets.filter((s) => s.done);
      if (!sets.length) continue;
      out.push({
        sessionId: session.id,
        entryId: entry.id,
        date: session.date,
        createdAt: session.createdAt || '',
        dayName: session.dayName,
        plannedExerciseId: entry.plannedExerciseId,
        wasSubstitute: !!(entry.plannedExerciseId && entry.plannedExerciseId !== entry.exerciseId),
        unilateral: !!entry.unilateral,
        sets,
      });
    }
  }
  return out.sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.createdAt).localeCompare(String(a.createdAt))
  );
}

/**
 * Verlauf einer Übung, angereichert um Volumen, Bestwert-Markierung und
 * Veränderung gegenüber dem Mal davor. Neueste zuerst.
 */
export function exerciseProgress(exerciseId) {
  const hits = exerciseHistory(exerciseId);
  const chrono = [...hits].reverse();
  let record = 0;

  const enriched = chrono.map((h, i) => {
    const top = topWeight(h.sets);
    const best = bestSet(h.sets, h.unilateral);
    const prev = i > 0 ? chrono[i - 1] : null;
    const prevBest = prev ? bestSet(prev.sets, prev.unilateral) : null;
    const isRecord = top > 0 && top > record;
    record = Math.max(record, top);

    let delta = null;
    if (best && prevBest) {
      const dw = (Number(best.weight) || 0) - (Number(prevBest.weight) || 0);
      const reps = (s) => (h.unilateral ? Math.max(Number(s.repsL) || 0, Number(s.repsR) || 0) : Number(s.reps) || 0);
      const dr = reps(best) - reps(prevBest);
      if (dw) delta = { kind: 'kg', value: dw };
      else if (dr) delta = { kind: 'Wdh', value: dr };
    }

    return { ...h, top, best, volume: h.sets.reduce((n, s) => n + setVolume(s, h.unilateral), 0), isRecord, delta };
  });

  return enriched.reverse();
}

export function setVolume(set, unilateral) {
  const w = Number(set.weight) || 0;
  const reps = unilateral ? (Number(set.repsL) || 0) + (Number(set.repsR) || 0) : Number(set.reps) || 0;
  return w * reps;
}

export function bestSet(sets, unilateral) {
  let best = null;
  for (const s of sets) {
    const w = Number(s.weight) || 0;
    const r = unilateral ? Math.max(Number(s.repsL) || 0, Number(s.repsR) || 0) : Number(s.reps) || 0;
    if (!best || w > best.w || (w === best.w && r > best.r)) best = { set: s, w, r };
  }
  return best ? best.set : null;
}

/* ------------------------------------------------------------ Export/Import */

export function exportJson() {
  return JSON.stringify({ ...db, exportedAt: new Date().toISOString() }, null, 2);
}

export function importJson(text, { merge = false } = {}) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.exercises)) {
    throw new Error('Das sieht nicht nach einem Trainings-Backup aus.');
  }
  const incoming = migrate(parsed);
  if (!merge) {
    db = incoming;
  } else {
    const known = new Set(db.exercises.map((e) => e.id));
    for (const ex of incoming.exercises) if (!known.has(ex.id)) db.exercises.push(ex);
    const knownDays = new Set(db.days.map((d) => d.id));
    for (const d of incoming.days) if (!knownDays.has(d.id)) db.days.push(d);
    const knownSessions = new Set(db.sessions.map((s) => s.id));
    for (const s of incoming.sessions) if (!knownSessions.has(s.id)) db.sessions.push(s);
  }
  writeNow();
  return db;
}

export function resetAll() {
  db = emptyDb();
  writeNow();
}

/* ------------------------------------------------------------- Startplan */

/**
 * Der eigene Plan, damit im Studio nichts abgetippt werden muss.
 * Wiederholungsziele stehen bewusst leer — sie sind nicht vorgegeben und
 * lassen sich pro Übung jederzeit im Plan nachtragen.
 */
export function seedMyPlan() {
  const mk = (name, unilateral = false) => addExercise({ name, unilateral }).id;
  const a = addDay('Tag A');
  const slot = (dayId, name, sets, unilateral = false) =>
    addSlot(dayId, { exerciseId: mk(name, unilateral), targetSets: sets, targetReps: '' });

  slot(a.id, 'Bankdrückmaschine flach', 2);
  slot(a.id, 'Butterflymaschine', 2);
  slot(a.id, 'Bankdrückmaschine sitzend', 2);
  slot(a.id, 'Schulterdrücken Maschine sitzend', 2);
  slot(a.id, 'Seitheben Kabel', 2);
  slot(a.id, 'Trizepsdrücken Kabel', 2);
  slot(a.id, 'Dips', 3);

  writeNow();
}

/* -------------------------------------------------------------------- Datum */

export function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function formatDate(iso, { withYear = true } = {}) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${withYear ? y : ''}`.replace(/\.$/, '');
}

export function relativeDate(iso) {
  const today = todayISO();
  if (iso === today) return 'heute';
  const diff = Math.round((new Date(today) - new Date(iso)) / 86400000);
  if (diff === 1) return 'gestern';
  if (diff < 7 && diff > 0) return `vor ${diff} Tagen`;
  if (diff < 0) return formatDate(iso);
  const weeks = Math.round(diff / 7);
  if (weeks < 9) return `vor ${weeks} Wo.`;
  return formatDate(iso);
}
