import test from 'node:test';
import assert from 'node:assert/strict';
import { moveStepIngredient } from './stepIngredientOrder.js';

test('reorders within a step, moving down and up', () => {
  const map = { 0: [4, 2, 7, 1] };
  assert.deepEqual(moveStepIngredient(map, 0, 0, 0, 2), { 0: [2, 7, 4, 1] });
  assert.deepEqual(moveStepIngredient(map, 0, 3, 0, 0), { 0: [1, 4, 2, 7] });
});

test('does not mutate the input map', () => {
  const map = { 0: [1, 2, 3] };
  moveStepIngredient(map, 0, 0, 0, 2);
  assert.deepEqual(map, { 0: [1, 2, 3] });
});

test('no-op when dropped on itself or with a bad source', () => {
  const map = { 0: [1, 2] };
  assert.equal(moveStepIngredient(map, 0, 1, 0, 1), map);
  assert.equal(moveStepIngredient(map, 0, 5, 0, 0), map);
  assert.equal(moveStepIngredient(map, 3, 0, 0, 0), map);
});

test('moves to another step and drops the emptied source step', () => {
  const map = { 0: [5], 2: [1, 3] };
  assert.deepEqual(moveStepIngredient(map, 0, 0, 2, 1), { 2: [1, 5, 3] });
});

test('moves onto a step with no ingredients yet, clamping past the end', () => {
  const map = { 0: [5, 6] };
  assert.deepEqual(moveStepIngredient(map, 0, 1, 1, 9), { 0: [5], 1: [6] });
});

test('string step keys from Object.entries still count as the same step', () => {
  assert.deepEqual(moveStepIngredient({ 1: [8, 9] }, '1', 0, 1, 1), { 1: [9, 8] });
});
