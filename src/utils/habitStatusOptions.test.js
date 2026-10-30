import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeStatusOptions, effectiveStatusOptions, statusNameTaken, habitsByStatus, renameStatusOnHabits } from './habitStatusOptions.js';

const BUILT = ['Current', 'Automatically', 'Abandoned'];

test('sanitize drops junk, blanks and case-insensitive duplicates', () => {
  assert.deepEqual(sanitizeStatusOptions([' Current ', '', 3, 'current', 'Paused']), ['Current', 'Paused']);
  assert.deepEqual(sanitizeStatusOptions(null), []);
});

test('built-ins until a list is saved', () => {
  assert.deepEqual(effectiveStatusOptions(undefined, BUILT), BUILT);
  assert.deepEqual(effectiveStatusOptions([], BUILT), BUILT);
  assert.deepEqual(effectiveStatusOptions(['Abandoned', 'Paused'], BUILT), ['Abandoned', 'Paused']);
});

test('name clash check ignores the option being renamed', () => {
  assert.equal(statusNameTaken(['Paused', 'Current'], 'paused'), true);
  assert.equal(statusNameTaken(['Paused', 'Current'], 'Paused', 'Paused'), false);
  assert.equal(statusNameTaken(['Paused'], '  '), false);
});

test('groups by status, skips bad habits and blanks, sorts by name', () => {
  const map = habitsByStatus([
    { name: 'Read', status: 'Current' },
    { name: 'Floss', status: 'Current' },
    { name: 'Smoke', status: 'Current', habitType: 'bad' },
    { name: 'Walk', status: '' },
  ]);
  assert.deepEqual(Object.keys(map), ['Current']);
  assert.deepEqual(map.Current.map(h => h.name), ['Floss', 'Read']);
});

test('rename moves only habits on that status, and is a no-op otherwise', () => {
  const habits = [{ id: 1, status: 'Paused' }, { id: 2, status: 'Current' }];
  const next = renameStatusOnHabits(habits, 'Paused', 'Resting');
  assert.deepEqual(next.map(h => h.status), ['Resting', 'Current']);
  assert.equal(renameStatusOnHabits(habits, 'Nope', 'X'), habits);
});
