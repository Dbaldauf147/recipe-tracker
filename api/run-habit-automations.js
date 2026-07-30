// GET /api/run-habit-automations — hourly cron (declared in vercel.json crons).
//
// The auto-logging ENGINE for the Habits "Automatic" tab. For every user that
// has authored automation rules (user-doc `habitAutomations`), each enabled
// rule is evaluated against that user's data for the current Eastern day AND
// the day before (a one-day look-back, so a late-day log or a missed hourly run
// still marks the day it belongs to). When the trigger is satisfied, the rule's
// habit is marked for that day's cadence period in `habitLog`.
//
// REST-DAY / "otherwise" MARK: a daily rule may set `elseMark` — the mark to
// apply when the trigger did NOT fire on a day that's already over (the
// look-back day). e.g. a "workout logged → Did it" rule with elseMark 'skipped'
// auto-logs a rest day (no workout) as a Skip. Normally never applied to today
// (activity may still come) or to non-daily cadences (a past day isn't a
// finished period).
//
// STREAK / "two days in a row" MARK: one day off is a rest day, two or more in
// a row is a gap. When a daily prepday rule's trigger didn't fire on a finished
// day AND it also didn't fire the day BEFORE it, the rule's `streakMark` wins
// over `elseMark` — so the 2nd (and 3rd, 4th…) day of a no-workout run is
// marked "No" (✕) instead of Skip. Unset on a workout_logged rule = 'missed'
// (the behaviour the user asked for); '' / 'none' turns it off. Only ever
// applied to a day that's already over — today can still turn into a workout,
// planned rest day or not. Also applies with no elseMark set at all.
//
// PLANNED REST DAYS: the ONE exception to "never today". The Week Plan writes
// the dates it resolved to Rest into the user doc's `plannedRestDates` (see
// WeekPlanPage) — the suggestion depends on staleness ranking + per-day
// overrides, which this cron can't recompute. A `workout_logged` rule whose
// date is on that list is a DECIDED rest day, not a day still waiting for a
// workout, so its skip is applied the same day. Note a sauna-only placeholder
// workout (no exercises, no type) is ignored below so it can't mask a rest day.
// Because that skip is a guess made BEFORE the day happened, it is provisional:
// if a workout of any kind is logged afterwards — a yoga session, a cardio day,
// an unplanned lift — the skip is replaced by the rule's mark (the ✓). That
// correction runs for today/yesterday in the main loop and, for days already
// past, in the workout backfill over the last WORKOUT_BACKFILL_DAYS.
//
// SOURCES:
//   - 'prepday'   → evaluated here (reads dailyLog / weightLog / workouts).
//   - 'rally'     → evaluated here by calling the Rally reach-out bridge
//                   (/api/reachout-export) once per run and comparing today's
//                   count to the rule threshold.
//   - 'gratitude' → evaluated here by calling the Gratitude bridge
//                   (/api/gratitude-today) once per run and comparing today's
//                   logged-gratitude count to the rule threshold.
//   - 'healthkit' → mostly NOT evaluated: HealthKit data lives on the iOS
//                   device and isn't in Firestore yet. Needs the mobile
//                   HK→Firestore bridge before this cron can see it. Counted as
//                   unsupported. The ONE exception is 'hk_workout': a workout
//                   logged in Prep Day itself is proof a workout happened, so
//                   that trigger falls back to the same workout history
//                   'workout_logged' reads and is treated as a workout rule
//                   throughout (planned-rest days, streak mark, backfill).
//                   Metric triggers (steps, sleep, mindful minutes…) have no
//                   such stand-in and stay unsupported.
//   - 'external'  → NOT evaluated here: those are pushed in by POST
//                   /api/habit-event (webhook receiver), not polled.
//
// SAFETY / IDEMPOTENCY:
//   - Only fills an EMPTY habitLog cell, with one exception: a cell THIS ENGINE
//     wrote and that still holds exactly what we recorded may be corrected — a
//     provisional rest-day Skip becomes the ✓ once the workout is logged, or the
//     ✕ once it's day 2+ of a gap. A mark you set (or edited) is never touched,
//     so re-runs are no-ops and manual marks always win.
//   - RESPECTS MANUAL ERASES: if the engine auto-set a cell before (it's still
//     recorded in habitLogAuto) but the cell is now empty in habitLog, the user
//     cleared it on purpose — so we leave it empty instead of refilling it every
//     hour. Each new period (week/month/…) starts fresh, so auto-logging still
//     fires next period unless that cell is erased too.
//   - Never shrinks habitLog: it reads the current map, adds keys, writes back.
//   - Natural opt-in: a user with no enabled prepday rules is skipped entirely.
//
// STORAGE (mirrors the app): habits, habitAutomations, weightLog are fields on
// the main user doc users/{uid}; habitLog AND habitLogAuto are one document per
// calendar year at users/{uid}/{field}/{YYYY} (see api/_data/habitLogYears.js —
// habitLog outgrew the user doc's index limit and its auto mirror was on the same
// trajectory); dailyLog is users/{uid}/data/dailyLog (.log map); workouts are
// docs under users/{uid}/workouts (v2, each has .date).
//
// Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. Manual runs
// need that header or ?secret=... . Add ?dryRun=1 to evaluate without writing.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  loadHabitLogAdmin, saveHabitLogYearsAdmin,
  loadHabitLogAutoAdmin, saveHabitLogAutoYearsAdmin,
  yearsForKeys,
} from './_data/habitLogYears.js';

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

// Human-readable status recorded per auto-evaluated cell so the app can show,
// on hover, WHY a habit was or wasn't auto-recorded for that period.
const STATUS_KEEP_DAYS = 90;
const MARK_LABELS = { exceeded: 'Exceeded', done: 'Did it', skipped: 'Skipped', missed: 'Missed' };
const markLabel = (m) => MARK_LABELS[m] || m;
const srcLabel = (s) => (s === 'rally' ? 'Rally' : s === 'gratitude' ? 'Gratitude' : 'the source');
// Positive/negative phrasing for each trigger, used to build the reason string.
function triggerPhrasing(rule) {
  switch (rule.trigger) {
    case 'meal_logged': return { pos: 'A meal was logged', neg: 'No meal was logged', noun: 'meals' };
    case 'all_meals_logged': return { pos: 'All 3 meals were logged', neg: 'Not all meals were logged', noun: 'meals' };
    case 'recipe_prepped': return { pos: 'A planned recipe was prepped', neg: 'No recipe was prepped', noun: 'meal prep' };
    case 'weighin_logged': return { pos: 'A weigh-in was recorded', neg: 'No weigh-in was recorded', noun: 'weigh-ins' };
    case 'workout_logged': return { pos: 'A workout was logged', neg: 'No workout was logged', noun: 'workouts' };
    // An Apple Health workout rule is answered from Prep Day's own history (see
    // isWorkoutTrigger), so the reason string says where the answer came from
    // rather than implying HealthKit was read.
    case 'hk_workout': return { pos: 'A workout was logged in Prep Day', neg: 'No workout was logged in Prep Day', noun: 'workouts' };
    case 'reach_out_goal': return { pos: 'Reach-out goal met', neg: "Reach-out goal wasn't met", noun: 'reach-outs' };
    case 'gratitude_goal': return { pos: 'Gratitude goal met', neg: "Gratitude goal wasn't met", noun: 'gratitude entries' };
    default: return { pos: 'Trigger met', neg: 'Trigger not met', noun: 'this' };
  }
}

/**
 * Rules answered by "was a workout logged that day?".
 *
 * 'hk_workout' is in here because HealthKit can't be read server-side, and a
 * workout sitting in Prep Day's own history is proof the workout happened —
 * the fallback the whole rule would otherwise sit unevaluated without. Once a
 * rule counts as a workout rule it gets ALL of that behaviour, not just the
 * trigger: planned-rest days apply their skip immediately, an unset streakMark
 * defaults to ✕, and the backfill below repairs a Skip a later workout
 * disproved.
 */
function isWorkoutTrigger(rule) {
  return rule?.trigger === 'workout_logged' || rule?.trigger === 'hk_workout';
}

// The mark for a day that's part of a 2+-day run of "trigger never fired" — a
// gap rather than a single rest day. Rule field `streakMark`:
//   undefined (never configured) → 'missed' for workout rules, off otherwise
//   'exceeded'|'done'|'skipped'|'missed' → that mark
//   '' / 'none' / anything else → off (the plain elseMark applies instead)
function streakMarkFor(rule) {
  if (rule.streakMark === undefined) {
    return isWorkoutTrigger(rule) ? 'missed' : null;
  }
  return VALID_MARKS.has(rule.streakMark) ? rule.streakMark : null;
}

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

// How far back the workout backfill looks. A rest-day Skip written before the
// workout happened stays wrong forever otherwise — the main loop only ever
// touches today and yesterday.
const WORKOUT_BACKFILL_DAYS = 28;

// The Eastern date keys for the backfill window, most recent first.
function backfillDateKeys(ref) {
  const out = [];
  for (let i = 0; i < WORKOUT_BACKFILL_DAYS; i++) {
    const anchor = new Date(Date.UTC(ref.y, ref.m - 1, ref.d - i, 12));
    out.push(eastern(anchor).dateKey);
  }
  return out;
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

// Sunday-anchored WEEK KEY — mirrors HabitsPage.weekKey. Keeps the "YYYY-Www"
// format but groups a Sunday→Saturday week into one key (ISO week of the day
// AFTER), so a Sunday weigh-in counts for the week it STARTS. Aligns weekly
// habits with the app's Sun–Sat weeks (Week Plan).
function sundayWeekKeyFromYMD(y, m, d) {
  const nx = new Date(Date.UTC(y, m - 1, d + 1)); // day after (handles month/year rollover)
  return isoWeekKeyFromYMD(nx.getUTCFullYear(), nx.getUTCMonth() + 1, nx.getUTCDate());
}
// Sunday-week key for a 'YYYY-MM-DD' date string.
function weekKeyOfDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return sundayWeekKeyFromYMD(y, m, d);
}

// The habitLog bucket key for a habit's current cadence period — mirrors
// HabitsPage.periodKey, computed from the Eastern y/m/d.
function periodKeyFor(cadence, { y, m, d, dateKey }) {
  switch ((cadence || '').trim().toLowerCase()) {
    case 'weekly': return sundayWeekKeyFromYMD(y, m, d);
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
// `habit` lets period-spanning cadences scan their whole period: a WEEKLY
// weigh-in habit counts if ANY weigh-in falls in the Sun–Sat week (not just the
// exact processed day) — matching "scan the whole week for a weigh-in".
function evalPrepdayTrigger(trigger, ctx, habit) {
  const { day, weightLog, dateKey, workoutsForDay } = ctx;
  const cadence = (habit?.cadence || '').trim().toLowerCase();
  switch (trigger) {
    case 'meal_logged': return (day?.entries || []).length > 0;
    case 'all_meals_logged': return mainSlotsCovered(day) >= 3;
    case 'recipe_prepped': return Array.isArray(day?.cookRecipes) && day.cookRecipes.length > 0;
    case 'weighin_logged': {
      if (cadence === 'weekly') {
        const wk = weekKeyOfDate(dateKey);
        return (weightLog || []).some(e => e?.date && weekKeyOfDate(e.date) === wk);
      }
      return (weightLog || []).some(e => e && e.date === dateKey);
    }
    case 'workout_logged':
    // Apple Health can't be read here; a Prep Day workout stands in for it.
    // falls through
    case 'hk_workout':
      return (workoutsForDay?.() || []).length > 0;
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
    rulesEvaluated: 0, triggersFired: 0, elseMarksApplied: 0, streakMarksApplied: 0,
    cellsAlreadySet: 0, erasesRespected: 0, unsupported: 0, dryRun,
  };
  // dryRun-only: per-evaluation breakdown + the planned rest dates we read, so a
  // "why didn't it mark?" question can be answered without guessing.
  if (dryRun) { summary.details = []; summary.plannedRestDatesSeen = {}; }

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
      // we're processing PLUS one extra day back (the streak check asks whether
      // the day before a finished day also had no workout) and group by dateKey.
      // The window is widened to WORKOUT_BACKFILL_DAYS so the backfill below can
      // repair older days whose rest-day skip a workout has since disproved.
      const workoutsByDate = {};
      if (rules.some(isWorkoutTrigger)) {
        const wantDates = [...new Set([
          ...[...DAYS, easternYesterday(DAYS[DAYS.length - 1])].map(dd => dd.dateKey),
          ...backfillDateKeys(when),
        ])];
        try {
          const wSnap = { docs: [] };
          // `in` takes at most 30 values, so the window goes out in chunks.
          for (let i = 0; i < wantDates.length; i += 30) {
            const chunk = await db.collection(`users/${uid}/workouts`)
              .where('date', 'in', wantDates.slice(i, i + 30)).get();
            wSnap.docs.push(...chunk.docs);
          }
          for (const wd of wSnap.docs) {
            const w = wd.data();
            // A sauna-only day is a placeholder carrying just the `sauna` flag —
            // no exercises, no workout type. It isn't a workout, so it must not
            // mask a rest day (mirrors WeekPlanPage.buildWorkoutsByDate).
            const hasEntries = Array.isArray(w.entries) && w.entries.length > 0;
            const hasType = String(w.workoutType || '').trim().length > 0;
            if (!hasEntries && !hasType) continue;
            (workoutsByDate[w.date] = workoutsByDate[w.date] || []).push(w);
          }
        } catch { /* leave empty → workout rules see no workouts */ }
      }

      // Dates the Week Plan resolved to REST (written by WeekPlanPage). A day on
      // this list is a decided rest day, so the rest-day skip can apply the same
      // day instead of waiting for the day to be over.
      const plannedRestDates = new Set(
        Array.isArray(data.plannedRestDates) ? data.plannedRestDates : [],
      );
      if (dryRun) {
        summary.plannedRestDatesSeen[uid] = Array.isArray(data.plannedRestDates)
          ? data.plannedRestDates : '(field missing)';
      }

      // Work on a clone of habitLog; only fill empty cells. `habitLogAuto`
      // mirrors habitLog and records the mark the engine wrote, so the UI can
      // badge auto-set cells with "(A)". Comparing habitLogAuto[k][id] to the
      // live habitLog value means a hand-edit/erase self-clears the badge.
      // The marks live in users/{uid}/habitLog/{YYYY}. loadHabitLogAdmin also
      // folds in the legacy user-doc field for anyone who hasn't opened the app
      // since the move, so the engine never evaluates against an empty history
      // and re-fills cells the user already marked.
      const habitLog = await loadHabitLogAdmin(db, uid, data);
      const nextLog = { ...habitLog };
      // habitLogAuto moved out of the user doc the same way, for the same reason
      // — it mirrors habitLog cell for cell, so it was on the same trajectory.
      const habitLogAuto = await loadHabitLogAutoAdmin(db, uid, data);
      const nextAuto = { ...habitLogAuto };
      let changed = 0;

      // Per-cell auto-status ("why it was / wasn't recorded"), stored in its own
      // subcollection doc to keep the user doc lean. Preserve prior runs' entries
      // (older cells stay explained) and prune anything past STATUS_KEEP_DAYS.
      let autoStatus = {};
      try {
        const sSnap = await db.doc(`users/${uid}/data/habitAutoStatus`).get();
        autoStatus = sSnap.exists ? (sSnap.data().status || {}) : {};
      } catch { autoStatus = {}; }
      const nextStatus = JSON.parse(JSON.stringify(autoStatus));
      // Today is processed before yesterday; for non-daily cadences both map to
      // the same period key, so this set keeps today's (fresher) status.
      const statusTouched = new Set();
      const nowIso = new Date().toISOString();

      // Today first, then yesterday. Each day fills its own cadence-period cell
      // from that day's data; the empty-cell guard makes both passes idempotent.
      for (const dayCtx of DAYS) {
        const day = logMap[dayCtx.dateKey] || null;
        const workoutsForDay = () => workoutsByDate[dayCtx.dateKey] || [];
        const ctx = { day, weightLog, dateKey: dayCtx.dateKey, workoutsForDay };
        // Same context for the day BEFORE this one, so a rule can tell a single
        // rest day from the 2nd+ day of a gap (streakMarkFor).
        const prevDay = easternYesterday(dayCtx);
        const prevCtx = {
          day: logMap[prevDay.dateKey] || null,
          weightLog,
          dateKey: prevDay.dateKey,
          workoutsForDay: () => workoutsByDate[prevDay.dateKey] || [],
        };

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
            fired = evalPrepdayTrigger(rule.trigger, ctx, habit);
          }
          const key = periodKeyFor(habit.cadence, dayCtx);
          const cadence = (habit.cadence || '').trim().toLowerCase();
          const isDaily = !['weekly', 'monthly', 'annually'].includes(cadence);
          const dayIsOver = dayCtx.dateKey !== when.dateKey; // look-back day, not today
          const phr = triggerPhrasing(rule);

          // A workout day the Week Plan resolved to REST is a decision, not a
          // day still waiting for activity — so its skip applies immediately,
          // today included, rather than waiting for the day to be over.
          const plannedRest = isWorkoutTrigger(rule)
            && plannedRestDates.has(dayCtx.dateKey);

          // ?dryRun=1 returns a per-evaluation breakdown so it's possible to see
          // exactly which guard a rule hit without writing anything.
          const detail = dryRun ? {
            habit: habit.name || habit.habit || rule.habitId,
            cadence: habit.cadence || '(daily)', habitStatus: habit.status || '',
            source: rule.source, trigger: rule.trigger,
            mark: rule.mark, elseMark: rule.elseMark ?? null, streakMark: streakMarkFor(rule),
            day: dayCtx.dateKey, isDaily, dayIsOver, plannedRest,
          } : null;
          const emit = (outcome) => {
            if (!detail) return;
            detail.fired = fired;
            detail.outcome = outcome;
            summary.details.push(detail);
          };

          // Records the "why" for this cell unless today already wrote it (today
          // runs first, so its status wins for a shared non-daily period key).
          const recordStatus = (reason) => {
            const tk = `${key}|${rule.habitId}`;
            if (statusTouched.has(tk)) return;
            statusTouched.add(tk);
            nextStatus[key] = { ...(nextStatus[key] || {}), [rule.habitId]: { reason, source: rule.source, trigger: rule.trigger, day: dayCtx.dateKey, at: nowIso } };
          };

          // Trigger couldn't be evaluated (source unreachable / custom rule).
          if (fired === null) {
            summary.unsupported++;
            recordStatus(rule.source === 'rally' || rule.source === 'gratitude'
              ? `Couldn't reach ${srcLabel(rule.source)} to check ${phr.noun}`
              : `${phr.noun === 'this' ? 'This trigger' : phr.noun} can't be auto-checked`);
            emit('unsupported');
            continue;
          }

          // The mark to write. A fired trigger uses the rule's mark. If it did
          // NOT fire, a daily rule with an `elseMark` (e.g. "rest day → Skip")
          // marks the elseMark instead — but ONLY for a day that's already over
          // (the look-back day, never today), since today's workout/meal/etc.
          // may still be logged later. Non-daily cadences are skipped: a single
          // past day isn't a finished week/month, so "no trigger yet" ≠ missed.
          //
          // Two finished days in a row with nothing logged beat the elseMark:
          // that's a gap, not a rest day, so `streakMark` (✕ No, by default, for
          // a workout rule) applies instead — even when no elseMark is set.
          let mark;
          let isStreak = false;
          if (fired) {
            summary.triggersFired++;
            mark = VALID_MARKS.has(rule.mark) ? rule.mark : 'done';
          } else {
            const streak = (isDaily && dayIsOver && rule.source === 'prepday'
              && streakMarkFor(rule)
              && evalPrepdayTrigger(rule.trigger, prevCtx, habit) === false)
              ? streakMarkFor(rule) : null;
            if (streak) {
              mark = streak;
              isStreak = true;
              summary.streakMarksApplied++;
              if (detail) detail.streakApplied = true;
            } else if (isDaily && (dayIsOver || plannedRest) && VALID_MARKS.has(rule.elseMark)) {
              mark = rule.elseMark;
              summary.elseMarksApplied++;
              if (plannedRest && !dayIsOver) summary.plannedRestMarks = (summary.plannedRestMarks || 0) + 1;
            } else {
              recordStatus(dayIsOver ? `${phr.neg} → not recorded` : `${phr.neg} yet — this ${isDaily ? 'day' : 'period'} isn't over`);
              emit(!isDaily ? 'else-skipped:not-daily'
                : !VALID_MARKS.has(rule.elseMark) ? 'else-skipped:no-elseMark'
                : 'else-skipped:day-not-over-and-not-planned-rest');
              continue;
            }
          }

          const isElse = !fired;
          const restNote = !isElse ? '' : isStreak ? ' (2 days in a row)' : plannedRest ? ' (planned rest day)' : ' (rest day)';
          const elseReason = isStreak
            ? `${phr.neg} the day before either → ${markLabel(mark)}${restNote}`
            : `${isElse ? phr.neg : phr.pos} → ${markLabel(mark)}${restNote}`;
          const bucket = { ...(nextLog[key] || {}) };
          if (bucket[rule.habitId] !== undefined) {
            const current = bucket[rule.habitId];
            const wasAuto = habitLogAuto[key]?.[rule.habitId] !== undefined;
            // A cell WE auto-set that still matches what we recorded — the user
            // hasn't touched it, so we're allowed to correct our own guess.
            const untouched = wasAuto && habitLogAuto[key][rule.habitId] === current && current !== mark;
            // (1) We now know the day was day 2+ of a gap. Without this a Skip
            //     written earlier — e.g. the same-day planned-rest skip — would
            //     keep the ✕ from ever landing.
            const canEscalate = isStreak && untouched;
            // (2) The activity ACTUALLY HAPPENED after we wrote a negative mark.
            //     The planned-rest skip is applied same-day, before the day is
            //     over, so a yoga/cardio/gym session logged later that afternoon
            //     must replace it with the ✓ — the plan said rest, the day says
            //     otherwise, and what happened wins.
            const canPromote = fired && untouched;
            if (!canEscalate && !canPromote) {
              summary.cellsAlreadySet++;
              recordStatus(wasAuto ? elseReason : 'You recorded this yourself');
              emit(`cell-already-set:${JSON.stringify(current)}${wasAuto ? ' (auto)' : ' (manual)'}`);
              continue;
            }
            if (canPromote) summary.promotions = (summary.promotions || 0) + 1;
            else summary.streakEscalations = (summary.streakEscalations || 0) + 1;
          } else if (habitLogAuto[key]?.[rule.habitId] !== undefined) {
            // Respect a manual erase: an empty cell that the engine previously
            // auto-set (still recorded in the persisted habitLogAuto) was cleared
            // by the user on purpose — don't refill it. `habitLogAuto` is the
            // original persisted map, so this only catches erases from prior runs.
            summary.erasesRespected++;
            recordStatus('You cleared this — left empty');
            emit('erase-respected');
            continue;
          }
          bucket[rule.habitId] = mark;
          nextLog[key] = bucket;
          nextAuto[key] = { ...(nextAuto[key] || {}), [rule.habitId]: mark };
          recordStatus(elseReason);
          emit(`APPLIED:${mark}`);
          changed++;
        }
      }

      // Weekly weigh-in backfill: the Sun–Sat re-anchoring shifted weekly keys,
      // so reconstruct the last 10 weeks' cells from the weightLog. Fills only
      // empty, non-erased cells (respecting manual marks + erases), so it's
      // idempotent and self-heals the history under the new keys. Bounded to the
      // recent window shown in the strip.
      for (const rule of rules) {
        if (rule.trigger !== 'weighin_logged') continue;
        const habit = habitById.get(rule.habitId);
        if (!habit || (habit.cadence || '').trim().toLowerCase() !== 'weekly') continue;
        const mark = VALID_MARKS.has(rule.mark) ? rule.mark : 'done';
        const weeksWithWeigh = new Set();
        for (const e of weightLog) { if (e?.date) weeksWithWeigh.add(weekKeyOfDate(e.date)); }
        for (let i = 0; i < 10; i++) {
          const dd = new Date(Date.UTC(when.y, when.m - 1, when.d - i * 7));
          const wk = sundayWeekKeyFromYMD(dd.getUTCFullYear(), dd.getUTCMonth() + 1, dd.getUTCDate());
          if (!weeksWithWeigh.has(wk)) continue;
          const bucket = { ...(nextLog[wk] || {}) };
          if (bucket[rule.habitId] !== undefined) continue;          // manual / already set
          if (habitLogAuto[wk]?.[rule.habitId] !== undefined) continue; // respect erase
          bucket[rule.habitId] = mark;
          nextLog[wk] = bucket;
          nextAuto[wk] = { ...(nextAuto[wk] || {}), [rule.habitId]: mark };
          changed++;
        }
      }

      // Workout backfill: a day the plan called Rest gets its Skip written that
      // same morning, before the day has happened. If a workout was logged after
      // that — a yoga session, a cardio day, an unplanned lift — the Skip is
      // simply wrong, and the main loop above only ever revisits today and
      // yesterday. So walk the recent window and repair those days: promote our
      // own Skip/✕ to the rule's mark wherever a workout exists, and fill cells
      // that were never marked at all. Manual marks and manual erases are left
      // exactly as they are, same as everywhere else in this engine.
      for (const rule of rules) {
        if (!isWorkoutTrigger(rule)) continue;
        const habit = habitById.get(rule.habitId);
        if (!habit) continue;
        // Daily only: a weekly/monthly cell spans days, so "this day had a
        // workout" doesn't tell us the whole period's mark is wrong.
        if (['weekly', 'monthly', 'annually'].includes((habit.cadence || '').trim().toLowerCase())) continue;
        const mark = VALID_MARKS.has(rule.mark) ? rule.mark : 'done';
        for (const dk of backfillDateKeys(when)) {
          if (!(workoutsByDate[dk] || []).length) continue; // no workout that day
          const bucket = { ...(nextLog[dk] || {}) };
          const current = bucket[rule.habitId];
          if (current === mark) continue;                                  // already right
          const autoMark = habitLogAuto[dk]?.[rule.habitId];
          if (current === undefined) {
            if (autoMark !== undefined) continue;   // you cleared it — leave it empty
          } else if (autoMark === undefined || autoMark !== current) {
            continue;                               // your mark, or one you edited — never touch
          }
          bucket[rule.habitId] = mark;
          nextLog[dk] = bucket;
          nextAuto[dk] = { ...(nextAuto[dk] || {}), [rule.habitId]: mark };
          summary.workoutBackfills = (summary.workoutBackfills || 0) + 1;
          changed++;
        }
      }

      // Prune status entries older than the retention window so the doc stays
      // bounded (drop stale cells; drop a period key once it's fully empty).
      const cutoffIso = new Date(Date.now() - STATUS_KEEP_DAYS * 86400000).toISOString();
      for (const k of Object.keys(nextStatus)) {
        const bucket = nextStatus[k];
        for (const hid of Object.keys(bucket)) {
          if (!bucket[hid]?.at || bucket[hid].at < cutoffIso) delete bucket[hid];
        }
        if (Object.keys(bucket).length === 0) delete nextStatus[k];
      }
      const statusChanged = JSON.stringify(nextStatus) !== JSON.stringify(autoStatus);

      if (changed > 0) { summary.marksApplied += changed; summary.usersMarked++; }
      if (changed === 0 && !statusChanged) continue;

      if (!dryRun) {
        try {
          if (changed > 0) {
            // Only the years the engine actually touched get rewritten. Writing
            // habitLog back onto the user doc would recreate the field whose
            // index entries were rejecting every write to that document.
            const touchedKeys = Object.keys(nextLog).filter(k => nextLog[k] !== habitLog[k]);
            await saveHabitLogYearsAdmin(db, uid, nextLog, yearsForKeys(touchedKeys));
            // Same treatment for the auto mirror — writing it back onto the user
            // doc would have re-added a field that grows one entry per auto-set
            // cell, which is the same slow march toward the index limit.
            const touchedAutoKeys = Object.keys(nextAuto).filter(k => nextAuto[k] !== habitLogAuto[k]);
            await saveHabitLogAutoYearsAdmin(db, uid, nextAuto, yearsForKeys(touchedAutoKeys));
          }
          if (statusChanged) {
            await db.doc(`users/${uid}/data/habitAutoStatus`).set({ status: nextStatus, updatedAt: nowIso }, { merge: false });
          }
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
