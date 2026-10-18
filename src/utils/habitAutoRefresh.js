// The automatic-habit refresh rotation.
//
// One "Automatically" habit at a time is pulled off the Auto Review list and
// put back on the Current tab as "Refreshing" — logged in the routines again —
// for REFRESH_DAYS calendar days, then returned to Automatically. The habit
// that has gone longest without a refresh is always the next one out.
//
// Fields on the habit (all 'YYYY-MM-DD'):
//   autoSince          when it last landed on Auto Review
//   autoSinceHow       'marked' (you set it Automatically) or 'refreshed'
//                      (it came back from the Current tab)
//   autoRefreshedAt    the last time it came back from a refresh
//   refreshStartedAt   set ONLY while it's out on the Current tab; this is
//                      what marks it as the rotation's habit rather than one
//                      you set to Refreshing by hand
import { isBadHabit } from './habitOutstanding.js';

export const AUTO_STATUS = 'Automatically';
export const REFRESH_STATUS = 'Refreshing';
export const REFRESH_DAYS = 60;

const status = h => (h?.status || '').trim();

function dateOf(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function keyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Is this habit out on the Current tab because the rotation put it there? */
export function isRefreshRotation(h) {
  return status(h) === REFRESH_STATUS && !!(h?.refreshStartedAt || '').trim();
}

/** 'YYYY-MM-DD' the rotation sends it back to Automatically, or ''. */
export function refreshReturnKey(h) {
  const start = dateOf(h?.refreshStartedAt);
  if (!start) return '';
  start.setDate(start.getDate() + REFRESH_DAYS);
  return keyOf(start);
}

/**
 * Next Automatically habit in line for a refresh: never-dated ones first (they
 * predate this tracking, so they're the longest overdue), then oldest
 * `autoSince`. One that only landed on Auto Review today is never picked, so a
 * lone automatic habit doesn't bounce straight back out the day it returns.
 */
export function nextRefreshCandidate(habits, todayKey) {
  const pool = (habits || [])
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => status(h) === AUTO_STATUS && !isBadHabit(h) && (h.autoSince || '') !== todayKey);
  pool.sort((a, b) =>
    (a.h.autoSince || '').localeCompare(b.h.autoSince || '')
    || (a.h.autoPromotedAt || '').localeCompare(b.h.autoPromotedAt || '')
    || a.i - b.i);
  return pool[0]?.h || null;
}

/**
 * Advance the rotation to `todayKey`. Returns the SAME array when there's
 * nothing to do, so it's safe to run from an effect that watches `habits`.
 *   1. a rotation habit that has done its REFRESH_DAYS goes back to Automatically
 *      (stamped with today as its refreshed date);
 *   2. if no rotation habit is out, the next candidate goes to Refreshing.
 */
export function advanceAutoRefresh(habits, todayKey) {
  if (!Array.isArray(habits) || habits.length === 0) return habits;
  let changed = false;
  let next = habits.map(h => {
    // A marker left on a habit whose status was changed somewhere that doesn't
    // run stampAutoStatusChanges (the phone) — it's not out refreshing any more.
    if (status(h) !== REFRESH_STATUS && (h.refreshStartedAt || '').trim()) {
      changed = true;
      const clean = { ...h };
      delete clean.refreshStartedAt;
      return clean;
    }
    if (!isRefreshRotation(h) || refreshReturnKey(h) > todayKey) return h;
    changed = true;
    const back = { ...h, status: AUTO_STATUS, autoSince: todayKey, autoSinceHow: 'refreshed', autoRefreshedAt: todayKey };
    delete back.refreshStartedAt;
    return back;
  });
  if (!next.some(isRefreshRotation)) {
    const pick = nextRefreshCandidate(next, todayKey);
    if (pick) {
      changed = true;
      next = next.map(h => (h.id === pick.id ? { ...h, status: REFRESH_STATUS, refreshStartedAt: todayKey } : h));
    }
  }
  return changed ? next : habits;
}

/**
 * Stamp status changes made by hand (or by any write) between `prev` and
 * `next`:
 *   • moved INTO Automatically → autoSince = today, how = 'marked'
 *     (left alone if the same write already set autoSince itself);
 *   • the rotation habit moved off Refreshing by hand → it's no longer the
 *     rotation's, so its marker goes and the next one can go out.
 * New habits (not in `prev`, e.g. an import) aren't stamped: the date they
 * really went automatic is unknown.
 */
export function stampAutoStatusChanges(prev, next, todayKey) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return next;
  const before = new Map(prev.map(h => [h.id, h]));
  let changed = false;
  const out = next.map(h => {
    const was = before.get(h.id);
    if (!was || status(was) === status(h)) return h;
    let patched = h;
    if (status(h) === AUTO_STATUS && (h.autoSince || '') === (was.autoSince || '')) {
      patched = { ...patched, autoSince: todayKey, autoSinceHow: 'marked' };
    }
    if (status(h) !== REFRESH_STATUS && (patched.refreshStartedAt || '').trim()) {
      patched = { ...patched };
      delete patched.refreshStartedAt;
    }
    if (patched !== h) changed = true;
    return patched;
  });
  return changed ? out : next;
}
