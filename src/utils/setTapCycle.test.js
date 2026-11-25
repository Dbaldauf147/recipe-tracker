// ⚠️ The mobile app has the same suite in src/utils/setTapCycle.test.ts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cycleEntrySet, nextSetTapState, setTapState } from './setTapCycle.js';

describe('set tap cycle', () => {
  it('goes blank → yellow → green → blank', () => {
    assert.equal(nextSetTapState('blank'), 'started');
    assert.equal(nextSetTapState('started'), 'done');
    assert.equal(nextSetTapState('done'), 'blank');
  });
  it('reads green over yellow when both flags are set', () => {
    assert.equal(setTapState(true, true), 'done');
    assert.equal(setTapState(true, false), 'started');
    assert.equal(setTapState(false, false), 'blank');
  });
  it('steps one set of an entry and leaves the others alone', () => {
    let e = { sets: ['10', '10', '8', '', ''], setDone: [true] };
    e = cycleEntrySet(e, 1);
    assert.deepEqual(e.setStarted, [false, true, false, false, false]);
    assert.deepEqual(e.setDone, [true, false, false, false, false]);
    e = cycleEntrySet(e, 1);
    assert.deepEqual(e.setStarted, [false, false, false, false, false]);
    assert.deepEqual(e.setDone, [true, true, false, false, false]);
    e = cycleEntrySet(e, 1);
    assert.deepEqual(e.setDone, [true, false, false, false, false]);
    assert.equal(e.setStarted[1], false);
  });
  it('turns an already-green set from an older save straight back to blank', () => {
    const e = cycleEntrySet({ sets: ['5'], setDone: [true] }, 0);
    assert.equal(e.setDone[0], false);
    assert.equal(e.setStarted[0], false);
  });
});
