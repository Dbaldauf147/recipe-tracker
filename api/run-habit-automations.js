// GET /api/run-habit-automations — hourly cron (declared in vercel.json crons).
//
// The auto-logging ENGINE for the Habits "Automatic" tab. For every user that
// has authored automation rules (user-doc `habitAutomations`), each enabled
// rule is evaluated against that user's data for the current Eastern day AND
// the day before (a one-day look-back, so a late-day log or a missed hourly run
// still marks the day it belongs to). When the trigger is satisfied, the rule's
// habit is marked for that day's cadence period in `habitLog`.
//
// SOURCES:
//   - 'prepday'   → evaluated here (reads dailyLog / weightLog / workouts).
//   - 'rally'     → evaluated here by calling the Rally reach-out bridge
//                   (/api/reachout-export) once per run and comparing today's
//                   count to the rule threshold.
//   - 'gratitude' → evaluated here by calling the Gratitude bridge
//                   (/api/gratitude-today) once per run and comparing today's
//                   logged-gratitude count to the rule threshold.
//   - 'healthkit' → NOT evaluated: HealthKit data lives on the iOS device and
//                   isn't in Firestore yet. Needs the mobile HK→Firestore
//                   bridge before this cron can see it. Counted as unsupported.
//   - 'external'  → NOT evaluated here: those are pushed in by POST
//                   /api/habit-event (webhook receiver), not polled.
//
// SAFETY / IDEMPOTENCY:
//   - Only fills an EMPTY habitLog cell. Never overwrites a mark the user (or a
//     prior run) already set, so re-runs are no-ops and manual marks always win.
//   - Never shrinks habitLog: it reads the current map, adds keys, writes back.
//   - Natural opt-in: a user with no enabled prepday rules is skipped entirely.
//
// STORAGE (mirrors the app): habits, habitLog, habitAutomations, weightLog are
// fields on the main user doc users/{uid}; dailyLog is users/{uid}/data/dailyLog
// (.log map); workouts are docs under users/{uid}/workouts (v2, each has .date).
//
// Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. Manual runs
// need that header or ?secret=... . Add ?dryRun=1 to evaluate without writing.

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

const MAIN_SLOTS = ['breakfast', 'lunch', 'dinner'];
const VALID_MARKS = new Set(['exceeded', 'done', 'skipped', 'missed']);

const pad2 = (n) => String(n).padStart(2, '0');

// { dayOfWeek, dateKey, y, m, d } in America/New_York so the period we mark
// matches the app's local (Eastern) clock.
function eastern(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return {
    dayOfWeek: dow,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    y: Number(parts.year), m: Number(parts.month), d: Number(parts.day),
  };
}

// The Eastern day before `ref` (an eastern() result). Anchors at noon UTC of the
// ref date and steps back 24h so reformatting to Eastern can't slip across a day
// boundary on a DST transition.
function easternYesterday(ref) {
  const anchor = new Date(Date.UTC(ref.y, ref.m - 1, ref.d, 12));
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  return eastern(anchor);
}

// ISO-8601 week key, e.g. "2026-W25" — mirrors HabitsPage.isoWeekKey.
function isoWeekKeyFromYMD(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(week)}`;
}

// The habitLog bucket key for a habit's current cadence period — mirrors
// HabitsPage.periodKey, computed from the Eastern y/m/d.
function periodKeyFor(cadence, { y, m, d, dateKey }) {
  switch ((cadence || '').trim().toLowerCase()) {
    case 'weekly': return isoWeekKeyFromYMD(y, m, d);
    case 'monthly': return `${y}-${pad2(m)}`;
    case 'annually': return String(y);
    default: return dateKey; // daily
  }
}

// How many distinct main meal slots are accounted for on a day (logged,
// skipped, or the whole day marked not-tracked). Mirrors the "full day" rule.
function mainSlotsCovered(day) {
  if (day?.daySkipped) return 3;
  const covered = new Set();
  for (const e of (day?.entries || [])) {
    if (e?.mealSlot && MAIN_SLOTS.includes(e.mealSlot)) covered.add(e.mealSlot);
  }
  for (const s of (day?.skippedMeals || [])) {
    if (MAIN_SLOTS.includes(s)) covered.add(s);
  }
  return covered.size;
}

// Evaluate a single prepday trigger against the day's data. Returns true/false,
// or null when the trigger can't be evaluated server-side (custom, etc.).
function evalPrepdayTrigger(trigger, ctx) {
  const { day, weightLog, dateKey, workoutsForDay } = ctx;
  switch (trigger) {
    case 'meal_logged': return (day?.entries || []).length > 0;
    case 'all_meals_logged': return mainSlotsCovered(day) >= 3;
    case 'recipe_prepped': return Array.isArray(day?.cookRecipes) && day.cookRecipes.length > 0;
    case 'weighin_logged': return (weightLog || []).some(e => e && e.date === dateKey);
    case 'workout_logged': return (workoutsForDay?.() || []).length > 0;
    default: return null; // 'custom' / unknown → not machine-evaluable
  }
}

// Default goals — mirror REACH_OUT_GOAL / GRATITUDE_GOAL on the Habits page.
const REACH_OUT_GOAL = 2;
const GRATITUDE_GOAL = 3;

// Evaluate a Rally-source trigger. `reach` is { count } from Rally (or null if
// Rally couldn't be reached — caller treats that as unsupported, not "false").
function evalRallyTrigger(rule, reach) {
  if (rule.trigger === 'reach_out_goal') {
    const threshold = Number(rule.threshold) > 0 ? Number(rule.threshold) : REACH_OUT_GOAL;
    return reach.count >= threshold;
  }
  return null; // 'custom' / unknown → not machine-evaluable
}

// Evaluate a Gratitude-source trigger. `grat` is { count } from Gratitude (or
// null if unreachable — caller treats that as unsupported, not "false").
function evalGratitudeTrigger(rule, grat) {
  if (rule.trigger === 'gratitude_goal') {
    const threshold = Number(rule.threshold) > 0 ? Number(rule.threshold) : GRATITUDE_GOAL;
    return grat.count >= threshold;
  }
  return null; // 'custom' / unknown → not machine-evaluable
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.authorization || '';
    const query = req.query?.secret;
    const ok = header === `Bearer ${secret}` || query === secret;
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  }
  const dryRun = req.query?.dryRun === '1' || req.query?.dryRun === 'true';

  const when = eastern();
  // Process the current day, then backfill yesterday (one-day look-back) so a
  // late-day log or a missed hourly run still marks the day it belongs to. The
  // empty-cell guard keeps this safe: re-runs and manual marks are never touched.
  const DAYS = [when, easternYesterday(when)];
  const summary = {
    scanned: 0, usersWithRules: 0, usersMarked: 0, marksApplied: 0,
    rulesEvaluated: 0, triggersFired: 0, cellsAlreadySet: 0,
    unsupported: 0, dryRun,
  };

  // Rally reach-out count per date, fetched at most once per date per run (the
  // same baldaufdan account backs every rally rule) and cached by dateKey. A
  // cached `null` = fetch failed / not configured, else { count }.
  const _rallyReach = new Map();
  async function getRallyReach(dateKey) {
    if (_rallyReach.has(dateKey)) return _rallyReach.get(dateKey);
    let result = null;
    const key = (process.env.RALLY_EXPORT_KEY || '').trim();
    const base = process.env.RALLY_BASE_URL || 'https://rally-seven-theta.vercel.app';
    if (key) {
      try {
        const params = new URLSearchParams({ key, date: dateKey });
        const r = await fetch(`${base}/api/reachout-export?${params}`);
        const d = await r.json().catch(() => ({}));
        if (r.ok && typeof d.reachedTodayCount === 'number') result = { count: d.reachedTodayCount };
      } catch { /* leave null → rally rules counted as unsupported for this date */ }
    }
    _rallyReach.set(dateKey, result);
    return result;
  }

  // Gratitude logged-count per date, fetched at most once per date per run by
  // calling the Gratitude app's export directly with the shared secret, cached
  // by dateKey.
  const _gratitude = new Map();
  async function getGratitude(dateKey) {
    if (_gratitude.has(dateKey)) return _gratitude.get(dateKey);
    let result = null;
    const key = (process.env.GRATITUDE_EXPORT_KEY || '').trim();
    const base = process.env.GRATITUDE_BASE_URL || 'https://gratitude-website.vercel.app';
    if (key) {
      try {
        const params = new URLSearchParams({ key, date: dateKey });
        const r = await fetch(`${base}/api/gratitude-today?${params}`);
        const d = await r.json().catch(() => ({}));
        if (r.ok && typeof d.loggedCount === 'number') result = { count: d.loggedCount };
      } catch { /* leave null → gratitude rules counted as unsupported for this date */ }
    }
    _gratitude.set(dateKey, result);
    return result;
  }

  try {
    const snap = await db.collection('users').get();
    for (const docSnap of snap.docs) {
      summary.scanned++;
      const uid = docSnap.id;
      const data = docSnap.data() || {};

      const rules = (Array.isArray(data.habitAutomations) ? data.habitAutomations : [])
        .filter(r => r && r.enabled && ['prepday', 'rally', 'gratitude'].includes(r.source) && r.habitId);
      if (rules.length === 0) continue;
      summary.usersWithRules++;

      const habits = Array.isArray(data.habits) ? data.habits : [];
      const habitById = new Map(habits.map(h => [h.id, h]));
      const weightLog = Array.isArray(data.weightLog) ? data.weightLog : [];

      // dailyLog lives in its own subcollection doc — load the whole day map
      // once; we index into it per processed day (today + yesterday).
      let logMap = {};
      try {
        const lSnap = await db.doc(`users/${uid}/data/dailyLog`).get();
        logMap = lSnap.exists ? (lSnap.data().log || {}) : {};
      } catch { /* treat as no data */ }

      // Workouts are only needed if a rule uses them — fetch once for the days
      // we're processing and group by dateKey.
      const workoutsByDate = {};
      if (rules.some(r => r.trigger === 'workout_logged')) {
        try {
          const wSnap = await db.collection(`users/${uid}/workouts`)
            .where('date', 'in', DAYS.map(dd => dd.dateKey)).get();
          for (const wd of wSnap.docs) {
            const w = wd.data();
            (workoutsByDate[w.date] = workoutsByDate[w.date] || []).push(w);
          }
        } catch { /* leave empty → workout rules see no workouts */ }
      }

      // Work on a clone of habitLog; only fill empty cells. `habitLogAuto`
      // mirrors habitLog and records the mark the engine wrote, so the UI can
      // badge auto-set cells with "(A)". Comparing habitLogAuto[k][id] to the
      // live habitLog value means a hand-edit/erase self-clears the badge.
      const habitLog = (data.habitLog && typeof data.habitLog === 'object') ? data.habitLog : {};
      const nextLog = { ...habitLog };
      const habitLogAuto = (data.habitLogAuto && typeof data.habitLogAuto === 'object') ? data.habitLogAuto : {};
      const nextAuto = { ...habitLogAuto };
      let changed = 0;

      // Today first, then yesterday. Each day fills its own cadence-period cell
      // from that day's data; the empty-cell guard makes both passes idempotent.
      for (const dayCtx of DAYS) {
        const day = logMap[dayCtx.dateKey] || null;
        const workoutsForDay = () => workoutsByDate[dayCtx.dateKey] || [];
        const ctx = { day, weightLog, dateKey: dayCtx.dateKey, workoutsForDay };

        for (const rule of rules) {
          summary.rulesEvaluated++;
          const habit = habitById.get(rule.habitId);
          if (!habit) continue; // habit deleted → skip
          let fired;
          if (rule.source === 'rally') {
            const reach = await getRallyReach(dayCtx.dateKey);
            fired = reach ? evalRallyTrigger(rule, reach) : null; // null → Rally unreachable
          } else if (rule.source === 'gratitude') {
            const grat = await getGratitude(dayCtx.dateKey);
            fired = grat ? evalGratitudeTrigger(rule, grat) : null; // null → Gratitude unreachable
          } else {
            fired = evalPrepdayTrigger(rule.trigger, ctx);
          }
          if (fired === null) { summary.unsupported++; continue; }
          if (!fired) continue;
          summary.triggersFired++;

          const mark = VALID_MARKS.has(rule.mark) ? rule.mark : 'done';
          const key = periodKeyFor(habit.cadence, dayCtx);
          const bucket = { ...(nextLog[key] || {}) };
          if (bucket[rule.habitId] !== undefined) { summary.cellsAlreadySet++; continue; }
          bucket[rule.habitId] = mark;
          nextLog[key] = bucket;
          nextAuto[key] = { ...(nextAuto[key] || {}), [rule.habitId]: mark };
          changed++;
        }
      }

      if (changed === 0) continue;
      summary.marksApplied += changed;
      summary.usersMarked++;

      if (!dryRun) {
        try {
          await docSnap.ref.update({ habitLog: nextLog, habitLogAuto: nextAuto });
        } catch (err) {
          summary.errors = summary.errors || [];
          summary.errors.push({ uid, err: err.message });
        }
      }
    }
    return res.status(200).json({ ok: true, dateKey: when.dateKey, ...summary });
  } catch (err) {
    console.error('run-habit-automations fatal:', err);
    return res.status(500).json({ error: err.message, partial: summary });
  }
}
