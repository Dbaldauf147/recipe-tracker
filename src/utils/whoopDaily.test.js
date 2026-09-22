import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WHOOP_DAILY_KEY, cachedWhoopDaily, mergeWhoopDailyCache, whoopHistorySummary,
} from './whoopDaily.js';

function fakeStorage(initial = {}, { throwOnWrite = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    removeItem: k => { map.delete(k); },
    setItem(k, v) {
      if (throwOnWrite) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(k, v);
    },
    _map: map,
  };
}

function withStorage(storage, fn) {
  const had = 'localStorage' in globalThis;
  const prev = globalThis.localStorage;
  globalThis.localStorage = storage;
  try { return fn(); }
  finally {
    if (had) globalThis.localStorage = prev;
    else delete globalThis.localStorage;
  }
}

const night = (h) => ({ sleepHours: h, calories: 2400 });

// The cache is the union of the full history document and the 120-day slice
// that firestoreSync hydrates off the user document. A replace instead of a
// merge here is how a backfill would silently vanish on the next sign-in.
test('merging keeps days the incoming batch does not mention', () => {
  const store = fakeStorage({
    [WHOOP_DAILY_KEY]: JSON.stringify({ '2024-01-01': night(7.5), '2026-09-20': night(8) }),
  });
  const merged = withStorage(store, () => mergeWhoopDailyCache({ '2026-09-21': night(6.2) }));

  assert.deepEqual(Object.keys(merged).sort(), ['2024-01-01', '2026-09-20', '2026-09-21']);
  assert.deepEqual(
    Object.keys(JSON.parse(store._map.get(WHOOP_DAILY_KEY))).sort(),
    ['2024-01-01', '2026-09-20', '2026-09-21'],
  );
});

test('an incoming day wins over the cached copy of the same day', () => {
  const store = fakeStorage({ [WHOOP_DAILY_KEY]: JSON.stringify({ '2026-09-21': night(6.2) }) });
  const merged = withStorage(store, () => mergeWhoopDailyCache({ '2026-09-21': night(7.1) }));
  assert.equal(merged['2026-09-21'].sleepHours, 7.1);
});

test('a full localStorage still returns the merged map', () => {
  const store = fakeStorage(
    { [WHOOP_DAILY_KEY]: JSON.stringify({ '2026-09-20': night(8) }) },
    { throwOnWrite: true },
  );
  const merged = withStorage(store, () => mergeWhoopDailyCache({ '2026-09-21': night(6.2) }));
  assert.deepEqual(Object.keys(merged).sort(), ['2026-09-20', '2026-09-21']);
});

test('unreadable cached JSON reads as empty rather than throwing', () => {
  const store = fakeStorage({ [WHOOP_DAILY_KEY]: '{not json' });
  assert.deepEqual(withStorage(store, cachedWhoopDaily), {});
});

test('the summary counts nights with sleep, not days with any Whoop data', () => {
  const s = whoopHistorySummary({
    '2026-05-19': night(7.4),
    '2026-05-20': { calories: 2600 },           // wore it, no sleep recorded
    '2026-05-21': { sleepHours: 0, calories: 0 }, // a zero is not a night
    '2026-09-21': night(8.2),
  });
  assert.equal(s.days, 4);
  assert.equal(s.nights, 2);
  assert.equal(s.earliest, '2026-05-19');
  assert.equal(s.latest, '2026-09-21');
});

test('an empty history summarises without dates', () => {
  assert.deepEqual(whoopHistorySummary({}), { days: 0, nights: 0, earliest: null, latest: null });
  assert.deepEqual(whoopHistorySummary(null), { days: 0, nights: 0, earliest: null, latest: null });
});
