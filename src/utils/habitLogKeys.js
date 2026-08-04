// Pure key/merge logic for the per-year habitLog. NO imports — this module is
// shared by the browser (src/utils/habitLogYears.js) and the crons
// (api/_data/habitLogYears.js), which otherwise had to keep two byte-identical
// copies of the parsing rules in sync. Misfiling a period key means marks land
// in the wrong year document and disappear from the UI, so there is exactly one
// implementation of it.
//
// (The mobile app has its own copy in PrepDay/src/services/habitLogYears.ts —
// separate repo, so that one can't share this file. Change both together.)

/**
 * Year a period key belongs to. Every cadence's key starts with the 4-digit
 * year: daily '2026-07-28', weekly '2026-W31', monthly '2026-07', annual '2026'.
 * Returns null for anything else so junk keys can be dropped rather than
 * silently filed under the wrong year.
 */
export function yearOfPeriodKey(key) {
  const m = String(key || '').match(/^(\d{4})(?:$|[-W])/);
  return m ? m[1] : null;
}

/** Split a whole habitLog into { year: { periodKey: {habitId: mark} } }. */
export function splitByYear(log) {
  const out = {};
  for (const key of Object.keys(log || {})) {
    const year = yearOfPeriodKey(key);
    if (!year) continue;
    const row = log[key];
    if (!row || typeof row !== 'object' || Object.keys(row).length === 0) continue;
    (out[year] || (out[year] = {}))[key] = row;
  }
  return out;
}

/** Which years a set of period keys touches (what a write needs to rewrite). */
export function yearsForKeys(keys) {
  const years = new Set();
  for (const k of keys || []) {
    const y = yearOfPeriodKey(k);
    if (y) years.add(y);
  }
  return [...years];
}

/** Merge year documents back into one habitLog. */
export function mergeYearDocs(docsByYear) {
  const log = {};
  for (const year of Object.keys(docsByYear || {}).sort()) {
    const part = docsByYear[year] || {};
    for (const key of Object.keys(part)) log[key] = part[key];
  }
  return log;
}

/**
 * Parse one year document's stored payload.
 *
 * `marks` is a JSON string in the current format; a map is tolerated because an
 * earlier write (or a hand edit in the Firestore console) can leave one.
 */
export function parseYearDoc(data) {
  if (!data) return {};
  const raw = data.marks;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? raw : {};
}

/** Count the marks in a habitLog — used for the migration's verification. */
export function countMarks(log) {
  let n = 0;
  for (const key of Object.keys(log || {})) n += Object.keys(log[key] || {}).length;
  return n;
}

/**
 * Group cell changes by the year document each one belongs in.
 *
 * A "cell" is { key, habitId, mark } — one habit's mark for one period, with a
 * null/undefined mark meaning erase. Keys that don't resolve to a year are
 * dropped for the same reason splitByYear drops them: a junk key must never
 * land in a real year's document.
 */
export function cellsByYear(cells) {
  const out = {};
  for (const c of cells || []) {
    if (!c || !c.habitId) continue;
    const year = yearOfPeriodKey(c.key);
    if (!year) continue;
    (out[year] || (out[year] = [])).push(c);
  }
  return out;
}

/**
 * Apply cell changes to one year's map, returning a NEW map.
 *
 * This is the merge that makes concurrent writers safe. Everything not named in
 * `cells` is carried through from `part` untouched, so a mark somebody else
 * added since we read the year survives — where writing our whole copy of the
 * year back would silently drop it.
 */
export function applyCells(part, cells) {
  const out = { ...(part || {}) };
  for (const { key, habitId, mark } of cells || []) {
    const bucket = { ...(out[key] || {}) };
    if (mark === null || mark === undefined) delete bucket[habitId];
    else bucket[habitId] = mark;
    if (Object.keys(bucket).length === 0) delete out[key];
    else out[key] = bucket;
  }
  return out;
}

/**
 * The cells that differ between two logs, as applyCells input.
 *
 * Used by a writer that computed a whole new log in memory but should only
 * persist what it actually changed. Deletions are reported as a null mark.
 */
export function diffCells(next, base) {
  const out = [];
  const keys = new Set([...Object.keys(next || {}), ...Object.keys(base || {})]);
  for (const key of keys) {
    const nb = (next || {})[key] || {};
    const ob = (base || {})[key] || {};
    for (const habitId of new Set([...Object.keys(nb), ...Object.keys(ob)])) {
      if (nb[habitId] === ob[habitId]) continue;
      out.push({ key, habitId, mark: nb[habitId] ?? null });
    }
  }
  return out;
}

/**
 * Merge two logs at the MARK level, `overlay` winning per cell.
 *
 * A shallow `{...base, ...overlay}` would be wrong: it replaces a whole period
 * bucket, so a day the overlay knows one mark for would drop every other
 * habit's mark on that day.
 */
export function mergeLogs(base, overlay) {
  const out = { ...(base || {}) };
  for (const key of Object.keys(overlay || {})) {
    out[key] = { ...(out[key] || {}), ...overlay[key] };
  }
  return out;
}
