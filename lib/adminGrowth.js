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
  // A compacted snapshot has no `users[]` left to count — the figure was
  // worked out and stored before the rows were dropped. Only trust it for the
  // standard window, since that is the one it was computed for.
  if (windowDays === ACTIVE_WINDOW_DAYS) {
    // `typeof` first, deliberately: Number(null) is 0, so coercing would turn
    // a null that slipped into storage into "nobody was active that week" —
    // indistinguishable from a real reading, and on a compacted row there are
    // no rows left to catch it.
    const stored = snapshot?.totals?.activeUsers;
    if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
  }

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

/**
 * "Sep 21" — short enough to sit under a chart column — or "Sep 21, 2024".
 *
 * The year is opt-in because most of these labels sit in a series that plainly
 * spans one year, where repeating it is noise. It stops being noise the moment
 * the series crosses a year boundary: "Sep 30 – Sep 22" reads as eight days
 * when it is actually two years.
 */
export function shortDate(dateKey, { year = false } = {}) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return year ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${d}`;
}

/**
 * "Sep '24" — for an axis tick on a series thinned to one point per month,
 * where the day-of-month is an artefact of which snapshot represented the
 * bucket rather than anything the reader should attend to.
 */
export function monthYear(dateKey) {
  const [y, m] = dateKey.split('-');
  return `${MONTHS[Number(m) - 1]} '${y.slice(2)}`;
}

/**
 * Coarsest-to-finest buckets a snapshot can be grouped into. Each maps a date
 * key to the bucket it belongs to; the LAST snapshot in a bucket represents it,
 * the same "last reading in the period" rule the weekly email's weight chart
 * uses. `stride` is the fallback for a span so long even months overflow.
 */
const GRAINS = [
  { key: 'day', of: d => d },
  { key: 'week', of: weekKeyOf },
  { key: 'month', of: d => d.slice(0, 7) },
];

/** Last snapshot in each bucket, ascending. */
function thinTo(rows, bucketOf) {
  const byBucket = new Map();
  for (const s of rows) byBucket.set(bucketOf(s.date), s); // ascending: last write wins
  return [...byBucket.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The series both charts draw: `[{ date, label, total, active }]`, oldest first,
 * plus a `grain` telling the caller what one point now means.
 *
 * Snapshots are daily, but a chart with 900 columns is unreadable and one with
 * 3 is not a trend, so the GRAIN adapts while the SPAN does not: day, then
 * week, then month, picking the finest that fits `maxPoints`. Past that it
 * takes every Nth month, always keeping the first and last.
 *
 * It never drops the oldest points. It used to end in `slice(-maxPoints)`,
 * which silently turned "all of it" into "the most recent 30" — so a chart
 * labelled as the history of the user base quietly stopped being that after
 * about seven months.
 */
export function summarizeUserGrowth(snapshots, { maxPoints = 12, windowDays = ACTIVE_WINDOW_DAYS } = {}) {
  const asc = (Array.isArray(snapshots) ? snapshots : [])
    .filter(s => s && typeof s.date === 'string' && DATE_RE.test(s.date))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (asc.length === 0) return { points: [], grain: 'day' };

  const cap = Math.max(2, maxPoints);
  let rows = asc;
  let grain = 'day';
  for (const g of GRAINS) {
    rows = g.key === 'day' ? asc : thinTo(asc, g.of);
    grain = g.key;
    if (rows.length <= cap) break;
  }

  // Even by month it overflows — a decade or more. Keep every Nth, anchored on
  // the newest so today is always a point, and force the oldest back in so the
  // span still starts where the history does.
  if (rows.length > cap) {
    const stride = Math.ceil(rows.length / cap);
    const kept = rows.filter((_, i) => (rows.length - 1 - i) % stride === 0);
    if (kept[0] !== rows[0]) kept.unshift(rows[0]);
    rows = kept;
    grain = 'sparse';
  }

  const points = rows.map(s => ({
    date: s.date,
    label: shortDate(s.date),
    total: totalUsersIn(s),
    active: activeUsersIn(s, windowDays),
  }));
  return { points, grain };
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
