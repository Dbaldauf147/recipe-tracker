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
