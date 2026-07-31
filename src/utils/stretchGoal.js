// Per-region stretch goal.
//
// The goal is an amount of TIME held per muscle group over a rolling window —
// "10 minutes of legs this week" — rather than a session or rep count, because
// that's the unit stretching is actually dosed in.
//
// The board is a FIXED set of the seven main muscle groups of the body, so it
// reads as "am I covering my whole body?" rather than "what did I happen to
// tag?". The app's own muscle groups are finer than that (Biceps / Triceps /
// Forearms are all Arms) and coarser in one place (nothing maps to Hips/Glutes
// at all), so entries are folded into a region by stretchRegionFor.
//
// Time comes from the duration cells the stretch player writes ("40s"), summed
// via each entry's totalSeconds. A stretch logged by hand with a duration in a
// set cell counts too; one logged with plain rep counts contributes nothing,
// which is correct — there's no time in it to count.
//
// MIRRORED from the mobile app's src/utils/stretchGoal.ts — change both.
// (stretchEntriesByRegion is web-only so far: it feeds the breakdown popup the
// board opens on click, which the mobile board doesn't have. The filters it
// applies are the ones the mirrored totals have always used — they're now
// summed from it — so the two apps still agree on what counts.)

export const DEFAULT_STRETCH_GOAL_MIN = 10;
export const STRETCH_GOAL_WINDOW_DAYS = 7;
export const MIN_GOAL_MIN = 1;
export const MAX_GOAL_MIN = 120;

export function clampGoalMin(n, fallback = DEFAULT_STRETCH_GOAL_MIN) {
  const v = Math.round(Number(n));
  if (!isFinite(v) || v <= 0) return fallback;
  return Math.min(MAX_GOAL_MIN, Math.max(MIN_GOAL_MIN, v));
}

/** The seven regions the board always shows, head to toe. */
export const STRETCH_REGIONS = [
  'Chest',
  'Back',
  'Shoulders',
  'Arms',
  'Abdominals',
  'Hips/Glutes',
  'Legs',
];

// The app's muscle group → region. Covers the groups the picker offers plus the
// finer names that show up in imported / hand-typed library rows.
const REGION_BY_GROUP = {
  chest: 'Chest', pecs: 'Chest',
  back: 'Back', lats: 'Back', 'upper back': 'Back', 'lower back': 'Back',
  traps: 'Back', spine: 'Back',
  shoulders: 'Shoulders', shoulder: 'Shoulders', delts: 'Shoulders',
  deltoids: 'Shoulders', neck: 'Shoulders',
  arms: 'Arms', biceps: 'Arms', triceps: 'Arms', forearms: 'Arms', wrists: 'Arms',
  abs: 'Abdominals', abdominals: 'Abdominals', core: 'Abdominals', obliques: 'Abdominals',
  'hips/glutes': 'Hips/Glutes', hips: 'Hips/Glutes', glutes: 'Hips/Glutes',
  'hip flexors': 'Hips/Glutes',
  legs: 'Legs', quads: 'Legs', quadriceps: 'Legs', hamstrings: 'Legs',
  calves: 'Legs', ankles: 'Legs', adductors: 'Legs',
};

// Hip and glute work has no muscle group of its own in this app — it gets filed
// under Legs (or Yoga) — so the pose name is the only signal for that region,
// and it deliberately OVERRIDES the tagged group. Nothing else does.
const HIPS_RE = /pigeon|piriformis|figure\s*(4|four)|90\s*\/\s*90|couch stretch|\bhips?\b|glute|frog|butterfly|happy baby|lizard|groin|psoas|iliotibial|\bit ?band\b/i;

// Fallback for entries whose group says nothing about the body — Yoga, Whole
// Body, Cardio, Heat, or no group at all. Ordered: the first hit wins, so the
// specific names sit above the generic body words.
const REGION_BY_NAME = [
  [/tricep|bicep|forearm|wrist|\barms?\b/i, 'Arms'],
  [/hamstring|quad(ricep)?|calf|calves|shin|ankle|achilles|\bsplits?\b|downward dog|toe touch|forward fold/i, 'Legs'],
  [/oblique|\babs?\b|abdominal|side bend|core/i, 'Abdominals'],
  [/pec\b|chest|doorway|cobra|sphinx|upward dog/i, 'Chest'],
  [/shoulder|delt|neck|sleeper stretch|cross[- ]?body|eagle arm/i, 'Shoulders'],
  [/\bback\b|lats?\b|spinal|spine|thoracic|child'?s pose|cat[- ]?cow|twist|rhomboid|trap\b/i, 'Back'],
];

/**
 * The region an entry belongs to, or '' when nothing about it says where on the
 * body it lands (a "Whole Body Flow" with no clearer signal). Untattributable
 * time is left out of the board rather than being dumped into a wrong row.
 */
export function stretchRegionFor(exerciseName, group) {
  const name = String(exerciseName || '');
  if (HIPS_RE.test(name)) return 'Hips/Glutes';
  const byGroup = REGION_BY_GROUP[String(group || '').trim().toLowerCase()];
  if (byGroup) return byGroup;
  for (const [re, region] of REGION_BY_NAME) if (re.test(name)) return region;
  return '';
}

/** YYYY-MM-DD `days` before `today` (inclusive window start). */
export function windowStartDate(today, days = STRETCH_GOAL_WINDOW_DAYS) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The individual entries behind each region, newest first — what a region's
 * number is actually made of, for the breakdown popup on the board.
 *
 * `isStretch(exerciseName)` decides what counts — the caller passes it because
 * only it knows the user's exerciseType tagging. Entries whose exercise isn't a
 * stretch are skipped entirely, so a 3-minute plank in the same session doesn't
 * inflate the Abdominals stretch total.
 */
export function stretchEntriesByRegion(workouts, isStretch, today = new Date(), windowDays = STRETCH_GOAL_WINDOW_DAYS) {
  const start = windowStartDate(today, windowDays);
  const out = {};
  for (const w of workouts || []) {
    if (!w?.date || w.date < start) continue;
    for (const e of w.entries || []) {
      const name = String(e?.exercise || '').trim();
      if (!name || !isStretch(name)) continue;
      const seconds = Number(e?.totalSeconds) || 0;
      if (seconds <= 0) continue;
      const region = stretchRegionFor(name, e?.group);
      if (!region) continue;
      (out[region] = out[region] || []).push({ date: w.date, exercise: name, group: e?.group || '', seconds });
    }
  }
  // Newest first; within a day the longest hold leads.
  for (const region of Object.keys(out)) {
    out[region].sort((a, b) => (a.date === b.date ? b.seconds - a.seconds : b.date.localeCompare(a.date)));
  }
  return out;
}

/**
 * Seconds of stretching per region inside the window. Summed from the entries
 * above rather than walked separately, so the number on the board and the list
 * behind it can never disagree about what counted.
 */
export function stretchSecondsByRegion(workouts, isStretch, today = new Date(), windowDays = STRETCH_GOAL_WINDOW_DAYS) {
  const byRegion = stretchEntriesByRegion(workouts, isStretch, today, windowDays);
  const out = {};
  for (const region of Object.keys(byRegion)) {
    out[region] = byRegion[region].reduce((total, e) => total + e.seconds, 0);
  }
  return out;
}

/**
 * Progress rows for display — always all seven regions, in body order, so a
 * region you've neglected shows as an empty bar instead of being missing.
 */
export function stretchGoalProgress(secondsByRegion, goalMin = DEFAULT_STRETCH_GOAL_MIN) {
  const goalSeconds = clampGoalMin(goalMin) * 60;
  return STRETCH_REGIONS.map(group => {
    const seconds = (secondsByRegion || {})[group] || 0;
    return {
      group,
      seconds,
      goalSeconds,
      pct: goalSeconds > 0 ? Math.min(1, seconds / goalSeconds) : 0,
      met: seconds >= goalSeconds,
    };
  });
}

/** "8m", "8m 30s", "45s" — compact enough for a progress row. */
export function formatStretchDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  if (rem === 0) return `${m}m`;
  return `${m}m ${rem}s`;
}
