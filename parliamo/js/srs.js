/**
 * Wiederholung nach Lernkurve (vereinfachtes SM-2).
 * Jede Vokabel hat einen Zustand; nach jeder Abfrage wird der nächste Termin berechnet.
 */

export const DAY = 86400000;

export function startOfDay(ts = Date.now()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Kalendertag ab heute (sommerzeitfest, über das Datum statt über Millisekunden). */
export function addDays(ts, days) {
  const d = new Date(startOfDay(ts));
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Neue Karte, gerade kennengelernt. */
export function freshCard(now = Date.now()) {
  return { reps: 0, iv: 0, ef: 2.5, due: now, lapses: 0, seen: now, last: now, learning: true };
}

/** "Kenne ich schon": gleich mit großem Abstand einplanen. */
export function knownCard(now = Date.now()) {
  return { reps: 1, iv: 21, ef: 2.6, due: addDays(now, 21), lapses: 0, seen: now, last: now, learning: false, known: true };
}

function spread(iv) {
  if (iv < 4) return iv;
  const f = 1 + (Math.random() * 0.16 - 0.08);
  return Math.max(1, Math.round(iv * f));
}

/**
 * outcome: 'again' (falsch) | 'hard' (fast) | 'good' (richtig) | 'easy' (zu leicht)
 * Gibt eine neue Karte zurück, die alte bleibt unverändert.
 */
export function schedule(card, outcome, now = Date.now()) {
  const c = { ...card, last: now };
  if (c.learning) {
    if (outcome === 'good' || outcome === 'easy') {
      c.learning = false;
      c.reps += 1;
      c.iv = outcome === 'easy' ? 4 : 1;
      c.due = addDays(now, c.iv);
    } else {
      c.due = now; // bleibt fällig und kommt in der Sitzung noch einmal
      if (outcome === 'again') c.ef = Math.max(1.3, c.ef - 0.05);
    }
    return c;
  }
  c.reps += 1;
  if (outcome === 'again') {
    c.lapses += 1;
    c.ef = Math.max(1.3, c.ef - 0.2);
    c.iv = 0;
    c.learning = true;
    c.due = now;
    return c;
  }
  if (outcome === 'hard') {
    c.ef = Math.max(1.3, c.ef - 0.15);
    c.iv = Math.max(1, Math.round(c.iv * 1.2));
  } else if (outcome === 'good') {
    c.iv = Math.max(c.iv + 1, Math.round(c.iv * c.ef));
  } else {
    c.ef = Math.min(3.2, c.ef + 0.15);
    c.iv = Math.max(c.iv + 2, Math.round(c.iv * c.ef * 1.3));
  }
  c.iv = Math.min(365, spread(c.iv));
  c.due = addDays(now, c.iv);
  return c;
}

/** 0 = neu, 1 = in Arbeit, 2 = frisch gelernt, 3 = sitzt, 4 = sitzt fest */
export function strength(card) {
  if (!card) return 0;
  if (card.learning) return 1;
  if (card.iv < 7) return 2;
  if (card.iv < 30) return 3;
  return 4;
}
