// Unit tests for the exercise progress trend engine.
//
// Runs on Node's built-in test runner (`npm test` → `node --test`): the module
// under test is pure JS with no React and no bundler-only syntax, so it needs no
// test framework dependency.
//
// `now` is injected everywhere so the 60-day window is deterministic and these
// tests don't rot as the calendar moves.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeProgress,
  decideStatus,
  deltaTone,
  epley1RM,
  linearRegression,
  winsorizeSeries,
  isBodyweightExercise,
  makeBodyweightLookup,
  classifyPrimary,
  classifyVolume,
  STATUS_KEYS,
  MIN_SESSIONS,
  MIN_SPAN_DAYS,
  EPLEY_REP_CAP,
  STALE_FALLBACK_DAYS,
  STALE_MIN_DAYS,
  STALE_MAX_DAYS,
} from './exerciseProgress.js';

// A fixed "today" so every window/threshold assertion is stable.
const NOW = new Date(2026, 6, 16); // Jul 16 2026, local midnight

function key(daysAgo) {
  const d = new Date(NOW);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// sessions: [{ daysAgo, weight, sets }] → workouts array for one exercise.
function workoutsFor(exercise, sessions, group = 'Chest') {
  return sessions.map(s => ({
    date: key(s.daysAgo),
    entries: [{
      exercise,
      group,
      sets: s.sets,
      weight: s.weight == null ? '' : String(s.weight),
      setDone: s.setDone,
      ...(s.entry || {}),
    }],
  }));
}

function analyzeOne(exercise, sessions, options = {}, group = 'Chest') {
  const groups = analyzeProgress(workoutsFor(exercise, sessions, group), null, { now: NOW, ...options });
  for (const k of STATUS_KEYS) {
    const hit = groups[k].find(r => r.name === exercise);
    if (hit) return { ...hit, _group: k };
  }
  return null;
}

// Deterministic pseudo-random so "noisy" tests are reproducible.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ===========================================================================
// Rule 3 — e1RM hardening
// ===========================================================================

test('epley1RM caps reps at 10 so high-rep sets cannot inflate e1RM', () => {
  // 100 lb × 10 reps = 100 × (1 + 10/30) = 133.33
  assert.equal(Math.round(epley1RM(100, 10) * 100) / 100, 133.33);
  // Anything past the cap must be identical to the cap, not larger.
  assert.equal(epley1RM(100, 20), epley1RM(100, EPLEY_REP_CAP));
  assert.equal(epley1RM(100, 50), epley1RM(100, 10));
  // Below the cap it still scales normally.
  assert.ok(epley1RM(100, 5) < epley1RM(100, 10));
  assert.equal(Math.round(epley1RM(100, 5) * 100) / 100, 116.67);
});

test('epley1RM is 0 for non-positive load or reps', () => {
  assert.equal(epley1RM(0, 5), 0);
  assert.equal(epley1RM(100, 0), 0);
  assert.equal(epley1RM(-10, 5), 0);
  assert.equal(epley1RM(NaN, 5), 0);
});

test('session e1RM uses the best set, not the heaviest-weight set', () => {
  // Per-set weights: a lighter set for more reps implies a HIGHER 1RM.
  //   155 × 3  → 155 × (1 + 3/30)  = 170.5
  //   135 × 10 → 135 × (1 + 10/30) = 180.0  ← best, despite being lighter
  const sessions = [56, 42, 28, 14, 0].map(daysAgo => ({
    daysAgo,
    sets: ['3', '10'],
    entry: { useSetWeights: true, setWeights: ['155', '135'] },
  }));
  const r = analyzeOne('Bench press', sessions);
  assert.equal(r.metric, 'e1rm');
  assert.equal(Math.round(r.series[0].value * 10) / 10, 180);
});

test('per-arm weights are doubled into the load', () => {
  const sessions = [56, 42, 28, 14, 0].map(daysAgo => ({
    daysAgo, weight: 50, sets: ['10'], entry: { perArm: true },
  }));
  const r = analyzeOne('Dumbbell press', sessions);
  // 50 per arm → 100 total → 100 × (1 + 10/30) = 133.33
  assert.equal(Math.round(r.series[0].value * 100) / 100, 133.33);
});

test('winsorizeSeries clamps a spike above the trailing median +15%, keeps raw', () => {
  //                        prior median of last 5 →  cap
  const values = [100, 100, 100, 100, 200];
  const { values: out, flags } = winsorizeSeries(values);
  // Median of [100,100,100,100] = 100 → cap = 115. The 200 is pulled to 115.
  assert.ok(Math.abs(out[4] - 115) < 1e-9);
  assert.equal(flags[4], true);
  // Untouched entries pass through unflagged.
  assert.deepEqual(out.slice(0, 4), [100, 100, 100, 100]);
  assert.deepEqual(flags.slice(0, 4), [false, false, false, false]);
});

test('winsorizeSeries needs 3+ prior sessions before acting', () => {
  // With only two priors, a big jump is left alone (early real jumps are common).
  const { values: out, flags } = winsorizeSeries([100, 100, 200]);
  assert.equal(out[2], 200);
  assert.equal(flags[2], false);
});

test('winsorizing does not clamp steady, moderate progression', () => {
  // +2% per session stays under the trailing median +15%.
  const values = [100, 102, 104.04, 106.12, 108.24, 110.41];
  const { flags } = winsorizeSeries(values);
  assert.deepEqual(flags, [false, false, false, false, false, false]);
});

test('KNOWN TENSION: very fast linear progression is dampened by the outlier guard', () => {
  // The trailing median lags a rising series by ~2 sessions, so sustained gains
  // of roughly ≥5%/session (classic novice linear progression: +5 lb/session on a
  // 100 lb lift) eventually exceed median × 1.15 and get clipped. This is
  // inherent to the "+15% over trailing median" rule as specified, not a bug.
  const novice = [100, 105, 110.25, 115.76, 121.55, 127.63];
  const { flags } = winsorizeSeries(novice);
  assert.equal(flags[5], true, 'the 6th session is clipped');

  // It only dampens MAGNITUDE, never direction: such a lifter is still Progressing.
  const sessions = [50, 40, 30, 20, 10, 0].map((daysAgo, i) => ({
    daysAgo, weight: Math.round(100 * Math.pow(1.05, i)), sets: ['5'],
  }));
  const r = analyzeOne('Novice squat', sessions);
  assert.equal(r.status, 'progressing');
  assert.ok(r.deltaPct > 0.025);
});

test('an outlier session is winsorized for trend but displayed raw', () => {
  // Flat 200 lb, then one absurd 400 lb session (fat-fingered weight).
  const sessions = [
    { daysAgo: 56, weight: 200, sets: ['10'] },
    { daysAgo: 42, weight: 200, sets: ['10'] },
    { daysAgo: 28, weight: 200, sets: ['10'] },
    { daysAgo: 14, weight: 200, sets: ['10'] },
    { daysAgo: 0, weight: 400, sets: ['10'] },
  ];
  const r = analyzeOne('Squat', sessions);
  const lastPoint = r.series[r.series.length - 1];
  // Raw value preserved for display…
  assert.equal(Math.round(lastPoint.value * 100) / 100, 533.33);
  // …but the trend sees it clamped to the trailing median +15%.
  assert.ok(lastPoint.trendValue < lastPoint.value);
  assert.equal(lastPoint.winsorized, true);
  assert.equal(Math.round(lastPoint.trendValue * 100) / 100, 306.67); // 266.67 × 1.15
});

// ===========================================================================
// Rule 2 — OLS regression replaces split-window averages
// ===========================================================================

test('linearRegression recovers a known slope and intercept exactly', () => {
  const pts = [{ x: 0, y: 10 }, { x: 1, y: 12 }, { x: 2, y: 14 }, { x: 3, y: 16 }];
  const reg = linearRegression(pts);
  assert.equal(reg.slope, 2);
  assert.equal(reg.intercept, 10);
  assert.equal(reg.r2, 1); // perfect fit
});

test('linearRegression returns null when undefined (n<2 or zero x-variance)', () => {
  assert.equal(linearRegression([]), null);
  assert.equal(linearRegression([{ x: 1, y: 1 }]), null);
  assert.equal(linearRegression([{ x: 5, y: 1 }, { x: 5, y: 9 }]), null);
});

test('linearRegression reports r2=1 for a perfectly flat series (0/0 guard)', () => {
  const reg = linearRegression([{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }]);
  assert.equal(reg.slope, 0);
  assert.equal(reg.r2, 1);
  assert.ok(Number.isFinite(reg.r2));
});

test('a rising e1RM slope classifies Progressing', () => {
  const sessions = [
    { daysAgo: 56, weight: 100, sets: ['5'] },
    { daysAgo: 42, weight: 105, sets: ['5'] },
    { daysAgo: 28, weight: 110, sets: ['5'] },
    { daysAgo: 14, weight: 115, sets: ['5'] },
    { daysAgo: 0, weight: 120, sets: ['5'] },
  ];
  const r = analyzeOne('Row', sessions);
  assert.equal(r.status, 'progressing');
  assert.ok(r.deltaPct >= 0.025);
  assert.ok(r.r2 > 0.9);
  assert.ok(r.slopePerDay > 0);
});

test('a falling e1RM slope classifies Decreasing', () => {
  const sessions = [
    { daysAgo: 56, weight: 120, sets: ['5'] },
    { daysAgo: 42, weight: 115, sets: ['5'] },
    { daysAgo: 28, weight: 110, sets: ['5'] },
    { daysAgo: 14, weight: 105, sets: ['5'] },
    { daysAgo: 0, weight: 100, sets: ['5'] },
  ];
  const r = analyzeOne('Row', sessions);
  assert.equal(r.status, 'decreasing');
  assert.ok(r.deltaPct <= -0.025);
  assert.equal(r.declining, true);
});

test('a flat e1RM slope classifies Stagnating', () => {
  const sessions = [56, 42, 28, 14, 0].map(daysAgo => ({ daysAgo, weight: 100, sets: ['5'] }));
  const r = analyzeOne('Row', sessions);
  assert.equal(r.status, 'stagnating');
  assert.equal(r.deltaPct, 0);
});

test('fewer than MIN_SESSIONS sessions → No Baseline, reason "insufficient"', () => {
  // 3 sessions spread over 56 days: sparse logging, not newness.
  const sessions = [
    { daysAgo: 56, weight: 100, sets: ['5'] },
    { daysAgo: 30, weight: 105, sets: ['5'] },
    { daysAgo: 0, weight: 110, sets: ['5'] },
  ];
  const r = analyzeOne('Row', sessions);
  assert.equal(r.sessions, 3);
  assert.ok(r.sessions < MIN_SESSIONS);
  assert.equal(r.status, 'nobaseline');
  assert.equal(r.noBaselineReason, 'insufficient');
});

test('span shorter than MIN_SPAN_DAYS → No Baseline, reason "new"', () => {
  // 5 sessions but all inside the last 10 days: plenty of data, no time depth.
  const sessions = [10, 8, 5, 3, 0].map(daysAgo => ({ daysAgo, weight: 100, sets: ['5'] }));
  const r = analyzeOne('Row', sessions);
  assert.equal(r.sessions, 5);
  assert.ok(r.spanDays < MIN_SPAN_DAYS);
  assert.equal(r.status, 'nobaseline');
  assert.equal(r.noBaselineReason, 'new');
});

test('"new" vs "insufficient" are distinguished by when the FIRST log happened', () => {
  // Sparse but old → insufficient.
  const old = analyzeOne('A', [
    { daysAgo: 50, weight: 100, sets: ['5'] },
    { daysAgo: 45, weight: 100, sets: ['5'] },
  ]);
  assert.equal(old.noBaselineReason, 'insufficient');

  // Sparse and recent → new.
  const fresh = analyzeOne('B', [
    { daysAgo: 5, weight: 100, sets: ['5'] },
    { daysAgo: 2, weight: 100, sets: ['5'] },
  ]);
  assert.equal(fresh.noBaselineReason, 'new');
});

test('exactly MIN_SESSIONS over exactly MIN_SPAN_DAYS is enough to judge', () => {
  const sessions = [21, 14, 7, 0].map((daysAgo, i) => ({ daysAgo, weight: 100 + i * 10, sets: ['5'] }));
  const r = analyzeOne('Row', sessions);
  assert.equal(r.sessions, MIN_SESSIONS);
  assert.equal(r.spanDays, MIN_SPAN_DAYS);
  assert.notEqual(r.status, 'nobaseline');
});

// Zig-zag around 200 lb: no real trend, just session-to-session scatter.
// Constructed (not random) so the guard's precondition is guaranteed.
const OSCILLATING = [200, 206, 194, 205, 196, 204, 197, 203, 198, 202]
  .map((weight, i) => ({ daysAgo: 54 - i * 6, weight, sets: ['5'] }));

test('noise guard: weak fit with a small move stays Stagnating', () => {
  const r = analyzeOne('Noisy', OSCILLATING);
  // Assert the guard's precondition actually holds, so this test can't pass
  // for the wrong reason if the data or thresholds drift.
  assert.ok(r.r2 < 0.2, `expected a weak fit, got r2=${r.r2}`);
  assert.ok(Math.abs(r.deltaPct) <= 0.04, `expected a small move, got ${r.deltaPct}`);
  assert.equal(r.status, 'stagnating');
});

test('noise guard: classification is stable under perturbation of a session', () => {
  // Nudging the newest session must not flip the label back and forth.
  for (let d = -6; d <= 6; d++) {
    const perturbed = OSCILLATING.map((s, i) =>
      i === OSCILLATING.length - 1 ? { ...s, weight: s.weight + d } : s);
    const r = analyzeOne('Stable', perturbed);
    assert.equal(r.status, 'stagnating', `perturbation ${d} flipped to ${r.status}`);
  }
});

test('noise guard: whenever the precondition holds, the label is Stagnating', () => {
  // Property-based sweep over random walks. The guard is deliberately NARROW —
  // it only fires for a weak fit AND a small move — so a random series that
  // happens to trend convincingly (high R²) is correctly NOT suppressed. Assert
  // the implication rather than a blanket "noise ⇒ stagnating".
  let covered = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rand = lcg(seed);
    const sessions = [];
    for (let i = 0; i < 10; i++) {
      sessions.push({ daysAgo: 54 - i * 6, weight: 200 + Math.round((rand() - 0.5) * 10), sets: ['5'] });
    }
    const r = analyzeOne('Walk', sessions);
    // Whatever happens, it is always exactly one valid, non-nobaseline status.
    assert.ok(['progressing', 'decreasing', 'stagnating'].includes(r.status));
    if (r.r2 < 0.2 && Math.abs(r.deltaPct) <= 0.04) {
      covered++;
      assert.equal(r.status, 'stagnating', `seed ${seed}: guard precondition held but got ${r.status}`);
    }
  }
  assert.ok(covered >= 5, `expected the guard to fire for several seeds, fired ${covered}`);
});

test('noise guard does not suppress a strong, real trend', () => {
  // Big move with a tight fit → guard must not apply.
  const sessions = [56, 42, 28, 14, 0].map((daysAgo, i) => ({ daysAgo, weight: 100 + i * 15, sets: ['5'] }));
  const r = analyzeOne('Real', sessions);
  assert.equal(r.status, 'progressing');
  assert.ok(r.r2 > 0.9);
});

test('classifyPrimary/classifyVolume honour their thresholds', () => {
  const strong = (pct) => ({ r2: 0.95, pct });
  assert.equal(classifyPrimary(strong(0.03)), 'up');
  assert.equal(classifyPrimary(strong(-0.03)), 'down');
  assert.equal(classifyPrimary(strong(0.01)), 'flat');
  assert.equal(classifyPrimary(null), 'flat');

  // Volume is asymmetric by design: +5% to upgrade, −10% to annotate.
  assert.equal(classifyVolume(strong(0.06)), 'up');
  assert.equal(classifyVolume(strong(0.04)), 'flat');
  assert.equal(classifyVolume(strong(-0.12)), 'down');
  assert.equal(classifyVolume(strong(-0.06)), 'flat');

  // Weak fit + small move → forced flat regardless of sign.
  assert.equal(classifyPrimary({ r2: 0.1, pct: 0.03 }), 'flat');
  assert.equal(classifyPrimary({ r2: 0.1, pct: -0.03 }), 'flat');
  // Weak fit but a LARGE move is still reported.
  assert.equal(classifyPrimary({ r2: 0.1, pct: 0.20 }), 'up');
});

// ===========================================================================
// Rule 1 — mutual exclusivity + symmetric volume
// ===========================================================================

test('decideStatus returns exactly one status for every possible signal combo', () => {
  const signals = ['up', 'down', 'flat'];
  const intents = [null, 'deload', 'maintenance'];
  for (const e of signals) {
    for (const v of signals) {
      for (const intent of intents) {
        const { status } = decideStatus(e, v, intent);
        // A single string, always a known status, never a set/array.
        assert.equal(typeof status, 'string');
        assert.ok(STATUS_KEYS.includes(status), `unknown status ${status}`);
        assert.ok(status !== 'nobaseline');
      }
    }
  }
});

test('e1RM down + volume up → Decreasing (volume never rescues a falling e1RM)', () => {
  // This is the original bug: the old code called this BOTH progressing
  // (volume ≥ +5%) and declining (e1RM ≤ −2.5%) at the same time.
  const { status, annotations } = decideStatus('down', 'up');
  assert.equal(status, 'decreasing');
  assert.ok(annotations.includes('volume-up'));
});

test('volume may only upgrade Stagnating → Progressing', () => {
  assert.equal(decideStatus('flat', 'up').status, 'progressing');
  assert.equal(decideStatus('flat', 'flat').status, 'stagnating');
  // …and never downgrades a rising e1RM.
  assert.equal(decideStatus('up', 'down').status, 'progressing');
  assert.equal(decideStatus('up', 'flat').status, 'progressing');
});

test('sustained volume drop under a flat e1RM annotates but keeps Stagnating', () => {
  const { status, annotations } = decideStatus('flat', 'down');
  assert.equal(status, 'stagnating');
  assert.deepEqual(annotations, ['volume-down']);
});

test('END-TO-END: falling e1RM with rising volume lands in exactly one group', () => {
  // Weight drops each session while set count climbs: e1RM −15%, volume +240%.
  const sessions = [
    { daysAgo: 56, weight: 200, sets: ['10'] },                     // e1RM 266.7, vol 2000
    { daysAgo: 42, weight: 190, sets: ['10', '10'] },               // e1RM 253.3, vol 3800
    { daysAgo: 28, weight: 180, sets: ['10', '10'] },               // e1RM 240.0, vol 3600
    { daysAgo: 14, weight: 175, sets: ['10', '10', '10'] },         // e1RM 233.3, vol 5250
    { daysAgo: 0, weight: 170, sets: ['10', '10', '10', '10'] },    // e1RM 226.7, vol 6800
  ];
  const groups = analyzeProgress(workoutsFor('Deadlift', sessions), null, { now: NOW });
  const hits = STATUS_KEYS.filter(k => groups[k].some(r => r.name === 'Deadlift'));
  assert.deepEqual(hits, ['decreasing'], 'must appear in exactly one group');

  const r = groups.decreasing[0];
  assert.ok(r.deltaPct < 0, 'e1RM trend is down');
  assert.ok(r.volDeltaPct > 0.05, 'volume trend is up — the old code would have said progressing');
  assert.ok(r.annotations.includes('volume-up'));
});

test('END-TO-END: no exercise can ever appear in two status groups', () => {
  // A matrix of shapes: rising, falling, flat, noisy, sparse, brand-new,
  // volume-up-flat-e1RM, volume-down-flat-e1RM, timed, bodyweight.
  const rand = lcg(7);
  const workouts = [
    ...workoutsFor('Rising', [56, 42, 28, 14, 0].map((d, i) => ({ daysAgo: d, weight: 100 + i * 10, sets: ['5'] }))),
    ...workoutsFor('Falling', [56, 42, 28, 14, 0].map((d, i) => ({ daysAgo: d, weight: 150 - i * 10, sets: ['5'] }))),
    ...workoutsFor('Flat', [56, 42, 28, 14, 0].map(d => ({ daysAgo: d, weight: 100, sets: ['5'] }))),
    ...workoutsFor('Noisy', [56, 48, 40, 32, 24, 16, 8, 0].map(d => ({ daysAgo: d, weight: 200 + Math.round((rand() - 0.5) * 10), sets: ['5'] }))),
    ...workoutsFor('Sparse', [{ daysAgo: 50, weight: 100, sets: ['5'] }, { daysAgo: 10, weight: 100, sets: ['5'] }]),
    ...workoutsFor('BrandNew', [4, 2, 0].map(d => ({ daysAgo: d, weight: 100, sets: ['5'] }))),
    ...workoutsFor('VolUp', [56, 42, 28, 14, 0].map((d, i) => ({ daysAgo: d, weight: 200, sets: Array(i + 1).fill('10') }))),
    ...workoutsFor('VolDown', [56, 42, 28, 14, 0].map((d, i) => ({ daysAgo: d, weight: 200, sets: Array(5 - i).fill('10') }))),
    ...workoutsFor('Plank', [56, 42, 28, 14, 0].map((d, i) => ({ daysAgo: d, sets: [`${60 + i * 10}s`] }))),
    ...workoutsFor('Pull-up', [56, 42, 28, 14, 0].map((d, i) => ({ daysAgo: d, sets: [`${8 + i}`] }))),
  ];
  const groups = analyzeProgress(workouts, null, { now: NOW });

  const seen = new Map();
  for (const k of STATUS_KEYS) {
    for (const r of groups[k]) {
      assert.ok(!seen.has(r.name), `${r.name} appeared in both ${seen.get(r.name)} and ${k}`);
      seen.set(r.name, k);
    }
  }
  // Every exercise got classified exactly once.
  assert.equal(seen.size, 10);
});

test('END-TO-END: flat e1RM with a collapsing volume stays Stagnating + annotated', () => {
  const sessions = [
    { daysAgo: 56, weight: 200, sets: ['10', '10', '10', '10'] }, // vol 8000
    { daysAgo: 42, weight: 200, sets: ['10', '10', '10'] },       // vol 6000
    { daysAgo: 28, weight: 200, sets: ['10', '10'] },             // vol 4000
    { daysAgo: 14, weight: 200, sets: ['10', '10'] },             // vol 4000
    { daysAgo: 0, weight: 200, sets: ['10'] },                    // vol 2000
  ];
  const r = analyzeOne('Press', sessions);
  assert.equal(r.status, 'stagnating');
  assert.ok(r.volDeltaPct <= -0.10);
  assert.ok(r.annotations.includes('volume-down'));
});

test('END-TO-END: flat e1RM with rising volume upgrades to Progressing', () => {
  const sessions = [
    { daysAgo: 56, weight: 200, sets: ['10'] },
    { daysAgo: 42, weight: 200, sets: ['10', '10'] },
    { daysAgo: 28, weight: 200, sets: ['10', '10'] },
    { daysAgo: 14, weight: 200, sets: ['10', '10', '10'] },
    { daysAgo: 0, weight: 200, sets: ['10', '10', '10', '10'] },
  ];
  const r = analyzeOne('Press', sessions);
  assert.equal(r.status, 'progressing');
  assert.ok(r.annotations.includes('volume-up'));
});

// ===========================================================================
// Δ cell colour — never contradict the number's own sign
// ===========================================================================

test('deltaTone never colours a negative delta as a gain', () => {
  // THE FIX: volume can promote a lift to Progressing while e1RM ticked down.
  // Green on "−9.4 lb" would lie about the number sitting right next to it.
  assert.equal(deltaTone('progressing', -9.4), 'neutral');
  // …and the normal case is untouched.
  assert.equal(deltaTone('progressing', 12.5), 'up');
  assert.equal(deltaTone('progressing', 0), 'up');
});

test('deltaTone never colours a positive delta as a loss', () => {
  assert.equal(deltaTone('decreasing', -30.9), 'down');
  assert.equal(deltaTone('decreasing', 4.2), 'neutral'); // mirror-image mismatch
});

test('deltaTone leaves flat and intent-driven states neutral', () => {
  assert.equal(deltaTone('stagnating', 2.1), 'neutral');
  assert.equal(deltaTone('stagnating', -2.1), 'neutral');
  // A planned deload dip is not bad news — must not go red.
  assert.equal(deltaTone('deload', -30.9), 'neutral');
  assert.equal(deltaTone('maintaining', -5), 'neutral');
  assert.equal(deltaTone('nobaseline', null), 'neutral');
  assert.equal(deltaTone('progressing', null), 'neutral');
});

test('REGRESSION (real data): noise-guarded e1RM dip promoted on volume is not green', () => {
  // Reproduces "Inclined smith machine press" from the real history: the e1RM
  // trend is slightly down with a weak fit (noise guard → flat), volume climbs,
  // so the lift is Progressing while its Δ is negative.
  const sessions = [
    { daysAgo: 55, weight: 205, sets: ['10'] },
    { daysAgo: 48, weight: 195, sets: ['10', '10'] },
    { daysAgo: 34, weight: 210, sets: ['10', '10'] },
    { daysAgo: 27, weight: 195, sets: ['10', '10', '10'] },
    { daysAgo: 13, weight: 205, sets: ['10', '10', '10'] },
    { daysAgo: 2, weight: 198, sets: ['10', '10', '10', '10'] },
  ];
  const r = analyzeOne('Inclined smith machine press', sessions);
  assert.equal(r.status, 'progressing');
  assert.ok(r.deltaPct < 0, 'e1RM trend is negative');
  assert.ok(r.annotations.includes('volume-up'), 'promoted on volume');
  // The whole point: the Δ cell must NOT render green.
  assert.equal(deltaTone(r.status, r.delta), 'neutral');
});

// ===========================================================================
// Rule 4 — bodyweight & timed exercises
// ===========================================================================

test('isBodyweightExercise matches loadable bodyweight movements by name', () => {
  for (const n of ['Pull-up', 'pull ups', 'Chin-up', 'Dips', 'Decline push-up', 'Muscle-up', 'Inverted row']) {
    assert.equal(isBodyweightExercise(n), true, n);
  }
  for (const n of ['Bench press', 'Bicep curl', 'Cable crunches', 'Tricep pushdown', 'Squat']) {
    assert.equal(isBodyweightExercise(n), false, n);
  }
});

test('an exercise-library row can override the bodyweight heuristic', () => {
  assert.equal(isBodyweightExercise('Bench press', { bodyweight: true }), true);
  assert.equal(isBodyweightExercise('Pull-up', { bodyweight: false }), false);
});

test('weighted pull-ups use bodyweight + external load when bodyweight is known', () => {
  const weightLog = [{ date: key(90), weight: 180 }];
  const sessions = [56, 42, 28, 14, 0].map(daysAgo => ({ daysAgo, weight: 25, sets: ['10'] }));
  const r = analyzeOne('Pull-up', sessions, { weightLog });
  assert.equal(r.metric, 'e1rm');
  // (180 + 25) × (1 + 10/30) = 273.33
  assert.equal(Math.round(r.series[0].value * 100) / 100, 273.33);
});

test('bodyweight movements fall back to max reps when bodyweight is unknown', () => {
  const sessions = [56, 42, 28, 14, 0].map((daysAgo, i) => ({ daysAgo, weight: 25, sets: [`${8 + i}`] }));
  const r = analyzeOne('Pull-up', sessions); // no weightLog
  assert.equal(r.metric, 'reps');
  assert.equal(r.series[0].value, 8);
  assert.equal(r.series[4].value, 12);
  assert.equal(r.status, 'progressing'); // 8 → 12 reps is a real gain
});

test('bodyweight lookup picks the nearest reading on or before the session', () => {
  const at = makeBodyweightLookup([
    { date: '2026-01-01', weight: 200 },
    { date: '2026-03-01', weight: 190 },
    { date: '2026-06-01', weight: 180 },
  ]);
  assert.equal(at('2026-02-01'), 200);
  assert.equal(at('2026-03-01'), 190);
  assert.equal(at('2026-07-01'), 180);
  // Before any reading → falls back to the earliest known.
  assert.equal(at('2025-12-01'), 200);
  // No history at all → null.
  assert.equal(makeBodyweightLookup([])('2026-01-01'), null);
  assert.equal(makeBodyweightLookup(undefined)('2026-01-01'), null);
});

test('bodyweight gain alone registers on a fixed-rep bodyweight movement', () => {
  // Same reps throughout, but the lifter got heavier → more load moved.
  const weightLog = [
    { date: key(56), weight: 170 },
    { date: key(28), weight: 180 },
    { date: key(0), weight: 190 },
  ];
  const sessions = [56, 42, 28, 14, 0].map(daysAgo => ({ daysAgo, sets: ['10'] }));
  const r = analyzeOne('Pull-up', sessions, { weightLog });
  assert.equal(r.metric, 'e1rm');
  assert.equal(r.status, 'progressing');
});

test('timed holds trend on duration with the same thresholds', () => {
  const sessions = [56, 42, 28, 14, 0].map((daysAgo, i) => ({ daysAgo, sets: [`${60 + i * 10}s`] }));
  const r = analyzeOne('Plank', sessions);
  assert.equal(r.metric, 'time');
  assert.equal(r.series[0].value, 60);
  assert.equal(r.series[4].value, 100);
  assert.equal(r.status, 'progressing');
  // No volume signal exists for a timed hold.
  assert.equal(r.volDeltaPct, null);
});

test('a shortening hold classifies Decreasing', () => {
  const sessions = [56, 42, 28, 14, 0].map((daysAgo, i) => ({ daysAgo, sets: [`${120 - i * 10}s`] }));
  const r = analyzeOne('Plank', sessions);
  assert.equal(r.metric, 'time');
  assert.equal(r.status, 'decreasing');
});

test('switching from reps to load restarts the window (data discontinuity)', () => {
  const sessions = [
    // Bodyweight-style reps logging, no weight…
    { daysAgo: 56, sets: ['10'] },
    { daysAgo: 49, sets: ['10'] },
    { daysAgo: 42, sets: ['10'] },
    // …then the lifter started adding load. Different metric entirely.
    { daysAgo: 35, weight: 25, sets: ['10'] },
    { daysAgo: 28, weight: 30, sets: ['10'] },
    { daysAgo: 21, weight: 35, sets: ['10'] },
    { daysAgo: 14, weight: 40, sets: ['10'] },
    { daysAgo: 0, weight: 45, sets: ['10'] },
  ];
  const r = analyzeOne('Bicep curl', sessions);
  assert.equal(r.discontinuity, true);
  assert.equal(r.metric, 'e1rm');
  // Only the 5 loaded sessions are in the trend — the 3 rep-only ones are dropped.
  assert.equal(r.sessions, 5);
  assert.equal(r.spanDays, 35);
  assert.equal(r.status, 'progressing');
});

test('a consistent metric reports no discontinuity', () => {
  const sessions = [56, 42, 28, 14, 0].map(d => ({ daysAgo: d, weight: 100, sets: ['5'] }));
  const r = analyzeOne('Row', sessions);
  assert.equal(r.discontinuity, false);
  assert.equal(r.sessions, 5);
});

test('a discontinuity that leaves too little data → No Baseline, not a bogus trend', () => {
  const sessions = [
    { daysAgo: 56, sets: ['10'] },
    { daysAgo: 49, sets: ['10'] },
    { daysAgo: 42, sets: ['10'] },
    { daysAgo: 35, sets: ['10'] },
    { daysAgo: 2, weight: 25, sets: ['10'] }, // one loaded session only
  ];
  const r = analyzeOne('Bicep curl', sessions);
  assert.equal(r.discontinuity, true);
  assert.equal(r.sessions, 1);
  assert.equal(r.status, 'nobaseline');
});

// ===========================================================================
// Rule 5 — intent awareness
// ===========================================================================

const FALLING = [56, 42, 28, 14, 0].map((daysAgo, i) => ({ daysAgo, weight: 150 - i * 10, sets: ['5'] }));
const FLAT = [56, 42, 28, 14, 0].map(daysAgo => ({ daysAgo, weight: 100, sets: ['5'] }));
const RISING = [56, 42, 28, 14, 0].map((daysAgo, i) => ({ daysAgo, weight: 100 + i * 10, sets: ['5'] }));

test('global deload intent relabels Decreasing → Deload', () => {
  assert.equal(analyzeOne('Row', FALLING).status, 'decreasing');
  assert.equal(analyzeOne('Row', FALLING, { intent: 'deload' }).status, 'deload');
});

test('global maintenance intent relabels Stagnating → Maintaining', () => {
  assert.equal(analyzeOne('Row', FLAT).status, 'stagnating');
  assert.equal(analyzeOne('Row', FLAT, { intent: 'maintenance' }).status, 'maintaining');
});

test('intent suppresses both bad-news labels but never hides Progressing', () => {
  assert.equal(analyzeOne('Row', RISING, { intent: 'deload' }).status, 'progressing');
  assert.equal(analyzeOne('Row', RISING, { intent: 'maintenance' }).status, 'progressing');
  // Stagnating is suppressed under deload too, not just Decreasing.
  assert.equal(analyzeOne('Row', FLAT, { intent: 'deload' }).status, 'deload');
});

test('per-exercise intent overrides the global setting', () => {
  const r = analyzeOne('Row', FALLING, {
    intent: 'deload',
    intentByExercise: { row: 'maintenance' },
  });
  assert.equal(r.status, 'maintaining');
});

test('per-exercise "none" opts an exercise out of a global intent', () => {
  const r = analyzeOne('Row', FALLING, {
    intent: 'deload',
    intentByExercise: { row: 'none' },
  });
  assert.equal(r.status, 'decreasing');
});

test('intentByExercise accepts a Map as well as an object', () => {
  const r = analyzeOne('Row', FALLING, { intentByExercise: new Map([['row', 'deload']]) });
  assert.equal(r.status, 'deload');
});

test('intent is echoed on the result and leaves No Baseline alone', () => {
  const r = analyzeOne('Row', [{ daysAgo: 3, weight: 100, sets: ['5'] }], { intent: 'deload' });
  assert.equal(r.status, 'nobaseline');
  assert.equal(r.intent, 'deload');
});

test('an unrecognised intent value is ignored', () => {
  assert.equal(analyzeOne('Row', FALLING, { intent: 'bulking' }).status, 'decreasing');
});

// ===========================================================================
// Rule 6 — adaptive staleness threshold
// ===========================================================================

test('staleAfterDays is 2× the median logging gap', () => {
  // Every 7 days → 2 × 7 = 14, inside [10, 28].
  const sessions = [56, 49, 42, 35, 28, 21, 14, 7, 0].map(d => ({ daysAgo: d, weight: 100, sets: ['5'] }));
  const r = analyzeOne('Row', sessions);
  assert.equal(r.medianGapDays, 7);
  assert.equal(r.staleAfterDays, 14);
});

test('staleAfterDays is floored at STALE_MIN_DAYS for very frequent training', () => {
  // Every 3 days → 2 × 3 = 6 → floored to 10.
  const sessions = [30, 27, 24, 21, 18, 15, 12, 9, 6, 3, 0].map(d => ({ daysAgo: d, weight: 100, sets: ['5'] }));
  const r = analyzeOne('Row', sessions);
  assert.equal(r.medianGapDays, 3);
  assert.equal(r.staleAfterDays, STALE_MIN_DAYS);
});

test('staleAfterDays is capped at STALE_MAX_DAYS for rarely trained lifts', () => {
  // Every 18 days → 2 × 18 = 36 → capped to 28.
  const sessions = [54, 36, 18, 0].map(d => ({ daysAgo: d, weight: 100, sets: ['5'] }));
  const r = analyzeOne('Row', sessions);
  assert.equal(r.medianGapDays, 18);
  assert.equal(r.staleAfterDays, STALE_MAX_DAYS);
});

test('staleAfterDays falls back to 14 days below MIN_SESSIONS', () => {
  const sessions = [40, 20, 0].map(d => ({ daysAgo: d, weight: 100, sets: ['5'] }));
  const r = analyzeOne('Row', sessions);
  assert.ok(r.sessions < MIN_SESSIONS);
  assert.equal(r.staleAfterDays, STALE_FALLBACK_DAYS);
});

test('staleAfterDays uses the median, so one long layoff does not skew it', () => {
  // Gaps: 7,7,7,7,28 → median 7 → 14. A mean would give ~11 → 22.
  const sessions = [56, 28, 21, 14, 7, 0].map(d => ({ daysAgo: d, weight: 100, sets: ['5'] }));
  const r = analyzeOne('Row', sessions);
  assert.equal(r.medianGapDays, 7);
  assert.equal(r.staleAfterDays, 14);
});

// ===========================================================================
// Windowing / contract preservation
// ===========================================================================

test('sessions older than the 60-day window are excluded', () => {
  const sessions = [
    { daysAgo: 120, weight: 500, sets: ['5'] }, // way outside — must be ignored
    { daysAgo: 56, weight: 100, sets: ['5'] },
    { daysAgo: 42, weight: 100, sets: ['5'] },
    { daysAgo: 28, weight: 100, sets: ['5'] },
    { daysAgo: 0, weight: 100, sets: ['5'] },
  ];
  const r = analyzeOne('Row', sessions);
  assert.equal(r.sessions, 4);
  assert.equal(r.best, epley1RM(100, 5));
});

test('multiple entries on one date collapse into a single session', () => {
  const workouts = [{
    date: key(0),
    entries: [
      { exercise: 'Row', group: 'Back', sets: ['5'], weight: '100' },
      { exercise: 'Row', group: 'Back', sets: ['5'], weight: '120' },
    ],
  }];
  const groups = analyzeProgress(workouts, null, { now: NOW });
  const r = groups.nobaseline[0];
  assert.equal(r.sessions, 1);
  // Best e1RM across both entries wins; volumes add.
  assert.equal(Math.round(r.series[0].value * 100) / 100, 140); // 120 × (1+5/30)
  assert.equal(r.series[0].volume, 100 * 5 + 120 * 5);
});

test('lastDate reflects only completed (green) sets', () => {
  const sessions = [
    { daysAgo: 30, weight: 100, sets: ['5'], setDone: [true] },
    { daysAgo: 0, weight: 100, sets: ['5'], setDone: [false] }, // logged but not done
  ];
  const r = analyzeOne('Row', sessions);
  assert.equal(r.lastDate, key(30));
});

test('an exercise with no green sets at all reports a null lastDate', () => {
  const r = analyzeOne('Row', [{ daysAgo: 5, weight: 100, sets: ['5'] }]);
  assert.equal(r.lastDate, null);
});

test('empty and unmeasurable input is handled without throwing', () => {
  assert.deepEqual(analyzeProgress([], null, { now: NOW }).progressing, []);
  assert.deepEqual(analyzeProgress(undefined, null, { now: NOW }).nobaseline, []);
  // Entries with no usable sets produce no result at all.
  const groups = analyzeProgress(
    [{ date: key(0), entries: [{ exercise: 'Ghost', sets: ['', ''], weight: '' }] }],
    null, { now: NOW },
  );
  assert.equal(STATUS_KEYS.reduce((n, k) => n + groups[k].length, 0), 0);
});

test('the result shape the UI depends on is preserved', () => {
  const r = analyzeOne('Row', RISING);
  for (const field of ['name', 'group', 'metric', 'sessions', 'series', 'best', 'last',
    'lastDate', 'status', 'baseline', 'recent', 'delta', 'deltaPct', 'volDeltaPct', 'declining']) {
    assert.ok(field in r, `missing UI contract field: ${field}`);
  }
  for (const p of r.series) {
    assert.ok('date' in p && 'value' in p && 'volume' in p);
  }
  // delta/deltaPct stay mutually consistent for the Δ cell.
  assert.equal(Math.sign(r.delta), Math.sign(r.deltaPct));
});

test('analyzeProgress still works with the legacy 2-argument call', () => {
  // The component used to call analyzeProgress(workouts, groupByName) with no
  // options; that must keep working (it just can't inject `now`).
  const groups = analyzeProgress(workoutsFor('Row', [{ daysAgo: 0, weight: 100, sets: ['5'] }]), new Map([['row', 'Back']]));
  assert.equal(groups.nobaseline.length, 1);
  assert.equal(groups.nobaseline[0].group, 'Back');
});

test('groups are sorted best-gain-first / steepest-drop-first', () => {
  const workouts = [
    ...workoutsFor('SmallGain', [56, 42, 28, 14, 0].map((d, i) => ({ daysAgo: d, weight: 100 + i * 2, sets: ['5'] }))),
    ...workoutsFor('BigGain', [56, 42, 28, 14, 0].map((d, i) => ({ daysAgo: d, weight: 100 + i * 20, sets: ['5'] }))),
  ];
  const groups = analyzeProgress(workouts, null, { now: NOW });
  assert.equal(groups.progressing[0].name, 'BigGain');
  assert.equal(groups.progressing[1].name, 'SmallGain');
});
