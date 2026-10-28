// ⚠️ PrepDay has the same cases in src/utils/parseQuantity.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuantity } from './parseQuantity.js';

test('a fraction equals the same amount as a decimal', () => {
  for (const v of ['1/2', '.5', '0.5', '½', ' 1 / 2 ', '1⁄2']) assert.equal(parseQuantity(v), 0.5, v);
  for (const v of ['1 1/2', '1½', '1 ½', '1.5']) assert.equal(parseQuantity(v), 1.5, v);
  assert.equal(parseQuantity('3/4'), 0.75);
  assert.equal(parseQuantity('2 1/4 cups'), 2.25);
  assert.equal(parseQuantity('1/2 cup'), 0.5);
});

test('behaves like parseFloat otherwise', () => {
  assert.equal(parseQuantity('2'), 2);
  assert.equal(parseQuantity('2 cups'), 2);
  assert.equal(parseQuantity('1-2'), 1);
  assert.equal(parseQuantity(3), 3);
  assert.equal(parseQuantity(0), 0);
  for (const v of ['', '  ', 'to taste', null, undefined, '1/0']) assert.ok(Number.isNaN(parseQuantity(v)), String(v));
});
