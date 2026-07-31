import test from 'node:test';
import assert from 'node:assert/strict';
import {
  stretchSecondsByRegion, stretchEntriesByRegion, stretchGoalProgress, stretchRegionFor, windowStartDate,
  formatStretchDuration, clampGoalMin, STRETCH_REGIONS,
  DEFAULT_STRETCH_GOAL_MIN, MAX_GOAL_MIN,
} from './stretchGoal.js';

// Fixed "today" so the rolling window is deterministic.
const TODAY = new Date(2026, 6, 28); // Jul 28 2026
const daysAgo = (n) => {
  const x = new Date(2026, 6, 28 - n);
  const p = v => String(v).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};
const isStretch = (n) => n.toLowerCase().includes('stretch') || n.toLowerCase().includes('pose');

test('window covers today back through day 6 inclusive', () => {
  assert.equal(windowStartDate(TODAY), '2026-07-22');
  assert.equal(windowStartDate(TODAY, 1), '2026-07-28');
});

test('the app\'s muscle groups fold into the seven regions', () => {
  assert.equal(stretchRegionFor('Overhead reach stretch', 'Triceps'), 'Arms');
  assert.equal(stretchRegionFor('Wrist stretch', 'Forearms'), 'Arms');
  assert.equal(stretchRegionFor('Side bend stretch', 'Abs'), 'Abdominals');
  assert.equal(stretchRegionFor('Hamstring stretch', 'Legs'), 'Legs');
  assert.equal(stretchRegionFor('Doorway stretch', 'Chest'), 'Chest');
  assert.equal(stretchRegionFor('Lat stretch', 'Back'), 'Back');
  assert.equal(stretchRegionFor('Cross-body stretch', 'Shoulders'), 'Shoulders');
});

test('hip and glute work is read off the pose name, overriding the group', () => {
  // The app has no Hips/Glutes muscle group — these get filed under Legs or
  // Yoga, so without the name override the region would never fill.
  assert.equal(stretchRegionFor('Pigeon pose', 'Legs'), 'Hips/Glutes');
  assert.equal(stretchRegionFor('Couch stretch', 'Yoga'), 'Hips/Glutes');
  assert.equal(stretchRegionFor('Glute bridge stretch', 'Legs'), 'Hips/Glutes');
  assert.equal(stretchRegionFor('90/90 stretch', ''), 'Hips/Glutes');
  // ...but a plain leg stretch stays in Legs.
  assert.equal(stretchRegionFor('Standing quad stretch', 'Legs'), 'Legs');
});

test('a group that says nothing about the body falls back to the name', () => {
  assert.equal(stretchRegionFor('Cat-cow', 'Yoga'), 'Back');
  assert.equal(stretchRegionFor('Calf stretch', 'Whole Body'), 'Legs');
  assert.equal(stretchRegionFor('Neck stretch', ''), 'Shoulders');
  assert.equal(stretchRegionFor('Mystery flow', 'Yoga'), '', 'unattributable stays unattributed');
});

test('sums held time per region inside the window', () => {
  const secs = stretchSecondsByRegion([
    { date: daysAgo(0), entries: [{ exercise: 'Pigeon stretch', group: 'Legs', totalSeconds: 240 }] },
    { date: daysAgo(3), entries: [{ exercise: 'Hamstring stretch', group: 'Legs', totalSeconds: 400 }] },
    { date: daysAgo(6), entries: [{ exercise: 'Shoulder stretch', group: 'Shoulders', totalSeconds: 120 }] },
  ], isStretch, TODAY);
  assert.equal(secs.Legs, 400);
  assert.equal(secs['Hips/Glutes'], 240, 'pigeon lands in hips, not legs');
  assert.equal(secs.Shoulders, 120);
});

test('the finer arm groups sum into one Arms total', () => {
  const secs = stretchSecondsByRegion([
    { date: daysAgo(0), entries: [
      { exercise: 'Bicep stretch', group: 'Biceps', totalSeconds: 60 },
      { exercise: 'Tricep stretch', group: 'Triceps', totalSeconds: 90 },
      { exercise: 'Forearm stretch', group: 'Forearms', totalSeconds: 30 },
    ] },
  ], isStretch, TODAY);
  assert.deepEqual(secs, { Arms: 180 });
});

test('a timed exercise that is not a stretch does not count', () => {
  // The regression this guards: a 3-minute plank logged in the same session
  // would otherwise show up as three minutes of "Abdominals stretching".
  const secs = stretchSecondsByRegion([
    { date: daysAgo(0), entries: [
      { exercise: 'Plank', group: 'Abs', totalSeconds: 180 },
      { exercise: 'Ab stretch', group: 'Abs', totalSeconds: 60 },
    ] },
  ], isStretch, TODAY);
  assert.equal(secs.Abdominals, 60, 'only the stretch counts');
});

test('work outside the window is excluded', () => {
  const secs = stretchSecondsByRegion(
    [{ date: daysAgo(7), entries: [{ exercise: 'Old stretch', group: 'Back', totalSeconds: 999 }] }],
    isStretch, TODAY,
  );
  assert.deepEqual(secs, {});
});

test('entries with no duration contribute nothing', () => {
  const secs = stretchSecondsByRegion([
    { date: daysAgo(0), entries: [
      { exercise: 'Rep stretch', group: 'Legs', totalSeconds: 0 },
      { exercise: 'Rep stretch', group: 'Legs' },
    ] },
  ], isStretch, TODAY);
  assert.deepEqual(secs, {});
});

test('time that maps to no region is left off rather than mis-filed', () => {
  const secs = stretchSecondsByRegion(
    [{ date: daysAgo(0), entries: [{ exercise: 'Mystery stretch', totalSeconds: 90 }] }],
    isStretch, TODAY,
  );
  assert.deepEqual(secs, {});
});

test('progress rows: all seven regions, in body order, pct caps, met at the goal', () => {
  const rows = stretchGoalProgress({ Legs: 640, Shoulders: 120 }, 10);
  assert.deepEqual(rows.map(r => r.group), STRETCH_REGIONS);
  assert.deepEqual(
    STRETCH_REGIONS,
    ['Chest', 'Back', 'Shoulders', 'Arms', 'Abdominals', 'Hips/Glutes', 'Legs'],
  );
  const legs = rows.find(r => r.group === 'Legs');
  assert.equal(legs.met, true, '640s clears the 600s goal');
  assert.equal(legs.pct, 1, 'pct never exceeds 1');
  assert.equal(rows.find(r => r.group === 'Shoulders').met, false);
  assert.equal(rows.find(r => r.group === 'Chest').seconds, 0, 'an unstretched region still shows');
});

test('goal is exactly met at the boundary', () => {
  const rows = stretchGoalProgress({ Legs: 600 }, 10);
  assert.equal(rows.find(r => r.group === 'Legs').met, true, '600s == 10min counts as met');
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
  assert.deepEqual(stretchSecondsByRegion([], isStretch, TODAY), {});
  assert.deepEqual(stretchSecondsByRegion(null, isStretch, TODAY), {});
  assert.deepEqual(stretchSecondsByRegion([{ }], isStretch, TODAY), {});
  assert.deepEqual(stretchEntriesByRegion(null, isStretch, TODAY), {});
  assert.equal(stretchGoalProgress({}, 10).length, 7);
});

// The breakdown behind a region's number, for the popup the board opens.
const BREAKDOWN_WORKOUTS = [
  { date: daysAgo(0), entries: [
    { exercise: 'Hamstring stretch', group: 'Legs', totalSeconds: 60 },
    { exercise: 'Calf stretch', group: 'Legs', totalSeconds: 90 },
  ] },
  { date: daysAgo(3), entries: [
    { exercise: 'Quad stretch', group: 'Legs', totalSeconds: 40 },
    { exercise: 'Bench press', group: 'Chest', totalSeconds: 300 }, // not a stretch
    { exercise: 'Doorway stretch', group: 'Chest', totalSeconds: 30 },
  ] },
  { date: daysAgo(9), entries: [ // outside the window
    { exercise: 'Pigeon pose', group: 'Legs', totalSeconds: 120 },
  ] },
];

test('entries list what a region total is made of, newest first', () => {
  const byRegion = stretchEntriesByRegion(BREAKDOWN_WORKOUTS, isStretch, TODAY);
  assert.deepEqual(byRegion.Legs.map(e => e.exercise), ['Calf stretch', 'Hamstring stretch', 'Quad stretch']);
  assert.deepEqual(byRegion.Legs.map(e => e.seconds), [90, 60, 40]);
  assert.deepEqual(byRegion.Chest.map(e => e.exercise), ['Doorway stretch']);
  assert.equal(byRegion.Legs[0].date, daysAgo(0));
});

test('entries obey the same filters as the totals, and sum to them', () => {
  const byRegion = stretchEntriesByRegion(BREAKDOWN_WORKOUTS, isStretch, TODAY);
  const totals = stretchSecondsByRegion(BREAKDOWN_WORKOUTS, isStretch, TODAY);
  for (const region of Object.keys(totals)) {
    assert.equal(byRegion[region].reduce((n, e) => n + e.seconds, 0), totals[region]);
  }
  // The non-stretch bench press and the out-of-window pigeon pose are in neither.
  assert.equal(totals.Legs, 190);
  assert.equal(totals.Chest, 30);
  assert.ok(!byRegion.Chest.some(e => e.exercise === 'Bench press'));
});
