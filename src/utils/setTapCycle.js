// One click on a set cell steps it through three states:
//   blank → yellow (started) → green (done) → blank.
// ⚠️ The mobile app has the same rule in src/utils/setTapCycle.ts.
//
// Only green is `setDone` — what is logged, what counts toward PRs and
// progress. Yellow (`setStarted`) is "on this set now": shown while logging,
// never saved with the workout.

export function setTapState(started, done) {
  if (done) return 'done';
  if (started) return 'started';
  return 'blank';
}

export function nextSetTapState(state) {
  if (state === 'blank') return 'started';
  if (state === 'started') return 'done';
  return 'blank';
}

// The entry with set `setIdx` stepped to its next state.
export function cycleEntrySet(entry, setIdx) {
  const n = Math.max(4, (entry.sets || []).length, setIdx + 1);
  const pad = arr => {
    const out = Array.isArray(arr) ? [...arr] : [];
    while (out.length < n) out.push(false);
    return out;
  };
  const setDone = pad(entry.setDone);
  const setStarted = pad(entry.setStarted);
  const next = nextSetTapState(setTapState(!!setStarted[setIdx], !!setDone[setIdx]));
  setDone[setIdx] = next === 'done';
  setStarted[setIdx] = next === 'started';
  return { ...entry, setDone, setStarted };
}
