import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStorage, weekIngredients, defaultShelfDays, addDaysKey, daysUntil, buildUseByRows, withShelfOverride } from './historyShelfLife.js';

const recipes = {
  a: { title: 'Chicken bowl', ingredients: [{ ingredient: 'Chicken breast' }, { ingredient: 'Spinach' }, { ingredient: '' }] },
  b: { title: 'Smoothie', ingredients: [{ ingredient: 'spinach ' }, { ingredient: 'Frozen mystery thing', storage: 'Freezer' }] },
};
const get = id => recipes[id] || null;

test('normalizeStorage reads free text', () => {
  assert.equal(normalizeStorage('Refrigerator'), 'Fridge');
  assert.equal(normalizeStorage('freezer'), 'Freezer');
  assert.equal(normalizeStorage('Pantry / cupboard'), 'Pantry');
  assert.equal(normalizeStorage(''), '');
});

test('weekIngredients dedupes by name across recipes and skips missing recipes', () => {
  const items = weekIngredients(['a', 'b', 'gone'], get);
  assert.deepEqual(items.map(i => i.key), ['chicken breast', 'spinach', 'frozen mystery thing']);
  assert.deepEqual(items[1].recipes, ['Chicken bowl', 'Smoothie']);
  assert.equal(items[2].storage, 'Freezer');
});

test('defaultShelfDays prefers the ingredient DB (shorter end), then the guide', () => {
  assert.deepEqual(
    defaultShelfDays('Chicken breast', '', { storage: 'Fridge', minShelf: '2', maxShelf: '3' }),
    { days: 2, storage: 'Fridge', source: 'db' },
  );
  assert.equal(defaultShelfDays('milk', '', null).source, 'guide');
  assert.equal(defaultShelfDays('milk', '', null).days, 7);
  assert.equal(defaultShelfDays('milk', 'Freezer', null).days, 90);
  // Recipe stores it differently from the DB → the DB's numbers don't apply.
  assert.equal(defaultShelfDays('milk', 'Freezer', { storage: 'Fridge', minShelf: 5 }).days, 90);
  assert.equal(defaultShelfDays('zzqx', '', null), null);
});

test('date helpers', () => {
  assert.equal(addDaysKey('2026-10-30', 3), '2026-11-02');
  assert.equal(addDaysKey('bad', 3), '');
  assert.equal(daysUntil('2026-10-14', '2026-10-11'), 3);
  assert.equal(daysUntil('2026-10-09', '2026-10-11'), -2);
});

test('buildUseByRows: overrides win, soonest first, unknown last, counted from weekStart', () => {
  const entry = { date: '2026-10-04', weekStart: '2026-10-04', recipeIds: ['a', 'b'], shelfLife: { spinach: 4 } };
  const db = n => (n.toLowerCase() === 'chicken breast' ? { storage: 'Fridge', minShelf: 2, maxShelf: 3 } : null);
  const rows = buildUseByRows(entry, get, db, '2026-10-05');
  assert.deepEqual(rows.map(r => r.key), ['chicken breast', 'spinach', 'frozen mystery thing']);
  assert.equal(rows[0].expires, '2026-10-06');
  assert.equal(rows[0].left, 1);
  assert.equal(rows[1].source, 'you');
  assert.equal(rows[1].expires, '2026-10-08');
  assert.equal(rows[2].expires, '');
});

test('withShelfOverride sets, clears on blank, and drops a value equal to the default', () => {
  assert.deepEqual(withShelfOverride(undefined, 'kale', '5', 3), { kale: 5 });
  assert.deepEqual(withShelfOverride({ kale: 5 }, 'kale', '', 3), {});
  assert.deepEqual(withShelfOverride({ kale: 5 }, 'kale', '3', 3), {});
});
