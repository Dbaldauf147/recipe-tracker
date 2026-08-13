// Count of habits still "outstanding" — i.e. that need logging for their
// current period right now. Used for the left-nav red count badge.
//
// ⚠️ MIRRORS the Habits page's `totalUnlogged` (src/components/HabitsPage.jsx:
// `groups` + `cadenceUnlogged.manual`) so the badge equals the red number shown
// on the Habits "All" tab — MANUAL habits only; rule-automated ones are the grey
// `countAutoPendingHabits` half. The tracking helpers below are copied from
// HabitsPage — keep them in sync if that logic changes (per-weekday trackDays,
// per-habit weekly weekDays, Sunday-anchored week key, excluded statuses).

const pad2 = (n) => String(n).padStart(2, '0');

export function cadenceCanon(c) {
  const x = (c || '').trim().toLowerCase();
  if (x === 'weekly') return 'Weekly';
  if (x === 'monthly') return 'Monthly';
  if (x === 'annually') return 'Annually';
  return 'Daily';
}

export function dayKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// ISO-8601 week key (week starts Monday), e.g. "2026-W25".
function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(week)}`;
}

// Sunday-anchored week key (Sun..Sat map to one key) — matches HabitsPage.
function weekKey(d) {
  return isoWeekKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
}

/**
 * The habitLog key for the period a date falls in, per cadence. Exported
 * because anything that marks a habit from OUTSIDE the Habits page (the stretch
 * player logging its linked habit) has to write the same cell HabitsPage reads.
 */
export function periodKey(cadence, date = new Date()) {
  switch (cadenceCanon(cadence)) {
    case 'Weekly': return weekKey(date);
    case 'Monthly': return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
    case 'Annually': return String(date.getFullYear());
    default: return dayKey(date);
  }
}

const WD_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

// Daily per-weekday tracking (`trackDays`): a Daily habit tracked only on those
// weekdays. Non-daily cadences track every period.
function habitTrackDays(h) {
  const t = h?.trackDays;
  return Array.isArray(t) && t.length > 0 ? t : ALL_WEEKDAYS;
}
export function tracksDate(h, date = new Date()) {
  if (cadenceCanon(h?.cadence) !== 'Daily') return true;
  return habitTrackDays(h).includes(date.getDay());
}

// Weekly per-habit pinned day (`weekDays`): the habit isn't "due" until its
// day of the week arrives. Not pinned → due all week (legacy default).
export function habitWeekDays(h) {
  return (cadenceCanon(h?.cadence) === 'Weekly' && Array.isArray(h?.weekDays) && h.weekDays.length)
    ? h.weekDays : null;
}
function weeklyDueYet(h, date = new Date()) {
  const own = habitWeekDays(h);
  if (!own) return true;
  const idxs = own.map(d => WD_NAMES.indexOf(d)).filter(n => n >= 0);
  if (!idxs.length) return true;
  return date.getDay() >= Math.max(...idxs);
}

// Statuses excluded from the outstanding count (parked, auto-tracked, or not
// yet started). Must match HabitsPage's `groups`, which skips PARKED_STATUSES
// (On Hold / Abandoned) plus 'Not Started' / 'Havent Started', and whose
// cadenceUnlogged loop skips 'Automatically' — so totalUnlogged and this badge
// agree. Without the two not-started statuses the nav badge over-counts every
// imported-but-not-yet-started habit.
export const EXCLUDED_STATUSES = new Set(['On Hold', 'Abandoned', 'Automatically', 'Not Started', 'Havent Started']);

// ---- "Yesterday never got logged" — a different warning from the counts above ----
// The outstanding count nags about a period still IN PROGRESS; this one is about
// a day that is OVER, so an empty cell is a permanent gap in the record unless
// it gets backfilled. Deliberately narrow so the banner means one thing:
//   • DAILY cadence only — a weekly/monthly/yearly period spanning yesterday
//     isn't over, so it can't have been "missed yesterday".
//   • Strictly yesterday. Older gaps belong to HabitsPage's 7-day past-due card.
//   • Off-days (trackDays) don't count — the habit wasn't due yesterday.
//   • Parked / auto-tracked habits are excluded, same as the badge.
//   • A habit with no daily history at or before yesterday reads as NEW, not
//     missed (same first-log anchor as HabitsPage's habitPastDue), so a habit
//     added today never nags about a day it didn't exist for.
// ⚠️ MIRRORS PrepDay/src/utils/habitTracking.ts `yesterdayUnloggedHabits` — keep
// the two in sync so both apps warn about exactly the same habits.
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local-midnight Date for yesterday (never UTC — habit day keys are local). */
export function yesterdayDate(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
}

/** The habitLog day key ("YYYY-MM-DD") a yesterday backfill writes to. */
export function yesterdayDayKey(now = new Date()) {
  return dayKey(yesterdayDate(now));
}

/**
 * The Daily habits that were due yesterday and never got a mark.
 * @param {Array} habits    the user's `habits` array
 * @param {Object} habitLog the user's `habitLog` map (periodKey -> {habitId: mark})
 * @param {Array} [automations] the user's `habitAutomations` rules
 * @param {Date} [now]
 * @returns {Array} the habit objects, in `habits` order
 */
export function yesterdayUnloggedHabits(habits, habitLog, automations, now = new Date()) {
  if (!Array.isArray(habits)) return [];
  const log = habitLog && typeof habitLog === 'object' ? habitLog : {};
  const y = yesterdayDate(now);
  const yKey = dayKey(y);
  // Habits an ENABLED automation rule fills in — the cron logs them, not you.
  const autoIds = new Set(
    (Array.isArray(automations) ? automations : [])
      .filter(r => r && r.enabled && r.habitId)
      .map(r => r.habitId),
  );

  // Earliest DAY key each habit was ever marked. YYYY-MM-DD sorts
  // chronologically as a plain string, so this needs no date math.
  const firstDay = new Map();
  for (const k in log) {
    if (!DAY_KEY_RE.test(k)) continue;
    for (const id in (log[k] || {})) {
      const cur = firstDay.get(id);
      if (cur === undefined || k < cur) firstDay.set(id, k);
    }
  }

  const out = [];
  for (const h of habits) {
    if (!h) continue;
    if (cadenceCanon(h.cadence) !== 'Daily') continue;
    if (EXCLUDED_STATUSES.has((h.status || '').trim())) continue;
    if (autoIds.has(h.id)) continue;
    if (!tracksDate(h, y)) continue;                    // off-day → wasn't due
    if ((log[yKey] || {})[h.id] !== undefined) continue; // already marked
    const first = firstDay.get(h.id);
    if (first === undefined || first > yKey) continue;   // brand new → not a miss
    out.push(h);
  }
  return out;
}

/** The ids of habits an ENABLED automation rule fills in — the cron logs them,
 *  so they are never the user's to log. Distinct from the manual
 *  `status:'Automatically'` opt-out, which EXCLUDED_STATUSES already drops. */
export function autoTrackedIds(automations) {
  return new Set(
    (Array.isArray(automations) ? automations : [])
      .filter(r => r && r.enabled && r.habitId)
      .map(r => r.habitId),
  );
}

/**
 * How many habits still need logging for their current period. MANUAL habits
 * only — rule-automated ones are counted separately by `countAutoPendingHabits`
 * and shown grey, so the red nav badge always means "your work", matching the
 * Habits page's manual/automatic split and the mobile app's red dot.
 * @param {Array} habits   the user's `habits` array
 * @param {Object} habitLog the user's `habitLog` map (periodKey -> {habitId: mark})
 * @param {Array} [automations] the user's `habitAutomations` rules
 * @returns {number}
 */
export function countOutstandingHabits(habits, habitLog, automations) {
  return countHabitsNeedingLog(habits, habitLog, automations).manual;
}

/**
 * The rule-automated half of the same outstanding set: habits an enabled
 * automation rule will fill in that have no mark yet this period.
 * @returns {number}
 */
export function countAutoPendingHabits(habits, habitLog, automations) {
  return countHabitsNeedingLog(habits, habitLog, automations).auto;
}

/** Shared walk behind both counts above. @returns {{manual:number, auto:number}} */
export function countHabitsNeedingLog(habits, habitLog, automations) {
  if (!Array.isArray(habits)) return { manual: 0, auto: 0 };
  const log = habitLog && typeof habitLog === 'object' ? habitLog : {};
  const autoIds = autoTrackedIds(automations);
  let manual = 0;
  let auto = 0;
  for (const h of habits) {
    if (!h) continue;
    if (EXCLUDED_STATUSES.has((h.status || '').trim())) continue;
    if ((log[periodKey(h.cadence)] || {})[h.id] !== undefined) continue; // already logged
    const due = cadenceCanon(h.cadence) === 'Weekly' ? weeklyDueYet(h) : tracksDate(h);
    if (!due) continue;
    if (autoIds.has(h.id)) auto++;
    else manual++;
  }
  return { manual, auto };
}
