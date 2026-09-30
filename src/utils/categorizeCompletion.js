// How much of your Eating Out list is "filed" — the question the categorize
// prompt on the Eating Out page asks, one place at a time.
//
// Population: MY OWN spots that aren't retired (a friend's spot can't be edited
// from here, and retired ones are hidden by default). A spot counts as filed
// when it has BOTH a bucket and a category.
//
// `bucketsOf` is passed in rather than imported: it lives in EatingOutPage.jsx
// (it reads the user-editable bucket config and migrates the old `mealType`),
// and this module stays pure so `node --test` can load it.

/** A spot the categorize prompt asks about at all. */
export function inCategorizePopulation(r) {
  return !!r && !!r._isMine && r.frequency !== 'retired';
}

/** Has both a bucket and a category. */
export function isCategorized(r, bucketsOf) {
  return bucketsOf(r).length > 0 && (r.cuisines || []).length > 0;
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
