// Count of habits still "outstanding" — i.e. that need logging for their
// current period right now. Used for the left-nav red count badge.
//
// ⚠️ MIRRORS the Habits page's `totalUnlogged` (src/components/HabitsPage.jsx:
// `groups` + `cadenceUnlogged`) so the badge equals the number shown on the
// Habits "All" tab. The tracking helpers below are copied from HabitsPage —
// keep them in sync if that logic changes (per-weekday trackDays, per-habit
// weekly weekDays, Sunday-anchored week key, excluded statuses).

const pad2 = (n) => String(n).padStart(2, '0');

function cadenceCanon(c) {
  const x = (c || '').trim().toLowerCase();
  if (x === 'weekly') return 'Weekly';
  if (x === 'monthly') return 'Monthly';
  if (x === 'annually') return 'Annually';
  return 'Daily';
}

function dayKey(d) {
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

function periodKey(cadence, date = new Date()) {
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
function tracksDate(h, date = new Date()) {
  if (cadenceCanon(h?.cadence) !== 'Daily') return true;
  return habitTrackDays(h).includes(date.getDay());
}

// Weekly per-habit pinned day (`weekDays`): the habit isn't "due" until its
// day of the week arrives. Not pinned → due all week (legacy default).
function habitWeekDays(h) {
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
const EXCLUDED_STATUSES = new Set(['On Hold', 'Abandoned', 'Automatically', 'Not Started', 'Havent Started']);

/**
 * How many habits still need logging for their current period.
 * @param {Array} habits   the user's `habits` array
 * @param {Object} habitLog the user's `habitLog` map (periodKey -> {habitId: mark})
 * @returns {number}
 */
export function countOutstandingHabits(habits, habitLog) {
  if (!Array.isArray(habits)) return 0;
  const log = habitLog && typeof habitLog === 'object' ? habitLog : {};
  let n = 0;
  for (const h of habits) {
    if (!h) continue;
    if (EXCLUDED_STATUSES.has((h.status || '').trim())) continue;
    if ((log[periodKey(h.cadence)] || {})[h.id] !== undefined) continue; // already logged
    const due = cadenceCanon(h.cadence) === 'Weekly' ? weeklyDueYet(h) : tracksDate(h);
    if (due) n++;
  }
  return n;
}
