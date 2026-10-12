// Deload weeks. ⚠️ Mirrors PrepDay/src/utils/deload.test.ts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyDeloadToEntry, defaultDeloadSettings, deloadReps, deloadSetCount, deloadWeekStart, deloadWeight, isDeloadWeek,
  isRecommendedDeload, normalizeDeloadSettings, upcomingDeloadWeeks, withWeekOverride, withoutDeload,
} from './deload.js';
import { priorHistory } from './personalRecord.js';

// Sunday 2026-10-04 starts the cycle: 4 training weeks, deload the week of Nov 1.
const s = normalizeDeloadSettings({ enabled: true, trainWeeks: 4, anchor: '2026-10-04', weightPct: 60, setCutPct: 40, repCutPct: 0 });

describe('deload schedule', () => {
  it('weeks are Sunday-started', () => {
    assert.equal(deloadWeekStart('2026-10-11'), '2026-10-11'); // a Sunday
    assert.equal(deloadWeekStart('2026-10-17'), '2026-10-11'); // its Saturday
    assert.equal(deloadWeekStart(new Date(2026, 9, 14)), '2026-10-11');
  });

  it('trains N weeks, then deloads one, then repeats', () => {
    for (const d of ['2026-10-04', '2026-10-15', '2026-10-25', '2026-10-31']) assert.equal(isDeloadWeek(s, d), false, d);
    assert.equal(isDeloadWeek(s, '2026-11-01'), true);
    assert.equal(isDeloadWeek(s, '2026-11-07'), true);
    assert.equal(isDeloadWeek(s, '2026-11-08'), false);
    assert.equal(isDeloadWeek(s, '2026-12-06'), true); // next cycle: 5 weeks later
    assert.equal(isDeloadWeek(s, '2026-09-27'), false); // before the anchor
  });

  it('is never on when disabled, and lists upcoming weeks', () => {
    assert.equal(isDeloadWeek({ ...s, enabled: false }, '2026-11-01'), false);
    assert.deepEqual(upcomingDeloadWeeks(s, new Date(2026, 9, 11), 2), ['2026-11-01', '2026-12-06']);
  });

  it('a week override beats the schedule, and clears when it matches it', () => {
    const on = withWeekOverride(s, '2026-10-11', true);
    assert.equal(isDeloadWeek(on, '2026-10-13'), true);
    const skip = withWeekOverride(s, '2026-11-01', false);
    assert.equal(isDeloadWeek(skip, '2026-11-03'), false);
    assert.deepEqual(withWeekOverride(skip, '2026-11-01', true).overrides, {});
  });

  it('normalizes junk', () => {
    const n = normalizeDeloadSettings({ trainWeeks: 0, weightPct: 500, setCutPct: -3, anchor: '2026-10-14' });
    assert.equal(n.enabled, false);
    assert.equal(n.trainWeeks, 1);
    assert.equal(n.weightPct, 100);
    assert.equal(n.setCutPct, 0);
    assert.equal(n.anchor, '2026-10-11'); // snapped to its Sunday
  });

  it("defaults to Dr. Andy Galpin's deload: 5 weeks, 70%, half the reps, same sets", () => {
    const d = defaultDeloadSettings();
    assert.equal(d.trainWeeks, 5);
    assert.equal(d.weightPct, 70);
    assert.equal(d.setCutPct, 0);
    assert.equal(d.repCutPct, 50);
    assert.equal(isRecommendedDeload(d), true);
    assert.equal(isRecommendedDeload({ ...d, weightPct: 60 }), false);
  });

  it('upgrades untouched old defaults, but keeps customised settings as they were', () => {
    const old = normalizeDeloadSettings({ enabled: true, trainWeeks: 4, weightPct: 60, setCutPct: 40, anchor: '2026-10-04' });
    assert.equal(isRecommendedDeload(old), true);
    assert.equal(old.enabled, true);
    assert.equal(old.anchor, '2026-10-04');
    const custom = normalizeDeloadSettings({ enabled: true, trainWeeks: 3, weightPct: 50, setCutPct: 30 });
    assert.deepEqual([custom.trainWeeks, custom.weightPct, custom.setCutPct, custom.repCutPct], [3, 50, 30, 0]);
  });
});

describe('deload suggestions', () => {
  it('scales weight to the nearest 5 lb, never below 5', () => {
    assert.equal(deloadWeight('135', 60), '80');
    assert.equal(deloadWeight('225', 60), '135');
    assert.equal(deloadWeight('15', 60), '10');
    assert.equal(deloadWeight('5', 50), '5');
    assert.equal(deloadWeight('', 60), '');
    assert.equal(deloadWeight('BW', 60), 'BW');
  });

  it('cuts sets by a %, keeping at least one', () => {
    assert.equal(deloadSetCount(5, 40), 3);
    assert.equal(deloadSetCount(3, 40), 2);
    assert.equal(deloadSetCount(1, 90), 1);
    assert.equal(deloadSetCount(0, 40), 0);
  });

  it('turns an entry into its deload version', () => {
    const e = { sets: ['10', '10', '8', '8', ''], weight: '100', setWeights: ['100', '110'] };
    const d = applyDeloadToEntry(e, s);
    assert.deepEqual(d.sets, ['10', '10', '', '', '']); // 4 sets, 40% fewer → 2
    assert.equal(d.weight, '60');
    assert.deepEqual(d.setWeights, ['60', '65']);
    const bw = applyDeloadToEntry({ sets: ['12', '12'], weight: '180', useBodyWeight: true }, s);
    assert.equal(bw.weight, '180');
    assert.deepEqual(bw.sets, ['12', '']);
  });

  it('halves plain rep counts; timed sets are left alone', () => {
    assert.equal(deloadReps('8', 50), '4');
    assert.equal(deloadReps('5', 50), '3');
    assert.equal(deloadReps('1', 50), '1');
    assert.equal(deloadReps('30s', 50), '30s');
    assert.equal(deloadReps('1:30', 50), '1:30');
    assert.equal(deloadReps('8', 0), '8');
    const d = applyDeloadToEntry({ sets: ['8', '8', '8', '8', '8'], weight: '135' }, defaultDeloadSettings());
    assert.deepEqual(d.sets, ['4', '4', '4', '4', '4']);
    assert.equal(d.weight, '95');
  });

  it('drops deload sessions from progress input', () => {
    assert.deepEqual(withoutDeload([{ id: 1 }, { id: 2, deload: true }]).map(w => w.id), [1]);
  });

  it('the PR baseline never includes a deload session', () => {
    const ws = [{ date: '2026-10-01', entries: [] }, { date: '2026-10-05', deload: true, entries: [] }];
    assert.deepEqual(priorHistory(ws, '2026-10-10').map(w => w.date), ['2026-10-01']);
  });
});
