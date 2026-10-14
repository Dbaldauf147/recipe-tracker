// How much of your Eating Out list is "filed" — the question the categorize
// prompt on the Eating Out page asks, one place at a time.
//
// Population: MY OWN spots that aren't retired (a friend's spot can't be edited
// from here, and retired ones are hidden by default). A spot counts as filed
// when it has BOTH a bucket and a category — except Coffee-only spots, which
// need just the bucket (categoryExempt).
//
// `bucketsOf` is passed in rather than imported: it lives in EatingOutPage.jsx
// (it reads the user-editable bucket config and migrates the old `mealType`),
// and this module stays pure so `node --test` can load it.

/** A spot the categorize prompt asks about at all. */
export function inCategorizePopulation(r) {
  return !!r && !!r._isMine && r.frequency !== 'retired';
}

/** Buckets whose spots don't need a category (2026-10-14: "a coffee place is a coffee place"). */
export const NO_CATEGORY_BUCKETS = new Set(['coffee']);

/**
 * True when every bucket is one that needs no category (and there is at least
 * one). A café that is ALSO in Breakfast still wants a category.
 */
export function categoryExempt(bucketKeys) {
  const keys = Array.isArray(bucketKeys) ? bucketKeys : [];
  return keys.length > 0 && keys.every(k => NO_CATEGORY_BUCKETS.has(k));
}

/** Has a bucket, and a category unless the buckets are category-exempt. */
export function isCategorized(r, bucketsOf) {
  const buckets = bucketsOf(r);
  return buckets.length > 0 && (categoryExempt(buckets) || (r.cuisines || []).length > 0);
}

/**
 * { done, total, pct } over the population. `pct` is rounded DOWN, so 99.6%
 * reads 99% — "100%" only ever means nothing is left. An empty population is
 * 100% (there is nothing to file).
 */
export function categorizeCompletion(restaurants, bucketsOf) {
  let total = 0;
  let done = 0;
  for (const r of restaurants || []) {
    if (!inCategorizePopulation(r)) continue;
    total++;
    if (isCategorized(r, bucketsOf)) done++;
  }
  const pct = total === 0 ? 100 : Math.floor((done * 100) / total);
  return { done, total, pct };
}

/**
 * Which questions on the categorize card are still unanswered, for the red
 * "missing" flags. `v` is what the card shows (the spot with this card's
 * answers on top), so a flag clears the moment you answer it.
 *
 * - buckets / cuisines: the two that make a spot "filed" (isCategorized);
 *   no category needed for Coffee-only spots.
 * - status: Been / Not yet / Hold off has never been picked.
 * - frequency: only for places you've been, and not for Drinking / Going Out
 *   only spots — the same rule as missingCategories on the page.
 *
 * "Taken Joanne?" is never flagged: "Not yet" is stored as the field being
 * absent, so it can't be told apart from never having answered.
 */
export function categorizeGaps(v, { visited = false, frequencyExempt = false } = {}) {
  const gaps = new Set();
  if (!(v.buckets || []).length) gaps.add('buckets');
  if (!(v.cuisines || []).length && !categoryExempt(v.buckets)) gaps.add('cuisines');
  if (!v.status) gaps.add('status');
  const beenThere = v.status === 'visited' || visited;
  if (beenThere && !frequencyExempt && !String(v.frequency || '').trim()) gaps.add('frequency');
  return gaps;
}
