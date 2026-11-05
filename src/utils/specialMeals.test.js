import test from 'node:test';
import assert from 'node:assert/strict';
import {
  holidaysForYear, holidayOn, eventTagOf, entryName, collectSpecialMeals,
  suggestedEventNames, untaggedHolidays, setEventTag,
} from './specialMeals.js';

const date = (y, name) => holidaysForYear(y).find(h => h.name === name).date;

test('moving holidays land on the right days', () => {
  assert.equal(date(2026, 'Thanksgiving'), '2026-11-26');
  assert.equal(date(2025, 'Thanksgiving'), '2025-11-27');
  assert.equal(date(2026, 'Easter'), '2026-04-05');
  assert.equal(date(2025, 'Easter'), '2025-04-20');
  assert.equal(date(2026, "Mother's Day"), '2026-05-10');
  assert.equal(date(2026, "Father's Day"), '2026-06-21');
  assert.equal(date(2026, 'Memorial Day'), '2026-05-25');
  assert.equal(date(2026, 'Labor Day'), '2026-09-07');
  assert.equal(date(2026, 'Super Bowl'), '2026-02-08');
});

test('holidayOn names the holiday on a day, or null', () => {
  assert.equal(holidayOn('2026-12-25'), 'Christmas');
  assert.equal(holidayOn('2026-11-26'), 'Thanksgiving');
  assert.equal(holidayOn('2026-11-25'), null);
  assert.equal(holidayOn('nope'), null);
});

test('eventTagOf trims and treats missing as blank; entryName mirrors the Food Log', () => {
  assert.equal(eventTagOf({ specialEvent: '  Thanksgiving ' }), 'Thanksgiving');
  assert.equal(eventTagOf({}), '');
  assert.equal(eventTagOf({ specialEvent: 3 }), '');
  assert.equal(entryName({ recipeName: 'Turkey' }), 'Turkey');
  assert.equal(entryName({ ingredientName: 'Pie' }), 'Pie');
  assert.equal(entryName({}), 'Unknown');
});

const LOG = {
  '2025-11-27': { entries: [
    { id: 'a', recipeName: 'Turkey', specialEvent: 'thanksgiving' },
    { id: 'b', ingredientName: 'Apple', mealSlot: 'snack' },
  ] },
  '2026-11-26': { entries: [
    { id: 'c', recipeName: 'Turkey', specialEvent: 'Thanksgiving', nutrition: { calories: 700 } },
    { id: 'd', ingredientName: 'Pumpkin pie', specialEvent: 'Thanksgiving' },
  ] },
  '2026-06-14': { entries: [{ id: 'e', recipeName: 'Cake', specialEvent: "Mom's birthday" }] },
  '2026-10-31': { entries: [{ id: 'f', ingredientName: 'Candy' }] },
};

test('collectSpecialMeals groups by event, case-insensitively, newest first', () => {
  const events = collectSpecialMeals(LOG);
  assert.deepEqual(events.map(e => e.name), ['Thanksgiving', "Mom's birthday"]);
  const tg = events[0];
  assert.deepEqual(tg.occasions.map(o => o.date), ['2026-11-26', '2025-11-27']);
  assert.deepEqual(tg.occasions[0].entries.map(e => e.id), ['c', 'd']);
  assert.deepEqual(tg.occasions[1].entries.map(e => e.id), ['a']);
  assert.deepEqual(collectSpecialMeals({}), []);
  assert.deepEqual(collectSpecialMeals(null), []);
});

test('suggestions put the day\'s holiday first, then used events, then other holidays', () => {
  const s = suggestedEventNames(LOG, '2026-12-25');
  assert.equal(s[0], 'Christmas');
  assert.deepEqual(s.slice(1, 3), ['Thanksgiving', "Mom's birthday"]);
  assert.ok(s.includes('Halloween'));
  // No duplicates, even across case.
  assert.equal(s.filter(n => n.toLowerCase() === 'thanksgiving').length, 1);
});

test('untaggedHolidays flags holidays with food logged but nothing tagged', () => {
  assert.deepEqual(untaggedHolidays(LOG), [{ name: 'Halloween', date: '2026-10-31', count: 1 }]);
  assert.deepEqual(untaggedHolidays(LOG, { since: '2026-11-01' }), []);
});

test('setEventTag changes only the tag, and only on the chosen entries', () => {
  const next = setEventTag(LOG, '2025-11-27', ['b'], ' Thanksgiving ');
  assert.equal(next['2025-11-27'].entries[1].specialEvent, 'Thanksgiving');
  assert.equal(next['2025-11-27'].entries[1].ingredientName, 'Apple');
  assert.equal(next['2025-11-27'].entries[0], LOG['2025-11-27'].entries[0]); // untouched entry kept as-is
  assert.equal(next['2026-11-26'], LOG['2026-11-26']); // other days untouched
  assert.equal(LOG['2025-11-27'].entries[1].specialEvent, undefined); // input not mutated

  const cleared = setEventTag(LOG, '2026-11-26', 'c', '');
  assert.ok(!('specialEvent' in cleared['2026-11-26'].entries[0]));
  assert.deepEqual(cleared['2026-11-26'].entries[0].nutrition, { calories: 700 });

  // Nothing to change → the same object back, so callers can skip the save.
  assert.equal(setEventTag(LOG, '2026-11-26', 'c', 'Thanksgiving'), LOG);
  assert.equal(setEventTag(LOG, '2030-01-01', 'x', 'X'), LOG);
});
