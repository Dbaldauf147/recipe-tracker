/**
 * "Date added" for ingredient-DB rows — the website half of the mobile app's
 * src/utils/ingredientDates.ts. Rows carry `dateAdded` (ISO timestamp). Rows
 * from before the field existed have none; the DB is append-only in practice,
 * so for those the array position is the record of age: later = newer.
 */

const nameKey = r => ((r && r.ingredient) || '').toLowerCase().trim();

/**
 * Give `next` its dates before a save, against what was stored before (`prev`):
 *  - a row that already has a date keeps it;
 *  - a row whose name was stored with a date gets that date back (a caller
 *    working from a stale copy must not wipe it);
 *  - a named row APPENDED past the old end, under a name not stored before,
 *    is new and gets `now`.
 * With nothing stored before (a fresh browser loading the DB) nothing is new.
 */
export function stampNewRows(prev, next, now = new Date().toISOString()) {
  if (!Array.isArray(prev) || prev.length === 0 || !Array.isArray(next)) return next;
  const prevDates = new Map();
  for (const r of prev) if (r && r.dateAdded) prevDates.set(nameKey(r), r.dateAdded);
  const prevNames = new Set(prev.map(nameKey));
  let changed = false;
  const out = next.map((r, i) => {
    if (!r || r.dateAdded) return r;
    const key = nameKey(r);
    const carried = prevDates.get(key);
    if (carried) { changed = true; return { ...r, dateAdded: carried }; }
    if (key && i >= prev.length && !prevNames.has(key)) { changed = true; return { ...r, dateAdded: now }; }
    return r;
  });
  return changed ? out : next;
}

/** Newest first: dated rows by date, then undated in reverse array order. */
export function sortNewestFirst(items) {
  return [...items].sort((a, b) => {
    const da = a.row.dateAdded || '';
    const db = b.row.dateAdded || '';
    if (da && db) return db.localeCompare(da) || b.origIdx - a.origIdx;
    if (da) return -1;
    if (db) return 1;
    return b.origIdx - a.origIdx;
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 6, 2026", local time; '' when there is no usable date. */
export function formatDateAdded(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
