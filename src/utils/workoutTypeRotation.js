// Paused workout types — which types are currently in the rotation.
//
// A pause takes a workout type out of everything that decides what you should
// do NEXT: the ⭐ suggestion on the Workout page, the overdue end of the pill
// row, the Week Plan's auto-filled days, and the workouts the hourly cron
// pushes into Google Calendar. It's for an injury, a season, or a gym you
// don't have access to this month.
//
// A PAUSE IS NOT A SKIP. A skip says "not today", moves the days-ago counter
// on, and leaves the type in the rotation. A pause says "leave me out until I
// say otherwise" and deliberately does NOT touch the counter — resume and you
// are however overdue you actually are, which is the honest answer and the one
// that tells you whether to prioritise it.
//
// A pause never overrides an EXPLICIT choice. Tapping a paused pill still logs
// it; a day you pinned to a paused type in the Week Plan still stands and still
// syncs. Only the automatic suggestions look at this.
//
// Stored on the user doc as `workoutTypePaused` and shared with the mobile app.
// Shape is a map so a lookup is O(1) at the render sites that need one per row:
//
//   { Snack: true }
//
// An unpaused type has its key DELETED rather than set to false, so the map
// only ever lists what's actually paused and `pausedTypes()` is just its keys.
// That matters because `{ Snack: false }` and `{}` must not read differently.

/** Defensive read of the stored field — it may be missing, or not an object. */
export function normalizeTypePaused(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    // Only truthy entries survive, which folds a legacy `false` into "absent".
    if (v) out[k] = true;
  }
  return out;
}

export function isTypePaused(typePaused, t) {
  return !!(typePaused && typePaused[t]);
}

/**
 * The types still in the rotation, in the order given.
 *
 * Callers that ORDER by staleness should filter with this rather than sorting
 * paused types to the back, because their lists are consumed by "pick the next
 * one" logic — a paused type at the back of a list still gets picked when the
 * list runs short.
 */
export function typesInRotation(workoutTypes, typePaused) {
  return (workoutTypes || []).filter(t => !isTypePaused(typePaused, t));
}

/** Just the paused names, for a count or a summary line. */
export function pausedTypes(typePaused) {
  return Object.keys(normalizeTypePaused(typePaused));
}

/** Pause an unpaused type, resume a paused one. Returns a NEW map. */
export function toggleTypePaused(typePaused, t) {
  const next = normalizeTypePaused(typePaused);
  if (next[t]) delete next[t]; else next[t] = true;
  return next;
}

/** Drop a type's pause — used when the type itself is deleted. */
export function withoutTypePause(typePaused, t) {
  const next = normalizeTypePaused(typePaused);
  delete next[t];
  return next;
}

/**
 * Sort comparator putting paused types behind active ones.
 *
 * Only for the pill ROW, which keeps paused types visible (greyed, at the end)
 * so you can still log one and so the pause is where you'd notice it. Anything
 * that PICKS a type should use typesInRotation instead.
 */
export function pausedLast(typePaused) {
  return (a, b) => Number(isTypePaused(typePaused, a)) - Number(isTypePaused(typePaused, b));
}
