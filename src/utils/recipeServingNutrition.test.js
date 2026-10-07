import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recipeNutritionVectors,
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
