import { test } from 'node:test';
import assert from 'node:assert/strict';
import { galpinRateFor, weekNumber, withGalpinGoal, GALPIN_WEIGHT_PCT, GALPIN_VOLUME_PCT } from './galpinGoals.js';

test('weeks run Sunday to Saturday', () => {
  assert.equal(weekNumber('2026-10-11'), weekNumber('2026-10-17')); // Sun..Sat
  assert.equal(weekNumber('2026-10-18'), weekNumber('2026-10-11') + 1);
});

test('rate per metric: weight +3%, volume (total reps) +10%, else none', () => {
  assert.equal(galpinRateFor('totalWeight'), GALPIN_WEIGHT_PCT);
  assert.equal(galpinRateFor('e1rm'), GALPIN_WEIGHT_PCT);
  assert.equal(galpinRateFor('totalReps'), GALPIN_VOLUME_PCT);
  assert.equal(galpinRateFor('avgReps'), null);
});

test("goal = last trained week's best × 1.03 per week, compounded over gaps", () => {
  const data = [
    { date: '2026-09-27', w: 90 },
    { date: '2026-09-29', w: 100 },          // week A best 100
    { date: '2026-10-05', w: 101 },          // week A+1 → goal 103
    { date: '2026-10-20', w: 110 },          // week A+3 (skipped A+2) → 101 × 1.03² = 107.2
  ];
  const out = withGalpinGoal(data, 'w', 0.03, 'g');
  assert.equal(out[0].g, undefined);
  assert.equal(out[1].g, undefined);
  assert.equal(out[2].g, 103);
  assert.equal(out[3].g, 107.2);
});

test('away/deload sessions never set the baseline; long layoffs restart', () => {
  const data = [
    { date: '2026-09-01', w: 100 },
    { date: '2026-09-08', w: 300, offsite: 'Deload' },
    { date: '2026-09-15', w: 100 },          // baseline is week of 9/1 (2 wks) → 106.1
    { date: '2026-11-30', w: 100 },          // 11 weeks later → no goal
  ];
  const out = withGalpinGoal(data, 'w', 0.03, 'g');
  assert.equal(out[2].g, 106.1);
  assert.equal(out[3].g, undefined);
});
