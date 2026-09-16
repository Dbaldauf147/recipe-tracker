// What a single day of the food log adds up to — one rule, shared by the
// Daily Tracker's "Daily Totals vs Goals" card and Meal History's Daily tab,
// so the two can never disagree about the same day.
//
// Imports the catalogue from ./nutrients (not ./nutrition, which reads
// import.meta.env and can't be loaded by `node --test`).
import { NUTRIENTS } from './nutrients.js';

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

// A logged entry's meal slot, defaulting the way the tracker does: an
// uncategorised custom entry counts as a snack.
export function entrySlot(entry) {
  if (entry?.type === 'custom' && !entry.mealSlot) return 'snack';
  return MEAL_SLOTS.includes(entry?.mealSlot) ? entry.mealSlot : 'snack';
}

// The entries that count towards the day: everything logged, minus the slots
// marked skipped that day.
export function activeEntries(day) {
  const entries = day?.entries || [];
  const skipped = day?.skippedMeals;
  if (!skipped || skipped.length === 0) return entries;
  return entries.filter(e => !skipped.includes(entrySlot(e)));
}

// The supplement's amount in the unit the nutrient is tracked in, or null when
// it can't be converted (an unrecognised unit, or a count like "capsule").
export function convertSupplementAmount(amount, fromUnit, nutrientKey) {
  if (!isFinite(amount) || amount <= 0) return null;
  const unit = (fromUnit || '').toLowerCase().trim();
  const target = (NUTRIENTS.find(n => n.key === nutrientKey)?.unit || '').toLowerCase();
  if (!target) return null;
  if (!unit || unit === target) return amount;
  // mg ↔ mcg ↔ g ↔ µg ↔ ug
  const norm = (u) => (u === 'µg' || u === 'ug' || u === 'mcg') ? 'mcg' : u;
  const u = norm(unit);
  const t = norm(target);
  if (u === t) return amount;
  const factors = {
    'g_mg': 1000,
    'mg_g': 0.001,
    'mg_mcg': 1000,
    'mcg_mg': 0.001,
    'g_mcg': 1_000_000,
    'mcg_g': 0.000001,
  };
  const f = factors[`${u}_${t}`];
  if (typeof f === 'number') return amount * f;
  // IU and pill-count units don't have a clean conversion to mass.
  return null;
}

// Only the supplement rows that carry a real, convertible amount — the rows
// that actually move a nutrient total. A custom row, or one with the amount
// left blank, is still logged and listed, it just doesn't count.
export function countedSupplements(supplements) {
  if (!Array.isArray(supplements)) return [];
  const out = [];
  for (const s of supplements) {
    if (!s?.nutrientKey || s.nutrientKey === '__custom') continue;
    const converted = convertSupplementAmount(parseFloat(s.amount), s.unit, s.nutrientKey);
    if (converted == null) continue;
    out.push({ supplement: s, nutrientKey: s.nutrientKey, amount: converted });
  }
  return out;
}

/**
 * Everything one day of the log came to.
 *
 * `totals` counts the meals AND the day's supplements, matching what the
 * tracker's totals card shows. `fromMeals` is the meals alone, so a view can
 * say how much of a nutrient came out of a bottle rather than a plate.
 *
 * A skipped day totals zero — nothing was eaten, so nothing counts, and
 * `skipped` says so rather than leaving a bare row of noughts to interpret.
 */
export function dayTotals(day) {
  const meals = activeEntries(day);
  const fromMeals = {};
  const totals = {};
  for (const n of NUTRIENTS) { fromMeals[n.key] = 0; totals[n.key] = 0; }

  if (day?.daySkipped) {
    return { totals, fromMeals, fromSupplements: {}, mealCount: 0, skipped: true };
  }

  for (const entry of meals) {
    for (const n of NUTRIENTS) {
      fromMeals[n.key] += entry.nutrition?.[n.key] || 0;
    }
  }
  const fromSupplements = {};
  for (const { nutrientKey, amount } of countedSupplements(day?.supplements)) {
    fromSupplements[nutrientKey] = (fromSupplements[nutrientKey] || 0) + amount;
  }
  for (const n of NUTRIENTS) {
    totals[n.key] = fromMeals[n.key] + (fromSupplements[n.key] || 0);
  }
  return { totals, fromMeals, fromSupplements, mealCount: meals.length, skipped: false };
}

/**
 * Which supplements each day counts as taken.
 *
 * The Week Plan panel is a STANDING list, not a per-day form: it only writes
 * `dailyLog[date].supplements` on the day you edit it, so every other day has
 * no array at all. Treating those as "took nothing" was wrong — the list is
 * what you take daily. So a day with no list of its own inherits the nearest
 * one: the most recent earlier day that has one, or — for days before you
 * first recorded a list — the earliest one on record.
 *
 * Returns { [date]: { supplements, carried } }, `carried` marking a day that
 * inherited rather than recorded, so a view can say so.
 */
export function resolveSupplements(log) {
  const dates = Object.keys(log || {}).sort();
  const out = {};
  let running = null;
  for (const date of dates) {
    const own = log[date]?.supplements;
    if (Array.isArray(own)) {
      running = own;
      out[date] = { supplements: own, carried: false };
    } else {
      out[date] = { supplements: running || [], carried: (running || []).length > 0 };
    }
  }
  // Days before the first recorded list have nothing behind them, so they
  // reach forward to the earliest list instead — the same standing list.
  const firstRecorded = dates.find(d => Array.isArray(log[d]?.supplements) && log[d].supplements.length > 0);
  if (firstRecorded) {
    const earliest = log[firstRecorded].supplements;
    for (const date of dates) {
      if (date >= firstRecorded) break;
      if (out[date].supplements.length === 0) out[date] = { supplements: earliest, carried: true };
    }
  }
  return out;
}

// True when the day holds something worth showing — a meal, a supplement, or
// a deliberate "skipped" mark. Empty days are left out of history entirely.
export function dayHasContent(day) {
  if (!day) return false;
  if (day.daySkipped) return true;
  if ((day.entries || []).length > 0) return true;
  return Array.isArray(day.supplements) && day.supplements.length > 0;
}

// Round for display the way the catalogue asks (calories whole, iron to 0.1…).
//
// An amount that is real but rounds to nothing reads as "<0.1" rather than a
// flat "0": Omega-3 is tracked in grams, so 360 mcg of it is 0.00036 g, and
// printing "0" makes a logged supplement look like it was dropped.
export function formatNutrient(value, nutrient) {
  const dp = nutrient?.decimals ?? 0;
  const num = Number(value || 0);
  const rounded = num.toFixed(dp);
  if (num > 0 && Number(rounded) === 0) {
    return `<${(1 / 10 ** dp).toFixed(dp)}`;
  }
  // Drop a trailing ".0" so whole numbers don't read as measurements.
  return dp > 0 && rounded.endsWith('.' + '0'.repeat(dp)) ? String(Math.round(num)) : rounded;
}
