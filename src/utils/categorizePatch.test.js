import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizePatch } from './categorizePatch.js';

test('nothing touched → nothing saved', () => {
  assert.deepEqual(categorizePatch({}), {});
});

test('removing the LAST bucket saves an empty list and clears mealType', () => {
  const p = categorizePatch({ buckets: [] });
  assert.deepEqual(p.buckets, []);
  assert.equal('mealType' in p, true);
  assert.equal(p.mealType, undefined);
});

test('removing the LAST category saves an empty list and clears the old field', () => {
  assert.deepEqual(categorizePatch({ cuisines: [] }), { cuisines: [], categories: [] });
});

test('buckets keep mealType in step with the first one', () => {
  assert.deepEqual(categorizePatch({ buckets: ['lunch-dinner', 'drinking'] }), {
    buckets: ['lunch-dinner', 'drinking'], mealType: 'lunch-dinner',
  });
});

test('the other answers still save as before', () => {
  const p = categorizePatch({ status: 'visited', takenJoanne: false, frequency: '' });
  assert.equal(p.status, 'visited');
  assert.equal('takenJoanne' in p && p.takenJoanne === undefined, true);
  assert.equal('frequency' in p && p.frequency === undefined, true);
});
