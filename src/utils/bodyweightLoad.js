// "Use my body weight" for a logged exercise, and the one-time fix that turns
// the old placeholder weight of 1 into the body weight it stood for.
//
// An entry with `useBodyWeight: true` stores the weight it was done at in the
// ordinary `weight` field (canonical lb, as a string), so every reader that
// already understands `weight` — history, charts, the weekly email, older app
// builds — gets a real number with no special case. The flag is what makes the
// log editor keep that number pinned to your latest weigh-in.
//
// ⚠️ MIRRORED in PrepDay src/utils/bodyweightLoad.ts — the two apps write the
// same workout docs, so keep the rules (and the rounding) identical.

export const LB_PER_KG = 2.2046226218;

// Readings in lb, oldest first. The website writes lb and omits `unit`; the
// mobile app records whatever the scale was read in.
function readingsLb(weightLog) {
  return (Array.isArray(weightLog) ? weightLog : [])
    .filter(e => e && e.date && Number(e.weight) > 0)
    .map(e => ({
      date: String(e.date).slice(0, 10),
      lb: e.unit === 'kg' ? Number(e.weight) * LB_PER_KG : Number(e.weight),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** lb → the string a weight cell stores: one decimal, no trailing ".0". */
export function formatBodyweightLb(lb) {
  const r = Math.round(Number(lb) * 10) / 10;
  return Number.isFinite(r) && r > 0 ? String(r) : '';
}

/**
 * The body weight to log for a session on `dateKey`: the most recent weigh-in
 * on or before that day, or — when every weigh-in is later — the earliest one.
 * null when there are none at all.
 */
export function bodyweightLbOn(weightLog, dateKey) {
  const rs = readingsLb(weightLog);
  if (rs.length === 0) return null;
  let best = null;
  for (const r of rs) {
    if (r.date <= String(dateKey)) best = r; else break;
  }
  return (best || rs[0]).lb;
}

function dowOf(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function shiftKey(dateKey, days) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * The body weight for the week a workout was logged in (Sun–Sat, the app's
 * week everywhere). Within that week, the weigh-in nearest the workout day,
 * preferring one on or before it. With no weigh-in that week, the most recent
 * one before the week; with none before either, the earliest one after.
 */
export function bodyweightLbForWeek(weightLog, dateKey) {
  const rs = readingsLb(weightLog);
  if (rs.length === 0) return null;
  const day = String(dateKey).slice(0, 10);
  const start = shiftKey(day, -dowOf(day));
  const end = shiftKey(start, 6);
  const inWeek = rs.filter(r => r.date >= start && r.date <= end);
  if (inWeek.length > 0) {
    const onOrBefore = inWeek.filter(r => r.date <= day);
    return (onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : inWeek[0]).lb;
  }
  const before = rs.filter(r => r.date < start);
  return (before.length > 0 ? before[before.length - 1] : rs[0]).lb;
}

/**
 * Point every `useBodyWeight` entry at `bodyweightLb`. Returns the same array
 * when nothing changes, so it is safe to run on every render's state.
 */
export function applyBodyweightToEntries(entries, bodyweightLb) {
  const w = formatBodyweightLb(bodyweightLb);
  if (!w || !Array.isArray(entries)) return entries;
  let changed = false;
  const out = entries.map(e => {
    if (!e?.useBodyWeight || e.weight === w) return e;
    changed = true;
    return { ...e, weight: w };
  });
  return changed ? out : entries;
}

// A stored weight that is the old "1" placeholder: 1 lb, or 1 kg as the kg
// weight input stores it (2.2046 lb).
export function isPlaceholderOne(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return false;
  return Math.abs(n - 1) < 1e-9 || Math.abs(n - LB_PER_KG) < 0.01;
}

// Same stats the save path writes (enrichEntry), refreshed after the weight
// changes so totals in history and the email agree with the new number.
function withWeightStats(e) {
  let representative = e.weight;
  let perSetMax = 0;
  if (e.useSetWeights && Array.isArray(e.setWeights)) {
    const nums = e.setWeights.map(v => parseFloat(v || '')).filter(n => !isNaN(n));
    if (nums.length > 0) {
      perSetMax = Math.max(...nums);
      const first = e.setWeights.find(v => String(v ?? '').trim() !== '');
      if (first != null) representative = first;
    }
  }
  const base = e.useSetWeights && perSetMax > 0 ? perSetMax : (parseFloat(e.weight) || 0);
  const total = e.perArm ? base * 2 : base;
  const out = { ...e, weight: representative };
  // Only touch stats the entry already carries — a suggestedEntries template
  // row never had them and shouldn't grow them.
  if ('totalWeight' in e) out.totalWeight = total;
  if ('maxWeight' in e) out.maxWeight = total;
  return out;
}

function backfillEntry(e, bwStr) {
  if (!e || typeof e !== 'object') return e;
  let changed = false;
  let next = e;
  if (e.useSetWeights && Array.isArray(e.setWeights)) {
    if (e.setWeights.some(isPlaceholderOne)) {
      next = { ...next, setWeights: e.setWeights.map(v => (isPlaceholderOne(v) ? bwStr : v)) };
      changed = true;
    }
  } else if (isPlaceholderOne(e.weight)) {
    next = { ...next, weight: bwStr, useBodyWeight: true };
    changed = true;
  }
  if (!changed) return e;
  // Marks what was rewritten, so it can be found (and undone) later.
  return withWeightStats({ ...next, bodyweightBackfill: '1' });
}

/**
 * The one-time history fix: every logged weight of 1 becomes the body weight
 * for the week it was logged in (bodyweightLbForWeek). A single-weight entry
 * also gets `useBodyWeight`, so refilling that exercise next time keeps
 * tracking your weight; per-set weights only have their 1s replaced.
 *
 * Returns only the workouts that changed, plus how many entries were touched.
 * Does nothing when there are no weigh-ins to fill from.
 */
export function backfillBodyweightOnes(workouts, weightLog) {
  if (readingsLb(weightLog).length === 0) return { changed: [], entries: 0 };
  const changed = [];
  let count = 0;
  for (const w of Array.isArray(workouts) ? workouts : []) {
    if (!w?.date) continue;
    const bwStr = formatBodyweightLb(bodyweightLbForWeek(weightLog, w.date));
    if (!bwStr) continue;
    let touched = false;
    const fix = list => (Array.isArray(list) ? list.map(e => {
      const n = backfillEntry(e, bwStr);
      if (n !== e) { touched = true; return n; }
      return e;
    }) : list);
    const entries = fix(w.entries);
    const loggedTouched = touched;
    const suggestedEntries = fix(w.suggestedEntries);
    if (!touched) continue;
    if (loggedTouched) count += entries.filter((e, i) => e !== w.entries[i]).length;
    changed.push({ ...w, entries, ...(w.suggestedEntries ? { suggestedEntries } : {}) });
  }
  return { changed, entries: count };
}

/** The user-doc field that records the one-time fix ran (shared by both apps). */
export const BODYWEIGHT_BACKFILL_FIELD = 'bodyweightBackfillAt';
