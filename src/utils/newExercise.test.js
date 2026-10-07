import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNewExercise, parseVideoLinks, validateNewExercise } from './newExercise.js';

test('a name is required', () => {
  assert.match(validateNewExercise({ exercise: '   ' }), /name/);
  assert.equal(validateNewExercise({ exercise: 'Dips' }), '');
});

test('duplicates are caught case-insensitively', () => {
  assert.match(validateNewExercise({ exercise: 'bench press ' }, ['Bench Press', 'Squat']), /"Bench Press" is already/);
});

test('video links split on lines or commas', () => {
  assert.deepEqual(parseVideoLinks('https://a\n\n https://b , https://c'), ['https://a', 'https://b', 'https://c']);
  assert.deepEqual(parseVideoLinks(''), []);
});

test('builds the full library row, trimmed, with a known type only', () => {
  const row = buildNewExercise({
    exercise: ' Incline DB Press ', muscleGroup: 'Chest', exerciseType: 'strength training',
    primaryMuscles: 'Upper chest', videos: 'https://x', top: true,
  });
  assert.equal(row.exercise, 'Incline DB Press');
  assert.equal(row.muscleGroup, 'Chest');
  assert.equal(row.exerciseType, 'Strength Training');
  assert.deepEqual(row.videos, ['https://x']);
  assert.equal(row.top, true);
  assert.equal(row.retired, false);
  assert.equal(row.secondaryMuscles, '');
  assert.ok(!Number.isNaN(Date.parse(row.addedAt)));
  assert.equal(buildNewExercise({ exercise: 'X', exerciseType: 'Cardio' }).exerciseType, '');
});
