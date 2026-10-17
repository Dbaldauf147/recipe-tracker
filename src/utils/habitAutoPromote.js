// The arithmetic behind the "Automatically" offer (HabitsPage.jsx:
// autoPromoteProgress / autoPromoteEta / habitReadyForAuto). Pure, so
// node --test can load it.
//
// The rule: a DAILY habit done on more than 90% of its last 60 LOGGED days.
// A logged day is one marked Did it, Above & Beyond (★) or No. Skipped and
// unlogged days are passed over — the walk keeps going back until it has 60
// logged days (or runs out of history), so a week of PTO skips neither helps
// nor hurts. Fewer than 60 logged days ever is not enough evidence to qualify.
//
// Mirrored in PrepDay src/utils/habitAutoPromote.ts — change both together.

import { cadenceCanon, dayKey } from './habitOutstanding.js';

export const AUTO_PROMOTE_DAYS = 60;
export const AUTO_PROMOTE_PCT = 90;
// How far back the walk will look for 60 logged days.
export const AUTO_PROMOTE_LOOKBACK_DAYS = 365;

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const isDone = mk => mk === 'done' || mk === 'exceeded';
const isLogged = mk => isDone(mk) || mk === 'missed';
// Fewest whole days that clear a strictly-greater-than bar: 55 of 60, not 54.
export const AUTO_PROMOTE_NEEDED = Math.floor((AUTO_PROMOTE_DAYS * AUTO_PROMOTE_PCT) / 100) + 1;

function allowedDays(h) {
  return Array.isArray(h.trackDays) && h.trackDays.length > 0 ? h.trackDays : ALL_WEEKDAYS;
}

/**
 * The newest AUTO_PROMOTE_DAYS logged tracked days, today included, as
 * done-flags newest first — plus how many skipped / unlogged tracked days the
 * walk passed over on the way.
 */
function loggedWindow(h, habitLog, today) {
  const allowed = allowedDays(h);
  const flags = [];
  const keys = [];
  let skipped = 0, blank = 0;
  for (let i = 0; i < AUTO_PROMOTE_LOOKBACK_DAYS && flags.length < AUTO_PROMOTE_DAYS; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    if (!allowed.includes(d.getDay())) continue;
    const mk = habitLog?.[dayKey(d)]?.[h.id];
    if (isLogged(mk)) { flags.push(isDone(mk)); keys.push(dayKey(d)); }
    else if (mk === 'skipped') skipped++;
    else if (i > 0) blank++; // an unlogged today isn't "passed over" yet
  }
  return { flags, keys, skipped, blank };
}

/** Fewest future "Did it" days that make the newest 60 logged days clear the bar. */
function completionsNeeded(flags) {
  for (let k = 0; k <= AUTO_PROMOTE_DAYS; k++) {
    const past = flags.slice(0, AUTO_PROMOTE_DAYS - k);
    if (k + past.length < AUTO_PROMOTE_DAYS) continue;
    if (k + past.filter(Boolean).length >= AUTO_PROMOTE_NEEDED) return k;
  }
  return AUTO_PROMOTE_DAYS;
}

/** Where a habit stands against the rule. `earned` is the numbers only — no status checks. */
export function autoPromoteNumbers(h, habitLog, today = new Date()) {
  const daily = cadenceCanon(h.cadence) === 'Daily';
  const { flags, skipped, blank } = daily ? loggedWindow(h, habitLog, today) : { flags: [], skipped: 0, blank: 0 };
  const total = flags.length;
  const done = flags.filter(Boolean).length;
  const rate = total ? (done / total) * 100 : 0;
  return {
    daily, total, done, missed: total - done, skipped, blank,
    needed: AUTO_PROMOTE_NEEDED, rate,
    shortBy: daily ? completionsNeeded(flags) : 0,
    earned: daily && total >= AUTO_PROMOTE_DAYS && rate > AUTO_PROMOTE_PCT,
  };
}

/**
 * When the rule could fire if every tracked day from today on is a "Did it".
 *
 * Each new "Did it" pushes the oldest logged day out of the 60, so a habit
 * whose old days were misses gets there faster than one whose old days were
 * "Did it"s. `completions` is how many tracked days you'd have to do (today
 * included when it has no mark yet); `days` is calendar days from today.
 */
export function autoPromoteEta(h, habitLog, today = new Date()) {
  if (cadenceCanon(h.cadence) !== 'Daily') return null;
  const allowed = allowedDays(h);
  const k = completionsNeeded(loggedWindow(h, habitLog, today).flags);
  if (k === 0) return { date: today, days: 0, completions: 0 };
  const todayFree = !habitLog?.[dayKey(today)]?.[h.id];
  let left = k;
  for (let d = todayFree ? 0 : 1; d <= 3 * AUTO_PROMOTE_LOOKBACK_DAYS; d++) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
    if (!allowed.includes(date.getDay())) continue;
    if (--left <= 0) return { date, days: d, completions: k };
  }
  return null;
}

/**
 * Day keys between `from` and `to` (inclusive) on which the habit crossed the
 * line: the rule reads `earned` as of that day but not as of the day before.
 * Lets the calendar mark the day a habit stuck.
 */
export function autoPromoteQualifiedDays(h, habitLog, from, to) {
  const out = new Set();
  if (cadenceCanon(h.cadence) !== 'Daily') return out;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  let prev = autoPromoteNumbers(h, habitLog, new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1)).earned;
  for (let d = start; d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const now = autoPromoteNumbers(h, habitLog, d).earned;
    if (now && !prev) out.add(dayKey(d));
    prev = now;
  }
  return out;
}

/** The 60 logged days the rule counts as of `asOf` (newest first) — on a qualified day, the run that earned it. */
export function autoPromoteWindowKeys(h, habitLog, asOf) {
  return loggedWindow(h, habitLog, asOf).keys;
}

/**
 * Has a past answer to the offer run out? Saying "keep tracking it" (or moving
 * it back off Automatically) holds until the habit has a fresh 60 logged days
 * that all come AFTER that answer — then it can be asked again. No answer on
 * record counts as expired.
 */
export function autoPromoteAnswerExpired(h, habitLog, today = new Date()) {
  const stamp = h.autoPromotedAt || h.autoPromoteDeclinedAt;
  if (!stamp) return true;
  const answered = new Date(stamp);
  if (Number.isNaN(answered.getTime())) return false;
  const keys = loggedWindow(h, habitLog, today).keys;
  if (keys.length < AUTO_PROMOTE_DAYS) return false;
  return keys[keys.length - 1] > dayKey(answered);
}
