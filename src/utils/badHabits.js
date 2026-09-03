// Stats for a BAD habit — one you are trying not to do.
//
// The rest of the tracker measures how often you DID something, and a long run
// of marks is the win. Here it is the opposite: the marks are slips, and the
// number that matters is how long it has been since the last one. Nothing is
// ever "due", so there is no completion rate to compute and no streak of marks
// worth celebrating.
//
// Bad habits store their marks in the ordinary habitLog under ordinary day
// keys, so everything below reads the same structure the rest of the page does.

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The mark a slip is stored as. Deliberately one of the existing marks rather
 * than a new value: the grid, the history import and the sync layer all read
 * `habitLog[day][id]` and would have to learn a second vocabulary otherwise.
 * "Did it" is exactly what happened — only the colour is inverted.
 */
export const BAD_HABIT_MARK = 'done';

const pad2 = (n) => String(n).padStart(2, '0');

export function dayKeyOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local-midnight Date for a "YYYY-MM-DD" key. Never UTC — day keys are local. */
export function dateOfDayKey(key) {
  const m = DAY_KEY_RE.test(key || '') ? key.split('-').map(Number) : null;
  return m ? new Date(m[0], m[1] - 1, m[2]) : null;
}

/** Whole days between two day keys, a → b. Negative if b is before a. */
export function daysBetween(aKey, bKey) {
  const a = dateOfDayKey(aKey);
  const b = dateOfDayKey(bKey);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Every day key on which this habit actually happened, oldest first.
 *
 * Two filters, both load-bearing:
 *   • Day-shaped keys only. A stray weekly or monthly bucket in the same log
 *     would otherwise read as an occurrence and reset "days clean".
 *   • The slip mark only, not "any mark at all". Other machinery writes to
 *     these cells — a PTO range stamps Skip across a holiday — and counting
 *     those would turn a week away into a week of slips.
 */
export function occurrenceDays(habitId, habitLog) {
  const log = habitLog && typeof habitLog === 'object' ? habitLog : {};
  const out = [];
  for (const key in log) {
    if (!DAY_KEY_RE.test(key)) continue;
    if ((log[key] || {})[habitId] !== BAD_HABIT_MARK) continue;
    out.push(key);
  }
  // YYYY-MM-DD sorts chronologically as a plain string.
  return out.sort();
}

/**
 * Headline numbers for one bad habit.
 *
 * @returns {{
 *   total: number,        every slip ever logged
 *   thisWeek: number,     slips since Sunday
 *   thisMonth: number,    slips this calendar month
 *   last30: number,       slips in the last 30 days, today included
 *   lastKey: string|null, the most recent slip's day key
 *   daysClean: number|null,  days since the last slip; 0 if it happened today,
 *                            null if there has never been one
 *   loggedToday: boolean
 * }}
 */
export function badHabitStats(habitId, habitLog, today = new Date()) {
  const days = occurrenceDays(habitId, habitLog);
  const todayKey = dayKeyOf(today);
  const monthPrefix = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`;

  // Sunday-anchored week, matching the week the rest of the page shows.
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  const weekStartKey = dayKeyOf(weekStart);
  const from30 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
  const from30Key = dayKeyOf(from30);

  let thisWeek = 0;
  let thisMonth = 0;
  let last30 = 0;
  for (const key of days) {
    if (key >= weekStartKey && key <= todayKey) thisWeek++;
    if (key.startsWith(monthPrefix)) thisMonth++;
    if (key >= from30Key && key <= todayKey) last30++;
  }

  const lastKey = days.length ? days[days.length - 1] : null;
  // A slip logged in the future (a mis-tap on a forward date) would otherwise
  // produce a negative "days clean", which reads as nonsense.
  const daysClean = lastKey ? Math.max(0, daysBetween(lastKey, todayKey) ?? 0) : null;

  return {
    total: days.length,
    thisWeek,
    thisMonth,
    last30,
    lastKey,
    daysClean,
    loggedToday: lastKey === todayKey,
  };
}

/** The last `n` day keys ending today, oldest first — the strip on each row. */
export function recentDayKeys(n = 14, today = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(dayKeyOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)));
  }
  return out;
}

/** "9 days clean" / "logged today" / "no slips logged yet" */
export function cleanLabel(stats) {
  if (!stats || stats.daysClean === null) return 'no slips logged yet';
  if (stats.daysClean === 0) return 'logged today';
  if (stats.daysClean === 1) return '1 day clean';
  return `${stats.daysClean} days clean`;
}
