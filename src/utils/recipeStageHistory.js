/**
 * A weekly count of how many recipes sit at each development stage.
 *
 * `devStage` (see recipeStage.js) says where a recipe stands TODAY — new,
 * being tuned, or nailed down. Nothing kept yesterday's answer, so there was
 * no way to see the collection settling over time: whether the pile of
 * work-in-progress recipes is actually shrinking, or just being topped up.
 *
 * This takes one count per calendar week and keeps it. The current week's row
 * is rewritten in place every time the counts move, so it always reads live;
 * once the week rolls over that row is frozen and a new one starts. Weeks with
 * no app usage simply have no row — the chart joins across the gap rather than
 * inventing a flat line through it.
 *
 * Weeks run SUNDAY→SATURDAY, matching the weekly progress summary email, so
 * "this week" means the same span everywhere in the app.
 */

import { dayKey } from './localDate.js';
import { RECIPE_STAGES } from './recipeStage.js';

/** localStorage key. Prefixed `sunday-` so the daily backup picks it up. */
export const STAGE_HISTORY_KEY = 'sunday-recipe-stage-history';
/** User-document field this mirrors to. */
export const STAGE_HISTORY_FIELD = 'recipeStageHistory';

/** Stage keys in chart order: earliest state first, settled last. */
export const STAGE_KEYS = RECIPE_STAGES.map(s => s.key);
/** Recipes with no stage chosen yet — counted, but not one of RECIPE_STAGES. */
export const UNSET_KEY = 'unset';

// Ten years of weekly rows is ~520 objects of six small numbers — well inside
// what the user doc can hold, and it means the series never silently loses its
// early history to a cap nobody remembers setting.
const MAX_WEEKS = 520;

/** A 'YYYY-MM-DD' key as a local Date at midnight. */
export function parseDayKey(key) {
  const [y, m, d] = String(key || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * The Sunday that starts `date`'s week, as a local 'YYYY-MM-DD' key.
 *
 * Built from local calendar parts (see localDate.js): a UTC-based version
 * files Saturday evening under next week west of UTC.
 */
export function weekStart(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return dayKey(d);
}

/**
 * How many recipes sit at each stage right now.
 *
 * Link recipes (`source: 'shared-link'`) are somebody else's cooking project —
 * their stage is set in the owner's account and moves without you — so they're
 * left out rather than counted as your work in progress.
 */
export function countStages(recipes = []) {
  const counts = { total: 0, [UNSET_KEY]: 0 };
  for (const key of STAGE_KEYS) counts[key] = 0;
  for (const recipe of recipes || []) {
    if (!recipe || recipe.source === 'shared-link') continue;
    counts.total++;
    const stage = String(recipe.devStage || '').trim();
    if (STAGE_KEYS.includes(stage)) counts[stage]++;
    else counts[UNSET_KEY]++;
  }
  return counts;
}

/** The counts as they'd be stored for `now`'s week. */
export function stageSnapshot(recipes, now = new Date()) {
  return {
    week: weekStart(now),
    ...countStages(recipes),
    recordedAt: now.toISOString(),
  };
}

/** True when two rows hold the same numbers (recordedAt aside). */
export function sameCounts(a, b) {
  if (!a || !b) return false;
  if (a.total !== b.total || a[UNSET_KEY] !== b[UNSET_KEY]) return false;
  return STAGE_KEYS.every(key => a[key] === b[key]);
}

/** Rows sorted oldest-first, one per week, newest write for a week winning. */
export function upsertWeek(history, entry) {
  const rest = (Array.isArray(history) ? history : []).filter(
    row => row && row.week && row.week !== entry.week
  );
  return [...rest, entry]
    .sort((a, b) => String(a.week).localeCompare(String(b.week)))
    .slice(-MAX_WEEKS);
}

/**
 * Fold today's counts into `history`.
 *
 * Returns `{ history, changed }` — `changed` false when this week's row already
 * says exactly this, which is the common case and saves a Firestore write on
 * every recipe edit that didn't touch a stage.
 */
export function recordStageWeek(history, recipes, now = new Date()) {
  const entry = stageSnapshot(recipes, now);
  const existing = (Array.isArray(history) ? history : []).find(row => row?.week === entry.week);
  if (existing && sameCounts(existing, entry)) return { history, changed: false };
  return { history: upsertWeek(history, entry), changed: true };
}

/**
 * Add rows for weeks the history doesn't have yet, leaving recorded weeks
 * alone. Used by the backup backfill: a reconstructed count is a good guess,
 * a live one is the truth, so the live one always wins.
 */
export function mergeMissingWeeks(history, rows) {
  const have = new Set((Array.isArray(history) ? history : []).map(row => row?.week));
  let out = Array.isArray(history) ? history : [];
  let added = 0;
  for (const row of rows || []) {
    if (!row?.week || have.has(row.week)) continue;
    have.add(row.week);
    out = upsertWeek(out, row);
    added++;
  }
  return { history: out, added };
}

/**
 * One backup per week — the LATEST snapshot taken in each week, since that's
 * the reading the week ended on and so the one comparable to a live row.
 *
 * Takes `listFullBackups()` output, returns `[{ week, backup }]` oldest-first.
 * Weeks already in `have` are dropped here rather than after fetching: each
 * backup costs a document read (several, for a chunked one), and the live row
 * would win anyway.
 */
export function backupsToBackfill(backups, have = []) {
  const skip = new Set(have.map(row => (typeof row === 'string' ? row : row?.week)));
  const byWeek = new Map();
  for (const backup of backups || []) {
    const date = String(backup?.date || '');
    const parsed = parseDayKey(date);
    if (!parsed) continue;
    const week = weekStart(parsed);
    if (skip.has(week)) continue;
    const prev = byWeek.get(week);
    if (!prev || date.localeCompare(String(prev.date)) > 0) byWeek.set(week, backup);
  }
  return [...byWeek.entries()]
    .map(([week, backup]) => ({ week, backup }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

/** A history row rebuilt from a backup, flagged so the table can say so. */
export function backfilledRow(week, recipes, backup) {
  return {
    week,
    ...countStages(recipes),
    recordedAt: backup?.timestamp || `${backup?.date || week}T00:00:00.000Z`,
    source: 'backup',
  };
}

/** 'Sep 21' / 'Sep 21, 2025' — the week's Sunday, short enough for an axis. */
export function formatWeekLabel(week, { year = 'auto' } = {}) {
  const [y, m, d] = String(week || '').split('-').map(Number);
  if (!y || !m || !d) return String(week || '');
  const date = new Date(y, m - 1, d);
  const showYear = year === true || (year === 'auto' && y !== new Date().getFullYear());
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(showYear ? { year: 'numeric' } : {}),
  });
}

// ── Storage ───────────────────────────────────────────────────────────────

export function loadStageHistory() {
  try {
    const raw = localStorage.getItem(STAGE_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Write the history everywhere it lives: the local cache, the user document,
 * and a `firestore-sync` event so an open Meal History tab repaints.
 */
export function saveStageHistory(entries, uid) {
  try {
    localStorage.setItem(STAGE_HISTORY_KEY, JSON.stringify(entries));
  } catch { /* quota — the Firestore copy is still the real one */ }
  // Imported lazily: firestoreSync pulls in firebase.js, which reads
  // `import.meta.env` and so can't be loaded by `node --test`. The math above
  // is what the tests care about, and this file must stay importable there.
  if (uid) {
    import('./firestoreSync.js')
      .then(m => m.saveField(uid, STAGE_HISTORY_FIELD, entries))
      .catch(err => console.error('stage history save failed:', err));
  }
  try { window.dispatchEvent(new Event('firestore-sync')); } catch { /* noop */ }
}

/**
 * Take this week's reading, if it moved. Safe to call on every recipe change.
 *
 * An empty recipe list means the cache hasn't hydrated yet, not that every
 * recipe was deleted — recording a zeroed week there would put a false trough
 * in the chart that the next render can't distinguish from a real one.
 */
export function recordStageSnapshot(recipes, uid, now = new Date()) {
  if (!Array.isArray(recipes) || recipes.length === 0) return null;
  const { history, changed } = recordStageWeek(loadStageHistory(), recipes, now);
  if (!changed) return null;
  saveStageHistory(history, uid);
  return history;
}
