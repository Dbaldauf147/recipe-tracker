/**
 * Special Meals — logged meals and snacks tagged to a holiday or event.
 *
 * The tag is one field on a dailyLog entry, `specialEvent` (a name such as
 * "Thanksgiving" or "Mom's birthday"). The year comes from the day the entry
 * is logged on, so "Thanksgiving" in 2025 and 2026 are two occasions of the
 * same event rather than two names to keep apart.
 *
 * Setting or clearing the tag touches ONLY that field. Logged meals are
 * snapshots: their nutrition is never recalculated here.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = n => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Day of month of the nth `weekday` (0 = Sun) in month `m` (1-12). */
function nthWeekday(y, m, weekday, n) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** Day of month of the last `weekday` in month `m`. */
function lastWeekday(y, m, weekday) {
  const lastDay = new Date(Date.UTC(y, m, 0));
  return lastDay.getUTCDate() - ((lastDay.getUTCDay() - weekday + 7) % 7);
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return key(y, month, day);
}

/** The holidays offered as tags, with their date in year `y`. */
export function holidaysForYear(y) {
  return [
    { name: "New Year's Day", date: key(y, 1, 1) },
    { name: 'Super Bowl', date: key(y, 2, nthWeekday(y, 2, 0, 2)) },
    { name: "Valentine's Day", date: key(y, 2, 14) },
    { name: "St. Patrick's Day", date: key(y, 3, 17) },
    { name: 'Easter', date: easter(y) },
    { name: "Mother's Day", date: key(y, 5, nthWeekday(y, 5, 0, 2)) },
    { name: 'Memorial Day', date: key(y, 5, lastWeekday(y, 5, 1)) },
    { name: "Father's Day", date: key(y, 6, nthWeekday(y, 6, 0, 3)) },
    { name: 'Fourth of July', date: key(y, 7, 4) },
    { name: 'Labor Day', date: key(y, 9, nthWeekday(y, 9, 1, 1)) },
    { name: 'Halloween', date: key(y, 10, 31) },
    { name: 'Thanksgiving', date: key(y, 11, nthWeekday(y, 11, 4, 4)) },
    { name: 'Christmas Eve', date: key(y, 12, 24) },
    { name: 'Christmas', date: key(y, 12, 25) },
    { name: "New Year's Eve", date: key(y, 12, 31) },
  ];
}

/** The holiday falling on a YYYY-MM-DD day, or null. */
export function holidayOn(dateKey) {
  if (!DATE_RE.test(dateKey || '')) return null;
  return holidaysForYear(Number(dateKey.slice(0, 4))).find(h => h.date === dateKey)?.name || null;
}

/** An entry's tag, trimmed; '' when it has none. */
export function eventTagOf(entry) {
  return typeof entry?.specialEvent === 'string' ? entry.specialEvent.trim() : '';
}

/** What an entry is called, the same way the Food Log names it. */
export function entryName(entry) {
  if (!entry) return 'Unknown';
  return entry.recipeName || entry.ingredientName || entry.name || 'Unknown';
}

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Every tagged entry, grouped by event and then by day:
 * `[{ name, occasions: [{ date, entries: [entry] }] }]`.
 *
 * Event names match case-insensitively; the spelling used on the newest
 * occasion is the one shown. Events are ordered by their newest occasion
 * first, and occasions newest first within each.
 */
export function collectSpecialMeals(log) {
  const byEvent = new Map();
  for (const [date, day] of Object.entries(log || {})) {
    if (!DATE_RE.test(date)) continue;
    for (const entry of day?.entries || []) {
      const tag = eventTagOf(entry);
      if (!tag) continue;
      const k = tag.toLowerCase();
      if (!byEvent.has(k)) byEvent.set(k, { names: new Map(), days: new Map() });
      const ev = byEvent.get(k);
      if (!ev.days.has(date)) ev.days.set(date, []);
      ev.days.get(date).push(entry);
      const seen = ev.names.get(tag);
      if (!seen || date > seen) ev.names.set(tag, date);
    }
  }
  const events = [...byEvent.values()].map(ev => {
    const occasions = [...ev.days.entries()]
      .map(([date, entries]) => ({ date, entries }))
      .sort((a, b) => b.date.localeCompare(a.date));
    const name = [...ev.names.entries()].sort((a, b) => b[1].localeCompare(a[1]))[0][0];
    return { name, occasions };
  });
  return events.sort((a, b) => b.occasions[0].date.localeCompare(a.occasions[0].date));
}

/**
 * Names to offer when tagging: events already used (newest first), then the
 * holidays not yet used. A holiday on `dateKey` goes to the very front.
 */
export function suggestedEventNames(log, dateKey = '') {
  const used = collectSpecialMeals(log).map(e => e.name);
  const year = DATE_RE.test(dateKey) ? Number(dateKey.slice(0, 4)) : new Date().getFullYear();
  const holidays = holidaysForYear(year).map(h => h.name);
  const out = [];
  const push = n => { if (n && !out.some(o => sameName(o, n))) out.push(n); };
  push(holidayOn(dateKey));
  used.forEach(push);
  holidays.forEach(push);
  return out;
}

/**
 * Holidays you logged food on but haven't tagged anything for, newest first:
 * `[{ name, date, count }]` — a prompt, so a Thanksgiving dinner doesn't go
 * unlabelled just because you forgot. `since` bounds how far back to look.
 */
export function untaggedHolidays(log, { since = '' } = {}) {
  const out = [];
  for (const [date, day] of Object.entries(log || {})) {
    if (!DATE_RE.test(date) || (since && date < since)) continue;
    const name = holidayOn(date);
    if (!name) continue;
    const entries = day?.entries || [];
    if (entries.length === 0 || entries.some(e => eventTagOf(e))) continue;
    out.push({ name, date, count: entries.length });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * A copy of `log` with the given entries on `date` tagged `name` — or untagged
 * when `name` is blank. Every other field of every entry is left as it was;
 * the day object and the untouched entries keep their identity.
 */
export function setEventTag(log, date, entryIds, name) {
  const day = log?.[date];
  if (!day?.entries) return log;
  const ids = new Set(Array.isArray(entryIds) ? entryIds : [entryIds]);
  const tag = typeof name === 'string' ? name.trim() : '';
  let changed = false;
  const entries = day.entries.map(e => {
    if (!ids.has(e.id)) return e;
    if (eventTagOf(e) === tag) return e;
    changed = true;
    if (!tag) {
      const { specialEvent: _drop, ...rest } = e;
      return rest;
    }
    return { ...e, specialEvent: tag };
  });
  if (!changed) return log;
  return { ...log, [date]: { ...day, entries } };
}
