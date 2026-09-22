// Relative strength: what each lift weighs as a multiple of YOUR bodyweight.
//
// The Charts page can already plot est-1RM ÷ bodyweight for one exercise at a
// time (the `e1rmPerBw` metric). This file answers the questions a single line
// can't: where does every lift stand right now, is the ratio moving because the
// LIFT moved or because the SCALE moved, and is a given multiple any good.
//
// Pure logic (no React) so it stays testable — see relativeStrength.test.js.
// Consumed by components/RelativeStrength.jsx.
//
// Two rules carried over from the chart metric, because breaking either makes
// the number lie quietly rather than fail:
//   * Bodyweight movements (pull-ups, dips, push-ups) are excluded. Their load
//     ALREADY contains bodyweight, so the ratio sits near 1 and reads as a
//     plateau rather than as an inapplicable question.
//   * The bodyweight lookup is the STRICT one: null before your first weigh-in,
//     never forward-filled. Dividing lifts logged before you owned a scale by
//     the first weight you ever recorded invents a trend that never happened.

import {
  entryBestE1rmLb, isBodyweightExercise, makeBodyweightLookupStrict, offsiteMarker,
} from './exerciseProgress.js';
import { inferExerciseType } from './exerciseTypes.js';

export const DEFAULT_WINDOW_DAYS = 90;

// Window choices offered in the header. `days: null` = the whole log.
export const WINDOW_OPTIONS = [
  { value: 60, label: 'Last 60 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 180, label: 'Last 6 months' },
  { value: 365, label: 'Last year' },
  { value: 0, label: 'All time' },
];

// ------------------------------------------------------------------ standards
//
// Strength standards as a straight multiple of bodyweight, for the handful of
// lifts the published tables actually cover. These are approximations of the
// widely used ExRx / Strength Level bands, and they are FLAT — the real tables
// vary by bodyweight class (a 130 lb lifter hits 2× bodyweight far sooner than
// a 230 lb one) and by age. Treat a band as a rough neighbourhood, not a grade.
//
// Names are matched conservatively: the barbell lift or nothing. A dumbbell,
// machine, Smith, incline or paused variant is a different lift with different
// numbers, and quietly scoring it against the barbell table would be worse than
// showing no band at all.
export const STANDARD_LEVELS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];

export const STRENGTH_STANDARDS = [
  {
    key: 'bench',
    label: 'Bench Press',
    re: /^(barbell\s+)?(flat\s+)?bench(\s+press)?$/i,
    male: [0.75, 1.0, 1.25, 1.75, 2.0],
    female: [0.4, 0.55, 0.75, 1.0, 1.4],
  },
  {
    key: 'squat',
    label: 'Back Squat',
    re: /^(barbell\s+)?(back\s+)?squat$/i,
    male: [1.0, 1.25, 1.5, 2.25, 2.75],
    female: [0.55, 0.8, 1.05, 1.5, 2.0],
  },
  {
    key: 'deadlift',
    label: 'Deadlift',
    re: /^(barbell\s+)?(conventional\s+)?deadlift$/i,
    male: [1.25, 1.5, 1.75, 2.5, 3.0],
    female: [0.6, 0.95, 1.25, 1.8, 2.4],
  },
  {
    key: 'ohp',
    label: 'Overhead Press',
    re: /^(barbell\s+)?(standing\s+)?(overhead|shoulder|military)\s+press$/i,
    male: [0.5, 0.65, 0.85, 1.15, 1.4],
    female: [0.3, 0.4, 0.55, 0.75, 1.0],
  },
  {
    key: 'row',
    label: 'Barbell Row',
    re: /^(barbell|bent[-\s]?over)\s+row$/i,
    male: [0.65, 0.85, 1.0, 1.4, 1.75],
    female: [0.35, 0.5, 0.65, 0.9, 1.2],
  },
];

/** The standards row for an exercise name, or null when none applies. */
export function matchStandard(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  return STRENGTH_STANDARDS.find(s => s.re.test(n)) || null;
}

/**
 * Where `ratio` falls in a standard's bands.
 *
 * Returns { level, index, next } — `level` is null below the first band (the
 * honest answer for someone still building the movement), `next` is the band
 * above with the ratio needed to reach it, or null at Elite.
 */
export function standardLevel(ratio, standard, sex = 'male') {
  if (!standard || !(ratio > 0)) return null;
  const bands = standard[sex === 'female' ? 'female' : 'male'];
  if (!Array.isArray(bands) || bands.length === 0) return null;
  let index = -1;
  for (let i = 0; i < bands.length; i++) if (ratio >= bands[i]) index = i;
  const next = index + 1 < bands.length
    ? { label: STANDARD_LEVELS[index + 1], ratio: bands[index + 1] }
    : null;
  return {
    index,
    level: index >= 0 ? STANDARD_LEVELS[index] : null,
    next,
    bands,
  };
}

// -------------------------------------------------------------------- helpers

/** Local YYYY-MM-DD for a Date. */
function toKey(date) {
  const pad = v => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The oldest date string still inside a `days`-long window ending today. */
function cutoffKey(days, now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return toKey(d);
}

/** Most recent weigh-in as { lb, date }, or null. Handles kg entries. */
export function latestWeighIn(weightLog) {
  const at = makeBodyweightLookupStrict(weightLog);
  const dates = (Array.isArray(weightLog) ? weightLog : [])
    .filter(e => e && e.date && Number(e.weight) > 0)
    .map(e => String(e.date))
    .sort();
  if (dates.length === 0) return null;
  const date = dates[dates.length - 1];
  const lb = at(date);
  return lb > 0 ? { lb, date } : null;
}

/**
 * Start-vs-end change across a session series, and what drove it.
 *
 * Endpoints are the GEOMETRIC MEAN of the first and last up-to-2 sessions, not
 * single sessions: one bad day at either end shouldn't set the story, and a
 * geometric mean keeps the arithmetic additive in logs, so
 * "ratio change = lift change − bodyweight change" holds exactly instead of
 * approximately.
 *
 * The two drivers are reported separately rather than as shares of the total.
 * When they pull opposite ways — lift up, bodyweight up more — a share is a
 * number over 100% or a negative, which explains nothing. "Lift +6%,
 * bodyweight +9%" explains everything.
 */
export function ratioChange(series) {
  const n = series.length;
  if (n < 2) return null;
  const k = Math.min(2, Math.floor(n / 2));
  const head = series.slice(0, k);
  const tail = series.slice(n - k);
  const gm = (arr, f) => Math.exp(arr.reduce((s, p) => s + Math.log(f(p)), 0) / arr.length);
  const startE1rm = gm(head, p => p.e1rm);
  const endE1rm = gm(tail, p => p.e1rm);
  const startBw = gm(head, p => p.bw);
  const endBw = gm(tail, p => p.bw);
  const startRatio = startE1rm / startBw;
  const endRatio = endE1rm / endBw;
  return {
    startDate: head[0].date,
    endDate: tail[tail.length - 1].date,
    startRatio, endRatio,
    ratioPct: endRatio / startRatio - 1,
    e1rmPct: endE1rm / startE1rm - 1,
    bwPct: endBw / startBw - 1,
  };
}

/**
 * One exercise's per-session ratio series.
 *
 * One point per DATE (the best e1RM of that day's entries, so a lift logged in
 * two blocks isn't two points), and only dates where both numbers are real:
 * a session with no loaded reps has no e1RM, and a session before the first
 * weigh-in has no divisor.
 */
export function buildRatioSeries(history, bodyweightAt) {
  const bestByDate = new Map();
  for (const entry of history || []) {
    const date = entry && entry.date;
    if (!date) continue;
    const e1rm = entryBestE1rmLb(entry);
    if (!(e1rm > 0)) continue;
    const prev = bestByDate.get(date);
    if (!prev || e1rm > prev.e1rm) bestByDate.set(date, { date, e1rm, gym: entry.gym });
  }
  const out = [];
  for (const p of [...bestByDate.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const bw = bodyweightAt(p.date);
    if (!(bw > 0)) continue;
    out.push({ date: p.date, gym: p.gym, e1rm: p.e1rm, bw, ratio: p.e1rm / bw });
  }
  return out;
}

/**
 * Every lift you can express as a multiple of bodyweight, ranked.
 *
 * options: { weightLog, groupByName, typeByName, exerciseLibrary, windowDays,
 *            sex, now }
 *
 * Returns { rows, bodyweight, excluded, hasWeighIns, windowDays }.
 * `rows` is sorted heaviest ratio first.
 */
export function analyzeRelativeStrength(workouts, options = {}) {
  const { weightLog, groupByName, typeByName, windowDays = DEFAULT_WINDOW_DAYS,
    sex = 'male', now = new Date() } = options;
  const bodyweightAt = makeBodyweightLookupStrict(weightLog);
  const bodyweight = latestWeighIn(weightLog);
  const cutoff = windowDays > 0 ? cutoffKey(windowDays, now) : '';

  const byName = {};
  for (const w of (workouts || [])) {
    for (const e of (w.entries || [])) {
      if (!e.exercise) continue;
      const key = e.exercise.trim().toLowerCase();
      if (!byName[key]) byName[key] = { name: e.exercise.trim(), group: e.group || '', entries: [] };
      if (!byName[key].group && e.group) byName[key].group = e.group;
      // Location rides on the workout, not the entry — carried along so the
      // one-off filter below can see it.
      byName[key].entries.push({ ...e, date: w.date, gym: w.gym });
    }
  }

  const rows = [];
  const excluded = { bodyweight: [], noWeighIn: 0, unloaded: 0 };

  for (const key of Object.keys(byName)) {
    const { name, entries } = byName[key];
    const group = (groupByName && groupByName.get(key)) || byName[key].group || '';
    // A stretch has no load to divide, and the user's own exerciseType tag wins
    // over the name guess — same precedence the Progress tab uses.
    const tagged = typeByName && typeByName.get(key);
    const type = tagged || inferExerciseType(name, group);
    if (type === 'Stretching') continue;

    const libraryEntry = options.exerciseLibrary
      ? (options.exerciseLibrary instanceof Map ? options.exerciseLibrary.get(key) : options.exerciseLibrary[key])
      : null;
    if (isBodyweightExercise(name, libraryEntry)) {
      excluded.bodyweight.push(name);
      continue;
    }

    // Marked, never dropped. A day on someone else's equipment stays visible on
    // the chart in its own colour — the same rule the Charts page follows — and
    // is left out of the headline number and the trend below. Deleting it would
    // leave you wondering whether the session was logged at all.
    const offsiteOf = offsiteMarker(entries);
    const all = buildRatioSeries(entries, bodyweightAt)
      .map(p => ({ ...p, offsite: !!offsiteOf(p.gym) }));
    if (all.length === 0) {
      // Either the lift is unloaded (no e1RM) or every session of it predates
      // the first weigh-in. Only the second is worth telling the user about.
      if (entries.some(e => entryBestE1rmLb(e) > 0)) excluded.noWeighIn++;
      else excluded.unloaded++;
      continue;
    }

    const series = cutoff ? all.filter(p => p.date >= cutoff) : all;
    if (series.length === 0) continue;

    // An unfamiliar machine isn't evidence about your strength, so the marked
    // sessions sit out of every number below (see offsiteOf above).
    const scored = series.filter(p => !p.offsite);
    if (scored.length === 0) continue;

    const current = scored[scored.length - 1];
    const best = scored.reduce((a, b) => (b.ratio > a.ratio ? b : a));
    const bestAllTime = all.filter(p => !p.offsite).reduce((a, b) => (b.ratio > a.ratio ? b : a));
    const standard = matchStandard(name);

    rows.push({
      key, name, group,
      series,
      sessions: scored.length,
      current,
      best,
      bestAllTime,
      change: ratioChange(scored),
      standard,
      level: standard ? standardLevel(current.ratio, standard, sex) : null,
    });
  }

  rows.sort((a, b) => b.current.ratio - a.current.ratio || a.name.localeCompare(b.name));
  excluded.bodyweight.sort((a, b) => a.localeCompare(b));

  return {
    rows,
    bodyweight,
    excluded,
    hasWeighIns: !!bodyweight,
    windowDays,
    total: powerliftingTotal(rows),
  };
}

/**
 * Squat + bench + deadlift as one multiple of bodyweight — the number the
 * powerlifting world actually compares. Null unless all three are present, and
 * each leg uses that lift's own best in the window (they're rarely maxed on the
 * same day, and waiting for a day that has all three would show nothing).
 */
export function powerliftingTotal(rows) {
  const want = ['squat', 'bench', 'deadlift'];
  const parts = [];
  for (const k of want) {
    const row = rows.find(r => r.standard && r.standard.key === k);
    if (!row) return null;
    parts.push({ key: k, label: row.standard.label, name: row.name, e1rm: row.best.e1rm, date: row.best.date });
  }
  // Divide by the most recent of those bests' bodyweights: the total is a
  // "where am I now" number, so the freshest divisor is the honest one.
  const latest = want
    .map(k => rows.find(r => r.standard && r.standard.key === k).best)
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop();
  const sum = parts.reduce((s, p) => s + p.e1rm, 0);
  return { sum, bw: latest.bw, ratio: sum / latest.bw, parts };
}
