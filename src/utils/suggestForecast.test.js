import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  forecastSuggestion, describeForecast, suggestPaceFromLog, addDaysKey, daysBetweenKeys, nextInSeasonKey, NEVER_DAYS,
} from './suggestForecast.js';

const TODAY = '2026-10-17';
const cand = (id, lastCooked, extra = {}) => ({
  id, category: 'lunch-dinner', lastCooked, ingredientFloor: null, ingredients: [], fixedPoints: 0,
  availableFrom: null, planned: false, ...extra,
});
const snap = (candidates, extra = {}) => ({
  today: TODAY, weights: { staleness: 1, ingredients: 1 }, ingredientDates: {},
  pace: { breakfast: 1 / 7, 'lunch-dinner': 1 }, candidates, excluded: {}, ...extra,
});
// 12 meals last eaten 20..31 days ago, plus the target.
const field = () => Array.from({ length: 12 }, (_, i) => cand(`m${i}`, addDaysKey(TODAY, -(20 + i))));

test('date keys add and subtract across month ends', () => {
  assert.equal(addDaysKey('2026-10-31', 1), '2026-11-01');
  assert.equal(addDaysKey('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetweenKeys('2026-10-17', '2026-11-03'), 17);
});

test('already in the top 10 → suggested now, with its rank', () => {
  const r = forecastSuggestion(snap([cand('t', addDaysKey(TODAY, -40)), ...field()]), 't');
  assert.deepEqual(r, { kind: 'now', rank: 1, category: 'lunch-dinner' });
});

test('below the top 10 → a later date, as the meals above it get cooked', () => {
  // Eaten 5 days ago: 12 meals sit above it. Cooking one a day from the top
  // pushes those down one by one; 3 have to go before it is 10th.
  const r = forecastSuggestion(snap([cand('t', addDaysKey(TODAY, -5)), ...field()]), 't');
  assert.equal(r.kind, 'later');
  assert.equal(r.rankNow, 13);
  assert.equal(r.days, 3);
  assert.equal(r.date, addDaysKey(TODAY, 3));
});

test('a faster pace brings it sooner', () => {
  const slow = forecastSuggestion(snap([cand('t', addDaysKey(TODAY, -5)), ...field()], { pace: { breakfast: 0.1, 'lunch-dinner': 0.5 } }), 't');
  const fast = forecastSuggestion(snap([cand('t', addDaysKey(TODAY, -5)), ...field()], { pace: { breakfast: 0.1, 'lunch-dinner': 3 } }), 't');
  assert.ok(fast.days < slow.days, `${fast.days} < ${slow.days}`);
});

test('cooking a meal resets its key ingredients for everyone who shares them', () => {
  // Target shares "salmon" with the meals above it; each cook makes salmon
  // fresh, so the target's ingredient points drop too — it can still get there
  // because the others lose their staleness as well.
  const others = field().map(c => ({ ...c, ingredients: ['salmon'] }));
  const r = forecastSuggestion(snap([cand('t', addDaysKey(TODAY, -5), { ingredients: ['salmon'] }), ...others], {
    ingredientDates: { salmon: addDaysKey(TODAY, -3) },
  }), 't');
  assert.equal(r.kind, 'later');
});

test('skipped → waits for the skip to run out', () => {
  const until = addDaysKey(TODAY, 6);
  const r = forecastSuggestion(snap([cand('t', addDaysKey(TODAY, -60), { availableFrom: until, waiting: 'skip' }), ...field()]), 't');
  assert.equal(r.kind, 'later');
  assert.equal(r.date, until);
  assert.equal(r.waitingFor, 'skip');
  assert.equal(r.until, until);
  assert.equal(r.rankNow, null);
});

test("in this week's plan / filtered out / other categories", () => {
  assert.equal(forecastSuggestion(snap([cand('t', null, { planned: true })]), 't').kind, 'this-week');
  assert.equal(forecastSuggestion(snap([], { excluded: { t: 'filtered' } }), 't').kind, 'filtered');
  assert.deepEqual(forecastSuggestion(snap([cand('t', null, { category: 'snacks' })]), 't'), { kind: 'no-column', category: 'snacks' });
  assert.equal(forecastSuggestion(snap([cand('t', null, { category: undefined })]), 't'), null);
  assert.equal(forecastSuggestion(null, 't'), null);
});

test('never cooked meals stay pinned at NEVER_DAYS', () => {
  // 11 never-cooked meals hold the top 10 until cooked; the target was eaten
  // yesterday and needs them cooked first.
  const nevers = Array.from({ length: 11 }, (_, i) => cand(`n${i}`, null));
  const r = forecastSuggestion(snap([cand('t', addDaysKey(TODAY, -1)), ...nevers]), 't');
  assert.equal(r.kind, 'later');
  assert.equal(r.rankNow, 12);
  assert.equal(r.days, 2);
  assert.equal(NEVER_DAYS, 9999);
});

test('not within a year when nothing ever gets cooked past it', () => {
  const r = forecastSuggestion(snap([cand('t', TODAY), ...field()], { pace: { breakfast: 0, 'lunch-dinner': 0 } }), 't', { maxDays: 30 });
  assert.equal(r.kind, 'not-soon');
});

test('pace: distinct recipe entries per column over the window, floored at one a week', () => {
  const byId = new Map([['a', { category: 'lunch-dinner' }], ['b', { category: 'breakfast' }]]);
  const log = {
    [addDaysKey(TODAY, -1)]: { entries: [{ type: 'recipe', recipeId: 'a' }, { type: 'recipe', recipeId: 'a' }, { type: 'recipe', recipeId: 'b' }] },
    [addDaysKey(TODAY, -2)]: { entries: [{ type: 'recipe', recipeId: 'a' }, { type: 'custom' }] },
    [addDaysKey(TODAY, -40)]: { entries: [{ type: 'recipe', recipeId: 'a' }] },
  };
  const p = suggestPaceFromLog(log, byId, TODAY, 28);
  assert.equal(p['lunch-dinner'], 1 / 7); // 2 in 28 days is under the one-a-week floor
  assert.equal(p.breakfast, 1 / 7);
  const busy = {};
  for (let i = 1; i <= 28; i++) busy[addDaysKey(TODAY, -i)] = { entries: [{ type: 'recipe', recipeId: 'a' }] };
  assert.equal(suggestPaceFromLog(busy, byId, TODAY, 28)['lunch-dinner'], 1);
});

test('next in-season month start', () => {
  assert.equal(nextInSeasonKey('2026-10-17', m => m === 12 || m <= 2), '2026-12-01');
  assert.equal(nextInSeasonKey('2026-10-17', m => m >= 6 && m <= 8), '2027-06-01');
  assert.equal(nextInSeasonKey('2026-10-17', () => false), null);
});

test('describeForecast words', async () => {
  const { friendlyDateKey } = await import('./suggestForecast.js');
  const s = snap([]);
  assert.equal(friendlyDateKey('2026-11-03', TODAY), 'Tue, Nov 3');
  assert.equal(friendlyDateKey('2027-01-05', TODAY), 'Tue, Jan 5, 2027');
  assert.equal(describeForecast({ kind: 'now', rank: 3, category: 'lunch-dinner' }, s).headline, 'In Suggested Meals now — #3 in Lunch & Dinner');
  const later = describeForecast({ kind: 'later', date: '2026-11-03', days: 17, rankNow: 24, category: 'lunch-dinner', waitingFor: null }, s);
  assert.equal(later.headline, 'Next in Suggested Meals: around Tue, Nov 3 (in 17 days)');
  assert.equal(later.detail, '#24 in Lunch & Dinner today. Estimate, if you keep cooking about 7 suggested Lunch & Dinner meals a week.');
  const skip = describeForecast({ kind: 'later', date: '2026-10-24', days: 1, rankNow: null, category: 'breakfast', waitingFor: 'skip', until: '2026-10-24' }, s);
  assert.match(skip.headline, /\(tomorrow\)$/);
  assert.match(skip.detail, /^Skipped until Sat, Oct 24\. Estimate, if you keep cooking about 1 suggested Breakfast meal a week\.$/);
  assert.equal(describeForecast(null, s), null);
});

test('why a meal will not show up', () => {
  const say = (f) => describeForecast(f, snap([])).detail;
  assert.match(say({ kind: 'filtered', category: null, reason: 'retired' }), /Retired/);
  assert.match(say({ kind: 'filtered', category: null, reason: 'rare' }), /Rare/);
  assert.match(say({ kind: 'filtered', category: null, reason: 'toTry' }), /To Try/);
  assert.match(say({ kind: 'filtered', category: null, reason: 'filter:cuisine' }), /cuisine filter/);
  assert.match(say({ kind: 'no-column', category: 'snacks' }), /Snacks/);
  // Ranked too low: today's score against the last place shown.
  const nevers = Array.from({ length: 11 }, (_, i) => cand(`n${i}`, null));
  const r = forecastSuggestion(snap([cand('t', TODAY), ...nevers]), 't', { maxDays: 0 });
  assert.equal(r.kind, 'not-soon');
  assert.ok(r.scoreNow < r.cutoff);
  assert.match(say(r), /scores/);
});
