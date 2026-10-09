// What one categorize card saves onto a spot (EatingOutPage's categorize
// prompt — the cards that walk through spots one at a time).
//
// A field is saved when it was TOUCHED on the card — present in the draft —
// not when it happens to be non-empty. Gating on "non-empty" meant clearing a
// spot's last bucket or last category was silently dropped, so it came back.
// An emptied bucket list saves as [] (bucketsOf reads that as unsorted) with
// mealType cleared, the same shape the bulk Bucket Remove writes.
//
// Pure: no React / Firebase, so node --test can load it.

export function categorizePatch(draft = {}) {
  const patch = {};
  if (Array.isArray(draft.buckets)) {
    patch.buckets = draft.buckets;
    // mealType is kept in step with buckets everywhere else (CSV, mobile).
    patch.mealType = draft.buckets[0] || undefined;
  }
  // `categories` is the pre-merge list, already folded into the card's
  // categories; cleared so a category removed here can't come back from it.
  if (Array.isArray(draft.cuisines)) {
    patch.cuisines = draft.cuisines;
    patch.categories = [];
  }
  if (draft.status) patch.status = draft.status;
  // Stored as true-or-absent, the shape the editor saves, so a "no" clears the
  // field rather than writing a falsy value the filters must know about.
  if ('takenJoanne' in draft) {
    patch.takenJoanne = draft.takenJoanne || undefined;
    patch.joanneHoldOff = draft.joanneHoldOff || undefined;
  }
  // Tapping the lit frequency again clears it, so '' → absent.
  if ('frequency' in draft) patch.frequency = draft.frequency || undefined;
  return patch;
}
