import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSteakhouse, guysNightState, guysNightPatch, guysNightSections,
  guysNightDates, addGuysNightDatePatch, removeGuysNightDatePatch,
  guysNightNextChanges, guysNightAvailability, guysNightAvailabilityPatch,
} from './guysNight.js';

test('steakhouse = any category mentioning steak, either category field', () => {
  assert.ok(isSteakhouse({ cuisines: ['Steakhouse'] }));
  assert.ok(isSteakhouse({ cuisines: ['american', 'steak'] }));
  assert.ok(isSteakhouse({ categories: ['Steak House'] }));
  assert.ok(!isSteakhouse({ cuisines: ['Italian'] }));
  assert.ok(!isSteakhouse({}));
});

test('state and patch round-trip; done wins over skip', () => {
  assert.equal(guysNightState({}), 'todo');
  assert.equal(guysNightState({ guysNightSkip: true }), 'skip');
  assert.equal(guysNightState({ guysNightDone: true, guysNightSkip: true }), 'done');
  assert.deepEqual(guysNightPatch('done'), { guysNightDone: true, guysNightSkip: undefined });
  assert.deepEqual(guysNightPatch('skip'), { guysNightDone: undefined, guysNightSkip: true });
  assert.deepEqual(guysNightPatch('todo'), { guysNightDone: undefined, guysNightSkip: undefined });
});

test('sections: steakhouses only, marks kept even without the category', () => {
  const s = guysNightSections([
    { id: '1', name: 'Peter Luger', cuisines: ['Steakhouse'], status: 'visited' },
    { id: '2', name: 'Keens', cuisines: ['Steakhouse'], status: 'want-to-try' },
    { id: '3', name: 'Carbone', cuisines: ['Italian'] },
    { id: '4', name: 'Old Homestead', cuisines: ['Steakhouse'], guysNightDone: true },
    { id: '5', name: 'Gallaghers', cuisines: ['Steakhouse'], guysNightSkip: true },
    { id: '6', name: 'Was a steakhouse', cuisines: ['Bar'], guysNightDone: true },
    { id: '7', name: 'Bowery Meat', cuisines: ['Steakhouse'], status: 'want-to-try', guysNightNext: true },
  ]);
  assert.deepEqual(s.todo.map(r => r.name), ['Bowery Meat', 'Keens', 'Peter Luger']);
  assert.deepEqual(s.done.map(r => r.name), ['Old Homestead', 'Was a steakhouse']);
  assert.deepEqual(s.skip.map(r => r.name), ['Gallaghers']);
  assert.equal(s.total, 6);
});

test('the same spot listed twice (e.g. a shared list) shows once', () => {
  const r = { id: '1', _ownerUid: 'u', name: 'Keens', cuisines: ['Steakhouse'] };
  assert.equal(guysNightSections([r, { ...r }]).todo.length, 1);
});

test('visit dates: add marks it done, dedupes, keeps newest first; bad days are ignored', () => {
  const r = { guysNightSkip: true, guysNightDates: ['2026-03-01', 'junk', '2026-03-01'] };
  assert.deepEqual(guysNightDates(r), ['2026-03-01']);
  const p = addGuysNightDatePatch(r, '2026-11-07');
  assert.deepEqual(p, { guysNightDone: true, guysNightSkip: undefined, guysNightDates: ['2026-11-07', '2026-03-01'] });
  assert.equal(addGuysNightDatePatch(r, '11/07/2026'), null);
  assert.deepEqual(removeGuysNightDatePatch({ guysNightDates: ['2026-11-07'] }, '2026-11-07'), { guysNightDates: undefined });
  assert.deepEqual(removeGuysNightDatePatch(p, '2026-03-01'), { guysNightDates: ['2026-11-07'] });
});

test('done sorts by most recent visit, undated spots last', () => {
  const { done } = guysNightSections([
    { id: '1', name: 'Alpha', cuisines: ['Steakhouse'], guysNightDone: true },
    { id: '2', name: 'Beta', cuisines: ['Steakhouse'], guysNightDone: true, guysNightDates: ['2025-01-01'] },
    { id: '3', name: 'Gamma', cuisines: ['Steakhouse'], guysNightDone: true, guysNightDates: ['2026-05-01', '2024-01-01'] },
  ]);
  assert.deepEqual(done.map(r => r.name), ['Gamma', 'Beta', 'Alpha']);
});

test('next guys night: one pick, picking another clears it, picking it again un-picks', () => {
  const a = { id: 'a', _ownerUid: 'u', name: 'Keens', guysNightNext: true };
  const b = { id: 'b', _ownerUid: 'u', name: 'Luger' };
  assert.deepEqual(guysNightNextChanges([a, b], b).map(c => [c.spot.id, c.patch.guysNightNext]), [['b', true], ['a', undefined]]);
  assert.deepEqual(guysNightNextChanges([a, b], a).map(c => [c.spot.id, c.patch.guysNightNext]), [['a', undefined]]);
  // The general ★ Next spot no longer counts for guys night.
  const s = guysNightSections([
    { id: '1', name: 'Alpha', cuisines: ['Steakhouse'], nextSpot: true },
    { id: '2', name: 'Zeta', cuisines: ['Steakhouse'], guysNightNext: true },
  ]);
  assert.deepEqual(s.todo.map(r => r.name), ['Zeta', 'Alpha']);
});

test('available this year: only this year counts; no sinks to the bottom', () => {
  assert.equal(guysNightAvailability({ guysNightAvailable: { year: 2026, yes: true } }, 2026), 'yes');
  assert.equal(guysNightAvailability({ guysNightAvailable: { year: 2026, yes: false } }, 2026), 'no');
  assert.equal(guysNightAvailability({ guysNightAvailable: { year: 2025, yes: true } }, 2026), null);
  assert.equal(guysNightAvailability({}, 2026), null);
  assert.deepEqual(guysNightAvailabilityPatch('no', 2026), { guysNightAvailable: { year: 2026, yes: false } });
  assert.deepEqual(guysNightAvailabilityPatch(null, 2026), { guysNightAvailable: undefined });
  const s = guysNightSections([
    { id: '1', name: 'Alpha', cuisines: ['Steakhouse'], guysNightAvailable: { year: 2026, yes: false } },
    { id: '2', name: 'Beta', cuisines: ['Steakhouse'] },
    { id: '3', name: 'Gamma', cuisines: ['Steakhouse'], guysNightAvailable: { year: 2025, yes: false } },
  ], 2026);
  assert.deepEqual(s.todo.map(r => r.name), ['Beta', 'Gamma', 'Alpha']);
});
