import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTypePaused, isTypePaused, typesInRotation, pausedTypes,
  toggleTypePaused, withoutTypePause, pausedLast,
} from './workoutTypeRotation.js';

const TYPES = ['Pull', 'Push', 'Legs', 'Snack'];

test('a missing or junk field normalizes to nothing paused', () => {
  for (const bad of [null, undefined, 'nope', 7, ['Pull'], {}]) {
    assert.deepEqual(normalizeTypePaused(bad), {});
  }
});

test('a falsy entry reads the same as an absent one', () => {
  // { Snack: false } and {} must not behave differently — the whole reason
  // unpausing DELETES the key rather than writing false.
  assert.deepEqual(normalizeTypePaused({ Snack: false }), {});
  assert.equal(isTypePaused({ Snack: false }, 'Snack'), false);
  assert.deepEqual(typesInRotation(TYPES, { Snack: false }), TYPES);
});

test('paused types drop out of the rotation, order preserved', () => {
  assert.deepEqual(typesInRotation(TYPES, { Push: true }), ['Pull', 'Legs', 'Snack']);
  assert.deepEqual(typesInRotation(TYPES, {}), TYPES);
  assert.deepEqual(typesInRotation(TYPES, null), TYPES);
});

test('pausing everything leaves an empty rotation, not a fallback', () => {
  // Callers must render "no suggestion" rather than starring something paused.
  const all = Object.fromEntries(TYPES.map(t => [t, true]));
  assert.deepEqual(typesInRotation(TYPES, all), []);
});

test('typesInRotation tolerates an empty type list', () => {
  assert.deepEqual(typesInRotation([], { Push: true }), []);
  assert.deepEqual(typesInRotation(null, { Push: true }), []);
});

test('toggling pauses, then resumes by deleting the key', () => {
  let p = {};
  p = toggleTypePaused(p, 'Snack');
  assert.deepEqual(p, { Snack: true });
  p = toggleTypePaused(p, 'Snack');
  assert.deepEqual(p, {}, 'resuming must remove the key, not set it false');
  assert.ok(!('Snack' in p));
});

test('toggling one type leaves the others alone, and does not mutate the input', () => {
  const before = { Push: true };
  const after = toggleTypePaused(before, 'Snack');
  assert.deepEqual(before, { Push: true }, 'input map must not be mutated');
  assert.deepEqual(after, { Push: true, Snack: true });
});

test('deleting a type drops its pause', () => {
  // Otherwise re-adding a type you had paused brings the pause back with it.
  assert.deepEqual(withoutTypePause({ Push: true, Snack: true }, 'Snack'), { Push: true });
  const same = { Push: true };
  assert.deepEqual(withoutTypePause(same, 'Legs'), { Push: true });
  assert.deepEqual(same, { Push: true }, 'input map must not be mutated');
});

test('pausedTypes lists the paused names', () => {
  assert.deepEqual(pausedTypes({ Snack: true, Push: true }).sort(), ['Push', 'Snack']);
  assert.deepEqual(pausedTypes({ Snack: false }), []);
  assert.deepEqual(pausedTypes(undefined), []);
});

test('pausedLast sorts paused types behind active ones', () => {
  const cmp = pausedLast({ Snack: true, Push: true });
  assert.ok(cmp('Pull', 'Snack') < 0);
  assert.ok(cmp('Snack', 'Pull') > 0);
  assert.equal(cmp('Pull', 'Legs'), 0, 'two active types tie, so the next key decides');
  assert.equal(cmp('Snack', 'Push'), 0, 'two paused types tie too');
});

test('pausedLast is only a tie-break, so staleness still orders each group', () => {
  // How the pill row actually sorts: paused block last, most-overdue first
  // inside each block, configured order breaking a tie.
  const paused = { Snack: true };
  const since = { Pull: 12, Push: 4, Legs: 0, Snack: 30 };
  const order = TYPES
    .map((t, i) => ({ t, i }))
    .sort((a, b) => pausedLast(paused)(a.t, b.t) || (since[b.t] - since[a.t]) || (a.i - b.i))
    .map(x => x.t);
  assert.deepEqual(order, ['Pull', 'Push', 'Legs', 'Snack']);
  assert.equal(order.at(-1), 'Snack', 'the stalest type is still last, because it is paused');
});
