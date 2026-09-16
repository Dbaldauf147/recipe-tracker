import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayTotals,
  dayHasContent,
  convertSupplementAmount,
  countedSupplements,
  activeEntries,
  resolveSupplements,
  formatNutrient,
} from './dailyTotals.js';

const meal = (slot, nutrition, type) => ({ id: slot + Math.random(), mealSlot: slot, type, nutrition });

test('totals add up the dayâ€™s logged meals', () => {
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

test('supplement units convert to the nutrientâ€™s own unit', () => {
  // Magnesium is tracked in mg, so 0.4 g is 400 mg.
  assert.equal(convertSupplementAmount(0.4, 'g', 'magnesium'), 400);
  // Vitamin D is tracked in Âµg; mcg is the same unit spelled differently.
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

const vitD = [{ id: 's1', nutrientKey: 'vitaminD', name: 'Vitamin D', amount: '50', unit: 'mcg' }];
const withZinc = [...vitD, { id: 's2', nutrientKey: 'zinc', name: 'Zinc', amount: '15', unit: 'mg' }];

test('a day with no list of its own inherits the standing one', () => {
  const log = {
    '2026-09-10': { entries: [], supplements: vitD },
    '2026-09-11': { entries: [] },
    '2026-09-12': { entries: [] },
  };
  const res = resolveSupplements(log);
  assert.equal(res['2026-09-10'].carried, false);
  assert.deepEqual(res['2026-09-11'].supplements, vitD);
  assert.equal(res['2026-09-11'].carried, true);
  assert.deepEqual(res['2026-09-12'].supplements, vitD);
});

test('editing the list changes later days, not earlier ones', () => {
  const log = {
    '2026-09-10': { entries: [], supplements: vitD },
    '2026-09-11': { entries: [] },
    '2026-09-12': { entries: [], supplements: withZinc },
    '2026-09-13': { entries: [] },
  };
  const res = resolveSupplements(log);
  assert.deepEqual(res['2026-09-11'].supplements, vitD);
  assert.deepEqual(res['2026-09-13'].supplements, withZinc);
});

test('days before the first recorded list reach forward to it', () => {
  const log = {
    '2026-09-01': { entries: [] },
    '2026-09-02': { entries: [] },
    '2026-09-10': { entries: [], supplements: withZinc },
  };
  const res = resolveSupplements(log);
  assert.deepEqual(res['2026-09-01'].supplements, withZinc);
  assert.equal(res['2026-09-01'].carried, true);
});

test('an explicitly emptied list means none that day, and stays empty after', () => {
  const log = {
    '2026-09-10': { entries: [], supplements: vitD },
    '2026-09-11': { entries: [], supplements: [] },
    '2026-09-12': { entries: [] },
  };
  const res = resolveSupplements(log);
  assert.deepEqual(res['2026-09-11'].supplements, []);
  assert.equal(res['2026-09-11'].carried, false);
  assert.deepEqual(res['2026-09-12'].supplements, []);
  assert.equal(res['2026-09-12'].carried, false);
});

test('no recorded list anywhere leaves every day empty', () => {
  const res = resolveSupplements({ '2026-09-10': { entries: [] }, '2026-09-11': { entries: [] } });
  assert.deepEqual(res['2026-09-10'].supplements, []);
  assert.equal(res['2026-09-11'].carried, false);
});

test('carried supplements count in that dayâ€™s totals', () => {
  const log = { '2026-09-10': { entries: [], supplements: vitD }, '2026-09-11': { entries: [] } };
  const carried = resolveSupplements(log)['2026-09-11'].supplements;
  assert.equal(dayTotals({ entries: [], supplements: carried }).totals.vitaminD, 50);
});

test('an amount too small to round to a visible figure reads as â€œ<0.1â€', () => {
  const omega3 = { key: 'omega3', unit: 'g', decimals: 1 };
  // 360 mcg of a nutrient tracked in grams.
  assert.equal(formatNutrient(0.00036, omega3), '<0.1');
  assert.equal(formatNutrient(0.36, omega3), '0.4');
  assert.equal(formatNutrient(0, omega3), '0');
  assert.equal(formatNutrient(0.4, { key: 'calories', unit: '', decimals: 0 }), '<1');
});

