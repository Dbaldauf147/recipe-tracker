import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCueSequence, routineDurationSec, normalizeRoutine, emptyRoutine, mmss,
  DEFAULT_HOLD_SEC, DEFAULT_TRANSITION_SEC, MAX_SEC,
} from './stretchRoutine.js';

const R = (names, hold = 40, transition = 20) => ({
  id: 'r', name: 'Test', updatedAt: '', holdSec: hold, transitionSec: transition,
  steps: names.map((n, i) => ({ id: String(i), name: n })),
});

test('the asked-for shape: 40s hold, 20s to move, transition BEFORE each pose but the first', () => {
  const cues = buildCueSequence(R(['Pigeon', 'Cat-cow', 'Hamstring']));
  assert.deepEqual(
    cues.map(c => [c.kind, c.seconds]),
    [['hold', 40], ['transition', 20], ['hold', 40], ['transition', 20], ['hold', 40]],
  );
  assert.equal(cues[0].kind, 'hold', 'play drops you straight into pose one');
  assert.equal(cues.at(-1).kind, 'hold', 'ends on a hold, not a transition to nowhere');
});

test('duration is holds + the gaps between them', () => {
  assert.equal(routineDurationSec(R(['a', 'b', 'c'])), 40 * 3 + 20 * 2);
  assert.equal(routineDurationSec(R(['a'])), 40);
  assert.equal(routineDurationSec(emptyRoutine('x')), 0);
});

test('a transition names the pose it leads INTO, so the UI can say "Next: …"', () => {
  const t = buildCueSequence(R(['Pigeon', 'Cat-cow'])).find(c => c.kind === 'transition');
  assert.equal(t.stepName, 'Cat-cow');
  assert.equal(t.stepIndex, 1);
});

test('edge shapes do not throw', () => {
  assert.deepEqual(buildCueSequence(emptyRoutine('x')), []);
  assert.deepEqual(buildCueSequence(R(['Only'])).map(c => c.kind), ['hold']);
  // Zero transition collapses to back-to-back holds rather than 0-second cues.
  assert.deepEqual(buildCueSequence(R(['a', 'b'], 30, 0)).map(c => c.kind), ['hold', 'hold']);
  assert.deepEqual(buildCueSequence(null), []);
  assert.deepEqual(buildCueSequence({}), []);
});

test('a per-pose hold overrides the routine default', () => {
  const cues = buildCueSequence({
    ...R(['a', 'b']),
    steps: [{ id: '0', name: 'a', holdSec: 90 }, { id: '1', name: 'b' }],
  });
  assert.deepEqual(cues.filter(c => c.kind === 'hold').map(c => c.seconds), [90, 40]);
});

test('normalization: junk in, sane out', () => {
  assert.equal(normalizeRoutine(null), null);
  assert.equal(normalizeRoutine('nope'), null);
  assert.equal(normalizeRoutine({ name: '', steps: [] }), null);

  const n = normalizeRoutine({
    name: ' Morning ',
    steps: [{ name: ' Pigeon ' }, { name: '' }, { name: 'Twist', holdSec: '25' }],
    holdSec: -5,
    transitionSec: 99999,
  });
  assert.equal(n.name, 'Morning');
  assert.deepEqual(n.steps.map(s => s.name), ['Pigeon', 'Twist'], 'nameless steps dropped');
  assert.equal(n.holdSec, DEFAULT_HOLD_SEC, 'nonsense hold falls back to the default');
  assert.equal(n.transitionSec, MAX_SEC, 'absurd transition clamps');
  assert.equal(n.steps[0].holdSec, undefined, 'no override invented for a step without one');
  assert.equal(n.steps[1].holdSec, 25, 'a real override survives, coerced from a string');
  assert.ok(n.id, 'a missing id is minted');
});

test('normalized routines survive a round-trip unchanged', () => {
  const once = normalizeRoutine({ name: 'A', steps: [{ name: 'x' }] });
  const twice = normalizeRoutine(once);
  assert.deepEqual(twice.steps, once.steps);
  assert.equal(twice.holdSec, once.holdSec);
  assert.equal(twice.transitionSec, once.transitionSec);
});

test('the workout-type and habit links survive normalization', () => {
  const n = normalizeRoutine({
    name: 'Morning Stretch', steps: [{ name: 'Pigeon' }],
    workoutType: 'Stretch', habitId: 'h-42',
  });
  assert.equal(n.workoutType, 'Stretch');
  assert.equal(n.habitId, 'h-42');
  // The regression this guards: the other app re-normalizes every routine it
  // reads and writes the result straight back, so a field dropped here is a
  // setting the user loses the moment they touch a routine on the phone.
  const twice = normalizeRoutine(n);
  assert.equal(twice.workoutType, 'Stretch');
  assert.equal(twice.habitId, 'h-42');
});

test('a routine with no links normalizes to empty strings, not undefined', () => {
  const n = normalizeRoutine({ name: 'A', steps: [{ name: 'x' }] });
  assert.equal(n.workoutType, '', 'caller falls back to Yoga on empty');
  assert.equal(n.habitId, '');
  // Firestore rejects undefined values, so these must never be absent.
  assert.ok(!Object.values(n).includes(undefined));
});

test('mmss formats the clock', () => {
  assert.equal(mmss(0), '0:00');
  assert.equal(mmss(9), '0:09');
  assert.equal(mmss(40), '0:40');
  assert.equal(mmss(200), '3:20');
  assert.equal(mmss(-5), '0:00');
});

test('defaults are the ones the feature was specified with', () => {
  assert.equal(DEFAULT_HOLD_SEC, 40);
  assert.equal(DEFAULT_TRANSITION_SEC, 20);
});
