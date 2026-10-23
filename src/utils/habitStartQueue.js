// The Not Started tab's "up next" queue: which not-started habit you pick up
// first, second, third…  ⚠️ MIRRORS PrepDay src/utils/habitStartQueue.ts —
// change both.
//
// Order:
//   1. the habit starred "Work on this next" (`nextUp: true`, set in the
//      phone's habit popup) — always #1 while it's still not started;
//   2. habits you've placed with ↑/↓, by `startOrder` (a number);
//   3. everything never placed, in `fallbackCompare` order (routine order on
//      the page), so the queue starts out matching the old grouped list.

const NOT_STARTED = ['not started', 'havent started', 'haven’t started', "haven't started"];

export function isNotStarted(h) {
  return NOT_STARTED.includes((h?.status || '').trim().toLowerCase());
}

function startOrderOf(h) {
  const n = parseFloat(h?.startOrder);
  return Number.isFinite(n) ? n : Infinity;
}

/** Not-started habits in queue order — index 0 is #1. */
export function startQueue(habits, fallbackCompare = () => 0) {
  return (habits || [])
    .filter(isNotStarted)
    .map((h, i) => ({ h, i }))
    .sort((a, b) =>
      (b.h.nextUp ? 1 : 0) - (a.h.nextUp ? 1 : 0)
      || startOrderOf(a.h) - startOrderOf(b.h)
      || fallbackCompare(a.h, b.h)
      || a.i - b.i)
    .map(({ h }) => h);
}

/**
 * The queue's ids after a drag puts `dragId` where `targetId` was. The starred
 * habit stays pinned at #1: it can't be dragged, and a drop above it lands
 * just below it instead. Returns null when nothing changes.
 */
export function dropInQueue(queue, dragId, targetId) {
  const ids = queue.map(h => h.id);
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to || queue[from].nextUp) return null;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  return pinStarred(queue, ids);
}

/**
 * `orderedIds` (a new order for the queue, e.g. straight from a drag list)
 * with the starred habit put back at #1. Returns null when that leaves the
 * order unchanged.
 */
export function pinStarred(queue, orderedIds) {
  const starred = queue.find(h => h.nextUp)?.id;
  const ids = starred ? [starred, ...orderedIds.filter(id => id !== starred)] : [...orderedIds];
  return ids.every((id, i) => id === queue[i]?.id) ? null : ids;
}

/** Does it lack what it needs to show up in the routines once started? */
export function missingSetup(h) {
  const routine = (h?.routine || '').trim();
  return {
    cadence: !(h?.cadence || '').trim(),
    routine: !routine || routine === '-',
  };
}
