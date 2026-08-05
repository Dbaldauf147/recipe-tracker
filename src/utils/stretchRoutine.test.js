import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCueSequence, routineDurationSec, normalizeRoutine, emptyRoutine, mmss, isStretchWorkout,
  DEFAULT_HOLD_SEC, DEFAULT_TRANSITION_SEC, DEFAULT_SWITCH_SEC, MAX_SEC,
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

test('a both-sides pose is held twice, with a short switch between the sides', () => {
  const cues = buildCueSequence({
    ...R(['Pigeon', 'Cat-cow']),
    switchSec: 10,
    steps: [{ id: '0', name: 'Pigeon', bothSides: true }, { id: '1', name: 'Cat-cow' }],
  });
  assert.deepEqual(
    cues.map(c => [c.kind, c.seconds, c.side]),
    [
      ['hold', 40, 'left'],
      ['switch', 10, 'right'],   // swapping legs, not walking to a new pose
      ['hold', 40, 'right'],
      ['transition', 20, ''],    // now the full gap, to a one-sided pose
      ['hold', 40, ''],
    ],
  );
  // ONE pose, done twice — the player's "1/2" counter must not split it in two.
  assert.deepEqual(cues.filter(c => c.kind === 'hold').map(c => c.stepIndex), [0, 0, 1]);
  // The name stays bare on both sides, so they log to one exercise rather than
  // "Pigeon (left)" and "Pigeon (right)" landing as two unrelated entries.
  assert.equal(cues[0].stepName, 'Pigeon');
  assert.equal(cues[2].stepName, 'Pigeon');
});

test('each side can have its own time, and the right side inherits the left', () => {
  const sided = (step) => buildCueSequence({
    ...R(['x']), switchSec: 10, steps: [{ id: '0', name: 'x', bothSides: true, ...step }],
  }).filter(c => c.kind === 'hold').map(c => c.seconds);

  assert.deepEqual(sided({ holdSec: 45, holdSecRight: 30 }), [45, 30], 'a time each');
  // The tight-side case this feature exists for: 60s left, blank right. The
  // right must follow the LEFT (60), not fall back to the routine default (40).
  assert.deepEqual(sided({ holdSec: 60 }), [60, 60], 'blank right matches the left');
  assert.deepEqual(sided({}), [40, 40], 'no override at all → the routine default, twice');
  assert.deepEqual(sided({ holdSecRight: 75 }), [40, 75], 'right alone still overrides');
});

test('a routine of both-sides poses costs the sides and the switches', () => {
  const r = {
    ...R(['a', 'b']), switchSec: 10,
    steps: [{ id: '0', name: 'a', bothSides: true }, { id: '1', name: 'b', bothSides: true }],
  };
  //        a-left  switch  a-right  transition  b-left  switch  b-right
  assert.equal(routineDurationSec(r), 40 + 10 + 40 + 20 + 40 + 10 + 40);
  // Zero switch collapses to back-to-back sides rather than a 0-second cue,
  // matching what a zero transition already does between poses.
  assert.equal(routineDurationSec({ ...r, switchSec: 0 }), 40 + 40 + 20 + 40 + 40);
});

test('the both-sides settings survive normalization', () => {
  // The regression this guards: the phone re-normalizes every routine it reads
  // and writes the result straight back, so a field dropped here is a per-side
  // time the user loses the moment they open the routine on mobile.
  const n = normalizeRoutine({
    name: 'Hips', switchSec: '12',
    steps: [
      { name: 'Pigeon', bothSides: true, holdSec: 60, holdSecRight: '90' },
      { name: 'Cat-cow' },
    ],
  });
  assert.equal(n.switchSec, 12);
  assert.equal(n.steps[0].bothSides, true);
  assert.equal(n.steps[0].holdSecRight, 90, 'coerced from a string');
  assert.equal(n.steps[1].bothSides, undefined, 'not invented for a one-sided pose');
  assert.equal(n.steps[1].holdSecRight, undefined);
  const twice = normalizeRoutine(n);
  assert.deepEqual(twice.steps, n.steps);
  assert.equal(twice.switchSec, n.switchSec);
  // A right-side time on a pose that isn't two-sided is meaningless, and would
  // come back to life if the pose were ever flipped to both sides.
  const stray = normalizeRoutine({ name: 'x', steps: [{ name: 'y', holdSecRight: 30 }] });
  assert.equal(stray.steps[0].holdSecRight, undefined);
});

test('a routine saved before both-sides existed still plays', () => {
  const old = normalizeRoutine({ name: 'Old', steps: [{ name: 'Pigeon' }, { name: 'Frog' }] });
  assert.equal(old.switchSec, DEFAULT_SWITCH_SEC, 'defaulted, not undefined — Firestore rejects those');
  assert.deepEqual(
    buildCueSequence(old).map(c => c.kind),
    ['hold', 'transition', 'hold'],
    'no sides, no switch cues',
  );
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

test('a stretch-logged workout is recognised by its tag', () => {
  assert.equal(isStretchWorkout({ source: 'stretch', entries: [] }), true);
  assert.equal(isStretchWorkout({ entries: [{ exercise: 'Bench Press' }] }), false);
  assert.equal(isStretchWorkout(null), false);
});

test('a stretch workout logged before the tag is recognised by routine name', () => {
  // The player writes the routine name into every entry's notes, which is all
  // the older workouts have to go on. Without this the day's log editor would
  // reopen them as editable rows — and saving would overwrite the poses.
  const names = new Set(['morning stretch']);
  const legacy = {
    entries: [{ exercise: 'Pigeon', notes: 'Morning Stretch' }, { exercise: 'Frog', notes: 'Morning Stretch' }],
  };
  assert.equal(isStretchWorkout(legacy, names), true);
  // A hand-logged workout that happens to share the date is untouched.
  assert.equal(isStretchWorkout({ entries: [{ exercise: 'Squat', notes: '' }] }, names), false);
  // One stretch entry among real ones isn't a stretch session.
  assert.equal(isStretchWorkout({
    entries: [{ exercise: 'Pigeon', notes: 'Morning Stretch' }, { exercise: 'Squat', notes: '' }],
  }, names), false);
  // No routine names known yet (routines not loaded) → tag-only matching.
  assert.equal(isStretchWorkout(legacy, new Set()), false);
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
  // Shorter than a transition on purpose: swapping legs isn't moving to a pose.
  assert.equal(DEFAULT_SWITCH_SEC, 10);
});
