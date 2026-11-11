// ⚠️ Mirrored with PrepDay/src/utils/habitCues.ts — change both.
//
// A habit's cues ("I see my running shoes", "After coffee", ...) — as many as
// you like, edited in the habit popup (same list as the phone's).
//
// Data model on the shared user-doc habit:
//   habit.cues : string[]   every cue, in display order (the source of truth)
//   habit.cue  : string     cues[0] — mirrored so the Habits table / paste
//   habit.cue2 : string     cues[1]   import, which know the two single
//                                     columns, still show and edit them
//
// If `cue` / `cue2` no longer match the head of `cues`, they were edited since
// the list was last written (table cell, paste import, an older client): those
// two win, and any extra cues past the second are kept after them.

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

/** The habit's cues, trimmed, blanks dropped (always an array). */
export function cuesOf(habit) {
  if (!habit) return [];
  const c1 = clean(habit.cue), c2 = clean(habit.cue2);
  const list = Array.isArray(habit.cues) ? habit.cues.map(clean).filter(Boolean) : null;
  if (list && list.length) {
    if ((list[0] || '') === c1 && (list[1] || '') === c2) return list;
    return [c1, c2, ...list.slice(2)].filter(Boolean);
  }
  return [c1, c2].filter(Boolean);
}

/** The fields to write for a new cue list: `cues` plus the mirrored `cue` / `cue2`. */
export function cueFields(cues) {
  const list = (cues || []).map(clean).filter(Boolean);
  return { cues: list, cue: list[0] || '', cue2: list[1] || '' };
}
