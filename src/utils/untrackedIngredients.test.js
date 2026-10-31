import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTracked, untrackedRows, matchCandidates } from './untrackedIngredients.js';

const mine = ['cilantro', 'onion', 'butter_salted', 'chicken breast', 'olive oil', 'lime juice'];

test('tracked: exact, plural, partial; not tracked: no match or a far-off one', () => {
  assert.equal(isTracked('Cilantro', mine), true);
  assert.equal(isTracked('onions', mine), true);
  assert.equal(isTracked('red onion', mine), true);
  assert.equal(isTracked('gochujang', mine), false);
  assert.equal(isTracked('salt', mine), false); // would hit butter_salted
  assert.equal(isTracked('chicken thighs', mine), false);
});

test('untrackedRows skips blank rows and flags nothing before the list loads', () => {
  const rows = [{ ingredient: 'olive oil' }, { ingredient: '' }, { ingredient: 'gochujang' }, { ingredient: 'salt' }];
  assert.deepEqual(untrackedRows(rows, mine), [2, 3]);
  assert.deepEqual(untrackedRows(rows, []), []);
});

test('candidates: shared words first, shortest name breaks ties; a query takes over', () => {
  assert.deepEqual(matchCandidates('chicken thighs, skin on', mine), ['chicken breast']);
  assert.deepEqual(matchCandidates('fresh lime', mine), ['lime juice']);
  assert.deepEqual(matchCandidates('gochujang', mine), []);
  assert.deepEqual(matchCandidates('gochujang', mine, 'oil'), ['olive oil']);
});
