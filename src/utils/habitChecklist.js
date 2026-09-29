// Per-habit checklist — a list of items to tick off each period (e.g. every
// room on a "Deep Clean"). Ticking the last item marks the habit done for the
// period; un-ticking one takes a 'done' back off.
//
// ⚠️ Mirrored with PrepDay/src/utils/habitChecklist.ts — change both.
//
// Stored on the habit itself (the `habits` user-doc field):
//   checklist:     Array<{ id, text }>            — items, in display order
//   checklistDone: { period, ids: string[] }      — what's ticked for ONE period
// `period` is the period key the page reads/writes the habit's mark under for
// the current period. When it isn't the current key nothing is ticked — the
// list resets each period on its own, with no cleanup write. Ids no longer in
// `checklist` are ignored.
//
// Pure: no React, no Firebase.

/** The habit's items, dropping anything malformed. */
export function checklistItems(habit) {
  const list = habit?.checklist;
  if (!Array.isArray(list)) return [];
  return list.filter(it => it && typeof it.id === 'string' && it.id && typeof it.text === 'string');
}

/** True when the habit has at least one checklist item. */
export function hasChecklist(habit) {
  return checklistItems(habit).length > 0;
}

/** Ids ticked for `periodKey`, restricted to items still on the list, in list order. */
export function tickedIds(habit, periodKey) {
  const done = habit?.checklistDone;
  if (!done || done.period !== periodKey || !Array.isArray(done.ids)) return [];
  const set = new Set(done.ids);
  return checklistItems(habit).filter(it => set.has(it.id)).map(it => it.id);
}

/** { done, total } for `periodKey`. */
export function checklistProgress(habit, periodKey) {
  return { done: tickedIds(habit, periodKey).length, total: checklistItems(habit).length };
}

/** A non-empty checklist with every current item ticked for `periodKey`. */
export function isComplete(habit, periodKey) {
  const { done, total } = checklistProgress(habit, periodKey);
  return total > 0 && done === total;
}

/** The new `checklistDone` after ticking / un-ticking `itemId` in `periodKey`. */
export function toggleItem(habit, itemId, periodKey) {
  const ids = tickedIds(habit, periodKey);
  const next = ids.includes(itemId)
    ? ids.filter(id => id !== itemId)
    : (checklistItems(habit).some(it => it.id === itemId) ? [...ids, itemId] : ids);
  return { period: periodKey, ids: next };
}

function randomId() {
  return 'ci-' + Math.random().toString(36).slice(2, 10);
}

/** A new item, or null for blank text. */
export function newChecklistItem(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  return { id: randomId(), text: t };
}

/** The new `checklist` with `text` appended (unchanged when blank). */
export function addItem(habit, text) {
  const items = checklistItems(habit);
  const item = newChecklistItem(text);
  return item ? [...items, item] : items;
}

/** The new `checklist` with one item's text replaced. */
export function renameItem(habit, itemId, text) {
  return checklistItems(habit).map(it => (it.id === itemId ? { ...it, text: String(text ?? '') } : it));
}

/**
 * Patch for removing an item: the new `checklist`, plus `checklistDone` pruned
 * of it when the stored period is the current one (so the tick doesn't linger).
 */
export function removeItem(habit, itemId, periodKey) {
  const checklist = checklistItems(habit).filter(it => it.id !== itemId);
  const patch = { checklist };
  const done = habit?.checklistDone;
  if (done && done.period === periodKey && Array.isArray(done.ids)) {
    patch.checklistDone = { period: periodKey, ids: done.ids.filter(id => id !== itemId && checklist.some(it => it.id === id)) };
  }
  return patch;
}

/**
 * What a checklist change should do to the period's mark, given the habit
 * AFTER the change and the cell's current mark.
 *   change: 'tick' | 'untick' | 'remove' | 'add' | 'rename'
 * Returns 'done' (set Did it), 'clear' (erase the mark) or null (leave it).
 * Bad habits are never touched — their 'done' means a slip.
 */
export function markActionAfter(habitAfter, periodKey, currentMark, change) {
  // Same test as habitOutstanding.isBadHabit (kept inline so this stays standalone).
  if ((habitAfter?.habitType || '').trim().toLowerCase() === 'bad') return null;
  if (change === 'untick') return currentMark === 'done' ? 'clear' : null;
  if (change === 'tick' || change === 'remove') {
    if (!isComplete(habitAfter, periodKey)) return null;
    return currentMark === 'done' || currentMark === 'exceeded' ? null : 'done';
  }
  return null;
}
