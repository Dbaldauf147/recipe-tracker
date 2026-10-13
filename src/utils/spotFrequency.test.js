import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frequencyExempt, frequencyOptionsFor, allowedFrequency } from './spotFrequency.js';

const OPTS = [{ key: 'regular' }, { key: 'special' }, { key: 'retired' }];

test('only pure drinking / going-out spots are exempt', () => {
  assert.equal(frequencyExempt(['drinking']), true);
  assert.equal(frequencyExempt(['going-out', 'drinking']), true);
  assert.equal(frequencyExempt(['drinking', 'lunch-dinner']), false);
  assert.equal(frequencyExempt([]), false);
  assert.equal(frequencyExempt(undefined), false);
});

test('exempt spots are offered Retired only', () => {
  assert.deepEqual(frequencyOptionsFor(['drinking'], OPTS).map(f => f.key), ['retired']);
  assert.equal(frequencyOptionsFor(['coffee'], OPTS), OPTS);
});

test('allowedFrequency drops everything but retired on exempt spots', () => {
  assert.equal(allowedFrequency(['drinking'], 'special'), undefined);
  assert.equal(allowedFrequency(['going-out'], 'retired'), 'retired');
  assert.equal(allowedFrequency(['drinking', 'lunch-dinner'], 'special'), 'special');
  assert.equal(allowedFrequency(['drinking'], ''), undefined);
});
