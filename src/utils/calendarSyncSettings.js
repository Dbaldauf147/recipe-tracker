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

// Optional standing guest added to every synced event, stored alongside the
// per-kind timing as `guestEmail`. Empty string = nobody is invited, which is
// the default — this only ever emails someone once it's deliberately filled in.
// Deliberately one address: a shared "who am I training with" invite, not a
// distribution list.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidGuestEmail(s) {
  return EMAIL_RE.test(String(s || '').trim());
}
export function normalizeGuestEmail(s) {
  const v = String(s || '').trim().toLowerCase();
  return EMAIL_RE.test(v) ? v : '';
}

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
  // Not a kind — carried through so the per-kind loop above can stay keyed on
  // KIND_KEYS without dropping it on every save.
  out.guestEmail = normalizeGuestEmail(src.guestEmail);
  return out;
}

/**
 * Decide what to do about the standing guest on one already-existing Google
 * event. Returns { changed, attendees } — `attendees` is only meaningful when
 * `changed` is true, and is the full replacement list for a PATCH.
 *
 * Deliberately NOT a whole-list comparison. Google adds the organiser to
 * `attendees` as soon as an event has any, so "desired list === current list"
 * would mismatch on every run — and since the sync cron runs hourly with
 * sendUpdates=all, that would re-email the guest every hour. So this asks only
 * two questions: is the configured guest present, and is one we added earlier
 * still hanging around after the setting changed.
 *
 * `prevGuest` is the address recorded on the event when we last added it
 * (extendedProperties.private.prepDayGuest), which is what lets a change or a
 * clear remove exactly our own invitee and leave guests the user added by hand
 * in Google untouched.
 *
 * MIRRORED SERVER-SIDE in api/sync-workout-calendar.js — change both.
 */
export function resolveEventGuests(ev, guestEmail, prevGuest) {
  const want = normalizeGuestEmail(guestEmail);
  const prev = normalizeGuestEmail(prevGuest);
  const attendees = Array.isArray(ev?.attendees) ? ev.attendees : [];
  const emails = new Set(attendees.map(a => String(a?.email || '').trim().toLowerCase()));
  const missing = !!want && !emails.has(want);
  const stale = !!prev && prev !== want && emails.has(prev);
  if (!missing && !stale) return { changed: false, attendees: null };
  const kept = attendees
    .filter(a => !(stale && String(a?.email || '').trim().toLowerCase() === prev))
    // Preserve each remaining guest's RSVP — rebuilding as bare {email} would
    // reset everyone to "needsAction" and re-prompt them.
    .map(a => ({
      email: a.email,
      ...(a.responseStatus ? { responseStatus: a.responseStatus } : {}),
      ...(a.optional ? { optional: true } : {}),
    }));
  if (want && !kept.some(a => String(a.email || '').trim().toLowerCase() === want)) {
    kept.push({ email: want });
  }
  return { changed: true, attendees: kept };
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

// ---------------------------------------------------------------------------
// Churn control for the hourly sync (api/sync-workout-calendar.js).
//
// The plan is re-derived every hour and it moves: rankWorkoutTypesByStaleness
// reshuffles the week as you log, so days get retitled and re-categorized all
// day long. Events are keyed `${date}|${kind}` where kind is the workout's
// CATEGORY, which means a day flipping weights → cardio changes its key — and a
// changed key is a delete plus a create, not a rename. That costs an event id,
// and with a guest configured it costs a cancellation and a fresh invitation.
//
// The two functions below are what stop that. Both are pure so they can be
// tested here; both are MIRRORED SERVER-SIDE in api/sync-workout-calendar.js
// (the cron can't import from src/) — change both.
// ---------------------------------------------------------------------------

// A key is `${YYYY-MM-DD}|${kind}`. Dates are fixed-width, so the split is
// unambiguous even though nothing stops a kind from containing a '|'.
export function splitEventKey(key) {
  const str = String(key || '');
  const i = str.indexOf('|');
  if (i < 0) return { date: str, kind: '' };
  return { date: str.slice(0, i), kind: str.slice(i + 1) };
}

// Whether an event under this kind may be re-pointed at another workout
// category. Only workouts move between categories; a sauna must never quietly
// become a lift. ANY_WORKOUT is included because that's the tag events written
// before per-category timing carry, and re-keying those in place is exactly
// what stops them being deleted and recreated.
const isAdoptableKind = (kind) => isWorkoutKind(kind) || kind === ANY_WORKOUT;

/**
 * Reconcile the keys the plan wants against the keys already on the calendar,
 * for one user, in one run. Returns:
 *
 *   adopt — desiredKey → existingKey. A newly-planned workout taking over an
 *           existing same-day event that was otherwise headed for deletion, so
 *           a category flip is ONE patch instead of a delete plus a create.
 *   skip  — desired keys to leave entirely alone. Only ever on a pinned day
 *           (see `pinnedDate`), where an existing workout event already stands
 *           in for the newly-planned one. Without this the plan would find no
 *           exact match, create a second event, and — because a pinned day is
 *           never swept — leave the day holding both.
 *
 * A desired key with an exact match appears in neither: that's an ordinary
 * patch-or-leave. A desired key in neither AND unmatched is an ordinary create.
 *
 * MIRRORED SERVER-SIDE in api/sync-workout-calendar.js — change both.
 */
export function planEventReuse(desiredKeys, existingKeys, todayStr = '') {
  const desired = new Set(desiredKeys);
  const existing = new Set(existingKeys);

  // Unmatched existing workout events, grouped by day — the pool to reuse from.
  // Sorted so the pairing is deterministic run to run; an arbitrary order would
  // re-key a different event on each pass and reintroduce the churn.
  const poolByDate = new Map();
  for (const key of [...existing].sort()) {
    if (desired.has(key)) continue;
    const { date, kind } = splitEventKey(key);
    if (!isAdoptableKind(kind)) continue;
    if (!poolByDate.has(date)) poolByDate.set(date, []);
    poolByDate.get(date).push(key);
  }

  const adopt = new Map();
  const skip = new Set();
  for (const key of [...desired].sort()) {
    if (existing.has(key)) continue;
    const { date, kind } = splitEventKey(key);
    if (!isAdoptableKind(kind)) continue;
    const pool = poolByDate.get(date);
    if (!pool || !pool.length) continue;   // nothing to reuse → an ordinary create
    // A pinned day consumes the event to show it's already covered, but hands
    // back no mapping: nothing about it is rewritten.
    if (pinnedDate(date, todayStr)) { pool.shift(); skip.add(key); continue; }
    adopt.set(key, pool.shift());
  }
  return { adopt, skip };
}

/**
 * Whether a date's events are pinned — left as they already stand rather than
 * re-planned. Today is, for two reasons:
 *
 *  - resolveWorkoutPlan puts today in `autoSlots`, so an unlogged today is
 *    re-picked on every hourly run. A day that says "Push" at 9am and "Pull" at
 *    2pm is just wrong.
 *  - the moment you LOG today's workout, today lands in `recordedIdxs`, drops
 *    out of autoSlots, and so falls out of the desired set entirely — which
 *    used to delete the event for the workout you had just finished.
 *
 * Pinning covers identity only: an event on a pinned day is never retitled,
 * re-keyed or deleted, but a kind with no event at all is still created, and an
 * existing one is still re-timed when the timing settings change and still has
 * its guest list corrected.
 */
export function pinnedDate(date, todayStr) {
  return !!todayStr && date === todayStr;
}
