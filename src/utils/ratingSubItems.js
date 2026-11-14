// Sub-items for an Eating Out rating category.
//
// A category ("Food", "Service", …) can be rated in one go with its stars, or
// item by item: tap the category name and a pop-up lists its sub-items, each
// with its own 1–5 stars. The category's stars are then the average of the
// sub-items you rated, rounded to a whole star — the same integer a direct
// rating stores, so the card badge, Rankings and the phone app read it exactly
// as before.
//
// Two things are stored:
//   users/{uid}.eatingOutRatingSubItems   { [group]: [{ key, label }] }
//     Your STANDARD sub-items: defined once, offered on every spot. Grouped by
//     the category's label rather than its key, because the `food` key is
//     relabelled per bucket (Food / Dessert / Drinks / Coffee) and "Espresso"
//     belongs under Coffee, not under a steakhouse's Food. Same label, same
//     list — so Service is one list across every bucket.
//   eatingOutRatings/{…}.subScores        { [categoryKey]: { [subKey]: 1–5 } }
//     What you gave each sub-item at this spot, next to the `scores` it drives.
//
// Pure: no Firestore, no React.

export const MAX_SUB_ITEMS = 20;
const MAX_LABEL = 40;

const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const validScore = (v) => typeof v === 'number' && v >= 1 && v <= 5;

/** Which standard list a category uses: its label, slugged. */
export function subItemGroupKey(label) {
  return slug(label) || 'rating';
}

function sanitizeList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const it of list) {
    const key = typeof it?.key === 'string' ? it.key.trim() : '';
    const label = typeof it?.label === 'string' ? it.label.trim().slice(0, MAX_LABEL) : '';
    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label });
    if (out.length >= MAX_SUB_ITEMS) break;
  }
  return out;
}

/** The stored standard lists, made safe: well-formed rows, empty groups dropped. */
export function sanitizeSubItemLists(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [group, list] of Object.entries(raw)) {
    const clean = sanitizeList(list);
    if (group && clean.length) out[group] = clean;
  }
  return out;
}

/**
 * Add a standard sub-item. Returns { lists, key, error }: `error` is a
 * sentence for the user when nothing was added.
 */
export function addSubItem(lists, group, label) {
  const clean = sanitizeSubItemLists(lists);
  const text = String(label || '').trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL);
  const key = slug(text);
  if (!key) return { lists: clean, key: null, error: 'Type a name for the item.' };
  const current = clean[group] || [];
  if (current.some(it => it.key === key)) return { lists: clean, key: null, error: `"${text}" is already on the list.` };
  if (current.length >= MAX_SUB_ITEMS) return { lists: clean, key: null, error: `That's the limit — ${MAX_SUB_ITEMS} items per category.` };
  return { lists: { ...clean, [group]: [...current, { key, label: text }] }, key, error: null };
}

/** Take a sub-item off the standard list. Scores already given are not touched. */
export function removeSubItem(lists, group, key) {
  const clean = sanitizeSubItemLists(lists);
  const next = (clean[group] || []).filter(it => it.key !== key);
  const out = { ...clean };
  if (next.length) out[group] = next; else delete out[group];
  return out;
}

/** One category's sub-scores, keeping only real 1–5 values. */
export function cleanCategorySubScores(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) if (k && validScore(v)) out[k] = Math.round(v);
  return out;
}

/** A rating doc's whole `subScores` map, cleaned; empty categories dropped. */
export function cleanSubScores(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [cat, subs] of Object.entries(raw)) {
    const clean = cleanCategorySubScores(subs);
    if (cat && Object.keys(clean).length) out[cat] = clean;
  }
  return out;
}

/**
 * The stars a category gets from its sub-items: their average, rounded to a
 * whole star (2.5 rounds up). Null when none is rated.
 */
export function deriveCategoryScore(categorySubScores) {
  const vals = Object.values(cleanCategorySubScores(categorySubScores));
  if (vals.length === 0) return null;
  return Math.min(5, Math.max(1, Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)));
}

/** The unrounded average and how many sub-items it covers, for display. */
export function subScoreSummary(categorySubScores) {
  const vals = Object.values(cleanCategorySubScores(categorySubScores));
  return { count: vals.length, average: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
}

/**
 * Rows for the pop-up: the standard list, then anything rated at this spot
 * that has since come off the list (`removed`) — taking an item off the
 * standard list must not silently change a rating already given.
 */
export function subItemRows(lists, group, categorySubScores) {
  const standard = sanitizeSubItemLists(lists)[group] || [];
  const mine = cleanCategorySubScores(categorySubScores);
  const seen = new Set(standard.map(it => it.key));
  const rows = standard.map(it => ({ ...it, removed: false }));
  for (const key of Object.keys(mine)) {
    if (seen.has(key)) continue;
    rows.push({ key, label: key.replace(/-/g, ' ').replace(/^./, ch => ch.toUpperCase()), removed: true });
  }
  return rows;
}

/**
 * Set (or clear, with null) one sub-item's stars and re-derive its category.
 * Returns new { scores, subScores }. Clearing the last sub-item clears the
 * category too: its stars came from the items, so with none left there is
 * nothing for them to stand on.
 */
export function applySubScore(scores, subScores, categoryKey, subKey, value) {
  const all = cleanSubScores(subScores);
  const cat = { ...(all[categoryKey] || {}) };
  if (validScore(value)) cat[subKey] = Math.round(value); else delete cat[subKey];
  const nextSub = { ...all };
  if (Object.keys(cat).length) nextSub[categoryKey] = cat; else delete nextSub[categoryKey];
  return {
    scores: { ...(scores || {}), [categoryKey]: deriveCategoryScore(cat) },
    subScores: nextSub,
  };
}
