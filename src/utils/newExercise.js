// The "add a new exercise" form's rules, kept out of the component so they can
// be tested: what's required, what counts as a duplicate, and the exact row
// shape the exercise library stores (mirrors blankExercise in ExerciseLibrary).

import { normalizeExerciseType } from './exerciseTypes.js';

/** Video links as typed: one per line or comma-separated, blanks dropped. */
export function parseVideoLinks(text) {
  return String(text || '')
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** An error message for the form, or '' when it can be saved. */
export function validateNewExercise(values, existingNames = []) {
  const name = String(values?.exercise || '').trim();
  if (!name) return 'Give the exercise a name.';
  const lower = name.toLowerCase();
  const dup = existingNames.find(n => String(n || '').trim().toLowerCase() === lower);
  if (dup) return `"${String(dup).trim()}" is already in your exercises.`;
  return '';
}

/** The library row for the form's values. */
export function buildNewExercise(values) {
  const t = (k) => String(values?.[k] || '').trim();
  return {
    exercise: t('exercise'),
    primaryMuscles: t('primaryMuscles'),
    secondaryMuscles: t('secondaryMuscles'),
    group: '',
    muscleGroup: t('muscleGroup'),
    exerciseType: normalizeExerciseType(values?.exerciseType),
    thisWeek: 0,
    lastWeek: 0,
    alternative: t('alternative'),
    top: !!values?.top,
    nickname: t('nickname'),
    retired: false,
    videos: parseVideoLinks(values?.videos),
    addedAt: new Date().toISOString(),
  };
}
