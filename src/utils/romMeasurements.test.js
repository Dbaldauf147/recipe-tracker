import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRomMeasurements, recordRomMeasurement, clearRomMeasurement,
  romEntry, romLatest, romPrevious, romCoverage, romKey, romDayLabel,
  ROM_HISTORY_MAX,
} from './romMeasurements.js';

test('a missing or junk field normalizes to an empty store', () => {
  for (const bad of [null, undefined, 'nope', 42, [], {}]) {
    assert.deepEqual(normalizeRomMeasurements(bad), { entries: {} });
  }
});

test('half-written entries are dropped rather than crashing a card', () => {
  const store = normalizeRomMeasurements({
    entries: {
      good: { value: 40, at: '2026-01-02', history: [{ at: '2026-01-02', value: 40 }] },
      noValue: { at: '2026-01-02' },
      nan: { value: 'abc' },
      notAnObject: 7,
    },
  });
  assert.deepEqual(Object.keys(store.entries), ['good']);
});

test('a numeric value stored as a string still reads back as a number', () => {
  const store = normalizeRomMeasurements({ entries: { a: { value: '55', at: '2026-01-02' } } });
  assert.strictEqual(store.entries.a.value, 55);
});

test('sides get their own key', () => {
  assert.equal(romKey('hamstrings-slr', 'l'), 'hamstrings-slr:l');
  assert.equal(romKey('trunk-flexion', ''), 'trunk-flexion');
  let store = normalizeRomMeasurements(null);
  store = recordRomMeasurement(store, 'hamstrings-slr', 'l', 60, '2026-01-01');
  store = recordRomMeasurement(store, 'hamstrings-slr', 'r', 45, '2026-01-01');
  assert.equal(romLatest(store, 'hamstrings-slr', 'l'), 60);
  assert.equal(romLatest(store, 'hamstrings-slr', 'r'), 45);
});

test('never measured reads as null, not zero', () => {
  const store = normalizeRomMeasurements(null);
  assert.equal(romLatest(store, 'hamstrings-slr', 'l'), null);
  assert.equal(romEntry(store, 'hamstrings-slr', 'l'), null);
});

test('re-measuring on the same day replaces that day instead of piling up', () => {
  // The dial is a drag: without this a single session leaves a dozen readings
  // behind and the trend line becomes noise.
  let store = normalizeRomMeasurements(null);
  for (const v of [40, 52, 61, 58]) {
    store = recordRomMeasurement(store, 'hamstrings-slr', 'l', v, '2026-03-04');
  }
  const e = romEntry(store, 'hamstrings-slr', 'l');
  assert.equal(e.value, 58);
  assert.equal(e.history.length, 1);
  assert.deepEqual(e.history[0], { at: '2026-03-04', value: 58 });
});

test('a new day appends, and history stays in date order', () => {
  let store = normalizeRomMeasurements(null);
  store = recordRomMeasurement(store, 'x', '', 50, '2026-03-04');
  store = recordRomMeasurement(store, 'x', '', 40, '2026-01-01'); // backdated
  store = recordRomMeasurement(store, 'x', '', 60, '2026-05-09');
  const e = romEntry(store, 'x', '');
  assert.deepEqual(e.history.map(h => h.at), ['2026-01-01', '2026-03-04', '2026-05-09']);
  assert.equal(e.value, 60);
});

test('history is capped, and it is the OLDEST readings that fall off', () => {
  let store = normalizeRomMeasurements(null);
  const days = ROM_HISTORY_MAX + 25;
  for (let i = 0; i < days; i += 1) {
    const d = new Date(2000, 0, 1 + i);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    store = recordRomMeasurement(store, 'x', '', i, day);
  }
  const e = romEntry(store, 'x', '');
  assert.equal(e.history.length, ROM_HISTORY_MAX);
  assert.equal(e.history.at(-1).value, days - 1, 'the newest reading survives');
  assert.equal(e.history[0].value, days - ROM_HISTORY_MAX);
});

test('the previous reading skips the one you just took', () => {
  let store = normalizeRomMeasurements(null);
  store = recordRomMeasurement(store, 'x', '', 50, '2026-01-01');
  store = recordRomMeasurement(store, 'x', '', 58, '2026-02-01');
  const prev = romPrevious(store, 'x', '');
  assert.deepEqual(prev, { at: '2026-01-01', value: 50 });
  // Only one reading ever: there is nothing to compare against.
  let solo = normalizeRomMeasurements(null);
  solo = recordRomMeasurement(solo, 'y', '', 30, '2026-01-01');
  assert.equal(romPrevious(solo, 'y', ''), null);
});

test('clearing forgets the history too', () => {
  let store = normalizeRomMeasurements(null);
  store = recordRomMeasurement(store, 'x', 'l', 50, '2026-01-01');
  store = recordRomMeasurement(store, 'x', 'r', 40, '2026-01-01');
  store = clearRomMeasurement(store, 'x', 'l');
  assert.equal(romLatest(store, 'x', 'l'), null);
  assert.equal(romLatest(store, 'x', 'r'), 40, 'the other side is untouched');
  // Clearing something that was never measured is a no-op, not a crash.
  assert.equal(clearRomMeasurement(store, 'nope', ''), store);
});

test('a bad value is ignored rather than written', () => {
  const store = normalizeRomMeasurements(null);
  assert.equal(recordRomMeasurement(store, 'x', '', 'abc'), store);
  assert.equal(recordRomMeasurement(store, 'x', '', null), store);
});

test('coverage counts one slot per measurable side', () => {
  const tests = [
    { id: 'a', min: 20, target: 70, bothSides: true },
    { id: 'b', min: 40, target: 60 },
  ];
  const sidesFor = t => (t.bothSides ? ['l', 'r'] : ['']);
  let store = normalizeRomMeasurements(null);
  assert.deepEqual(romCoverage(tests, store, sidesFor), { slots: 3, measured: 0, atTarget: 0, below: 0 });

  store = recordRomMeasurement(store, 'a', 'l', 75, '2026-01-01'); // at target
  store = recordRomMeasurement(store, 'a', 'r', 10, '2026-01-01'); // below the floor
  store = recordRomMeasurement(store, 'b', '', 50, '2026-01-01');  // in range
  assert.deepEqual(romCoverage(tests, store, sidesFor), { slots: 3, measured: 3, atTarget: 1, below: 1 });
});

test('day labels are built from local parts, never parsed as UTC', () => {
  // new Date('2026-01-01') is midnight UTC, which is 31 Dec west of Greenwich —
  // the label would name the wrong day for anyone in the Americas.
  assert.match(romDayLabel('2026-01-01'), /1/);
  assert.doesNotMatch(romDayLabel('2026-01-01'), /Dec/);
  assert.equal(romDayLabel('nonsense'), '');
  assert.equal(romDayLabel(undefined), '');
});
