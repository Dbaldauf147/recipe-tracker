// What a plain CLICK on a habit cell does: walk the marks in order, then wrap
// back to empty. Pressing and HOLDING opens the full menu instead (see
// HoldButton in HabitsPage.jsx).
//
// Deliberately NOT MARK_ORDER, which is best→worst for display. The first click
// should land on the answer given most often — "Did it", not "Above & Beyond".
//
// Wrapping to empty at the end is the important part: it means a mis-click is
// always a few more clicks away from undone, never trapped in the cycle with no
// way back to a blank cell.

export const CYCLE_ORDER = ['done', 'exceeded', 'skipped', 'missed'];

/**
 * The mark a cell should take when clicked.
 * @param {string|null|undefined} current the mark stored on the cell now
 * @returns {string|null} the next mark, or null to erase
 */
export function nextMarkInCycle(current) {
  const i = CYCLE_ORDER.indexOf(current || '');
  if (i === -1) return CYCLE_ORDER[0];           // empty (or unknown) → start
  if (i === CYCLE_ORDER.length - 1) return null; // past the end → back to empty
  return CYCLE_ORDER[i + 1];
}
