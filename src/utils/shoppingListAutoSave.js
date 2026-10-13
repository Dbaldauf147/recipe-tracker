/* Shopping lists save themselves.

   "Reset Shopping List" used to be the ONLY thing that archived a list into
   Meal History (`planHistory`). Skip the button — or shop from the phone,
   which has no Reset — and that list was never recorded. (Sep 10 → Oct 11
   2026 lost four weeks of lists that way.)

   Now a recipe on the shopping list counts as SHOPPED once either:
     • a meal of it is logged in the daily log on/after it went on the list, or
     • it has sat on the list for SHOPPED_AFTER_DAYS (3) days.
   The first shopped recipe saves the list as an entry with
   `source: 'auto-list'`. Every recipe on the list that no saved list covers
   yet goes into it, plus the hand-added extras. Recipes added later in the
   same TRIP_DAYS (7) days join that same entry, and after that a new list
   starts.

   A recipe stays on the list after Reset (Reset clears the extras, not the
   meals), so the recipe is "covered" by any saved list that holds it and was
   saved on/after the day the recipe went on the list. Leftovers eaten after
   Reset therefore never start a duplicate list.

   `shoppingListSince` ({ recipeId: 'YYYY-MM-DD' }, user doc) remembers when
   each recipe went on the list. A recipe first seen here is backdated to its
   earliest logged meal in the last week, so a list built on the phone and
   eaten from before the website was opened still gets the right start date.

   Pure: no Firebase, no localStorage — tested under node --test. */

import { activeEntries } from './dailyTotals.js';

export const SHOPPED_AFTER_DAYS = 3;
export const TRIP_DAYS = 7;
export const BACKDATE_DAYS = 7;
export const DUPLICATE_DAYS = 10;

const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseKey(key) {
  const [y, m, d] = String(key || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}
export function addDays(key, n) {
  const d = parseKey(key);
  return d ? keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)) : key;
}
function daysBetween(a, b) {
  const da = parseKey(a), db = parseKey(b);
  return da && db ? Math.round((db - da) / 86400000) : 0;
}

const isList = e => !!e && typeof e === 'object' && !!e.date && e.source !== 'week-plan';
const savedOn = e => e.savedOn || e.date;

/** Days ('YYYY-MM-DD', ascending) in [from, to] with a LOGGED meal of `recipeId`. */
export function loggedDays(dailyLog, recipeId, from, to) {
  const out = [];
  for (const day of Object.keys(dailyLog || {}).sort()) {
    if (day < from || day > to) continue;
    // Prepare-table suggestions are plans, not meals eaten.
    if (activeEntries(dailyLog[day]).some(e => e?.recipeId === recipeId && !e.autoSuggested)) out.push(day);
  }
  return out;
}

/**
 * Index of the auto-saved list still open on `today` (started within
 * TRIP_DAYS, no Reset since) — this week's list, still being shopped from —
 * or -1.
 */
export function openAutoIndex(history, today) {
  if (!Array.isArray(history)) return -1;
  let idx = -1;
  history.forEach((e, i) => {
    if (e?.source !== 'auto-list' || e.date < addDays(today, -(TRIP_DAYS - 1))) return;
    if (idx < 0 || e.date >= history[idx].date) idx = i;
  });
  if (idx < 0) return -1;
  const start = history[idx].date;
  const resetSince = history.some(e => isList(e) && e.source !== 'auto-list' && e.date >= start);
  return resetSince ? -1 : idx;
}

/**
 * One pass over the current list.
 *
 * { plan: recipeId[], since: {id: date}, history: planHistory, dailyLog,
 *   extras: string[] (hand-added), autoPicks: string[] (the week's auto snack
 *   + fruit), today: 'YYYY-MM-DD', nowIso }
 *
 * The auto picks are FROZEN on the first save: eating this week's snack makes
 * another one the longest-since, and without the freeze every snack you eat
 * would pull the next one onto the saved list.
 * → { since, history: next planHistory | null (unchanged), saved: recipeId[] }
 */
export function autoSaveShoppingList({ plan = [], since = {}, history = [], dailyLog = {}, extras = [], autoPicks = [], today, nowIso }) {
  const ids = [...new Set((plan || []).filter(Boolean))];
  const hist = Array.isArray(history) ? history : [];

  const nextSince = {};
  for (const id of ids) {
    if (since && since[id]) { nextSince[id] = since[id]; continue; }
    const early = loggedDays(dailyLog, id, addDays(today, -(BACKDATE_DAYS - 1)), today)[0];
    nextSince[id] = early && early < today ? early : today;
  }

  const covered = id => hist.some(e => isList(e) && (e.recipeIds || []).includes(id) && savedOn(e) >= nextSince[id]);
  const recent = addDays(today, -(DUPLICATE_DAYS - 1));
  const listedRecently = id => hist.some(e => isList(e) && (e.recipeIds || []).includes(id) && e.date >= recent && e.date <= today);
  let uncovered = ids.filter(id => !covered(id));
  if (uncovered.every(listedRecently)) uncovered = [];
  const shopped = uncovered.filter(id =>
    daysBetween(nextSince[id], today) >= SHOPPED_AFTER_DAYS ||
    loggedDays(dailyLog, id, nextSince[id], today).length > 0);
  if (shopped.length === 0) return { since: nextSince, history: null, saved: [] };

  const clean = list => [...new Set((list || []).map(n => String(n || '').trim()).filter(Boolean))];
  const extraNames = clean(extras);
  const pickNames = clean(autoPicks);
  const open = openAutoIndex(hist, today);
  let next;
  if (open >= 0) {
    const e = hist[open];
    const addPicks = Array.isArray(e.autoPicks) ? [] : pickNames;
    next = hist.slice();
    next[open] = {
      ...e,
      recipeIds: [...new Set([...(e.recipeIds || []), ...uncovered])],
      extras: [...new Set([...(e.extras || []), ...extraNames, ...addPicks])],
      ...(Array.isArray(e.autoPicks) || !pickNames.length ? {} : { autoPicks: pickNames }),
      savedOn: today,
    };
  } else {
    const start = uncovered.map(id => nextSince[id]).sort()[0];
    const entry = { date: start, recipeIds: uncovered, timestamp: nowIso, savedOn: today, source: 'auto-list' };
    const all = clean([...extraNames, ...pickNames]);
    if (all.length) entry.extras = all;
    if (pickNames.length) entry.autoPicks = pickNames;
    next = [...hist, entry];
  }
  return { since: nextSince, history: next, saved: uncovered };
}

/**
 * Append a Reset Shopping List entry, folding in the auto-saved list it
 * finishes: that entry is dropped and its recipes join the Reset's, so one
 * shopping trip is one card rather than two.
 */
export function appendResetEntry(history, entry, today) {
  const hist = Array.isArray(history) ? history : [];
  const open = openAutoIndex(hist, today);
  if (open < 0) return [...hist, entry];
  const auto = hist[open];
  const merged = {
    ...entry,
    recipeIds: [...new Set([...(auto.recipeIds || []), ...(entry.recipeIds || [])])],
  };
  // The auto-saved list already holds the week's snack/fruit, frozen when it
  // was first saved; a pick that has drifted since (you ate the first one)
  // isn't a second purchase.
  const drifted = Array.isArray(auto.autoPicks) ? new Set((entry.autoPicks || []).map(n => String(n).toLowerCase())) : new Set();
  const resetExtras = (entry.extras || []).filter(n => !drifted.has(String(n).toLowerCase()) || (auto.extras || []).includes(n));
  const extras = [...new Set([...(auto.extras || []), ...resetExtras])];
  if (extras.length) merged.extras = extras;
  if (Array.isArray(auto.autoPicks)) merged.autoPicks = auto.autoPicks;
  return [...hist.filter((_, i) => i !== open), merged];
}
