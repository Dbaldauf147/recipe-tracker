import test from 'node:test';
import assert from 'node:assert/strict';
import { volumeGrams, mlPerUnit } from './volumeGrams.js';

test('a cup weight answers tablespoons and teaspoons', () => {
  // Olive oil: 1 cup = 216 g → 1 tbsp ≈ 13.5 g, 1 tsp ≈ 4.5 g.
  assert.ok(Math.abs(volumeGrams(1, 'tbsp', 216, 'cup') - 13.5) < 0.05);
  assert.ok(Math.abs(volumeGrams(3, 'teaspoons', 216, 'cup') - 13.5) < 0.05);
  assert.ok(Math.abs(volumeGrams(250, 'ml', 216, 'cup') - 228.2) < 0.2);
});

test('only true volume units convert — no invented weights', () => {
  assert.equal(volumeGrams(1, 'handful', 216, 'cup'), null);
  assert.equal(volumeGrams(1, 'can', 216, 'cup'), null);
  assert.equal(volumeGrams(1, 'cup', 100, 'g'), null, 'a weight reference has no density');
  assert.equal(volumeGrams(1, 'stick', 113, 'cup'), null);
});

test('bad numbers give null, and unit spelling is forgiving', () => {
  assert.equal(volumeGrams(0, 'cup', 216, 'cup'), null);
  assert.equal(volumeGrams(1, 'cup', 0, 'cup'), null);
  assert.equal(mlPerUnit(' Cup(s)'), 236.588);
  assert.equal(mlPerUnit('Tablespoons'), 14.787);
});
