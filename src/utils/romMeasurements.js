// Stored range-of-motion measurements.
//
// Lives on the user doc as `romMeasurements`, so a number taken on the laptop
// is there on the phone browser. Shape:
//
//   { entries: { 'hamstrings-slr:l': { value: 62, at: '2026-09-07',
//                                      history: [{ at: '2026-08-01', value: 55 }] } } }
//
// One flat map keyed by `testId` or `testId:side`, rather than nesting sides
// under the test: a test only grows a second side when `bothSides` is set, and
// a flat key means adding one later doesn't have to migrate anything.
//
// Dates are LOCAL day keys (YYYY-MM-DD), not ISO timestamps. The unit here is
// "the day you measured" — a clock time would be noise, and it makes the
// same-day rule below a plain string compare.

import { todayKey } from './localDate.js';

/** How many past readings to keep per key. Roughly a decade of monthly checks. */
export const ROM_HISTORY_MAX = 120;

export function romKey(id, side) {
  return side ? `${id}:${side}` : id;
}

/** Defensive read — the field may be missing, a string, or half-written. */
export function normalizeRomMeasurements(raw) {
  const entries = {};
  const src = raw && typeof raw === 'object' ? (raw.entries || {}) : {};
  for (const [key, e] of Object.entries(src)) {
    if (!e || typeof e !== 'object') continue;
    const value = Number(e.value);
    if (!Number.isFinite(value)) continue;
    const history = Array.isArray(e.history)
      ? e.history
        .filter(h => h && typeof h.at === 'string' && Number.isFinite(Number(h.value)))
        .map(h => ({ at: h.at, value: Number(h.value) }))
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
      : [];
    entries[key] = { value, at: typeof e.at === 'string' ? e.at : '', history };
  }
  return { entries };
}

export function romEntry(store, id, side) {
  return store?.entries?.[romKey(id, side)] || null;
}

/** The latest number, or null when this one has never been measured. */
export function romLatest(store, id, side) {
  const e = romEntry(store, id, side);
  return e ? e.value : null;
}

/**
 * Record a measurement, returning a NEW store.
 *
 * Re-measuring on a day you already measured REPLACES that day rather than
 * appending: the dial is a drag, so a single session would otherwise leave a
 * dozen readings behind and make the trend line meaningless.
 */
export function recordRomMeasurement(store, id, side, value, day = todayKey()) {
  // Blank is "not measured", and Number(null) / Number('') are both 0 — which
  // would file a cleared dial as a genuine reading of zero degrees.
  if (value === null || value === undefined || String(value).trim() === '') return store;
  const v = Number(value);
  if (!Number.isFinite(v)) return store;
  const key = romKey(id, side);
  const prev = store?.entries?.[key];
  const history = (prev?.history || []).filter(h => h.at !== day);
  history.push({ at: day, value: v });
  history.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return {
    ...store,
    entries: {
      ...(store?.entries || {}),
      [key]: { value: v, at: day, history: history.slice(-ROM_HISTORY_MAX) },
    },
  };
}

/** Forget a measurement entirely, history included. */
export function clearRomMeasurement(store, id, side) {
  const key = romKey(id, side);
  if (!store?.entries?.[key]) return store;
  const entries = { ...store.entries };
  delete entries[key];
  return { ...store, entries };
}

/**
 * The reading before the current one, for the "+4° since 1 Aug" line.
 * Skips same-day history so a re-measure compares against a different day.
 */
export function romPrevious(store, id, side) {
  const e = romEntry(store, id, side);
  if (!e) return null;
  const older = e.history.filter(h => h.at !== e.at);
  return older.length ? older[older.length - 1] : null;
}

/**
 * How the whole board is doing — the line under the header.
 * Counts one slot per measurable side, so a both-sides test counts twice.
 */
export function romCoverage(tests, store, sidesFor) {
  let slots = 0; let measured = 0; let atTarget = 0; let below = 0;
  for (const t of tests) {
    for (const side of sidesFor(t)) {
      slots += 1;
      const v = romLatest(store, t.id, side);
      if (v === null) continue;
      measured += 1;
      if (v >= t.target) atTarget += 1;
      else if (v < t.min) below += 1;
    }
  }
  return { slots, measured, atTarget, below };
}

/** "1 Aug" — short enough to sit inline next to a number. */
export function romDayLabel(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const [y, m, d] = day.split('-').map(Number);
  // Built from parts, not new Date(day), which parses a bare date as UTC and
  // can land on the previous evening west of Greenwich.
  const dt = new Date(y, m - 1, d);
  const now = new Date();
  const sameYear = dt.getFullYear() === now.getFullYear();
  return dt.toLocaleDateString(undefined, sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}
