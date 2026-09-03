// Meal-level nutrition goals and the solver behind Design a Meal.
//
// Two things live here, both pure so they can be unit-tested with
// `node --test`:
//
//   1. The goal model. A profile ("High-protein lunch") holds macro ranges
//      expressed as a % of the meal's calories plus any number of absolute
//      nutrient targets (at least / at most / between). Profiles are stored
//      under `sunday-meal-goals` and synced to Firestore as `mealGoals`.
//
//   2. The repair solver. Given the per-ingredient nutrition of a meal it
//      answers "what would I change to land inside the goals" — scale this
//      ingredient down, drop it, scale that one up, or add something new —
//      and reports the projected result of each single change.
//
// The solver never trusts a linear estimate for the number it shows. Every
// suggestion is projected by re-running the real evaluator at the proposed
// amount, so a macro-% goal (where cutting fat also cuts the calorie
// denominator it is measured against) reads exactly as it will once applied.

import { NUTRIENT_BY_KEY, KCAL_PER_GRAM } from './nutrients.js';
import { qualitiesPer100g } from './mealQualities.js';

export const MEAL_GOALS_KEY = 'sunday-meal-goals';

// The three macros that can carry a "% of calories" range.
export const MACRO_KEYS = ['protein', 'carbs', 'fat'];

export const NUTRIENT_OPS = [
  { key: 'atLeast', label: 'at least' },
  { key: 'atMost',  label: 'at most' },
  { key: 'between', label: 'between' },
  // Yes/no goals. "Does this meal have fermented food in it?" is a question
  // about presence, not amount, so these carry no number of their own — they
  // are an at-least/at-most on any quantity at all, rendered as Yes and No.
  { key: 'has',     label: 'must include' },
  { key: 'hasNot',  label: 'must avoid' },
];

export const BOOLEAN_OPS = new Set(['has', 'hasNot']);

// The smallest amount that counts as "present". Small enough that a splash of
// soy sauce registers as fermented, large enough to shrug off float dust.
const PRESENCE_EPSILON = 1e-6;

// Nutrients whose natural question is yes/no. Offered first in the picker.
export const PRESENCE_KEYS = ['fermentedServings', 'omega3Servings'];

// ── helpers ────────────────────────────────────────────────────────────────

// A bound left blank means "not constrained", which is different from zero —
// `trans fat at most 0` is a real goal.
export function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const UNICODE_FRACTIONS = {
  '¼': 0.25, '½': 0.5, '¾': 0.75, '⅐': 1 / 7, '⅑': 1 / 9, '⅒': 0.1,
  '⅓': 1 / 3, '⅔': 2 / 3, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

// Recipe quantities are free-text strings, and plenty of them are fractions:
// "1/2", "1 1/2", "1½". `parseFloat` reads all three as 1, which would be a
// silent doubling on a page whose whole job is getting amounts right.
// Returns null when there is no number to read.
export function quantityToNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  let text = String(v ?? '').trim();
  if (!text) return null;
  // Expand unicode fractions, inserting a space so "1½" reads as "1 1/2".
  text = text.replace(/[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (ch) => ` ${UNICODE_FRACTIONS[ch]}`);
  // Ranges ("2-3 cups") take the low end, which is what a cook reaching for
  // the smaller amount would get.
  text = text.split(/\s*(?:-|–|to)\s*/)[0].trim();
  const mixed = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const denom = Number(mixed[3]);
    if (denom > 0) return whole + Number(mixed[2]) / denom;
  }
  const fraction = text.match(/^(\d+)\s*\/\s*(\d+)/);
  if (fraction) {
    const denom = Number(fraction[2]);
    if (denom > 0) return Number(fraction[1]) / denom;
  }
  const whole = text.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
  if (whole) return Number(whole[1]) + Number(whole[2]);
  const n = parseFloat(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// The same, but an unreadable or missing quantity falls back to 1 so the row
// still scales proportionally instead of vanishing.
export function parseQty(v) {
  return quantityToNumber(v) ?? 1;
}

export function nutrientLabel(key) {
  return NUTRIENT_BY_KEY[key]?.label || key;
}

export function nutrientUnit(key) {
  return NUTRIENT_BY_KEY[key]?.unit ?? '';
}

export function formatAmount(value, key) {
  const meta = NUTRIENT_BY_KEY[key];
  const decimals = meta ? meta.decimals : 1;
  const factor = 10 ** decimals;
  const rounded = Math.round((Number(value) || 0) * factor) / factor;
  return `${rounded}${meta?.unit || ''}`;
}

// Countable or size-based units, where a quarter of one is the finest amount
// worth suggesting.
const COUNT_UNITS = new Set([
  '', 'whole', 'each', 'clove', 'cloves', 'slice', 'slices', 'piece', 'pieces',
  'can', 'cans', 'egg', 'eggs', 'small', 'medium', 'large', 'extra large', 'xl', 'regular',
]);

// The finest increment worth suggesting for a unit: grams to the gram (or
// five, once the numbers are big), teaspoons to the quarter, countable things
// to the quarter or half.
export function quantityStep(qty, measurement) {
  const q = Number(qty) || 0;
  const unit = String(measurement || '').trim().toLowerCase();
  if (unit === 'g' || unit === 'gram' || unit === 'grams' || unit === 'ml') {
    return q < 20 ? 1 : 5;
  }
  if (unit === 'mg') return 25;
  if (unit === 'tsp' || unit === 'teaspoon' || unit === 'teaspoons') return 0.25;
  if (unit === 'stick' || unit === 'sticks') return 0.25;
  if (COUNT_UNITS.has(unit)) return q < 2 ? 0.25 : 0.5;
  // cups, tablespoons, ounces, pounds — a quarter-unit is measurable.
  return q < 1 ? 0.125 : 0.25;
}

// Trim a solved amount to something a person would actually measure.
export function niceQuantity(qty, measurement) {
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return 0;
  const step = quantityStep(q, measurement);
  const snapped = Math.round(q / step) * step;
  // Never snap a still-wanted ingredient to nothing; that is a removal, which
  // the solver models separately and labels as such.
  return Math.max(step, Math.round(snapped * 1000) / 1000);
}

export function formatQty(qty) {
  return String(Math.round((Number(qty) || 0) * 1000) / 1000);
}

// ── profile model ──────────────────────────────────────────────────────────

let idCounter = 0;
function makeId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function emptyProfile(name = 'My meal goals') {
  return {
    id: makeId('mg'),
    name,
    // null = that macro carries no range
    macros: { protein: null, carbs: null, fat: null },
    nutrients: [],
  };
}

// A starting profile that is immediately useful: a balanced plate plus the
// target people most often miss and the one they most often overshoot.
export function starterProfile() {
  const p = emptyProfile('Balanced meal');
  p.macros = {
    protein: { min: 25, max: 40 },
    carbs: { min: 30, max: 50 },
    fat: { min: 20, max: 35 },
  };
  p.nutrients = [
    { id: makeId('ng'), key: 'calories', op: 'between', min: 450, max: 750 },
    { id: makeId('ng'), key: 'fiber', op: 'atLeast', min: 8, max: null },
    { id: makeId('ng'), key: 'sodium', op: 'atMost', min: null, max: 700 },
  ];
  return p;
}

export function newNutrientGoal(key = 'fiber', op = 'atLeast') {
  return { id: makeId('ng'), key, op, min: null, max: null };
}

// The rest of the app already treats a meal as a third of the day (the recipe
// panel's "Meal %" rows divide daily goals by three), so seeding from daily
// goals uses the same split.
export const MEALS_PER_DAY = 3;

export function profileFromDailyGoals(dailyGoals, name = 'From my daily goals') {
  const p = emptyProfile(name);
  const g = dailyGoals || {};
  const pct = (k) => (Number.isFinite(Number(g[k])) && Number(g[k]) > 0 ? Number(g[k]) : null);
  const band = (v) => (v == null ? null : { min: Math.max(0, Math.round(v - 5)), max: Math.round(v + 5) });
  p.macros = {
    protein: band(pct('plateProtein')),
    carbs: band(pct('plateCarbs')),
    fat: band(pct('plateFat')),
  };
  // Nutrients where overshooting is the risk get an "at most"; the rest get an
  // "at least". Calories become a band around the per-meal share.
  const AT_MOST = new Set(['saturatedFat', 'transFat', 'cholesterol', 'sugar', 'addedSugar', 'sodium']);
  const nutrients = [];
  const cal = Number(g.calories);
  if (Number.isFinite(cal) && cal > 0) {
    const per = cal / MEALS_PER_DAY;
    nutrients.push({
      id: makeId('ng'), key: 'calories', op: 'between',
      min: Math.round(per * 0.85), max: Math.round(per * 1.15),
    });
  }
  for (const key of ['protein', 'fiber', 'potassium', 'sodium', 'saturatedFat', 'addedSugar']) {
    const daily = Number(g[key]);
    if (!Number.isFinite(daily) || daily <= 0) continue;
    const decimals = NUTRIENT_BY_KEY[key]?.decimals ?? 0;
    const factor = 10 ** decimals;
    const per = Math.round((daily / MEALS_PER_DAY) * factor) / factor;
    if (AT_MOST.has(key)) nutrients.push({ id: makeId('ng'), key, op: 'atMost', min: null, max: per });
    else nutrients.push({ id: makeId('ng'), key, op: 'atLeast', min: per, max: null });
  }
  p.nutrients = nutrients;
  return p;
}

function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const macros = {};
  for (const k of MACRO_KEYS) {
    const m = raw.macros?.[k];
    if (m && (numOrNull(m.min) !== null || numOrNull(m.max) !== null)) {
      macros[k] = { min: numOrNull(m.min), max: numOrNull(m.max) };
    } else {
      macros[k] = null;
    }
  }
  const nutrients = Array.isArray(raw.nutrients)
    ? raw.nutrients
      .filter(n => n && typeof n.key === 'string' && NUTRIENT_BY_KEY[n.key])
      .map(n => ({
        id: n.id || makeId('ng'),
        key: n.key,
        op: NUTRIENT_OPS.some(o => o.key === n.op) ? n.op : 'atLeast',
        min: numOrNull(n.min),
        max: numOrNull(n.max),
      }))
    : [];
  return {
    id: raw.id || makeId('mg'),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Meal goals',
    macros,
    nutrients,
  };
}

// The stored shape is `{ profiles: [...], activeId }`.
export function normalizeStore(raw) {
  const profiles = Array.isArray(raw?.profiles)
    ? raw.profiles.map(sanitizeProfile).filter(Boolean)
    : [];
  if (profiles.length === 0) profiles.push(starterProfile());
  const activeId = profiles.some(p => p.id === raw?.activeId) ? raw.activeId : profiles[0].id;
  return { profiles, activeId };
}

export function loadMealGoals() {
  try {
    const raw = localStorage.getItem(MEAL_GOALS_KEY);
    return normalizeStore(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeStore(null);
  }
}

export function saveMealGoals(store) {
  try {
    localStorage.setItem(MEAL_GOALS_KEY, JSON.stringify(store));
  } catch { /* storage full — goals stay in memory for this session */ }
}

export function activeProfile(store) {
  if (!store) return null;
  return store.profiles.find(p => p.id === store.activeId) || store.profiles[0] || null;
}

export function profileHasGoals(profile) {
  if (!profile) return false;
  if (MACRO_KEYS.some(k => profile.macros?.[k])) return true;
  // A yes/no goal carries no number, so it counts on its operator alone.
  return (profile.nutrients || []).some(n => (
    BOOLEAN_OPS.has(n.op) || numOrNull(n.min) !== null || numOrNull(n.max) !== null
  ));
}

// ── the meal model ─────────────────────────────────────────────────────────
//
// A row is one ingredient line plus the nutrition looked up for the amount
// written on it. `nutrients` is the whole-recipe contribution at `baseQty`;
// nutrition is linear in the amount, so the same row at another quantity is
// that vector times quantity/baseQty. That is what makes live re-scoring free:
// changing an amount never needs another lookup.

export function makeRow({ index, ingredient, quantity, measurement, topping, lookup }) {
  const baseQty = parseQty(quantity);
  return {
    index,
    ingredient,
    // What the lookup actually matched, so the UI can be honest about it.
    matchedName: lookup?.name || null,
    source: lookup?.source || null,
    measurement: measurement || '',
    baseQty,
    quantity: baseQty,
    grams: lookup?.grams || 0,
    topping: !!topping,
    nutrients: lookup?.nutrients || null,
    // Rows added on this page rather than read off the recipe.
    added: false,
    disabled: false,
  };
}

// Per-serving contribution of a row at its current quantity.
//
// A "per meal topping" is already a per-serving amount, so it is not divided;
// a base ingredient covers the whole recipe and is. Same split the recipe
// nutrition panel uses.
export function rowPerServing(row, servings) {
  const out = {};
  if (!row?.nutrients || row.disabled) return out;
  const s = Number(servings) > 0 ? Number(servings) : 1;
  const scale = (row.quantity / (row.baseQty || 1)) / (row.topping ? 1 : s);
  for (const [key, val] of Object.entries(row.nutrients)) {
    if (typeof val === 'number') out[key] = val * scale;
  }
  return out;
}

export function totalsForRows(rows, servings) {
  const totals = {};
  for (const row of rows || []) {
    if (row.disabled) continue;
    const per = rowPerServing(row, servings);
    for (const [key, val] of Object.entries(per)) {
      totals[key] = (totals[key] || 0) + val;
    }
  }
  return totals;
}

// Grams per one unit of a row's own measurement, so a gram target can be
// expressed back in the recipe's language ("1.5 tbsp", not "21 g").
export function gramsPerUnit(row) {
  if (!row?.grams || !row.baseQty) return 0;
  return row.grams / row.baseQty;
}

// ── evaluation ─────────────────────────────────────────────────────────────

// Macro percentages are of the calories the macros themselves account for
// (4/4/9), not of the reported calorie figure. Those two disagree by a few
// percent for most foods, and a plate described as 30/45/25 should add to 100.
export function macroSplit(perServing) {
  const grams = {};
  const kcal = {};
  let total = 0;
  for (const k of MACRO_KEYS) {
    const g = Number(perServing?.[k]) || 0;
    grams[k] = g;
    kcal[k] = g * KCAL_PER_GRAM[k];
    total += kcal[k];
  }
  const pct = {};
  for (const k of MACRO_KEYS) {
    pct[k] = total > 0 ? (kcal[k] / total) * 100 : 0;
  }
  return { grams, kcal, pct, macroCalories: total };
}

function statusFor(actual, min, max, tol) {
  if (min !== null && actual < min - tol) return 'under';
  if (max !== null && actual > max + tol) return 'over';
  return 'pass';
}

// Signed distance to the violated bound: positive means "need this much
// more", negative means "need this much less", zero means inside.
function gapFor(actual, min, max, status) {
  if (status === 'under') return min - actual;
  if (status === 'over') return max - actual;
  return 0;
}

/**
 * Score a meal's per-serving nutrition against a goal profile.
 * Returns one result row per goal, plus the macro split for display.
 */
export function evaluateMeal(profile, perServing) {
  const macro = macroSplit(perServing);
  const results = [];

  for (const key of MACRO_KEYS) {
    const range = profile?.macros?.[key];
    if (!range) continue;
    const min = numOrNull(range.min);
    const max = numOrNull(range.max);
    if (min === null && max === null) continue;
    // A meal with no macros at all (water, black coffee) has no split to score.
    const scorable = macro.macroCalories > 0;
    const actual = macro.pct[key];
    const status = scorable ? statusFor(actual, min, max, 0.05) : 'unknown';
    results.push({
      id: `macro:${key}`,
      kind: 'macro',
      key,
      label: nutrientLabel(key),
      unit: '%',
      actual,
      grams: macro.grams[key],
      min,
      max,
      status,
      gap: scorable ? gapFor(actual, min, max, status) : 0,
    });
  }

  for (const goal of profile?.nutrients || []) {
    const boolean = BOOLEAN_OPS.has(goal.op);
    let min;
    let max;
    if (boolean) {
      // "Must include" is "at least a trace"; "must avoid" is "at most none".
      // Expressing them as bounds means the evaluator, the solver and the
      // score bars need no special case — only the labels do.
      min = goal.op === 'has' ? PRESENCE_EPSILON : null;
      max = goal.op === 'hasNot' ? 0 : null;
    } else {
      min = goal.op === 'atMost' ? null : numOrNull(goal.min);
      max = goal.op === 'atLeast' ? null : numOrNull(goal.max);
      if (min === null && max === null) continue;
    }
    const actual = Number(perServing?.[goal.key]) || 0;
    // Half a percent of the bound, so a rounding hair is not a failure.
    const tol = boolean ? 0 : Math.max(Math.abs(max ?? min) * 0.005, 1e-9);
    const status = statusFor(actual, min, max, tol);
    results.push({
      id: `nut:${goal.id}`,
      kind: 'nutrient',
      boolean,
      op: goal.op,
      key: goal.key,
      label: nutrientLabel(goal.key),
      unit: boolean ? '' : nutrientUnit(goal.key),
      actual,
      min,
      max,
      status,
      gap: gapFor(actual, min, max, status),
    });
  }

  return {
    macro,
    results,
    failing: results.filter(r => r.status === 'over' || r.status === 'under'),
    passing: results.filter(r => r.status === 'pass'),
  };
}

function withRowQuantity(rows, index, quantity) {
  return rows.map((r, i) => (i === index ? { ...r, quantity, disabled: quantity <= 0 } : r));
}

// The solver bisects on one row's amount, forty steps deep, for every row
// against every failing goal. Re-totalling the whole meal at each step is what
// makes that expensive — and unnecessary, because changing one amount moves
// the totals linearly:
//
//     total(k) at quantity q  =  base(k) + perUnit(k) × (q − qNow)
//
// So the basis is computed once per solve and each probe becomes arithmetic on
// one or three numbers instead of a pass over every ingredient.
function mealBasis(rows, servings) {
  const s = Number(servings) > 0 ? Number(servings) : 1;
  const base = totalsForRows(rows, servings);
  const perUnit = rows.map(r => {
    const out = {};
    if (!r?.nutrients) return out;
    const factor = (1 / (r.baseQty || 1)) / (r.topping ? 1 : s);
    for (const [key, val] of Object.entries(r.nutrients)) {
      if (typeof val === 'number') out[key] = val * factor;
    }
    return out;
  });
  return { base, perUnit };
}

// One goal's value when a single row's amount moves by `delta` units. A row
// taken to zero lands here as delta = −qNow, which subtracts exactly the
// contribution disabling it would.
function goalValueWithDelta(goal, base, perUnit, delta) {
  if (goal.kind !== 'macro') {
    return (Number(base[goal.key]) || 0) + (Number(perUnit[goal.key]) || 0) * delta;
  }
  let totalKcal = 0;
  let ownKcal = 0;
  for (const k of MACRO_KEYS) {
    const grams = Math.max(0, (Number(base[k]) || 0) + (Number(perUnit[k]) || 0) * delta);
    const kcal = grams * KCAL_PER_GRAM[k];
    totalKcal += kcal;
    if (k === goal.key) ownKcal = kcal;
  }
  return totalKcal > 0 ? (ownKcal / totalKcal) * 100 : 0;
}

// Per-unit contribution of a row that is not in the meal yet.
function perUnitOf(row, servings) {
  const s = Number(servings) > 0 ? Number(servings) : 1;
  const out = {};
  if (!row?.nutrients) return out;
  const factor = (1 / (row.baseQty || 1)) / (row.topping ? 1 : s);
  for (const [key, val] of Object.entries(row.nutrients)) {
    if (typeof val === 'number') out[key] = val * factor;
  }
  return out;
}

// ── the solver ─────────────────────────────────────────────────────────────

const BISECT_STEPS = 40;
const MAX_SCALE_UP = 4;
// Cap on an "add this" suggestion: past half a kilo it stops being advice.
const MAX_ADD_GRAMS = 500;

// The point in [lo, hi] closest to the far end that still satisfies `ok`,
// assuming `ok` flips at most once across the interval. Null when nothing does.
function bisectQuantity(lo, hi, ok) {
  const okLo = ok(lo);
  const okHi = ok(hi);
  if (!okLo && !okHi) return null;
  // Both ends work: take the one that changes the meal least.
  if (okLo && okHi) return lo;
  let good = okHi ? hi : lo;
  let bad = okHi ? lo : hi;
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = (good + bad) / 2;
    if (ok(mid)) good = mid;
    else bad = mid;
  }
  return good;
}

// How a candidate change lands: the goal it targets, plus what it does to
// every other goal.
function projectChange(profile, rows, servings, targetGoalId, before) {
  const after = evaluateMeal(profile, totalsForRows(rows, servings));
  const target = after.results.find(r => r.id === targetGoalId) || null;
  const broke = [];
  const fixed = [];
  for (const r of after.results) {
    if (r.id === targetGoalId) continue;
    const was = before.results.find(b => b.id === r.id);
    if (!was) continue;
    if (was.status === 'pass' && r.status !== 'pass') broke.push(r);
    if (was.status !== 'pass' && r.status === 'pass') fixed.push(r);
  }
  return { target, broke, fixed, evaluation: after };
}

/**
 * Propose single changes that move a failing goal inside its range.
 *
 * Each suggestion stands alone: apply just this one and the target goal reads
 * `projected`. `broke` lists goals that were passing and would stop, so the UI
 * can warn instead of quietly trading one failure for another.
 *
 * @param rows       meal rows (see makeRow)
 * @param servings   servings the recipe makes
 * @param profile    goal profile
 * @param candidates pool for "add an ingredient" suggestions:
 *                   [{ name, measurement, gramsPerUnit, per100g: {key: value} }]
 * @param perGoal    how many suggestions to keep per failing goal
 */
export function suggestFixes({ rows, servings, profile, candidates = [], perGoal = 4 }) {
  const { base, perUnit } = mealBasis(rows, servings);
  const before = evaluateMeal(profile, base);
  const out = [];

  for (const goal of before.failing) {
    const forGoal = [];
    const wantLess = goal.status === 'over';

    // ── change an amount already in the meal ──
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.nutrients || row.disabled) continue;
      // Only a row that carries the nutrient can move it. For a macro-% goal
      // the denominator moves too, so any macro-bearing row is a candidate and
      // the direction check below decides whether it actually helps.
      const carries = goal.kind === 'macro'
        ? MACRO_KEYS.some(k => (row.nutrients[k] || 0) > 0)
        : (row.nutrients[goal.key] || 0) > 0;
      if (!carries) continue;

      const lo = wantLess ? 0 : row.quantity;
      const hi = wantLess ? row.quantity : row.quantity * MAX_SCALE_UP;
      if (hi <= 0) continue;

      const passesAt = (q) => {
        const actual = goalValueWithDelta(goal, base, perUnit[i], q - row.quantity);
        if (wantLess) return goal.max === null || actual <= goal.max;
        return goal.min === null || actual >= goal.min;
      };

      // A protein-heavy row cut to fix high fat% pushes fat% the wrong way;
      // bisect finds no satisfying point and the row is skipped.
      const solved = bisectQuantity(lo, hi, passesAt);
      if (solved === null) continue;
      if (wantLess && solved >= row.quantity - 1e-9) continue;
      if (!wantLess && solved <= row.quantity + 1e-9) continue;

      // Under 2% of the original amount is a removal, not a reduction.
      const isRemoval = wantLess && solved <= row.baseQty * 0.02;
      let finalQty = isRemoval ? 0 : niceQuantity(solved, row.measurement);
      // Rounding must not undo the fix: if the tidy number lands back outside
      // the range, step it one whole notch further in the helpful direction.
      // (Nudging by the rounding error itself would just round back to the
      // same number and fall through to an unmeasurable amount like 1.0267.)
      if (!isRemoval && !passesAt(finalQty)) {
        const step = quantityStep(solved, row.measurement);
        const nudged = niceQuantity(
          wantLess ? Math.max(0, finalQty - step) : finalQty + step,
          row.measurement,
        );
        finalQty = passesAt(nudged) ? nudged : solved;
      }
      if (!isRemoval && finalQty >= row.quantity && wantLess) continue;
      if (!isRemoval && finalQty <= row.quantity && !wantLess) continue;

      const projection = projectChange(profile, withRowQuantity(rows, i, finalQty), servings, goal.id, before);
      forGoal.push({
        id: `${goal.id}|row:${i}`,
        goalId: goal.id,
        goalLabel: goal.label,
        goalDirection: goal.status,
        type: finalQty === 0 ? 'remove' : (wantLess ? 'reduce' : 'increase'),
        rowIndex: i,
        name: row.ingredient,
        measurement: row.measurement,
        fromQty: row.quantity,
        toQty: finalQty,
        projected: projection.target,
        broke: projection.broke,
        alsoFixed: projection.fixed,
      });
    }

    // ── add something that isn't in the meal yet ──
    if (!wantLess && candidates.length > 0) {
      const present = new Set(rows.map(r => (r.ingredient || '').trim().toLowerCase()));
      const scored = [];
      for (const cand of candidates) {
        const name = (cand.name || '').trim();
        if (!name || present.has(name.toLowerCase())) continue;
        const per100 = cand.per100g || {};
        // For a macro-% goal, density is in calories from that macro; for an
        // absolute goal it is the nutrient itself. Either way: per 100g.
        const density = goal.kind === 'macro'
          ? (Number(per100[goal.key]) || 0) * KCAL_PER_GRAM[goal.key]
          : (Number(per100[goal.key]) || 0);
        if (density <= 0) continue;
        scored.push({ cand, density });
      }
      // Densest first — the smallest addition that closes the gap.
      scored.sort((a, b) => b.density - a.density);

      for (const { cand } of scored.slice(0, 12)) {
        const gramsPer = cand.gramsPerUnit > 0 ? cand.gramsPerUnit : 100;
        const per100 = cand.per100g || {};
        // A synthetic row expressed in the candidate's own unit.
        const addRow = {
          index: -1,
          ingredient: cand.name,
          matchedName: cand.matchedName || null,
          source: cand.source || 'ingredients-db',
          measurement: cand.measurement || 'g',
          baseQty: 1,
          quantity: 1,
          grams: gramsPer,
          topping: false,
          added: true,
          disabled: false,
          // Nutrients for one unit of the candidate's measurement.
          nutrients: Object.fromEntries(
            Object.entries(per100).map(([k, v]) => [k, (Number(v) || 0) * (gramsPer / 100)]),
          ),
        };
        const maxUnits = Math.max(1, MAX_ADD_GRAMS / gramsPer);
        // Nothing of it is in the meal yet, so the delta is the amount itself.
        const candPerUnit = perUnitOf(addRow, servings);
        const passesAt = (q) => {
          const actual = goalValueWithDelta(goal, base, candPerUnit, q);
          return goal.min === null || actual >= goal.min;
        };
        const solved = bisectQuantity(0, maxUnits, passesAt);
        if (solved === null || solved <= 0) continue;
        let finalQty = niceQuantity(solved, addRow.measurement);
        if (!passesAt(finalQty)) {
          const step = quantityStep(solved, addRow.measurement);
          const nudged = niceQuantity(finalQty + step, addRow.measurement);
          finalQty = passesAt(nudged) ? nudged : solved;
        }
        const projection = projectChange(
          profile, [...rows, { ...addRow, quantity: finalQty }], servings, goal.id, before,
        );
        forGoal.push({
          id: `${goal.id}|add:${cand.name}`,
          goalId: goal.id,
          goalLabel: goal.label,
          goalDirection: goal.status,
          type: 'add',
          rowIndex: null,
          addRow: { ...addRow, quantity: finalQty },
          name: cand.name,
          measurement: addRow.measurement,
          fromQty: 0,
          toQty: finalQty,
          grams: Math.round(finalQty * gramsPer),
          projected: projection.target,
          broke: projection.broke,
          alsoFixed: projection.fixed,
        });
      }
    }

    // Cleanest first: no collateral damage, then whatever fixes other failing
    // goals too, then the smallest change to the meal.
    forGoal.sort((a, b) => {
      if (a.broke.length !== b.broke.length) return a.broke.length - b.broke.length;
      if (a.alsoFixed.length !== b.alsoFixed.length) return b.alsoFixed.length - a.alsoFixed.length;
      const aRel = a.fromQty > 0 ? Math.abs(a.toQty - a.fromQty) / a.fromQty : 1;
      const bRel = b.fromQty > 0 ? Math.abs(b.toQty - b.fromQty) / b.fromQty : 1;
      return aRel - bRel;
    });
    out.push(...forGoal.slice(0, perGoal));
  }

  return out;
}

// Turn the user's ingredients DB into an "add this" candidate pool. Rows there
// carry nutrition per their own listed measurement plus the grams that weighs,
// which is enough to normalise to per-100g.
export function candidatesFromIngredientsDb(dbRows) {
  const out = [];
  for (const row of dbRows || []) {
    const name = (row?.ingredient || '').trim();
    const grams = Number(row?.grams);
    if (!name || !Number.isFinite(grams) || grams <= 0) continue;
    const per100g = {};
    for (const key of Object.keys(NUTRIENT_BY_KEY)) {
      const v = Number(row[key]);
      if (Number.isFinite(v) && v !== 0) per100g[key] = (v / grams) * 100;
    }
    // Fermented and omega-3 are read off the name, not a DB column, so they
    // have to be added here or the solver could never propose the kimchi that
    // answers a "must include fermented food" goal.
    Object.assign(per100g, qualitiesPer100g(name));
    if (Object.keys(per100g).length === 0) continue;
    out.push({
      name,
      measurement: row.measurement || 'g',
      gramsPerUnit: grams,
      per100g,
      source: 'ingredients-db',
    });
  }
  return out;
}
