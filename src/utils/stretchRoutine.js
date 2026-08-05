// Guided stretch routines — shape and timing.
//
// MIRRORED from the mobile app's src/utils/stretchRoutine.ts. Both read and
// write the same user-doc field (`stretchRoutines`), so a routine built on
// either side plays on the other. Change both.
//
// Kept free of React/DOM so it can be unit-tested directly — the cue sequence
// is the heart of the feature and the thing you notice immediately if it's off.

export const DEFAULT_HOLD_SEC = 40;
export const DEFAULT_TRANSITION_SEC = 20;
// Swapping legs is not the same job as walking to a new pose, so a two-sided
// pose gets its own, shorter gap rather than the full transition.
export const DEFAULT_SWITCH_SEC = 10;
export const MIN_SEC = 5;
export const MAX_SEC = 600;

let _idCounter = 0;
export function newId() {
  _idCounter = (_idCounter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

export function clampSec(n, fallback) {
  const v = Math.round(Number(n));
  if (!isFinite(v) || v <= 0) return fallback;
  return Math.min(MAX_SEC, Math.max(MIN_SEC, v));
}

/** Coerce anything off the wire into a usable routine, or null if it's junk. */
export function normalizeRoutine(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .map(s => {
      const stepName = String(s?.name || '').trim();
      if (!stepName) return null;
      const step = { id: String(s?.id || newId()), name: stepName };
      // Only carry an override when there actually is one — otherwise every
      // step would pin itself to whatever the routine default was at save time.
      if (s?.holdSec != null) step.holdSec = clampSec(s.holdSec, DEFAULT_HOLD_SEC);
      // A pose done left AND right. `holdSec` times the first (left) side and
      // `holdSecRight` the second, so the tighter side can get longer. Both are
      // absent unless set, same rule as above.
      if (s?.bothSides) {
        step.bothSides = true;
        if (s?.holdSecRight != null) step.holdSecRight = clampSec(s.holdSecRight, DEFAULT_HOLD_SEC);
      }
      return step;
    })
    .filter(Boolean);
  if (!name && steps.length === 0) return null;
  return {
    id: String(raw.id || newId()),
    name: name || 'Untitled routine',
    steps,
    holdSec: clampSec(raw.holdSec, DEFAULT_HOLD_SEC),
    transitionSec: clampSec(raw.transitionSec, DEFAULT_TRANSITION_SEC),
    // The gap between the two sides of a both-sides pose. Its own number
    // because switching legs is quicker than moving to a new pose.
    switchSec: clampSec(raw.switchSec, DEFAULT_SWITCH_SEC),
    // Which workout this routine files itself under when logged. '' → the
    // caller's fallback (Yoga), which is what every routine did before the
    // field existed. Carried through here rather than defaulted so a routine
    // saved on the other app doesn't lose the choice on the next round-trip.
    workoutType: String(raw.workoutType || '').trim(),
    // Habit marked done on completion. '' → none. See onLogRoutine.
    habitId: String(raw.habitId || '').trim(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

/** `source` stamped on a workout the stretch player wrote. */
export const STRETCH_WORKOUT_SOURCE = 'stretch';

/**
 * Was this workout written by the stretch player rather than logged by hand?
 *
 * The day's log editor uses this to leave stretch sessions alone: a finished
 * routine belongs in History, not spread across the rows you're still filling
 * in. It also keeps the editor from treating one as "the workout for this
 * date" — saving would then reuse its id and overwrite the poses, or drop the
 * workout from the list entirely.
 *
 * `routineNames` is a Set of lowercased routine names, for workouts logged
 * before the tag existed: the player writes the routine name into every
 * entry's `notes`, so a workout whose every entry names a routine you still
 * have is one of ours. Pass an empty Set to match on the tag alone.
 */
export function isStretchWorkout(w, routineNames) {
  if (!w) return false;
  if (w.source === STRETCH_WORKOUT_SOURCE) return true;
  const entries = Array.isArray(w.entries) ? w.entries : [];
  if (entries.length === 0 || !routineNames || routineNames.size === 0) return false;
  return entries.every(e => routineNames.has(String(e?.notes || '').trim().toLowerCase()));
}

export function emptyRoutine(name = '') {
  return {
    id: newId(),
    name,
    steps: [],
    holdSec: DEFAULT_HOLD_SEC,
    transitionSec: DEFAULT_TRANSITION_SEC,
    switchSec: DEFAULT_SWITCH_SEC,
    workoutType: '',
    habitId: '',
    updatedAt: new Date().toISOString(),
  };
}

/** Human label for a cue's side, for the screen and the spoken cue. */
export function sideLabel(side) {
  return side === 'left' ? 'Left' : side === 'right' ? 'Right' : '';
}

/**
 * Flatten a routine into the exact cue sequence the player walks.
 *
 * A transition is emitted BEFORE each pose except the first: pressing play puts
 * you straight into pose one (no dead 20 seconds staring at the screen), and
 * the routine ends on a hold rather than a transition into nothing.
 *
 * A both-sides pose becomes TWO holds around a short `switch` cue, and keeps
 * one `stepIndex` throughout: it's one pose you do twice, so the player's
 * "3 / 8" counter and up-next list shouldn't split it in two. `stepName` stays
 * the bare pose name on every cue — the side rides along in `side`, which keeps
 * both holds logging to a single exercise instead of "Pigeon (left)" and
 * "Pigeon (right)" landing as two unrelated entries in History.
 */
export function buildCueSequence(routine) {
  const out = [];
  (routine?.steps || []).forEach((step, i) => {
    const both = !!step.bothSides;
    const firstSide = both ? 'left' : '';
    if (i > 0 && routine.transitionSec > 0) {
      out.push({
        kind: 'transition', seconds: routine.transitionSec,
        stepName: step.name, stepIndex: i, side: firstSide,
      });
    }
    const leftSec = clampSec(step.holdSec ?? routine.holdSec, DEFAULT_HOLD_SEC);
    out.push({ kind: 'hold', seconds: leftSec, stepName: step.name, stepIndex: i, side: firstSide });
    if (!both) return;
    // Falls back to the left side's time, not the routine default: a pose you
    // pinned to 60s should give you 60s on both sides unless you say otherwise.
    const rightSec = clampSec(step.holdSecRight ?? step.holdSec ?? routine.holdSec, DEFAULT_HOLD_SEC);
    const switchSec = routine.switchSec ?? DEFAULT_SWITCH_SEC;
    if (switchSec > 0) {
      out.push({ kind: 'switch', seconds: switchSec, stepName: step.name, stepIndex: i, side: 'right' });
    }
    out.push({ kind: 'hold', seconds: rightSec, stepName: step.name, stepIndex: i, side: 'right' });
  });
  return out;
}

/** Total wall-clock length of a routine in seconds. */
export function routineDurationSec(routine) {
  return buildCueSequence(routine).reduce((n, c) => n + c.seconds, 0);
}

/** "M:SS" for a duration in seconds. */
export function mmss(total) {
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
