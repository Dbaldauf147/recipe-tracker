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

// ── Chosen time window + trend ───────────────────────────────────────────────
//
// Clicking a bad habit opens a detail panel whose window you pick as "last N
// days / weeks / months / years" (or all time). The choice is saved on the
// habit itself as `badRange: { n, unit }`, so the phone shows the same window.
//
// ⚠️ MIRRORED in the mobile app's src/utils/badHabitTrend.ts — keep the bucket
// rules and labels identical so both charts draw the same bars.

export const BAD_RANGE_UNITS = ['days', 'weeks', 'months', 'years', 'all'];
export const DEFAULT_BAD_RANGE = { n: 3, unit: 'months' };
export const BAD_RANGE_PRESETS = [
  { n: 2, unit: 'weeks', label: '2W' },
  { n: 1, unit: 'months', label: '1M' },
  { n: 3, unit: 'months', label: '3M' },
  { n: 6, unit: 'months', label: '6M' },
  { n: 1, unit: 'years', label: '1Y' },
  { n: 1, unit: 'all', label: 'All' },
];
// The day grid in the detail panel shows every day only up to this span —
// past it, a year of 34px cells is a wall, and the chart says it better.
export const BAD_GRID_MAX_DAYS = 92;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A saved range made safe: whole n in 1–999 and a known unit, else the default. */
export function normalizeBadRange(r) {
  if (!BAD_RANGE_UNITS.includes(r?.unit)) return { ...DEFAULT_BAD_RANGE };
  if (r.unit === 'all') return { n: 1, unit: 'all' };
  const n = Math.round(Number(r.n));
  return { n: Number.isFinite(n) && n >= 1 ? Math.min(999, n) : 1, unit: r.unit };
}

/** "Last 3 months" / "Last day" / "All time" */
export function badRangeLabel(r) {
  const { n, unit } = normalizeBadRange(r);
  if (unit === 'all') return 'All time';
  const single = unit.slice(0, -1);
  return n === 1 ? `Last ${single}` : `Last ${n} ${unit}`;
}

/**
 * First day (local midnight) of the window, today included in it.
 * "Last 1 month" on 27 Oct starts 28 Sep; "last 2 weeks" is 14 days.
 * `all` starts at the first slip ever (or today if there is none).
 */
export function badRangeStart(r, today = new Date(), firstKey = null) {
  const { n, unit } = normalizeBadRange(r);
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  if (unit === 'days') return new Date(y, m, d - (n - 1));
  if (unit === 'weeks') return new Date(y, m, d - (7 * n - 1));
  if (unit === 'months') return new Date(y, m - n, d + 1);
  if (unit === 'years') return new Date(y - n, m, d + 1);
  const first = dateOfDayKey(firstKey);
  return first && first < today ? first : new Date(y, m, d);
}

/** Bar size for a span: daily up to a month, weekly up to ~6 months, then monthly, then yearly. */
export function trendBucketUnit(spanDays) {
  if (spanDays <= 31) return 'day';
  if (spanDays <= 183) return 'week';
  if (spanDays <= 366 * 3) return 'month';
  return 'year';
}

function bucketStartOf(date, unit) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  if (unit === 'day') return new Date(y, m, d);
  if (unit === 'week') return new Date(y, m, d - date.getDay()); // Sunday
  if (unit === 'month') return new Date(y, m, 1);
  return new Date(y, 0, 1);
}

function nextBucket(date, unit) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  if (unit === 'day') return new Date(y, m, d + 1);
  if (unit === 'week') return new Date(y, m, d + 7);
  if (unit === 'month') return new Date(y, m + 1, 1);
  return new Date(y + 1, 0, 1);
}

function bucketLabel(date, unit) {
  if (unit === 'year') return String(date.getFullYear());
  if (unit === 'month') return `${MONTHS[date.getMonth()]} '${String(date.getFullYear()).slice(2)}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Everything the detail panel draws for one habit over the chosen window.
 *
 * Buckets are calendar-aligned (Sunday weeks, calendar months/years) so a bar
 * means the same thing whichever window you picked; the first and last bucket
 * are clipped to the window, and each carries `days` — how many of its days
 * fall inside — so a part-week isn't mistaken for a good week.
 *
 * @returns {{ range, startKey, endKey, spanDays, unit, total, cleanDays,
 *   longestClean, perWeek, buckets: {key,label,days,count}[] }}
 */
export function badHabitTrend(habitId, habitLog, range, today = new Date()) {
  const r = normalizeBadRange(range);
  const all = occurrenceDays(habitId, habitLog);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = badRangeStart(r, end, all[0] || null);
  const startKey = dayKeyOf(start);
  const endKey = dayKeyOf(end);
  const spanDays = daysBetween(startKey, endKey) + 1;
  const inRange = all.filter(k => k >= startKey && k <= endKey);
  const unit = trendBucketUnit(spanDays);

  const buckets = [];
  for (let b = bucketStartOf(start, unit); b <= end; b = nextBucket(b, unit)) {
    const from = b < start ? start : b;
    const nb = nextBucket(b, unit);
    const to = new Date(nb.getFullYear(), nb.getMonth(), nb.getDate() - 1);
    const until = to > end ? end : to;
    const fromKey = dayKeyOf(from), untilKey = dayKeyOf(until);
    buckets.push({
      key: dayKeyOf(b),
      label: bucketLabel(b, unit),
      days: daysBetween(fromKey, untilKey) + 1,
      count: inRange.filter(k => k >= fromKey && k <= untilKey).length,
    });
  }

  // Longest run of slip-free days inside the window (edges count as runs).
  let longestClean = 0;
  let prev = dayKeyOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1));
  for (const k of [...inRange, dayKeyOf(new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1))]) {
    longestClean = Math.max(longestClean, daysBetween(prev, k) - 1);
    prev = k;
  }

  return {
    range: r,
    startKey,
    endKey,
    spanDays,
    unit,
    total: inRange.length,
    cleanDays: spanDays - inRange.length,
    longestClean,
    perWeek: spanDays ? Math.round((inRange.length / spanDays) * 7 * 10) / 10 : 0,
    buckets,
  };
}
