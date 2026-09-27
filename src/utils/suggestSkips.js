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

/**
 * Skip for one calendar month: back on the same day next month, or that
 * month's last day when it's shorter (Jan 31 → Feb 28), rather than letting
 * the Date constructor roll over into March.
 */
export function skipRecipeForMonth(skips, recipeId, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const until = new Date(y, m, Math.min(now.getDate(), lastDay));
  return { ...pruneExpired(skips, now), [recipeId]: localDateKey(until) };
}

// ── Back of the line ────────────────────────────────────────────────────────
// A second user-doc field, `suggestRequeues`: { [recipeId]: 'YYYY-MM-DD' } —
// the day the meal was sent to the back. Scoring treats that day as the last
// time the meal AND each of its key ingredients were eaten, so it drops to the
// bottom straight away and climbs back up on its own, exactly like a meal you
// just had. Nothing ever needs to expire it: once a real log date is later,
// the later date simply wins. Same shape as suggestSkips, so the same
// normalizer serves.

export const normalizeSuggestRequeues = normalizeSuggestSkips;

/** Send a meal to the back of the line as of today. */
export function requeueRecipe(requeues, recipeId, now = new Date()) {
  return { ...requeues, [recipeId]: localDateKey(now) };
}

/** The later of two YYYY-MM-DD dates, either of which may be missing. */
export function laterDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}
