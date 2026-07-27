// Exercise "type" — the discipline the picker asks about BEFORE the muscle
// group: is this a strength-training movement or a stretch / mobility drill?
//
// Stored per exercise as `exerciseType` on the exerciseLibrary rows (and
// mirrored onto customExercises entries), so it round-trips to the mobile app
// through the same user-doc fields. Untagged exercises fall back to a
// name-based guess rather than disappearing from the picker — see
// inferExerciseType. Mirrored on mobile in src/constants/workouts.ts; keep the
// two lists and the regex in sync.

export const EXERCISE_TYPES = ['Strength Training', 'Stretching'];
export const DEFAULT_EXERCISE_TYPE = 'Strength Training';

const STRETCH_NAME_RE = /stretch|mobility|foam roll|myofascial|yoga|vinyasa|pilates|\bflow\b|\bpose\b|cat[- ]?cow|downward dog|pigeon|hip opener|limber/i;
const STRETCH_GROUPS = new Set(['yoga']);

/** Coerce a stored value to one of EXERCISE_TYPES, or '' if it isn't one. */
export function normalizeExerciseType(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  return EXERCISE_TYPES.find(t => t.toLowerCase() === s) || '';
}

/** Best guess for an exercise that predates the `exerciseType` field. */
export function inferExerciseType(name, muscleGroup) {
  if (STRETCH_NAME_RE.test(String(name || ''))) return 'Stretching';
  if (STRETCH_GROUPS.has(String(muscleGroup || '').trim().toLowerCase())) return 'Stretching';
  return DEFAULT_EXERCISE_TYPE;
}

/**
 * Resolved type for a library row / custom-exercise entry. `muscleGroup` is
 * passed separately because library rows keep the muscle group in
 * `muscleGroup` while custom entries and the row's legacy `group` field don't
 * agree — callers already know the effective group, so they hand it in.
 */
export function effectiveExerciseType(row, muscleGroup) {
  return (
    normalizeExerciseType(row?.exerciseType) ||
    inferExerciseType(row?.exercise ?? row?.name, muscleGroup ?? row?.muscleGroup)
  );
}
