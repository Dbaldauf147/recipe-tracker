// Pure logic for the monthly dailyLog archive. NO imports — shared by the
// browser (src/utils/firestoreSync.js) and the crons (api/_data/dailyLogArchive.js).
//
// Why it exists: the whole meal log used to live in ONE document,
// users/{uid}/data/dailyLog, and a logged meal carries a per-ingredient
// nutrition breakdown (~10 KB each), so a heavy logger fills the 1 MB doc cap
// in months. The daily backup cron now moves every day older than
// ARCHIVE_AFTER_DAYS into users/{uid}/dailyLogArchive/{YYYY-MM}, stored as a
// JSON string (like habitLog's year docs — a nested map of that size would also
// blow the per-document index-entry limit). The live doc keeps the recent days,
// which is all any cron reads apart from the weekly email.
//
// Clients read live ∪ archive (mergeArchiveUnder) and, when they save, leave
// out any day identical to its archived copy (omitArchivedDays), so a full
// overwrite never drags history back into the live doc. An archived day that
// was EDITED does go back to the live doc, and the next sweep files it again —
// the live copy is newer, so it wins (mergeArchivedDay).
//
// (The mobile app has its own copy in PrepDay/src/utils/dailyLogArchive.ts —
// separate repo, so that one can't share this file. Change both together.)

export const ARCHIVE_COLLECTION = 'dailyLogArchive';
export const ARCHIVE_VERSION = 1;
// Days older than this move out of the live doc. Every cron except the weekly
// email reads at most 28 days back; the weekly email loads the archive too.
export const ARCHIVE_AFTER_DAYS = 60;
// An archive month must stay under the 1 MB doc cap with room for the wrapper.
export const ARCHIVE_MONTH_MAX_BYTES = 900_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export const isDayKey = (k) => DAY_RE.test(String(k || ''));
export const isMonthKey = (k) => MONTH_RE.test(String(k || ''));
export const monthOfDay = (day) => String(day).slice(0, 7);

/** 'YYYY-MM-DD' shifted by n days (calendar arithmetic, timezone-free). */
export function shiftDayKey(day, n) {
  const [y, m, d] = String(day).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** First day that stays in the live doc when today is `todayKey`. */
export function archiveCutoff(todayKey, keepDays = ARCHIVE_AFTER_DAYS) {
  return shiftDayKey(todayKey, -keepDays);
}

/**
 * JSON with object keys sorted, so two copies of a day compare equal whatever
 * order their fields came back in (Firestore returns map keys sorted; an
 * archived copy keeps whatever order it was written in).
 */
export function stableStringify(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`;
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

export const sameDay = (a, b) => stableStringify(a) === stableStringify(b);

const entryCount = (day) => (Array.isArray(day?.entries) ? day.entries.length : 0);

/**
 * One day present both in the archive and in a newer copy (the live doc).
 *
 * The newer copy wins field by field — except that a copy with NO meals never
 * wipes an archived day's meals. The phone's Apple Health backfill writes
 * `{entries: [], steps, sleep}` stubs for old dates it thinks are missing, and
 * that stub must not erase a month of logged meals. (Deleting every meal of an
 * archived day is the one edit this can't express; it's also the rare one.)
 */
export function mergeArchivedDay(archived, newer) {
  if (!archived || typeof archived !== 'object') return newer;
  if (!newer || typeof newer !== 'object') return archived;
  const out = { ...archived, ...newer };
  if (entryCount(newer) === 0 && entryCount(archived) > 0) out.entries = archived.entries;
  return out;
}

/** Parse an archive month doc ({ log: '<json>' }) into a day map. */
export function parseArchiveDoc(data) {
  if (!data) return {};
  let log = data.log;
  if (typeof log === 'string') {
    try { log = JSON.parse(log); } catch { return {}; }
  }
  if (!log || typeof log !== 'object') return {};
  const out = {};
  for (const k of Object.keys(log)) if (isDayKey(k)) out[k] = log[k];
  return out;
}

/** The fields of an archive month doc. */
export function buildArchiveDoc(month, log, now = new Date()) {
  const days = Object.keys(log).filter(isDayKey).sort();
  const sorted = {};
  for (const d of days) sorted[d] = log[d];
  return {
    month,
    log: JSON.stringify(sorted),
    days: days.length,
    entries: days.reduce((n, d) => n + entryCount(sorted[d]), 0),
    v: ARCHIVE_VERSION,
    updatedAt: now.toISOString(),
  };
}

/** { 'YYYY-MM': dayMap } (as loaded) → one flat day map. */
export function flattenArchive(byMonth) {
  const out = {};
  for (const m of Object.keys(byMonth || {}).sort()) Object.assign(out, byMonth[m]);
  return out;
}

/** The full log a client shows: archived days under the live doc's. */
export function mergeArchiveUnder(archiveLog, live) {
  const out = { ...(archiveLog || {}) };
  for (const [d, day] of Object.entries(live || {})) {
    out[d] = out[d] ? mergeArchivedDay(out[d], day) : day;
  }
  return out;
}

/**
 * What a client should write to the live doc: its log minus every day that is
 * identical to the archived copy. With no archive (none yet, or it failed to
 * load) nothing is left out — the live doc keeps today's behaviour.
 */
export function omitArchivedDays(log, archiveLog) {
  if (!archiveLog || Object.keys(archiveLog).length === 0) return log;
  const out = {};
  for (const [d, day] of Object.entries(log || {})) {
    if (archiveLog[d] !== undefined && sameDay(day, archiveLog[d])) continue;
    out[d] = day;
  }
  return out;
}

/**
 * The sweep: which live days to file, by month, and the merged month maps.
 *
 * `live` is the live doc's log, `archiveByMonth` the current archive months
 * (only those touched need be present). Returns
 *   { cutoff, months: { 'YYYY-MM': { log: mergedMonthMap, days: [moved day keys] } } }
 */
export function planArchiveSweep(live, archiveByMonth, todayKey, keepDays = ARCHIVE_AFTER_DAYS) {
  const cutoff = archiveCutoff(todayKey, keepDays);
  const months = {};
  for (const d of Object.keys(live || {}).sort()) {
    if (!isDayKey(d) || d >= cutoff) continue;
    const m = monthOfDay(d);
    if (!months[m]) months[m] = { log: { ...(archiveByMonth?.[m] || {}) }, days: [] };
    const prev = months[m].log[d];
    months[m].log[d] = prev ? mergeArchivedDay(prev, live[d]) : live[d];
    months[m].days.push(d);
  }
  return { cutoff, months };
}
