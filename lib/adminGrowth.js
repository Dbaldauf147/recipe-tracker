/**
 * User growth over time, read back out of the daily `adminSnapshots` rows.
 *
 * Shared by the admin dashboard (src/components/AdminDashboard.jsx) and the
 * weekly summary email (api/send-weekly-summary.js) so the two can never
 * disagree about what "total users" or "active" means — the same failure the
 * weekly summary's metric definitions were hand-mirrored to avoid.
 *
 * Nothing here reads the live users collection. A snapshot is the only record
 * of what the numbers WERE (see api/snapshot-admin-metrics.js: login counters
 * have no history of their own), so the whole series is derived from the rows
 * captured each morning.
 */

export const ACTIVE_WINDOW_DAYS = 7;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Last seen anywhere — the later of the web and app logins. Mirrors
 * `lastActiveIso` in AdminDashboard.jsx: ISO strings sort lexicographically,
 * so the plain sort is the max.
 */
function lastSeenIso(u) {
  return [u?.lastLogin, u?.mobileLastLogin].filter(Boolean).sort().pop() || '';
}

/** Total users on the day of a snapshot. */
export function totalUsersIn(snapshot) {
  const stored = Number(snapshot?.totals?.users);
  if (Number.isFinite(stored)) return stored;
  return Array.isArray(snapshot?.users) ? snapshot.users.length : null;
}

/**
 * How many users had signed in within the trailing week AS OF that snapshot —
 * the historical twin of the dashboard's "Active (7d)" card, which measures the
 * same window against `Date.now()`.
 *
 * The anchor is `takenAt` (the instant the snapshot ran), not right now:
 * measuring a three-month-old snapshot against today would report 0 active for
 * every row in the history. Returns null — not 0 — for a snapshot with no
 * per-user rows, because "we didn't capture it" is not "nobody was active".
 */
export function activeUsersIn(snapshot, windowDays = ACTIVE_WINDOW_DAYS) {
  const rows = Array.isArray(snapshot?.users) ? snapshot.users : null;
  if (!rows) return null;
  const anchor = Date.parse(snapshot.takenAt || `${snapshot.date}T23:59:59Z`);
  if (!Number.isFinite(anchor)) return null;
  const cutoff = anchor - windowDays * 86400000;
  return rows.filter(u => {
    const iso = lastSeenIso(u);
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= cutoff;
  }).length;
}

/** Sunday-anchored week key, matching the app's week boundary everywhere else. */
function weekKeyOf(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
  return dt.toISOString().slice(0, 10);
}

/** "Sep 21" — short enough to sit under a chart column. */
export function shortDate(dateKey) {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/**
 * The series both charts draw: `[{ date, label, total, active }]`, oldest first.
 *
 * Snapshots are daily, but a chart with 90 columns is unreadable and one with 3
 * is not a trend, so the grain adapts to how much history exists rather than
 * being fixed: while the snapshots still fit in `maxPoints` every day is its own
 * point, and past that it thins to the LAST snapshot of each week (the same
 * "last reading each week" rule the weekly email's weight chart uses). Only then,
 * once even the weeks overflow, does it drop the oldest. That way the chart is
 * useful from the second snapshot onward instead of staying empty for a month.
 */
export function summarizeUserGrowth(snapshots, { maxPoints = 12, windowDays = ACTIVE_WINDOW_DAYS } = {}) {
  const asc = (Array.isArray(snapshots) ? snapshots : [])
    .filter(s => s && typeof s.date === 'string' && DATE_RE.test(s.date))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (asc.length === 0) return [];

  let rows = asc;
  if (rows.length > maxPoints) {
    const byWeek = new Map();
    for (const s of rows) byWeek.set(weekKeyOf(s.date), s); // ascending, so the last write wins
    rows = [...byWeek.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  if (rows.length > maxPoints) rows = rows.slice(-maxPoints);

  return rows.map(s => ({
    date: s.date,
    label: shortDate(s.date),
    total: totalUsersIn(s),
    active: activeUsersIn(s, windowDays),
  }));
}

/** Latest reading plus its change over the span, for the headline rows. */
export function growthHeadline(points) {
  const rows = Array.isArray(points) ? points : [];
  const lastWith = key => {
    for (let i = rows.length - 1; i >= 0; i--) if (Number.isFinite(rows[i][key])) return rows[i][key];
    return null;
  };
  const firstWith = key => {
    for (const r of rows) if (Number.isFinite(r[key])) return r[key];
    return null;
  };
  const span = (key) => {
    const a = firstWith(key);
    const b = lastWith(key);
    return a == null || b == null || rows.length < 2 ? null : b - a;
  };
  return {
    total: lastWith('total'),
    totalChange: span('total'),
    active: lastWith('active'),
    activeChange: span('active'),
    from: rows[0]?.date || null,
    to: rows[rows.length - 1]?.date || null,
  };
}
