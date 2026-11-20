import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exerciseMatchRank, searchExercises, hasExactExercise } from './exerciseSearch.js';

const S = 'Strength Training';
const items = [
  { name: 'Bench Press', group: 'Chest', exType: S },
  { name: 'Incline Bench Press', group: 'Chest', exType: S },
  { name: 'Overhead Press', group: 'Shoulders', exType: S },
  { name: 'DB Hammer Curl', group: 'Biceps', exType: S },
  { name: 'Barbell Curl', group: 'Biceps', exType: S },
  { name: 'Pigeon Pose', group: 'Hips', exType: 'Stretching' },
  { name: 'Warm up', group: 'Chest', exType: S },
  { name: 'Warm up', group: 'Back', exType: S },
  { name: 'Warm up', group: 'Chest', exType: S },
];

test('rank: prefix, then word start, then anywhere, then all words in any order', () => {
  assert.equal(exerciseMatchRank('Bench Press', 'ben'), 0);
  assert.equal(exerciseMatchRank('Incline Bench Press', 'ben'), 1);
  assert.equal(exerciseMatchRank('Bench Press', 'ench'), 2);
  assert.equal(exerciseMatchRank('DB Hammer Curl', 'curl hammer'), 3);
  assert.equal(exerciseMatchRank('DB Hammer Curl', 'db  curl'), 3);
  assert.equal(exerciseMatchRank('Bench Press', 'squat'), null);
  assert.equal(exerciseMatchRank('Bench Press', '   '), null);
});

test('search: best matches first, shorter names before longer at the same rank', () => {
  assert.deepEqual(searchExercises(items, 'press').map(i => i.name), ['Bench Press', 'Overhead Press', 'Incline Bench Press']);
  assert.deepEqual(searchExercises(items, 'BEN').map(i => i.name), ['Bench Press', 'Incline Bench Press']);
  assert.deepEqual(searchExercises(items, 'curl').map(i => i.name), ['Barbell Curl', 'DB Hammer Curl']);
  assert.deepEqual(searchExercises(items, 'pigeon').map(i => [i.group, i.exType]), [['Hips', 'Stretching']]);
  assert.deepEqual(searchExercises(items, 'zzz'), []);
  assert.equal(searchExercises(items, 'e', 2).length, 2);
});

test('search: the same name in two groups shows once per group', () => {
  assert.deepEqual(searchExercises(items, 'warm').map(i => i.group), ['Back', 'Chest']);
});

test('exact: any case, surrounding spaces ignored', () => {
  assert.equal(hasExactExercise(items, '  bench press '), true);
  assert.equal(hasExactExercise(items, 'bench'), false);
  assert.equal(hasExactExercise(items, ''), false);
});
