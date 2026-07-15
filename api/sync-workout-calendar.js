// GET /api/sync-workout-calendar — hourly cron (declared in vercel.json crons).
//
// Pushes each opted-in user's PLANNED workouts, saunas and cooking (from the
// Week Plan) into a dedicated "Prep Day" Google Calendar, so what's coming up
// shows in their Google Calendar and syncs to all their devices.
//
// OPT-IN: a user participates when `googleCalendarAutoSync === true` and a
// `googleCalendarRefreshToken` is stored on their user doc (saved by the Week
// Plan when they connect Google with the calendar scope).
//
// WHAT SYNCS, per day, for the current + next Sunday–Saturday week:
//   workout — the resolved plan (same staleness ranking + per-day overrides the
//             Week Plan uses). Non-rest, today-or-future days only. A workout's
//             KIND is its category (weights/cardio/yoga, via
//             `workoutTypeCategories`), which is what picks its timing row —
//             so cardio can be a 6am thing and lifting a 6pm one.
//   sauna   — sauna has no plan of its own (it's only logged after the fact on
//             mobile), so it's suggested: it rides along with planned workouts,
//             spread across the week until it tops up to `saunaGoal`, minus any
//             already logged that week. `saunaOverrides` pins or vetoes single
//             days (a pinned day needs no workout). Mirrored from
//             src/utils/saunaPlan.js — change both.
//   cooking — every day the Prepare grid says you're cooking: `cookRecipes` on
//             the day, or entries flagged `cooked` (the actual cook day of a
//             forward fill). Read from users/{uid}/data/dailyLog.
//
// TIMING: `calendarSyncSettings` on the user doc gives each kind a start that is
// either a fixed clock time or chained to the END of another kind that day, plus
// a length. Mirrored from src/utils/calendarSyncSettings.js — change both.
//
// IDEMPOTENT: every event we create is tagged extendedProperties.private
// { prepDayWorkout:'true', prepDayKind:<kind> }. Each run lists our tagged
// events in the window and diffs by (date, kind) — creating, patching (title or
// time changed) or deleting (no longer planned) so the calendar always mirrors
// the plan without duplicates. Events predating the multi-kind tag carry no
// prepDayKind and are adopted as 'workout'.
//
// Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. Manual runs need
// that header or ?secret=... . Add ?dryRun=1 to compute the diff without writing.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

const db = getFirestore();
const CAL_NAME = 'Prep Day';
const CAL_DESC = 'Planned workouts, saunas and cooking from Prep Day (prep-day.com). Auto-synced.';
const TZ = 'America/New_York';
const pad2 = (n) => String(n).padStart(2, '0');

// ---- Eastern-clock date helpers (mirror the app's local = America/New_York) ----
function easternYMD(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}
// Work in UTC-anchored dates built from the Eastern y/m/d so day-of-week and
// date math never slip on the server's own timezone.
function utcOf(y, m, d) { return new Date(Date.UTC(y, m - 1, d)); }
function isoOf(dt) { return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`; }
function addDays(dt, n) { const x = new Date(dt); x.setUTCDate(x.getUTCDate() + n); return x; }
function sundayOf(dt) { const x = new Date(dt); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); return x; } // getUTCDay 0=Sun

// ---- Workout-plan resolution (ported from WeekPlanPage.jsx) ----
function rankWorkoutTypesByStaleness(workoutsRaw, workoutTypes, typeSkipDates) {
  const lastByType = {};
  for (const w of workoutsRaw || []) {
    if (!w?.workoutType || !w.date) continue;
    if (!lastByType[w.workoutType] || w.date > lastByType[w.workoutType]) lastByType[w.workoutType] = w.date;
  }
  const eff = {};
  for (const t of workoutTypes) {
    const wd = lastByType[t] || '';
    const sd = (typeSkipDates && typeSkipDates[t]) || '';
    eff[t] = sd > wd ? sd : wd;
  }
  return [...workoutTypes].sort((a, b) => {
    const ea = eff[a], eb = eff[b];
    if (!ea && !eb) return 0;
    if (!ea) return -1;
    if (!eb) return 1;
    return ea < eb ? -1 : ea > eb ? 1 : 0;
  });
}
function spreadIndices(len, count) {
  const set = new Set();
  if (count <= 0 || len <= 0) return set;
  if (count >= len) { for (let i = 0; i < len; i++) set.add(i); return set; }
  for (let j = 0; j < count; j++) {
    let idx = Math.min(len - 1, Math.round((j + 0.5) * len / count));
    while (set.has(idx) && idx < len - 1) idx += 1;
    while (set.has(idx) && idx > 0) idx -= 1;
    set.add(idx);
  }
  return set;
}
function resolveWorkoutPlan(rankedTypes, overrides, workoutTypes, recordedIdxs, recordedTypes) {
  const validTypes = new Set(workoutTypes);
  const fixed = {};
  for (const [k, v] of Object.entries(overrides || {})) {
    if (v === 'rest' || validTypes.has(v)) fixed[Number(k)] = v;
  }
  const out = {};
  for (let i = 0; i < 7; i++) if (fixed[i] != null) out[i] = { value: fixed[i], isAuto: false };
  const restInFixed = Object.values(fixed).filter(v => v === 'rest').length;
  const restNeeded = Math.max(0, 2 - restInFixed);
  const usedTypes = new Set(Object.values(fixed).filter(v => v !== 'rest'));
  const available = rankedTypes.filter(t => !usedTypes.has(t) && !recordedTypes.has(t));
  const autoSlots = [];
  for (let i = 0; i < 7; i++) if (fixed[i] == null && !recordedIdxs.has(i)) autoSlots.push(i);
  const restPos = spreadIndices(autoSlots.length, restNeeded);
  let ti = 0;
  autoSlots.forEach((slot, pos) => {
    if (restPos.has(pos) || ti >= available.length) out[slot] = { value: 'rest', isAuto: true };
    else out[slot] = { value: available[ti++], isAuto: true };
  });
  return out;
}

// ---- Sauna suggestion (mirrored from src/utils/saunaPlan.js) ----
const DEFAULT_SAUNA_GOAL = 3;
const MAX_SAUNA_GOAL = 7;
const SAUNA_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function normalizeSaunaGoal(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_SAUNA_GOAL;
  return Math.min(MAX_SAUNA_GOAL, Math.max(0, n));
}
function normalizeSaunaOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (SAUNA_DATE_RE.test(k) && typeof v === 'boolean') out[k] = v;
  }
  return out;
}
function resolveSaunaDates({ weekDates = [], plannedDates = [], loggedSaunaDays = [], overrides = {}, goal = DEFAULT_SAUNA_GOAL, todayStr = '' } = {}) {
  const g = normalizeSaunaGoal(goal);
  const ov = normalizeSaunaOverrides(overrides);
  const logged = new Set(loggedSaunaDays);
  const out = new Set(weekDates.filter(d => ov[d] === true && !logged.has(d) && d >= todayStr));
  const budget = Math.max(0, g - logged.size - out.size);
  const candidates = plannedDates.filter(
    d => !logged.has(d) && !out.has(d) && ov[d] !== false && d >= todayStr
  );
  const picks = spreadIndices(candidates.length, Math.min(budget, candidates.length));
  candidates.forEach((d, i) => { if (picks.has(i)) out.add(d); });
  return out;
}

// ---- Per-kind timing (mirrored from src/utils/calendarSyncSettings.js) ----
const WORKOUT_KINDS = ['weights', 'cardio', 'yoga'];
const ANY_WORKOUT = 'workout';
const KIND_KEYS = [...WORKOUT_KINDS, 'sauna', 'cooking'];
const isWorkoutKind = (k) => WORKOUT_KINDS.includes(k);
const DEFAULT_SYNC_SETTINGS = {
  weights: { startMode: 'time', time: '18:00', after: '', durationMin: 75 },
  cardio: { startMode: 'time', time: '18:00', after: '', durationMin: 75 },
  yoga: { startMode: 'time', time: '18:00', after: '', durationMin: 75 },
  sauna: { startMode: 'after', time: '19:15', after: ANY_WORKOUT, durationMin: 30 },
  cooking: { startMode: 'time', time: '17:00', after: '', durationMin: 45 },
};
function anchorOptionsFor(key) {
  if (isWorkoutKind(key)) return KIND_KEYS.filter(k => !isWorkoutKind(k) && k !== key);
  return [ANY_WORKOUT, ...KIND_KEYS.filter(k => k !== key)];
}
const MAX_MIN = 24 * 60 - 1;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return 0;
  return clamp(+m[1] * 60 + +m[2], 0, MAX_MIN);
}
function minToHHMM(min) {
  const v = clamp(Math.round(min), 0, MAX_MIN);
  return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`;
}
function normalizeSyncSettings(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  // Pre-category docs had ONE `workout` entry covering every category.
  const legacy = (src.workout && typeof src.workout === 'object') ? src.workout : null;
  const out = {};
  for (const key of KIND_KEYS) {
    const d = DEFAULT_SYNC_SETTINGS[key];
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
function resolveAnchor(after, present) {
  if (after === ANY_WORKOUT) return WORKOUT_KINDS.find(k => present.has(k)) || null;
  return present.has(after) ? after : null;
}
// Start/end minutes for the kinds actually happening on one day. A kind chained
// to an absent anchor (cooking "after workout" on a rest day) falls back to its
// own clock time rather than vanishing; reference cycles fall back the same way.
function resolveDayTimes(settings, presentKinds) {
  const s = settings;
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

// ---- Google Calendar helpers ----
async function getAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const tokens = await res.json();
  if (tokens.error || !tokens.access_token) throw new Error(tokens.error_description || tokens.error || 'token refresh failed');
  return tokens.access_token;
}
async function gcal(accessToken, path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === 'DELETE') { if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`DELETE ${path} → ${res.status}`); return null; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error?.message || `${method} ${path} → ${res.status}`); e.status = res.status; throw e; }
  return data;
}
// Return a usable "Prep Day" calendar id, creating it if needed. An existing
// calendar still named "Prep Day Workouts" (workout-only era) is renamed in
// place, so the user keeps their events and Google Calendar colour/visibility.
async function ensureCalendar(accessToken, existingId) {
  if (existingId) {
    try {
      const cal = await gcal(accessToken, `/calendars/${encodeURIComponent(existingId)}`);
      let renamed = false;
      if (cal.summary !== CAL_NAME) {
        await gcal(accessToken, `/calendars/${encodeURIComponent(existingId)}`, {
          method: 'PATCH',
          body: { summary: CAL_NAME, description: CAL_DESC },
        });
        renamed = true;
      }
      return { id: existingId, created: false, renamed };
    } catch (e) {
      if (e.status !== 404 && e.status !== 410) throw e; /* deleted → recreate */
    }
  }
  const cal = await gcal(accessToken, '/calendars', {
    method: 'POST',
    body: { summary: CAL_NAME, description: CAL_DESC, timeZone: TZ },
  });
  return { id: cal.id, created: true, renamed: false };
}

// Workout events keep the type's own name as the label; the icon comes from its
// category, matching the Week Plan grid.
const WORKOUT_ICON = { weights: '🏋️', cardio: '🏃', yoga: '🧘' };
const titleFor = (kind, label) => (
  isWorkoutKind(kind) ? `${WORKOUT_ICON[kind]} ${label}`
    : kind === 'sauna' ? '🧖 Sauna'
      : label ? `🍳 Cook: ${label}` : '🍳 Cooking'
);
function timedSlot(dateStr, startMin, endMin) {
  return {
    start: { dateTime: `${dateStr}T${minToHHMM(startMin)}:00`, timeZone: TZ },
    end: { dateTime: `${dateStr}T${minToHHMM(endMin)}:00`, timeZone: TZ },
  };
}
// "HH:MM" of an event's start/end dateTime (empty for all-day → forces a re-time).
const hhmm = (dt) => (dt || '').slice(11, 16);

// Recipe titles being cooked on each day, from the Prepare grid. Union of the
// day's explicit `cookRecipes` list and any entries flagged `cooked` (the first
// day of a forward fill — the day it's actually made, not the leftovers).
function cookNamesByDate(log, recipesById, windowStart, windowEndStr) {
  const out = {};
  for (const [dateStr, day] of Object.entries(log || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    if (dateStr < windowStart || dateStr > windowEndStr) continue;
    const names = [];
    const seen = new Set();
    const push = (n) => { const t = String(n || '').trim(); if (t && !seen.has(t)) { seen.add(t); names.push(t); } };
    for (const id of (Array.isArray(day?.cookRecipes) ? day.cookRecipes : [])) push(recipesById[id]);
    for (const e of (Array.isArray(day?.entries) ? day.entries : [])) if (e?.cooked === true) push(e.recipeName || recipesById[e.recipeId]);
    if (names.length) out[dateStr] = names.join(', ');
  }
  return out;
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const ok = (req.headers.authorization || '') === `Bearer ${secret}` || req.query?.secret === secret;
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  }
  const dryRun = req.query?.dryRun === '1' || req.query?.dryRun === 'true';

  const e = easternYMD();
  const todayDt = utcOf(e.y, e.m, e.d);
  const todayStr = isoOf(todayDt);
  const week0Sun = sundayOf(todayDt);           // this week's Sunday
  const windowStart = todayStr;                 // don't touch past days
  const windowEndDt = addDays(week0Sun, 13);    // through next week's Saturday
  const windowEndStr = isoOf(windowEndDt);

  const summary = { scanned: 0, eligible: 0, synced: 0, created: 0, patched: 0, deleted: 0, calendarsCreated: 0, calendarsRenamed: 0, errors: [], dryRun };

  try {
    const snap = await db.collection('users').get();
    for (const docSnap of snap.docs) {
      summary.scanned++;
      const uid = docSnap.id;
      const data = docSnap.data() || {};
      const refreshToken = data.googleCalendarRefreshToken;
      if (data.googleCalendarAutoSync !== true || !refreshToken) continue;
      summary.eligible++;

      try {
        const settings = normalizeSyncSettings(data.calendarSyncSettings);
        const workoutTypes = Array.isArray(data.workoutTypes) ? data.workoutTypes : [];
        const typeSkipDates = (data.workoutTypeSkipDates && typeof data.workoutTypeSkipDates === 'object') ? data.workoutTypeSkipDates : {};
        // type name → 'weights' | 'cardio' | 'yoga'. Drives which timing row a
        // day's workout uses; anything unmapped is treated as weights (same
        // fallback the Week Plan's icon uses).
        const typeCategories = (data.workoutTypeCategories && typeof data.workoutTypeCategories === 'object') ? data.workoutTypeCategories : {};
        const categoryOf = (type) => (isWorkoutKind(typeCategories[type]) ? typeCategories[type] : 'weights');
        const overrides = (data.weekWorkoutPlan && typeof data.weekWorkoutPlan === 'object') ? data.weekWorkoutPlan : {};
        const saunaGoal = normalizeSaunaGoal(data.saunaGoal);
        const saunaOverrides = normalizeSaunaOverrides(data.saunaOverrides);

        // Recent workouts (bounded) — enough for staleness ranking + recorded-day skips.
        const cutoff = isoOf(addDays(todayDt, -120));
        let workoutsRaw = [];
        try {
          const wSnap = await db.collection(`users/${uid}/workouts`).where('date', '>=', cutoff).get();
          workoutsRaw = wSnap.docs.map(d => d.data());
        } catch { workoutsRaw = []; }

        // Planned workout type per date across this week + next week, plus the
        // subset of those days that should also get a sauna.
        const ranked = rankWorkoutTypesByStaleness(workoutsRaw, workoutTypes, typeSkipDates);
        const workoutByDate = {};
        const saunaDates = new Set();
        for (let wk = 0; wk < 2; wk++) {
          const sun = addDays(week0Sun, wk * 7);
          const weekDates = Array.from({ length: 7 }, (_, i) => isoOf(addDays(sun, i)));
          const recordedIdxs = new Set();
          const recordedTypes = new Set();
          for (const w of workoutsRaw) {
            const idx = weekDates.indexOf(w?.date);
            if (idx >= 0) { recordedIdxs.add(idx); if (w.workoutType) recordedTypes.add(w.workoutType); }
          }
          const plan = resolveWorkoutPlan(ranked, overrides, workoutTypes, recordedIdxs, recordedTypes);
          const plannedDates = [];
          for (let i = 0; i < 7; i++) {
            const dateStr = weekDates[i];
            if (dateStr < todayStr) continue;            // skip past days
            const val = plan[i]?.value;
            if (val && val !== 'rest') {
              workoutByDate[dateStr] = { label: val, kind: categoryOf(val) };
              plannedDates.push(dateStr);
            }
          }

          // Sauna rides along with workouts, topping up to the user's weekly
          // goal. Same resolver the Week Plan grid runs, so the calendar shows
          // exactly the days the grid does.
          const loggedSaunaDays = [];
          for (const w of workoutsRaw) if (w?.sauna && w.date && weekDates.includes(w.date)) loggedSaunaDays.push(w.date);
          for (const d of resolveSaunaDates({
            weekDates,
            plannedDates,
            loggedSaunaDays,
            overrides: saunaOverrides,
            goal: saunaGoal,
            todayStr,
          })) saunaDates.add(d);
        }

        // Cook days come from the Prepare grid (a different doc than the plan).
        let cookByDate = {};
        try {
          const logSnap = await db.doc(`users/${uid}/data/dailyLog`).get();
          const log = logSnap.exists ? (logSnap.data()?.log || {}) : {};
          let recipes = [];
          try {
            const rSnap = await db.doc(`users/${uid}/data/recipes`).get();
            recipes = rSnap.exists ? (rSnap.data()?.recipes || []) : [];
          } catch { recipes = []; }
          if (!recipes.length && Array.isArray(data.recipes)) recipes = data.recipes; // pre-migration
          const recipesById = {};
          for (const r of recipes) if (r?.id) recipesById[r.id] = r.title;
          cookByDate = cookNamesByDate(log, recipesById, windowStart, windowEndStr);
        } catch { cookByDate = {}; }

        // Desired events, keyed `${date}|${kind}` so a day can hold all three.
        const desired = {};
        // saunaDates is in the union too: a sauna pinned to a rest day has no
        // workout or cooking to ride along with, but still needs its event.
        const dates = new Set([...Object.keys(workoutByDate), ...saunaDates, ...Object.keys(cookByDate)]);
        for (const date of dates) {
          if (date < windowStart || date > windowEndStr) continue;
          const present = [];
          // A workout's kind IS its category, so it picks up that row's timing.
          if (workoutByDate[date]) present.push(workoutByDate[date].kind);
          if (saunaDates.has(date)) present.push('sauna');
          if (cookByDate[date]) present.push('cooking');
          const times = resolveDayTimes(settings, present);
          for (const kind of present) {
            const label = isWorkoutKind(kind) ? workoutByDate[date].label : kind === 'cooking' ? cookByDate[date] : '';
            desired[`${date}|${kind}`] = {
              date, kind, label,
              title: titleFor(kind, label),
              startMin: times[kind].startMin,
              endMin: times[kind].endMin,
            };
          }
        }

        if (dryRun) {
          summary.synced++;
          summary.errors.push({
            uid,
            dryRunDesired: Object.fromEntries(Object.entries(desired).map(([k, v]) => [k, `${v.title} ${minToHHMM(v.startMin)}–${minToHHMM(v.endMin)}`])),
          });
          continue;
        }

        // Ensure the calendar exists (and carries the current name).
        const accessToken = await getAccessToken(refreshToken);
        const { id: calendarId, created, renamed } = await ensureCalendar(accessToken, data.googleWorkoutCalendarId);
        if (created) {
          summary.calendarsCreated++;
          await docSnap.ref.update({ googleWorkoutCalendarId: calendarId });
        }
        if (renamed) summary.calendarsRenamed++;

        // List our tagged events in the window.
        const params = new URLSearchParams({
          privateExtendedProperty: 'prepDayWorkout=true',
          timeMin: `${windowStart}T00:00:00Z`,
          timeMax: `${windowEndStr}T23:59:59Z`,
          singleEvents: 'true',
          maxResults: '250',
        });
        const listed = await gcal(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
        const existing = new Map();
        for (const ev of (listed.items || [])) {
          const date = ev.start?.date || (ev.start?.dateTime || '').slice(0, 10);
          if (!date) continue;
          // Events written before multi-kind support carry no prepDayKind; ones
          // written before per-category timing are tagged 'workout'. Both re-key
          // to that day's category so they're PATCHed in place rather than
          // deleted and recreated (which would churn event ids).
          const raw = ev.extendedProperties?.private?.prepDayKind || ANY_WORKOUT;
          const kind = raw === ANY_WORKOUT ? (workoutByDate[date]?.kind || ANY_WORKOUT) : raw;
          existing.set(`${date}|${kind}`, ev);
        }

        // Diff desired vs existing.
        for (const [key, want] of Object.entries(desired)) {
          const ev = existing.get(key);
          const priv = { prepDayWorkout: 'true', prepDayKind: want.kind };
          if (isWorkoutKind(want.kind)) priv.workoutType = want.label;
          const body = {
            summary: want.title,
            ...timedSlot(want.date, want.startMin, want.endMin),
            extendedProperties: { private: priv },
          };
          if (!ev) {
            await gcal(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events`, {
              method: 'POST',
              body: { ...body, transparency: 'transparent' },
            });
            summary.created++;
            continue;
          }
          const isAllDay = !!ev.start?.date; // legacy all-day event → re-time it
          const timeMismatch = hhmm(ev.start?.dateTime) !== minToHHMM(want.startMin)
            || hhmm(ev.end?.dateTime) !== minToHHMM(want.endMin);
          // A legacy 'workout'-tagged event re-keyed above lands here with the
          // old tag, so this also re-tags it with its category.
          const tagMismatch = ev.extendedProperties?.private?.prepDayKind !== want.kind
            || (isWorkoutKind(want.kind) && ev.extendedProperties?.private?.workoutType !== want.label);
          if (ev.summary !== want.title || tagMismatch || isAllDay || timeMismatch) {
            await gcal(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ev.id)}`, {
              method: 'PATCH',
              body,
            });
            summary.patched++;
          }
        }
        // Delete tagged events no longer planned.
        for (const [key, ev] of existing) {
          if (!desired[key]) {
            await gcal(accessToken, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ev.id)}`, { method: 'DELETE' });
            summary.deleted++;
          }
        }
        summary.synced++;
      } catch (err) {
        summary.errors.push({ uid, error: err.message });
      }
    }
    return res.status(200).json({ ok: true, today: todayStr, ...summary });
  } catch (err) {
    console.error('sync-workout-calendar fatal:', err);
    return res.status(500).json({ error: err.message, partial: summary });
  }
}
