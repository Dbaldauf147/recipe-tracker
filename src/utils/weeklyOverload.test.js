// Unit tests for the weekly overload checks (weight +3%, sets +10%, 10+ sets).
// Node's built-in runner (`npm test`); `now` is injected so weeks don't drift.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeWeeklyOverload, averageWeeklyWeightPct, muscleKeysFromText, setBand,
  topWorkingWeightLb, volumeVerdict, weekStartKey, weightVerdict, workingSetIndices,
} from './weeklyOverload.js';

const NOW = new Date(2026, 9, 14); // Wed Oct 14 2026 → this week starts Sun Oct 11

const LIB = [
  { exercise: 'Bench press', primaryMuscles: 'Pectoralis major', secondaryMuscles: 'Triceps brachii, Anterior deltoid' },
  { exercise: 'Lat pulldown', primaryMuscles: 'Latissimus dorsi', secondaryMuscles: 'Biceps brachii' },
  { exercise: 'Leg curl', primaryMuscles: 'Hamstrings (biceps femoris)' },
  { exercise: 'Leg extension', primaryMuscles: '', muscleGroup: 'Legs' },
  { exercise: 'Hip stretch', primaryMuscles: 'Glutes', exerciseType: 'Stretching' },
];

const entry = (exercise, weight, sets, extra = {}) => ({ exercise, weight: String(weight), sets, ...extra });
const wk = (date, entries, extra = {}) => ({ date, entries, ...extra });

test('weeks start on Sunday', () => {
  assert.equal(weekStartKey('2026-10-14'), '2026-10-11');
  assert.equal(weekStartKey('2026-10-11'), '2026-10-11');
  assert.equal(weekStartKey('2026-10-10'), '2026-10-04');
});

test('primary-muscle text maps to canonical groups', () => {
  assert.deepEqual(muscleKeysFromText('Pectoralis major (upper), Anterior deltoid'), ['chest', 'shoulders']);
  assert.deepEqual(muscleKeysFromText('Biceps femoris'), ['hamstrings']);
  assert.deepEqual(muscleKeysFromText('Biceps brachii'), ['biceps']);
  assert.deepEqual(muscleKeysFromText('Triceps brachii'), ['triceps']);
  assert.deepEqual(muscleKeysFromText('Rectus femoris'), ['quads']);
  assert.deepEqual(muscleKeysFromText('Rectus abdominis'), ['abs']);
  assert.deepEqual(muscleKeysFromText('Lower Back'), ['lowerback']);
  assert.deepEqual(muscleKeysFromText('Back'), ['back']);
  assert.deepEqual(muscleKeysFromText('Legs'), []);
});

test('working sets: ticked sets only when any are ticked, else every filled set', () => {
  assert.deepEqual(workingSetIndices({ sets: ['8', '8', '6', ''], setDone: [true, true, false, false] }), [0, 1]);
  assert.deepEqual(workingSetIndices({ sets: ['8', '30s', '', 'x'] }), [0, 1]);
});

test('top working weight uses per-set weights and doubles per-arm', () => {
  assert.equal(topWorkingWeightLb({ weight: '50', perArm: true, sets: ['10', '8'] }), 100);
  assert.equal(topWorkingWeightLb({ useSetWeights: true, setWeights: ['100', '110', '120'], sets: ['8', '6', ''] }), 110);
});

test('set bands', () => {
  assert.equal(setBand(9), 'below');
  assert.equal(setBand(10), 'min');
  assert.equal(setBand(14), 'min');
  assert.equal(setBand(15), 'advanced');
  assert.equal(setBand(20), 'advanced');
  assert.equal(setBand(21), 'over');
});

test('counts primary muscles only, skips stretches, reports unmapped', () => {
  const r = analyzeWeeklyOverload([
    wk('2026-10-05', [
      entry('Bench press', 185, ['8', '8', '8']),
      entry('Hip stretch', 0, ['60s', '60s']),
      entry('Leg extension', 100, ['12', '12'], { group: 'Legs' }),
    ]),
  ], { exerciseLibrary: LIB, now: NOW });
  const keys = r.muscles.map(m => m.key);
  assert.deepEqual(keys, ['chest']); // no triceps/shoulders (secondary), no glutes (stretch)
  assert.equal(r.muscles[0].sets[r.evalIndex], 3);
  assert.deepEqual(r.unmapped.map(u => u.name), ['Leg extension']);
});

test('volume: +10% hit, skips a missing week, deload weeks are not judged', () => {
  const r = analyzeWeeklyOverload([
    wk('2026-09-14', [entry('Lat pulldown', 120, ['10', '10', '10', '10', '10', '10', '10', '10', '10', '10'])]),
    // Sep 20 week: nothing
    wk('2026-09-28', [entry('Lat pulldown', 120, Array(11).fill('10'))]),
    wk('2026-10-05', [entry('Lat pulldown', 120, Array(11).fill('10'))]),
  ], { exerciseLibrary: LIB, now: NOW });
  const back = r.muscles.find(m => m.key === 'back');
  const i928 = r.weeks.findIndex(w => w.start === '2026-09-27');
  const v1 = volumeVerdict(back.sets, r.weeks, i928);
  assert.equal(v1.status, 'hit'); // 10 → 11 across the empty week
  assert.equal(v1.band, 'min');
  const v2 = volumeVerdict(back.sets, r.weeks, r.evalIndex);
  assert.equal(v2.status, 'miss');
  assert.equal(v2.pct, 0);

  const d = analyzeWeeklyOverload([
    wk('2026-09-28', [entry('Lat pulldown', 120, ['10'])]),
    wk('2026-10-05', [entry('Lat pulldown', 100, ['10'])], { deload: true }),
  ], { exerciseLibrary: LIB, now: NOW });
  assert.equal(volumeVerdict(d.muscles[0].sets, d.weeks, d.evalIndex).status, 'deload');
});

test('weight: +3% per week, compounded over gaps; deload and away gyms ignored', () => {
  const r = analyzeWeeklyOverload([
    wk('2026-09-21', [entry('Bench press', 200, ['5'])], { gym: 'Home' }),
    wk('2026-09-28', [entry('Bench press', 206, ['5'])], { gym: 'Home' }),
    wk('2026-09-30', [entry('Bench press', 300, ['5'])], { gym: 'Hotel' }), // away: ignored
    wk('2026-10-05', [entry('Bench press', 210, ['5'])], { gym: 'Home' }),
    wk('2026-09-14', [entry('Leg curl', 100, ['10'])], { gym: 'Home' }),
    wk('2026-09-28', [entry('Leg curl', 106, ['10'])], { gym: 'Home' }),
    wk('2026-10-05', [entry('Leg curl', 50, ['10'])], { gym: 'Home', deload: true }),
  ], { exerciseLibrary: LIB, now: NOW });
  assert.equal(r.homeGym, 'Home');
  const bench = r.lifts.find(l => l.name === 'Bench press');
  const i928 = r.weeks.findIndex(w => w.start === '2026-09-27');
  assert.equal(weightVerdict(bench.topLb, r.weeks, i928).status, 'hit'); // 200 → 206 = +3%
  const last = weightVerdict(bench.topLb, r.weeks, r.evalIndex);
  assert.equal(last.status, 'up'); // 206 → 210 ≈ +1.9%
  assert.ok(Math.abs(averageWeeklyWeightPct(bench.topLb, r.weeks, r.evalIndex) - (Math.pow(210 / 200, 1 / 2) - 1)) < 1e-9);

  const curl = r.lifts.find(l => l.name === 'Leg curl');
  const v = weightVerdict(curl.topLb, r.weeks, i928);
  assert.equal(v.gap, 2);
  assert.equal(v.status, 'up'); // +6% over 2 weeks ≈ 2.96%/wk, just under
  // Its only session that week was a deload one; the week itself had a normal
  // bench day, so it's judged — the curl just has no qualifying weight.
  assert.equal(r.weeks[r.evalIndex].deload, false);
  assert.equal(weightVerdict(curl.topLb, r.weeks, r.evalIndex).status, 'none');

  const off = analyzeWeeklyOverload([
    wk('2026-09-28', [entry('Bench press', 206, ['5'])], { gym: 'Home' }),
    wk('2026-09-29', [entry('Bench press', 206, ['5'])], { gym: 'Home' }),
    wk('2026-10-05', [entry('Bench press', 300, ['5'])], { gym: 'Hotel' }),
  ], { exerciseLibrary: LIB, now: NOW, homeGymOnly: false });
  assert.equal(weightVerdict(off.lifts[0].topLb, off.weeks, off.evalIndex).status, 'hit');
});
