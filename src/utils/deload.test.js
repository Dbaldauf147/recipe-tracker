// Deload rounds. ⚠️ Mirrors PrepDay/src/utils/deload.test.ts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyDeloadToEntry, defaultDeloadSettings, deloadDueFor, deloadReps, deloadRound, deloadSetCount, deloadWeekStart,
  deloadWeight, isRecommendedDeload, normalizeDeloadSettings, skipRoundTypes, startRoundOn, unskipRoundType, withoutDeload,
} from './deload.js';
import { priorHistory } from './personalRecord.js';

// Block 1 starts Sunday 2026-10-04: 4 training weeks, the round starts Nov 1.
const s = normalizeDeloadSettings({ enabled: true, trainWeeks: 4, anchor: '2026-10-04', weightPct: 60, setCut: 2, repCutPct: 0 });
const W = (id, date, workoutType, deload = true) => ({ id, date, workoutType, ...(deload ? { deload: true } : {}) });

describe('deload rounds', () => {
  it('weeks are Sunday-started', () => {
    assert.equal(deloadWeekStart('2026-10-11'), '2026-10-11'); // a Sunday
    assert.equal(deloadWeekStart('2026-10-17'), '2026-10-11'); // its Saturday
    assert.equal(deloadWeekStart(new Date(2026, 9, 14)), '2026-10-11');
  });

  it('trains N weeks, then every type is due once', () => {
    const t = deloadRound(s, [], '2026-10-31');
    assert.equal(t.phase, 'training');
    assert.equal(t.roundStart, '2026-11-01');
    assert.equal(t.week, 4);
    const r = deloadRound(s, [], '2026-11-01');
    assert.equal(r.phase, 'round');
    assert.deepEqual(r.pending, ['Push', 'Pull', 'Legs', 'Full Body']);
    assert.equal(deloadDueFor(s, [], 'push', '2026-11-03'), true); // any case
    assert.equal(deloadDueFor(s, [], 'Cardio', '2026-11-03'), false); // not a deload type
    assert.equal(deloadDueFor(s, [], 'Push', '2026-10-20'), false); // still training
  });

  it('a type is done once its deload is logged, and the round waits for the rest', () => {
    const log = [W('a', '2026-11-02', 'Push'), W('b', '2026-11-04', 'Legs'), W('c', '2026-11-05', 'Pull', false)];
    const r = deloadRound(s, log, '2026-11-09');
    assert.deepEqual(r.done.map(d => d.type), ['Push', 'Legs']);
    assert.deepEqual(r.pending, ['Pull', 'Full Body']); // a normal Pull doesn't count
    assert.equal(deloadDueFor(s, log, 'Push', '2026-11-09'), false);
    assert.equal(deloadDueFor(s, log, 'Pull', '2026-11-20'), true); // however long it takes
    // A past date reads as it was then.
    assert.deepEqual(deloadRound(s, log, '2026-11-03').pending, ['Pull', 'Legs', 'Full Body']);
  });

  it('the next block starts the day after the last deload', () => {
    const log = [W('a', '2026-11-02', 'Push'), W('b', '2026-11-04', 'Legs'), W('c', '2026-11-06', 'Pull'), W('d', '2026-11-10', 'Full Body')];
    const t = deloadRound(s, log, '2026-11-11');
    assert.equal(t.phase, 'training');
    assert.equal(t.blockStart, '2026-11-11');
    assert.equal(t.roundStart, '2026-12-09');
    assert.equal(deloadRound(s, log, '2026-12-09').phase, 'round');
  });

  it('editing a deload session does not count it as already done', () => {
    const log = [W('a', '2026-11-02', 'Push')];
    assert.equal(deloadDueFor(s, log, 'Push', '2026-11-02'), false);
    assert.equal(deloadDueFor(s, log, 'Push', '2026-11-02', { excludeId: 'a' }), true);
  });

  it('a skipped type stops blocking the round', () => {
    const log = [W('a', '2026-11-02', 'Push'), W('b', '2026-11-03', 'Pull'), W('c', '2026-11-04', 'Legs')];
    const skip = skipRoundTypes(s, '2026-11-01', ['Full Body'], '2026-11-05');
    const t = deloadRound(skip, log, '2026-11-06');
    assert.equal(t.phase, 'training');
    assert.equal(t.blockStart, '2026-11-06');
    assert.equal(deloadRound(unskipRoundType(skip, '2026-11-01', 'full body'), log, '2026-11-06').phase, 'round');
  });

  it('can start a round today, and is off when disabled', () => {
    const now = startRoundOn(s, '2026-10-15');
    assert.equal(deloadRound(now, [], '2026-10-15').roundStart, '2026-10-15');
    assert.equal(deloadRound(now, [], '2026-10-14').phase, 'training');
    assert.equal(deloadRound({ ...s, enabled: false }, [], '2026-11-02').phase, 'off');
  });

  it('only the chosen types are asked for', () => {
    const two = { ...s, types: ['Push', 'Legs'] };
    const log = [W('a', '2026-11-02', 'Push'), W('b', '2026-11-03', 'Legs')];
    assert.equal(deloadRound(two, log, '2026-11-04').phase, 'training');
  });

  it('normalizes junk', () => {
    const n = normalizeDeloadSettings({ trainWeeks: 0, weightPct: 500, setCut: -3, anchor: '2026-10-14' });
    assert.equal(n.enabled, false);
    assert.equal(n.trainWeeks, 1);
    assert.equal(n.weightPct, 100);
    assert.equal(n.setCut, 0);
    assert.equal(n.anchor, '2026-10-14'); // any day can start a block now
    assert.deepEqual(n.types, ['Push', 'Pull', 'Legs', 'Full Body']);
    assert.deepEqual(normalizeDeloadSettings({ types: ['Push', ' push ', '', 'Legs'] }).types, ['Push', 'Legs']);
    assert.deepEqual(normalizeDeloadSettings({ roundSkips: { '2026-11-01': { Pull: '2026-11-03', Bad: 'x' }, nope: {} } }).roundSkips,
      { '2026-11-01': { Pull: '2026-11-03' } });
  });

  it("defaults to Dr. Andy Galpin's deload: 5 weeks, 70%, 1 fewer set, 80% of the reps", () => {
    const d = defaultDeloadSettings();
    assert.equal(d.trainWeeks, 5);
    assert.equal(d.weightPct, 70);
    assert.equal(d.setCut, 1);
    assert.equal(d.repCutPct, 20);
    assert.equal(isRecommendedDeload(d), true);
    assert.equal(isRecommendedDeload({ ...d, weightPct: 60 }), false);
  });

  it('upgrades untouched old defaults, but keeps customised settings as they were', () => {
    const old = normalizeDeloadSettings({ enabled: true, trainWeeks: 4, weightPct: 60, setCutPct: 40, anchor: '2026-10-04' });
    assert.equal(isRecommendedDeload(old), true);
    assert.equal(old.enabled, true);
    assert.equal(old.anchor, '2026-10-04');
    const custom = normalizeDeloadSettings({ enabled: true, trainWeeks: 3, weightPct: 50, setCutPct: 30 });
    // 30% of a 5-set exercise ≈ 2 sets.
    assert.deepEqual([custom.trainWeeks, custom.weightPct, custom.setCut, custom.repCutPct], [3, 50, 2, 0]);
  });

  it('moves the previous recommendation (same sets, half the reps) to the current one', () => {
    const prev = normalizeDeloadSettings({ enabled: true, trainWeeks: 5, weightPct: 70, setCutPct: 0, repCutPct: 50, anchor: '2026-10-04' });
    assert.equal(isRecommendedDeload(prev), true);
    assert.equal(prev.enabled, true);
    // Customised: the % turns into a count, the rest is kept.
    const mine = normalizeDeloadSettings({ enabled: true, trainWeeks: 5, weightPct: 70, setCutPct: 40, repCutPct: 50 });
    assert.deepEqual([mine.setCut, mine.repCutPct], [2, 50]);
    const noCut = normalizeDeloadSettings({ trainWeeks: 4, weightPct: 70, setCutPct: 0, repCutPct: 30 });
    assert.deepEqual([noCut.setCut, noCut.repCutPct], [0, 30]);
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

  it('drops a number of sets, keeping at least one', () => {
    assert.equal(deloadSetCount(5, 1), 4);
    assert.equal(deloadSetCount(3, 2), 1);
    assert.equal(deloadSetCount(1, 3), 1);
    assert.equal(deloadSetCount(4, 0), 4);
    assert.equal(deloadSetCount(0, 1), 0);
  });

  it('turns an entry into its deload version', () => {
    const e = { sets: ['10', '10', '8', '8', ''], weight: '100', setWeights: ['100', '110'] };
    const d = applyDeloadToEntry(e, s);
    assert.deepEqual(d.sets, ['10', '10', '', '', '']); // 4 sets, 2 fewer → 2
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
    // Dr. Galpin: 1 fewer set, 80% of the reps, 70% of the weight.
    assert.deepEqual(d.sets, ['6', '6', '6', '6', '']);
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
