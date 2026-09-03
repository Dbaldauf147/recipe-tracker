import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyProfile } from './mealGoals.js';
import {
  rateMeal, rateRecipe, rateRecipes, perServingForRecipe, perServingFromCache,
  compareByRating, ratingSummary, ratingDetail, MAX_STARS,
} from './mealRating.js';

// A five-goal profile, the shape the star scale was built around: one star
// per goal met.
function fiveGoalProfile() {
  const p = emptyProfile('Five');
  p.macros = {
    protein: { min: 25, max: 40 },
    carbs: { min: 30, max: 50 },
    fat: { min: 20, max: 35 },
  };
  p.nutrients = [
    { id: 'a', key: 'fiber', op: 'atLeast', min: 8, max: null },
    { id: 'b', key: 'sodium', op: 'atMost', min: null, max: 700 },
  ];
  return p;
}

// 40p / 40c / 18f ≈ 160 / 160 / 162 kcal → about 33 / 33 / 34 %.
const balanced = { protein: 40, carbs: 40, fat: 18, fiber: 12, sodium: 500, calories: 500 };

test('every goal met is five stars', () => {
  const r = rateMeal(fiveGoalProfile(), balanced);
  assert.equal(r.total, 5);
  assert.equal(r.met, 5);
  assert.equal(r.stars, 5);
});

test('one star per goal met on a five-goal profile', () => {
  // Fiber and sodium both miss; the three macros still land.
  const r = rateMeal(fiveGoalProfile(), { ...balanced, fiber: 2, sodium: 1800 });
  assert.equal(r.met, 3);
  assert.equal(r.stars, 3);
  assert.equal(ratingSummary(r), '3 of 5 meal goals met');
});

test('no goal met is zero stars, not one', () => {
  const r = rateMeal(fiveGoalProfile(), { protein: 1, carbs: 90, fat: 1, fiber: 0, sodium: 3000 });
  assert.equal(r.met, 0);
  assert.equal(r.stars, 0);
});

test('a profile that is not five goals long still scores out of five', () => {
  const p = emptyProfile('Three');
  p.nutrients = [
    { id: 'a', key: 'fiber', op: 'atLeast', min: 8, max: null },
    { id: 'b', key: 'sodium', op: 'atMost', min: null, max: 700 },
    { id: 'c', key: 'protein', op: 'atLeast', min: 30, max: null },
  ];
  const r = rateMeal(p, { fiber: 12, sodium: 500, protein: 10 });
  assert.equal(r.met, 2);
  assert.equal(r.total, 3);
  // 2/3 of five stars, to the nearest half.
  assert.equal(r.stars, 3.5);
  assert.ok(r.stars <= MAX_STARS);
});

test('a yes/no goal counts like any other', () => {
  const p = emptyProfile('Fermented');
  p.nutrients = [{ id: 'a', key: 'fermentedServings', op: 'has', min: null, max: null }];
  assert.equal(rateMeal(p, { fermentedServings: 1 }).stars, 5);
  assert.equal(rateMeal(p, { fermentedServings: 0 }).stars, 0);
});

test('a macro goal on a meal with no macros counts as not met', () => {
  // Black coffee: real nutrition, no macros to split.
  const r = rateMeal(fiveGoalProfile(), { calories: 2, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 5 });
  // Fiber misses, sodium passes, all three macros are unknown → 1 of 5.
  assert.equal(r.met, 1);
  assert.equal(r.stars, 1);
});

test('no goals or no nutrition means no rating at all', () => {
  assert.equal(rateMeal(emptyProfile('Empty'), balanced), null);
  assert.equal(rateMeal(fiveGoalProfile(), null), null);
  assert.equal(rateMeal(fiveGoalProfile(), {}), null);
});

test('the persisted per-serving vector is preferred', () => {
  const recipe = { id: 'r1', servings: 4, macrosPerServing: balanced };
  assert.deepEqual(perServingForRecipe(recipe, {}), balanced);
  assert.equal(rateRecipe(fiveGoalProfile(), recipe, {}).stars, 5);
});

test('the nutrition cache divides base ingredients but not toppings', () => {
  const recipe = {
    id: 'r2',
    servings: 2,
    ingredients: [
      { ingredient: 'chicken', quantity: '1', measurement: 'lb' },
      { ingredient: 'olive oil', quantity: '1', measurement: 'tsp', topping: true },
      { ingredient: '', quantity: '', measurement: '' },   // blank row, never looked up
    ],
  };
  const cache = {
    r2: {
      data: {
        items: [
          { nutrients: { protein: 100, fiber: 4 } },
          { nutrients: { fat: 5, fiber: 1 } },
        ],
      },
    },
  };
  const per = perServingFromCache(recipe, cache.r2);
  assert.equal(per.protein, 50);   // base, halved across two servings
  assert.equal(per.fat, 5);        // topping, already per serving
  assert.equal(per.fiber, 3);      // 4/2 + 1
  assert.deepEqual(perServingForRecipe(recipe, cache), per);
});

test('totals fall back to a plain per-serving divide', () => {
  const recipe = { id: 'r3', servings: 2, macrosTotals: { protein: 60, fiber: 10 } };
  assert.deepEqual(perServingForRecipe(recipe, {}), { protein: 30, fiber: 5 });
});

test('a recipe with no nutrition anywhere is unrated', () => {
  const recipe = { id: 'r4', servings: 2, ingredients: [{ ingredient: 'mystery' }] };
  assert.equal(perServingForRecipe(recipe, {}), null);
  assert.equal(rateRecipe(fiveGoalProfile(), recipe, {}), null);
  assert.deepEqual(rateRecipes(fiveGoalProfile(), [recipe], {}), {});
});

test('unrated recipes sort last, best first otherwise', () => {
  const profile = fiveGoalProfile();
  const good = { id: 'good', title: 'Good', servings: 1, macrosPerServing: balanced };
  const poor = { id: 'poor', title: 'Poor', servings: 1, macrosPerServing: { ...balanced, fiber: 0, sodium: 4000 } };
  const unknown = { id: 'unknown', title: 'Aardvark', servings: 1 };
  const ratings = rateRecipes(profile, [good, poor, unknown], {});
  const sorted = [unknown, poor, good].sort((a, b) => compareByRating(ratings, a, b));
  assert.deepEqual(sorted.map(r => r.id), ['good', 'poor', 'unknown']);
});

test('the detail line names each goal and how it missed', () => {
  const detail = ratingDetail(rateMeal(fiveGoalProfile(), { ...balanced, fiber: 2 }));
  assert.match(detail, /✗ Fiber \(under\)/);
  assert.match(detail, /✓ Sodium/);
});
