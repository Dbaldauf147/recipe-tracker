import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSetsGreen, previousBestE1rmLb, detectPersonalRecord, priorHistory } from './personalRecord.js';

const row = (over = {}) => ({
  exercise: 'Bench press', weight: 100,
  sets: ['5', '5', '5', ''], setDone: [true, true, true, false],
  ...over,
});
/** One prior session of Bench press at `weight` × 5. */
const past = (weight) => ({
  date: '2026-01-01',
  entries: [{ exercise: 'Bench press', weight, sets: ['5'], setDone: [true] }],
});

test('every filled set green, trailing blanks ignored', () => {
  assert.equal(allSetsGreen(row()), true);
});

test('one filled set left ungreen is not complete', () => {
  assert.equal(allSetsGreen(row({ setDone: [true, true, false, false] })), false);
});

test('a row with no values is never complete', () => {
  assert.equal(allSetsGreen(row({ sets: ['', '', '', ''], setDone: [true, true, true, true] })), false);
  assert.equal(allSetsGreen({}), false);
});

test('a blank cell counts as not attempted, not unfinished', () => {
  // 3 sets in a 4-column grid is a finished row.
  assert.equal(allSetsGreen(row({ sets: ['5', '', '5', ''], setDone: [true, false, true, false] })), true);
});

test('previous best scans every session and ignores other exercises', () => {
  const history = [
    past(100),
    past(140),
    { date: '2026-02-01', entries: [{ exercise: 'Squat', weight: 400, sets: ['5'], setDone: [true] }] },
  ];
  // Epley at 5 reps = w × (1 + 5/30) = w × 1.1667
  assert.ok(Math.abs(previousBestE1rmLb(history, 'Bench press') - 140 * (1 + 5 / 30)) < 0.01);
});

test('the exercise name matches case- and space-insensitively', () => {
  assert.ok(previousBestE1rmLb([past(100)], '  bench PRESS ') > 0);
});

test('an unseen exercise has no previous best', () => {
  assert.equal(previousBestE1rmLb([past(100)], 'Deadlift'), 0);
  assert.equal(previousBestE1rmLb([], 'Bench press'), 0);
  assert.equal(previousBestE1rmLb(null, 'Bench press'), 0);
});

test('beating the old best with a complete row is a PR', () => {
  const r = detectPersonalRecord(row({ weight: 150 }), [past(140)]);
  assert.equal(r.isPr, true);
  assert.ok(r.gainLb > 0);
});

test('the SAME lift again is not a PR', () => {
  // The guard that matters: e1RM is a float product, so an identical row can
  // land a hair above the stored best.
  const r = detectPersonalRecord(row({ weight: 140 }), [past(140)]);
  assert.equal(r.isPr, false);
});

test('a heavier lift with a set still ungreen does not fire yet', () => {
  const r = detectPersonalRecord(row({ weight: 200, setDone: [true, true, false, false] }), [past(140)]);
  assert.equal(r.isPr, false, 'the row is still in progress');
  assert.ok(r.gainLb > 0, 'but it would be a PR once finished');
});

test('the first time an exercise is ever logged is not a record', () => {
  // Otherwise every new exercise fires on its first row, which reads as a bug.
  const r = detectPersonalRecord(row({ weight: 150 }), []);
  assert.equal(r.isPr, false);
  assert.equal(r.previousLb, 0);
});

test('a bodyweight/timed row with no load never fires', () => {
  const r = detectPersonalRecord(
    row({ exercise: 'Plank', weight: 0, sets: ['60s'], setDone: [true] }),
    [{ entries: [{ exercise: 'Plank', weight: 0, sets: ['30s'], setDone: [true] }] }],
  );
  assert.equal(r.isPr, false);
  assert.equal(r.e1rmLb, 0);
});

test('a nameless row can never be a PR', () => {
  assert.equal(detectPersonalRecord(row({ exercise: '' }), [past(100)]).isPr, false);
});

test('more reps at the same weight is a PR', () => {
  // Epley rewards reps, so 8×100 beats 5×100 without touching the weight.
  const r = detectPersonalRecord(
    row({ weight: 100, sets: ['8', '', '', ''], setDone: [true, false, false, false] }),
    [past(100)],
  );
  assert.equal(r.isPr, true);
});

test('priorHistory excludes the session being logged', () => {
  // The live session is auto-saved into history while you are still in it, so
  // without this the row would be compared against a saved copy of itself: the
  // previous best equals the current lift, the gain is zero, and a real PR
  // never fires.
  const workouts = [
    { date: '2026-08-01', entries: [{ exercise: 'Bench press', weight: 100, sets: ['5'], setDone: [true] }] },
    { date: '2026-08-30', entries: [{ exercise: 'Bench press', weight: 200, sets: ['5'], setDone: [true] }] },
  ];
  const before = priorHistory(workouts, '2026-08-30');
  assert.equal(before.length, 1);
  assert.equal(before[0].date, '2026-08-01');
  // With today excluded, today's 200 is a record. Without it, it ties itself.
  const todaysRow = row({ weight: 200, sets: ['5', '', '', ''], setDone: [true, false, false, false] });
  assert.equal(detectPersonalRecord(todaysRow, before).isPr, true);
  assert.equal(detectPersonalRecord(todaysRow, workouts).isPr, false, 'ties itself without the filter');
});

test('priorHistory with no date is a pass-through, not an empty list', () => {
  const workouts = [{ date: '2026-08-01', entries: [] }];
  assert.equal(priorHistory(workouts, '').length, 1);
  assert.equal(priorHistory(null, '2026-01-01').length, 0);
});
