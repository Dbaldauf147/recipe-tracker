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
  const counts = emptyStageCounts();
  for (const recipe of recipes || []) {
    if (!recipe || recipe.source === 'shared-link') continue;
    tallyStage(counts, recipe);
  }
  return counts;
}

function emptyStageCounts() {
  const counts = { total: 0, [UNSET_KEY]: 0 };
  for (const key of STAGE_KEYS) counts[key] = 0;
  return counts;
}

function tallyStage(counts, recipe) {
  counts.total++;
  const stage = String(recipe.devStage || '').trim();
  if (STAGE_KEYS.includes(stage)) counts[stage]++;
  else counts[UNSET_KEY]++;
}

/** The meal categories broken out for the weekly email, in its order. */
export const COMMON_CATEGORIES = ['breakfast', 'lunch-dinner'];

/**
 * Stage counts for the COMMON recipes only, per meal category — the rotation
 * you actually cook from, as opposed to rare / to-try / retired ones.
 *
 * `frequency` and `category` fall back the same way the recipe list does
 * (no frequency = common, no category = lunch-dinner), so a recipe counts here
 * exactly when the Recipes page would list it under that heading. Categories
 * outside COMMON_CATEGORIES (snacks, desserts, drinks) aren't broken out.
 */
export function countCommonByCategory(recipes = []) {
  const out = {};
  for (const category of COMMON_CATEGORIES) out[category] = emptyStageCounts();
  for (const recipe of recipes || []) {
    if (!recipe || recipe.source === 'shared-link') continue;
    if ((recipe.frequency || 'common') !== 'common') continue;
    const bucket = out[recipe.category || 'lunch-dinner'];
    if (bucket) tallyStage(bucket, recipe);
  }
  return out;
}

/** The counts as they'd be stored for `now`'s week. */
export function stageSnapshot(recipes, now = new Date()) {
  return {
    week: weekStart(now),
    ...countStages(recipes),
    common: countCommonByCategory(recipes),
    recordedAt: now.toISOString(),
  };
}

/** True when two rows hold the same numbers (recordedAt aside). */
export function sameCounts(a, b) {
  if (!a || !b) return false;
  if (a.total !== b.total || a[UNSET_KEY] !== b[UNSET_KEY]) return false;
  if (!STAGE_KEYS.every(key => a[key] === b[key])) return false;
  // A row written before the per-category breakdown existed differs from one
  // with it, so the current week picks the breakdown up on its next reading.
  return JSON.stringify(a.common || null) === JSON.stringify(b.common || null);
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
  let out = Array.isArray(history) ? history : [];
  const byWeek = new Map(out.map(row => [row?.week, row]));
  let added = 0;
  let filled = 0;
  for (const row of rows || []) {
    if (!row?.week) continue;
    const existing = byWeek.get(row.week);
    if (existing) {
      // A recorded week keeps its own counts, but one written before the
      // per-category breakdown existed can take the breakdown from the backup.
      if (!existing.common && row.common) {
        const merged = { ...existing, common: row.common };
        byWeek.set(row.week, merged);
        out = upsertWeek(out, merged);
        filled++;
      }
      continue;
    }
    byWeek.set(row.week, row);
    out = upsertWeek(out, row);
    added++;
  }
  return { history: out, added, filled };
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
    common: countCommonByCategory(recipes),
    recordedAt: backup?.timestamp || `${backup?.date || week}T00:00:00.000Z`,
    source: 'backup',
  };
}

/**
 * One reading per calendar month of the common-recipe breakdown, oldest first,
 * for the weekly email's monthly charts.
 *
 * A month's reading is the LAST row recorded in it that carries the breakdown
 * (rows are dated by `recordedAt`, falling back to the week) — the state the
 * month ended on. `live`, when given, replaces the current month's reading with
 * the counts right now, so the last column is never stale just because the app
 * wasn't opened this week.
 *
 * Covers up to `months` months ending with `now`'s month, trimmed of leading
 * months with nothing recorded; a gap in the middle stays as a `null` reading
 * rather than a zero — nothing recorded is not the same as no recipes.
 * Returns `[{ month: 'YYYY-MM', counts: { breakfast, 'lunch-dinner' } | null }]`.
 */
export function monthlyCommonStages(history, { now = new Date(), months = 12, live = null } = {}) {
  const lastByMonth = new Map();
  for (const row of Array.isArray(history) ? history : []) {
    if (!row?.common) continue;
    const when = String(row.recordedAt || row.week || '');
    const month = when.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const prev = lastByMonth.get(month);
    if (!prev || when.localeCompare(prev.when) > 0) lastByMonth.set(month, { when, common: row.common });
  }
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const counts = i === 0 && live ? live : (lastByMonth.get(month)?.common || null);
    out.push({ month, counts });
  }
  while (out.length && !out[0].counts) out.shift();
  return out;
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
