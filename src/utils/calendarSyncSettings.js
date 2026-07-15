// Per-kind scheduling for the Week Plan's "Auto-sync to Google Calendar" toggle.
//
// Each synced kind (workout / sauna / cooking) has a start that is either a
// fixed clock time or chained to the END of another kind on the same day, plus
// a length in minutes. Stored on the user doc as `calendarSyncSettings`.
//
// MIRRORED SERVER-SIDE in api/sync-workout-calendar.js (the cron can't import
// from src/ — same porting convention as resolveWorkoutPlan). Change both.

export const SYNC_KINDS = [
  { key: 'workout', icon: '🏋️', label: 'Workout' },
  { key: 'sauna', icon: '🧖', label: 'Sauna' },
  { key: 'cooking', icon: '🍳', label: 'Cooking' },
];

const KIND_KEYS = SYNC_KINDS.map(k => k.key);

// Defaults keep today's behavior for workouts (6 PM, 1h15m) and place sauna
// straight after the workout. Cooking sits at its own dinner-prep time.
export const DEFAULT_CALENDAR_SYNC_SETTINGS = {
  workout: { startMode: 'time', time: '18:00', after: '', durationMin: 75 },
  sauna: { startMode: 'after', time: '19:15', after: 'workout', durationMin: 30 },
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

// Coerce whatever is on the user doc into a complete, valid settings object.
export function normalizeCalendarSyncSettings(raw) {
  const out = {};
  for (const key of KIND_KEYS) {
    const d = DEFAULT_CALENDAR_SYNC_SETTINGS[key];
    const v = (raw && typeof raw === 'object' && raw[key] && typeof raw[key] === 'object') ? raw[key] : {};
    const after = KIND_KEYS.includes(v.after) && v.after !== key ? v.after : d.after;
    out[key] = {
      startMode: v.startMode === 'after' && after ? 'after' : 'time',
      time: /^\d{1,2}:\d{2}$/.test(v.time) ? minToHHMM(parseHHMM(v.time)) : d.time,
      after,
      durationMin: clamp(Math.round(Number(v.durationMin) || d.durationMin), 5, 12 * 60),
    };
  }
  return out;
}

// Resolve start/end minutes for the kinds actually happening on one day.
// A kind chained to an absent anchor (e.g. cooking "after workout" on a rest
// day) falls back to its own clock time rather than vanishing. Reference cycles
// fall back the same way, so this always terminates.
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
    if (cfg.startMode === 'after' && cfg.after && present.has(cfg.after)) {
      startMin = place(cfg.after).endMin;
    }
    resolving.delete(kind);
    startMin = clamp(startMin, 0, MAX_MIN - 5);
    out[kind] = { startMin, endMin: clamp(startMin + cfg.durationMin, startMin + 5, MAX_MIN) };
    return out[kind];
  }

  for (const kind of KIND_KEYS) if (present.has(kind)) place(kind);
  return out;
}

// Kinds ordered as they'd actually occur on a day where all three happen —
// used for the gear popup's preview line.
export function previewOrder(settings) {
  const times = resolveDayTimes(settings, KIND_KEYS);
  return KIND_KEYS
    .map(key => ({ key, ...times[key] }))
    .sort((a, b) => a.startMin - b.startMin || KIND_KEYS.indexOf(a.key) - KIND_KEYS.indexOf(b.key));
}
