import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stretchSecondsByGroup, stretchGoalProgress, windowStartDate,
  formatStretchDuration, clampGoalMin, DEFAULT_STRETCH_GOAL_MIN, MAX_GOAL_MIN,
} from './stretchGoal.js';

// Fixed "today" so the rolling window is deterministic.
const TODAY = new Date(2026, 6, 28); // Jul 28 2026
const daysAgo = (n) => {
  const x = new Date(2026, 6, 28 - n);
  const p = v => String(v).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};
const isStretch = (n) => n.toLowerCase().includes('stretch');

test('window covers today back through day 6 inclusive', () => {
  assert.equal(windowStartDate(TODAY), '2026-07-22');
  assert.equal(windowStartDate(TODAY, 1), '2026-07-28');
});

test('sums held time per muscle group inside the window', () => {
  const secs = stretchSecondsByGroup([
    { date: daysAgo(0), entries: [{ exercise: 'Pigeon stretch', group: 'Legs', totalSeconds: 240 }] },
    { date: daysAgo(3), entries: [{ exercise: 'Hamstring stretch', group: 'Legs', totalSeconds: 400 }] },
    { date: daysAgo(6), entries: [{ exercise: 'Shoulder stretch', group: 'Shoulders', totalSeconds: 120 }] },
  ], isStretch, TODAY);
  assert.equal(secs.Legs, 640);
  assert.equal(secs.Shoulders, 120);
});

test('a timed exercise that is not a stretch does not count', () => {
  // The regression this guards: a 3-minute plank logged in the same session
  // would otherwise show up as three minutes of "Abs stretching".
  const secs = stretchSecondsByGroup([
    { date: daysAgo(0), entries: [
      { exercise: 'Plank', group: 'Abs', totalSeconds: 180 },
      { exercise: 'Ab stretch', group: 'Abs', totalSeconds: 60 },
    ] },
  ], isStretch, TODAY);
  assert.equal(secs.Abs, 60, 'only the stretch counts');
});

test('work outside the window is excluded', () => {
  const secs = stretchSecondsByGroup(
    [{ date: daysAgo(7), entries: [{ exercise: 'Old stretch', group: 'Back', totalSeconds: 999 }] }],
    isStretch, TODAY,
  );
  assert.deepEqual(secs, {});
});

test('entries with no duration contribute nothing', () => {
  const secs = stretchSecondsByGroup([
    { date: daysAgo(0), entries: [
      { exercise: 'Rep stretch', group: 'Legs', totalSeconds: 0 },
      { exercise: 'Rep stretch', group: 'Legs' },
    ] },
  ], isStretch, TODAY);
  assert.deepEqual(secs, {});
});

test('an untagged group falls into Other rather than vanishing', () => {
  const secs = stretchSecondsByGroup(
    [{ date: daysAgo(0), entries: [{ exercise: 'Mystery stretch', totalSeconds: 90 }] }],
    isStretch, TODAY,
  );
  assert.equal(secs.Other, 90);
});

test('progress rows: furthest behind leads, pct caps, met at the goal', () => {
  const rows = stretchGoalProgress({ Legs: 640, Shoulders: 120 }, ['Legs', 'Shoulders', 'Chest'], 10);
  assert.equal(rows[0].group, 'Chest', 'a group with nothing logged leads the board');
  assert.equal(rows[0].seconds, 0);
  const legs = rows.find(r => r.group === 'Legs');
  assert.equal(legs.met, true, '640s clears the 600s goal');
  assert.equal(legs.pct, 1, 'pct never exceeds 1');
  assert.equal(rows.find(r => r.group === 'Shoulders').met, false);
});

test('a group with history but no current tagging still shows', () => {
  const rows = stretchGoalProgress({ Back: 300 }, ['Legs'], 10);
  assert.ok(rows.some(r => r.group === 'Back'), 'logged time is never dropped off the board');
});

test('goal is exactly met at the boundary', () => {
  const rows = stretchGoalProgress({ Legs: 600 }, ['Legs'], 10);
  assert.equal(rows[0].met, true, '600s == 10min counts as met');
});

test('goal clamping', () => {
  assert.equal(clampGoalMin(0), DEFAULT_STRETCH_GOAL_MIN);
  assert.equal(clampGoalMin(-3), DEFAULT_STRETCH_GOAL_MIN);
  assert.equal(clampGoalMin('abc'), DEFAULT_STRETCH_GOAL_MIN);
  assert.equal(clampGoalMin(null), DEFAULT_STRETCH_GOAL_MIN);
  assert.equal(clampGoalMin(999), MAX_GOAL_MIN);
  assert.equal(clampGoalMin('15'), 15);
});

test('duration formatting', () => {
  assert.equal(formatStretchDuration(0), '0s');
  assert.equal(formatStretchDuration(45), '45s');
  assert.equal(formatStretchDuration(600), '10m');
  assert.equal(formatStretchDuration(640), '10m 40s');
  assert.equal(formatStretchDuration(-5), '0s');
});

test('empty and malformed input is handled without throwing', () => {
  assert.deepEqual(stretchSecondsByGroup([], isStretch, TODAY), {});
  assert.deepEqual(stretchSecondsByGroup(null, isStretch, TODAY), {});
  assert.deepEqual(stretchSecondsByGroup([{ }], isStretch, TODAY), {});
  assert.deepEqual(stretchGoalProgress({}, [], 10), []);
});
