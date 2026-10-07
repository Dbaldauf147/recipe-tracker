// Per-set pain: "this set hurt, and here's where". Ticked from the set popup
// on the workout log (mobile double-tap / the website's ! button) and stored
// on the entry as a sparse list, so a session with no pain carries nothing.
//
// A set that's both done and painful renders reddish-green (SET_PAIN_DONE_*)
// instead of plain green; a painful set that isn't done just gets the red
// border. Separate from the per-exercise `pain` log (PainEntry), which rates
// severity 1-5 for the whole lift.
//
// Mirrors the mobile app's src/utils/setPain.ts -- keep the two in step.

// One mark: { set, note? } -- `set` is the 0-based index matching `sets` /
// `setDone`, `note` is where it hurt, e.g. "left shoulder".

/** Done + pain: a red-tinged green (olive), with a red border. */
export const SET_PAIN_DONE_BG = '#6f6a2c';
export const SET_PAIN_BORDER = '#dc2626';

/** This set's pain mark, or null when it didn't hurt. */
export function setPainFor(entry, set) {
  return (entry.setPain || []).find(p => p.set === set) || null;
}

/**
 * The entry with set `set` marked painful (`pain` = { note }) or cleared
 * (`pain` = null). The list stays sorted by set and drops to undefined when
 * empty, so "no pain" is stored as absence.
 */
export function withSetPain(entry, set, pain) {
  const rest = (entry.setPain || []).filter(p => p.set !== set);
  if (pain) {
    const note = (pain.note || '').trim();
    rest.push(note ? { set, note } : { set });
    rest.sort((a, b) => a.set - b.set);
  }
  const next = { ...entry };
  if (rest.length) next.setPain = rest;
  else delete next.setPain;
  return next;
}
