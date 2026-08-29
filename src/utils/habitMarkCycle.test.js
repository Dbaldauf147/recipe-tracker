import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CYCLE_ORDER, nextMarkInCycle } from './habitMarkCycle.js';

test('the first click on a blank cell says "Did it"', () => {
  assert.equal(nextMarkInCycle(undefined), 'done');
  assert.equal(nextMarkInCycle(null), 'done');
  assert.equal(nextMarkInCycle(''), 'done');
});

test('clicking walks every mark and comes back to empty', () => {
  // Start blank, click once per mark plus once more, and the cell should be
  // blank again — no answer is unreachable, and none is a dead end.
  const seen = [];
  let mark = undefined;
  for (let i = 0; i < CYCLE_ORDER.length; i++) {
    mark = nextMarkInCycle(mark);
    seen.push(mark);
  }
  assert.deepEqual(seen, CYCLE_ORDER);
  assert.equal(nextMarkInCycle(mark), null, 'the last mark must wrap to empty');
});

test('the cycle is closed — one more click restarts it', () => {
  assert.equal(nextMarkInCycle(nextMarkInCycle('missed')), 'done');
});

test('a mark that is not in the cycle restarts rather than sticking', () => {
  // Defensive: an old or hand-edited value shouldn't leave a cell unclickable.
  assert.equal(nextMarkInCycle('something-else'), 'done');
});
