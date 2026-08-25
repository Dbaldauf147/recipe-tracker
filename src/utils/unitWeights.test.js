import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertUnitWeight, findUnitWeight, defaultUnitWeight, splitUnit, composeUnit,
} from './unitWeights.js';

// What the recipe editor's unit cell shows for a row, reproduced from
// countInfoFor() in RecipeDetail.jsx. The cell has no memory of which unit the
// row uses: it resolves by row.measurement, else the ingredient's default.
function cellShows(dbRow, rowMeasurement, grams) {
  const entry = findUnitWeight(dbRow, (rowMeasurement || '').trim().toLowerCase())
    || defaultUnitWeight(dbRow);
  const { size, name } = splitUnit(entry?.unit || '');
  const count = (grams != null && entry?.grams > 0)
    ? String(Math.round((grams / entry.grams) * 10) / 10) : '';
  return { size, name, count };
}

// Type "regular stick", count 2, on a 133 g row — then let the draft clear.
function teachAndRedraw(startingUnitWeights) {
  const grams = 133, count = 2, size = 'regular', name = 'stick';
  const unitWeights = upsertUnitWeight(
    startingUnitWeights, composeUnit(size, name), grams / count, true,
  );
  return cellShows({ unitWeights }, 'grams', grams);
}

test('a taught unit survives the draft clearing when nothing was taught before', () => {
  assert.deepEqual(teachAndRedraw([]), { size: 'regular', name: 'stick', count: '2' });
});

test('a taught unit survives even when the ingredient already had a default', () => {
  // Regression: this used to snap back to "large" and silently change the count
  // to 1.7, wiping what was typed.
  const before = [{ unit: 'large', grams: 80, isDefault: true }];
  assert.deepEqual(teachAndRedraw(before), { size: 'regular', name: 'stick', count: '2' });
});

test('a taught unit survives when existing entries had no default flag', () => {
  const before = [{ unit: 'clove', grams: 5 }];
  assert.deepEqual(teachAndRedraw(before), { size: 'regular', name: 'stick', count: '2' });
});

test('promoting leaves exactly one default and keeps the other units', () => {
  const before = [
    { unit: 'large', grams: 80, isDefault: true },
    { unit: 'clove', grams: 5 },
  ];
  const after = upsertUnitWeight(before, 'regular stick', 66.5, true);
  assert.equal(after.filter(w => w.isDefault).length, 1);
  assert.equal(defaultUnitWeight({ unitWeights: after }).unit, 'regular stick');
  assert.deepEqual(after.map(w => w.unit).sort(), ['clove', 'large', 'regular stick']);
});

test('re-teaching the same unit replaces it rather than duplicating', () => {
  const once = upsertUnitWeight([], 'regular stick', 66.5, true);
  const twice = upsertUnitWeight(once, 'regular sticks', 70, true); // plural = same unit
  assert.equal(twice.length, 1);
  assert.equal(twice[0].grams, 70);
});

test('without makeDefault the old append-only behaviour is unchanged', () => {
  const before = [{ unit: 'large', grams: 80, isDefault: true }];
  const after = upsertUnitWeight(before, 'regular stick', 66.5);
  assert.equal(defaultUnitWeight({ unitWeights: after }).unit, 'large');
  assert.equal(after.length, 2);
});
