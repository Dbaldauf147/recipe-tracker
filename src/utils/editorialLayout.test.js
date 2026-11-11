import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUT_KEY, isEditorialEnabled, setEditorialEnabled, initialView, groupNavItems, weekDays,
} from './editorialLayout.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

test('the layout is off until this browser opts in, and turning it off leaves no trace', () => {
  const s = fakeStorage();
  assert.equal(isEditorialEnabled(s), false);
  setEditorialEnabled(true, s);
  assert.equal(isEditorialEnabled(s), true);
  setEditorialEnabled(false, s);
  assert.equal(isEditorialEnabled(s), false);
  assert.equal(s.getItem(LAYOUT_KEY), null);
});

test('blocked storage falls back to the classic layout instead of throwing', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(isEditorialEnabled(broken), false);
  assert.doesNotThrow(() => setEditorialEnabled(true, broken));
});

test('classic landing rules are unchanged; only the editorial layout lands on Home', () => {
  assert.equal(initialView('', false), 'list');
  assert.equal(initialView('#shopping', false), 'shopping');
  assert.equal(initialView('#detail/abc', false), 'detail');
  assert.equal(initialView('#home', false), 'list'); // stale link after switching off
  assert.equal(initialView('', true), 'home');
  assert.equal(initialView('#home', true), 'home');
  assert.equal(initialView('#shopping', true), 'shopping');
});

const NAV = [
  { label: 'Recipes', id: 'weekly-menu', icon: 'restaurant_menu' },
  { label: 'Nutrition', icon: 'clinical_notes', submenu: [
    { label: 'Goals', action: 'nutrition-goals' },
    { label: 'Design a Meal', action: 'design-meal' },
  ] },
  { label: 'Week Plan', action: 'week-plan', icon: 'calendar_month' },
  { label: 'Shopping List', action: 'shopping', icon: 'shopping_cart' },
  { label: 'Workout', action: 'workout', icon: 'fitness_center' },
];

test('regroups the sidebar entries into Eat / Plan / Track without adding any', () => {
  const groups = groupNavItems(NAV);
  assert.deepEqual(groups.map(g => g.label), ['Eat', 'Plan', 'Track']);
  assert.deepEqual(groups[0].items.map(i => i.label), ['Recipes', 'Design a Meal']);
  assert.deepEqual(groups[1].items.map(i => i.label), ['Week Plan', 'Shopping List']);
  assert.deepEqual(groups[2].items.map(i => i.label), ['Goals', 'Workout']);
  // Every entry appears exactly once, and nothing was invented.
  const all = groups.flatMap(g => g.items.map(i => i.label)).sort();
  assert.deepEqual(all, ['Design a Meal', 'Goals', 'Recipes', 'Shopping List', 'Week Plan', 'Workout']);
  // Submenu entries, text-only in the classic sidebar, get an icon here.
  assert.ok(groups[2].items[0].icon);
});

test('an entry it does not recognise is kept under More, and empty groups are dropped', () => {
  const groups = groupNavItems([{ label: 'Brand New', action: 'brand-new', icon: 'star' }]);
  assert.deepEqual(groups.map(g => g.label), ['More']);
  assert.equal(groups[0].items[0].action, 'brand-new');
  assert.deepEqual(groupNavItems([]), []);
});

test('weekDays is Monday..Sunday around the given day, in local dates', () => {
  const days = weekDays(new Date(2026, 10, 11)); // Wed 11 Nov 2026
  assert.equal(days.length, 7);
  assert.equal(days[0].key, '2026-11-09');
  assert.equal(days[2].key, '2026-11-11');
  assert.equal(days[6].key, '2026-11-15');
  // A Sunday belongs to the week that started the Monday before it.
  assert.equal(weekDays(new Date(2026, 10, 15))[0].key, '2026-11-09');
  // Across a month boundary.
  assert.equal(weekDays(new Date(2026, 11, 2))[0].key, '2026-11-30');
});
