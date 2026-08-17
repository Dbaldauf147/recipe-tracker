/**
 * Pure row arithmetic for the shared exercise library.
 *
 * Split out from sharedExerciseLibrary.js, which imports Firebase and so can't
 * be loaded by `node --test`. Everything here is a plain function over arrays —
 * and it is the part worth testing, because it decides what a user's edit does
 * to a list that every other account is editing at the same time.
 */

/** Case-insensitive, trimmed identity for an exercise. The library is keyed by
 *  NAME — there are no ids, because the rows never had any and both apps (and
 *  every logged workout entry) already reference exercises by name. */
export function exerciseKey(name) {
  return String(name || '').trim().toLowerCase();
}

/** Coerce whatever is in the document to a clean, name-deduped row list. */
export function normalizeSharedRows(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const name = String(row.exercise || '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...row, exercise: name });
  }
  return out;
}

/**
 * What changed between two versions of the list, keyed by name.
 *
 * The Exercises tab edits by handing back a whole new array, but writing that
 * array wholesale would clobber anything another account added or edited since
 * this browser last heard from the document. So we work out the user's actual
 * INTENT here and replay just that onto whatever the server currently holds.
 */
export function diffExerciseRows(prev, next) {
  const prevRows = normalizeSharedRows(prev);
  const nextRows = normalizeSharedRows(next);
  const prevByKey = new Map(prevRows.map(r => [exerciseKey(r.exercise), r]));
  const nextByKey = new Map(nextRows.map(r => [exerciseKey(r.exercise), r]));

  const added = [];
  const changed = [];
  for (const row of nextRows) {
    const key = exerciseKey(row.exercise);
    const before = prevByKey.get(key);
    if (!before) added.push(row);
    else if (JSON.stringify(before) !== JSON.stringify(row)) changed.push(row);
  }
  const removed = prevRows
    .map(r => exerciseKey(r.exercise))
    .filter(key => !nextByKey.has(key));

  return { added, changed, removed };
}

export function isEmptyDiff(diff) {
  return diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0;
}

/**
 * Replay a diff onto the rows the server actually holds right now.
 *
 * Anything on the server we've never seen — an exercise another account added
 * while this page was open — is left completely alone. That is the whole reason
 * writes go through a diff instead of an array replace.
 */
export function replayDiff(serverRows, diff) {
  const rows = normalizeSharedRows(serverRows);
  const removed = new Set(diff.removed);
  const changed = new Map(diff.changed.map(r => [exerciseKey(r.exercise), r]));

  // Kept rows, with edits applied in place so the list doesn't reshuffle under
  // anyone. A row we edited that is no longer on the server was deleted by
  // somebody else while we were typing; deletes here are global and confirmed,
  // so the delete wins over our edit rather than resurrecting the exercise.
  const out = [];
  for (const row of rows) {
    const key = exerciseKey(row.exercise);
    if (removed.has(key)) continue;
    out.push(changed.get(key) || row);
  }

  // New rows go to the front, matching where "+ Add exercise" puts them. One
  // that somebody else already added under the same name is dropped rather than
  // overwriting theirs — the pickers key on the name, so a second row would
  // just render as a duplicate line.
  const have = new Set(out.map(r => exerciseKey(r.exercise)));
  const fresh = diff.added.filter(r => !have.has(exerciseKey(r.exercise)));
  return [...fresh, ...out];
}

/**
 * The list the page works from: the shared library every account reads and
 * writes, plus any row that still only exists in this account's own legacy
 * `exerciseLibrary` field. Shared wins on a name collision — it is the copy
 * everyone else is looking at.
 *
 * The personal half is a safety net, and it is why moving to the shared
 * document is survivable even if its Firestore rule hasn't been deployed: an
 * account that had exercises before the library was shared keeps seeing all of
 * them either way. It comes out once the shared document is confirmed
 * populated — see PrepDay's docs/shared-exercise-library.md.
 *
 * Identical to mergeExerciseLibraries in the mobile app's workout screen.
 */
export function mergeExerciseLibraries(shared, personal) {
  const sharedRows = Array.isArray(shared) ? shared : [];
  const personalRows = Array.isArray(personal) ? personal : [];
  const seen = new Set(sharedRows.map(r => exerciseKey(r?.exercise)));
  const extras = personalRows.filter(r => {
    const key = exerciseKey(r?.exercise);
    return key && !seen.has(key);
  });
  return extras.length > 0 ? [...sharedRows, ...extras] : sharedRows;
}
