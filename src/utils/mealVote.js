// The weekly meal vote: an email that offers the top Suggested Meals and lets
// each person tick the ones they want on next week's shopping list.
//
// Suggested Meals is ranked in the BROWSER — it reads the plan history, daily
// log, key ingredients and seasonal data the Recipes page already holds — and
// a cron has none of that. So the Recipes page publishes the inputs of its own
// ranking (the same snapshot utils/suggestForecast.js replays) and the server
// re-scores them for the day the email goes out. Days-since-eaten is stored as
// dates, not day counts, so the order stays right however old the snapshot is;
// anything logged since is folded in with applyLogToSnapshot.
//
// Everything here is pure and shared by the page (src/) and the routes (api/).
//
// Where it lives in Firestore:
//   users/{uid}.mealVoteSettings        { enabled, voters, sendDay, sendHour }
//   users/{uid}/data/mealVoteSnapshot   what buildMealVoteSnapshot returns
//   users/{uid}/data/mealVote           { weeks: { [weekOf]: ballot } }
// A ballot:
//   { weekOf, createdAt, lastSentAt, cronSent,
//     options: { breakfast: [option], 'lunch-dinner': [option] },
//              option = { id, title, joanne?: 'yes'|'no', why?: string }
//     voters:  { [voterId]: { name, email, token } },
//     votes:   { [voterId]: { picks: [recipeId], at } },
//     mail:    { [voterId]: { seenAt } } }   newest email reply handled
// People vote by replying to the email with meal numbers (mealVoteReply.js)
// or on the ballot page its one link opens.

import { NEVER_DAYS, SUGGEST_CATEGORIES, addDaysKey, daysBetweenKeys } from './suggestForecast.js';

/** Meals offered per column in the email. */
export const MEAL_VOTE_PER_COLUMN = 5;
export const MEAL_VOTE_MAX_VOTERS = 4;
/** Ballots kept on the doc; older ones are dropped when a new one is added. */
export const MEAL_VOTE_KEEP_WEEKS = 12;
export const MEAL_VOTE_COLUMN_LABEL = { breakfast: 'Breakfast', 'lunch-dinner': 'Lunch & Dinner' };
export const MEAL_VOTE_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Days without a key ingredient before it counts as a reason (as the page). */
export const MEAL_VOTE_OVERDUE_DAYS = 14;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function intInRange(v, min, max, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** Settings as stored, made safe to use: Friday 8am Eastern unless set. */
export function normalizeMealVoteSettings(raw) {
  const seen = new Set();
  const voters = [];
  for (const v of (Array.isArray(raw?.voters) ? raw.voters : [])) {
    const email = String(v?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    const name = String(v?.name || '').trim().slice(0, 40) || email.split('@')[0];
    voters.push({ name, email });
    if (voters.length >= MEAL_VOTE_MAX_VOTERS) break;
  }
  return {
    enabled: raw?.enabled === true,
    voters,
    sendDay: intInRange(raw?.sendDay, 0, 6, 5),
    sendHour: intInRange(raw?.sendHour, 0, 23, 8),
  };
}

/**
 * Is the weekly email due? From the send hour to the end of the send day, so
 * a run that failed at the hour is picked up by the next one; the ballot's
 * `cronSent` flag is what stops a second email.
 */
export function mealVoteDue(settings, { dayOfWeek, hour }) {
  const s = normalizeMealVoteSettings(settings);
  return s.enabled && s.voters.length > 0 && dayOfWeek === s.sendDay && hour >= s.sendHour;
}

/**
 * The week being voted on, as its Sunday (YYYY-MM-DD): the next Sunday on or
 * after the day the email goes out. The same Sunday-anchored week the rest of
 * the app uses, and the ballot's key — one ballot per week however many times
 * the email is sent.
 */
export function voteWeekOf(sendDateKey) {
  const [y, m, d] = sendDateKey.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysKey(sendDateKey, (7 - dow) % 7);
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'Nov 15' for a week key. */
export function weekLabel(weekOf) {
  if (!DATE_KEY_RE.test(String(weekOf || ''))) return '';
  const [, m, d] = weekOf.split('-').map(Number);
  return `${MON[m - 1]} ${d}`;
}

/**
 * Does Joanne like this recipe? 'yes', 'no' or '' (nobody has said).
 * The recipe's own `joanneLikes` field (set on the recipe pop-up and in the
 * mobile app) wins; failing that, its tags — "Joanne" is a yes and
 * "Not Joanne" a no, the same reading the Recipes list badge uses.
 */
export function joanneVerdict(recipe) {
  if (recipe?.joanneLikes === 'yes' || recipe?.joanneLikes === 'no') return recipe.joanneLikes;
  let verdict = '';
  for (const t of [...(recipe?.customTags || []), ...(recipe?.tags || [])]) {
    const s = String(t || '').trim();
    if (!/joanne/i.test(s)) continue;
    if (/^not\b/i.test(s)) return 'no';
    verdict = 'yes';
  }
  return verdict;
}

/**
 * What the Recipes page publishes for the cron: the ranking's inputs for the
 * two columns Suggested Meals has, plus titles so the email needs nothing
 * else. `forecastSnapshot` is the object RecipeList builds for
 * utils/suggestForecast.js.
 */
export function buildMealVoteSnapshot(forecastSnapshot, recipes) {
  if (!forecastSnapshot?.today || !Array.isArray(forecastSnapshot.candidates)) return null;
  const titleById = new Map((recipes || []).map(r => [r.id, String(r.title || '').trim()]));
  const recipeById = new Map((recipes || []).map(r => [r.id, r]));
  const candidates = [];
  const titles = {};
  for (const c of forecastSnapshot.candidates) {
    if (!c?.id || !SUGGEST_CATEGORIES.includes(c.category)) continue;
    const title = titleById.get(c.id);
    if (!title) continue;
    titles[c.id] = title;
    const likes = joanneVerdict(recipeById.get(c.id));
    const seasonal = (Array.isArray(c.seasonal) ? c.seasonal : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 6);
    candidates.push({
      // Only set when there is something to say — Firestore refuses undefined.
      ...(likes ? { joanne: likes } : {}),
      ...(seasonal.length ? { seasonal } : {}),
      ...(c.goalFit ? { goalFit: true } : {}),
      ...(c.boosted ? { boosted: true } : {}),
      id: c.id,
      category: c.category,
      lastCooked: c.lastCooked || null,
      ingredientFloor: c.ingredientFloor || null,
      ingredients: Array.isArray(c.ingredients) ? c.ingredients.filter(Boolean) : [],
      fixedPoints: Number(c.fixedPoints) || 0,
      availableFrom: c.availableFrom || null,
      planned: !!c.planned,
    });
  }
  if (candidates.length === 0) return null;
  return {
    today: forecastSnapshot.today,
    weights: {
      staleness: forecastSnapshot.weights?.staleness ?? 1,
      ingredients: forecastSnapshot.weights?.ingredients ?? 1,
    },
    // Firestore refuses an empty map key.
    ingredientDates: Object.fromEntries(
      Object.entries(forecastSnapshot.ingredientDates || {}).filter(([k, v]) => k && v),
    ),
    candidates,
    titles,
  };
}

/**
 * Fold a daily log into a snapshot: any recipe eaten later than the snapshot
 * knew about moves its own last-eaten date and its key ingredients'. Returns a
 * new snapshot; the dates only ever move forward, so it is safe to run on a
 * log the snapshot already covers.
 */
export function applyLogToSnapshot(snap, dailyLog) {
  if (!snap) return snap;
  const byId = new Map(snap.candidates.map(c => [c.id, { ...c }]));
  const ing = { ...(snap.ingredientDates || {}) };
  for (const [dateStr, day] of Object.entries(dailyLog || {})) {
    if (!DATE_KEY_RE.test(dateStr)) continue;
    for (const e of (day?.entries || [])) {
      if (e?.type !== 'recipe' || !e.recipeId) continue;
      const c = byId.get(e.recipeId);
      if (!c) continue;
      if (!c.lastCooked || dateStr > c.lastCooked) c.lastCooked = dateStr;
      for (const k of c.ingredients) if (!ing[k] || dateStr > ing[k]) ing[k] = dateStr;
    }
  }
  return { ...snap, ingredientDates: ing, candidates: snap.candidates.map(c => byId.get(c.id)) };
}

/**
 * The meals to put on a ballot: the top `perColumn` of each column, scored for
 * `dateKey` with the Suggested Meals sum (days since eaten + days since each
 * key ingredient + the seasonal / goal-fit / boost points fixed when the
 * snapshot was taken).
 *
 * Meals in the plan when the snapshot was taken are this week's meals. Within
 * a week of the snapshot they are left out — they are being eaten now, which
 * is how the page treats them. After that they count as eaten on the snapshot
 * day, along with their key ingredients.
 */
export function rankForVote(snap, dateKey, { perColumn = MEAL_VOTE_PER_COLUMN, includePlanned = false } = {}) {
  const out = Object.fromEntries(SUGGEST_CATEGORIES.map(c => [c, []]));
  if (!snap?.today || !Array.isArray(snap.candidates) || !DATE_KEY_RE.test(String(dateKey || ''))) return out;
  const wS = snap.weights?.staleness ?? 1;
  const wI = snap.weights?.ingredients ?? 1;
  const planStillCurrent = daysBetweenKeys(snap.today, dateKey) < 7;
  const ing = { ...(snap.ingredientDates || {}) };
  const later = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));
  const state = [];
  snap.candidates.forEach((c, order) => {
    if (!c.planned) { state.push({ ...c, order }); return; }
    if (planStillCurrent) {
      // (`includePlanned` is for describing meals already on a ballot.)
      if (includePlanned) state.push({ ...c, order });
      return;
    }
    for (const k of c.ingredients || []) ing[k] = later(ing[k], snap.today);
    state.push({ ...c, order, lastCooked: later(c.lastCooked, snap.today) });
  });
  const days = (from) => (from ? Math.max(0, daysBetweenKeys(from, dateKey)) : NEVER_DAYS);
  const scoreOf = (c) => {
    let s = c.fixedPoints || 0;
    s += wS * days(c.lastCooked);
    if (wI) for (const k of c.ingredients || []) s += wI * days(later(ing[k], c.ingredientFloor));
    return s;
  };
  // The same reasons the Suggested Meals cards give, in the same words.
  const describe = (c) => {
    const parts = [];
    if (c.boosted) parts.push('boosted');
    const since = days(c.lastCooked);
    if (since === NEVER_DAYS) parts.push('never cooked');
    else if (since >= 7) parts.push(`not cooked in ${since} days`);
    const overdue = wI
      ? (c.ingredients || []).filter(k => days(later(ing[k], c.ingredientFloor)) >= MEAL_VOTE_OVERDUE_DAYS)
      : [];
    if (overdue.length) parts.push(`has ${overdue.slice(0, 3).map(k => String(k).replace(/_/g, ' ')).join(', ')}`);
    if (c.seasonal?.length) parts.push(`in season: ${c.seasonal.slice(0, 2).join(', ')}`);
    if (c.goalFit) parts.push('fits your goals');
    return {
      id: c.id,
      title: snap.titles[c.id],
      ...(c.joanne ? { joanne: c.joanne } : {}),
      why: parts.join(' · ') || 'good variety pick',
    };
  };
  for (const cat of SUGGEST_CATEGORIES) {
    out[cat] = state
      .filter(c => c.category === cat && (!c.availableFrom || c.availableFrom <= dateKey) && snap.titles?.[c.id])
      .map(c => ({ c, s: scoreOf(c) }))
      .sort((a, b) => b.s - a.s || a.c.order - b.c.order)
      .slice(0, perColumn)
      .map(({ c }) => describe(c));
  }
  return out;
}

/** Every meal on a ballot, in column order. */
export function ballotOptions(ballot) {
  const out = [];
  for (const cat of SUGGEST_CATEGORIES) {
    for (const o of (ballot?.options?.[cat] || [])) if (o?.id) out.push({ ...o, category: cat });
  }
  return out;
}

/** A submitted set of picks, cut down to meals that are really on the ballot. */
export function sanitizePicks(ballot, picks) {
  const allowed = new Set(ballotOptions(ballot).map(o => o.id));
  const list = Array.isArray(picks) ? picks : (picks == null || picks === '' ? [] : [picks]);
  return [...new Set(list.map(p => String(p)).filter(p => allowed.has(p)))];
}

/** The voter a link's token belongs to, or null. */
export function voterForToken(ballot, token) {
  const t = String(token || '');
  if (t.length < 16) return null;
  for (const [id, v] of Object.entries(ballot?.voters || {})) {
    if (v?.token && v.token === t) return { id, name: v.name, email: v.email };
  }
  return null;
}

/**
 * A ballot counted up, per column, most-voted first (ballot order breaks
 * ties): { columns: { [cat]: [{id,title,voters:[name]}] }, voters: [{id,name,
 * voted}], anyVotes }.
 */
export function tallyBallot(ballot) {
  const voters = Object.entries(ballot?.voters || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, v]) => ({ id, name: v?.name || 'Someone', voted: !!ballot?.votes?.[id] }));
  const columns = {};
  for (const cat of SUGGEST_CATEGORIES) {
    columns[cat] = (ballot?.options?.[cat] || [])
      .map((o, order) => ({
        id: o.id,
        title: o.title,
        order,
        voters: voters.filter(v => (ballot?.votes?.[v.id]?.picks || []).includes(o.id)).map(v => v.name),
      }))
      .sort((a, b) => b.voters.length - a.voters.length || a.order - b.order)
      .map(row => ({ id: row.id, title: row.title, voters: row.voters }));
  }
  return { columns, voters, anyVotes: voters.some(v => v.voted) };
}

/** The ballot to show on the page: the newest week on the doc, or null. */
export function latestBallot(weeks) {
  const keys = Object.keys(weeks || {}).filter(k => DATE_KEY_RE.test(k)).sort();
  const key = keys[keys.length - 1];
  return key ? { ...weeks[key], weekOf: key } : null;
}

/** Week keys to delete so only the newest `keep` remain. */
export function weeksToPrune(weeks, keep = MEAL_VOTE_KEEP_WEEKS) {
  const keys = Object.keys(weeks || {}).filter(k => DATE_KEY_RE.test(k)).sort();
  return keys.slice(0, Math.max(0, keys.length - keep));
}

/**
 * A ballot made before the email had its "Joanne" and "why" columns, given
 * them from today's ranking. Meals stay exactly as they are — same ids, same
 * order, so the numbers people have already replied with still mean the same
 * meals. Returns the same options object when there is nothing to add.
 */
export function fillOptionDetails(options, snap, dateKey) {
  const all = SUGGEST_CATEGORIES.flatMap(cat => options?.[cat] || []);
  if (all.length === 0 || all.every(o => o.why)) return options;
  const fresh = new Map();
  const ranked = rankForVote(snap, dateKey, { perColumn: Infinity, includePlanned: true });
  for (const cat of SUGGEST_CATEGORIES) for (const o of ranked[cat]) fresh.set(o.id, o);
  const out = { ...options };
  for (const cat of SUGGEST_CATEGORIES) {
    out[cat] = (options?.[cat] || []).map(o => {
      const f = fresh.get(o.id);
      if (o.why || !f) return o;
      return { ...o, ...(f.joanne ? { joanne: f.joanne } : {}), why: f.why };
    });
  }
  return out;
}
