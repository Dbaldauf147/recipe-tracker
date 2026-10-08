import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillMealGapsFromVisits, slotsForSpot, slotTaken } from './visitMealFill.js';

let n = 0;
const id = () => `e${++n}`;
const spots = [
  { id: 'diner', name: 'Early Bird Diner', buckets: ['breakfast'] },
  { id: 'taco', name: 'Taco Spot', buckets: ['lunch-dinner'] },
  { id: 'brunch', name: 'Brunch Hall', buckets: ['lunch-dinner', 'breakfast'] },
  { id: 'cafe', name: 'Corner Coffee', buckets: ['coffee'] },
  { id: 'legacy', name: 'Old Pub', mealType: 'lunch-dinner' },
];
const visit = (placeId, date) => ({ placeId, date, amount: 20, merchant: 'X' });

test('slots come from the buckets; coffee and unsorted fill nothing', () => {
  assert.deepEqual(slotsForSpot(spots[0]), ['breakfast']);
  assert.deepEqual(slotsForSpot(spots[1]), ['lunch', 'dinner']);
  assert.deepEqual(slotsForSpot(spots[2]), ['breakfast', 'lunch', 'dinner']);
  assert.deepEqual(slotsForSpot(spots[3]), []);
  assert.deepEqual(slotsForSpot(spots[4]), ['lunch', 'dinner']);
  assert.deepEqual(slotsForSpot({ id: 'x', name: 'X' }), []);
});

test('a breakfast spot fills an empty breakfast as a place-only eating-out meal', () => {
  const { log, changed, filled } = fillMealGapsFromVisits({}, { t1: visit('diner', '2026-10-05') }, spots, id);
  assert.equal(changed, true);
  assert.deepEqual(filled.map(f => f.slot), ['breakfast']);
  const e = log['2026-10-05'].entries[0];
  assert.equal(e.recipeName, 'Early Bird Diner');
  assert.equal(e.mealSlot, 'breakfast');
  assert.equal(e.eatingOut, true);
  assert.equal(e.restaurantId, 'diner');
  assert.equal(e.fromVisit, 't1');
  assert.deepEqual(e.nutrition, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  assert.deepEqual(log['2026-10-05'].visitsApplied, ['t1']);
});

test('lunch-dinner fills lunch, or dinner when lunch is taken — never overwrites', () => {
  const day = { entries: [{ id: 'mine', mealSlot: 'lunch', recipeName: 'Salad' }] };
  const { log } = fillMealGapsFromVisits({ '2026-10-05': day }, { t1: visit('taco', '2026-10-05') }, spots, id);
  const entries = log['2026-10-05'].entries;
  assert.equal(entries[0].recipeName, 'Salad');
  assert.equal(entries[1].mealSlot, 'dinner');
});

test('nothing to fill when the slots are taken, skipped, or the day is skipped', () => {
  const full = { entries: [{ id: 'a', mealSlot: 'lunch' }, { id: 'b', mealSlot: 'dinner', autoSuggested: true }] };
  assert.equal(fillMealGapsFromVisits({ d: full, '2026-10-05': full }, { t1: visit('taco', '2026-10-05') }, spots, id).changed, false);
  const skipped = { entries: [], skippedMeals: ['breakfast'] };
  assert.equal(fillMealGapsFromVisits({ '2026-10-05': skipped }, { t1: visit('diner', '2026-10-05') }, spots, id).changed, false);
  assert.equal(slotTaken({ daySkipped: true, entries: [] }, 'dinner'), true);
});

test('the "eating out — pick a place" placeholder is a gap: filled, mark cleared', () => {
  const day = { entries: [], eatingOutMeals: ['lunch', 'dinner'] };
  const { log } = fillMealGapsFromVisits({ '2026-10-05': day }, { t1: visit('taco', '2026-10-05') }, spots, id);
  assert.equal(log['2026-10-05'].entries[0].mealSlot, 'lunch');
  assert.deepEqual(log['2026-10-05'].eatingOutMeals, ['dinner']);
});

test('a visit is used once: deleting its meal does not bring it back', () => {
  const day = { entries: [], visitsApplied: ['t1'] };
  const res = fillMealGapsFromVisits({ '2026-10-05': day }, { t1: visit('taco', '2026-10-05') }, spots, id);
  assert.equal(res.changed, false);
  assert.equal(res.log['2026-10-05'], day);
});

test('two charges at one spot on one day fill one slot', () => {
  const res = fillMealGapsFromVisits({}, { a: visit('taco', '2026-10-05'), b: visit('taco', '2026-10-05') }, spots, id);
  assert.equal(res.filled.length, 1);
  // …and on a later run the second charge still doesn't take dinner.
  assert.equal(fillMealGapsFromVisits(res.log, { a: visit('taco', '2026-10-05'), b: visit('taco', '2026-10-05') }, spots, id).changed, false);
});

test('two different spots on one day can fill lunch and dinner', () => {
  const res = fillMealGapsFromVisits({}, { a: visit('taco', '2026-10-05'), b: visit('legacy', '2026-10-05') }, spots, id);
  assert.deepEqual(res.filled.map(f => f.slot), ['lunch', 'dinner']);
});

test('unknown spots, coffee spots and bad dates are ignored; input is not mutated', () => {
  const log = { '2026-10-05': { entries: [] } };
  const frozen = JSON.stringify(log);
  const res = fillMealGapsFromVisits(log, {
    a: visit('gone', '2026-10-05'), b: visit('cafe', '2026-10-05'), c: visit('taco', '10/05/2026'),
  }, spots, id);
  assert.equal(res.changed, false);
  assert.equal(JSON.stringify(log), frozen);
});
