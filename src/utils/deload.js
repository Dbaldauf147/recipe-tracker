// ---- Deload weeks --------------------------------------------------------
//
// Train N weeks, then take one lighter week: suggested weights drop to a % of
// the latest normal (non-deload) weights, and the suggested sets and reps are
// each cut by a %. The default is Dr. Andy Galpin's recommendation: train 5
// weeks, then deload at 70% of the weight and half the reps (same sets).
// A workout logged in that week is saved with `deload: true`, and that flag —
// not the schedule — is what keeps it out of 1RM progress and PRs, so
// changing the schedule later never re-labels old sessions.
//
// Weeks are the app's Sunday→Saturday weeks. The schedule counts from
// `anchor`, the Sunday of the first TRAINING week of a cycle: with
// trainWeeks = 4, weeks 0-3 are normal and week 4 is the deload, then repeat.
//
// Stored on the user doc as `deloadSettings`, shared with the mobile app.
// ⚠️ MIRRORS PrepDay/src/utils/deload.ts — keep the two identical.

/**
 * @typedef {object} DeloadSettings
 * @property {boolean} enabled
 * @property {number} trainWeeks   normal training weeks between deloads
 * @property {string} anchor       'YYYY-MM-DD' Sunday starting the first training week of a cycle
 * @property {number} weightPct    deload weight as a % of the normal weight (e.g. 70)
 * @property {number} setCutPct    % fewer sets during a deload (e.g. 40 → 5 sets become 3)
 * @property {number} repCutPct    % fewer reps in each kept set (e.g. 50 → 8 reps become 4)
 * @property {Record<string, boolean>} [overrides] per-week override keyed by its Sunday: true = deload, false = normal
 */

const pad2 = (n) => String(n).padStart(2, '0');
const DAY_MS = 86400000;

function keyOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseKey(k) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** The 'YYYY-MM-DD' Sunday starting the week that contains `date`. */
export function deloadWeekStart(date = new Date()) {
  const d = typeof date === 'string' ? parseKey(date) : date;
  if (!d) return '';
  return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()));
}

/** Whole weeks from Sunday `a` to Sunday `b` (DST-safe via rounding). */
function weeksBetween(a, b) {
  const da = parseKey(a), db = parseKey(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / (7 * DAY_MS));
}

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

export function defaultDeloadSettings(now = new Date()) {
  return { enabled: false, trainWeeks: 5, anchor: deloadWeekStart(now), weightPct: 70, setCutPct: 0, repCutPct: 50, overrides: {} };
}

/** Dr. Andy Galpin's deload: every 6th week (after 5 training weeks), 70% of the weight, half the reps, same sets. */
export function isRecommendedDeload(s) {
  return s.trainWeeks === 5 && s.weightPct === 70 && s.setCutPct === 0 && s.repCutPct === 50;
}

/** Fill in / clamp whatever was stored (tolerates a missing or partial object). */
export function normalizeDeloadSettings(raw, now = new Date()) {
  const d = defaultDeloadSettings(now);
  if (!raw || typeof raw !== 'object') return d;
  const overrides = {};
  if (raw.overrides && typeof raw.overrides === 'object') {
    for (const k of Object.keys(raw.overrides)) {
      if (parseKey(k) && typeof raw.overrides[k] === 'boolean') overrides[k] = raw.overrides[k];
    }
  }
  // Saved before reps could be cut: the untouched old defaults (4 weeks, 60%,
  // 40% fewer sets) move to the new recommended ones; anything customised
  // keeps its numbers and gets no rep cut, so it still logs exactly as before.
  if (raw.repCutPct == null) {
    const was = (k, v) => raw[k] == null || Number(raw[k]) === v;
    const oldDefaults = was('trainWeeks', 4) && was('weightPct', 60) && was('setCutPct', 40);
    raw = oldDefaults
      ? { ...raw, trainWeeks: d.trainWeeks, weightPct: d.weightPct, setCutPct: d.setCutPct, repCutPct: d.repCutPct }
      : { ...raw, repCutPct: 0 };
  }
  return {
    enabled: !!raw.enabled,
    trainWeeks: clampInt(raw.trainWeeks, 1, 52, d.trainWeeks),
    anchor: parseKey(raw.anchor) ? deloadWeekStart(raw.anchor) : d.anchor,
    weightPct: clampInt(raw.weightPct, 10, 100, d.weightPct),
    setCutPct: clampInt(raw.setCutPct, 0, 90, d.setCutPct),
    repCutPct: clampInt(raw.repCutPct, 0, 90, d.repCutPct),
    overrides,
  };
}

/** What the schedule alone says about the week containing `date` (no override). */
export function scheduledDeload(s, date = new Date()) {
  const w = weeksBetween(s.anchor, deloadWeekStart(date));
  if (w == null || w < 0) return false;
  return w % (s.trainWeeks + 1) === s.trainWeeks;
}

/** Is the week containing `date` a deload week? Off entirely when disabled. */
export function isDeloadWeek(s, date = new Date()) {
  if (!s || !s.enabled) return false;
  const wk = deloadWeekStart(date);
  const o = s.overrides?.[wk];
  if (typeof o === 'boolean') return o;
  return scheduledDeload(s, wk);
}

/** The next `count` deload weeks' Sundays, starting with the week containing `from`. */
export function upcomingDeloadWeeks(s, from = new Date(), count = 3) {
  const out = [];
  if (!s.enabled) return out;
  const start = parseKey(deloadWeekStart(from));
  for (let i = 0; i < 260 && out.length < count; i++) {
    const wk = keyOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * i));
    if (isDeloadWeek(s, wk)) out.push(wk);
  }
  return out;
}

/** Set (or clear, when it matches the schedule) the override for one week. */
export function withWeekOverride(s, weekSunday, deload) {
  const overrides = { ...(s.overrides || {}) };
  if (scheduledDeload(s, weekSunday) === deload) delete overrides[weekSunday];
  else overrides[weekSunday] = deload;
  return { ...s, overrides };
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

/** How many of `n` sets to keep after cutting `cutPct`% (at least 1 when n ≥ 1). */
export function deloadSetCount(n, cutPct) {
  if (n <= 0) return 0;
  return Math.max(1, Math.round(n * (1 - cutPct / 100)));
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
  let keep = deloadSetCount(filled, s.setCutPct);
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
