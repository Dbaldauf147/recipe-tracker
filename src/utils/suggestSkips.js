// Suggested Meals "skip" list, stored on the user doc as `suggestSkips`:
// { [recipeId]: 'YYYY-MM-DD' } — the local date the skip runs out. A skipped
// recipe drops out of the suggestions until that date, then comes back.
//
// MIRRORED in the mobile app at PrepDay/src/utils/suggestSkips.ts; both read
// and write the same field, so keep the two in step (the tests match too).
//
// Writes go through a merge, which deep-merges maps — a key dropped locally
// can linger on the doc. So an entry's presence means nothing; always go
// through isSkipped, which checks the date.

export const SKIP_DAYS = 7;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function localDateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Anything that isn't a map of recipeId → date string reads as no skips. */
export function normalizeSuggestSkips(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, until] of Object.entries(raw)) {
    if (typeof until === 'string' && DATE_RE.test(until)) out[id] = until;
  }
  return out;
}

/** Skipped while today is before the `until` date. */
export function isSkipped(skips, recipeId, now = new Date()) {
  const until = skips[recipeId];
  return !!until && localDateKey(now) < until;
}

/** Add a skip running SKIP_DAYS from today, and drop any that have expired. */
export function skipRecipe(skips, recipeId, now = new Date(), days = SKIP_DAYS) {
  const until = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return { ...pruneExpired(skips, now), [recipeId]: localDateKey(until) };
}

export function pruneExpired(skips, now = new Date()) {
  const today = localDateKey(now);
  const out = {};
  for (const [id, until] of Object.entries(skips)) if (today < until) out[id] = until;
  return out;
}
