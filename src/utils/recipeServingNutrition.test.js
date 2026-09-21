import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recipeNutritionVectors, scaleServing, findStaleEntries, applyResync,
} from './recipeServingNutrition.js';

// An ingredient row as the recipe stores it, and the looked-up nutrition the
// panel pairs with it by index.
const row = (ingredient, topping = false) => ({ ingredient, quantity: '1', measurement: 'cup(s)', topping });
const item = (fruit, veg, calories = 100) => ({ nutrients: { fruitServings: fruit, vegServings: veg, calories } });

test('per-meal (topping) rows are not divided across the batch', () => {
  // The Maca Smoothie shape: four servings, but every row is written per meal.
  const ingredients = [row('banana', true), row('blueberries', true), row('kale', true)];
  const items = [item(0.7, 0), item(1, 0), item(0, 0.8)];
  const { totals, perServing } = recipeNutritionVectors(items, ingredients, 4);
  // One serving is the whole per-meal list, not a quarter of it.
  assert.equal(perServing.fruitServings, 1.7);
  assert.equal(perServing.vegServings, 0.8);
  // ...so the batch is that four times over.
  assert.equal(totals.fruitServings, 6.8);
  assert.equal(totals.vegServings, 3.2);
});

test('batch rows divide by the serving count', () => {
  const ingredients = [row('apple'), row('spinach')];
  const items = [item(4, 0), item(0, 2)];
  const { totals, perServing } = recipeNutritionVectors(items, ingredients, 4);
  assert.equal(perServing.fruitServings, 1);
  assert.equal(perServing.vegServings, 0.5);
  assert.equal(totals.fruitServings, 4);
  assert.equal(totals.vegServings, 2);
});

test('a mixed recipe divides the batch and keeps the toppings whole', () => {
  const ingredients = [row('rice'), row('avocado', true)];
  const items = [item(0, 0, 1200), item(1.3, 0, 240)];
  const { perServing } = recipeNutritionVectors(items, ingredients, 6);
  assert.equal(perServing.calories, 440); // 1200/6 + 240
  assert.equal(perServing.fruitServings, 1.3);
});

test('fractional servings survive rather than rounding to nothing', () => {
  const { perServing } = recipeNutritionVectors([item(0, 0.4)], [row('kale', true)], 2);
  assert.equal(perServing.vegServings, 0.4);
});

test('rows with no ingredient name are skipped, keeping items index-aligned', () => {
  // The lookup only ever sees named rows, so a blank row in the middle must not
  // shift every topping flag onto the wrong ingredient.
  const ingredients = [row(''), row('banana', true), row('oats')];
  const items = [item(1, 0, 0), item(0, 0, 600)];
  const { perServing } = recipeNutritionVectors(items, ingredients, 3);
  assert.equal(perServing.fruitServings, 1);   // the banana, undivided
  assert.equal(perServing.calories, 200);      // the oats, over three servings
});

test('no servings count falls back to one rather than dividing by zero', () => {
  const { perServing } = recipeNutritionVectors([item(2, 0)], [row('berries')], 0);
  assert.equal(perServing.fruitServings, 2);
});

// ── re-syncing what was already logged ─────────────────────────────────────

const recipe = { id: 'r1', title: 'Maca Smoothie', servings: 4 };
const PER_SERVING = { fruitServings: 3, vegServings: 0.8, calories: 548 };

function logWith(entries) {
  return { '2026-09-22': { entries } };
}

test('a logged meal whose numbers no longer match the recipe is flagged', () => {
  const log = logWith([
    { id: 'e1', type: 'recipe', recipeId: 'r1', servings: 1, nutrition: { fruitServings: 0, vegServings: 0, calories: 588 } },
  ]);
  const { stale } = findStaleEntries(log, recipe, PER_SERVING);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].date, '2026-09-22');
  assert.equal(stale[0].to.fruitServings, 3);
  assert.equal(stale[0].to.calories, 548);
});

test('the portion multiplier carries through', () => {
  const log = logWith([
    { id: 'e1', type: 'recipe', recipeId: 'r1', servings: 2, nutrition: { fruitServings: 0 } },
  ]);
  const { stale } = findStaleEntries(log, recipe, PER_SERVING);
  assert.equal(stale[0].to.fruitServings, 6);
  assert.equal(stale[0].to.vegServings, 1.6);
});

test('a meal that already matches is left out', () => {
  const log = logWith([
    { id: 'e1', type: 'recipe', recipeId: 'r1', servings: 1, nutrition: scaleServing(PER_SERVING, 1) },
  ]);
  assert.equal(findStaleEntries(log, recipe, PER_SERVING).stale.length, 0);
});

test('hand-weighed meals are reported, never rewritten', () => {
  // `servings` on these is not the multiplier that produced their nutrition —
  // the grams were — so rescaling from here would invent a number.
  const log = logWith([
    { id: 'e1', type: 'recipe', recipeId: 'r1', servings: 1, customWeight: 340, nutrition: { fruitServings: 0 } },
    { id: 'e2', type: 'recipe', recipeId: 'r1', servings: 1, ingredientWeights: { banana: '90' }, nutrition: { fruitServings: 0 } },
  ]);
  const { stale, skipped } = findStaleEntries(log, recipe, PER_SERVING);
  assert.equal(stale.length, 0);
  assert.equal(skipped.length, 2);
});

test('other recipes and non-recipe entries are untouched', () => {
  const log = logWith([
    { id: 'e1', type: 'recipe', recipeId: 'other', servings: 1, nutrition: { fruitServings: 0 } },
    { id: 'e2', type: 'ingredient', servings: 1, nutrition: { fruitServings: 0 } },
  ]);
  assert.equal(findStaleEntries(log, recipe, PER_SERVING).stale.length, 0);
});

test('applying the re-sync rewrites only the flagged entries', () => {
  const log = {
    '2026-09-22': { entries: [
      { id: 'e1', type: 'recipe', recipeId: 'r1', servings: 1, nutrition: { fruitServings: 0 } },
      { id: 'e2', type: 'recipe', recipeId: 'other', servings: 1, nutrition: { fruitServings: 9 } },
    ] },
    '2026-09-23': { entries: [], daySkipped: true },
  };
  const { stale } = findStaleEntries(log, recipe, PER_SERVING);
  const next = applyResync(log, stale);
  assert.equal(next['2026-09-22'].entries[0].nutrition.fruitServings, 3);
  assert.equal(next['2026-09-22'].entries[0].nutritionResyncedAt !== undefined, true);
  assert.equal(next['2026-09-22'].entries[1].nutrition.fruitServings, 9);
  // Untouched days come through as they were, flags and all.
  assert.equal(next['2026-09-23'].daySkipped, true);
  // The original is not mutated — the caller decides whether to keep the copy.
  assert.equal(log['2026-09-22'].entries[0].nutrition.fruitServings, 0);
});

test('nothing to do returns the same log object', () => {
  const log = logWith([]);
  assert.equal(applyResync(log, []), log);
});
