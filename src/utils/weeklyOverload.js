// Weekly overload: three week-over-week checks on the training log.
//
//   1. Load    — did each lift's top working weight climb ≥ 3% on the week?
//   2. Volume  — did each muscle group's working sets climb ≥ 10% on the week?
//   3. Dose    — did each muscle group get ≥ 10 working sets in the week?
//                (15–20 is the "advanced" band.)
//
// Weeks are Sun–Sat, the same weeks the Deload schedule and Week Plan use.
// The current week is shown "so far" but never judged — a half-finished week
// would read as a miss every Monday.
//
// Muscle groups are PRIMARY muscles only. A row's `primaryMuscles` column is
// read; `secondaryMuscles` is deliberately ignored, so a bench set counts for
// Chest (and Shoulders if you listed front delts as primary) but never for
// Triceps. An exercise whose primary column is blank falls back to the logged
// group ("Back", "Abs"); a split name like Push/Pull/Legs can't be pinned to a
// muscle, so those exercises are reported as unmapped instead of guessed.
//
// Pure logic (no React) — tested in weeklyOverload.test.js, consumed by
// components/WeeklyOverload.jsx.

import { parseSetValue } from './setValue.js';
import { setWeightLb, detectHomeGym, countsForHomeGym } from './exerciseProgress.js';
import { effectiveExerciseType, inferExerciseType } from './exerciseTypes.js';

export const WEIGHT_TARGET_PCT = 0.03;   // +3% top weight per week
export const VOLUME_TARGET_PCT = 0.10;   // +10% working sets per week
export const MIN_WEEKLY_SETS = 10;       // working sets per muscle per week
export const ADVANCED_MIN_SETS = 15;     // 15–20 = advanced
export const ADVANCED_MAX_SETS = 20;
export const DEFAULT_WEEKS = 8;          // complete weeks looked back over

// Canonical muscle groups, matched against the free-text primary column. The
// whole string is tested against every pattern, so "Pectoralis major, Anterior
// deltoid" lands in Chest AND Shoulders. Order is display order.
export const MUSCLE_GROUPS = [
  { key: 'chest', label: 'Chest', re: /pec|chest/i },
  { key: 'back', label: 'Back (lats & upper)', re: /\blats?\b|latissimus|rhomboid|\bteres\b|(upper|mid|middle)[- ]?back|^\s*back\s*$/i },
  { key: 'traps', label: 'Traps', re: /trap/i },
  { key: 'lowerback', label: 'Lower back', re: /lower[- ]?back|erector|spinae/i },
  { key: 'shoulders', label: 'Shoulders', re: /delt|shoulder/i },
  { key: 'biceps', label: 'Biceps', re: /\bbiceps?\b(?!\s*femoris)|brachialis/i },
  { key: 'triceps', label: 'Triceps', re: /tricep/i },
  { key: 'forearms', label: 'Forearms', re: /forearm|brachiorad|wrist|grip/i },
  { key: 'abs', label: 'Abs & obliques', re: /abdomin|\babs\b|\bcore\b|oblique/i },
  { key: 'quads', label: 'Quads', re: /quad|vastus|rectus femoris/i },
  { key: 'hamstrings', label: 'Hamstrings', re: /hamstring|biceps femoris|semitend|semimemb/i },
  { key: 'glutes', label: 'Glutes', re: /glute|minimus|medius|abductor/i },
  { key: 'adductors', label: 'Adductors', re: /adductor/i },
  { key: 'calves', label: 'Calves', re: /calf|calves|gastroc|soleus/i },
];

/** Canonical muscle-group keys named in a free-text muscle string. */
export function muscleKeysFromText(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  return MUSCLE_GROUPS.filter(g => g.re.test(s)).map(g => g.key);
}

/** The 'YYYY-MM-DD' Sunday of the week holding `date` (Date or key). */
export function weekStartKey(date) {
  let d;
  if (typeof date === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (!m) return '';
    d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    d = new Date(date);
  }
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return keyOf(d);
}

function keyOf(d) {
  const pad = v => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return keyOf(new Date(y, m - 1, d + n));
}

/**
 * Indices of an entry's WORKING sets: a rep count or a timed hold. When any
 * set on the entry is ticked done, only ticked sets count — the unticked ones
 * are the plan, not the work. Entries with no ticks at all (imported history,
 * quick logs) count every filled set.
 */
export function workingSetIndices(entry) {
  const sets = Array.isArray(entry?.sets) ? entry.sets : [];
  const done = Array.isArray(entry?.setDone) ? entry.setDone : [];
  const anyDone = done.some(Boolean);
  const out = [];
  for (let i = 0; i < sets.length; i++) {
    if (anyDone && !done[i]) continue;
    const p = parseSetValue(sets[i]);
    if ((p.kind === 'reps' && p.reps > 0) || (p.kind === 'time' && p.seconds > 0)) out.push(i);
  }
  return out;
}

/** Heaviest load (canonical lb) across an entry's working rep sets; 0 if unloaded. */
export function topWorkingWeightLb(entry) {
  let top = 0;
  for (const i of workingSetIndices(entry)) {
    if (parseSetValue(entry.sets[i]).kind !== 'reps') continue;
    const w = setWeightLb(entry, i);
    if (w > top) top = w;
  }
  return top;
}

/** Sets → 'below' | 'min' | 'advanced' | 'over'. */
export function setBand(sets) {
  if (sets > ADVANCED_MAX_SETS) return 'over';
  if (sets >= ADVANCED_MIN_SETS) return 'advanced';
  if (sets >= MIN_WEEKLY_SETS) return 'min';
  return 'below';
}

/** Nearest earlier week index with a value that isn't a deload week, or -1. */
function prevComparable(values, weeks, idx) {
  for (let j = idx - 1; j >= 0; j--) {
    if (weeks[j].deload) continue;
    if (values[j] > 0) return j;
  }
  return -1;
}

/**
 * options: { exerciseLibrary, weeks (complete weeks, default 8), homeGymOnly
 *            (default true — load check only), now }
 *
 * Returns {
 *   weeks: [{ start, end, current, deload }]   oldest → newest; last = this week
 *   evalIndex                                   last complete week
 *   muscles: [{ key, label, sets[], exercises[] }]
 *   lifts:   [{ name, muscles[], topLb[] }]     per-week top working weight
 *   unmapped:[{ name, group, sets }]            window working sets with no primary muscle
 *   homeGym                                     most-used gym (load check holds to it when homeGymOnly)
 * }
 *
 * Verdicts are computed separately (volumeVerdict / weightVerdict) so the UI
 * can re-judge any week without re-walking the log.
 */
export function analyzeWeeklyOverload(workouts, options = {}) {
  const { exerciseLibrary = [], now = new Date(), homeGymOnly = true } = options;
  const nWeeks = Math.max(2, options.weeks || DEFAULT_WEEKS);

  const thisWeek = weekStartKey(now);
  const weeks = [];
  for (let i = nWeeks; i >= 0; i--) {
    const start = addDays(thisWeek, -7 * i);
    weeks.push({ start, end: addDays(start, 6), current: i === 0, deload: false });
  }
  const indexOf = new Map(weeks.map((w, i) => [w.start, i]));
  const firstKey = weeks[0].start;
  const lastKey = weeks[weeks.length - 1].end;

  const libByName = new Map();
  for (const row of exerciseLibrary || []) {
    const n = String(row?.exercise || '').trim().toLowerCase();
    if (n) libByName.set(n, row);
  }

  const home = detectHomeGym(workouts, { now });
  const homeGym = home ? home.gym : null;
  const loadGym = homeGymOnly ? homeGym : null;

  const muscleSets = new Map(MUSCLE_GROUPS.map(g => [g.key, { sets: weeks.map(() => 0), exercises: new Set() }]));
  const lifts = new Map();     // lower name → { name, muscles:Set, topLb[] }
  const unmapped = new Map();  // lower name → { name, group, sets }

  for (const w of workouts || []) {
    const date = String(w?.date || '');
    if (!date || date < firstKey || date > lastKey) continue;
    const wi = indexOf.get(weekStartKey(date));
    if (wi == null) continue;
    // A week is a deload week when every session in it was logged as one —
    // one "Log normally" day inside a deload week still gets judged.
    if (Array.isArray(w.entries) && w.entries.length > 0) {
      weeks[wi].sessions = (weeks[wi].sessions || 0) + 1;
      if (w.deload) weeks[wi].deloadSessions = (weeks[wi].deloadSessions || 0) + 1;
    }

    for (const e of w.entries || []) {
      const name = String(e?.exercise || '').trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      const lib = libByName.get(lower);
      const group = e.group || lib?.muscleGroup || lib?.group || '';
      const type = lib ? effectiveExerciseType(lib, group) : inferExerciseType(name, group);
      if (type === 'Stretching') continue;

      const working = workingSetIndices(e);
      if (working.length === 0) continue;

      let keys = muscleKeysFromText(lib?.primaryMuscles);
      if (keys.length === 0) keys = muscleKeysFromText(group);

      if (keys.length === 0) {
        const u = unmapped.get(lower) || { name, group, sets: 0 };
        u.sets += working.length;
        unmapped.set(lower, u);
      } else {
        for (const k of keys) {
          const m = muscleSets.get(k);
          m.sets[wi] += working.length;
          m.exercises.add(name);
        }
      }

      // Load check: deload sessions are lighter on purpose and away gyms are
      // different iron, so neither gets to set a lift's weekly top weight.
      if (w.deload || !countsForHomeGym(w, loadGym)) continue;
      const top = topWorkingWeightLb(e);
      if (!(top > 0)) continue;
      const lift = lifts.get(lower) || { name, muscles: new Set(), topLb: weeks.map(() => 0) };
      for (const k of keys) lift.muscles.add(k);
      if (top > lift.topLb[wi]) lift.topLb[wi] = top;
      lifts.set(lower, lift);
    }
  }

  for (const wkObj of weeks) {
    wkObj.deload = wkObj.sessions > 0 && wkObj.deloadSessions === wkObj.sessions;
    delete wkObj.sessions;
    delete wkObj.deloadSessions;
  }

  const labelOf = new Map(MUSCLE_GROUPS.map(g => [g.key, g.label]));
  return {
    weeks,
    evalIndex: weeks.length - 2,
    homeGym,
    muscles: MUSCLE_GROUPS
      .map(g => ({ key: g.key, label: g.label, sets: muscleSets.get(g.key).sets, exercises: [...muscleSets.get(g.key).exercises].sort() }))
      .filter(m => m.sets.some(s => s > 0)),
    lifts: [...lifts.values()].map(l => ({
      name: l.name,
      muscles: [...l.muscles].map(k => labelOf.get(k)),
      topLb: l.topLb,
    })),
    unmapped: [...unmapped.values()].filter(u => u.sets > 0).sort((a, b) => b.sets - a.sets),
  };
}

/**
 * Week `idx` against the nearest earlier non-deload week that had sets.
 * status: 'hit' (≥ +10%) | 'miss' | 'new' (nothing to compare) | 'none'
 * (no sets this week) | 'deload'.
 */
export function volumeVerdict(sets, weeks, idx) {
  const cur = sets[idx] || 0;
  const band = setBand(cur);
  if (weeks[idx]?.deload) return { status: 'deload', cur, band, prev: null, pct: null };
  if (cur === 0) return { status: 'none', cur, band, prev: null, pct: null };
  const p = prevComparable(sets, weeks, idx);
  if (p < 0) return { status: 'new', cur, band, prev: null, pct: null };
  const prev = sets[p];
  const pct = cur / prev - 1;
  return { status: pct >= VOLUME_TARGET_PCT - 1e-9 ? 'hit' : 'miss', cur, band, prev, prevIndex: p, pct };
}

/**
 * Week `idx`'s top weight against the last earlier week the lift was done.
 * A gap of several weeks is judged per week (compounded), so a lift you train
 * every other week needs ~6.1% over the fortnight, not 3%.
 *
 * status: 'hit' | 'up' (gained, under 3%/wk) | 'flat' | 'down' | 'new' |
 * 'none' (not done that week) | 'deload'.
 */
export function weightVerdict(topLb, weeks, idx) {
  const cur = topLb[idx] || 0;
  if (weeks[idx]?.deload) return { status: 'deload', cur };
  if (!(cur > 0)) return { status: 'none', cur };
  const p = prevComparable(topLb, weeks, idx);
  if (p < 0) return { status: 'new', cur };
  const prev = topLb[p];
  const gap = idx - p;
  const pct = cur / prev - 1;
  const weeklyPct = Math.pow(cur / prev, 1 / gap) - 1;
  const status = weeklyPct >= WEIGHT_TARGET_PCT - 1e-9 ? 'hit'
    : pct > 1e-9 ? 'up'
      : pct < -1e-9 ? 'down' : 'flat';
  return { status, cur, prev, prevIndex: p, gap, pct, weeklyPct };
}

/**
 * Average weekly change in top weight from the first to the last week the lift
 * was done up to `idx` (compounded), or null with fewer than two weeks.
 */
export function averageWeeklyWeightPct(topLb, weeks, idx) {
  let first = -1, last = -1;
  for (let j = 0; j <= idx; j++) {
    if (weeks[j].deload || !(topLb[j] > 0)) continue;
    if (first < 0) first = j;
    last = j;
  }
  if (first < 0 || last <= first) return null;
  return Math.pow(topLb[last] / topLb[first], 1 / (last - first)) - 1;
}
