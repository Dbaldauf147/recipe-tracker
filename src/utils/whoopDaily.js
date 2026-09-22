// The localStorage copy of the Whoop per-day rollup.
//
// There are three copies of this map and they are deliberately different sizes:
//
//   users/{uid}/data/whoopDaily   every night ever fetched, including whatever
//                                 api/whoop/backfill.js pulled in. The Progress
//                                 charts read this one.
//   users/{uid}.whoopDaily        a trailing 120-day slice, hydrated into
//                                 localStorage at sign-in by firestoreSync so
//                                 the calorie budget has today's number before
//                                 anything hits the network.
//   localStorage                  the union of both, so a chart can paint
//                                 immediately on a repeat visit.
//
// Everything here MERGES rather than replaces. The user-doc slice is smaller
// than the history, and letting the small one overwrite the cache is exactly
// how the charts would lose the backfill again.

export const WHOOP_DAILY_KEY = 'sunday-whoop-daily';

export function cachedWhoopDaily() {
  try {
    return JSON.parse(localStorage.getItem(WHOOP_DAILY_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

// Merge a batch of days into the cache and return the merged map. Never throws
// — a full localStorage still leaves the caller with usable in-memory data, it
// just won't survive a reload.
export function mergeWhoopDailyCache(daily) {
  const merged = { ...cachedWhoopDaily(), ...(daily || {}) };
  try {
    localStorage.setItem(WHOOP_DAILY_KEY, JSON.stringify(merged));
  } catch {
    /* quota — the caller still gets `merged` */
  }
  return merged;
}

// What the Whoop page reports back: how much history is actually stored, and
// how far it reaches. `nights` counts only days with a sleep total, which is
// what the Sleep chart can draw a bar for.
export function whoopHistorySummary(daily) {
  const dates = Object.keys(daily || {}).sort();
  const nights = dates.filter(
    d => typeof daily[d]?.sleepHours === 'number' && daily[d].sleepHours > 0,
  );
  return {
    days: dates.length,
    nights: nights.length,
    earliest: dates[0] || null,
    latest: dates[dates.length - 1] || null,
  };
}
