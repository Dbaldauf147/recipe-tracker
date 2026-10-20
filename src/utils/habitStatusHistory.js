/**
 * A weekly count of how many habits sit at each status.
 *
 * A habit's status only ever says where it stands today, so nothing showed the
 * mix shifting — habits settling into Automatically, the On Hold pile growing.
 * This keeps one count per calendar week, the same way recipeStageHistory.js
 * does for recipe stages: the current week's row is rewritten in place while
 * the counts move, and freezes once the week rolls over.
 *
 * Stored as `habitStatusHistory` on the user doc, and the mobile app reads and
 * writes the SAME field (PrepDay src/utils/habitStatusHistory.ts) — keep the
 * row shape, the counting rules and the week maths identical in both.
 *
 *   { week: 'YYYY-MM-DD' (local Sunday), total, counts: { [status]: n },
 *     recordedAt: ISO, source?: 'backup' }
 *
 * Weeks run SUNDAY→SATURDAY, matching the weekly summary email.
 */

import { dayKey } from './localDate.js';

export const STATUS_HISTORY_FIELD = 'habitStatusHistory';
/** Last row this browser wrote, so the 60s nav poll doesn't re-read the field. */
const LAST_ROW_KEY = 'sunday-habit-status-last-row';
const MAX_WEEKS = 520;

export const NO_STATUS = 'No status';
/** Stack order, bottom to top: the order the Habits page lists statuses in. */
export const STATUS_ORDER = [
  'Current', 'Refreshing', 'Must Track', 'Automatically', 'Most Days',
  'Some Days', 'Rarely', 'On Hold', 'Not Started', 'Abandoned',
];
// Literal hex: Recharts can't resolve CSS variables in SVG attributes. Same
// values as HabitsPage's STATUS_COLOR and the mobile chart.
export const STATUS_HISTORY_COLORS = {
  'Current': '#2563eb',
  'Refreshing': '#0891b2',
  'Must Track': '#7c3aed',
  'Automatically': '#16a34a',
  'Most Days': '#65a30d',
  'Some Days': '#d97706',
  'Rarely': '#ea580c',
  'On Hold': '#64748b',
  'Not Started': '#94a3b8',
  'Abandoned': '#dc2626',
};
export const OTHER_STATUS_COLOR = '#cbd5e1';
export const statusHistoryColor = s => STATUS_HISTORY_COLORS[s] || OTHER_STATUS_COLOR;

const LEGACY = {
  'havent started': 'Not Started',
  "haven't started": 'Not Started',
  'haven’t started': 'Not Started',
  'tracked': 'Most Days',
};

/** The status a habit is counted under. */
export function canonStatus(status) {
  const s = String(status || '').trim();
  if (!s) return NO_STATUS;
  return LEGACY[s.toLowerCase()] || s;
}

/** Counts by status right now. Bad habits aren't counted — they have their own tab. */
export function countHabitStatuses(habits = []) {
  const counts = {};
  let total = 0;
  for (const h of habits || []) {
    if (!h || h.habitType === 'bad') continue;
    const s = canonStatus(h.status);
    counts[s] = (counts[s] || 0) + 1;
    total++;
  }
  return { total, counts };
}

/** The habits counted under `status` — same rules as countHabitStatuses. */
export function habitsWithStatus(habits = [], status) {
  return (habits || []).filter(h => h && h.habitType !== 'bad' && canonStatus(h.status) === status);
}

/** The newest full backup taken during `week` (a Sunday key), or null. */
export function backupForWeek(backups, week) {
  return backupsToBackfill(backups, []).find(w => w.week === week)?.backup || null;
}

/** Known statuses in STATUS_ORDER, then anything else A→Z, "No status" last. */
export function orderedStatuses(keys) {
  const set = new Set(keys);
  const known = STATUS_ORDER.filter(s => set.has(s));
  const other = [...set].filter(s => !STATUS_ORDER.includes(s) && s !== NO_STATUS).sort((a, b) => a.localeCompare(b));
  return [...known, ...other, ...(set.has(NO_STATUS) ? [NO_STATUS] : [])];
}

/** The Sunday that starts `date`'s week, from local calendar parts. */
export function weekStart(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return dayKey(d);
}

export function statusSnapshot(habits, now = new Date()) {
  return { week: weekStart(now), ...countHabitStatuses(habits), recordedAt: now.toISOString() };
}

// Key-order-blind: Firestore hands maps back with their keys sorted.
export function sameStatusCounts(a, b) {
  if (!a || !b || a.total !== b.total) return false;
  const ka = Object.keys(a.counts || {}), kb = Object.keys(b.counts || {});
  return ka.length === kb.length && ka.every(k => (b.counts || {})[k] === a.counts[k]);
}

export function upsertWeek(history, entry) {
  const rest = (Array.isArray(history) ? history : []).filter(r => r && r.week && r.week !== entry.week);
  return [...rest, entry].sort((a, b) => String(a.week).localeCompare(String(b.week))).slice(-MAX_WEEKS);
}

/** Fold this week's counts into `history` → `{ history, changed }`. */
export function recordHabitStatusWeek(history, habits, now = new Date()) {
  const entry = statusSnapshot(habits, now);
  const existing = (Array.isArray(history) ? history : []).find(r => r?.week === entry.week);
  if (existing && sameStatusCounts(existing, entry)) return { history, changed: false };
  return { history: upsertWeek(history, entry), changed: true };
}

/** Add rows for weeks not recorded yet; a recorded (live) week always wins. */
export function mergeMissingWeeks(history, rows) {
  let out = Array.isArray(history) ? history : [];
  const have = new Set(out.map(r => r?.week));
  let added = 0;
  for (const row of rows || []) {
    if (!row?.week || have.has(row.week)) continue;
    have.add(row.week);
    out = upsertWeek(out, row);
    added++;
  }
  return { history: out, added };
}

/** The latest backup in each week not already recorded, oldest first. */
export function backupsToBackfill(backups, have = []) {
  const skip = new Set(have.map(r => r?.week));
  const byWeek = new Map();
  for (const b of backups || []) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(b?.date || ''));
    if (!m) continue;
    const week = weekStart(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (skip.has(week)) continue;
    const prev = byWeek.get(week);
    if (!prev || String(b.date).localeCompare(String(prev.date)) > 0) byWeek.set(week, b);
  }
  return [...byWeek.entries()].map(([week, backup]) => ({ week, backup })).sort((a, b) => a.week.localeCompare(b.week));
}

export function backfilledRow(week, habits, backup) {
  return {
    week,
    ...countHabitStatuses(habits),
    recordedAt: backup?.timestamp || `${backup?.date || week}T00:00:00.000Z`,
    source: 'backup',
  };
}

/** 'Oct 18' / 'Oct 18, 2025' for a week's Sunday. */
export function formatWeekLabel(week, { year = 'auto' } = {}) {
  const [y, m, d] = String(week || '').split('-').map(Number);
  if (!y || !m || !d) return String(week || '');
  const showYear = year === true || (year === 'auto' && y !== new Date().getFullYear());
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(showYear ? { year: 'numeric' } : {}) });
}

/**
 * Take this week's reading if it moved. Safe to call on every habits load.
 *
 * Re-reads the stored field before writing: the phone writes it too, and
 * saving this browser's stale copy would drop weeks the phone recorded. A
 * localStorage copy of the last row written short-circuits the common case.
 * An empty habits list is an unhydrated load, never "zero habits".
 */
export async function recordHabitStatusSnapshot(habits, uid, now = new Date()) {
  if (!uid || !Array.isArray(habits) || habits.length === 0) return null;
  const entry = statusSnapshot(habits, now);
  try {
    const last = JSON.parse(localStorage.getItem(LAST_ROW_KEY) || 'null');
    if (last?.week === entry.week && sameStatusCounts(last, entry)) return null;
  } catch { /* fall through to the real read */ }
  // Lazy: firestoreSync pulls in firebase.js, which `node --test` can't load.
  const { loadField, saveField } = await import('./firestoreSync.js');
  const stored = await loadField(uid, STATUS_HISTORY_FIELD);
  const { history, changed } = recordHabitStatusWeek(Array.isArray(stored) ? stored : [], habits, now);
  if (changed) await saveField(uid, STATUS_HISTORY_FIELD, history);
  try { localStorage.setItem(LAST_ROW_KEY, JSON.stringify(entry)); } catch { /* quota */ }
  return changed ? history : null;
}
