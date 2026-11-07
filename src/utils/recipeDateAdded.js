// "Added Nov 6, 2026" for the recipe popup.
//
// createdAt is normally an ISO string, but older or synced recipes can carry a
// millisecond number or a Firestore Timestamp ({ seconds } / toDate()). Recipes
// saved before createdAt existed have none, and get no label rather than a
// made-up date.

export function recipeAddedDate(createdAt) {
  if (createdAt == null || createdAt === '') return null;
  let d;
  if (typeof createdAt?.toDate === 'function') d = createdAt.toDate();
  else if (typeof createdAt === 'object' && typeof createdAt.seconds === 'number') d = new Date(createdAt.seconds * 1000);
  else d = new Date(createdAt);
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
}

export function formatDateAdded(createdAt, locale = undefined) {
  const d = recipeAddedDate(createdAt);
  if (!d) return '';
  return `Added ${d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
