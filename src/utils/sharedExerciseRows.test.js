import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exerciseKey, normalizeSharedRows, diffExerciseRows, isEmptyDiff, replayDiff,
  mergeExerciseLibraries,
} from './sharedExerciseRows.js';

const row = (exercise, extra = {}) => ({ exercise, muscleGroup: '', videos: [], ...extra });

test('exerciseKey trims and lowercases', () => {
  assert.equal(exerciseKey('  Bench Press '), 'bench press');
  assert.equal(exerciseKey(null), '');
});

test('normalizeSharedRows drops junk and same-name duplicates, keeping the first', () => {
  const out = normalizeSharedRows([
    row(' Squat '),
    null,
    'nope',
    { muscleGroup: 'Legs' },
    row('SQUAT', { muscleGroup: 'Legs' }),
  ]);
  assert.deepEqual(out.map(r => r.exercise), ['Squat']);
  assert.equal(out[0].muscleGroup, '');
});

test('normalizeSharedRows returns [] for a missing field', () => {
  assert.deepEqual(normalizeSharedRows(undefined), []);
});

test('diff reports an add', () => {
  const d = diffExerciseRows([row('Squat')], [row('Deadlift'), row('Squat')]);
  assert.deepEqual(d.added.map(r => r.exercise), ['Deadlift']);
  assert.deepEqual(d.changed, []);
  assert.deepEqual(d.removed, []);
});

test('diff reports a removal by key, not by index', () => {
  const d = diffExerciseRows([row('Squat'), row('Deadlift')], [row('Deadlift')]);
  assert.deepEqual(d.removed, ['squat']);
  assert.deepEqual(d.added, []);
});

test('diff reports an edit, and reordering alone is not an edit', () => {
  const edited = diffExerciseRows(
    [row('Squat', { muscleGroup: '' })],
    [row('Squat', { muscleGroup: 'Legs' })],
  );
  assert.deepEqual(edited.changed.map(r => r.muscleGroup), ['Legs']);

  const reordered = diffExerciseRows([row('A'), row('B')], [row('B'), row('A')]);
  assert.ok(isEmptyDiff(reordered));
});

test('a rename is a removal plus an add', () => {
  const d = diffExerciseRows([row('Bench press')], [row('Barbell bench press')]);
  assert.deepEqual(d.removed, ['bench press']);
  assert.deepEqual(d.added.map(r => r.exercise), ['Barbell bench press']);
});

// The reason writes are diffs and not array replaces: this browser's copy of
// the list is always a little bit out of date, and the rows it has never seen
// belong to other people.
test('replay leaves an exercise another account added untouched', () => {
  const prev = [row('Squat')];
  const next = [row('Lunge'), row('Squat')];
  const server = [row('Squat'), row('Overhead press')]; // added elsewhere meanwhile

  const out = replayDiff(server, diffExerciseRows(prev, next));
  assert.deepEqual(out.map(r => r.exercise), ['Lunge', 'Squat', 'Overhead press']);
});

test('replay deletes only what was actually deleted', () => {
  const prev = [row('Squat'), row('Deadlift')];
  const next = [row('Squat')];
  const server = [row('Squat'), row('Deadlift'), row('Row')];

  const out = replayDiff(server, diffExerciseRows(prev, next));
  assert.deepEqual(out.map(r => r.exercise), ['Squat', 'Row']);
});

test('replay applies an edit in place without reshuffling the list', () => {
  const prev = [row('A'), row('B'), row('C')];
  const next = [row('A'), row('B', { muscleGroup: 'Back' }), row('C')];

  const out = replayDiff([row('A'), row('B'), row('C')], diffExerciseRows(prev, next));
  assert.deepEqual(out.map(r => r.exercise), ['A', 'B', 'C']);
  assert.equal(out[1].muscleGroup, 'Back');
});

test('an add whose name someone else already used keeps their row', () => {
  const d = diffExerciseRows([], [row('Squat', { muscleGroup: 'Mine' })]);
  const out = replayDiff([row('Squat', { muscleGroup: 'Theirs' })], d);
  assert.equal(out.length, 1);
  assert.equal(out[0].muscleGroup, 'Theirs');
});

test('an edit to a row deleted elsewhere does not resurrect it', () => {
  const d = diffExerciseRows([row('Squat')], [row('Squat', { nickname: 'squatty' })]);
  assert.deepEqual(replayDiff([row('Deadlift')], d).map(r => r.exercise), ['Deadlift']);
});

// The guard that matters most: a page that failed to load the library must not
// be able to interpret "I have nothing" as "delete everything".
test('an edit made against an unloaded list writes nothing', () => {
  const d = diffExerciseRows([], []);
  assert.ok(isEmptyDiff(d));
  assert.deepEqual(replayDiff([row('Squat'), row('Deadlift')], d).map(r => r.exercise),
    ['Squat', 'Deadlift']);
});

test('a deliberate clear-out is still allowed through', () => {
  const d = diffExerciseRows([row('Squat')], []);
  assert.deepEqual(d.removed, ['squat']);
  assert.deepEqual(replayDiff([row('Squat')], d), []);
});

test('merge puts shared first and keeps this account-only leftovers', () => {
  const out = mergeExerciseLibraries(
    [row('Squat', { muscleGroup: 'Legs' })],
    [row('SQUAT', { muscleGroup: 'Stale' }), row('My own move')],
  );
  assert.deepEqual(out.map(r => r.exercise), ['Squat', 'My own move']);
  assert.equal(out[0].muscleGroup, 'Legs', 'shared wins the name collision');
});

test('merge tolerates missing sides', () => {
  assert.deepEqual(mergeExerciseLibraries(undefined, undefined), []);
  assert.deepEqual(mergeExerciseLibraries([row('A')], null).map(r => r.exercise), ['A']);
});
