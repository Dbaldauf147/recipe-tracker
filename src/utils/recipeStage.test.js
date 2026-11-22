import test from 'node:test';
import assert from 'node:assert/strict';

import {
  needsAdjustments, adjustmentsOnAddToWeek, recipesToStartFromLog, weekNeedingAdjustments,
  stageFromLogSince, STAGE_FROM_LOG_SINCE, STAGE_FROM_LOG_SINCE_EVERYONE,
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

test('the week list: WIP meals logged this week awaiting adjustments, in log order, once', () => {
  const recipes = [
    { id: '1', title: 'A', devStage: 'wip' },
    { id: '2', title: 'B', devStage: 'wip', adjustmentsMade: true },
    { id: '3', title: 'C', devStage: 'new' },
    { id: '4', title: 'D', devStage: 'wip', adjustmentsMade: false },
    { id: '5', title: 'E', devStage: 'wip' }, // eaten, but outside the week
    { id: '6', title: 'F', devStage: 'wip' }, // only a custom_meal entry
  ];
  const days = ['2026-11-16', '2026-11-17', '2026-11-18'];
  const log = {
    '2026-11-15': { entries: [{ type: 'recipe', recipeId: '5' }] },
    '2026-11-16': { entries: [{ type: 'recipe', recipeId: '4' }, { type: 'recipe', recipeId: '2' }, { type: 'custom_meal', recipeId: '6' }] },
    '2026-11-17': { entries: [{ type: 'recipe', recipeId: '3' }, { type: 'recipe', recipeId: '1' }, { type: 'recipe', recipeId: 'gone' }] },
    '2026-11-18': { entries: [{ type: 'recipe', recipeId: '4' }] },
    '2026-11-19': { entries: [{ type: 'recipe', recipeId: '5' }] },
  };
  assert.deepEqual(weekNeedingAdjustments(recipes, log, days).map(r => r.title), ['D', 'A']);
  assert.deepEqual(weekNeedingAdjustments(recipes, null, days), []);
  assert.deepEqual(weekNeedingAdjustments(recipes, log, null), []);
});

test('the owner keeps the original start day; everyone else starts later', () => {
  assert.equal(stageFromLogSince('baldaufdan@gmail.com'), STAGE_FROM_LOG_SINCE);
  assert.equal(stageFromLogSince('  BaldaufDan@Gmail.com '), STAGE_FROM_LOG_SINCE);
  assert.equal(stageFromLogSince('someone@example.com'), STAGE_FROM_LOG_SINCE_EVERYONE);
  assert.equal(stageFromLogSince(null), STAGE_FROM_LOG_SINCE_EVERYONE);
  assert.ok(STAGE_FROM_LOG_SINCE_EVERYONE > STAGE_FROM_LOG_SINCE);
});
