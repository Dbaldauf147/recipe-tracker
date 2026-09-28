// Eating Out spot categories — ONE list per spot.
//
// Until 2026-09-28 a spot had two tag lists: `cuisines` (food types, which the
// Rankings "By category" view and Try Next group by) and a separate
// `categories` list ("Categories (for voting)"). They were merged: every
// ranking and filter now runs on the single list.
//
//   - The storage field is still `cuisines` (the mobile app and
//     api/extract-restaurant.js read it); the UI calls it "Category".
//   - The old `categories` field is only READ, for rows written before the
//     merge — spotCategories() folds it in — and every write of a spot's
//     categories clears it (`categories: []`) so a removed tag can't come back
//     from the old field.
//
// Pure module (no React / firebase) so `node --test` can load it.

// Case-insensitive, trimmed dedupe. Empty/non-string values are dropped and
// the FIRST spelling seen wins.
function dedupeTags(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

const asArray = v => (Array.isArray(v) ? v : []);

/** A spot's categories: its `cuisines`, then any old `categories`, deduped. */
export function spotCategories(r) {
  if (!r) return [];
  return dedupeTags([...asArray(r.cuisines), ...asArray(r.categories)]);
}

/** The spot with the merged list in `cuisines` and the old field emptied. */
export function withMergedCategories(r) {
  if (!r) return r;
  return { ...r, cuisines: spotCategories(r), categories: [] };
}

/** Merge two master category lists (e.g. old cuisines + old categories). */
export function mergeCategoryLists(a, b) {
  return dedupeTags([...asArray(a), ...asArray(b)]);
}
