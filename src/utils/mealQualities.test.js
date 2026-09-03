import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isFermented, isOmega3Source,
  computeFermentedServings, computeOmega3Servings, qualitiesPer100g,
} from './mealQualities.js';

test('the fermented list comes from the curated ingredient tags', () => {
  for (const name of ['kimchi', 'sauerkraut', 'miso paste', 'tempeh', 'kefir', 'kombucha', 'soy sauce']) {
    assert.equal(isFermented(name), true, `${name} should read as fermented`);
  }
});

test('fermented matching survives the way ingredients are actually written', () => {
  // "greek yogurt" has its own entry in the tag map, so it cannot inherit the
  // plain "yogurt" entry's fermented tag — it carries its own.
  assert.equal(isFermented('Greek yogurt'), true);
  assert.equal(isFermented('plain greek yogurt'), true);
  assert.equal(isFermented('  KIMCHI  '), true);
});

test('a vinegar-brined pickle is not counted as fermented', () => {
  // Most supermarket pickles are brined, not cultured. Counting them would
  // make a "must include fermented food" goal pass on a burger garnish.
  assert.equal(isFermented('dill pickle'), false);
});

test('ordinary ingredients are not fermented', () => {
  for (const name of ['chicken breast', 'white rice', 'olive oil', 'broccoli', 'almond milk']) {
    assert.equal(isFermented(name), false, `${name} should not read as fermented`);
  }
});

test('a flavouring is not a serving of the food', () => {
  // "Kimchi seasoning" and "miso powder" carry the name without the substance.
  assert.equal(isFermented('kimchi seasoning'), false);
  assert.equal(isFermented('miso powder'), false);
  assert.equal(isOmega3Source('salmon flavor seasoning'), false);
});

test('omega-3 sources are recognised across fish and plants', () => {
  for (const name of ['salmon fillet', 'canned sardines', 'mackerel', 'anchovy paste',
    'chia seeds', 'ground flaxseed', 'walnuts', 'hemp hearts']) {
    assert.equal(isOmega3Source(name), true, `${name} should read as an omega-3 source`);
  }
});

test('weak or fake sources do not count', () => {
  // A "yes" is only worth something if it excludes the marginal cases.
  for (const name of ['canned light tuna', 'canola oil', 'imitation crab', 'chicken breast']) {
    assert.equal(isOmega3Source(name), false, `${name} should not read as an omega-3 source`);
  }
});

test('servings scale with grams and round to a tenth', () => {
  assert.equal(computeFermentedServings('kimchi', 80), 1);
  assert.equal(computeFermentedServings('kimchi', 40), 0.5);
  assert.equal(computeFermentedServings('chicken', 200), 0);
  assert.equal(computeOmega3Servings('salmon', 160), 2);
  // A tablespoon of soy sauce is a fraction of a serving, but not zero.
  assert.ok(computeFermentedServings('soy sauce', 15) > 0);
});

test('a zero or missing amount is zero servings, never NaN', () => {
  for (const grams of [0, -5, null, undefined, 'abc']) {
    assert.equal(computeFermentedServings('kimchi', grams), 0);
    assert.equal(computeOmega3Servings('salmon', grams), 0);
  }
});

test('per-100g qualities only carry the keys that apply', () => {
  assert.deepEqual(qualitiesPer100g('white rice'), {});
  assert.ok(qualitiesPer100g('kimchi').fermentedServings > 0);
  assert.equal(qualitiesPer100g('kimchi').omega3Servings, undefined);
  assert.ok(qualitiesPer100g('chia seeds').omega3Servings > 0);
});
