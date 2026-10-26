// ---- Deload rounds -------------------------------------------------------
//
// Train N weeks, then a DELOAD ROUND: the next session of each deload type
// (Push, Pull, Legs, Full Body by default) is a lighter one — weights drop to a
// % of the latest normal (non-deload) weights, each exercise drops a set COUNT
// (`setCut`, e.g. 1 fewer set), and the reps in each kept set are cut by a %.
// The round lasts as long as it takes to do one of each; the day after the
// last one, the next N-week training block starts. It used to be a fixed
// calendar week, which missed any type you didn't happen to do that week.
//
// The default numbers are Dr. Andy Galpin's: train 5 weeks, then deload at 70%
// of the weight, 1 fewer set and 80% of the reps.
//
// A deload session is saved with `deload: true`. That flag is both what keeps
// it out of 1RM progress and PRs AND what ticks its type off the round — the
// round is worked out from the log every time, never stored, so editing or
// deleting a session puts the round back exactly where the log says.
//
// `anchor` is the 'YYYY-MM-DD' day the current chain of training blocks
// started. Block 1 runs anchor … anchor + 7·trainWeeks − 1; its round starts
// the day after. Later blocks follow from each round's last deload.
//
// Stored on the user doc as `deloadSettings`, shared with the mobile app.
// ⚠️ MIRRORS PrepDay/src/utils/deload.ts — keep the two identical.

/**
 * @typedef {object} DeloadSettings
 * @property {boolean} enabled
 * @property {number} trainWeeks   normal training weeks before each deload round
 * @property {string} anchor       'YYYY-MM-DD' first day of the first training block
 * @property {number} weightPct    deload weight as a % of the normal weight (e.g. 70)
 * @property {number} setCut       sets fewer per exercise during a deload (e.g. 1 → 5 sets become 4; at least 1 kept)
 * @property {number} repCutPct    % fewer reps in each kept set (e.g. 20 → 10 reps become 8, i.e. 80% of usual)
 * @property {string[]} types      workout types that each need one deload session per round
 * @property {Record<string, Record<string, string>>} [roundSkips]
 *   per round (keyed by its start day): type → day it was skipped, for a type
 *   you won't get to this round
 */

/** Deload's own colour (purple) — amber already means "away gym" in the charts. */
export const DELOAD_BG = '#f3e8ff';
export const DELOAD_BORDER = '#c084fc';

/** The workout types a round asks for unless you pick others. */
export const DEFAULT_DELOAD_TYPES = ['Push', 'Pull', 'Legs', 'Full Body'];

const pad2 = (n) => String(n).padStart(2, '0');

function keyOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseKey(k) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
/** 'YYYY-MM-DD' `days` after `key` (calendar days, DST-safe). */
export function addDays(key, days) {
  const d = parseKey(key);
  return d ? keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)) : '';
}
function toKey(date) {
  return typeof date === 'string' ? date.slice(0, 10) : keyOf(date);
}

/** The 'YYYY-MM-DD' Sunday starting the week that contains `date`. */
export function deloadWeekStart(date = new Date()) {
  const d = typeof date === 'string' ? parseKey(date) : date;
  if (!d) return '';
  return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()));
}

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

const typeKey = (t) => String(t || '').trim().toLowerCase();

export function defaultDeloadSettings(now = new Date()) {
  return {
    enabled: false, trainWeeks: 5, anchor: deloadWeekStart(now), weightPct: 70, setCut: 1, repCutPct: 20,
    types: [...DEFAULT_DELOAD_TYPES], roundSkips: {},
  };
}

/** Dr. Andy Galpin's deload: after 5 training weeks, 70% of the weight, 1 fewer set, 80% of the reps. */
export function isRecommendedDeload(s) {
  return s.trainWeeks === 5 && s.weightPct === 70 && s.setCut === 1 && s.repCutPct === 20;
}

// Sets used to be cut by a % (`setCutPct`). A customised % becomes the count
// it took off a 5-set exercise — the example the page has always shown.
const PCT_REFERENCE_SETS = 5;

/** Fill in / clamp whatever was stored (tolerates a missing or partial object). */
export function normalizeDeloadSettings(raw, now = new Date()) {
  const d = defaultDeloadSettings(now);
  if (!raw || typeof raw !== 'object') return d;
  const was = (k, v) => raw[k] == null || Number(raw[k]) === v;
  // Saved before reps could be cut: the untouched old defaults (4 weeks, 60%,
  // 40% fewer sets) move to the recommended ones; anything customised keeps
  // its numbers and gets no rep cut, so it still logs exactly as before.
  if (raw.repCutPct == null) {
    const oldDefaults = was('trainWeeks', 4) && was('weightPct', 60) && was('setCutPct', 40);
    raw = oldDefaults
      ? { ...raw, trainWeeks: d.trainWeeks, weightPct: d.weightPct, setCut: d.setCut, repCutPct: d.repCutPct }
      : { ...raw, repCutPct: 0 };
  }
  // Saved before sets were a count. The previous recommendation untouched
  // (5 weeks, 70%, same sets, half the reps) moves to the current one;
  // otherwise the % becomes a count and everything else is kept.
  if (raw.setCut == null) {
    const prevDefaults = was('trainWeeks', 5) && was('weightPct', 70) && was('setCutPct', 0) && was('repCutPct', 50);
    const pct = Number(raw.setCutPct) || 0;
    raw = prevDefaults
      ? { ...raw, setCut: d.setCut, repCutPct: d.repCutPct }
      : { ...raw, setCut: pct > 0 ? Math.max(1, Math.round((PCT_REFERENCE_SETS * pct) / 100)) : 0 };
  }
  // Types: saved before rounds existed → the defaults. An empty list is kept
  // (it's a choice), duplicates by case are dropped.
  let types = d.types;
  if (Array.isArray(raw.types)) {
    const seen = new Set();
    types = [];
    for (const t of raw.types) {
      const name = String(t || '').trim();
      if (name && !seen.has(typeKey(name))) { seen.add(typeKey(name)); types.push(name); }
    }
  }
  const roundSkips = {};
  if (raw.roundSkips && typeof raw.roundSkips === 'object') {
    for (const r of Object.keys(raw.roundSkips)) {
      const v = raw.roundSkips[r];
      if (!parseKey(r) || !v || typeof v !== 'object') continue;
      const clean = {};
      for (const t of Object.keys(v)) if (parseKey(v[t])) clean[t] = v[t];
      if (Object.keys(clean).length) roundSkips[r] = clean;
    }
  }
  return {
    enabled: !!raw.enabled,
    trainWeeks: clampInt(raw.trainWeeks, 1, 52, d.trainWeeks),
    // Was always a Sunday under the old weekly schedule, which still works:
    // block 1's round then starts on the Sunday the deload week used to.
    anchor: parseKey(raw.anchor) ? raw.anchor : d.anchor,
    weightPct: clampInt(raw.weightPct, 10, 100, d.weightPct),
    setCut: clampInt(raw.setCut, 0, 10, d.setCut),
    repCutPct: clampInt(raw.repCutPct, 0, 90, d.repCutPct),
    types,
    roundSkips,
  };
}

/**
 * Where the deload cycle stands on `date`, worked out from the log.
 *
 *   { phase: 'off' }                                   disabled
 *   { phase: 'training', blockStart, roundStart, week } training; the round
 *                                                      starts on roundStart
 *   { phase: 'round', blockStart, roundStart, done, skipped, pending }
 *       done:    [{ type, date }] deload sessions logged this round
 *       skipped: [type]           skipped for this round
 *       pending: [type]           still to do — their next session is a deload
 *
 * Only sessions on or before `date` count, so a past date reads the way it
 * did then. `opts.excludeId` leaves one session out (the one being edited, so
 * re-saving a deload session doesn't see itself as already done).
 */
export function deloadRound(s, workouts, date = new Date(), opts = {}) {
  if (!s || !s.enabled || !parseKey(s.anchor)) return { phase: 'off' };
  const day = toKey(date);
  const types = s.types || [];
  const logged = (workouts || []).filter(w => w && w.deload && w.date && w.date <= day && (!opts.excludeId || w.id !== opts.excludeId));
  let blockStart = s.anchor;
  for (let guard = 0; guard < 500; guard++) {
    const roundStart = addDays(blockStart, 7 * s.trainWeeks);
    if (day < roundStart) {
      const sinceStart = Math.round((parseKey(day) - parseKey(blockStart)) / 86400000);
      return { phase: 'training', blockStart, roundStart, week: Math.max(1, Math.floor(sinceStart / 7) + 1) };
    }
    const skips = (s.roundSkips || {})[roundStart] || {};
    const done = [];
    const skipped = [];
    const pending = [];
    let last = roundStart;
    for (const t of types) {
      const hit = logged
        .filter(w => w.date >= roundStart && typeKey(w.workoutType) === typeKey(t))
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      const skipDay = Object.keys(skips).find(k => typeKey(k) === typeKey(t));
      if (hit) { done.push({ type: t, date: hit.date }); if (hit.date > last) last = hit.date; }
      else if (skipDay && skips[skipDay] <= day) { skipped.push(t); if (skips[skipDay] > last) last = skips[skipDay]; }
      else pending.push(t);
    }
    if (pending.length) return { phase: 'round', blockStart, roundStart, done, skipped, pending };
    // Round finished on `last`: the next block starts the day after.
    blockStart = addDays(last, 1);
  }
  return { phase: 'off' };
}

/** Is a `type` session on `date` a deload one? (opts as deloadRound) */
export function deloadDueFor(s, workouts, type, date = new Date(), opts = {}) {
  if (!type) return false;
  const r = deloadRound(s, workouts, date, opts);
  return r.phase === 'round' && r.pending.some(t => typeKey(t) === typeKey(type));
}

/** Settings that start a deload round on `date` (block 1 ends the day before). */
export function startRoundOn(s, date = new Date()) {
  return { ...s, anchor: addDays(toKey(date), -7 * s.trainWeeks) };
}

/** Settings with `types` skipped for the round starting `roundStart`, as of `date`. */
export function skipRoundTypes(s, roundStart, types, date = new Date()) {
  const day = toKey(date);
  const cur = { ...((s.roundSkips || {})[roundStart] || {}) };
  for (const t of types) cur[t] = day;
  return { ...s, roundSkips: { ...(s.roundSkips || {}), [roundStart]: cur } };
}

/** Settings with one skip taken back. */
export function unskipRoundType(s, roundStart, type) {
  const cur = { ...((s.roundSkips || {})[roundStart] || {}) };
  for (const k of Object.keys(cur)) if (typeKey(k) === typeKey(type)) delete cur[k];
  const roundSkips = { ...(s.roundSkips || {}) };
  if (Object.keys(cur).length) roundSkips[roundStart] = cur; else delete roundSkips[roundStart];
  return { ...s, roundSkips };
}

/**
 * A weight string scaled to `pct`%, rounded to the nearest 5 (lb — weights are
 * stored in lb) and never below 5. Non-numeric or zero input comes back as is.
 */
export function deloadWeight(weight, pct) {
  const raw = weight == null ? '' : String(weight);
  if (!/^\d+(\.\d+)?$/.test(raw.trim())) return raw;
  const n = parseFloat(raw);
  if (n <= 0) return raw;
  return String(Math.max(5, Math.round((n * pct) / 100 / 5) * 5));
}

/** How many of `n` sets to keep after dropping `cut` of them (at least 1 when n ≥ 1). */
export function deloadSetCount(n, cut) {
  if (n <= 0) return 0;
  return Math.max(1, n - Math.max(0, cut || 0));
}

/**
 * A set's rep count cut by `cutPct`% (at least 1). Only plain rep counts are
 * cut — timed sets ('30s', '1:30') and anything else come back as is.
 */
export function deloadReps(value, cutPct) {
  const raw = value == null ? '' : String(value);
  if (!cutPct || !/^\d+$/.test(raw.trim())) return raw;
  const n = parseInt(raw, 10);
  if (n <= 0) return raw;
  return String(Math.max(1, Math.round(n * (1 - cutPct / 100))));
}

/**
 * A prefilled entry turned into its deload version: weight (and per-set
 * weights) scaled, only the first k filled sets kept — the rest blanked so
 * the row keeps its slot count — and each kept set's reps cut. Body-weight
 * rows keep their weight.
 */
export function applyDeloadToEntry(e, s) {
  const sets = Array.isArray(e.sets) ? e.sets : [];
  const filled = sets.filter(x => String(x ?? '').trim() !== '').length;
  let keep = deloadSetCount(filled, s.setCut);
  const nextSets = sets.map(x => {
    if (String(x ?? '').trim() === '') return x;
    if (keep > 0) { keep--; return deloadReps(x, s.repCutPct || 0); }
    return '';
  });
  const out = { ...e, sets: nextSets };
  if (!e.useBodyWeight) {
    out.weight = deloadWeight(e.weight, s.weightPct);
    if (Array.isArray(e.setWeights)) out.setWeights = e.setWeights.map(w => deloadWeight(w, s.weightPct));
  }
  return out;
}

/** Workouts that count toward 1RM progress / PRs — deload sessions removed. */
export function withoutDeload(workouts) {
  return (workouts || []).filter(w => !w?.deload);
}
