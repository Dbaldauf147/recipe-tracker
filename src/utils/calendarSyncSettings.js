// Per-kind scheduling for the Week Plan's "Auto-sync to Google Calendar" toggle.
//
// Each synced kind has a start that is either a fixed clock time or chained to
// the END of another kind on the same day, plus a length in minutes. Stored on
// the user doc as `calendarSyncSettings`.
//
// Workouts are keyed by CATEGORY (weights / cardio / yoga) so an early-morning
// cardio and an evening lift can have their own times. A workout type maps to a
// category via `workoutTypeCategories`, and the plan gives at most one workout
// per day — so at most one of the three is ever present on a given day.
//
// MIRRORED SERVER-SIDE in api/sync-workout-calendar.js (the cron can't import
// from src/ — same porting convention as resolveWorkoutPlan). Change both.

// The workout categories, in the order they appear in the settings UI.
export const WORKOUT_KINDS = ['weights', 'cardio', 'yoga'];

// Virtual anchor: "whichever workout is on that day". Sauna rides along with
// whatever you're doing, so chaining it to one category would strand it on the
// others. Deliberately the string 'workout' — that's what the pre-category
// sauna default already stored, so old docs migrate for free.
export const ANY_WORKOUT = 'workout';

export const SYNC_KINDS = [
  { key: 'weights', icon: '🏋️', label: 'Weights' },
  { key: 'cardio', icon: '🏃', label: 'Cardio' },
  { key: 'yoga', icon: '🧘', label: 'Yoga' },
  { key: 'sauna', icon: '🧖', label: 'Sauna' },
  { key: 'cooking', icon: '🍳', label: 'Cooking' },
];

const KIND_KEYS = SYNC_KINDS.map(k => k.key);
const isWorkoutKind = (k) => WORKOUT_KINDS.includes(k);

// Defaults keep the old single-workout behavior (6 PM, 1h15m) for all three
// categories, so nothing moves until you actually customize a row.
export const DEFAULT_CALENDAR_SYNC_SETTINGS = {
  weights: { startMode: 'time', time: '18:00', after: '', durationMin: 75 },
  cardio: { startMode: 'time', time: '18:00', after: '', durationMin: 75 },
  yoga: { startMode: 'time', time: '18:00', after: '', durationMin: 75 },
  sauna: { startMode: 'after', time: '19:15', after: ANY_WORKOUT, durationMin: 30 },
  cooking: { startMode: 'time', time: '17:00', after: '', durationMin: 45 },
};

const MAX_MIN = 24 * 60 - 1; // 23:59 — events never roll past midnight

export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return 0;
  return clamp(+m[1] * 60 + +m[2], 0, MAX_MIN);
}
export function minToHHMM(min) {
  const v = clamp(Math.round(min), 0, MAX_MIN);
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

// What a given kind is allowed to start after. Only one workout happens per day,
// so a workout chained to another category would never resolve — workouts can
// only follow the non-workout kinds. Everything else may also use ANY_WORKOUT.
export function anchorOptionsFor(key) {
  if (isWorkoutKind(key)) return KIND_KEYS.filter(k => !isWorkoutKind(k) && k !== key);
  return [ANY_WORKOUT, ...KIND_KEYS.filter(k => k !== key)];
}

// Coerce whatever is on the user doc into a complete, valid settings object.
export function normalizeCalendarSyncSettings(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  // Pre-category docs had ONE `workout` entry covering every category. Seed all
  // three from it so times the user already set survive the split.
  const legacy = (src.workout && typeof src.workout === 'object') ? src.workout : null;
  const out = {};
  for (const key of KIND_KEYS) {
    const d = DEFAULT_CALENDAR_SYNC_SETTINGS[key];
    let v = (src[key] && typeof src[key] === 'object') ? src[key] : {};
    if (legacy && isWorkoutKind(key) && !src[key]) v = legacy;
    const allowed = anchorOptionsFor(key);
    const after = allowed.includes(v.after) ? v.after : d.after;
    out[key] = {
      startMode: v.startMode === 'after' && after ? 'after' : 'time',
      time: /^\d{1,2}:\d{2}$/.test(v.time) ? minToHHMM(parseHHMM(v.time)) : d.time,
      after,
      durationMin: clamp(Math.round(Number(v.durationMin) || d.durationMin), 5, 12 * 60),
    };
  }
  return out;
}

// Which kind an anchor actually points at on a day, or null if it isn't there.
function resolveAnchor(after, present) {
  if (after === ANY_WORKOUT) return WORKOUT_KINDS.find(k => present.has(k)) || null;
  return present.has(after) ? after : null;
}

// Resolve start/end minutes for the kinds actually happening on one day.
// A kind chained to an absent anchor (e.g. sauna "after workout" on a rest day)
// falls back to its own clock time rather than vanishing. Reference cycles fall
// back the same way, so this always terminates.
export function resolveDayTimes(settings, presentKinds) {
  const s = normalizeCalendarSyncSettings(settings);
  const present = new Set(presentKinds);
  const out = {};
  const resolving = new Set();

  function place(kind) {
    if (out[kind]) return out[kind];
    const cfg = s[kind];
    if (resolving.has(kind)) return { startMin: parseHHMM(cfg.time), endMin: parseHHMM(cfg.time) + cfg.durationMin };
    resolving.add(kind);
    let startMin = parseHHMM(cfg.time);
    if (cfg.startMode === 'after' && cfg.after) {
      const anchor = resolveAnchor(cfg.after, present);
      if (anchor) startMin = place(anchor).endMin;
    }
    resolving.delete(kind);
    startMin = clamp(startMin, 0, MAX_MIN - 5);
    out[kind] = { startMin, endMin: clamp(startMin + cfg.durationMin, startMin + 5, MAX_MIN) };
    return out[kind];
  }

  for (const kind of KIND_KEYS) if (present.has(kind)) place(kind);
  return out;
}

// Kinds ordered as they'd occur on a day with `workoutKind` + sauna + cooking —
// used for the settings popup's preview lines (one per workout category, since
// the three can now be timed differently).
export function previewOrder(settings, workoutKind = 'weights') {
  const kinds = [workoutKind, 'sauna', 'cooking'];
  const times = resolveDayTimes(settings, kinds);
  return kinds
    .map(key => ({ key, ...times[key] }))
    .sort((a, b) => a.startMin - b.startMin || kinds.indexOf(a.key) - kinds.indexOf(b.key));
}
