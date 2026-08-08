// Which calendar bucket a logged workout falls into: yoga, cardio, or weights
// (the default for anything else). Rest isn't decided here — it's derived from
// days with NO workout, by whoever is counting days.
//
// Extracted from WorkoutPage.jsx so the weekly-summary email can classify a
// workout the same way the Workout calendar and the Week Plan goal tiles do.
// The API runs in Node and can't import a React component file, and a second
// copy of these regexes would drift — which shows up as a goal that reads met
// in the email and missed on the page. WorkoutPage re-exports this.

const CAL_YOGA_RE = /yoga|vinyasa|pilates|mobility|stretch/i;
const CAL_CARDIO_RE = /cardio|running|\brun\b|jog|cycl|spin|\bbike\b|biking|swim|hiit|elliptical|treadmill|stair|sprint|conditioning|walk|hike/i;

export const CAL_ICON = { weights: '🏋️', cardio: '🏃', yoga: '🧘', rest: '😴' };

export function workoutCalendarCategory(w, categories) {
  const t = w?.workoutType || '';
  // Explicit, user-chosen category wins. Falls back to keyword guessing for
  // types tagged before categories existed (or imported from elsewhere).
  const explicit = categories?.[t];
  if (explicit === 'weights' || explicit === 'cardio' || explicit === 'yoga') return explicit;
  if (CAL_YOGA_RE.test(t)) return 'yoga';
  if (CAL_CARDIO_RE.test(t)) return 'cardio';
  return 'weights';
}
