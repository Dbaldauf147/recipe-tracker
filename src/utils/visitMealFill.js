/* Fill empty meal slots from Eating Out visits.

   A visit is a card charge Wealth Architect matched to a spot (see
   spotVisits.js): proof you ate there that day. When the day's log has a
   matching meal slot still EMPTY, this logs the spot into it — the same
   "place only" entry the Eating Out picker writes (zero nutrition, flagged
   eatingOut, linked to the spot), plus `fromVisit` so it can be traced back.

   Which slot comes from the spot's buckets, since a charge has no time of day:
     breakfast     → breakfast
     lunch-dinner  → lunch, else dinner (the first one still empty)
   A spot in both tries breakfast first. Coffee / drinks / going-out and
   unsorted spots aren't meals, so they never fill anything.

   Never overwrites. A slot counts as taken when it has ANY entry (logged or
   planned), when it's marked skipped, or when the whole day is skipped. The
   "🍔 Eating out — pick a place" placeholder is a gap waiting for exactly
   this, so it's filled and the mark cleared, as logging from the picker does.

   Each visit is used at most once, ever: its id goes on the day's
   `visitsApplied`, which stays even if you delete the meal it made — so a
   meal you took out never comes back. Two charges at one spot on one day
   (a tip, a second round) fill one slot, not two.

   Pure: the caller loads the log, visits and spots and saves the result. */

const MAIN_SLOTS_FOR_BUCKET = {
  breakfast: ['breakfast'],
  'lunch-dinner': ['lunch', 'dinner'],
};

/** A spot's bucket keys; falls back to the legacy single `mealType`. */
function spotBuckets(spot) {
  if (Array.isArray(spot?.buckets) && spot.buckets.length) return spot.buckets;
  return spot?.mealType ? [spot.mealType] : [];
}

/** The meal slots a visit to this spot could fill, in the order to try them. */
export function slotsForSpot(spot) {
  const b = spotBuckets(spot);
  const out = [];
  for (const key of ['breakfast', 'lunch-dinner']) {
    if (b.includes(key)) out.push(...MAIN_SLOTS_FOR_BUCKET[key]);
  }
  return out;
}

/** Is this slot already accounted for on the day? */
export function slotTaken(day, slot) {
  if (!day) return false;
  if (day.daySkipped) return true;
  if (Array.isArray(day.skippedMeals) && day.skippedMeals.includes(slot)) return true;
  return (day.entries || []).some(e => e?.mealSlot === slot);
}

const noonIso = date => new Date(`${date}T12:00:00`).toISOString();

/**
 * @param log          the daily log: { [YYYY-MM-DD]: { entries, ... } }
 * @param visits       { [externalId]: { placeId, date, amount, merchant } }
 * @param restaurants  the owner's spots (id, name, buckets)
 * @param makeId       id generator for new entries
 * @returns { log, changed, filled: [{ date, slot, spot, externalId }] }
 */
export function fillMealGapsFromVisits(log, visits, restaurants, makeId = () => crypto.randomUUID()) {
  const spots = new Map((restaurants || []).filter(r => r?.id).map(r => [r.id, r]));
  const next = { ...(log || {}) };
  const filled = [];
  const seenDayPlace = new Set();

  // Oldest first, then by id, so the outcome doesn't depend on map order.
  const list = Object.entries(visits || {})
    .filter(([, v]) => v?.placeId && /^\d{4}-\d{2}-\d{2}$/.test(v.date || ''))
    .sort(([a, va], [b, vb]) => (va.date < vb.date ? -1 : va.date > vb.date ? 1 : a < b ? -1 : 1));

  for (const [externalId, v] of list) {
    const day = next[v.date];
    const applied = Array.isArray(day?.visitsApplied) ? day.visitsApplied : [];
    if (applied.includes(externalId)) continue;

    // Another charge at this spot today already filled (or was already used).
    const dayPlace = `${v.date}|${v.placeId}`;
    const alreadyHere = seenDayPlace.has(dayPlace)
      || (day?.entries || []).some(e => e?.eatingOut && e.restaurantId === v.placeId && e.fromVisit);
    if (alreadyHere) continue;

    const spot = spots.get(v.placeId);
    if (!spot?.name) continue;
    const slot = slotsForSpot(spot).find(s => !slotTaken(day, s));
    if (!slot) continue;

    const entry = {
      id: makeId(),
      type: 'custom_meal',
      recipeName: spot.name,
      mealSlot: slot,
      timestamp: noonIso(v.date),
      nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      eatingOut: true,
      restaurantId: spot.id,
      fromVisit: externalId,
    };
    const base = day || { entries: [] };
    const dayNext = {
      ...base,
      entries: [...(base.entries || []), entry],
      visitsApplied: [...applied, externalId],
    };
    if (Array.isArray(dayNext.eatingOutMeals) && dayNext.eatingOutMeals.includes(slot)) {
      dayNext.eatingOutMeals = dayNext.eatingOutMeals.filter(s => s !== slot);
    }
    next[v.date] = dayNext;
    seenDayPlace.add(dayPlace);
    filled.push({ date: v.date, slot, spot: spot.name, externalId });
  }

  return { log: filled.length ? next : log, changed: filled.length > 0, filled };
}
