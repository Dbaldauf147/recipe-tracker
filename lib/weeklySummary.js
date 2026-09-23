// Weekly progress summary — aggregation + email rendering.
//
// Covers ONE completed Sunday→Saturday week (the app's own week boundary, see
// WeekPlanPage's sundayOf and the Sunday-anchored habit week key), compared
// against the week before it. Anchoring to a finished week is what makes the
// numbers stable: a partial week would report a "down" trend every time it was
// sent mid-week.
//
// The per-metric definitions deliberately MIRROR what the app already shows, so
// the email can never disagree with the page it summarises:
//   * meals-tracked % + ate out  → WeekPlanPage.mealStatsForDays
//   * veg / fruit servings       → WeekPlanPage.produceForDays
//   * daily macros               → lib/mealReminderEmail.aggregateMacros
//   * habit period buckets       → api/_data/habitPeriods.weekKeyOfDate
//   * workout volume / set math  → src/utils/exerciseProgress (setWeightLb)
// Keep them in sync if any of those change.
//
// Pure module: no Firestore, no network. api/send-weekly-summary.js does the
// reads and hands the raw data in.

import { escapeHtml } from './mealReminderEmail.js';
import { parseSetValue } from '../src/utils/setValue.js';
import { weekKeyOfDate, isLoggableHabit } from '../api/_data/habitPeriods.js';
import { analyzeProgress, WINDOW_DAYS } from '../src/utils/exerciseProgress.js';
import { effectiveExerciseType } from '../src/utils/exerciseTypes.js';
import { workoutCalendarCategory } from '../src/utils/workoutCategory.js';
import { isStretchWorkout } from '../src/utils/stretchRoutine.js';
import {
  stretchSecondsByRegion, stretchGoalProgress, formatStretchDuration, clampGoalMin,
  STRETCH_REGIONS, STRETCH_GOAL_WINDOW_DAYS,
} from '../src/utils/stretchGoal.js';
import { DEFAULT_SAUNA_GOAL, normalizeSaunaGoal } from '../src/utils/saunaPlan.js';
import { ACTIVE_WINDOW_DAYS, growthHeadline, shortDate } from './adminGrowth.js';

const MAIN_MEALS = ['breakfast', 'lunch', 'dinner'];
const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat'];
const LB_PER_KG = 2.2046226218;
const APP_URL = 'https://prep-day.com';
const ACCENT = '#c96442';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// How many weeks of history the meals section charts (eating out, and the
// per-meal protein/fibre trends), the reported week included. Ten reads as a
// trend — four was short enough that one busy week looked like a direction.
const HISTORY_WEEKS = 10;

// ─────────────────────────────────────────────── date helpers (UTC-stable)

export function shiftKey(dateKey, days) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function dowOf(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function prettyDate(dateKey) {
  const [, m, d] = String(dateKey).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function prettyRange(start, end) {
  return `${prettyDate(start)} – ${prettyDate(end)}, ${end.split('-')[0]}`;
}

/**
 * The most recent COMPLETE Sunday→Saturday week relative to `todayKey`.
 *
 * The week containing today is never used: it isn't finished, so half its days
 * would read as missed. On a Sunday that means "the week that just ended
 * yesterday"; on a Saturday it means the week that ended 7 days ago.
 */
export function lastCompleteWeek(todayKey) {
  const end = shiftKey(todayKey, -(dowOf(todayKey) + 1)); // most recent Saturday before today
  const start = shiftKey(end, -6);
  return buildWindow(start);
}

function buildWindow(startKey) {
  const days = [];
  for (let i = 0; i < 7; i++) days.push(shiftKey(startKey, i));
  return { start: startKey, end: days[6], days, label: prettyRange(startKey, days[6]) };
}

/** The Sun→Sat week immediately before `week`. */
export function previousWeek(week) {
  return buildWindow(shiftKey(week.start, -7));
}

// ───────────────────────────────────────────────────────── meals & nutrition

// Mirrors WeekPlanPage.mealStatsForDay: a main-meal slot counts as "tracked"
// when it has an entry, was marked skipped, or was marked as eating out.
function mealsForDay(day) {
  const entries = Array.isArray(day?.entries) ? day.entries : [];
  const eatOutMarks = Array.isArray(day?.eatingOutMeals) ? day.eatingOutMeals : [];
  let ateOut = 0;
  for (const e of entries) if (e?.eatingOut) ateOut += 1;
  for (const s of eatOutMarks) if (MAIN_MEALS.includes(s)) ateOut += 1;
  if (day?.daySkipped) return { tracked: MAIN_MEALS.length, ateOut };
  const skipped = Array.isArray(day?.skippedMeals) ? day.skippedMeals : [];
  const accounted = new Set();
  for (const e of entries) if (MAIN_MEALS.includes(e.mealSlot)) accounted.add(e.mealSlot);
  for (const s of skipped) if (MAIN_MEALS.includes(s)) accounted.add(s);
  for (const s of eatOutMarks) if (MAIN_MEALS.includes(s)) accounted.add(s);
  return { tracked: accounted.size, ateOut };
}

function produceForDay(day) {
  if (!day || day.daySkipped) return { veg: 0, fruit: 0 };
  const entries = Array.isArray(day.entries) ? day.entries : [];
  const skipped = Array.isArray(day.skippedMeals) ? day.skippedMeals : [];
  const active = skipped.length
    ? entries.filter(e => {
      const slot = e.type === 'custom' && !e.mealSlot
        ? 'snack'
        : (MAIN_MEALS.includes(e.mealSlot) ? e.mealSlot : 'snack');
      return !skipped.includes(slot);
    })
    : entries;
  let veg = 0;
  let fruit = 0;
  for (const e of active) {
    veg += e.nutrition?.vegServings || 0;
    fruit += e.nutrition?.fruitServings || 0;
  }
  return { veg, fruit };
}

function macrosForDay(day) {
  if (!day || day.daySkipped) return null;
  const entries = Array.isArray(day.entries) ? day.entries : [];
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  let any = false;
  for (const e of entries) {
    if (!e?.nutrition) continue;
    any = true;
    for (const k of MACRO_KEYS) totals[k] += e.nutrition[k] || 0;
  }
  return any ? totals : null;
}

/**
 * Protein for each day of the week, for the chart.
 *
 * `protein: null` is a day with no nutrition logged, which is NOT a zero — the
 * same distinction the "avg per day" line makes by dividing over macroDays
 * rather than over 7. The chart draws nothing for those days rather than a
 * bar on the floor, because a flat bar reads as "ate no protein".
 *
 * `perMeal` is the average protein across that day's MAIN meals (breakfast,
 * lunch, dinner) that have nutrition on them. Snacks aren't meals, so their
 * protein counts toward `protein` but not here. `null` when no main meal was
 * priced, for the same unknown-isn't-zero reason.
 */
function proteinByDay(log, days) {
  return days.map(key => {
    const day = log[key];
    const macros = macrosForDay(day);
    return {
      date: key,
      dow: DOW_LABELS[dowOf(key)],
      protein: macros ? Math.round(macros.protein) : null,
      perMeal: proteinPerMeal(day),
    };
  });
}

/**
 * One row per MAIN meal of the day that was actually priced — breakfast, lunch
 * and dinner with nutrition on them. Several entries in the same slot are one
 * meal, summed, which is what makes "per meal" mean a sitting rather than a
 * line item.
 *
 * `protein` follows the existing convention that a priced meal with no protein
 * figure is a 0g meal. `fibre` does NOT: it is null unless the entry carries a
 * number, because fibre is frequently absent from an estimate and counting that
 * as zero would drag an average down with meals nobody measured. Same
 * unknown-isn't-zero rule the day-level macros already follow.
 */
function mainMealNutrition(day) {
  if (!day || day.daySkipped) return [];
  const entries = Array.isArray(day.entries) ? day.entries : [];
  const bySlot = new Map();
  for (const e of entries) {
    if (!e?.nutrition || !MAIN_MEALS.includes(e.mealSlot)) continue;
    const row = bySlot.get(e.mealSlot) || { slot: e.mealSlot, protein: 0, fiber: null };
    row.protein += e.nutrition.protein || 0;
    const f = Number(e.nutrition.fiber);
    if (Number.isFinite(f)) row.fiber = (row.fiber || 0) + f;
    bySlot.set(e.mealSlot, row);
  }
  return [...bySlot.values()];
}

function proteinPerMeal(day) {
  const meals = mainMealNutrition(day);
  if (meals.length === 0) return null;
  let total = 0;
  for (const m of meals) total += m.protein;
  return Math.round(total / meals.length);
}

/**
 * Per-meal protein and fibre for each of the last `weeks` weeks, oldest first
 * and ending with the reported week — the same shape and window as
 * summarizeAteOutHistory, so the three trends in the meals section line up
 * column for column.
 *
 * The protein GOAL isn't applied here. The weekly config lives at render time
 * (renderWeeklySummary's `goals`), so this keeps the raw per-meal readings and
 * lets the chart decide what "hit it" means — the same split proteinByDay
 * already uses.
 *
 *   meals       main meals priced that week
 *   proteins    one entry per priced meal, grams
 *   fibers      one entry per priced meal THAT RECORDED FIBRE, grams
 *   fiberAvg    mean of `fibers`, or null when the week measured none
 */
export function summarizeMealQualityHistory(dailyLog, week, weeks = HISTORY_WEEKS) {
  const log = dailyLog && typeof dailyLog === 'object' ? dailyLog : {};
  const out = [];
  let w = week;
  for (let i = 0; i < weeks; i++) {
    const proteins = [];
    const fibers = [];
    for (const key of w.days) {
      for (const m of mainMealNutrition(log[key])) {
        proteins.push(m.protein);
        if (m.fiber != null) fibers.push(m.fiber);
      }
    }
    const sameMonth = w.start.slice(0, 7) === w.end.slice(0, 7);
    out.unshift({
      start: w.start,
      end: w.end,
      label: prettyDate(w.start),
      range: sameMonth
        ? `${prettyDate(w.start)}–${Number(w.end.split('-')[2])}`
        : `${prettyDate(w.start)}–${prettyDate(w.end)}`,
      meals: proteins.length,
      proteins,
      fibers,
      fiberAvg: fibers.length > 0
        ? Math.round((fibers.reduce((a, b) => a + b, 0) / fibers.length) * 10) / 10
        : null,
    });
    w = previousWeek(w);
  }
  return out;
}

/**
 * How many meals were eaten out in each of the last `weeks` weeks, oldest
 * first and ending with the reported week.
 *
 * Reads the same dailyLog the rest of the summary does — it arrives whole, so
 * reaching back a couple of months costs nothing extra. A week with no log at
 * all still gets a point (zero), because "we ate in every night" and "we
 * tracked nothing" both look like an empty week from here and the run of dates
 * is what makes the trend readable.
 */
export function summarizeAteOutHistory(dailyLog, week, weeks = HISTORY_WEEKS) {
  const log = dailyLog && typeof dailyLog === 'object' ? dailyLog : {};
  const out = [];
  let w = week;
  for (let i = 0; i < weeks; i++) {
    let ateOut = 0;
    for (const key of w.days) ateOut += mealsForDay(log[key]).ateOut;
    // Two labels, because the HTML and the plain-text renderings need
    // different ones. `label` is the week's start alone ("Aug 9"), which is
    // what fits under a column and is what the weight chart above it already
    // uses — ten date RANGES across a phone-width email is unreadable. `range`
    // keeps the full "Aug 9–15" / "Aug 30–Sep 5" span for the text email,
    // where the rows run down the page and have room for it.
    const sameMonth = w.start.slice(0, 7) === w.end.slice(0, 7);
    out.unshift({
      start: w.start,
      end: w.end,
      label: prettyDate(w.start),
      range: sameMonth
        ? `${prettyDate(w.start)}–${Number(w.end.split('-')[2])}`
        : `${prettyDate(w.start)}–${prettyDate(w.end)}`,
      ateOut,
    });
    w = previousWeek(w);
  }
  return out;
}

function summarizeMeals(dailyLog, days) {
  const log = dailyLog && typeof dailyLog === 'object' ? dailyLog : {};
  let trackedSlots = 0;
  let ateOut = 0;
  let daysWithMeals = 0;
  let entriesLogged = 0;
  let veg = 0;
  let fruit = 0;
  const macroTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  let macroDays = 0;

  for (const key of days) {
    const day = log[key];
    const m = mealsForDay(day);
    trackedSlots += m.tracked;
    ateOut += m.ateOut;

    const entries = Array.isArray(day?.entries) ? day.entries : [];
    if (entries.length > 0) daysWithMeals += 1;
    entriesLogged += entries.length;

    const p = produceForDay(day);
    veg += p.veg;
    fruit += p.fruit;

    const macros = macrosForDay(day);
    if (macros) {
      macroDays += 1;
      for (const k of MACRO_KEYS) macroTotals[k] += macros[k];
    }
  }

  const totalSlots = days.length * MAIN_MEALS.length;
  // Averages are per day WITH macro data, not per calendar day: a day with no
  // logged nutrition isn't a zero-calorie day, it's an unknown one.
  const avg = {};
  for (const k of MACRO_KEYS) avg[k] = macroDays > 0 ? macroTotals[k] / macroDays : null;

  return {
    pct: totalSlots > 0 ? Math.round((trackedSlots / totalSlots) * 100) : 0,
    trackedSlots,
    totalSlots,
    ateOut,
    daysWithMeals,
    entriesLogged,
    macroDays,
    avg,
    veg: Math.round(veg * 10) / 10,
    fruit: Math.round(fruit * 10) / 10,
    proteinByDay: proteinByDay(log, days),
  };
}

// ────────────────────────────────────────────────────────────────── weight

function summarizeWeight(weightLog, days) {
  const start = days[0];
  const end = days[days.length - 1];
  const inWeek = (Array.isArray(weightLog) ? weightLog : [])
    .filter(e => e?.date && e.date >= start && e.date <= end && Number.isFinite(Number(e.weight)))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (inWeek.length === 0) return { count: 0, first: null, last: null, change: null, lastDate: null };
  const first = Number(inWeek[0].weight);
  const last = Number(inWeek[inWeek.length - 1].weight);
  return {
    count: inWeek.length,
    first,
    last,
    change: inWeek.length > 1 ? last - first : null,
    lastDate: inWeek[inWeek.length - 1].date,
  };
}

// How many weeks the weight chart plots, ending with the reported week. Eight
// columns is about what a phone-width mail client can label legibly.
const WEIGHT_WEEKS = 8;

/**
 * Each week's LAST weigh-in for the past `weeks` weeks, oldest first and ending
 * with the reported week. The last reading rather than an average, so the
 * chart's final two points are exactly the "Latest" and "Vs prior week"
 * numbers printed under it. `weight` is null for a week with no weigh-in.
 */
export function summarizeWeightHistory(weightLog, week, weeks = WEIGHT_WEEKS) {
  const out = [];
  let w = week;
  for (let i = 0; i < weeks; i++) {
    const s = summarizeWeight(weightLog, w.days);
    out.unshift({ start: w.start, end: w.end, label: prettyDate(w.start), weight: s.last });
    w = previousWeek(w);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────── workouts

// Total external lb moved for set `i` — mirrors exerciseProgress.setWeightLb
// (per-set weights when present, doubled for per-arm loads).
function setWeightLb(entry, i) {
  let w;
  if (entry.useSetWeights && Array.isArray(entry.setWeights)) {
    w = parseFloat(entry.setWeights[i] || '');
    if (isNaN(w)) w = parseFloat(entry.weight || '');
  } else {
    w = parseFloat(entry.weight || '');
  }
  if (isNaN(w)) w = 0;
  return entry.perArm ? w * 2 : w;
}

function summarizeWorkouts(workouts, days) {
  const start = days[0];
  const end = days[days.length - 1];
  const inWeek = (Array.isArray(workouts) ? workouts : [])
    .filter(w => w?.date && w.date >= start && w.date <= end);

  const sessionDates = new Set();
  const saunaDates = new Set();
  const volumeByExercise = new Map();
  let sets = 0;
  let volume = 0;
  let seconds = 0;
  const exercises = new Set();

  for (const w of inWeek) {
    if (w.sauna) saunaDates.add(w.date);
    const entries = Array.isArray(w.entries) ? w.entries : [];
    let didAnything = false;
    for (const entry of entries) {
      const cells = Array.isArray(entry?.sets) ? entry.sets : [];
      let entryVolume = 0;
      for (let i = 0; i < cells.length; i++) {
        const parsed = parseSetValue(cells[i]);
        if (parsed.kind === 'reps' && parsed.reps > 0) {
          sets += 1;
          didAnything = true;
          entryVolume += setWeightLb(entry, i) * parsed.reps;
        } else if (parsed.kind === 'time' && parsed.seconds > 0) {
          sets += 1;
          didAnything = true;
          seconds += parsed.seconds;
        }
      }
      if (entryVolume > 0) {
        const name = String(entry.exercise || '').trim() || 'Unnamed';
        volumeByExercise.set(name, (volumeByExercise.get(name) || 0) + entryVolume);
        volume += entryVolume;
      }
      if (String(entry?.exercise || '').trim()) exercises.add(String(entry.exercise).trim());
    }
    if (didAnything) sessionDates.add(w.date);
  }

  const top = [...volumeByExercise.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, vol]) => ({ name, volume: vol }));

  return {
    sessions: sessionDates.size,
    sets,
    volume,
    minutes: Math.round(seconds / 60),
    exercises: exercises.size,
    saunas: saunaDates.size,
    top,
  };
}

// ─────────────────────────────────────────────────────────────── week goals

// The Week Plan page's "Week goals" tiles, recomputed for a finished week.
// Mirrors WeekPlanPage: WORKOUT_CATS + DEFAULT_WORKOUT_GOALS, tallyWorkouts,
// buildWorkoutsByDate (stretch and sauna-only records excluded), countSaunaDays,
// mealStatsForDays and produceForDays. Keep in step with that page — a goal that
// reads "met" in the email and "missed" on the page is worse than no tile.
const WORKOUT_CATS = [
  { key: 'weights', icon: '🏋️', label: 'Weights' },
  { key: 'cardio', icon: '🏃', label: 'Cardio' },
  { key: 'yoga', icon: '🧘', label: 'Yoga' },
  { key: 'rest', icon: '😴', label: 'Rest' },
];
const DEFAULT_WORKOUT_GOALS = { weights: 3, cardio: 1, yoga: 1, rest: 2 };

/** Days in the window that had each workout category logged; rest = days with
 *  none. Every day of a completed week is in the past, so unlike the live page
 *  there's no "not yet" cutoff to apply. */
function tallyWorkoutDays(workouts, days, typeCategories, stretchNames) {
  const byDate = new Map();
  for (const w of workouts || []) {
    if (!w?.date) continue;
    if (isStretchWorkout(w, stretchNames)) continue;
    const hasEntries = Array.isArray(w.entries) && w.entries.length > 0;
    const hasType = String(w.workoutType || '').trim().length > 0;
    if (!hasEntries && !hasType) continue; // sauna-only placeholder
    if (!byDate.has(w.date)) byDate.set(w.date, new Set());
    byDate.get(w.date).add(workoutCalendarCategory(w, typeCategories));
  }
  const out = { weights: 0, cardio: 0, yoga: 0, rest: 0 };
  for (const date of days) {
    const cats = byDate.get(date);
    if (cats && cats.size > 0) {
      for (const k of ['weights', 'cardio', 'yoga']) if (cats.has(k)) out[k] += 1;
    } else {
      out.rest += 1;
    }
  }
  return out;
}

function numOr(value, fallback) {
  const n = Number(value);
  return value == null || isNaN(n) ? fallback : n;
}

/**
 * Every configured week goal as { icon, label, actual, target, unit, met }.
 *
 * A goal of 0 is "not set" and is dropped: the Week Plan hides the /N when a
 * category has no goal, and a row reading "0/0 ✓" would claim credit for
 * something never asked for. "Ate out" is deliberately absent — the page shows
 * it as a count with no target, so it stays in the nutrition section.
 */
export function summarizeGoals(data, week, config = {}) {
  const meals = summarizeMeals(data.dailyLog, week.days);
  const stretchNames = new Set(
    (Array.isArray(data.stretchRoutines) ? data.stretchRoutines : [])
      .map(r => String(r?.name || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const tally = tallyWorkoutDays(data.workouts, week.days, config.workoutTypeCategories || {}, stretchNames);
  const workoutGoals = { ...DEFAULT_WORKOUT_GOALS, ...(config.workoutWeeklyGoals || {}) };

  const nutrition = config.nutritionGoals || {};
  const mealsTarget = Math.max(0, Math.min(100, numOr(nutrition.dailyMealsTrackedPct, 50)));
  // Produce is reported as an average per day, not a week total — mirroring the
  // Week Plan tiles, which compare against the DAILY goal you actually set.
  // Over a complete week the verdict is identical (total ≥ goal×7 is the same
  // statement as average ≥ goal), so the rolling met-rate below is unchanged;
  // only the figure on screen is in units a reader can act on.
  const vegTarget = numOr(nutrition.vegServings, 5);
  const fruitTarget = numOr(nutrition.fruitServings, 2);
  const perDay = n => Math.round((n / week.days.length) * 10) / 10;

  let saunas = 0;
  for (const w of data.workouts || []) if (w?.sauna && week.days.includes(w.date)) saunas += 1;
  // The Week Plan starts at DEFAULT_SAUNA_GOAL and only writes `saunaGoal` to
  // the user doc once the ⚙ popup is edited, so an untouched goal arrives here
  // as undefined. Reading that as 0 dropped the row for everyone who never
  // opened the popup — the goal the page was showing them went unreported.
  // Absent means the default; an explicit 0 still means "no goal".
  const saunaTarget = config.saunaGoal == null
    ? DEFAULT_SAUNA_GOAL
    : normalizeSaunaGoal(config.saunaGoal);

  const rows = [];
  const add = (icon, label, actual, target, unit = '') => {
    if (!(target > 0)) return;
    rows.push({ icon, label, actual, target, unit, met: actual >= target });
  };

  for (const c of WORKOUT_CATS) add(c.icon, c.label, tally[c.key], workoutGoals[c.key], ' days');
  add('🧖', 'Sauna', saunas, saunaTarget, ' days');
  add('🍽️', 'Meals tracked', meals.pct, mealsTarget, '%');
  add('🥦', 'Veg', perDay(meals.veg), Math.round(vegTarget * 10) / 10, ' servings/day');
  add('🍎', 'Fruit', perDay(meals.fruit), Math.round(fruitTarget * 10) / 10, ' servings/day');

  return { rows, met: rows.filter(r => r.met).length, total: rows.length };
}

/** How many weeks back the rolling met-rate column looks, counting the reported
 *  week as the most recent one. */
export const TREND_WEEKS = 10;

/**
 * Whether anything at all was recorded in `w`.
 *
 * Weeks with no activity are dropped from the rolling met-rate rather than
 * counted as misses. Two reasons, and the second is the load-bearing one:
 * someone six weeks into using the app would otherwise open the email to a
 * string of percentages dragged down by four weeks that predate their account;
 * and a week with nothing logged scores the Rest goal as seven rest days, so
 * counting it would hand out a "met" nobody earned.
 */
function weekHasActivity(data, w) {
  const log = data.dailyLog || {};
  for (const key of w.days) {
    const day = log[key];
    if (!day) continue;
    if (day.daySkipped) return true;
    for (const field of ['entries', 'skippedMeals', 'eatingOutMeals']) {
      if (Array.isArray(day[field]) && day[field].length > 0) return true;
    }
  }
  for (const wo of data.workouts || []) if (wo?.date && w.days.includes(wo.date)) return true;
  for (const e of data.weightLog || []) if (e?.date && w.days.includes(e.date)) return true;
  return false;
}

/**
 * How often each goal was met across the trailing `weeks` complete weeks,
 * ending with (and including) the reported one.
 *
 * Every week is scored against the goals as they are configured TODAY, because
 * the app keeps no history of what the targets used to be. That makes this
 * "how often would I have hit my current targets", not "how often did I hit
 * whatever I was aiming at then" — the honest reading of the only data there
 * is, and the one that makes the column comparable down the table.
 *
 * Keyed by label rather than index: the row set is stable while the config is,
 * but a goal turned off mid-window would otherwise shift every row beneath it
 * onto the wrong history.
 */
export function summarizeGoalTrend(data, week, config = {}, weeks = TREND_WEEKS) {
  const byLabel = new Map();
  let counted = 0;
  let w = week;
  for (let i = 0; i < weeks; i++) {
    if (i > 0) w = previousWeek(w);
    if (!weekHasActivity(data, w)) continue;
    counted += 1;
    for (const g of summarizeGoals(data, w, config).rows) {
      const c = byLabel.get(g.label) || { met: 0, weeks: 0 };
      c.weeks += 1;
      if (g.met) c.met += 1;
      byLabel.set(g.label, c);
    }
  }
  return { weeks: counted, span: weeks, byLabel };
}

// ────────────────────────────────────────────────────────────────── habits

const MARKS = ['exceeded', 'done', 'skipped', 'missed'];

function cadenceOf(h) {
  const c = String(h?.cadence || '').trim().toLowerCase();
  return c === 'weekly' || c === 'monthly' || c === 'annually' ? c : 'daily';
}

function trackedWeekdays(h) {
  const t = h?.trackDays;
  return Array.isArray(t) && t.length > 0 ? t : [0, 1, 2, 3, 4, 5, 6];
}

/**
 * Per-habit tallies over the week's cells.
 *
 * Only Daily and Weekly habits are counted: a monthly or annual period doesn't
 * open and close inside one week, so scoring it here would either double-count
 * it across four emails or report it as missed while it's still in progress.
 */
function summarizeHabits(habits, habitLog, days) {
  const log = habitLog && typeof habitLog === 'object' ? habitLog : {};
  const list = (Array.isArray(habits) ? habits : []).filter(h => (
    h && String(h.name || '').trim() && isLoggableHabit(h)
  ));
  const weekKey = weekKeyOfDate(days[0]);

  const totals = { due: 0, exceeded: 0, done: 0, skipped: 0, missed: 0, unlogged: 0 };
  const perHabit = [];

  for (const h of list) {
    const cadence = cadenceOf(h);
    if (cadence !== 'daily' && cadence !== 'weekly') continue;

    const cells = [];
    if (cadence === 'daily') {
      const trackDays = trackedWeekdays(h);
      for (const key of days) {
        if (!trackDays.includes(dowOf(key))) continue; // off-day → wasn't due
        cells.push((log[key] || {})[h.id]);
      }
    } else {
      cells.push((log[weekKey] || {})[h.id]);
    }
    if (cells.length === 0) continue;

    const tally = { due: cells.length, exceeded: 0, done: 0, skipped: 0, missed: 0, unlogged: 0 };
    for (const mark of cells) {
      if (MARKS.includes(mark)) tally[mark] += 1;
      else tally.unlogged += 1;
    }
    for (const k of Object.keys(tally)) totals[k] += tally[k];

    const scored = tally.due - tally.skipped;
    perHabit.push({
      name: String(h.name).trim(),
      cadence,
      ...tally,
      hit: tally.done + tally.exceeded,
      rate: scored > 0 ? (tally.done + tally.exceeded) / scored : null,
    });
  }

  const scored = totals.due - totals.skipped;
  perHabit.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.name.localeCompare(b.name));

  return {
    trackedHabits: perHabit.length,
    ...totals,
    hit: totals.done + totals.exceeded,
    rate: scored > 0 ? Math.round(((totals.done + totals.exceeded) / scored) * 100) : null,
    perfect: perHabit.filter(h => h.rate === 1 && h.due > 0).map(h => h.name),
    struggling: perHabit
      .filter(h => h.rate != null && h.rate < 0.5)
      .slice(-5)
      .reverse()
      .map(h => ({ name: h.name, hit: h.hit, due: h.due - h.skipped })),
    perHabit,
  };
}

// ─────────────────────────────────────────────────────────────── the summary

/**
 * Everything the email reports, for one week window.
 *
 * @param {object} data raw user data (dailyLog map, weightLog, workouts,
 *   habits, habitLog)
 * @param {object} week a window from lastCompleteWeek / previousWeek
 */
// ──────────────────────────────────────────────────────────── lifts to watch

/**
 * Exercises the trend says are going backwards or standing still, as of the end
 * of the reported week.
 *
 * This is the SAME classifier the website's Workout > Progress tab runs
 * (src/utils/exerciseProgress.analyzeProgress) — deliberately, so the email can
 * never disagree with the page. That means it reads the trailing WINDOW_DAYS of
 * training, not just the reported week: a single week is far too short to call a
 * trend, which is exactly why the week's own volume numbers can't answer this.
 *
 * `now` is pinned to the END OF THE WEEK BEING REPORTED rather than the moment
 * the mail is sent, so a summary says what was true then — and a re-send of an
 * old week doesn't quietly report today's trends.
 *
 * Stretches are excluded by the classifier itself via `typeByName`; a hold you
 * do the same way every week isn't stagnating, it just isn't playing that game.
 */
/**
 * name → muscle group, name → the user's own discipline tag, name → library
 * row. Library rows win over custom entries, matching exerciseTypeForName in
 * both apps. Shared by the trend analysis and the stretch board so the two can
 * never disagree about which exercises are stretches.
 */
function exerciseIndexes(data) {
  const library = Array.isArray(data.exerciseLibrary) ? data.exerciseLibrary : [];
  const customs = Array.isArray(data.customExercises) ? data.customExercises : [];
  const groupByName = new Map();
  const typeByName = new Map();
  const libraryByName = new Map();
  for (const row of library) {
    if (!row?.exercise) continue;
    const key = String(row.exercise).trim().toLowerCase();
    const group = row.muscleGroup || row.group || '';
    if (!groupByName.has(key) && group) groupByName.set(key, group);
    if (!typeByName.has(key)) typeByName.set(key, effectiveExerciseType(row, group));
    if (!libraryByName.has(key)) libraryByName.set(key, row);
  }
  for (const c of customs) {
    if (!c?.name) continue;
    const key = String(c.name).trim().toLowerCase();
    if (!groupByName.has(key) && c.muscleGroup) groupByName.set(key, c.muscleGroup);
    if (!typeByName.has(key)) typeByName.set(key, effectiveExerciseType(c, c.muscleGroup));
  }
  return { groupByName, typeByName, libraryByName };
}

// How many sessions the mail's sparkline draws. A 60-day window can hold far
// more than this and the bars stop being legible long before it does.
const SPARK_POINTS = 12;

function summarizeProgress(data, week) {
  const workouts = Array.isArray(data.workouts) ? data.workouts : [];
  if (workouts.length === 0) return { decreasing: [], stagnating: [], analysed: false };

  const { groupByName, typeByName, libraryByName } = exerciseIndexes(data);

  // End of the reported week, at midday UTC so the day can't slip either way.
  const [y, m, d] = String(week.end).split('-').map(Number);
  const now = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

  const groups = analyzeProgress(workouts, groupByName, {
    now,
    weightLog: data.weightLog,
    libraryByName,
    typeByName,
  });

  const shape = r => ({
    name: r.name,
    group: r.group || '',
    deltaPct: r.deltaPct,
    volDeltaPct: r.volDeltaPct,
    sessions: r.sessions,
    lastDate: r.lastDate || r.lastLoggedDate || null,
    annotations: Array.isArray(r.annotations) ? r.annotations : [],
    // The shape of the trend, for the mail's sparkline — the same per-session
    // values the website's Progress tab plots.
    series: (Array.isArray(r.series) ? r.series : [])
      .slice(-SPARK_POINTS)
      .map(p => (typeof p?.value === 'number' && Number.isFinite(p.value) ? p.value : null))
      .filter(v => v != null),
  });

  // No cap: the ask was every exercise in these two states, not a top N.
  return {
    decreasing: (groups.decreasing || []).map(shape),
    stagnating: (groups.stagnating || []).map(shape),
    analysed: true,
    windowDays: WINDOW_DAYS,
  };
}

// ──────────────────────────────────────────────────────── stretch board

/**
 * The Workout page's stretch goal board, recomputed for a finished week —
 * minutes held per body region against the per-region goal.
 *
 * The board on the page is a ROLLING last-7-days window ending today; here it's
 * the reported Sun–Sat week instead. Same seven days' worth, but pinned to the
 * week every other number in this email is about, so a Wednesday send can't
 * show a stretch table covering days the rest of the mail doesn't. Reached by
 * handing stretchSecondsByRegion the week's last day as "today" over a 7-day
 * window, with the workouts pre-clipped to the week (the loader pulls a wider
 * range for the trend analysis, and the util has no upper bound of its own).
 *
 * What counts as a stretch is the user's own `exerciseType` tag, resolved
 * exactly as summarizeProgress resolves it — so a timed plank in the same
 * session stays out of the Abdominals total. The page derives its set by
 * walking the muscle groups instead; the only gap is a Stretching-tagged
 * exercise filed under no group at all, which this counts and the page misses,
 * and which can only land in a region by pose name anyway.
 */
function summarizeStretch(data, week) {
  const { typeByName } = exerciseIndexes(data);
  const isStretch = name => typeByName.get(String(name || '').trim().toLowerCase()) === 'Stretching';

  const inWeek = (Array.isArray(data.workouts) ? data.workouts : [])
    .filter(w => w?.date && w.date >= week.start && w.date <= week.end);

  // Midday local so the util's local getFullYear/getMonth/getDate can't slip a
  // day either side of the boundary, whatever TZ the cron container runs in.
  const [y, m, d] = String(week.end).split('-').map(Number);
  const endOfWeek = new Date(y, m - 1, d, 12, 0, 0);

  const goalMin = clampGoalMin(data.stretchGoalMin);
  const seconds = stretchSecondsByRegion(inWeek, isStretch, endOfWeek, STRETCH_GOAL_WINDOW_DAYS);
  const rows = stretchGoalProgress(seconds, goalMin);

  return {
    rows,
    goalMin,
    regions: STRETCH_REGIONS.length,
    met: rows.filter(r => r.met).length,
    totalSeconds: rows.reduce((sum, r) => sum + r.seconds, 0),
  };
}

/**
 * `withProgress` is opt-in because the trend analysis is a regression over every
 * exercise in the trailing window, and the prior-week summary exists only to
 * produce comparison deltas — it would throw that work away.
 */
export function summarizeWeek(data, week, { withProgress = false, goalsConfig = null } = {}) {
  return {
    week,
    // The multi-week histories reach back past this week's window, so they're
    // built here (where the whole log is in hand) rather than in
    // summarizeMeals, which only ever sees the seven days it's summarizing.
    meals: {
      ...summarizeMeals(data.dailyLog, week.days),
      ateOutHistory: summarizeAteOutHistory(data.dailyLog, week),
      qualityHistory: summarizeMealQualityHistory(data.dailyLog, week),
    },
    weight: {
      ...summarizeWeight(data.weightLog, week.days),
      history: summarizeWeightHistory(data.weightLog, week),
    },
    workouts: summarizeWorkouts(data.workouts, week.days),
    habits: summarizeHabits(data.habits, data.habitLog, week.days),
    stretch: summarizeStretch(data, week),
    weekGoals: goalsConfig ? goalsWithTrend(data, week, goalsConfig) : null,
    progress: withProgress ? summarizeProgress(data, week) : null,
  };
}

/** This week's goals, each carrying its rolling met-rate over TREND_WEEKS. */
function goalsWithTrend(data, week, config) {
  const goals = summarizeGoals(data, week, config);
  const trend = summarizeGoalTrend(data, week, config);
  for (const g of goals.rows) {
    const c = trend.byLabel.get(g.label);
    g.trend = c && c.weeks > 0
      ? { met: c.met, weeks: c.weeks, pct: Math.round((c.met / c.weeks) * 100) }
      : null;
  }
  goals.trendWeeks = trend.weeks;
  goals.trendSpan = trend.span;
  return goals;
}

/** True when the week has nothing worth mailing about. */
export function isEmptyWeek(s) {
  return s.meals.entriesLogged === 0
    && s.meals.trackedSlots === 0
    && s.weight.count === 0
    && s.workouts.sessions === 0
    && s.habits.due === 0;
}

// ───────────────────────────────────────────────────────────────── rendering

function round(n, digits = 0) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function fmtNum(n, digits = 0) {
  const r = round(n, digits);
  if (r == null) return '—';
  return r.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Trend deltas come out of exerciseProgress as fractions (0.042 = +4.2%), not
// as percentages — feeding them to signed() would report a 4% drop as "−0".
function signedPct(fraction) {
  if (fraction == null || !Number.isFinite(fraction)) return '';
  const r = Math.round(fraction * 1000) / 10;
  if (r === 0) return '0.0%';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}%`;
}

function signed(n, digits = 0, suffix = '') {
  const r = round(n, digits);
  if (r == null) return null;
  if (r === 0) return `no change`;
  return `${r > 0 ? '+' : '−'}${fmtNum(Math.abs(r), digits)}${suffix}`;
}

function deltaText(now, before, { digits = 0, suffix = '' } = {}) {
  if (now == null || before == null || !Number.isFinite(now) || !Number.isFinite(before)) return '';
  const label = signed(now - before, digits, suffix);
  return label ? ` (${label} vs prior week)` : '';
}

function sectionHeading(title) {
  return `<h2 style="font-size:15px;font-weight:700;margin:22px 0 6px 0;color:#111827;">${escapeHtml(title)}</h2>`;
}

function row(label, value) {
  return `<tr>`
    + `<td style="padding:5px 10px 5px 0;font-size:13px;color:#6b7280;white-space:nowrap;">${escapeHtml(label)}</td>`
    + `<td style="padding:5px 0;font-size:13px;color:#111827;">${value}</td>`
    + `</tr>`;
}

function table(rows) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;">${rows.join('')}</table>`;
}

/** Bar width for a goal, capped at 100 — overshooting a goal fills the bar,
 *  it doesn't overflow the cell. */
function goalPctOf(g) {
  if (!(g.target > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((g.actual / g.target) * 100)));
}

// A progress bar built from table cells, because a styled <div> width is the
// first thing Outlook throws away. Zero-progress rows omit the filled cell
// entirely: a 0%-width cell still paints a sliver in several clients, which
// reads as "started" when nothing happened.
// ── lifts to watch: the Progress tab's cards, in email-safe HTML ──
// The website draws each lift's trend as an inline SVG sparkline. Mail clients
// strip SVG, so the same shape is built out of table cells: one bar per
// session, scaled between the lowest and highest point, sitting in a light
// track so a short bar still reads as "low" rather than "missing". The last bar
// is drawn solid — it's the endpoint dot on the website, and it's the value the
// percentage is about.

/** Status colour, icon, label and blurb — mirrors STATUS_META in ExerciseProgressTracker.jsx. */
const PROGRESS_STATUS = {
  decreasing: { label: 'Decreasing', icon: '📉', color: '#dc2626', blurb: 'Estimated 1RM trending down' },
  stagnating: { label: 'Stagnating', icon: '➖', color: '#d97706', blurb: '1RM holding flat — no added stimulus' },
};

/**
 * A bar per session, showing the SHAPE of the run. The dashed baseline the
 * website draws is deliberately not reproduced: a 1px rule inside a table row
 * is the first thing a mail client eats, and the comparison it makes is already
 * carried, in words, by the percentage beside the bars.
 *
 * Two things min-max scaling gets wrong here, both found by rendering it:
 * a flat run collapses to a row of slivers that reads as missing data, and a
 * single outlier squashes every other bar to nothing. So a run with no real
 * spread is drawn flat at half height — "nothing moved" is the finding — and
 * everything else starts at a quarter height, which keeps the smallest bar
 * visible while the differences between them stay honest.
 */
function sparkBars(values, color) {
  const vals = (values || []).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (vals.length < 2) return `<span style="color:#cbd5e1;font-size:12px;">—</span>`;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const range = hi - lo;
  const scale = Math.max(Math.abs(hi), Math.abs(lo), 1e-9);
  const flat = range === 0 || range / scale < 0.02;
  const FLOOR = 0.25; // shortest bar, as a fraction of the track
  const frac = v => (flat ? 0.5 : FLOOR + (1 - FLOOR) * ((v - lo) / range));
  const H = 28; // px of track
  const cells = vals.map((v, i) => {
    const isLast = i === vals.length - 1;
    const h = Math.max(2, Math.round(frac(v) * H));
    const pad = H - h;
    // Two stacked cells: an empty spacer above, the bar below. Bulletproof in
    // clients that ignore vertical-align on a div.
    return `<td style="padding:0 1px;vertical-align:bottom;">`
      + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">`
      + (pad > 0 ? `<tr><td style="height:${pad}px;line-height:${pad}px;font-size:0;">&nbsp;</td></tr>` : '')
      + `<tr><td style="width:7px;height:${h}px;line-height:${h}px;font-size:0;background:${color};`
      + `opacity:${isLast ? '1' : '0.45'};border-radius:2px;">&nbsp;</td></tr>`
      + `</table></td>`;
  }).join('');
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" `
    + `style="border-collapse:collapse;background:#f1f5f9;border-radius:4px;padding:2px;">`
    + `<tr>${cells}</tr></table>`;
}

/** One status card: header line, then a row per lift. */
function renderProgressCard(statusKey, rows, signedPctFn) {
  const meta = PROGRESS_STATUS[statusKey];
  const cell = 'padding:8px 10px;border-bottom:1px solid #eef2f6;font-size:13px;vertical-align:middle;';
  const body = rows.map(r => {
    const grp = r.group ? ` <span style="color:#9ca3af;font-size:11px;">${escapeHtml(r.group)}</span>` : '';
    const volDown = r.annotations.includes('volume-down')
      ? ` <span style="color:#dc2626;font-size:11px;">· volume down</span>` : '';
    const pct = r.deltaPct == null ? '' : signedPctFn(r.deltaPct);
    return `<tr>`
      + `<td style="${cell}">`
      + `<span style="font-weight:600;color:#111827;">${escapeHtml(r.name)}</span>${grp}<br/>`
      + `<span style="color:#9ca3af;font-size:11px;">${r.sessions} session${r.sessions === 1 ? '' : 's'}</span>${volDown}`
      + `</td>`
      + `<td style="${cell}width:120px;">${sparkBars(r.series, meta.color)}</td>`
      + `<td style="${cell}text-align:right;white-space:nowrap;">`
      + `<span style="color:${meta.color};font-weight:700;">${pct}</span>`
      + `<br/><span style="color:#9ca3af;font-size:11px;">est. 1RM</span>`
      + `</td></tr>`;
  }).join('');
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" `
    + `style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;border-left:3px solid ${meta.color};`
    + `border-radius:8px;overflow:hidden;margin-bottom:10px;">`
    + `<thead><tr><th colspan="3" style="padding:8px 10px;text-align:left;background:#f9fafb;`
    + `border-bottom:1px solid #e5e7eb;font-size:13px;font-weight:700;color:${meta.color};">`
    + `${meta.icon} ${escapeHtml(meta.label)} <span style="color:#6b7280;font-weight:600;">(${rows.length})</span>`
    + ` <span style="color:#9ca3af;font-weight:400;font-size:11px;">— ${escapeHtml(meta.blurb)}</span>`
    + `</th></tr></thead><tbody>${body}</tbody></table>`;
}

function goalBar(pct, met) {
  const w = Math.max(0, Math.min(100, Math.round(pct)));
  const color = met ? '#16a34a' : w >= 60 ? '#d97706' : '#dc2626';
  const cell = 'height:8px;line-height:8px;font-size:0;';
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;width:100%;background:#eef2f6;border-radius:999px;">`
    + `<tr>`
    + (w > 0 ? `<td style="${cell}width:${w}%;background:${color};border-radius:999px;">&nbsp;</td>` : '')
    + (w < 100 ? `<td style="${cell}">&nbsp;</td>` : '')
    + `</tr></table>`;
}

// ── charts ─────────────────────────────────────────────────────────────────
//
// Everything here is built from table cells with pixel heights, for the same
// reason goalBar is: Outlook renders mail through Word, which drops SVG
// outright and throws away most sizing on a <div>. A `<td>` with an explicit
// height and a background colour is the one drawing primitive every client
// agrees on — so a "line chart" becomes columns, which carries the same shape
// and actually arrives.

const CHART_BAR = '#c96442';
const CHART_TRACK = '#eef2f6';

/** A single vertical bar segment, bottom-aligned in its band. */
function barSegment(heightPx, color, { roundedTop = false } = {}) {
  const h = Math.max(0, Math.round(heightPx));
  // A zero-height cell still paints a sliver in several clients, which reads
  // as a short day rather than as nothing — so draw no cell at all.
  if (h === 0) return '&nbsp;';
  const radius = roundedTop ? 'border-radius:3px 3px 0 0;' : '';
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;">`
    + `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;background:${color};${radius}">&nbsp;</td></tr>`
    + `</table>`;
}

/**
 * Protein per day, as columns, with the daily goal drawn across as a dashed
 * line.
 *
 * The goal line is why the plot is split into two bands: a table can't overlay
 * a rule on top of a column, but it CAN put a dashed border on a row that sits
 * between them. So the area below the goal is one row of cells, the area above
 * it another, and a bar that beats the goal is drawn in both — crossing the
 * line the way it should. With no protein goal set there's nothing to draw a
 * line at, so it collapses to a single band scaled to the best day.
 *
 * `key` picks which reading to draw: 'protein' (the day's total) or 'perMeal'
 * (the day's average meal), with `caption` naming it.
 */
function proteinChart(byDay, goal, { key = 'protein', caption } = {}) {
  const days = Array.isArray(byDay) ? byDay : [];
  if (days.length === 0) return '';
  const values = days.map(d => (Number.isFinite(d[key]) ? d[key] : null));
  if (values.every(v => v === null)) return '';
  const max = Math.max(...values.filter(v => v !== null), 0);
  const hasGoal = Number.isFinite(goal) && goal > 0;

  const BELOW = 74;
  const ABOVE = 26;
  // Headroom above the goal line: a third of the goal, or enough for the best
  // day, so the tallest bar always fits inside the band.
  const ceiling = hasGoal ? Math.max(max, goal * 1.35) : Math.max(max, 1);

  const heights = values.map(v => {
    if (v === null) return { below: 0, above: 0 };
    if (!hasGoal) return { below: (v / ceiling) * (BELOW + ABOVE), above: 0 };
    return {
      below: (Math.min(v, goal) / goal) * BELOW,
      above: v > goal ? Math.min(ABOVE, ((v - goal) / (ceiling - goal)) * ABOVE) : 0,
    };
  });

  // Same colour language as the goal bars above: green once the day is met,
  // amber within reach, red well short. With no goal there's nothing to be
  // short of, so every bar is just the brand accent.
  const colorFor = (v) => {
    if (!hasGoal || v === null) return CHART_BAR;
    const pct = (v / goal) * 100;
    return pct >= 100 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
  };

  const cell = 'padding:0 3px;';
  const aboveRow = `<tr>${days.map((d, i) =>
    `<td valign="bottom" style="${cell}">${barSegment(heights[i].above, colorFor(values[i]), { roundedTop: true })}</td>`
  ).join('')}</tr>`;
  const goalRow = hasGoal
    ? `<tr><td colspan="${days.length}" style="height:0;line-height:0;font-size:0;border-top:1px dashed #9ca3af;">&nbsp;</td></tr>`
    : '';
  const belowRow = `<tr>${days.map((d, i) => {
    const rounded = !hasGoal || heights[i].above === 0;
    return `<td valign="bottom" height="${BELOW}" style="${cell}height:${BELOW}px;">`
      + `${barSegment(heights[i].below, colorFor(values[i]), { roundedTop: rounded })}</td>`;
  }).join('')}</tr>`;
  const labelRow = `<tr>${days.map(d =>
    `<td align="center" style="${cell}padding-top:4px;font-size:11px;color:#6b7280;">${escapeHtml(d.dow)}</td>`
  ).join('')}</tr>`;
  const valueRow = `<tr>${days.map((d, i) =>
    `<td align="center" style="${cell}font-size:11px;color:${values[i] === null ? '#d1d5db' : '#111827'};font-weight:600;">`
    + `${values[i] === null ? '—' : values[i]}</td>`
  ).join('')}</tr>`;

  return `<div style="margin:10px 0 4px 0;font-size:12px;color:#6b7280;">${caption}</div>`
    + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;table-layout:fixed;">`
    + `<tr><td colspan="${days.length}" height="${ABOVE}" style="height:${ABOVE}px;font-size:0;line-height:0;">`
    + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;table-layout:fixed;">${aboveRow}</table>`
    + `</td></tr>`
    + goalRow
    + belowRow
    + labelRow
    + valueRow
    + `</table>`
    + `<div style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;margin-top:2px;">&nbsp;</div>`;
}

/**
 * Weight over the last few weeks, one dot per week, with the goal weight drawn
 * across as a dashed line.
 *
 * Dots rather than columns: a bar implies a zero baseline, and 178 vs 176 lbs
 * on a scale that starts at 0 is two identical bars. The axis is instead
 * fitted to the readings (and the goal, so the line is always on the chart),
 * and each column is a stack of cells — spacer, dot, spacer, dashed goal rule —
 * which is the same table-only drawing proteinChart uses, for the same Outlook
 * reasons. Columns have no side padding so the goal rule runs unbroken.
 */
function weightChart(history, goal) {
  const weeks = Array.isArray(history) ? history : [];
  const values = weeks.map(w => (Number.isFinite(w.weight) ? w.weight : null));
  const known = values.filter(v => v !== null);
  if (known.length === 0) return '';
  const hasGoal = Number.isFinite(goal) && goal > 0;

  const PLOT = 90;
  const DOT = 8;
  let lo = Math.min(...known, hasGoal ? goal : Infinity);
  let hi = Math.max(...known, hasGoal ? goal : -Infinity);
  const pad = Math.max(0.5, (hi - lo) * 0.12);
  lo -= pad;
  hi += pad;
  const yOf = v => Math.round(((hi - v) / (hi - lo)) * (PLOT - DOT));
  const goalY = hasGoal ? yOf(goal) + DOT / 2 : null;

  const spacer = h => (h > 0
    ? `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr>`
    : '');
  const goalRule = `<tr><td style="height:0;line-height:0;font-size:0;border-top:1px dashed #9ca3af;">&nbsp;</td></tr>`;
  const dot = color => `<tr><td align="center" style="height:${DOT}px;line-height:${DOT}px;font-size:0;">`
    + `<table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">`
    + `<tr><td style="width:${DOT}px;height:${DOT}px;line-height:${DOT}px;font-size:0;background:${color};border-radius:50%;">&nbsp;</td></tr>`
    + `</table></td></tr>`;

  const last = weeks.length - 1;
  const column = (v, i) => {
    const color = i === last ? CHART_BAR : '#e0b3a3';
    let rows;
    if (v === null) {
      rows = hasGoal ? spacer(goalY) + goalRule : '';
    } else {
      const top = yOf(v);
      if (!hasGoal) rows = spacer(top) + dot(color);
      else if (goalY < top) rows = spacer(goalY) + goalRule + spacer(top - goalY - 1) + dot(color);
      else if (goalY >= top + DOT) rows = spacer(top) + dot(color) + spacer(goalY - top - DOT) + goalRule;
      else rows = spacer(top) + dot(color) + goalRule; // the dot sits on the line
    }
    return `<td valign="top" height="${PLOT}" style="padding:0;height:${PLOT}px;">`
      + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;">${rows}</table>`
      + `</td>`;
  };

  const plotRow = `<tr>${values.map(column).join('')}</tr>`;
  const valueRow = `<tr>${values.map((v, i) =>
    `<td align="center" style="padding-top:4px;font-size:11px;font-weight:600;color:${v === null ? '#d1d5db' : i === last ? '#111827' : '#6b7280'};">`
    + `${v === null ? '—' : fmtNum(v, 1)}</td>`
  ).join('')}</tr>`;
  const labelRow = `<tr>${weeks.map((w, i) =>
    `<td align="center" style="font-size:10px;color:${i === last ? '#111827' : '#9ca3af'};white-space:nowrap;">${escapeHtml(w.label)}</td>`
  ).join('')}</tr>`;

  const caption = `Weight · last ${weeks.length} weeks · lbs <span style="color:#9ca3af;">— last weigh-in each week`
    + `${hasGoal ? `; dashed line is your ${fmtNum(goal, 1)} lbs goal` : ''}</span>`;
  return `<div style="margin:10px 0 4px 0;font-size:12px;color:#6b7280;">${caption}</div>`
    + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;table-layout:fixed;">`
    + plotRow + valueRow + labelRow
    + `</table>`
    + `<div style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;margin:2px 0 8px 0;">&nbsp;</div>`;
}

/**
 * One reading per week, oldest on the left — the same dot plot the Weight
 * section uses, so every trend in the email reads the same way.
 *
 * The scale is pinned to zero at the bottom (unlike weight, where the interesting
 * range is a few pounds near the top) so a dot's height is the value itself and a
 * week of eating in every night lands on the floor rather than floating.
 *
 * `value` reads a week's number, or null for a week that measured nothing —
 * those draw no dot and show "—", the same unknown-isn't-zero rule the protein
 * chart follows. With a `goal` the target is drawn across as a dashed rule and
 * the dots take the goal-bar colour language; without one only the reported
 * week is picked out in the accent, as the eating-out chart has always done.
 */
function weeklyDotChart(history, { value, caption, goal = null, format = String } = {}) {
  const weeks = Array.isArray(history) ? history : [];
  if (weeks.length === 0) return '';
  const values = weeks.map(w => {
    const v = value(w);
    return Number.isFinite(v) ? v : null;
  });
  const known = values.filter(v => v !== null);
  if (known.length === 0) return '';
  const hasGoal = Number.isFinite(goal) && goal > 0;

  const PLOT = 90;
  const DOT = 8;
  // Headroom above the busiest week — and above the goal, so the rule is always
  // on the chart — so the top dot isn't flush with the caption.
  const hi = Math.max(...known, hasGoal ? goal : 0, 1) * 1.15;
  const yOf = v => Math.round(((hi - v) / hi) * (PLOT - DOT));
  const goalY = hasGoal ? yOf(goal) + DOT / 2 : null;

  const spacer = h => (h > 0
    ? `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr>`
    : '');
  const dot = color => `<tr><td align="center" style="height:${DOT}px;line-height:${DOT}px;font-size:0;">`
    + `<table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">`
    + `<tr><td style="width:${DOT}px;height:${DOT}px;line-height:${DOT}px;font-size:0;background:${color};border-radius:50%;">&nbsp;</td></tr>`
    + `</table></td></tr>`;

  const last = weeks.length - 1;
  // Same colour language as the goal bars and the protein chart: green once the
  // week is met, amber within reach, red well short.
  const colorFor = (v, i) => {
    if (!hasGoal) return i === last ? CHART_BAR : '#e0b3a3';
    const pct = (v / goal) * 100;
    return pct >= 100 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
  };

  // A column is a stack of cells — spacer then dot — because a mail client
  // won't overlay a dot on a plot.
  const column = (v, i, bandTop, bandHeight) => {
    let rows = '';
    if (v !== null) {
      // Clamped into the band so a dot sitting almost exactly on the goal
      // can't overflow and shove the dashed rule down with it. Worth up to
      // half a dot of drift in the dot; the LINE staying straight matters more.
      const top = Math.max(0, Math.min(yOf(v) - bandTop, bandHeight - DOT));
      rows = spacer(top) + dot(colorFor(v, i));
    }
    return `<td valign="top" height="${bandHeight}" style="padding:0;height:${bandHeight}px;">`
      + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;">${rows}</table>`
      + `</td>`;
  };

  // With a goal the plot is split into two bands with the dashed rule between
  // them, the way proteinChart draws its goal line: a table can't lay a rule
  // over a plot, but it CAN put a dashed border on a row that sits between two.
  // Drawing the rule per column (as the weight chart does) lets it land at a
  // slightly different height in each one, which reads as a broken line as
  // soon as several dots sit near the goal.
  const band = (rows, height) => `<tr><td colspan="${weeks.length}" height="${height}" style="height:${height}px;font-size:0;line-height:0;">`
    + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;table-layout:fixed;">${rows}</table>`
    + `</td></tr>`;

  let plotRow;
  if (!hasGoal) {
    plotRow = `<tr>${values.map((v, i) => column(v, i, 0, PLOT)).join('')}</tr>`;
  } else {
    const above = Math.max(DOT, Math.round(goalY));
    const below = Math.max(DOT, PLOT - above);
    // Each dot belongs to exactly one band, so it's drawn once and the other
    // band leaves its column empty.
    const inAbove = values.map(v => (v !== null && v >= goal ? v : null));
    const inBelow = values.map(v => (v !== null && v < goal ? v : null));
    plotRow = band(`<tr>${inAbove.map((v, i) => column(v, i, 0, above)).join('')}</tr>`, above)
      + `<tr><td colspan="${weeks.length}" style="height:0;line-height:0;font-size:0;border-top:1px dashed #9ca3af;">&nbsp;</td></tr>`
      + band(`<tr>${inBelow.map((v, i) => column(v, i, above, below)).join('')}</tr>`, below);
  }
  const valueRow = `<tr>${values.map((v, i) =>
    `<td align="center" style="padding-top:4px;font-size:11px;font-weight:600;color:${v === null ? '#d1d5db' : i === last ? '#111827' : '#6b7280'};">`
    + `${v === null ? '—' : escapeHtml(format(v))}</td>`
  ).join('')}</tr>`;
  const labelRow = `<tr>${weeks.map((w, i) =>
    `<td align="center" style="font-size:10px;color:${i === last ? '#111827' : '#9ca3af'};white-space:nowrap;">${escapeHtml(w.label)}</td>`
  ).join('')}</tr>`;

  return `<div style="margin:10px 0 4px 0;font-size:12px;color:#6b7280;">${caption}</div>`
    + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;table-layout:fixed;">`
    + plotRow + valueRow + labelRow
    + `</table>`
    + `<div style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;margin:2px 0 8px 0;">&nbsp;</div>`;
}

const WEEK_AXIS_NOTE = '— week beginning; the last column is the week this email covers';

function ateOutChart(history) {
  const weeks = Array.isArray(history) ? history : [];
  return weeklyDotChart(weeks, {
    // Zero is a real answer here — "we ate in every night" is worth a dot.
    value: w => (Number.isFinite(w.ateOut) ? w.ateOut : 0),
    caption: `Meals eaten out · last ${weeks.length} weeks `
      + `<span style="color:#9ca3af;">${WEEK_AXIS_NOTE}</span>`,
  });
}

/**
 * What share of the week's meals hit the per-meal protein goal, one point per
 * week. The goal is the daily protein target split evenly over the three main
 * meals — the same number the "Avg protein per meal" chart draws its line at,
 * so a reader can go from "this week's meals averaged 38g" to "and I've hit
 * that in 6 meals out of 10 for the last two months".
 *
 * A week with no priced meals is null rather than 0%: nothing was measured, so
 * nothing was missed.
 */
function proteinHitRateChart(history, perMealGoal) {
  const weeks = Array.isArray(history) ? history : [];
  if (!Number.isFinite(perMealGoal) || perMealGoal <= 0) return '';
  return weeklyDotChart(weeks, {
    value: w => (w.meals > 0
      ? Math.round((w.proteins.filter(p => p >= perMealGoal).length / w.meals) * 100)
      : null),
    goal: 100,
    format: v => `${v}%`,
    caption: `Meals hitting the ${Math.round(perMealGoal)}g protein goal · last ${weeks.length} weeks `
      + `<span style="color:#9ca3af;">— % of breakfasts, lunches &amp; dinners logged; ${WEEK_AXIS_NOTE.slice(2)}</span>`,
  });
}

/**
 * Average fibre per logged meal, one point per week. Only meals that actually
 * recorded a fibre figure count — see mainMealNutrition. A week that measured
 * none is null, not a 0g week.
 */
function fiberPerMealChart(history, perMealGoal) {
  const weeks = Array.isArray(history) ? history : [];
  const hasGoal = Number.isFinite(perMealGoal) && perMealGoal > 0;
  return weeklyDotChart(weeks, {
    value: w => w.fiberAvg,
    goal: hasGoal ? perMealGoal : null,
    format: v => fmtNum(v, 1),
    caption: `Avg fibre per meal · g · last ${weeks.length} weeks `
      + `<span style="color:#9ca3af;">— breakfasts, lunches &amp; dinners with fibre logged`
      + `${hasGoal ? `; dashed line is ${Math.round(perMealGoal)}g (your daily goal ÷ 3)` : ''}</span>`,
  });
}

// Two categorical hues for the admin chart, validated as a pair for
// colour-vision deficiency against a light surface (ΔE 27.5 protan / 27.7
// tritan) — not picked by eye. The first is the brand accent every other chart
// in this email already uses, so "total" stays the familiar colour and the
// second series is the new one.
const SERIES_COLORS = { total: CHART_BAR, active: '#2563eb' };

/**
 * Several readings per column, plotted as dots on one shared axis — the two
 * series of a line chart, drawn the only way a mail client can be trusted to
 * draw anything (nested tables; no SVG, which Outlook drops).
 *
 * A column is a top-down STACK of cells, so the dots in it are emitted in
 * y-order with the gaps between them as spacers, and a running cursor stops a
 * later dot from being placed above one already drawn. Two readings a pixel
 * apart therefore sit touching rather than overlapping — the one distortion
 * this idiom can't avoid, and the value rows underneath carry the exact
 * numbers for it.
 *
 * ONE axis for every series, scaled to the largest reading across all of them:
 * two y-scales would let a flat line and a climbing one be drawn identically.
 * Zero is the floor because these are counts — half the point of the chart is
 * how far above nothing the numbers are.
 */
function multiSeriesDotChart(points, series, { caption, legendNote = '' } = {}) {
  const cols = Array.isArray(points) ? points : [];
  if (cols.length < 2) return ''; // a single dot is a number, not a trend
  const readings = (s) => cols.map(c => (Number.isFinite(c[s.key]) ? c[s.key] : null));
  const all = series.flatMap(s => readings(s).filter(v => v !== null));
  if (all.length === 0) return '';

  const PLOT = 104;
  const DOT = 8;
  const hi = Math.max(...all, 1) * 1.15;
  const yOf = v => Math.round(((hi - v) / hi) * (PLOT - DOT));

  const spacer = h => (h > 0
    ? `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr>`
    : '');
  const dot = color => `<tr><td align="center" style="height:${DOT}px;line-height:${DOT}px;font-size:0;">`
    + `<table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">`
    + `<tr><td style="width:${DOT}px;height:${DOT}px;line-height:${DOT}px;font-size:0;background:${color};border-radius:50%;">&nbsp;</td></tr>`
    + `</table></td></tr>`;

  const column = (i) => {
    const stack = series
      .map(s => ({ color: s.color, v: Number.isFinite(cols[i][s.key]) ? cols[i][s.key] : null }))
      .filter(d => d.v !== null)
      .map(d => ({ ...d, y: yOf(d.v) }))
      .sort((a, b) => a.y - b.y);
    let cursor = 0;
    let rows = '';
    for (const d of stack) {
      const top = Math.max(cursor, Math.min(d.y, PLOT - DOT));
      rows += spacer(top - cursor) + dot(d.color);
      cursor = top + DOT;
    }
    return `<td valign="top" height="${PLOT}" style="padding:0 2px;height:${PLOT}px;">`
      + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;">${rows}</table>`
      + `</td>`;
  };

  const last = cols.length - 1;
  // A leading label column — a swatch and the series name beside its own row of
  // numbers. Two rows of bare figures under a two-series plot are unreadable
  // without it, and colouring the digits instead would make the NUMBERS carry
  // identity, which fails for anyone reading in plain text or forced colours.
  // Widths are declared once, on the plot row, because table-layout:fixed takes
  // every column's width from the first row it sees.
  const LABEL_W = 74;
  const labelCell = (html, extra = '') => `<td valign="bottom" width="${LABEL_W}" style="width:${LABEL_W}px;padding:0 6px 0 0;font-size:11px;color:#6b7280;white-space:nowrap;${extra}">${html}</td>`;
  const swatch = color => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};">&nbsp;</span>`;

  const valueRows = series.map(s => {
    const vals = readings(s);
    return `<tr>`
      + labelCell(`${swatch(s.color)} ${escapeHtml(s.label)}`, 'padding-top:3px;')
      + vals.map((v, i) =>
        `<td align="center" style="padding-top:3px;font-size:11px;font-weight:${i === last ? 700 : 600};color:${v === null ? '#d1d5db' : i === last ? '#111827' : '#6b7280'};">`
        + `${v === null ? '—' : fmtNum(v)}</td>`
      ).join('')
      + `</tr>`;
  }).join('');
  // Every column gets a value, but not every column gets a DATE: at phone width
  // a dozen of them run into each other and the axis becomes a smear. The
  // stride is anchored on the last column, so the most recent date is always
  // labelled and the rest step back from it evenly.
  const stride = Math.max(1, Math.ceil(cols.length / 6));
  const labelRow = `<tr>`
    + labelCell('&nbsp;')
    + cols.map((c, i) => {
      const show = i % stride === last % stride;
      // The newest date is right-aligned: centred in the last column it hangs
      // off the edge of a phone-width mail and loses its last character.
      return `<td align="${i === last ? 'right' : 'center'}" style="padding-top:3px;font-size:10px;color:${i === last ? '#111827' : '#9ca3af'};white-space:nowrap;">${show ? escapeHtml(c.label) : '&nbsp;'}</td>`;
    }).join('')
    + `</tr>`;

  // A legend on top of the row labels, because the PLOT is read before the
  // numbers under it and up there colour is the only thing telling the two
  // series apart.
  const legend = `<div style="margin:0 0 6px 0;font-size:11px;color:#6b7280;">`
    + series.map(s => `<span style="white-space:nowrap;margin-right:12px;">${swatch(s.color)} ${escapeHtml(s.label)}</span>`).join('')
    + (legendNote ? `<span style="color:#9ca3af;">${legendNote}</span>` : '')
    + `</div>`;

  return `<div style="margin:10px 0 4px 0;font-size:12px;color:#6b7280;">${caption}</div>`
    + legend
    + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;table-layout:fixed;">`
    + `<tr>${labelCell('&nbsp;')}${cols.map((c, i) => column(i)).join('')}</tr>`
    + valueRows + labelRow
    + `</table>`
    + `<div style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;margin:2px 0 8px 0;">&nbsp;</div>`;
}

/**
 * The owner-only "Users" section: how the user base has grown, with the active
 * slice of it on the same axis.
 *
 * Both series are counts of the same thing, which is what makes one axis
 * honest — "12 users, 5 of them active this week" is a share you can read off
 * the gap between the dots, and it would be a lie on two scales.
 */
export function renderAdminGrowth(growth) {
  const points = Array.isArray(growth) ? growth : [];
  if (points.length === 0) return '';
  const h = growthHeadline(points);
  const chart = multiSeriesDotChart(points, [
    { key: 'total', label: 'Total users', color: SERIES_COLORS.total },
    { key: 'active', label: `Active (${ACTIVE_WINDOW_DAYS}d)`, color: SERIES_COLORS.active },
  ], {
    caption: `Users over time <span style="color:#9ca3af;">— one point per snapshot; `
      + `active = signed in on web or app in the ${ACTIVE_WINDOW_DAYS} days before that snapshot</span>`,
  });
  const rows = [];
  if (h.total != null) {
    rows.push(row('Total users', `${fmtNum(h.total)}${h.totalChange != null ? ` <span style="color:#9ca3af;">(${signed(h.totalChange) || 'no change'} since ${escapeHtml(shortDate(h.from))})</span>` : ''}`));
  }
  if (h.active != null) {
    rows.push(row(`Active (${ACTIVE_WINDOW_DAYS}d)`, `${fmtNum(h.active)}${h.activeChange != null ? ` <span style="color:#9ca3af;">(${signed(h.activeChange) || 'no change'} since ${escapeHtml(shortDate(h.from))})</span>` : ''}`));
  }
  return chart + table(rows);
}

/** Plain-text twin of the growth section. */
function adminGrowthText(growth) {
  const points = Array.isArray(growth) ? growth : [];
  if (points.length === 0) return [];
  const out = ['USERS'];
  const h = growthHeadline(points);
  if (h.total != null) out.push(`  Total users: ${fmtNum(h.total)}${h.totalChange != null ? ` (${signed(h.totalChange) || 'no change'} since ${shortDate(h.from)})` : ''}`);
  if (h.active != null) out.push(`  Active (${ACTIVE_WINDOW_DAYS}d): ${fmtNum(h.active)}${h.activeChange != null ? ` (${signed(h.activeChange) || 'no change'} since ${shortDate(h.from)})` : ''}`);
  if (points.length >= 2) {
    const width = Math.max(...points.map(p => p.label.length));
    out.push('');
    out.push(`  Total / active (${ACTIVE_WINDOW_DAYS}d), one row per snapshot:`);
    for (const p of points) {
      out.push(`    ${p.label.padEnd(width)}  ${p.total == null ? '—' : fmtNum(p.total)} total · ${p.active == null ? '—' : fmtNum(p.active)} active`);
    }
  }
  return out;
}

/**
 * The value split at the point it is allowed to wrap: "5.9 / 35" holds
 * together, "servings" can drop to the next line. Squeezed into a phone-width
 * mail client the cell has to break somewhere, and breaking between the actual
 * and the target would leave a number stranded on its own line.
 */
function goalValueParts(g) {
  const unit = g.unit === '%' ? '%' : '';
  // The unit follows the TARGET's plurality — "1 / 1 day", "2 / 3 days".
  const suffix = g.unit === '%' ? '' : (g.target === 1 ? g.unit.replace(/s$/, '') : g.unit);
  return {
    core: `${fmtNum(g.actual, Number.isInteger(g.actual) ? 0 : 1)}${unit}`
      + ` / ${fmtNum(g.target, Number.isInteger(g.target) ? 0 : 1)}${unit}`,
    suffix,
  };
}

function fmtGoalValue(g) {
  const { core, suffix } = goalValueParts(g);
  return `${core}${suffix}`;
}

function goalShortfall(g) {
  const gap = round(g.target - g.actual, 1);
  if (!(gap > 0)) return '';
  return g.unit === '%' ? `${fmtNum(gap)}% to go` : `${fmtNum(gap, Number.isInteger(gap) ? 0 : 1)} to go`;
}

/**
 * The "Week goals" table — one row per configured goal, mirroring the tiles in
 * the Week Plan sidebar.
 *
 * A table rather than the four stat tiles above it because goals are a list
 * that grows with whatever you've configured, and each one carries the same
 * four facts (what, how far, how much, met or not). Tiles would either
 * truncate that or wrap into an unreadable grid at six-plus goals.
 */
/**
 * The rolling met-rate cell: how often this goal has been hit over the trailing
 * weeks. Colour-banded rather than plain text so a row that has been missed all
 * quarter is visible without reading the number — the single-week Result column
 * next to it can't tell you that.
 */
function goalTrendCell(g) {
  const t = g.trend;
  if (!t) return `<span style="color:#9ca3af;">—</span>`;
  const color = t.pct >= 80 ? '#16a34a' : t.pct >= 50 ? '#d97706' : '#dc2626';
  // The count sits UNDER the percentage rather than beside it. Side by side it
  // is the widest cell in the row, and this table already only just fits a
  // phone-width mail client at five columns.
  return `<span style="color:${color};font-weight:700;">${t.pct}%</span>`
    + `<br><span style="color:#9ca3af;font-size:11px;">${t.met}/${t.weeks}</span>`;
}

function renderGoalsTable(weekGoals) {
  const rows = weekGoals.rows.map(g => {
    const pct = goalPctOf(g);
    // Tighter side padding than the other tables in the email: five columns of
    // 10px gutters is 20px of the ~375px a phone gives you.
    const cell = 'padding:8px 7px;border-bottom:1px solid #eef2f6;font-size:13px;vertical-align:middle;';
    const short = goalShortfall(g);
    return `<tr>`
      + `<td style="${cell}white-space:nowrap;color:#111827;font-weight:600;">`
      + `<span style="font-size:15px;">${g.icon}</span>&nbsp;${escapeHtml(g.label)}</td>`
      + `<td style="${cell}width:26%;">${goalBar(pct, g.met)}</td>`
      + `<td style="${cell}text-align:right;color:#111827;font-variant-numeric:tabular-nums;">`
      + `<span style="white-space:nowrap;">${escapeHtml(goalValueParts(g).core)}</span>`
      + `${escapeHtml(goalValueParts(g).suffix)}</td>`
      // "29.1 to go" is allowed to wrap; the value beside it is not. When the
      // table is squeezed something has to give, and a shortfall over two lines
      // costs less than a broken "5.9 / 35 servings".
      + `<td style="${cell}text-align:right;">`
      + (g.met
        ? `<span style="color:#16a34a;font-weight:700;white-space:nowrap;">✓ met</span>`
        : `<span style="color:#6b7280;">${escapeHtml(short)}</span>`)
      + `</td>`
      + `<td style="${cell}white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums;">${goalTrendCell(g)}</td>`
      + `</tr>`;
  }).join('');

  const head = (label, align = 'left') =>
    `<th style="padding:6px 7px;border-bottom:2px solid #e5e7eb;text-align:${align};font-size:11px;`
    + `font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;background:#f9fafb;">${escapeHtml(label)}</th>`;

  const allMet = weekGoals.met === weekGoals.total;
  const span = weekGoals.trendSpan || TREND_WEEKS;
  const logged = weekGoals.trendWeeks || 0;
  return `<p style="font-size:13px;margin:0 0 8px 0;color:#374151;">`
    + `<strong style="color:${allMet ? '#16a34a' : '#111827'};">${weekGoals.met} of ${weekGoals.total}</strong> goals met`
    + (allMet ? ' — a clean sweep.' : '.')
    + `</p>`
    + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">`
    + `<thead><tr>${head('Goal')}${head('Progress')}${head('Result', 'right')}${head('', 'right')}`
    + `${head(`${span} wks`, 'right')}</tr></thead>`
    + `<tbody>${rows}</tbody></table>`
    // Says what the last column counts. Without it "70%" sitting beside a
    // "57% / 50%" row invites reading it as another share of a target.
    + `<p style="font-size:11px;margin:6px 0 0 0;color:#9ca3af;">`
    + `Last column: weeks this goal was met out of the ${logged === 1 ? 'single logged week' : `${logged} logged weeks`}`
    + ` in the past ${span}.</p>`;
}

/**
 * The stretch goal board — one row per body region, in head-to-toe order,
 * mirroring the card at the top of the Workout page's Stretching tab.
 *
 * Always all seven regions including the ones at zero: the whole point of the
 * board is spotting what you've neglected, and a region that drops off the
 * table for having no time in it hides exactly the row worth seeing.
 */
function renderStretchTable(st) {
  const rows = st.rows.map(r => {
    const cell = 'padding:8px 10px;border-bottom:1px solid #eef2f6;font-size:13px;vertical-align:middle;';
    return `<tr>`
      + `<td style="${cell}white-space:nowrap;color:#111827;font-weight:600;">${escapeHtml(r.group)}</td>`
      + `<td style="${cell}width:45%;">${goalBar(r.pct * 100, r.met)}</td>`
      + `<td style="${cell}white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums;`
      + `color:${r.met ? '#16a34a' : r.seconds > 0 ? '#111827' : '#9ca3af'};${r.met ? 'font-weight:700;' : ''}">`
      + `${r.met ? '✓ ' : ''}${escapeHtml(formatStretchDuration(r.seconds))}</td>`
      + `</tr>`;
  }).join('');

  const head = (label, align = 'left') =>
    `<th style="padding:6px 10px;border-bottom:2px solid #e5e7eb;text-align:${align};font-size:11px;`
    + `font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;background:#f9fafb;">${escapeHtml(label)}</th>`;

  const allMet = st.met === st.regions;
  return `<p style="font-size:13px;margin:0 0 8px 0;color:#374151;">`
    + `<strong style="color:${allMet ? '#16a34a' : '#111827'};">${st.met} of ${st.regions}</strong> regions reached the goal`
    + (allMet ? ' — whole body covered.' : '.')
    + ` <span style="color:#6b7280;">${st.goalMin} min / muscle group</span>`
    + `</p>`
    + `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">`
    + `<thead><tr>${head('Muscle group')}${head('Progress')}${head('Time held', 'right')}</tr></thead>`
    + `<tbody>${rows}</tbody></table>`;
}

function stretchTableText(st) {
  const out = [`STRETCHING — ${st.met} of ${st.regions} regions reached the goal (${st.goalMin} min / muscle group)`];
  const width = Math.max(...st.rows.map(r => r.group.length));
  for (const r of st.rows) {
    const bars = Math.round(r.pct * 10);
    out.push(`  ${r.group.padEnd(width)}  ${'█'.repeat(bars)}${'░'.repeat(10 - bars)}  `
      + `${r.met ? '✓ ' : ''}${formatStretchDuration(r.seconds)}`);
  }
  return out;
}

function goalsTableText(weekGoals) {
  const span = weekGoals.trendSpan || TREND_WEEKS;
  const out = [`WEEK GOALS — ${weekGoals.met} of ${weekGoals.total} met`];
  const width = Math.max(...weekGoals.rows.map(g => g.label.length));
  // Value and result are padded now that a column follows them; ragged edges
  // are only invisible when the thing you are reading is the last on the line.
  const valueWidth = Math.max(...weekGoals.rows.map(g => fmtGoalValue(g).length));
  const resultWidth = Math.max(...weekGoals.rows.map(g => (g.met ? '✓ met' : goalShortfall(g)).length));
  for (const g of weekGoals.rows) {
    const bars = Math.round(goalPctOf(g) / 10);
    const result = g.met ? '✓ met' : goalShortfall(g);
    const trend = g.trend ? `${g.trend.pct}% (${g.trend.met}/${g.trend.weeks})` : '—';
    out.push(`  ${g.label.padEnd(width)}  ${'█'.repeat(bars)}${'░'.repeat(10 - bars)}  `
      + `${fmtGoalValue(g).padEnd(valueWidth)}  ${result.padEnd(resultWidth)}  ${span}wk ${trend}`);
  }
  out.push(`  (${span}wk = weeks met out of the ${weekGoals.trendWeeks || 0} logged in the past ${span}.)`);
  return out;
}

/**
 * Build the weekly progress email.
 *
 * @param {object} opts
 * @param {object} opts.stats       summarizeWeek() for the reported week
 * @param {object} opts.priorStats  summarizeWeek() for the week before
 * @param {object} [opts.goals]     nutritionGoals (daily targets)
 * @param {object} [opts.bodyStats] for goalWeight
 * @param {string} [opts.name]      display name for the greeting
 */
/**
 * `adminGrowth` is the owner-only extra: the user-growth series from
 * summarizeUserGrowth. It arrives already gated by the caller (only the owner's
 * send loads it) so nothing here has to know whose mailbox this is — passing
 * null simply leaves the section out, which is what every other user gets.
 */
export function renderWeeklySummary({ stats, priorStats, goals = null, bodyStats = null, name = '', adminGrowth = null }) {
  const s = stats;
  const p = priorStats;
  const g = goals || {};
  const goalWeight = Number(bodyStats?.goalWeight);

  const subject = `Prep Day — your week: ${s.week.label}`;
  const greeting = name ? `Here's how ${escapeHtml(name.split(' ')[0])}'s week went.` : `Here's how your week went.`;

  // The nutrition stats table (days with meals / meals logged / avg per day /
  // veg & fruit / ate out) was removed at the user's request. The section keeps
  // its protein and eating-out charts.

  // ── weight ──
  const weightRows = [];
  if (s.weight.count > 0) {
    weightRows.push(row('Latest', `${fmtNum(s.weight.last, 1)} lbs <span style="color:#9ca3af;">(${escapeHtml(prettyDate(s.weight.lastDate))})</span>`));
    if (s.weight.change != null) {
      weightRows.push(row('Within the week', `${signed(s.weight.change, 1, ' lbs') || 'no change'} (${fmtNum(s.weight.first, 1)} → ${fmtNum(s.weight.last, 1)})`));
    }
    if (p.weight.last != null) {
      weightRows.push(row('Vs prior week', signed(s.weight.last - p.weight.last, 1, ' lbs') || 'no change'));
    }
    if (Number.isFinite(goalWeight) && goalWeight > 0) {
      const togo = s.weight.last - goalWeight;
      weightRows.push(row('Goal', `${fmtNum(goalWeight, 1)} lbs — ${Math.abs(round(togo, 1))} lbs ${togo > 0 ? 'to lose' : 'to gain'}`));
    }
  } else {
    weightRows.push(row('Weigh-ins', 'none logged this week'));
  }

  // The workout TOTALS block (sessions / sets / volume / top volume) was
  // removed deliberately: the numbers were a scoreboard nobody acted on. What
  // survives is "Lifts to watch" below, which is the part that asks for a
  // decision. summarizeWorkouts still runs — the week goals and isEmptyWeek
  // read it.

  // ── lifts to watch ──
  // Its own section, not a row inside Workouts: this is the one part of the
  // mail that asks you to DO something, and burying it under the volume totals
  // is how it gets skimmed past.
  const prog = s.progress;
  // Rendered as the website's Progress cards rather than lines of text: a
  // percentage tells you a lift is down, the shape tells you whether it fell
  // off a cliff or has been sliding for a month, and that is the difference
  // between reading this section and acting on it.
  let attentionHtml = '';
  if (prog && prog.analysed) {
    if (prog.decreasing.length > 0) attentionHtml += renderProgressCard('decreasing', prog.decreasing, signedPct);
    if (prog.stagnating.length > 0) attentionHtml += renderProgressCard('stagnating', prog.stagnating, signedPct);
    if (!attentionHtml) {
      attentionHtml = table([row('Trends', 'Nothing decreasing or stagnating — everything with a baseline is holding or climbing.')]);
    }
  }

  // ── stretching ──
  // Shown when there's stretch time in EITHER week, not just this one: for
  // someone who stretches every week, the week they didn't is the one the
  // table most needs to say out loud. Someone who has never tagged a stretch
  // gets no section rather than seven permanent zeros.
  const showStretch = s.stretch && (s.stretch.totalSeconds > 0 || (p.stretch?.totalSeconds || 0) > 0);

  // ── habits ──
  const habitRows = [];
  if (s.habits.due > 0) {
    habitRows.push(row('Completion', `${s.habits.rate}%${deltaText(s.habits.rate, p.habits.rate, { suffix: '%' })}`));
    habitRows.push(row(
      'Marks',
      `<span style="color:#d4a017;">★ ${s.habits.exceeded} above &amp; beyond</span>`
      + ` · <span style="color:#16a34a;">✓ ${s.habits.done} did it</span>`
      + ` · <span style="color:#64748b;">⏭ ${s.habits.skipped} skip</span>`
      + ` · <span style="color:#dc2626;">✕ ${s.habits.missed} no</span>`
      + (s.habits.unlogged > 0 ? ` · <span style="color:#9ca3af;">${s.habits.unlogged} never logged</span>` : ''),
    ));
    if (s.habits.perfect.length > 0) {
      habitRows.push(row(`Perfect week (${s.habits.perfect.length})`, escapeHtml(s.habits.perfect.slice(0, 8).join(', ')) + (s.habits.perfect.length > 8 ? ', …' : '')));
    }
    if (s.habits.struggling.length > 0) {
      habitRows.push(row('Needs attention', s.habits.struggling.map(h => `${escapeHtml(h.name)} <span style="color:#9ca3af;">${h.hit}/${h.due}</span>`).join('<br/>')));
    }
  } else {
    habitRows.push(row('Habits', 'nothing was due this week'));
  }

  // The per-meal line splits the daily goal evenly over the three main meals.
  const pGoal = Number(g.protein) > 0 ? Number(g.protein) : 0;
  const pMealGoal = pGoal / MAIN_MEALS.length;
  // Fibre gets the same treatment: the daily target is a day of meals, so a
  // meal's share of it is a third.
  const fGoal = Number(g.fiber) > 0 ? Number(g.fiber) : 0;
  const fMealGoal = fGoal / MAIN_MEALS.length;

  const adminGrowthHtml = renderAdminGrowth(adminGrowth);

  const html =`<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;max-width:720px;">`
    + `<h1 style="font-size:20px;font-weight:700;margin:0 0 2px 0;">Your Prep Day week</h1>`
    + `<p style="font-size:13px;color:#6b7280;margin:0 0 14px 0;">${escapeHtml(s.week.label)} — ${greeting}</p>`
    + (s.weekGoals && s.weekGoals.total > 0
      ? sectionHeading('Week goals') + renderGoalsTable(s.weekGoals)
      : '')
    + sectionHeading('Meals & nutrition')
    + proteinChart(s.meals.proteinByDay, pGoal, {
      caption: pGoal > 0
        ? `Protein per day · g <span style="color:#9ca3af;">— dashed line is your ${Math.round(pGoal)}g daily goal</span>`
        : `Protein per day · g`,
    })
    + proteinChart(s.meals.proteinByDay, pMealGoal, {
      key: 'perMeal',
      caption: pGoal > 0
        ? `Avg protein per meal · g <span style="color:#9ca3af;">— breakfast, lunch &amp; dinner; dashed line is ${Math.round(pMealGoal)}g (your daily goal ÷ 3)</span>`
        : `Avg protein per meal · g <span style="color:#9ca3af;">— breakfast, lunch &amp; dinner</span>`,
    })
    + proteinHitRateChart(s.meals.qualityHistory, pMealGoal)
    + fiberPerMealChart(s.meals.qualityHistory, fMealGoal)
    + ateOutChart(s.meals.ateOutHistory)
    + sectionHeading('Weight')
    + weightChart(s.weight.history, goalWeight)
    + table(weightRows)
    + (attentionHtml
      ? sectionHeading(`Lifts to watch — trend over the last ${prog.windowDays} days`) + attentionHtml
      : '')
    + (showStretch
      ? sectionHeading('Stretching') + renderStretchTable(s.stretch)
      : '')
    + sectionHeading('Habits') + table(habitRows)
    + (adminGrowthHtml ? sectionHeading('Users') + adminGrowthHtml : '')
    + `<p style="margin:24px 0 0 0;"><a href="${APP_URL}" style="background:${ACCENT};color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;display:inline-block;">Open Prep Day</a></p>`
    + `<p style="color:#9ca3af;font-size:12px;margin-top:24px;">Sent weekly from Prep Day. Turn this off in Account Settings → Email Reminders.</p>`
    + `</div>`;

  // ── plain-text twin ──
  const t = [];
  t.push(`Your Prep Day week — ${s.week.label}`);
  t.push('');
  if (s.weekGoals && s.weekGoals.total > 0) {
    t.push(...goalsTableText(s.weekGoals));
    t.push('');
  }
  t.push('MEALS & NUTRITION');
  // The two charts, as bars a monospace client can draw. Same numbers as the
  // HTML — a plain-text reader shouldn't be told less, just told it plainly.
  const proteinDays = (s.meals.proteinByDay || []).filter(d => d.protein != null);
  if (proteinDays.length > 0) {
    const textBars = (key, goal) => {
      const readings = (s.meals.proteinByDay || []).filter(d => d[key] != null);
      const max = Math.max(...readings.map(d => d[key]), goal, 0);
      for (const d of s.meals.proteinByDay || []) {
        if (d[key] == null) {
          t.push(`    ${d.dow}  ${'·'.repeat(12)}  no data`);
          continue;
        }
        const bars = max > 0 ? Math.round((d[key] / max) * 12) : 0;
        t.push(`    ${d.dow}  ${'█'.repeat(bars)}${'░'.repeat(12 - bars)}  ${d[key]}`
          + (goal > 0 && d[key] >= goal ? '  ✓' : ''));
      }
    };
    t.push('');
    t.push(`  Protein per day (g)${pGoal > 0 ? ` — goal ${Math.round(pGoal)}` : ''}:`);
    textBars('protein', pGoal);
    if (proteinDays.some(d => d.perMeal != null)) {
      t.push('');
      t.push(`  Avg protein per meal (g, breakfast/lunch/dinner)${pGoal > 0 ? ` — goal ${Math.round(pMealGoal)}` : ''}:`);
      textBars('perMeal', pMealGoal);
    }
  }
  // The two per-meal trends, as rows down the page. Same readings as the dot
  // plots above; a week that measured nothing prints "—" rather than a zero.
  const qWeeks = s.meals.qualityHistory || [];
  if (qWeeks.length > 0) {
    const qLabelWidth = Math.max(...qWeeks.map(w => (w.range || w.label).length));
    const trendRows = (caption, read, fmt) => {
      const readings = qWeeks.map(read);
      if (readings.every(v => v == null)) return;
      const rMax = Math.max(...readings.filter(v => v != null), 1);
      t.push('');
      t.push(`  ${caption}:`);
      qWeeks.forEach((w, i) => {
        const v = readings[i];
        const span = (w.range || w.label).padEnd(qLabelWidth);
        if (v == null) {
          t.push(`    ${span}  ${'·'.repeat(12)}  —`);
          return;
        }
        const bars = Math.round((v / rMax) * 12);
        t.push(`    ${span}  ${'█'.repeat(bars)}${'░'.repeat(12 - bars)}  ${fmt(v)}`);
      });
    };
    if (pMealGoal > 0) {
      trendRows(
        `Meals hitting the ${Math.round(pMealGoal)}g protein goal, last ${qWeeks.length} weeks (%)`,
        w => (w.meals > 0
          ? Math.round((w.proteins.filter(p => p >= pMealGoal).length / w.meals) * 100)
          : null),
        v => `${v}%`,
      );
    }
    trendRows(
      `Avg fibre per meal, last ${qWeeks.length} weeks (g)`
        + `${fMealGoal > 0 ? ` — goal ${Math.round(fMealGoal)}` : ''}`,
      w => w.fiberAvg,
      v => `${fmtNum(v, 1)}${fMealGoal > 0 && v >= fMealGoal ? '  ✓' : ''}`,
    );
  }
  const ateOutWeeks = s.meals.ateOutHistory || [];
  if (ateOutWeeks.length > 0) {
    const aMax = Math.max(...ateOutWeeks.map(w => w.ateOut), 1);
    // The full date span here, not the chart's start-only label: a text row has
    // the width for it.
    const spanOf = w => w.range || w.label;
    const labelWidth = Math.max(...ateOutWeeks.map(w => spanOf(w).length));
    t.push('');
    t.push(`  Meals eaten out, last ${ateOutWeeks.length} weeks:`);
    for (const w of ateOutWeeks) {
      const bars = Math.round((w.ateOut / aMax) * 12);
      t.push(`    ${spanOf(w).padEnd(labelWidth)}  ${'█'.repeat(bars)}${'░'.repeat(12 - bars)}  ${w.ateOut}`);
    }
  }
  t.push('');
  t.push('WEIGHT');
  if (s.weight.count > 0) {
    t.push(`  Latest: ${fmtNum(s.weight.last, 1)} lbs (${prettyDate(s.weight.lastDate)})`);
    if (s.weight.change != null) t.push(`  Within the week: ${signed(s.weight.change, 1, ' lbs') || 'no change'}`);
    if (p.weight.last != null) t.push(`  Vs prior week: ${signed(s.weight.last - p.weight.last, 1, ' lbs') || 'no change'}`);
    if (Number.isFinite(goalWeight) && goalWeight > 0) {
      const togo = s.weight.last - goalWeight;
      t.push(`  Goal: ${fmtNum(goalWeight, 1)} lbs — ${Math.abs(round(togo, 1))} lbs ${togo > 0 ? 'to lose' : 'to gain'}`);
    }
  } else {
    t.push('  No weigh-ins logged this week.');
  }
  const weightWeeks = s.weight.history || [];
  if (weightWeeks.some(w => w.weight != null)) {
    t.push('');
    t.push(`  Last weigh-in each week, last ${weightWeeks.length} weeks (lbs):`);
    const labelWidth = Math.max(...weightWeeks.map(w => w.label.length));
    for (const w of weightWeeks) {
      t.push(`    ${w.label.padEnd(labelWidth)}  ${w.weight == null ? '—' : fmtNum(w.weight, 1)}`);
    }
  }
  t.push('');
  if (prog && prog.analysed) {
    t.push(`LIFTS TO WATCH (trend over the last ${prog.windowDays} days)`);
    const tline = (r) => {
      const grp = r.group ? ` (${r.group})` : '';
      const pct = r.deltaPct == null ? '' : ` ${signedPct(r.deltaPct)} est. 1RM`;
      const vol = r.annotations.includes('volume-down') ? ' · volume down' : '';
      return `  - ${r.name}${grp}${pct}${vol} · ${r.sessions} session${r.sessions === 1 ? '' : 's'}`;
    };
    if (prog.decreasing.length > 0) {
      t.push(`  Decreasing (${prog.decreasing.length}):`);
      for (const r of prog.decreasing) t.push(tline(r));
    }
    if (prog.stagnating.length > 0) {
      t.push(`  Stagnating (${prog.stagnating.length}):`);
      for (const r of prog.stagnating) t.push(tline(r));
    }
    if (prog.decreasing.length === 0 && prog.stagnating.length === 0) {
      t.push('  Nothing decreasing or stagnating.');
    }
    t.push('');
  }
  if (showStretch) {
    t.push(...stretchTableText(s.stretch));
    t.push('');
  }
  t.push('HABITS');
  if (s.habits.due > 0) {
    t.push(`  Completion: ${s.habits.rate}% (${s.habits.hit}/${s.habits.due - s.habits.skipped})`);
    t.push(`  ★ ${s.habits.exceeded} · ✓ ${s.habits.done} · ⏭ ${s.habits.skipped} · ✕ ${s.habits.missed}${s.habits.unlogged > 0 ? ` · ${s.habits.unlogged} never logged` : ''}`);
    if (s.habits.perfect.length > 0) t.push(`  Perfect week: ${s.habits.perfect.slice(0, 8).join(', ')}`);
    for (const h of s.habits.struggling) t.push(`  Needs attention: ${h.name} (${h.hit}/${h.due})`);
  } else {
    t.push('  Nothing was due this week.');
  }
  const adminLines = adminGrowthText(adminGrowth);
  if (adminLines.length > 0) {
    t.push('');
    t.push(...adminLines);
  }
  t.push('');
  t.push(`Open Prep Day: ${APP_URL}`);
  t.push('');
  t.push('— Prep Day');

  return { subject, text: t.join('\n'), html };
}
