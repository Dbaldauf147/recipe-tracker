// The Not Started tab's "up next" queue: which not-started habit you pick up
// first, second, third…  ⚠️ MIRRORS PrepDay src/utils/habitStartQueue.ts —
// change both.
//
// Order:
//   1. the habit starred "Work on this next" (`nextUp: true`, set in the
//      phone's habit popup) — always #1 while it's still not started;
//   2. Wave 2 (`wave2: true`) — the batch you'll start after that one;
//   3. everything else ("Later").
// Within 2 and 3: by `startOrder` (a number, set by dragging), then anything
// never placed in `fallbackCompare` order (routine order on the screen).

const NOT_STARTED = ['not started', 'havent started', 'haven’t started', "haven't started"];

export function isNotStarted(h) {
  return NOT_STARTED.includes((h?.status || '').trim().toLowerCase());
}

function startOrderOf(h) {
  const n = parseFloat(h?.startOrder);
  return Number.isFinite(n) ? n : Infinity;
}

/** Is it in Wave 2 — the habits lined up to start after the next one? */
export function isWave2(h) {
  return !!h?.wave2 && !h?.nextUp;
}

// 0 = starred next, 1 = Wave 2, 2 = Later.
function groupOf(h) {
  return h.nextUp ? 0 : isWave2(h) ? 1 : 2;
}

/** Not-started habits in queue order — index 0 is #1. */
export function startQueue(habits, fallbackCompare = () => 0) {
  return (habits || [])
    .filter(isNotStarted)
    .map((h, i) => ({ h, i }))
    .sort((a, b) =>
      groupOf(a.h) - groupOf(b.h)
      || startOrderOf(a.h) - startOrderOf(b.h)
      || fallbackCompare(a.h, b.h)
      || a.i - b.i)
    .map(({ h }) => h);
}

/**
 * The queue's ids after a drag puts `dragId` where `targetId` was. The starred
 * habit stays pinned at #1: it can't be dragged, and a drop above it lands
 * just below it instead. A drop into another group snaps back to its own. Returns null when nothing changes.
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
 * with the starred habit put back at #1 and each group kept together — a drag
 * reorders within Next / Wave 2 / Later; "+ Wave 2" moves between them. Returns null when that leaves the
 * order unchanged.
 */
export function pinStarred(queue, orderedIds) {
  const byId = new Map(queue.map(h => [h.id, h]));
  const rank = id => { const h = byId.get(id); return h ? groupOf(h) : 2; };
  const ids = orderedIds.map((id, i) => ({ id, i })).sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i).map(x => x.id);
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

/**
 * The queue's ids with `id` moved to #1 — the "Make next" button. The caller
 * also moves the star (`nextUp`) to it, so it stays #1; whatever was #1
 * before slides to #2. Returns null when it's already #1 or not in the queue.
 */
export function moveToNext(queue, id) {
  const ids = queue.map(h => h.id);
  const from = ids.indexOf(id);
  if (from <= 0) return null;
  ids.splice(from, 1);
  return [id, ...ids];
}

/**
 * The "+ Wave 2" / "Remove from Wave 2" toggle: the queue's ids with `id` at
 * the seam between Wave 2 and Later — the end of Wave 2 when it's added, the
 * top of Later when it's taken out (the same spot). The caller flips `wave2`
 * and renumbers `startOrder` from these ids. Null when not in the
 * queue, or when it's the starred next habit (that one is already first).
 */
export function wave2Seam(queue, id) {
  const h = queue.find(x => x.id === id);
  if (!h || h.nextUp) return null;
  const rest = queue.filter(x => x.id !== id);
  const starred = rest.filter(x => x.nextUp).map(x => x.id);
  const wave = rest.filter(isWave2).map(x => x.id);
  const later = rest.filter(x => !x.nextUp && !isWave2(x)).map(x => x.id);
  return [...starred, ...wave, id, ...later];
}
