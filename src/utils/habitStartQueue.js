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
 * The queue's ids after moving `id` one place up (dir -1) or down (+1). The
 * starred habit stays pinned at #1, so nothing moves above it and it doesn't
 * move itself. Returns null when the move isn't possible.
 */
export function moveInQueue(queue, id, dir) {
  const ids = queue.map(h => h.id);
  const from = ids.indexOf(id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  if (queue[from].nextUp || queue[to].nextUp) return null;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}

/** Does it lack what it needs to show up in the routines once started? */
export function missingSetup(h) {
  const routine = (h?.routine || '').trim();
  return {
    cadence: !(h?.cadence || '').trim(),
    routine: !routine || routine === '-',
  };
}
