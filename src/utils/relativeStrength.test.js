// Unit tests for the relative-strength (lift ÷ bodyweight) engine.
//
// Runs on Node's built-in runner (`npm test` → `node --test`) like the rest of
// src/utils — pure JS, no React, no bundler-only syntax. `now` is injected so
// the window assertions don't rot as the calendar moves.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeRelativeStrength,
  buildRatioSeries,
  latestWeighIn,
  matchStandard,
  powerliftingTotal,
  ratioChange,
  standardLevel,
  STANDARD_LEVELS,
} from './relativeStrength.js';
import { makeBodyweightLookupStrict } from './exerciseProgress.js';

const NOW = new Date(2026, 8, 22); // Sep 22 2026, local midnight

// 'YYYY-MM-DD' `n` days before NOW.
function daysAgo(n) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  const pad = v => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// One logged entry: 3 sets of `reps` at `weight` lb.
function entry(exercise, weight, reps, extra = {}) {
  return { exercise, group: 'Chest', weight: String(weight), sets: [String(reps), String(reps), String(reps)], ...extra };
}

function workout(date, entries, gym) {
  return { date, gym, entries };
}

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);

// ------------------------------------------------------------ buildRatioSeries

test('buildRatioSeries: one point per date, best e1RM of that day', () => {
  const at = makeBodyweightLookupStrict([{ date: '2026-01-01', weight: 200 }]);
  const series = buildRatioSeries([
    { date: '2026-02-01', weight: '100', sets: ['10'] },  // e1RM 133.3
    { date: '2026-02-01', weight: '150', sets: ['5'] },   // e1RM 175
    { date: '2026-02-08', weight: '160', sets: ['5'] },
  ], at);
  assert.equal(series.length, 2);
  close(series[0].e1rm, 175);
  close(series[0].ratio, 175 / 200);
});

test('buildRatioSeries: drops sessions before the first weigh-in, never forward-fills', () => {
  const at = makeBodyweightLookupStrict([{ date: '2026-03-01', weight: 180 }]);
  const series = buildRatioSeries([
    { date: '2024-05-05', weight: '200', sets: ['5'] },   // years before any scale
    { date: '2026-03-02', weight: '200', sets: ['5'] },
  ], at);
  assert.deepEqual(series.map(p => p.date), ['2026-03-02']);
});

test('buildRatioSeries: skips sessions with no loaded reps', () => {
  const at = makeBodyweightLookupStrict([{ date: '2026-01-01', weight: 200 }]);
  const series = buildRatioSeries([
    { date: '2026-02-01', weight: '', sets: ['30s'] },
    { date: '2026-02-02', weight: '0', sets: ['10'] },
  ], at);
  assert.equal(series.length, 0);
});

test('latestWeighIn: newest reading, kg converted to lb', () => {
  const w = latestWeighIn([
    { date: '2026-01-01', weight: 200 },
    { date: '2026-06-01', weight: 90, unit: 'kg' },
  ]);
  assert.equal(w.date, '2026-06-01');
  close(w.lb, 90 * 2.2046226218, 1e-6);
  assert.equal(latestWeighIn([]), null);
});

// ----------------------------------------------------------------- ratioChange

test('ratioChange: ratio change is exactly lift change minus bodyweight change (in logs)', () => {
  const series = [
    { date: '2026-01-01', e1rm: 200, bw: 200, ratio: 1 },
    { date: '2026-02-01', e1rm: 205, bw: 202, ratio: 205 / 202 },
    { date: '2026-03-01', e1rm: 215, bw: 206, ratio: 215 / 206 },
    { date: '2026-04-01', e1rm: 230, bw: 210, ratio: 230 / 210 },
  ];
  const c = ratioChange(series);
  close(Math.log(1 + c.ratioPct), Math.log(1 + c.e1rmPct) - Math.log(1 + c.bwPct), 1e-12);
  assert.ok(c.e1rmPct > 0 && c.bwPct > 0 && c.ratioPct > 0);
  assert.equal(c.startDate, '2026-01-01');
  assert.equal(c.endDate, '2026-04-01');
});

test('ratioChange: a lift that grew slower than the scale reads as a LOSS', () => {
  const series = [
    { date: '2026-01-01', e1rm: 200, bw: 180, ratio: 200 / 180 },
    { date: '2026-02-01', e1rm: 202, bw: 185, ratio: 202 / 185 },
    { date: '2026-03-01', e1rm: 206, bw: 195, ratio: 206 / 195 },
    { date: '2026-04-01', e1rm: 208, bw: 200, ratio: 208 / 200 },
  ];
  const c = ratioChange(series);
  assert.ok(c.e1rmPct > 0, 'the lift went up');
  assert.ok(c.ratioPct < 0, 'but relative strength went down');
});

test('ratioChange: needs two sessions', () => {
  assert.equal(ratioChange([{ date: '2026-01-01', e1rm: 200, bw: 200, ratio: 1 }]), null);
});

// ------------------------------------------------------------------- standards

test('matchStandard: matches the barbell lift, not its variants', () => {
  assert.equal(matchStandard('Bench Press').key, 'bench');
  assert.equal(matchStandard('barbell bench press').key, 'bench');
  assert.equal(matchStandard('Squat').key, 'squat');
  assert.equal(matchStandard('Back Squat').key, 'squat');
  assert.equal(matchStandard('Deadlift').key, 'deadlift');
  assert.equal(matchStandard('Overhead Press').key, 'ohp');
  assert.equal(matchStandard('Bent-Over Row').key, 'row');

  for (const name of ['Dumbbell Bench Press', 'Incline Bench Press', 'Smith Machine Squat',
    'Romanian Deadlift', 'Front Squat', 'Leg Press', 'Seated Row', 'Arnold Press']) {
    assert.equal(matchStandard(name), null, `${name} should not be scored against a barbell table`);
  }
});

test('standardLevel: bands, and null below the first one', () => {
  const bench = matchStandard('Bench Press');
  assert.equal(standardLevel(0.5, bench).level, null);
  assert.equal(standardLevel(0.5, bench).next.label, 'Beginner');
  assert.equal(standardLevel(1.3, bench).level, 'Intermediate');
  assert.equal(standardLevel(1.3, bench).next.label, 'Advanced');
  assert.equal(standardLevel(2.5, bench).level, 'Elite');
  assert.equal(standardLevel(2.5, bench).next, null);
  // Women's bands are lower, so the same ratio scores at least as high.
  const m = standardLevel(1.0, bench, 'male').index;
  const f = standardLevel(1.0, bench, 'female').index;
  assert.ok(f >= m);
  assert.equal(STANDARD_LEVELS.length, bench.male.length);
});

test('standardLevel: bands are strictly increasing for both sexes', () => {
  for (const s of ['male', 'female']) {
    for (const std of [matchStandard('Bench Press'), matchStandard('Squat'), matchStandard('Deadlift'),
      matchStandard('Overhead Press'), matchStandard('Barbell Row')]) {
      const bands = std[s];
      for (let i = 1; i < bands.length; i++) assert.ok(bands[i] > bands[i - 1], `${std.key}/${s}`);
    }
  }
});

// ------------------------------------------------------ analyzeRelativeStrength

const WEIGH_INS = [{ date: daysAgo(400), weight: 200 }, { date: daysAgo(10), weight: 200 }];

test('analyze: ranks lifts by multiple of bodyweight', () => {
  const workouts = [
    workout(daysAgo(30), [entry('Deadlift', 300, 5), entry('Bench Press', 200, 5)]),
    workout(daysAgo(10), [entry('Deadlift', 315, 5), entry('Bench Press', 205, 5)]),
  ];
  const { rows, bodyweight } = analyzeRelativeStrength(workouts, { weightLog: WEIGH_INS, now: NOW });
  assert.deepEqual(rows.map(r => r.name), ['Deadlift', 'Bench Press']);
  assert.equal(bodyweight.lb, 200);
  close(rows[1].current.ratio, (205 * (1 + 5 / 30)) / 200);
  assert.equal(rows[0].sessions, 2);
});

test('analyze: bodyweight movements are excluded, not ranked at ~1×', () => {
  const workouts = [
    workout(daysAgo(20), [entry('Pull-Up', 45, 5), entry('Bench Press', 200, 5)]),
    workout(daysAgo(5), [entry('Pull-Up', 45, 6), entry('Bench Press', 205, 5)]),
  ];
  const { rows, excluded } = analyzeRelativeStrength(workouts, { weightLog: WEIGH_INS, now: NOW });
  assert.deepEqual(rows.map(r => r.name), ['Bench Press']);
  assert.deepEqual(excluded.bodyweight, ['Pull-Up']);
});

test('analyze: stretches never appear', () => {
  const workouts = [
    workout(daysAgo(20), [entry('Hamstring Stretch', 0, 10, { group: 'Stretching' }), entry('Bench Press', 200, 5)]),
    workout(daysAgo(5), [entry('Bench Press', 205, 5)]),
  ];
  const { rows } = analyzeRelativeStrength(workouts, { weightLog: WEIGH_INS, now: NOW });
  assert.deepEqual(rows.map(r => r.name), ['Bench Press']);
});

test("analyze: the user's own exerciseType tag beats the name guess", () => {
  const workouts = [workout(daysAgo(5), [entry('Bench Press', 200, 5)])];
  const typeByName = new Map([['bench press', 'Stretching']]);
  const { rows } = analyzeRelativeStrength(workouts, { weightLog: WEIGH_INS, typeByName, now: NOW });
  assert.equal(rows.length, 0);
});

test('analyze: the window filters sessions, and an empty window drops the lift', () => {
  const workouts = [
    workout(daysAgo(200), [entry('Bench Press', 300, 5)]),
    workout(daysAgo(20), [entry('Bench Press', 200, 5)]),
  ];
  const win = analyzeRelativeStrength(workouts, { weightLog: WEIGH_INS, windowDays: 60, now: NOW });
  assert.equal(win.rows[0].sessions, 1);
  close(win.rows[0].current.e1rm, 200 * (1 + 5 / 30));
  // …but the all-time best still remembers the heavier day.
  close(win.rows[0].bestAllTime.e1rm, 300 * (1 + 5 / 30));

  const all = analyzeRelativeStrength(workouts, { weightLog: WEIGH_INS, windowDays: 0, now: NOW });
  assert.equal(all.rows[0].sessions, 2);

  const none = analyzeRelativeStrength([workouts[0]], { weightLog: WEIGH_INS, windowDays: 60, now: NOW });
  assert.equal(none.rows.length, 0);
});

test('analyze: a one-off gym is plotted but never sets the headline number', () => {
  // Five sessions at home, one at a hotel where everything felt heavy.
  const workouts = [
    workout(daysAgo(47), [entry('Bench Press', 195, 5)], 'Home'),
    workout(daysAgo(40), [entry('Bench Press', 200, 5)], 'Home'),
    workout(daysAgo(33), [entry('Bench Press', 205, 5)], 'Home'),
    workout(daysAgo(26), [entry('Bench Press', 205, 5)], 'Home'),
    workout(daysAgo(19), [entry('Bench Press', 210, 5)], 'Home'),
    workout(daysAgo(5), [entry('Bench Press', 95, 5)], 'Hotel Gym'),
  ];
  const { rows } = analyzeRelativeStrength(workouts, { weightLog: WEIGH_INS, now: NOW });
  const bench = rows[0];
  assert.equal(bench.series.length, 6, 'the hotel day is still on the chart');
  assert.equal(bench.series.at(-1).offsite, true);
  assert.equal(bench.current.date, daysAgo(19), 'the headline is the last session that counts');
  assert.equal(bench.sessions, 5);
});

test('analyze: no weigh-ins at all → nothing to divide by', () => {
  const workouts = [workout(daysAgo(5), [entry('Bench Press', 200, 5)])];
  const r = analyzeRelativeStrength(workouts, { weightLog: [], now: NOW });
  assert.equal(r.hasWeighIns, false);
  assert.equal(r.rows.length, 0);
  assert.equal(r.bodyweight, null);
});

test('analyze: lifts logged entirely before the first weigh-in are counted, not charted', () => {
  const workouts = [workout(daysAgo(300), [entry('Bench Press', 200, 5)])];
  const r = analyzeRelativeStrength(workouts, {
    weightLog: [{ date: daysAgo(10), weight: 200 }], windowDays: 0, now: NOW,
  });
  assert.equal(r.rows.length, 0);
  assert.equal(r.excluded.noWeighIn, 1);
});

test('analyze: level comes from the current ratio and the chosen table', () => {
  const workouts = [workout(daysAgo(5), [entry('Bench Press', 240, 1)])]; // e1RM 248 → 1.24×
  const male = analyzeRelativeStrength(workouts, { weightLog: WEIGH_INS, sex: 'male', now: NOW });
  const female = analyzeRelativeStrength(workouts, { weightLog: WEIGH_INS, sex: 'female', now: NOW });
  assert.equal(male.rows[0].level.level, 'Novice');
  assert.equal(female.rows[0].level.level, 'Advanced');
});

// --------------------------------------------------------- powerliftingTotal

test('powerliftingTotal: needs all three lifts', () => {
  const two = [
    workout(daysAgo(20), [entry('Squat', 300, 5), entry('Bench Press', 200, 5)]),
    workout(daysAgo(5), [entry('Squat', 305, 5), entry('Bench Press', 205, 5)]),
  ];
  assert.equal(analyzeRelativeStrength(two, { weightLog: WEIGH_INS, now: NOW }).total, null);

  const three = [
    workout(daysAgo(20), [entry('Squat', 300, 5), entry('Bench Press', 200, 5), entry('Deadlift', 350, 5)]),
    workout(daysAgo(5), [entry('Squat', 305, 5), entry('Bench Press', 205, 5), entry('Deadlift', 355, 5)]),
  ];
  const { total, rows } = analyzeRelativeStrength(three, { weightLog: WEIGH_INS, now: NOW });
  assert.equal(total.parts.length, 3);
  const sum = rows.reduce((s, r) => s + r.best.e1rm, 0);
  close(total.sum, sum);
  close(total.ratio, sum / 200);
});

test('powerliftingTotal: variants do not count toward the total', () => {
  const rows = [
    { standard: { key: 'squat', label: 'Back Squat' }, name: 'Squat', best: { e1rm: 350, bw: 200, date: '2026-09-01' } },
    { standard: { key: 'bench', label: 'Bench Press' }, name: 'Bench Press', best: { e1rm: 240, bw: 200, date: '2026-09-02' } },
    { standard: null, name: 'Romanian Deadlift', best: { e1rm: 300, bw: 200, date: '2026-09-03' } },
  ];
  assert.equal(powerliftingTotal(rows), null);
});
