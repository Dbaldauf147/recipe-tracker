import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMealVoteSettings, mealVoteDue, voteWeekOf, weekLabel,
  buildMealVoteSnapshot, applyLogToSnapshot, rankForVote,
  sanitizePicks, voterForToken, tallyBallot, latestBallot, weeksToPrune,
  joanneVerdict, fillOptionDetails,
} from './mealVote.js';

const cand = (id, category, lastCooked, extra = {}) => ({
  id, category, lastCooked, ingredientFloor: null, ingredients: [], fixedPoints: 0,
  availableFrom: null, planned: false, ...extra,
});
const snapOf = (candidates, extra = {}) => ({
  today: '2026-11-10',
  weights: { staleness: 1, ingredients: 1 },
  ingredientDates: {},
  candidates,
  titles: Object.fromEntries(candidates.map(c => [c.id, `Meal ${c.id}`])),
  ...extra,
});

test('settings: defaults to Friday 8am, drops bad and duplicate addresses', () => {
  const s = normalizeMealVoteSettings({
    enabled: true,
    voters: [
      { name: ' Dan ', email: 'Dan@Example.com' },
      { name: 'Dupe', email: 'dan@example.com' },
      { name: 'Bad', email: 'nope' },
      { email: 'jo@example.com' },
    ],
  });
  assert.deepEqual(s, {
    enabled: true,
    voters: [{ name: 'Dan', email: 'dan@example.com' }, { name: 'jo', email: 'jo@example.com' }],
    sendDay: 5,
    sendHour: 8,
  });
  assert.equal(normalizeMealVoteSettings(null).enabled, false);
  assert.equal(normalizeMealVoteSettings({ sendDay: 9, sendHour: -1 }).sendDay, 5);
});

test('due: on the send day from the send hour onwards, and only when on', () => {
  const s = { enabled: true, voters: [{ email: 'a@b.co' }], sendDay: 5, sendHour: 8 };
  assert.equal(mealVoteDue(s, { dayOfWeek: 5, hour: 7 }), false);
  assert.equal(mealVoteDue(s, { dayOfWeek: 5, hour: 8 }), true);
  assert.equal(mealVoteDue(s, { dayOfWeek: 5, hour: 20 }), true);
  assert.equal(mealVoteDue(s, { dayOfWeek: 6, hour: 9 }), false);
  assert.equal(mealVoteDue({ ...s, enabled: false }, { dayOfWeek: 5, hour: 9 }), false);
  assert.equal(mealVoteDue({ ...s, voters: [] }, { dayOfWeek: 5, hour: 9 }), false);
});

test('week: the next Sunday on or after the send day', () => {
  assert.equal(voteWeekOf('2026-11-13'), '2026-11-15'); // Friday
  assert.equal(voteWeekOf('2026-11-14'), '2026-11-15'); // Saturday
  assert.equal(voteWeekOf('2026-11-15'), '2026-11-15'); // Sunday itself
  assert.equal(voteWeekOf('2026-11-16'), '2026-11-22'); // Monday
  assert.equal(voteWeekOf('2026-12-30'), '2027-01-03'); // across the year
  assert.equal(weekLabel('2026-11-15'), 'Nov 15');
});

test('snapshot: keeps the two columns and only meals that have a title', () => {
  const forecast = {
    today: '2026-11-10',
    weights: { staleness: 2, ingredients: 0 },
    ingredientDates: { kale: '2026-11-01' },
    candidates: [
      cand('a', 'breakfast', '2026-11-01'),
      cand('b', 'snacks', null),
      cand('c', 'lunch-dinner', null),
      cand('gone', 'lunch-dinner', null),
    ],
  };
  const snap = buildMealVoteSnapshot(forecast, [{ id: 'a', title: 'Oats' }, { id: 'b', title: 'Nuts' }, { id: 'c', title: ' Chili ' }]);
  assert.deepEqual(snap.candidates.map(c => c.id), ['a', 'c']);
  assert.deepEqual(snap.titles, { a: 'Oats', c: 'Chili' });
  assert.deepEqual(snap.weights, { staleness: 2, ingredients: 0 });
  assert.equal(buildMealVoteSnapshot(null, []), null);
  assert.equal(buildMealVoteSnapshot({ today: '2026-11-10', candidates: [] }, []), null);
});

test('rank: longest since eaten first, never-eaten on top, five per column', () => {
  const list = [
    cand('b1', 'breakfast', '2026-11-09'),
    cand('b2', 'breakfast', '2026-10-01'),
    cand('b3', 'breakfast', null),
    ...[1, 2, 3, 4, 5, 6, 7].map(n => cand(`l${n}`, 'lunch-dinner', `2026-10-0${n}`)),
  ];
  const r = rankForVote(snapOf(list), '2026-11-13');
  assert.deepEqual(r.breakfast.map(o => o.id), ['b3', 'b2', 'b1']);
  assert.deepEqual(r['lunch-dinner'].map(o => o.id), ['l1', 'l2', 'l3', 'l4', 'l5']);
  assert.deepEqual(r.breakfast[0], { id: 'b3', title: 'Meal b3', why: 'never cooked' });
});

test('rank: key ingredients, fixed points and skips all count', () => {
  const list = [
    cand('plain', 'lunch-dinner', '2026-10-01'),
    cand('kale', 'lunch-dinner', '2026-11-01', { ingredients: ['kale'] }),
    cand('boost', 'lunch-dinner', '2026-11-12', { fixedPoints: 100000 }),
    cand('skipped', 'lunch-dinner', null, { availableFrom: '2026-11-20' }),
  ];
  const snap = snapOf(list, { ingredientDates: { kale: '2026-09-01' } });
  // plain: 43 days. kale: 12 + 73 = 85. boost: 100001. skipped sits out.
  assert.deepEqual(rankForVote(snap, '2026-11-13')['lunch-dinner'].map(o => o.id), ['boost', 'kale', 'plain']);
  // Once the skip lapses the never-eaten meal comes back near the top.
  assert.deepEqual(rankForVote(snap, '2026-11-20')['lunch-dinner'].map(o => o.id), ['boost', 'skipped', 'kale', 'plain']);
  // With ingredients switched off the order is by the meal alone.
  const off = { ...snap, weights: { staleness: 1, ingredients: 0 } };
  assert.deepEqual(rankForVote(off, '2026-11-13')['lunch-dinner'].map(o => o.id), ['boost', 'plain', 'kale']);
});

test('rank: this week\'s plan is left out, then counts as eaten', () => {
  const list = [
    cand('planned', 'breakfast', '2026-01-01', { planned: true, ingredients: ['oats'] }),
    cand('other', 'breakfast', '2026-11-01', { ingredients: ['oats'] }),
    cand('third', 'breakfast', '2026-11-05'),
  ];
  const snap = snapOf(list, { ingredientDates: { oats: '2026-10-01' } });
  assert.deepEqual(rankForVote(snap, '2026-11-13').breakfast.map(o => o.id), ['other', 'third']);
  // Eight days on it is back, counted as eaten on the snapshot day — not on
  // its January date, which would have put it first — and so are its oats.
  // other: 17 + 8. planned: 8 + 8. third: 13.
  assert.deepEqual(rankForVote(snap, '2026-11-18').breakfast.map(o => o.id), ['other', 'planned', 'third']);
});

test('rank: nothing to rank is two empty columns, not a throw', () => {
  assert.deepEqual(rankForVote(null, '2026-11-13'), { breakfast: [], 'lunch-dinner': [] });
  assert.deepEqual(rankForVote(snapOf([]), 'nonsense'), { breakfast: [], 'lunch-dinner': [] });
});

test('log: meals eaten since the snapshot drop down the list', () => {
  const list = [
    cand('a', 'breakfast', '2026-10-01', { ingredients: ['egg'] }),
    cand('b', 'breakfast', '2026-10-05', { ingredients: ['egg'] }),
    cand('c', 'breakfast', '2026-10-20'),
  ];
  const snap = snapOf(list, { ingredientDates: { egg: '2026-10-05' } });
  assert.deepEqual(rankForVote(snap, '2026-11-13').breakfast.map(o => o.id), ['a', 'b', 'c']);
  const log = {
    '2026-11-12': { entries: [{ type: 'recipe', recipeId: 'a' }, { type: 'custom_meal' }, { type: 'recipe', recipeId: 'unknown' }] },
    '2026-09-01': { entries: [{ type: 'recipe', recipeId: 'c' }] }, // older than known: ignored
    junk: { entries: [{ type: 'recipe', recipeId: 'b' }] },
  };
  const next = applyLogToSnapshot(snap, log);
  assert.equal(next.candidates[0].lastCooked, '2026-11-12');
  assert.equal(next.candidates[2].lastCooked, '2026-10-20');
  assert.equal(next.ingredientDates.egg, '2026-11-12');
  // a: 1 + 1. b: 39 + 1. c: 24.
  assert.deepEqual(rankForVote(next, '2026-11-13').breakfast.map(o => o.id), ['b', 'c', 'a']);
  // The original is untouched.
  assert.equal(snap.candidates[0].lastCooked, '2026-10-01');
});

const ballot = {
  options: {
    breakfast: [{ id: 'b1', title: 'Oats' }, { id: 'b2', title: 'Eggs' }],
    'lunch-dinner': [{ id: 'l1', title: 'Chili' }, { id: 'l2', title: 'Curry' }],
  },
  voters: {
    v0: { name: 'Dan', email: 'dan@example.com', token: 'a'.repeat(32) },
    v1: { name: 'Joanne', email: 'jo@example.com', token: 'b'.repeat(32) },
  },
  votes: {},
};

test('picks: only meals on the ballot, once each, whatever shape arrives', () => {
  assert.deepEqual(sanitizePicks(ballot, ['b1', 'l2', 'b1', 'nope']), ['b1', 'l2']);
  assert.deepEqual(sanitizePicks(ballot, 'l1'), ['l1']);
  assert.deepEqual(sanitizePicks(ballot, undefined), []);
  assert.deepEqual(sanitizePicks(ballot, ''), []);
});

test('token: matches its own voter and nothing short or foreign', () => {
  assert.equal(voterForToken(ballot, 'b'.repeat(32)).name, 'Joanne');
  assert.equal(voterForToken(ballot, 'c'.repeat(32)), null);
  assert.equal(voterForToken(ballot, ''), null);
  assert.equal(voterForToken({ voters: { v0: { token: '' } } }, ''), null);
  assert.equal(voterForToken(null, 'a'.repeat(32)), null);
});

test('tally: most-voted first, ballot order breaks ties, who has voted', () => {
  const empty = tallyBallot(ballot);
  assert.equal(empty.anyVotes, false);
  assert.deepEqual(empty.columns.breakfast.map(r => r.id), ['b1', 'b2']);
  const voted = tallyBallot({
    ...ballot,
    votes: { v0: { picks: ['b2', 'l2'] }, v1: { picks: ['b2', 'l1', 'l2'] } },
  });
  assert.deepEqual(voted.columns.breakfast, [
    { id: 'b2', title: 'Eggs', voters: ['Dan', 'Joanne'] },
    { id: 'b1', title: 'Oats', voters: [] },
  ]);
  assert.deepEqual(voted.columns['lunch-dinner'].map(r => [r.id, r.voters.length]), [['l2', 2], ['l1', 1]]);
  const half = tallyBallot({ ...ballot, votes: { v1: { picks: [] } } });
  assert.deepEqual(half.voters, [{ id: 'v0', name: 'Dan', voted: false }, { id: 'v1', name: 'Joanne', voted: true }]);
  assert.equal(half.anyVotes, true);
});

test('weeks: newest is shown, oldest beyond the limit are pruned', () => {
  const weeks = { '2026-11-08': { a: 1 }, '2026-11-15': { a: 2 }, '2026-11-01': { a: 3 }, junk: {} };
  assert.deepEqual(latestBallot(weeks), { a: 2, weekOf: '2026-11-15' });
  assert.equal(latestBallot({}), null);
  assert.deepEqual(weeksToPrune(weeks, 2), ['2026-11-01']);
  assert.deepEqual(weeksToPrune(weeks, 12), []);
});

test('joanne: the recipe field wins, then the tags, and "Not Joanne" is a no', () => {
  assert.equal(joanneVerdict({ joanneLikes: 'yes', tags: ['Not Joanne'] }), 'yes');
  assert.equal(joanneVerdict({ joanneLikes: 'no', customTags: ['Joanne'] }), 'no');
  assert.equal(joanneVerdict({ customTags: ['Joanne'] }), 'yes');
  assert.equal(joanneVerdict({ tags: ['quick', 'Joanne approved'] }), 'yes');
  assert.equal(joanneVerdict({ tags: ['Joanne'], customTags: ['Not Joanne'] }), 'no');
  assert.equal(joanneVerdict({ tags: ['quick'] }), '');
  assert.equal(joanneVerdict(null), '');
});

test('snapshot + rank: each meal carries Joanne\'s verdict and why it is suggested', () => {
  const forecast = {
    today: '2026-11-10',
    weights: { staleness: 1, ingredients: 1 },
    ingredientDates: { kale: '2026-10-01', wild_salmon: '2026-11-08' },
    candidates: [
      cand('a', 'breakfast', '2026-10-20', { ingredients: ['kale', 'wild_salmon'], seasonal: ['squash', 'apple', 'pear'], goalFit: true }),
      cand('b', 'breakfast', '2026-11-11', { boosted: true }),
      cand('c', 'breakfast', '2026-11-12'),
      cand('d', 'breakfast', null),
    ],
  };
  const snap = buildMealVoteSnapshot(forecast, [
    { id: 'a', title: 'A', joanneLikes: 'yes' }, { id: 'b', title: 'B', tags: ['Not Joanne'] },
    { id: 'c', title: 'C' }, { id: 'd', title: 'D' },
  ]);
  // Nothing undefined goes to Firestore.
  assert.equal('joanne' in snap.candidates[2], false);
  assert.equal('seasonal' in snap.candidates[2], false);
  const byId = Object.fromEntries(rankForVote(snap, '2026-11-13').breakfast.map(o => [o.id, o]));
  assert.deepEqual(byId.a, {
    id: 'a', title: 'A', joanne: 'yes',
    why: 'not cooked in 24 days · has kale · in season: squash, apple · fits your goals',
  });
  assert.deepEqual(byId.b, { id: 'b', title: 'B', joanne: 'no', why: 'boosted' });
  assert.deepEqual(byId.c, { id: 'c', title: 'C', why: 'good variety pick' });
  assert.equal(byId.d.why, 'never cooked');
});

test('fill: an older ballot gains the columns without its meals moving', () => {
  const snap = buildMealVoteSnapshot({
    today: '2026-11-10', weights: {}, ingredientDates: {},
    candidates: [cand('a', 'breakfast', '2026-10-20'), cand('p', 'breakfast', '2026-11-01', { planned: true }), cand('z', 'breakfast', null)],
  }, [{ id: 'a', title: 'A', joanneLikes: 'no' }, { id: 'p', title: 'P' }, { id: 'z', title: 'Z' }]);
  const options = { breakfast: [{ id: 'p', title: 'P' }, { id: 'a', title: 'A' }, { id: 'gone', title: 'Gone' }], 'lunch-dinner': [] };
  const filled = fillOptionDetails(options, snap, '2026-11-13');
  assert.deepEqual(filled.breakfast, [
    { id: 'p', title: 'P', why: 'not cooked in 12 days' },
    { id: 'a', title: 'A', joanne: 'no', why: 'not cooked in 24 days' },
    { id: 'gone', title: 'Gone' },
  ]);
  // Already described: handed back untouched.
  const done = { breakfast: [{ id: 'a', title: 'A', why: 'x' }], 'lunch-dinner': [] };
  assert.equal(fillOptionDetails(done, snap, '2026-11-13'), done);
});
