import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recipeVector, ingredientVector, rankValue, rankItems } from './nutrientRank.js';

test('recipeVector reads macrosPerServing and grams per serving', () => {
  assert.equal(recipeVector({}), null);
  assert.equal(recipeVector({ macrosPerServing: {} }), null);
  const v = recipeVector({ macrosPerServing: { calories: 400, fiber: 8 }, totalWeight: 1200, servings: 4 });
  assert.deepEqual(v, { calories: 400, fiber: 8, __grams: 300 });
});

test('ingredientVector parses string numbers and skips blanks', () => {
  const v = ingredientVector({ ingredient: 'garlic', measurement: 'clove(s)', grams: '3', calories: '4', fiber: '0.1', omega3: '' });
  assert.deepEqual(v, { calories: 4, fiber: 0.1, __grams: 3 });
  assert.equal(ingredientVector({ ingredient: 'x', fiber: '2' }), null);
});

test('rankValue per serving, per 100 cal and per 100 g', () => {
  const vec = { calories: 200, fiber: 10, __grams: 50 };
  assert.equal(rankValue(vec, 'fiber', 'serving'), 10);
  assert.equal(rankValue(vec, 'fiber', 'per100cal'), 5);
  assert.equal(rankValue(vec, 'fiber', 'per100g'), 20);
  assert.equal(rankValue({ calories: 0, fiber: 1 }, 'fiber', 'per100cal'), null);
  assert.equal(rankValue({ calories: 10 }, 'fiber', 'serving'), null);
  assert.equal(rankValue(vec, 'calories', 'per100cal'), null);
  assert.equal(rankValue({ calories: 10, fiber: 1 }, 'fiber', 'per100g'), null);
});

test('rankItems sorts, filters by name and minimum calories', () => {
  const items = [
    { name: 'Lentil soup', vec: { calories: 300, fiber: 15 } },
    { name: 'Garlic', vec: { calories: 4, fiber: 0.4 } },
    { name: 'Oats', vec: { calories: 150, fiber: 4 } },
    { name: 'No data', vec: null },
  ];
  assert.deepEqual(rankItems(items, { nutrient: 'fiber' }).map(r => r.name), ['Lentil soup', 'Oats', 'Garlic']);
  assert.deepEqual(rankItems(items, { nutrient: 'fiber', order: 'asc' }).map(r => r.name), ['Garlic', 'Oats', 'Lentil soup']);
  assert.deepEqual(rankItems(items, { nutrient: 'fiber', basis: 'per100cal' }).map(r => r.name), ['Garlic', 'Lentil soup', 'Oats']);
  assert.deepEqual(rankItems(items, { nutrient: 'fiber', basis: 'per100cal', minCalories: 20 }).map(r => r.name), ['Lentil soup', 'Oats']);
  assert.deepEqual(rankItems(items, { nutrient: 'fiber', query: 'OAT' }).map(r => r.name), ['Oats']);
});
