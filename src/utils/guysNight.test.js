import test from 'node:test';
import assert from 'node:assert/strict';
import { isSteakhouse, guysNightState, guysNightPatch, guysNightSections } from './guysNight.js';

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
    { id: '7', name: 'Bowery Meat', cuisines: ['Steakhouse'], status: 'want-to-try', nextSpot: true },
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
