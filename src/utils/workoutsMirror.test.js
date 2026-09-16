import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mirrorCandidates, writeWorkoutsMirror, isWorkoutsMirrorPartial,
  MIRROR_FALLBACK_SIZES, WORKOUTS_STORAGE_KEY, WORKOUTS_PARTIAL_KEY,
} from './workoutsMirror.js';

/** A localStorage that refuses to hold more than `budget` characters, like a real one. */
function fakeStorage(budget = Infinity) {
  const map = new Map();
  const size = () => [...map.values()].reduce((n, v) => n + v.length, 0);
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    removeItem: k => { map.delete(k); },
    setItem(k, v) {
      const without = size() - (map.get(k)?.length || 0);
      if (without + v.length > budget) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(k, v);
    },
    _map: map,
  };
}

// The localStorage copy of the workout log. A log past the ~5 MB quota used to
// leave this frozen at whatever last fit — stale at the NEW end, which is how
// sessions logged this week vanished from the Week Plan while still showing in
// Workout ▸ History.

const log = (n) => Array.from({ length: n }, (_, i) => ({
  id: `w${i}`,
  date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-0${1 + (i % 9)}`,
}));

test('the first candidate is the whole log, newest first', () => {
  const [full] = mirrorCandidates([
    { id: 'old', date: '2020-01-01' },
    { id: 'new', date: '2026-09-15' },
  ]);
  assert.deepEqual(full.map(w => w.id), ['new', 'old']);
});

test('fallbacks keep the NEWEST slice, largest window first', () => {
  const candidates = mirrorCandidates(log(2000));
  assert.deepEqual(candidates.slice(1).map(c => c.length), MIRROR_FALLBACK_SIZES);
  for (const c of candidates) {
    // Whatever the window, it starts at the newest date in the log.
    assert.equal(c[0].date, '2026-12-09');
  }
});

test('windows no smaller than the log itself are skipped', () => {
  // 300 workouts: only the 250 and 100 windows are worth trying.
  assert.deepEqual(mirrorCandidates(log(300)).map(c => c.length), [300, 250, 100]);
  assert.deepEqual(mirrorCandidates(log(5)).map(c => c.length), [5]);
});

test('an empty or missing log still yields one empty candidate', () => {
  assert.deepEqual(mirrorCandidates([]), [[]]);
  assert.deepEqual(mirrorCandidates(undefined), [[]]);
});

test('the source array is not reordered in place', () => {
  const list = [{ id: 'old', date: '2020-01-01' }, { id: 'new', date: '2026-09-15' }];
  mirrorCandidates(list);
  assert.equal(list[0].id, 'old');
});

// ── writing it ──────────────────────────────────────────────────────────────

const read = () => JSON.parse(globalThis.localStorage.getItem(WORKOUTS_STORAGE_KEY) || 'null');

test('a log that fits is written whole, and not marked partial', () => {
  globalThis.localStorage = fakeStorage();
  assert.equal(writeWorkoutsMirror(log(10)), true);
  assert.equal(read().length, 10);
  assert.equal(isWorkoutsMirrorPartial(), false);
});

test('over quota it keeps the newest window instead of failing silently', () => {
  // Big enough for a few hundred rows, nowhere near 2,000 — the real shape of
  // this bug.
  globalThis.localStorage = fakeStorage(30_000);
  const all = log(2000);
  assert.equal(writeWorkoutsMirror(all), true);
  const saved = read();
  assert.ok(saved.length > 0 && saved.length < all.length, `wrote ${saved.length} of ${all.length}`);
  assert.ok(MIRROR_FALLBACK_SIZES.includes(saved.length));
  assert.equal(isWorkoutsMirrorPartial(), true);
  // The point of the whole change: the newest session is in the cache.
  assert.equal(saved[0].date, '2026-12-09');
});

test('a stale cache is dropped rather than left frozen when nothing fits', () => {
  const store = fakeStorage(200);
  globalThis.localStorage = store;
  store._map.set(WORKOUTS_STORAGE_KEY, JSON.stringify(log(3)));  // yesterday's copy
  assert.equal(writeWorkoutsMirror(log(2000)), false);
  assert.equal(globalThis.localStorage.getItem(WORKOUTS_STORAGE_KEY), null);
  assert.equal(isWorkoutsMirrorPartial(), true);
});

test('storage being unavailable is survivable', () => {
  globalThis.localStorage = {
    getItem() { throw new Error('disabled'); },
    setItem() { throw new Error('disabled'); },
    removeItem() { throw new Error('disabled'); },
  };
  assert.equal(writeWorkoutsMirror(log(5)), false);
  assert.equal(isWorkoutsMirrorPartial(), false);
});
