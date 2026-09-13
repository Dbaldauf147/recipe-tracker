import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCuisines, parseVocab } from '../../api/extract-restaurant.js';

// The Google Maps import guesses a cuisine (api/extract-restaurant.js). These
// cover the cleanup between the model's answer and the Cuisines box.

test('a guessed cuisine takes the spelling the user already uses', () => {
  assert.deepEqual(
    normalizeCuisines(['japanese', 'RAMEN'], ['Japanese', 'Ramen', 'Thai']),
    ['Japanese', 'Ramen'],
  );
});

test('a cuisine not in the list is title-cased rather than dropped', () => {
  assert.deepEqual(normalizeCuisines(['peruvian'], ['Thai']), ['Peruvian']);
});

test('at most two, no duplicates, no junk', () => {
  assert.deepEqual(
    normalizeCuisines(['Pizza', 'pizza', '', null, 'x'.repeat(60), 'Italian', 'Wine Bar'], []),
    ['Pizza', 'Italian'],
  );
  assert.deepEqual(normalizeCuisines(undefined, []), []);
  assert.deepEqual(normalizeCuisines('Thai', []), []);
});

test('the vocabulary param splits on commas and ignores blanks', () => {
  assert.deepEqual(parseVocab(' Thai, ,Ramen,'), ['Thai', 'Ramen']);
  assert.deepEqual(parseVocab(undefined), []);
});
