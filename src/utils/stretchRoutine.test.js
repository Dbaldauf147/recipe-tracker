import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCueSequence, routineDurationSec, normalizeRoutine, emptyRoutine, mmss, isStretchWorkout,
  DEFAULT_HOLD_SEC, DEFAULT_TRANSITION_SEC, DEFAULT_SWITCH_SEC, MAX_SEC,
  stepTiming, clampReps, DEFAULT_REPS, DEFAULT_REST_SEC, MAX_REPS,
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

// ── Reps ────────────────────────────────────────────────────────────────────
// Holding the same pose several times with a breather between. The load-bearing
// rule is that one rep is the default, so every routine written before reps
// existed plays exactly as it did — the tests above are that guarantee, and
// these are the new behaviour.

const REPPED = (over = {}) => ({
  id: 'r', name: 'Test', updatedAt: '', holdSec: 30, transitionSec: 20,
  switchSec: 10, reps: 3, restSec: 15,
  steps: [{ id: '1', name: 'Hamstring' }], ...over,
});

test('reps repeat the hold with a rest between, and never a trailing rest', () => {
  const cues = buildCueSequence(REPPED());
  assert.deepEqual(
    cues.map(c => [c.kind, c.seconds]),
    [['hold', 30], ['rest', 15], ['hold', 30], ['rest', 15], ['hold', 30]],
  );
  assert.equal(cues.at(-1).kind, 'hold', 'a routine never ends on a rest');
});

test('every hold says which rep it is, one-rep poses included', () => {
  const cues = buildCueSequence(REPPED()).filter(c => c.kind === 'hold');
  assert.deepEqual(cues.map(c => `${c.rep}/${c.reps}`), ['1/3', '2/3', '3/3']);
  const single = buildCueSequence(REPPED({ reps: 1 })).filter(c => c.kind === 'hold');
  assert.deepEqual(single.map(c => `${c.rep}/${c.reps}`), ['1/1']);
});

test('a both-sides pose does every rep of one side before switching', () => {
  const cues = buildCueSequence(REPPED({
    reps: 2, steps: [{ id: '1', name: 'Pigeon', bothSides: true }],
  }));
  assert.deepEqual(
    cues.map(c => [c.kind, c.side]),
    [['hold', 'left'], ['rest', 'left'], ['hold', 'left'],
     ['switch', 'right'],
     ['hold', 'right'], ['rest', 'right'], ['hold', 'right']],
  );
  // One pose, not two — the player's "1 / 1" counter must not split it.
  assert.ok(cues.every(c => c.stepIndex === 0));
  assert.ok(cues.every(c => c.stepName === 'Pigeon'));
});

test('a pose can pin its own reps and rest, or inherit either one', () => {
  const cues = buildCueSequence(REPPED({
    steps: [
      { id: '1', name: 'Inherits' },                  // 3 × 30s, 15s rest
      { id: '2', name: 'Pinned', reps: 2, restSec: 30 },
      { id: '3', name: 'Half pinned', reps: 2 },      // own reps, routine's rest
    ],
  }));
  const forStep = i => cues.filter(c => c.stepIndex === i && c.kind !== 'transition');
  assert.deepEqual(forStep(0).map(c => [c.kind, c.seconds]),
    [['hold', 30], ['rest', 15], ['hold', 30], ['rest', 15], ['hold', 30]]);
  assert.deepEqual(forStep(1).map(c => [c.kind, c.seconds]),
    [['hold', 30], ['rest', 30], ['hold', 30]]);
  assert.deepEqual(forStep(2).map(c => [c.kind, c.seconds]),
    [['hold', 30], ['rest', 15], ['hold', 30]]);
});

test('reps multiply the duration, and the rests come with them', () => {
  // 3 holds of 30 + 2 rests of 15 = 120.
  assert.equal(routineDurationSec(REPPED()), 30 * 3 + 15 * 2);
  // Both sides: two of those blocks plus one switch.
  assert.equal(
    routineDurationSec(REPPED({ steps: [{ id: '1', name: 'Pigeon', bothSides: true }] })),
    (30 * 3 + 15 * 2) * 2 + 10,
  );
});

test('a pinned rep count survives normalization; a blank one stays absent', () => {
  const r = normalizeRoutine(REPPED({
    steps: [{ id: '1', name: 'Pinned', reps: 4, restSec: 25 }, { id: '2', name: 'Inherits' }],
  }));
  assert.equal(r.steps[0].reps, 4);
  assert.equal(r.steps[0].restSec, 25);
  // Absent, not 0 or null — a present key means "override" and would stop the
  // pose following the routine's number.
  assert.ok(!('reps' in r.steps[1]), 'an un-pinned pose carries no reps key');
  assert.ok(!('restSec' in r.steps[1]), 'an un-pinned pose carries no restSec key');
  assert.equal(r.reps, 3);
  assert.equal(r.restSec, 15);
});

test('a routine saved before reps existed gets one rep, so it plays unchanged', () => {
  const old = normalizeRoutine({
    id: 'r', name: 'Old', holdSec: 40, transitionSec: 20,
    steps: [{ id: '1', name: 'a' }, { id: '2', name: 'b' }],
  });
  assert.equal(old.reps, DEFAULT_REPS);
  assert.equal(old.reps, 1);
  assert.equal(old.restSec, DEFAULT_REST_SEC);
  assert.deepEqual(buildCueSequence(old).map(c => c.kind), ['hold', 'transition', 'hold']);
});

test('rep counts are clamped, and junk falls back rather than emitting nothing', () => {
  assert.equal(clampReps(0), 1);
  assert.equal(clampReps(-4), 1);
  assert.equal(clampReps('abc'), 1);
  assert.equal(clampReps(999), MAX_REPS);
  assert.equal(clampReps(2.4), 2);
  // A step pinned to 0 falls back to the GLOBAL default (1), not the routine's
  // 3 — the same trap holdSec has, and the reason the editors delete the key
  // rather than storing an empty box. A pose can never play zero times.
  const cues = buildCueSequence(REPPED({ steps: [{ id: '1', name: 'x', reps: 0 }] }));
  assert.equal(cues.filter(c => c.kind === 'hold').length, 1);
  // Which is why normalization turns a pinned 0 into a real number on the way in.
  assert.equal(normalizeRoutine(REPPED({ steps: [{ id: '1', name: 'x', reps: 0 }] })).steps[0].reps, 1);
});

test('stepTiming reports what a pose will actually play at', () => {
  const r = REPPED();
  assert.deepEqual(stepTiming(r, { name: 'a' }), { reps: 3, restSec: 15, holdSec: 30 });
  assert.deepEqual(stepTiming(r, { name: 'b', reps: 5, restSec: 20, holdSec: 45 }),
    { reps: 5, restSec: 20, holdSec: 45 });
});
