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
// QUIET: because this runs HOURLY and re-plans as you log, the diff churns —
// days get retitled, re-keyed to another category, and swept once they're in
// the past. With a standing guest configured that churn was going out as
// "Cancelled" / "Updated invitation" mail, several a day, mostly for events
// that had already happened. So `sendUpdates=all` is now spent only where a
// guest can act on it: a NEW event, being added to or removed from one, and an
// event actually MOVING. Deletes and title/tag-only patches go out with
// `sendUpdates=none` — the guest's copy still updates, they just aren't mailed.
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
// Goal-aware day suggestion — each open day goes to the category furthest from
// its weekly goal, filled by the most overdue type in it. Rest comes from
// goals.rest. Ported from WeekPlanPage.jsx; keep the two in step or the grid and
// the synced calendar will name different workouts for the same day.
const WORKOUT_KIND_KEYS = ['weights', 'cardio', 'yoga'];
// Cardio and yoga share a day by default — mirrors PAIRED_WITH in WeekPlanPage.
const PAIRED_WITH = { cardio: 'yoga', yoga: 'cardio' };
const SECOND_SLOT_RE = /^(\d)\.2$/;
const DEFAULT_WORKOUT_GOALS = { weights: 3, cardio: 1, yoga: 1, rest: 2 };
// Keyword fallback for types with no explicit category — mirrors
// CAL_YOGA_RE / CAL_CARDIO_RE in WorkoutPage.jsx.
const CAT_YOGA_RE = /yoga|vinyasa|pilates|mobility|stretch/i;
const CAT_CARDIO_RE = /cardio|running|\brun\b|jog|cycl|spin|\bbike\b|biking|swim|hiit|elliptical|treadmill|stair|sprint|conditioning|walk|hike/i;
function normalizeWorkoutGoals(goals) {
  const out = { ...DEFAULT_WORKOUT_GOALS };
  for (const k of Object.keys(out)) {
    const n = Math.round(Number(goals?.[k]));
    if (Number.isFinite(n)) out[k] = Math.min(7, Math.max(0, n));
  }
  return out;
}
function resolveWorkoutPlan(rankedTypes, overrides, workoutTypes, recordedIdxs, recordedTypes, opts = {}) {
  const goals = normalizeWorkoutGoals(opts.goals);
  const categoryOf = opts.categoryOf || (() => 'weights');
  const loggedCatDays = opts.loggedCatDays || {};
  // 0 = plan the whole week (next week, which hasn't started).
  const todayIdx = Number.isFinite(opts.todayIdx) ? Math.min(6, Math.max(0, Math.round(opts.todayIdx))) : 0;

  const validTypes = new Set(workoutTypes);
  const fixed = {};
  const fixedSecond = {};
  const noSecond = new Set();
  for (const [k, v] of Object.entries(overrides || {})) {
    const m = SECOND_SLOT_RE.exec(k);
    if (m) {
      const i = Number(m[1]);
      if (v === '' || v === 'rest') noSecond.add(i);
      else if (validTypes.has(v)) fixedSecond[i] = v;
      continue;
    }
    if (v === 'rest' || validTypes.has(v)) fixed[Number(k)] = v;
  }
  const out = {};
  for (let i = 0; i < 7; i++) if (fixed[i] != null) out[i] = { value: fixed[i], isAuto: false };

  // Days already gone by with nothing logged are rest — banked against the rest
  // goal, and never handed a goal day they can no longer serve.
  const pastRest = [];
  for (let i = 0; i < todayIdx; i++) {
    if (recordedIdxs.has(i)) continue;
    pastRest.push(i);
    out[i] = { value: 'rest', isAuto: fixed[i] !== 'rest' };
  }
  const restInFixed = Object.entries(fixed)
    .filter(([k, v]) => v === 'rest' && Number(k) >= todayIdx && !recordedIdxs.has(Number(k)))
    .length;
  const restNeeded = Math.max(0, goals.rest - pastRest.length - restInFixed);

  const have = {};
  for (const cat of WORKOUT_KIND_KEYS) have[cat] = Math.max(0, Math.round(Number(loggedCatDays[cat]) || 0));
  for (const [k, v] of Object.entries(fixed)) {
    const i = Number(k);
    if (v === 'rest' || recordedIdxs.has(i) || i < todayIdx) continue;
    const cat = categoryOf(v);
    if (have[cat] != null) have[cat] += 1;
  }
  const need = {};
  for (const cat of WORKOUT_KIND_KEYS) need[cat] = Math.max(0, goals[cat] - have[cat]);

  const autoSlots = [];
  for (let i = todayIdx; i < 7; i++) if (fixed[i] == null && !recordedIdxs.has(i)) autoSlots.push(i);
  const restPos = spreadIndices(autoSlots.length, restNeeded);

  const byCat = {};
  for (const cat of WORKOUT_KIND_KEYS) byCat[cat] = [];
  const rankIndex = new Map();
  rankedTypes.forEach((t, i) => {
    rankIndex.set(t, i);
    const cat = categoryOf(t);
    if (byCat[cat]) byCat[cat].push(t);
  });

  const usedTypes = new Set([
    ...Object.values(fixed).filter(v => v !== 'rest'),
    ...recordedTypes,
  ]);
  const placedAt = {};

  function candidateFor(cat) {
    const pool = byCat[cat] || [];
    if (!pool.length) return null;
    const fresh = pool.find(t => !usedTypes.has(t));
    if (fresh) return fresh;
    let best = null, bestPos = Infinity;
    for (const t of pool) {
      const p = placedAt[t] ?? -1;
      if (p < bestPos) { best = t; bestPos = p; }
    }
    return best;
  }

  function pickCategory(prevCat, left) {
    const cats = WORKOUT_KIND_KEYS.filter(c => need[c] > 0 && candidateFor(c));
    if (!cats.length) return null;
    const spread = cats.filter(c => c !== prevCat || need[c] >= left);
    const pool = spread.length ? spread : cats;
    let best = pool[0];
    for (const c of pool) {
      if (need[c] > need[best]) best = c;
      else if (need[c] === need[best]) {
        const a = rankIndex.get(candidateFor(c)) ?? Infinity;
        const b = rankIndex.get(candidateFor(best)) ?? Infinity;
        if (a < b) best = c;
      }
    }
    return best;
  }

  // A day you pinned anchors the pairing too, so one pinned half doesn't send
  // the other off on its own. Runs BEFORE the auto pass, which would otherwise
  // have already spent the partner's day elsewhere.
  for (let i = 0; i < 7; i++) {
    if (recordedIdxs.has(i)) continue;
    const cell = out[i];
    if (!cell || cell.value === 'rest' || cell.second || fixedSecond[i] != null || noSecond.has(i)) continue;
    if (cell.isAuto) continue;
    const partner = PAIRED_WITH[categoryOf(cell.value)];
    if (!partner || !(need[partner] > 0)) continue;
    const mate = candidateFor(partner);
    if (!mate) continue;
    need[partner] -= 1;
    usedTypes.add(mate);
    cell.second = { value: mate, isAuto: true };
  }

  const workoutPositions = autoSlots.map((_, pos) => pos).filter(pos => !restPos.has(pos));
  for (const pos of restPos) out[autoSlots[pos]] = { value: 'rest', isAuto: true };

  workoutPositions.forEach((pos, i) => {
    const slot = autoSlots[pos];
    const left = workoutPositions.length - i;
    const prev = out[slot - 1];
    const prevCat = prev && prev.value !== 'rest' ? categoryOf(prev.value) : null;

    const cat = pickCategory(prevCat, left);
    let type = cat ? candidateFor(cat) : null;
    if (type != null) need[cat] -= 1;
    else type = rankedTypes.find(t => !usedTypes.has(t)) || null;

    if (type == null) { out[slot] = { value: 'rest', isAuto: true }; return; }
    usedTypes.add(type);
    placedAt[type] = pos;
    out[slot] = { value: type, isAuto: true };

    const partner = PAIRED_WITH[cat];
    if (partner && need[partner] > 0 && fixedSecond[slot] == null && !noSecond.has(slot)) {
      const mate = candidateFor(partner);
      if (mate) {
        need[partner] -= 1;
        usedTypes.add(mate);
        placedAt[mate] = pos;
        out[slot].second = { value: mate, isAuto: true };
      }
    }
  });

  for (const [k, v] of Object.entries(fixedSecond)) {
    const i = Number(k);
    if (!out[i]) continue;
    if (out[i].value === 'rest') { out[i] = { value: v, isAuto: false }; continue; }
    out[i].second = { value: v, isAuto: false };
  }
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
// Mirrored from src/utils/calendarSyncSettings.js — change both. The guest
// logic is covered by src/utils/calendarSyncSettings.test.js; keep this copy
// identical so those tests mean something here.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeGuestEmail(s) {
  const v = String(s || '').trim().toLowerCase();
  return EMAIL_RE.test(v) ? v : '';
}
// See the long comment on resolveEventGuests in the shared util: this compares
// only "is our guest present / is a superseded one still there", never the
// whole attendee list, because Google adds the organiser to `attendees` and a
// list comparison would re-notify the guest on every hourly run.
function resolveEventGuests(ev, guestEmail, prevGuest) {
  const want = normalizeGuestEmail(guestEmail);
  const prev = normalizeGuestEmail(prevGuest);
  const attendees = Array.isArray(ev?.attendees) ? ev.attendees : [];
  const emails = new Set(attendees.map(a => String(a?.email || '').trim().toLowerCase()));
  const missing = !!want && !emails.has(want);
  const stale = !!prev && prev !== want && emails.has(prev);
  if (!missing && !stale) return { changed: false, attendees: null };
  const kept = attendees
    .filter(a => !(stale && String(a?.email || '').trim().toLowerCase() === prev))
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
  // Standing guest invited to every synced event. Empty = nobody, the default.
  out.guestEmail = normalizeGuestEmail(src.guestEmail);
  return out;
}
function resolveAnchor(after, present) {
  if (after === ANY_WORKOUT) return WORKOUT_KINDS.find(k => present.has(k)) || null;
  return present.has(after) ? after : null;
}
// Start/end minutes for the kinds actually happening on one day. A kind chained
// to an absent anchor (cooking "after workout" on a rest day) falls back to its
// own clock time rather than vanishing; reference cycles fall back the same way.
// `durationOverrides` lets a kind use a per-day length instead of its fixed
// setting — cooking passes the recipe's prep + cook time here (see the handler).
function resolveDayTimes(settings, presentKinds, durationOverrides = {}) {
  const s = settings;
  const present = new Set(presentKinds);
  const out = {};
  const resolving = new Set();
  const durOf = (kind, cfg) => clamp(Math.round(Number(durationOverrides[kind]) || cfg.durationMin), 5, 12 * 60);
  function place(kind) {
    if (out[kind]) return out[kind];
    const cfg = s[kind];
    if (resolving.has(kind)) return { startMin: parseHHMM(cfg.time), endMin: parseHHMM(cfg.time) + durOf(kind, cfg) };
    resolving.add(kind);
    let startMin = parseHHMM(cfg.time);
    if (cfg.startMode === 'after' && cfg.after) {
      const anchor = resolveAnchor(cfg.after, present);
      if (anchor) startMin = place(anchor).endMin;
    }
    resolving.delete(kind);
    startMin = clamp(startMin, 0, MAX_MIN - 5);
    out[kind] = { startMin, endMin: clamp(startMin + durOf(kind, cfg), startMin + 5, MAX_MIN) };
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
// Invitations lead with the event title in the email header, and a bare
// "🏋️ Push" landing in someone's inbox says nothing about where it came from.
// Events that actually invite a guest get branded; solo events keep the short
// title so the calendar grid stays readable on days nobody's invited.
const TITLE_PREFIX = 'Prep Day · ';
const titleFor = (kind, label, branded = false) => {
  const base = isWorkoutKind(kind) ? `${WORKOUT_ICON[kind]} ${label}`
    : kind === 'sauna' ? '🧖 Sauna'
      : label ? `🍳 Cook: ${label}` : '🍳 Cooking';
  return branded ? `${TITLE_PREFIX}${base}` : base;
};
function timedSlot(dateStr, startMin, endMin) {
  return {
    start: { dateTime: `${dateStr}T${minToHHMM(startMin)}:00`, timeZone: TZ },
    end: { dateTime: `${dateStr}T${minToHHMM(endMin)}:00`, timeZone: TZ },
  };
}
// "HH:MM" of an event's start/end dateTime (empty for all-day → forces a re-time).
const hhmm = (dt) => (dt || '').slice(11, 16);

// Parse a recipe's free-text prep/cook time into whole minutes. Handles the
// shapes users actually type — "15 min", "30 minutes", "1 hour", "1 hr 30 min",
// "1.5 hours", "1h30m", a bare "45", and ISO 8601 ("PT1H30M"). Returns 0 when
// nothing parses (so an unlabelled time contributes nothing to the total).
function parseDurationMin(str) {
  const s = String(str || '').trim().toLowerCase();
  if (!s) return 0;
  const iso = /^pt(?:(\d+)h)?(?:(\d+)m)?$/.exec(s.replace(/\s+/g, ''));
  if (iso && (iso[1] || iso[2])) return (+(iso[1] || 0)) * 60 + (+(iso[2] || 0));
  let total = 0, matched = false, mm;
  const hRe = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)/g;
  while ((mm = hRe.exec(s))) { total += Math.round(parseFloat(mm[1]) * 60); matched = true; }
  const mRe = /(\d+)\s*(?:minutes?|mins?|m)/g;
  while ((mm = mRe.exec(s))) { total += +mm[1]; matched = true; }
  if (matched) return total;
  const n = /^(\d+(?:\.\d+)?)$/.exec(s);
  return n ? Math.round(parseFloat(n[1])) : 0;
}

// What's being cooked on each day, from the Prepare grid: a label (the recipe
// titles) plus how long the event should run. Union of the day's explicit
// `cookRecipes` list and any entries flagged `cooked` (the first day of a
// forward fill — the day it's actually made, not the leftovers). The duration
// is the SUM of each cooked recipe's prep + cook time; when none of the day's
// recipes list a time it falls back to `defaultMin` (the cooking gear setting).
function cookInfoByDate(log, recipes, windowStart, windowEndStr, defaultMin) {
  const byId = {}, byTitle = {};
  for (const r of (recipes || [])) {
    if (!r) continue;
    if (r.id) byId[r.id] = r;
    const t = String(r.title || '').trim().toLowerCase();
    if (t && !(t in byTitle)) byTitle[t] = r;
  }
  const recipeMinutes = (r) => (r ? parseDurationMin(r.prepTime) + parseDurationMin(r.cookTime) : 0);
  const out = {};
  for (const [dateStr, day] of Object.entries(log || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    if (dateStr < windowStart || dateStr > windowEndStr) continue;
    const names = [];
    const seen = new Set();
    let sumMin = 0;
    const add = (recipe, fallbackName) => {
      const title = String((recipe && recipe.title) || fallbackName || '').trim();
      if (!title || seen.has(title)) return;
      seen.add(title);
      names.push(title);
      sumMin += recipeMinutes(recipe);
    };
    for (const id of (Array.isArray(day?.cookRecipes) ? day.cookRecipes : [])) add(byId[id], null);
    for (const e of (Array.isArray(day?.entries) ? day.entries : [])) {
      if (e?.cooked !== true) continue;
      add(byId[e.recipeId] || byTitle[String(e.recipeName || '').trim().toLowerCase()], e.recipeName);
    }
    if (names.length) out[dateStr] = { label: names.join(', '), durationMin: sumMin > 0 ? sumMin : defaultMin };
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
  const windowStart = todayStr;                 // don't CREATE/PATCH past days
  const windowEndDt = addDays(week0Sun, 13);    // through next week's Saturday
  const windowEndStr = isoOf(windowEndDt);
  // We LIST events from further back so stale past-day suggestions get cleaned
  // up. A suggested workout event (e.g. yoga) is created while its day is today
  // or future; if the day passes without the workout happening, that event is
  // now a past-day plan that never occurred. `desired` is only ever built for
  // today-forward (past days are skipped when planning), so any listed past-day
  // event falls out of `desired` and the delete loop removes it — leaving the
  // grid from showing a suggestion that looks like it happened. This only ever
  // enables DELETION in the past; creation/patching stays gated on windowStart.
  const listStart = isoOf(addDays(todayDt, -28));

  const summary = { scanned: 0, eligible: 0, synced: 0, created: 0, patched: 0, deleted: 0, invited: 0, calendarsCreated: 0, calendarsRenamed: 0, errors: [], dryRun };

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
        // Standing guest on every event this user syncs. '' = invite nobody.
        const guestEmail = settings.guestEmail || '';
        const workoutTypes = Array.isArray(data.workoutTypes) ? data.workoutTypes : [];
        const typeSkipDates = (data.workoutTypeSkipDates && typeof data.workoutTypeSkipDates === 'object') ? data.workoutTypeSkipDates : {};
        // type name → 'weights' | 'cardio' | 'yoga'. Drives which timing row a
        // day's workout uses; anything unmapped is treated as weights (same
        // fallback the Week Plan's icon uses).
        const typeCategories = (data.workoutTypeCategories && typeof data.workoutTypeCategories === 'object') ? data.workoutTypeCategories : {};
        // Explicit category wins, then the same keyword fallback the app's
        // workoutCalendarCategory uses for types tagged before categories
        // existed. The goal-aware planner below counts days by category, so this
        // has to answer exactly what the Week Plan's tally answers.
        const categoryOf = (type) => {
          const explicit = typeCategories[type];
          if (isWorkoutKind(explicit)) return explicit;
          const t = String(type || '');
          if (CAT_YOGA_RE.test(t)) return 'yoga';
          if (CAT_CARDIO_RE.test(t)) return 'cardio';
          return 'weights';
        };
        const workoutGoals = (data.workoutWeeklyGoals && typeof data.workoutWeeklyGoals === 'object') ? data.workoutWeeklyGoals : {};
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
        // The companion workout on a paired day (cardio + yoga). Kept beside the
        // primary rather than turning workoutByDate into an array: every event
        // here is already keyed by (date, kind), and the pair is always cardio
        // AND yoga, so the two can never collide on that key. That means the
        // existing create/patch/delete diff handles the second event with no
        // changes — it just sees another kind on that date.
        const workoutSecondByDate = {};
        const saunaDates = new Set();
        for (let wk = 0; wk < 2; wk++) {
          const sun = addDays(week0Sun, wk * 7);
          const weekDates = Array.from({ length: 7 }, (_, i) => isoOf(addDays(sun, i)));
          const recordedIdxs = new Set();
          const recordedTypes = new Set();
          // Categories logged per day, so the planner knows what this week has
          // already banked against each goal. A day counts once per category
          // (matching the app's tally), and typeless records — a sauna-only day —
          // are skipped rather than defaulting to weights.
          const catsByIdx = new Map();
          for (const w of workoutsRaw) {
            const idx = weekDates.indexOf(w?.date);
            if (idx < 0) continue;
            recordedIdxs.add(idx);
            if (!w.workoutType) continue;
            recordedTypes.add(w.workoutType);
            if (!catsByIdx.has(idx)) catsByIdx.set(idx, new Set());
            catsByIdx.get(idx).add(categoryOf(w.workoutType));
          }
          const loggedCatDays = Object.fromEntries(WORKOUT_KIND_KEYS.map(c => [c, 0]));
          for (const cats of catsByIdx.values()) {
            for (const c of WORKOUT_KIND_KEYS) if (cats.has(c)) loggedCatDays[c] += 1;
          }
          // Only week 0 has days behind it; next week plans in full.
          const todayIdx = Math.max(0, weekDates.indexOf(todayStr));
          const plan = resolveWorkoutPlan(ranked, overrides, workoutTypes, recordedIdxs, recordedTypes, {
            goals: workoutGoals,
            categoryOf,
            loggedCatDays,
            todayIdx,
          });
          const plannedDates = [];
          for (let i = 0; i < 7; i++) {
            const dateStr = weekDates[i];
            if (dateStr < todayStr) continue;            // skip past days
            const val = plan[i]?.value;
            if (val && val !== 'rest') {
              workoutByDate[dateStr] = { label: val, kind: categoryOf(val) };
              const sec = plan[i]?.second?.value;
              if (sec && sec !== 'rest' && categoryOf(sec) !== categoryOf(val)) {
                workoutSecondByDate[dateStr] = { label: sec, kind: categoryOf(sec) };
              }
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
          cookByDate = cookInfoByDate(log, recipes, windowStart, windowEndStr, settings.cooking.durationMin);
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
          if (workoutSecondByDate[date]) present.push(workoutSecondByDate[date].kind);
          if (saunaDates.has(date)) present.push('sauna');
          if (cookByDate[date]) present.push('cooking');
          // Cooking runs for the day's total recipe time (prep + cook); other
          // kinds keep their fixed setting.
          const times = resolveDayTimes(settings, present, { cooking: cookByDate[date]?.durationMin });
          for (const kind of present) {
            // Which of the day's workouts this event is for — the kind is what
            // tells them apart, so a paired day gets its yoga title on the yoga
            // event rather than both reading as the primary.
            const label = isWorkoutKind(kind)
              ? (workoutSecondByDate[date]?.kind === kind
                ? workoutSecondByDate[date].label
                : workoutByDate[date]?.label || '')
              : kind === 'cooking' ? cookByDate[date].label : '';
            desired[`${date}|${kind}`] = {
              date, kind, label,
              // Branded only while a guest is configured. Turning the guest on
              // or off retitles existing events on the next sync, since the
              // title is part of the diff below.
              title: titleFor(kind, label, !!guestEmail),
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
          timeMin: `${listStart}T00:00:00Z`,
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
          // Remember who we invited, so changing or clearing the setting later
          // can remove exactly that address and leave guests the user added by
          // hand in Google alone.
          if (guestEmail) priv.prepDayGuest = guestEmail;
          const body = {
            summary: want.title,
            ...timedSlot(want.date, want.startMin, want.endMin),
            extendedProperties: { private: priv },
          };
          if (!ev) {
            await gcal(
              accessToken,
              `/calendars/${encodeURIComponent(calendarId)}/events${guestEmail ? '?sendUpdates=all' : ''}`,
              {
                method: 'POST',
                body: {
                  ...body,
                  transparency: 'transparent',
                  ...(guestEmail ? { attendees: [{ email: guestEmail }] } : {}),
                },
              },
            );
            summary.created++;
            if (guestEmail) summary.invited++;
            continue;
          }
          const isAllDay = !!ev.start?.date; // legacy all-day event → re-time it
          const timeMismatch = hhmm(ev.start?.dateTime) !== minToHHMM(want.startMin)
            || hhmm(ev.end?.dateTime) !== minToHHMM(want.endMin);
          // A legacy 'workout'-tagged event re-keyed above lands here with the
          // old tag, so this also re-tags it with its category.
          const tagMismatch = ev.extendedProperties?.private?.prepDayKind !== want.kind
            || (isWorkoutKind(want.kind) && ev.extendedProperties?.private?.workoutType !== want.label);

          const prevGuest = ev.extendedProperties?.private?.prepDayGuest || '';
          const guests = resolveEventGuests(ev, guestEmail, prevGuest);

          if (ev.summary !== want.title || tagMismatch || isAllDay || timeMismatch || guests.changed) {
            const patchBody = { ...body };
            // Clearing the setting must also clear the stored tag, or the stale
            // address would look "previously added" forever.
            if (!guestEmail && prevGuest) patchBody.extendedProperties = { private: { ...priv, prepDayGuest: '' } };
            if (guests.changed) patchBody.attendees = guests.attendees;
            // Only mail the guest about things a guest can act on: being added
            // or removed, and the event actually moving. A retitled workout
            // ("Push" → "Pull"), a re-tagged legacy event or a category
            // re-key changes nothing they need to know, and this loop runs
            // HOURLY — notifying on those turned every plan tweak into an
            // "Updated invitation" in their inbox. The old condition was
            // `guests.changed || hadAttendees || !!guestEmail`, which is
            // simply always true once a standing guest is configured.
            const notify = guests.changed || timeMismatch || isAllDay;
            await gcal(
              accessToken,
              `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ev.id)}${notify ? '?sendUpdates=all' : ''}`,
              { method: 'PATCH', body: patchBody },
            );
            summary.patched++;
            if (guests.changed && guestEmail) summary.invited++;
          }
        }
        // Delete tagged events no longer planned.
        //
        // Silently — `sendUpdates=none`. These deletions are overwhelmingly
        // bookkeeping, not a meeting being called off: this loop also sweeps
        // every PAST day (the listing reaches 28 days back while `desired` is
        // built today-forward), so each midnight retired yesterday's workout,
        // sauna and cooking events and mailed the guest a "Cancelled" for each
        // one — for events that had already happened. The hourly re-plan adds
        // more: a day whose category shifts is a delete plus a create under the
        // new (date, kind) key, not a rename.
        //
        // The guest's copy still disappears; Google removes it from their
        // calendar either way. All that's suppressed is the notification.
        for (const [key, ev] of existing) {
          if (!desired[key]) {
            await gcal(
              accessToken,
              `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ev.id)}?sendUpdates=none`,
              { method: 'DELETE' },
            );
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
