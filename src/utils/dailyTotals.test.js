import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayTotals,
  dayHasContent,
  convertSupplementAmount,
  countedSupplements,
  activeEntries,
} from './dailyTotals.js';

const meal = (slot, nutrition, type) => ({ id: slot + Math.random(), mealSlot: slot, type, nutrition });

test('totals add up the day’s logged meals', () => {
  const day = {
    entries: [
      meal('breakfast', { calories: 400, protein: 30 }),
      meal('dinner', { calories: 700, protein: 45 }),
    ],
  };
  const { totals, fromMeals, mealCount } = dayTotals(day);
  assert.equal(totals.calories, 1100);
  assert.equal(totals.protein, 75);
  assert.equal(fromMeals.calories, 1100);
  assert.equal(mealCount, 2);
});

test('a skipped meal slot drops its entries', () => {
  const day = {
    skippedMeals: ['lunch'],
    entries: [meal('lunch', { calories: 600 }), meal('dinner', { calories: 500 })],
  };
  assert.equal(dayTotals(day).totals.calories, 500);
  assert.equal(activeEntries(day).length, 1);
});

test('an uncategorised custom entry counts as a snack, so skipping snacks drops it', () => {
  const day = { skippedMeals: ['snack'], entries: [{ type: 'custom', nutrition: { calories: 250 } }] };
  assert.equal(dayTotals(day).totals.calories, 0);
});

test('a skipped day totals zero and says it was skipped', () => {
  const day = { daySkipped: true, entries: [meal('dinner', { calories: 900 })] };
  const res = dayTotals(day);
  assert.equal(res.skipped, true);
  assert.equal(res.totals.calories, 0);
});

test('supplements land in the totals, separately from the meals', () => {
  const day = {
    entries: [meal('breakfast', { vitaminD: 2 })],
    supplements: [{ id: 's1', nutrientKey: 'vitaminD', amount: '25', unit: 'mcg' }],
  };
  const { totals, fromMeals, fromSupplements } = dayTotals(day);
  assert.equal(fromMeals.vitaminD, 2);
  assert.equal(fromSupplements.vitaminD, 25);
  assert.equal(totals.vitaminD, 27);
});

test('supplement units convert to the nutrient’s own unit', () => {
  // Magnesium is tracked in mg, so 0.4 g is 400 mg.
  assert.equal(convertSupplementAmount(0.4, 'g', 'magnesium'), 400);
  // Vitamin D is tracked in µg; mcg is the same unit spelled differently.
  assert.equal(convertSupplementAmount(25, 'mcg', 'vitaminD'), 25);
  // A count of capsules can't become a mass.
  assert.equal(convertSupplementAmount(2, 'capsule', 'magnesium'), null);
  // IU has no clean conversion either.
  assert.equal(convertSupplementAmount(2000, 'IU', 'vitaminD'), null);
});

test('custom and blank-amount supplement rows are listed but never counted', () => {
  const rows = [
    { id: 'a', nutrientKey: '__custom', name: 'Creatine', amount: '5', unit: 'g' },
    { id: 'b', nutrientKey: 'zinc', amount: '', unit: 'mg' },
    { id: 'c', nutrientKey: 'zinc', amount: '15', unit: 'mg' },
  ];
  const counted = countedSupplements(rows);
  assert.equal(counted.length, 1);
  assert.equal(counted[0].nutrientKey, 'zinc');
  assert.equal(dayTotals({ entries: [], supplements: rows }).totals.zinc, 15);
});

test('dayHasContent keeps meals, supplements and skipped days; drops empty ones', () => {
  assert.equal(dayHasContent({ entries: [meal('dinner', { calories: 1 })] }), true);
  assert.equal(dayHasContent({ entries: [], supplements: [{ id: 'x' }] }), true);
  assert.equal(dayHasContent({ entries: [], daySkipped: true }), true);
  assert.equal(dayHasContent({ entries: [], supplements: [] }), false);
  assert.equal(dayHasContent(undefined), false);
});
