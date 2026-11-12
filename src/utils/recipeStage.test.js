import test from 'node:test';
import assert from 'node:assert/strict';

import {
  needsAdjustments, adjustmentsOnAddToWeek, recipesToStartFromLog, weekNeedingAdjustments,
} from './recipeStage.js';

test('needsAdjustments: only Work in progress without the tick', () => {
  assert.equal(needsAdjustments({ devStage: 'wip' }), true);
  assert.equal(needsAdjustments({ devStage: 'wip', adjustmentsMade: false }), true);
  assert.equal(needsAdjustments({ devStage: 'wip', adjustmentsMade: true }), false);
  assert.equal(needsAdjustments({ devStage: 'new' }), false);
  assert.equal(needsAdjustments({}), false);
});

test('adding to the week unticks a ticked box, else changes nothing', () => {
  assert.deepEqual(adjustmentsOnAddToWeek({ adjustmentsMade: true }), { adjustmentsMade: false });
  assert.equal(adjustmentsOnAddToWeek({ adjustmentsMade: false }), null);
  assert.equal(adjustmentsOnAddToWeek({}), null);
});

test('a logged recipe with no stage or New moves to Work in progress', () => {
  const recipes = [
    { id: 'a' }, { id: 'b', devStage: 'new' }, { id: 'c', devStage: 'nailed' },
    { id: 'd', devStage: 'wip' }, { id: 'e' }, { id: 'f' },
  ];
  const log = {
    '2026-11-10': { entries: [{ type: 'recipe', recipeId: 'e' }] }, // before the cutoff
    '2026-11-12': { entries: [{ type: 'recipe', recipeId: 'a' }, { type: 'custom_meal', recipeId: 'f' }] },
    '2026-11-14': { entries: [{ type: 'recipe', recipeId: 'b' }, { type: 'recipe', recipeId: 'c' }, { type: 'recipe', recipeId: 'd' }] },
    '2026-11-15': { supplements: [] },
  };
  assert.deepEqual(recipesToStartFromLog(recipes, log, '2026-11-12'), ['a', 'b']);
  assert.deepEqual(recipesToStartFromLog(recipes, null), []);
});

test('the week list: WIP meals still awaiting adjustments, in plan order, once', () => {
  const recipes = [
    { id: '1', title: 'A', devStage: 'wip' },
    { id: '2', title: 'B', devStage: 'wip', adjustmentsMade: true },
    { id: '3', title: 'C', devStage: 'new' },
    { id: '4', title: 'D', devStage: 'wip', adjustmentsMade: false },
  ];
  assert.deepEqual(weekNeedingAdjustments(recipes, ['4', '2', '3', '1', '4', 'gone']).map(r => r.title), ['D', 'A']);
});
