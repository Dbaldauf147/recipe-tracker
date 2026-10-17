// "When will this meal be suggested next?" — the line on the recipe pop-up.
//
// Suggested Meals is a ranking, not a schedule: the top SUGGEST_TOP_N of each
// column (Breakfast, Lunch & Dinner) by score are what's suggested, and a meal
// you cook drops to the bottom. So "next" can only be an estimate. This replays
// the ranking one day at a time from today, assuming you keep cooking from the
// top of each column at your usual pace (the snapshot's `pace`, from your log):
// every simulated cook resets that meal's days-since-eaten AND its key
// ingredients', exactly as a real log would. The first day the meal makes the
// top N is the answer.
//
// What it does NOT model: seasonal-ingredient bonuses changing month to month
// (they stay at today's value), macro fit, or meals you cook that aren't
// suggested. It's a pace-based estimate, and the UI says so.
//
// The Recipes list builds the snapshot from the same numbers it ranks with and
// publishes it here (publishSuggestionSnapshot); the recipe pop-up reads it.
//
// MIRRORED in PrepDay/src/utils/suggestForecast.ts — change both together
// (the tests match too).

export const SUGGEST_TOP_N = 10;
/** Days a never-eaten meal or ingredient counts as — fixed, it doesn't grow. */
export const NEVER_DAYS = 9999;
/** How far ahead to look before saying "not within a year". */
export const FORECAST_MAX_DAYS = 365;
/** Columns Suggested Meals has. */
export const SUGGEST_CATEGORIES = ['breakfast', 'lunch-dinner'];

// ── Snapshot store ──────────────────────────────────────────────────────────
let snapshot = null;
const listeners = new Set();
export function publishSuggestionSnapshot(next) {
  snapshot = next || null;
  for (const fn of listeners) fn();
}
export function getSuggestionSnapshot() {
  return snapshot;
}
export function subscribeSuggestionSnapshot(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ── Date keys (YYYY-MM-DD), in UTC so DST never makes a day 23 hours ────────
function keyToUtc(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function addDaysKey(key, n) {
  const t = new Date(keyToUtc(key) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
export function daysBetweenKeys(from, to) {
  return Math.round((keyToUtc(to) - keyToUtc(from)) / 86400000);
}

/**
 * Meals per day you cook in each column, from the daily log: distinct
 * (day, recipe) entries over the last `windowDays` days. Floored at one a week
 * so a quiet month doesn't freeze the forecast.
 */
export function suggestPaceFromLog(dailyLog, recipeById, todayKey, windowDays = 28) {
  const from = addDaysKey(todayKey, -windowDays);
  const counts = Object.fromEntries(SUGGEST_CATEGORIES.map(c => [c, 0]));
  for (const [dateStr, day] of Object.entries(dailyLog || {})) {
    if (dateStr < from || dateStr >= todayKey) continue; // the 28 full days before today
    const seen = new Set();
    for (const e of (day?.entries || [])) {
      if (e?.type !== 'recipe' || !e.recipeId || seen.has(e.recipeId)) continue;
      seen.add(e.recipeId);
      const cat = recipeById.get(e.recipeId)?.category;
      if (cat in counts) counts[cat]++;
    }
  }
  const pace = {};
  for (const c of SUGGEST_CATEGORIES) pace[c] = Math.max(counts[c] / windowDays, 1 / 7);
  return pace;
}

/**
 * Snapshot shape:
 * {
 *   today: 'YYYY-MM-DD',
 *   weights: { staleness, ingredients },        // multipliers (0 when off)
 *   ingredientDates: { [normKey]: 'YYYY-MM-DD' }, // last eaten, absent = never
 *   pace: { breakfast, 'lunch-dinner' },        // meals per day
 *   candidates: [{
 *     id, category,
 *     lastCooked: 'YYYY-MM-DD' | null,  // incl. a "back of the line" date
 *     ingredientFloor: 'YYYY-MM-DD' | null, // the requeue date, applied to its ingredients
 *     ingredients: [normKey],
 *     fixedPoints,                     // seasonal + macro + boost, already weighted
 *     availableFrom: 'YYYY-MM-DD' | null, // skipped / out of season until then
 *     waiting: 'skip' | 'season' | undefined, // why availableFrom is set
 *     planned: boolean,                // in this week's plan
 *   }],
 *   excluded: { [id]: reason },        // not offered at all: 'retired' | 'rare' | 'toTry' | 'filtered' | 'filter:<name>'
 * }
 *
 * Result, or null when there's nothing to say:
 *   { kind: 'now', rank, category }
 *   { kind: 'later', date, days, rankNow, category, waitingFor: null | 'skip' | 'season', until }
 *   { kind: 'this-week', category }
 *   { kind: 'filtered', category, reason }
 *   { kind: 'no-column', category }   // a category Suggested Meals has no column for
 *   { kind: 'not-soon', rankNow, category, scoreNow, cutoff, lastCooked }
 */
export function forecastSuggestion(snap, recipeId, { topN = SUGGEST_TOP_N, maxDays = FORECAST_MAX_DAYS } = {}) {
  if (!snap || !recipeId) return null;
  const reason = snap.excluded?.[recipeId];
  if (reason) return { kind: 'filtered', category: null, reason };
  const target = snap.candidates.find(c => c.id === recipeId);
  if (!target) return null;
  if (!SUGGEST_CATEGORIES.includes(target.category)) {
    return target.category ? { kind: 'no-column', category: target.category } : null;
  }
  if (target.planned) return { kind: 'this-week', category: target.category };

  const today = snap.today;
  const wS = snap.weights?.staleness ?? 1;
  const wI = snap.weights?.ingredients ?? 1;
  const ing = { ...(snap.ingredientDates || {}) };
  // This week's meals are as good as eaten: they sit out today and come back
  // tomorrow at the bottom, and their key ingredients count as eaten today.
  const state = snap.candidates.map((c, order) => {
    if (!c.planned) return { ...c, order };
    for (const k of c.ingredients) ing[k] = today;
    return { ...c, order, lastCooked: today, availableFrom: addDaysKey(today, 1) };
  });

  const scoreOf = (c, date) => {
    let s = c.fixedPoints || 0;
    s += wS * (c.lastCooked ? daysBetweenKeys(c.lastCooked, date) : NEVER_DAYS);
    if (wI) {
      for (const k of c.ingredients) {
        const d = c.ingredientFloor && (!ing[k] || c.ingredientFloor > ing[k]) ? c.ingredientFloor : ing[k];
        s += wI * (d ? daysBetweenKeys(d, date) : NEVER_DAYS);
      }
    }
    return s;
  };
  const ranked = (cat, date) => state
    .filter(c => c.category === cat && (!c.availableFrom || c.availableFrom <= date))
    .map(c => ({ c, s: scoreOf(c, date) }))
    // Stable on the list's own order, the same tiebreak the real sort has.
    .sort((a, b) => b.s - a.s || a.c.order - b.c.order)
    .map(x => x.c);

  const me = state.find(c => c.id === recipeId);
  const credit = Object.fromEntries(SUGGEST_CATEGORIES.map(c => [c, 0]));
  let rankNow = null;
  let scoreNow = null;
  let cutoff = null;
  for (let d = 0; d <= maxDays; d++) {
    const date = addDaysKey(today, d);
    const list = ranked(target.category, date);
    const at = list.indexOf(me);
    if (d === 0 && at >= 0) rankNow = at + 1;
    if (d === 0) {
      // Today's score against the last place that's shown, so a meal that
      // won't come up can say how far short it is.
      if (at >= 0) scoreNow = Math.round(scoreOf(me, date));
      if (list.length >= topN) cutoff = Math.round(scoreOf(list[topN - 1], date));
    }
    if (at >= 0 && at < topN) {
      if (d === 0) return { kind: 'now', rank: at + 1, category: target.category };
      const waitingFor = target.availableFrom && target.availableFrom > today
        ? (target.waiting || 'skip') : null;
      return {
        kind: 'later', date, days: d, rankNow, category: target.category,
        waitingFor, until: waitingFor ? target.availableFrom : null,
      };
    }
    // Cook today's share from the top of each column.
    for (const cat of SUGGEST_CATEGORIES) {
      credit[cat] += snap.pace?.[cat] ?? 1 / 7;
      while (credit[cat] >= 1) {
        credit[cat] -= 1;
        const top = ranked(cat, date).find(c => c !== me);
        if (!top) break;
        top.lastCooked = date;
        top.ingredientFloor = null;
        for (const k of top.ingredients) ing[k] = date;
      }
    }
  }
  return { kind: 'not-soon', rankNow, category: target.category, scoreNow, cutoff, lastCooked: target.lastCooked };
}

/** First day of the next month (from today) a seasonal-only recipe is in season. */
export function nextInSeasonKey(todayKey, inSeasonForMonth) {
  const [y, m] = todayKey.split('-').map(Number);
  for (let i = 1; i <= 12; i++) {
    const mm = ((m - 1 + i) % 12) + 1;
    const yy = y + Math.floor((m - 1 + i) / 12);
    if (inSeasonForMonth(mm)) return `${yy}-${String(mm).padStart(2, '0')}-01`;
  }
  return null;
}

const COLUMN_LABEL = { breakfast: 'Breakfast', 'lunch-dinner': 'Lunch & Dinner' };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'Tue, Nov 3' for a YYYY-MM-DD key (adds the year when it isn't this one). */
export function friendlyDateKey(key, todayKey) {
  const [y, m, d] = key.split('-').map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const sameYear = todayKey && todayKey.slice(0, 4) === key.slice(0, 4);
  return `${dow}, ${MON[m - 1]} ${d}${sameYear ? '' : `, ${y}`}`;
}

// Category values as people say them, for the "no column" line.
const CATEGORY_WORD = { snacks: 'Snacks', desserts: 'Desserts', drinks: 'Drinks' };

/** One sentence on why a meal isn't offered at all. */
function excludedReasonText(reason) {
  switch (reason) {
    case 'retired': return 'It’s marked Retired. Change its frequency to bring it back.';
    case 'rare': return 'It’s marked Rare, and Rare recipes are left out. Include them from the Suggested Meals settings (gear), or make it Common.';
    case 'toTry': return 'It’s marked To Try, and To Try recipes are left out. Include them from the Suggested Meals settings (gear), or make it Common.';
    default: {
      const which = typeof reason === 'string' && reason.startsWith('filter:') ? reason.slice(7) : '';
      return which
        ? `The Recipes list’s ${which} filter is hiding it — Suggested Meals uses the same filters.`
        : 'The Recipes list’s filters leave it out — Suggested Meals uses the same filters.';
    }
  }
}

/**
 * The words for a forecast: { headline, detail } — detail may be ''.
 * `snap` supplies today and the pace ("about 4 a week").
 */
export function describeForecast(f, snap) {
  if (!f) return null;
  const col = COLUMN_LABEL[f.category] || '';
  const perWeek = f.category && snap?.pace?.[f.category] != null
    ? Math.max(1, Math.round(snap.pace[f.category] * 7)) : null;
  const paceNote = perWeek ? `Estimate, if you keep cooking about ${perWeek} suggested ${col} meal${perWeek === 1 ? '' : 's'} a week.` : '';
  switch (f.kind) {
    case 'now':
      return { headline: `In Suggested Meals now — #${f.rank} in ${col}`, detail: '' };
    case 'later': {
      const when = f.days === 1 ? 'tomorrow' : `in ${f.days} days`;
      const why = f.waitingFor === 'skip' ? `Skipped until ${friendlyDateKey(f.until, snap?.today)}. `
        : f.waitingFor === 'season' ? `Out of season until ${friendlyDateKey(f.until, snap?.today)}. `
        : f.rankNow ? `#${f.rankNow} in ${col} today. ` : '';
      return {
        headline: `Next in Suggested Meals: around ${friendlyDateKey(f.date, snap?.today)} (${when})`,
        detail: `${why}${paceNote}`.trim(),
      };
    }
    case 'this-week':
      return { headline: 'In this week’s plan, so it isn’t suggested right now', detail: '' };
    case 'filtered':
      return { headline: 'Not in Suggested Meals', detail: excludedReasonText(f.reason) };
    case 'no-column':
      return {
        headline: 'Not in Suggested Meals',
        detail: `Suggested Meals only has Breakfast and Lunch & Dinner columns — this one is filed as ${CATEGORY_WORD[f.category] || f.category}. Change its category to bring it in.`,
      };
    case 'not-soon': {
      // Why it never makes the cut: today's score against the last place shown.
      const gap = f.scoreNow != null && f.cutoff != null
        ? `It scores ${f.scoreNow.toLocaleString()} today; the list starts at ${f.cutoff.toLocaleString()}. ` : '';
      const ate = f.lastCooked && snap?.today
        ? (() => { const d = daysBetweenKeys(f.lastCooked, snap.today); return d <= 0 ? 'Eaten today, so it starts from zero. ' : d < 30 ? `Eaten ${d} day${d === 1 ? '' : 's'} ago, so it’s near the back of the line. ` : ''; })()
        : '';
      return {
        headline: 'Not likely to be suggested within a year',
        detail: `${f.rankNow ? `#${f.rankNow} in ${col} today. ` : ''}${gap}${ate}Meals ahead of it keep scoring higher — usually longer since they were eaten, or a better fit to your goals and season. ${paceNote}`.trim(),
      };
    }
    default:
      return null;
  }
}
