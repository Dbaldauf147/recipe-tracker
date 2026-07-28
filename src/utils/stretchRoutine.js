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
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

export function emptyRoutine(name = '') {
  return {
    id: newId(),
    name,
    steps: [],
    holdSec: DEFAULT_HOLD_SEC,
    transitionSec: DEFAULT_TRANSITION_SEC,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Flatten a routine into the exact cue sequence the player walks.
 *
 * A transition is emitted BEFORE each pose except the first: pressing play puts
 * you straight into pose one (no dead 20 seconds staring at the screen), and
 * the routine ends on a hold rather than a transition into nothing.
 */
export function buildCueSequence(routine) {
  const out = [];
  (routine?.steps || []).forEach((step, i) => {
    if (i > 0 && routine.transitionSec > 0) {
      out.push({ kind: 'transition', seconds: routine.transitionSec, stepName: step.name, stepIndex: i });
    }
    out.push({
      kind: 'hold',
      seconds: clampSec(step.holdSec ?? routine.holdSec, DEFAULT_HOLD_SEC),
      stepName: step.name,
      stepIndex: i,
    });
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
