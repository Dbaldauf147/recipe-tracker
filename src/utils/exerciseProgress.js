// Analyzes logged workouts to classify each exercise's recent progress into
// Progressing / Decreasing / Stagnating / No-Baseline (plus the intent-aware
// Deload / Maintaining labels): track estimated 1RM (Epley) and training volume,
// then fit an ordinary-least-squares trend line over the window. Pure logic (no
// React) so it stays testable and reusable; consumed by ExerciseProgressTracker.jsx
// and covered by exerciseProgress.test.js.
//
// Set/weight model (from WorkoutPage): each entry has `sets` (array of rep/time
// strings), a canonical-lb `weight` (or per-set `setWeights` when `useSetWeights`),
// and `perArm` (weight is per side → double it for the total load).
//
// Design notes:
//   * Trend = OLS slope of session-best e1RM vs. time, not a split-window mean
//     comparison. Split windows are unstable — moving one session across the
//     midpoint can flip the label. The slope uses every session.
//   * e1RM is the primary signal; volume is secondary and can only ever UPGRADE
//     a flat e1RM to Progressing. It can never rescue a falling e1RM. Exactly one
//     status is returned — see decideStatus(), the single decision point.

import { parseSetValue } from './setValue.js';

const LB_PER_KG = 2.2046226218;

export const WINDOW_DAYS = 60;          // "past 2 months"
export const MIN_SESSIONS = 4;          // …and this many sessions…
export const MIN_SPAN_DAYS = 21;        // …spread over at least this long → trend
export const PROGRESS_PCT = 0.025;      // ±2.5% projected e1RM change = up/down
export const VOLUME_PCT = 0.05;         // +5% projected volume can upgrade flat → progressing
export const VOLUME_DROP_PCT = 0.10;    // −10% projected volume annotates "volume down"
export const EPLEY_REP_CAP = 10;        // reps fed into Epley are capped here
export const OUTLIER_TOLERANCE = 0.15;  // session e1RM > trailing median +15% → winsorized
export const OUTLIER_LOOKBACK = 5;      // …median taken over this many prior sessions
export const NOISE_R2 = 0.2;            // fits weaker than this…
export const NOISE_PCT = 0.04;          // …and moves smaller than this → forced flat
export const STALE_FALLBACK_DAYS = 14;  // staleness cutoff when cadence is unknown
export const STALE_MIN_DAYS = 10;       // adaptive staleness floor…
export const STALE_MAX_DAYS = 28;       // …and ceiling
export const STALE_INTERVAL_MULT = 2;   // amber past this × the median logging gap

// Exercises where an entered weight is ADDED to bodyweight rather than being the
// whole load (a "+25 lb" weighted pull-up moves bodyweight + 25). Heuristic: the
// data model has no bodyweight flag, so we match on name. An exercise-library row
// may override this explicitly with a `bodyweight` boolean.
const BODYWEIGHT_MOVEMENT_RE =
  /\b(?:pull[\s-]?ups?|chin[\s-]?ups?|dips?|push[\s-]?ups?|press[\s-]?ups?|muscle[\s-]?ups?|pistol\s+squats?|inverted\s+rows?)\b/i;

// ---------------------------------------------------------------- primitives

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Which direction the Δ cell should be coloured for: 'up' | 'down' | 'neutral'.
 *
 * The status alone isn't enough. Volume can promote a lift to Progressing while
 * its e1RM actually ticked down (a flat-but-noisy trend plus rising volume), and
 * painting "−9.4 lb" green reads as a lie about the number right next to it. So
 * only use the status colour when it AGREES with the delta's own sign; otherwise
 * stay neutral and let the "volume up" annotation explain the call.
 *
 * Never returns 'down' for a deload/maintenance dip — that drop is the plan, not
 * bad news, so it stays neutral like Stagnating.
 */
export function deltaTone(status, delta) {
  if (delta == null) return 'neutral';
  const up = delta >= 0;
  if (status === 'progressing') return up ? 'up' : 'neutral';
  if (status === 'decreasing') return up ? 'neutral' : 'down';
  return 'neutral';
}

// Canonical-lb value → the user's display unit, rounded to 0.1.
export function displayWeight(lb, unit) {
  const n = typeof lb === 'number' ? lb : parseFloat(lb);
  if (isNaN(n)) return null;
  const v = unit === 'kg' ? n / LB_PER_KG : n;
  return Math.round(v * 10) / 10;
}

// 'YYYY-MM-DD' → whole days since the epoch, using local midnight. Only ever
// used for differences, so the TZ offset cancels; Math.round absorbs DST shifts.
export function dayIndex(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.round(new Date(y, m - 1, d).getTime() / 86400000);
}

function toKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// YYYY-MM-DD for `days` before `now` (local midnight), for windowing by date key.
function cutoffKey(days, now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return toKey(d);
}

/**
 * Epley estimated 1RM: weight × (1 + reps/30).
 *
 * Reps are capped at EPLEY_REP_CAP (10). Epley is calibrated for low-rep sets;
 * past ~10 reps it inflates fast and unrealistically — a 20-rep set would imply
 * a 1.67× multiplier, so a light high-rep burnout set could outrank a genuine
 * heavy single and fake a PR. Capping the rep input keeps high-rep work from
 * dominating the trend without discarding the set entirely.
 */
export function epley1RM(weightLb, reps) {
  if (!(weightLb > 0) || !(reps > 0)) return 0;
  return weightLb * (1 + Math.min(reps, EPLEY_REP_CAP) / 30);
}

/**
 * Ordinary least-squares fit of y on x, implemented by hand (no stats lib in the
 * project). Returns { slope, intercept, r2 } or null when the fit is undefined
 * (fewer than 2 points, or every x identical → vertical line, no slope).
 */
export function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  const mx = sx / n, my = sy / n;
  let sxy = 0, sxx = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) * (p.x - mx);
  }
  if (sxx === 0) return null; // all points on the same day
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0, ssTot = 0;
  for (const p of points) {
    const fit = intercept + slope * p.x;
    ssRes += (p.y - fit) * (p.y - fit);
    ssTot += (p.y - my) * (p.y - my);
  }
  // A perfectly flat series has zero total variance, leaving R² as 0/0. Report a
  // perfect fit: the line genuinely explains every point. Such a series projects
  // 0% change and classifies Stagnating regardless, so this can't mislabel.
  const r2 = ssTot === 0 ? 1 : clamp(1 - ssRes / ssTot, 0, 1);
  return { slope, intercept, r2 };
}

// ------------------------------------------------------------ session sampling

// Total external lb moved for set `i` of an entry (per-set weight if present,
// ×2 when the logged weight is per-arm/leg).
function setWeightLb(entry, i) {
  let w;
  if (entry.useSetWeights && Array.isArray(entry.setWeights)) {
    w = parseFloat(entry.setWeights[i] || '');
    if (isNaN(w)) w = parseFloat(entry.weight || '');
  } else {
    w = parseFloat(entry.weight || '');
  }
  if (isNaN(w)) w = 0;
  return entry.perArm ? w * 2 : w;
}

export function isBodyweightExercise(name, libraryEntry) {
  if (libraryEntry && typeof libraryEntry.bodyweight === 'boolean') return libraryEntry.bodyweight;
  return BODYWEIGHT_MOVEMENT_RE.test(String(name || ''));
}

/**
 * Reduce one logged entry to a session sample.
 *
 * bestE1rm is the best across ALL sets, not the heaviest-weight set: a lighter
 * set taken for more reps can imply a higher 1RM (135×10 → 180 beats 155×3 → 170).
 *
 * `bodyweightLb` > 0 makes this a bodyweight movement whose external load stacks
 * on top of bodyweight. `forceReps` means it's a bodyweight movement with no known
 * bodyweight — weight math is skipped entirely so it falls back to a rep trend.
 */
function entrySample(entry, { bodyweightLb = 0, forceReps = false } = {}) {
  const sets = Array.isArray(entry.sets) ? entry.sets : [];
  let bestE1rm = 0, volume = 0, maxReps = 0, maxSeconds = 0, hasWeight = false;
  for (let i = 0; i < sets.length; i++) {
    const parsed = parseSetValue(sets[i]);
    if (parsed.kind === 'reps' && parsed.reps > 0) {
      if (parsed.reps > maxReps) maxReps = parsed.reps;
      if (forceReps) continue;
      const load = setWeightLb(entry, i) + bodyweightLb;
      if (load > 0) {
        hasWeight = true;
        const e1 = epley1RM(load, parsed.reps);
        if (e1 > bestE1rm) bestE1rm = e1;
        volume += load * parsed.reps;
      }
    } else if (parsed.kind === 'time' && parsed.seconds > 0) {
      if (parsed.seconds > maxSeconds) maxSeconds = parsed.seconds;
    }
  }
  return { bestE1rm, volume, maxReps, maxSeconds, hasWeight };
}

// Whether an entry has at least one COMPLETED ("green") set — a set the user
// checked off (setDone[i]) that also holds a rep/time value. This is what marks
// an exercise as actually performed vs. merely logged/planned.
function entryHasGreen(entry) {
  const done = Array.isArray(entry.setDone) ? entry.setDone : null;
  if (!done) return false;
  const sets = Array.isArray(entry.sets) ? entry.sets : [];
  for (let i = 0; i < done.length; i++) {
    if (done[i] && parseSetValue(sets[i]).kind !== 'empty') return true;
  }
  return false;
}

// Which metric a session can support. Sessions of different kinds are never
// mixed into one trend (see the discontinuity handling in analyzeExercise).
function sessionKind(s) {
  if (s.hasWeight && s.bestE1rm > 0) return 'load';
  if (s.maxReps > 0) return 'reps';
  if (s.maxSeconds > 0) return 'time';
  return null;
}

const KIND_TO_METRIC = { load: 'e1rm', reps: 'reps', time: 'time' };

/**
 * Clamp implausible session spikes for TREND purposes only. A session whose e1RM
 * sits more than OUTLIER_TOLERANCE above the median of the previous
 * OUTLIER_LOOKBACK sessions is pulled back to that bound, so one mis-typed weight
 * or a fluky single can't tilt the regression. The raw value is kept for display.
 *
 * Requires 3+ prior sessions before it will act — a median over one or two points
 * is too jumpy to trust, and early sessions are exactly where real jumps happen.
 */
export function winsorizeSeries(values) {
  const out = [];
  const flags = [];
  for (let i = 0; i < values.length; i++) {
    const prior = values.slice(Math.max(0, i - OUTLIER_LOOKBACK), i);
    if (prior.length >= 3) {
      const med = median(prior);
      if (med > 0) {
        const cap = med * (1 + OUTLIER_TOLERANCE);
        if (values[i] > cap) { out.push(cap); flags.push(true); continue; }
      }
    }
    out.push(values[i]);
    flags.push(false);
  }
  return { values: out, flags };
}

// ------------------------------------------------------------------- trending

/**
 * Fit a trend over [{ day, value }] and express it as a projected % change across
 * the observed span, measured on the FITTED endpoints rather than the raw first
 * and last sessions (raw endpoints would reintroduce exactly the noise sensitivity
 * the regression exists to remove).
 */
function fitTrend(points) {
  const reg = linearRegression(points.map(p => ({ x: p.day, y: p.value })));
  if (!reg) return null;
  const days = points.map(p => p.day);
  const x0 = Math.min(...days), x1 = Math.max(...days);
  const fitStart = reg.intercept + reg.slope * x0;
  const fitEnd = reg.intercept + reg.slope * x1;
  if (!(fitStart > 0)) return null; // can't express a % change off a non-positive base
  return {
    slope: reg.slope,
    intercept: reg.intercept,
    r2: reg.r2,
    fitStart,
    fitEnd,
    pct: (fitEnd - fitStart) / fitStart,
    spanDays: x1 - x0,
  };
}

// Weak fit + small move = noise. Prefer flat over flip-flopping between labels
// week to week on a series that isn't actually going anywhere.
function isNoise(t) {
  return t.r2 < NOISE_R2 && Math.abs(t.pct) <= NOISE_PCT;
}

export function classifyPrimary(t) {
  if (!t) return 'flat';
  if (isNoise(t)) return 'flat';
  if (t.pct >= PROGRESS_PCT) return 'up';
  if (t.pct <= -PROGRESS_PCT) return 'down';
  return 'flat';
}

export function classifyVolume(t) {
  if (!t) return 'flat';
  if (isNoise(t)) return 'flat';
  if (t.pct >= VOLUME_PCT) return 'up';
  if (t.pct <= -VOLUME_DROP_PCT) return 'down';
  return 'flat';
}

/**
 * THE single decision point: given the primary (e1RM) and secondary (volume)
 * signals, return exactly one status plus any annotations.
 *
 * Rules, in precedence order:
 *   1. The e1RM trend dominates. Up → Progressing, Down → Decreasing.
 *   2. Volume may only UPGRADE a flat e1RM to Progressing. It can never rescue a
 *      falling e1RM (the old code let it, which is how one lifter could satisfy
 *      both "progressing" and "decreasing" at once).
 *   3. Volume moves that don't change the status are surfaced as annotations, so
 *      a sustained volume drop under a flat e1RM is still visible.
 *   4. A declared deload/maintenance intent replaces the two "bad news" labels —
 *      losing e1RM on a planned deload isn't a regression worth flagging.
 *
 * @param {'up'|'down'|'flat'} e1rmSignal
 * @param {'up'|'down'|'flat'} volumeSignal
 * @param {'deload'|'maintenance'|null} intent
 */
export function decideStatus(e1rmSignal, volumeSignal, intent = null) {
  const annotations = [];
  let status;

  if (e1rmSignal === 'up') {
    status = 'progressing';
    if (volumeSignal === 'down') annotations.push('volume-down');
  } else if (e1rmSignal === 'down') {
    status = 'decreasing';
    // Deliberately NOT rescued by volume — only annotated.
    if (volumeSignal === 'up') annotations.push('volume-up');
    if (volumeSignal === 'down') annotations.push('volume-down');
  } else {
    if (volumeSignal === 'up') {
      status = 'progressing';
      annotations.push('volume-up');
    } else {
      status = 'stagnating';
      if (volumeSignal === 'down') annotations.push('volume-down');
    }
  }

  if (intent && (status === 'decreasing' || status === 'stagnating')) {
    status = intent === 'deload' ? 'deload' : 'maintaining';
  }
  return { status, annotations };
}

// ------------------------------------------------------------------- analysis

// Nearest logged bodyweight on or before a date, falling back to the earliest
// known reading. Returns null when there's no bodyweight history at all.
export function makeBodyweightLookup(weightLog) {
  const sorted = (Array.isArray(weightLog) ? weightLog : [])
    .filter(e => e && e.date && Number(e.weight) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (sorted.length === 0) return () => null;
  return (dateStr) => {
    let best = null;
    for (const e of sorted) {
      if (String(e.date) <= String(dateStr)) best = e; else break;
    }
    return Number((best || sorted[0]).weight);
  };
}

function resolveIntent(name, options) {
  const key = String(name || '').trim().toLowerCase();
  const byEx = options.intentByExercise;
  if (byEx) {
    const v = byEx instanceof Map ? byEx.get(key) : byEx[key];
    if (v === 'deload' || v === 'maintenance') return v;
    if (v === 'none' || v === null) return null; // explicit per-exercise opt-out
  }
  const g = options.intent;
  return (g === 'deload' || g === 'maintenance') ? g : null;
}

// Analyze one exercise's history (entries carry a `.date`). Returns a result
// object or null when there's no usable data in the window.
function analyzeExercise(name, group, history, options) {
  const now = options.now || new Date();
  const todayDay = dayIndex(toKey(now));
  const cutoff = cutoffKey(WINDOW_DAYS, now);

  const libEntry = options.libraryByName
    ? (options.libraryByName instanceof Map
      ? options.libraryByName.get(String(name).trim().toLowerCase())
      : options.libraryByName[String(name).trim().toLowerCase()])
    : null;
  const isBw = isBodyweightExercise(name, libEntry);

  // One combined sample per date (a date can hold multiple logged entries).
  // `greenDates` tracks days with a completed (green) set — those are the only
  // ones that count as the exercise "recently happening".
  const byDate = new Map();
  const greenDates = new Set();
  for (const e of history) {
    if (!e.date || e.date < cutoff) continue;
    if (entryHasGreen(e)) greenDates.add(e.date);
    const bw = isBw ? options.bodyweightAt(e.date) : null;
    const s = entrySample(e, {
      bodyweightLb: isBw && bw > 0 ? bw : 0,
      forceReps: isBw && !(bw > 0), // bodyweight movement, unknown bodyweight → reps
    });
    const prev = byDate.get(e.date);
    byDate.set(e.date, prev ? {
      bestE1rm: Math.max(prev.bestE1rm, s.bestE1rm),
      volume: prev.volume + s.volume,
      maxReps: Math.max(prev.maxReps, s.maxReps),
      maxSeconds: Math.max(prev.maxSeconds, s.maxSeconds),
      hasWeight: prev.hasWeight || s.hasWeight,
    } : s);
  }

  const allDates = [...byDate.keys()].sort();
  const usable = [];
  for (const d of allDates) {
    const s = byDate.get(d);
    const kind = sessionKind(s);
    if (kind) usable.push({ ...s, date: d, day: dayIndex(d), kind });
  }
  if (usable.length === 0) return null;

  // Never mix metric types within one trend. If the exercise switched from
  // reps-only to loaded (or to timed holds), that's a data discontinuity, not a
  // trend — restart the window at the switch and only fit the trailing run.
  const lastKind = usable[usable.length - 1].kind;
  let start = usable.length - 1;
  while (start > 0 && usable[start - 1].kind === lastKind) start--;
  const discontinuity = start > 0;
  const run = usable.slice(start);

  const metric = KIND_TO_METRIC[lastKind];
  const primaryOf = (s) => metric === 'e1rm' ? s.bestE1rm : metric === 'reps' ? s.maxReps : s.maxSeconds;
  const raw = run.map(primaryOf);

  // Outlier guard applies to e1RM only; rep counts and hold times are directly
  // observed rather than extrapolated, so they have no formula to inflate.
  const { values: trendValues, flags: winsorFlags } =
    metric === 'e1rm' ? winsorizeSeries(raw) : { values: raw, flags: raw.map(() => false) };

  const series = run.map((s, i) => ({
    date: s.date,
    day: s.day,
    value: raw[i],              // raw — what the UI displays
    trendValue: trendValues[i], // winsorized — what the regression sees
    volume: s.volume,
    winsorized: winsorFlags[i],
  }));

  const n = series.length;
  const best = Math.max(...raw);
  if (!(best > 0)) return null; // nothing measurable (e.g. all-empty sets)
  const last = raw[n - 1];
  const lastDate = greenDates.size ? [...greenDates].sort().pop() : null;

  const firstDay = series[0].day;
  const spanDays = series[n - 1].day - firstDay;
  const daysSinceFirst = todayDay - firstDay;

  // Adaptive staleness: amber once it's been more than 2× this exercise's own
  // median logging gap, floored/capped so a twice-a-week lift isn't amber after
  // 4 days and a once-a-month lift isn't amber-free forever. Below MIN_SESSIONS
  // there's no reliable cadence to infer, so fall back to the old fixed 14 days.
  const gaps = [];
  for (let i = 1; i < series.length; i++) gaps.push(series[i].day - series[i - 1].day);
  const medGap = gaps.length ? median(gaps) : null;
  const staleAfterDays = (n >= MIN_SESSIONS && medGap > 0)
    ? clamp(Math.round(STALE_INTERVAL_MULT * medGap), STALE_MIN_DAYS, STALE_MAX_DAYS)
    : STALE_FALLBACK_DAYS;

  const intent = resolveIntent(name, options);

  const baseResult = {
    name, group, metric, sessions: n, series, best, last, lastDate,
    staleAfterDays, discontinuity, intent,
    spanDays, medianGapDays: medGap,
  };

  // Not enough shape to judge a trend. Two distinct sub-states, so the UI can
  // eventually tell "just started this" apart from "logs it too sparsely".
  if (n < MIN_SESSIONS || spanDays < MIN_SPAN_DAYS) {
    return {
      ...baseResult,
      status: 'nobaseline',
      noBaselineReason: daysSinceFirst < MIN_SPAN_DAYS ? 'new' : 'insufficient',
      baseline: null, recent: last, delta: null, deltaPct: null,
      volDeltaPct: null, declining: false, annotations: [], r2: null, slopePerDay: null,
    };
  }

  const primaryTrend = fitTrend(series.map(p => ({ day: p.day, value: p.trendValue })));
  // Volume is only meaningful for loaded work — a rep or hold trend has no
  // weight to multiply, so there's no secondary signal to read.
  const volumeTrend = metric === 'e1rm'
    ? fitTrend(series.map(p => ({ day: p.day, value: p.volume })))
    : null;

  const e1rmSignal = classifyPrimary(primaryTrend);
  const volumeSignal = classifyVolume(volumeTrend);
  const { status, annotations } = decideStatus(e1rmSignal, volumeSignal, intent);

  return {
    ...baseResult,
    status,
    noBaselineReason: null,
    annotations,
    baseline: primaryTrend ? primaryTrend.fitStart : null,
    recent: primaryTrend ? primaryTrend.fitEnd : last,
    delta: primaryTrend ? primaryTrend.fitEnd - primaryTrend.fitStart : null,
    deltaPct: primaryTrend ? primaryTrend.pct : null,
    volDeltaPct: volumeTrend ? volumeTrend.pct : null,
    r2: primaryTrend ? primaryTrend.r2 : null,
    slopePerDay: primaryTrend ? primaryTrend.slope : null,
    declining: status === 'decreasing',
  };
}

export const STATUS_KEYS = ['progressing', 'decreasing', 'stagnating', 'deload', 'maintaining', 'nobaseline'];

/**
 * workouts:    array of { date, entries:[{ exercise, group, sets, weight, ... }] }
 * groupByName: optional Map(lowercased exercise name → muscle group) for labels.
 * options:
 *   now               Date to treat as "today" (injectable for tests)
 *   weightLog         [{ date, weight }] in lb — enables bodyweight-relative e1RM
 *   intent            global 'deload' | 'maintenance' | null
 *   intentByExercise  Map/object of lowercased name → 'deload' | 'maintenance' | 'none'
 *   libraryByName     Map/object of lowercased name → library row (for `bodyweight`)
 *
 * Returns { progressing, decreasing, stagnating, deload, maintaining, nobaseline },
 * each a sorted array.
 */
export function analyzeProgress(workouts, groupByName, options = {}) {
  const opts = { ...options, bodyweightAt: makeBodyweightLookup(options.weightLog) };

  const byName = {};
  for (const w of (workouts || [])) {
    for (const e of (w.entries || [])) {
      if (!e.exercise) continue;
      const key = e.exercise.trim().toLowerCase();
      if (!byName[key]) byName[key] = { name: e.exercise.trim(), group: e.group || '', entries: [] };
      if (!byName[key].group && e.group) byName[key].group = e.group;
      byName[key].entries.push({ ...e, date: w.date });
    }
  }

  const groups = {};
  for (const k of STATUS_KEYS) groups[k] = [];
  for (const key of Object.keys(byName)) {
    const g = (groupByName && groupByName.get(key)) || byName[key].group || '';
    const r = analyzeExercise(byName[key].name, g, byName[key].entries, opts);
    if (r) groups[r.status].push(r);
  }

  groups.progressing.sort((a, b) => (b.deltaPct || 0) - (a.deltaPct || 0)); // best gain first
  groups.decreasing.sort((a, b) => (a.deltaPct || 0) - (b.deltaPct || 0));  // steepest drop first
  groups.stagnating.sort((a, b) => (a.deltaPct || 0) - (b.deltaPct || 0));
  groups.deload.sort((a, b) => (a.deltaPct || 0) - (b.deltaPct || 0));
  groups.maintaining.sort((a, b) => (a.deltaPct || 0) - (b.deltaPct || 0));
  groups.nobaseline.sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
  return groups;
}
