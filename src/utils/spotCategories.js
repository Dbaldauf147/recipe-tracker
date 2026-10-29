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

/**
 * The List tab's "By category" cut: one group per category, each holding the
 * spots tagged with it, in the order the spots came in. A spot tagged Italian +
 * Pizza sits under both, the same as the Rankings tab's By category view.
 *
 * `namesOf(r)` says which categories a spot counts under and `labelOf(name)` how
 * a group is spelled — passed in so the page can drop bucket words that leaked
 * into the cuisine list. Names fold case-insensitively, first spelling wins.
 * Biggest group first, then A–Z. Spots with no category come back separately
 * rather than as a category called "Other".
 */
export function groupSpotsByCategory(spots, namesOf = spotCategories, labelOf = n => n) {
  const byKey = new Map();
  const uncategorized = [];
  for (const r of spots || []) {
    const seen = new Set();
    for (const raw of namesOf(r) || []) {
      const name = String(raw || '').trim();
      const key = name.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!byKey.has(key)) byKey.set(key, { key, label: labelOf(name), spots: [] });
      byKey.get(key).spots.push(r);
    }
    if (seen.size === 0) uncategorized.push(r);
  }
  const groups = [...byKey.values()].sort((a, b) => (
    b.spots.length - a.spots.length || a.label.localeCompare(b.label)
  ));
  return { groups, uncategorized };
}
