import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyweightLbOn, bodyweightLbForWeek, applyBodyweightToEntries, isPlaceholderOne,
  backfillBodyweightOnes, formatBodyweightLb,
} from './bodyweightLoad.js';

// ⚠️ Mirrored in PrepDay src/utils/bodyweightLoad.test.ts.

// Weeks run Sun–Sat. 2026-09-06 is a Sunday.
const LOG = [
  { date: '2026-08-20', weight: 190 },
  { date: '2026-09-08', weight: 186 },   // Tue, week of Sep 6
  { date: '2026-09-11', weight: 185.44 }, // Fri, same week
  { date: '2026-09-25', weight: 84, unit: 'kg' }, // Fri, week of Sep 20
];

test('bodyweightLbOn is the latest weigh-in on or before the day, else the earliest', () => {
  assert.equal(bodyweightLbOn(LOG, '2026-09-10'), 186);
  assert.equal(bodyweightLbOn(LOG, '2026-09-11'), 185.44);
  assert.equal(bodyweightLbOn(LOG, '2026-08-01'), 190);
  assert.ok(Math.abs(bodyweightLbOn(LOG, '2026-10-01') - 84 * 2.2046226218) < 1e-6);
  assert.equal(bodyweightLbOn([], '2026-09-10'), null);
});

test('bodyweightLbForWeek uses that week, nearest on/before the workout day', () => {
  assert.equal(bodyweightLbForWeek(LOG, '2026-09-10'), 186);   // Thu: Tue's reading
  assert.equal(bodyweightLbForWeek(LOG, '2026-09-12'), 185.44); // Sat: Fri's
  assert.equal(bodyweightLbForWeek(LOG, '2026-09-06'), 186);   // Sun: only later ones that week → first
});

test('a week with no weigh-in falls back to the most recent before it, then the earliest', () => {
  assert.equal(bodyweightLbForWeek(LOG, '2026-09-16'), 185.44); // week of Sep 13: none → Sep 11
  assert.equal(bodyweightLbForWeek(LOG, '2026-08-05'), 190);    // before everything → earliest
});

test('placeholder detection: 1 lb, or 1 kg as stored in lb', () => {
  assert.ok(isPlaceholderOne('1'));
  assert.ok(isPlaceholderOne(1));
  assert.ok(isPlaceholderOne('2.2046'));
  assert.ok(!isPlaceholderOne('10'));
  assert.ok(!isPlaceholderOne(''));
  assert.ok(!isPlaceholderOne('0.5'));
});

test('formatting rounds to one decimal', () => {
  assert.equal(formatBodyweightLb(185.44), '185.4');
  assert.equal(formatBodyweightLb(186), '186');
  assert.equal(formatBodyweightLb(0), '');
});

test('applyBodyweightToEntries only moves flagged entries, and is stable when nothing changes', () => {
  const entries = [
    { exercise: 'Pull-up', useBodyWeight: true, weight: '180' },
    { exercise: 'Bench', weight: '135' },
  ];
  const out = applyBodyweightToEntries(entries, 185.44);
  assert.equal(out[0].weight, '185.4');
  assert.equal(out[1], entries[1]);
  assert.equal(applyBodyweightToEntries(out, 185.44), out);
  assert.equal(applyBodyweightToEntries(entries, null), entries);
});

test('backfill rewrites 1s with that week\'s body weight and flags single-weight rows', () => {
  const workouts = [
    {
      id: 'a', date: '2026-09-10',
      entries: [
        { exercise: 'Pull-up', weight: '1', perArm: false, totalWeight: 1, maxWeight: 1, sets: ['8'] },
        { exercise: 'Bench', weight: '135', totalWeight: 135, maxWeight: 135, sets: ['5'] },
        { exercise: 'Lunge', useSetWeights: true, setWeights: ['1', '25', '', ''], weight: '1', perArm: true, totalWeight: 50, maxWeight: 50 },
      ],
      suggestedEntries: [{ exercise: 'Dip', weight: '1' }],
    },
    { id: 'b', date: '2026-09-16', entries: [{ exercise: 'Bench', weight: '140' }] },
    { id: 'c', date: '2026-09-16', entries: [{ exercise: 'Push-up', weight: '1' }] },
  ];
  const { changed, entries } = backfillBodyweightOnes(workouts, LOG);
  assert.deepEqual(changed.map(w => w.id), ['a', 'c']);
  assert.equal(entries, 3);
  const [a, c] = changed;
  assert.deepEqual(
    { w: a.entries[0].weight, bw: a.entries[0].useBodyWeight, t: a.entries[0].totalWeight, m: a.entries[0].bodyweightBackfill },
    { w: '186', bw: true, t: 186, m: '1' },
  );
  assert.equal(a.entries[1], workouts[0].entries[1]); // untouched row is the same object
  // Per-set: only the 1 is replaced, no flag; stats follow (per-arm doubles).
  assert.deepEqual(a.entries[2].setWeights, ['186', '25', '', '']);
  assert.equal(a.entries[2].useBodyWeight, undefined);
  assert.equal(a.entries[2].weight, '186');
  assert.equal(a.entries[2].maxWeight, 372);
  // The refill template is fixed too, without growing stats it never had.
  assert.deepEqual(a.suggestedEntries[0], { exercise: 'Dip', weight: '186', useBodyWeight: true, bodyweightBackfill: '1' });
  // A week with no weigh-in takes the most recent before it.
  assert.equal(c.entries[0].weight, '185.4');
  // Running it again finds nothing left to do.
  assert.equal(backfillBodyweightOnes([a, c], LOG).changed.length, 0);
});

test('backfill does nothing without any weigh-ins', () => {
  const r = backfillBodyweightOnes([{ id: 'a', date: '2026-09-10', entries: [{ weight: '1' }] }], []);
  assert.deepEqual(r, { changed: [], entries: 0 });
});
