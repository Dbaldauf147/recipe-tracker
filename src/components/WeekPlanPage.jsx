import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { RecipeCombobox, DailyTrackerPage, MealsTrackedChart, HistoryChart, ServingsChart, KpiAlerts, DailySupplementsPanel, saveDailyLog } from './DailyTrackerPage';
import { workoutCalendarCategory, CAL_ICON } from './WorkoutPage';
import { loadField, saveField, newWorkoutId } from '../utils/firestoreSync';
import {
  hasGoogleToken, storeTokenFromPopup, disconnectGoogle,
  openGoogleAuthPopup, fetchGoogleCalendars, fetchGoogleEvents, parseEventDate, SELECTED_KEY,
} from '../utils/googleCalendar';
import {
  SYNC_KINDS, WORKOUT_KINDS, ANY_WORKOUT, DEFAULT_CALENDAR_SYNC_SETTINGS,
  normalizeCalendarSyncSettings, anchorOptionsFor, previewOrder, minToHHMM,
  isValidGuestEmail,
} from '../utils/calendarSyncSettings';
import {
  DEFAULT_SAUNA_GOAL, MAX_SAUNA_GOAL, normalizeSaunaGoal, normalizeSaunaOverrides,
  pruneSaunaOverrides, resolveSaunaDates, spreadIndices,
} from '../utils/saunaPlan';
import { isStretchWorkout } from '../utils/stretchRoutine';
import styles from './WeekPlanPage.module.css';

const SLOTS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
];
const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Fixed legend colors for the non-Google event sources. Voting dates use one
// color here (not the per-type colors) so "Vote" is a single legend entry.
const RALLY_COLOR = '#4f46e5';
const VOTE_COLOR = '#16a34a';

// Workout categories mirror the Workout page calendar view (CAL_CATS).
const WORKOUT_CATS = [
  { key: 'weights', icon: '🏋️', label: 'Weights' },
  { key: 'cardio', icon: '🏃', label: 'Cardio' },
  { key: 'yoga', icon: '🧘', label: 'Yoga' },
  { key: 'rest', icon: '😴', label: 'Rest' },
];
const WORKOUT_CAT_META = Object.fromEntries(WORKOUT_CATS.map(c => [c.key, c]));
const DEFAULT_WORKOUT_GOALS = { weights: 3, cardio: 1, yoga: 1, rest: 2 };
// The trainable categories — everything in WORKOUT_CATS except rest. These are
// what the day suggester fills against; rest is the leftover, not a thing you do.
const WORKOUT_KIND_KEYS = ['weights', 'cardio', 'yoga'];

// Week-total produce tiles. Servings come from each logged entry's
// `nutrition.vegServings` / `fruitServings` — the same numbers the Prepare
// grid's per-day Veg/Fruit rows show.
const PRODUCE_TILES = [
  { key: 'veg', icon: '🥦', label: 'Veg', noun: 'vegetable' },
  { key: 'fruit', icon: '🍎', label: 'Fruit', noun: 'fruit' },
];

// Servings are fractional (half an avocado, ¾ cup of berries), so show a
// decimal only when there is one — "21" not "21.0", but "21.5" stays.
function fmtServings(n) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ── Week-goal metrics ──────────────────────────────────────────────────────
// ONE definition of each tile, shared by the live tiles and the history table,
// so a week from March is measured exactly the way this week is. Everything is
// derived from the workout log and daily log rather than snapshotted, which is
// why the history goes all the way back instead of starting the day it shipped.

const MAIN_MEALS = ['breakfast', 'lunch', 'dinner'];
const PRODUCE_MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Days with each workout category; rest = workout-free days up to today. */
function tallyWorkouts(days, workoutsByDate, todayKey) {
  const out = { weights: 0, cardio: 0, yoga: 0, rest: 0 };
  for (const date of days) {
    const items = workoutsByDate.get(date);
    if (items && items.length) {
      const cats = new Set(items.map(it => it.category));
      if (cats.has('weights')) out.weights += 1;
      if (cats.has('cardio')) out.cardio += 1;
      if (cats.has('yoga')) out.yoga += 1;
    } else if (date <= todayKey) {
      out.rest += 1;
    }
  }
  return out;
}

function countSaunaDays(days, saunaDates) {
  let n = 0;
  for (const d of days) if (saunaDates.has(d)) n += 1;
  return n;
}

/** Main-meal slots accounted for on ONE day, and meals eaten out that day. */
function mealStatsForDay(day) {
  const entries = Array.isArray(day?.entries) ? day.entries : [];
  const eatOutMarks = Array.isArray(day?.eatingOutMeals) ? day.eatingOutMeals : [];
  let ateOut = 0;
  // Ate out = logged eating-out entries + planned "eating out" grid marks.
  for (const e of entries) if (e?.eatingOut) ateOut += 1;
  for (const s of eatOutMarks) if (MAIN_MEALS.includes(s)) ateOut += 1;
  if (day?.daySkipped) return { tracked: MAIN_MEALS.length, ateOut };
  const skipped = Array.isArray(day?.skippedMeals) ? day.skippedMeals : [];
  const accounted = new Set();
  for (const e of entries) if (MAIN_MEALS.includes(e.mealSlot)) accounted.add(e.mealSlot);
  for (const s of skipped) if (MAIN_MEALS.includes(s)) accounted.add(s);
  // Deciding a meal is "eating out" accounts for that slot (like a skip), so it
  // doesn't count against the tracked %.
  for (const s of eatOutMarks) if (MAIN_MEALS.includes(s)) accounted.add(s);
  return { tracked: accounted.size, ateOut };
}

/** % of the period's main-meal slots tracked, plus meals eaten out. */
function mealStatsForDays(days, dailyLog) {
  let trackedSlots = 0;
  let ateOut = 0;
  for (const date of days) {
    const s = mealStatsForDay(dailyLog[date]);
    trackedSlots += s.tracked;
    ateOut += s.ateOut;
  }
  const totalSlots = days.length * MAIN_MEALS.length;
  return { pct: totalSlots > 0 ? Math.round((trackedSlots / totalSlots) * 100) : 0, ateOut };
}

/** Veg/fruit servings on ONE day. Skipped days and skipped slots contribute 0. */
function produceForDay(day) {
  if (!day || day.daySkipped) return { veg: 0, fruit: 0 };
  const entries = Array.isArray(day.entries) ? day.entries : [];
  const skipped = Array.isArray(day.skippedMeals) ? day.skippedMeals : [];
  const active = skipped.length
    ? entries.filter(e => {
        const slot = e.type === 'custom' && !e.mealSlot ? 'snack' : (PRODUCE_MEAL_SLOTS.includes(e.mealSlot) ? e.mealSlot : 'snack');
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

function produceForDays(days, dailyLog) {
  let veg = 0;
  let fruit = 0;
  for (const date of days) {
    const p = produceForDay(dailyLog[date]);
    veg += p.veg;
    fruit += p.fruit;
  }
  // Round the total, not each day — matches what the tiles have always shown.
  return { veg: Math.round(veg * 10) / 10, fruit: Math.round(fruit * 10) / 10 };
}

// How many weeks of history to show before the "Show more" button, and how many
// each press adds. The whole log is already in memory, so this is about keeping
// the table readable, not about loading.
const HISTORY_WEEKS_PAGE = 12;

/**
 * Week-by-week history of the goal tiles, newest first, expandable to days.
 *
 * Every row is computed from the same helpers the live tiles use, so this is a
 * record of what actually happened rather than a log written as you go — it
 * covers every week you have data for, including ones from before this existed,
 * and it re-reads if you go back and fill a day in.
 */
function GoalsHistory({
  weekStart, workoutsByDate, saunaDates, dailyLog, todayKey,
  workoutGoals, saunaGoal, mealsTrackedGoal, produceGoalsPerDay,
}) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(HISTORY_WEEKS_PAGE);
  const [openWeek, setOpenWeek] = useState(null);

  // The earliest day with anything in it — no point rendering empty weeks back
  // to 1970 because a stray date exists.
  const earliest = useMemo(() => {
    let min = null;
    for (const date of dailyLog ? Object.keys(dailyLog) : []) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && (!min || date < min)) min = date;
    }
    for (const date of workoutsByDate.keys()) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && (!min || date < min)) min = date;
    }
    return min;
  }, [dailyLog, workoutsByDate]);

  // Week starts from the currently-viewed week backwards to `earliest`.
  const weeks = useMemo(() => {
    if (!earliest) return [];
    const out = [];
    let cursor = weekStart;
    for (let i = 0; i < 520; i++) { // ~10 years, a backstop not a limit
      const days = Array.from({ length: 7 }, (_, d) => isoDate(addDays(cursor, d)));
      out.push({ start: new Date(cursor), days });
      if (days[0] <= earliest) break;
      cursor = addDays(cursor, -7);
    }
    return out;
  }, [weekStart, earliest]);

  const rows = useMemo(() => weeks.slice(0, limit).map(w => {
    const tally = tallyWorkouts(w.days, workoutsByDate, todayKey);
    const meals = mealStatsForDays(w.days, dailyLog);
    const produce = produceForDays(w.days, dailyLog);
    return {
      ...w,
      tally,
      saunas: countSaunaDays(w.days, saunaDates),
      meals,
      produce,
      produceGoals: {
        veg: produceGoalsPerDay.veg * w.days.length,
        fruit: produceGoalsPerDay.fruit * w.days.length,
      },
    };
  }), [weeks, limit, workoutsByDate, saunaDates, dailyLog, todayKey, produceGoalsPerDay]);

  if (!earliest) return null;

  const label = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const cell = (got, goal, fmt = String) => {
    const met = goal > 0 && got >= goal;
    return (
      <span className={met ? styles.histMet : undefined}>
        {fmt(got)}{goal > 0 ? `/${fmt(goal)}` : ''}{met ? ' ✓' : ''}
      </span>
    );
  };

  return (
    <div className={styles.goalsBlock}>
      <button
        type="button"
        className={styles.histToggle}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        📈 Goal history
        <span className={styles.histToggleHint}>
          {weeks.length} week{weeks.length === 1 ? '' : 's'}
        </span>
      </button>

      {/* Opens as a wide overlay rather than inline: the toggle belongs next to
          the tiles it reports on, but the sidebar is 240px and this is a
          ten-column table. */}
      {open && (
        <div className={styles.modalOverlay} onClick={() => setOpen(false)}>
        <div className={`${styles.modalCard} ${styles.histCard}`} onClick={e => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <h2 className={styles.modalTitle}>Goal history</h2>
            <button type="button" className={styles.histClose} onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>
          <p className={styles.histIntro}>
            Every week you have data for, worked out from your workout and meal logs —
            so it covers weeks from before this table existed, and it updates if you
            go back and fill a day in. Click a week for its days.
          </p>
          <div className={styles.histWrap}>
          <table className={styles.histTable}>
            <thead>
              <tr>
                <th className={styles.histWeekCol}>Week</th>
                {WORKOUT_CATS.map(c => <th key={c.key} title={c.label}>{c.icon}</th>)}
                <th title="Sauna">🧖</th>
                <th title="Meals tracked">🍽️</th>
                <th title="Meals eaten out">🍔</th>
                <th title="Veg servings">🥦</th>
                <th title="Fruit servings">🍎</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const key = r.days[0];
                const isOpen = openWeek === key;
                const isCurrent = key === isoDate(weekStart);
                return (
                  <Fragment key={key}>
                    <tr className={isCurrent ? styles.histCurrentRow : undefined}>
                      <th scope="row" className={styles.histWeekCol}>
                        <button
                          type="button"
                          className={styles.histWeekBtn}
                          onClick={() => setOpenWeek(isOpen ? null : key)}
                          title={isOpen ? 'Hide days' : 'Show each day'}
                        >
                          {isOpen ? '▾' : '▸'} {label(r.start)} – {label(addDays(r.start, 6))}
                        </button>
                      </th>
                      {WORKOUT_CATS.map(c => (
                        <td key={c.key}>{cell(r.tally[c.key], workoutGoals[c.key] || 0)}</td>
                      ))}
                      <td>{cell(r.saunas, saunaGoal)}</td>
                      <td>{cell(r.meals.pct, mealsTrackedGoal, n => `${n}%`)}</td>
                      <td>{r.meals.ateOut}</td>
                      <td>{cell(r.produce.veg, r.produceGoals.veg, fmtServings)}</td>
                      <td>{cell(r.produce.fruit, r.produceGoals.fruit, fmtServings)}</td>
                    </tr>
                    {isOpen && r.days.map(date => {
                      const items = workoutsByDate.get(date) || [];
                      const cats = new Set(items.map(it => it.category));
                      const dayMeals = mealStatsForDay(dailyLog[date]);
                      const dayProduce = produceForDay(dailyLog[date]);
                      const future = date > todayKey;
                      return (
                        <tr key={date} className={styles.histDayRow}>
                          <th scope="row" className={styles.histWeekCol}>
                            {new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </th>
                          {WORKOUT_CATS.map(c => (
                            <td key={c.key}>
                              {c.key === 'rest'
                                ? (items.length === 0 && !future ? '😴' : '')
                                : (cats.has(c.key) ? '✓' : '')}
                            </td>
                          ))}
                          <td>{saunaDates.has(date) ? '🧖' : ''}</td>
                          <td>{future ? '' : `${Math.round((dayMeals.tracked / MAIN_MEALS.length) * 100)}%`}</td>
                          <td>{dayMeals.ateOut || ''}</td>
                          <td>{dayProduce.veg ? fmtServings(dayProduce.veg) : ''}</td>
                          <td>{dayProduce.fruit ? fmtServings(dayProduce.fruit) : ''}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
          {weeks.length > limit && (
            <button
              type="button"
              className={styles.histMoreBtn}
              onClick={() => setLimit(n => n + HISTORY_WEEKS_PAGE)}
            >Show {Math.min(HISTORY_WEEKS_PAGE, weeks.length - limit)} more weeks</button>
          )}
        </div>
        </div>
      )}
    </div>
  );
}

function loadWorkoutGoals() {
  try {
    const r = JSON.parse(localStorage.getItem('sunday-workout-weekly-goals'));
    if (r && typeof r === 'object') return { ...DEFAULT_WORKOUT_GOALS, ...r };
  } catch { /* ignore */ }
  return DEFAULT_WORKOUT_GOALS;
}

// Goals drive the day suggestions now, so a junk value can't be waved through:
// coerce to whole days in 0..7 and fall back to the default per category.
function normalizeWorkoutGoals(goals) {
  const out = { ...DEFAULT_WORKOUT_GOALS };
  for (const k of Object.keys(out)) {
    const n = Math.round(Number(goals?.[k]));
    if (Number.isFinite(n)) out[k] = Math.min(7, Math.max(0, n));
  }
  return out;
}

// The weekly sauna goal lives on the user doc (`saunaGoal`, edited in the ⚙
// popup) — see utils/saunaPlan.js. Saunas are logged per-workout on the mobile
// app (Workout.sauna); the Week Plan counts logged days against the goal and
// suggests saunas on planned workout days to make up the difference.

// Rank workout types by how overdue they are (most overdue first). Effective
// last-activity = newer of the last logged workout of that type and a manual
// skip; never done = most overdue. Mirrors WorkoutPage's Workout Type view.
function rankWorkoutTypesByStaleness(workoutsRaw, workoutTypes, typeSkipDates) {
  const lastByType = {};
  for (const w of workoutsRaw || []) {
    if (!w?.workoutType || !w.date) continue;
    if (!lastByType[w.workoutType] || w.date > lastByType[w.workoutType]) lastByType[w.workoutType] = w.date;
  }
  const eff = {};
  for (const t of workoutTypes) {
    const wd = lastByType[t] || '';
    const sd = (typeSkipDates && typeSkipDates[t]) || '';
    eff[t] = sd > wd ? sd : wd; // '' = never done
  }
  return [...workoutTypes].sort((a, b) => {
    const ea = eff[a], eb = eff[b];
    if (!ea && !eb) return 0;
    if (!ea) return -1; // never done = most overdue → first
    if (!eb) return 1;
    return ea < eb ? -1 : ea > eb ? 1 : 0; // oldest first
  });
}

// spreadIndices (used below to scatter rest days) now lives in utils/saunaPlan.js
// alongside the sauna spread that shares it.

// Build the full Sun..Sat (0..6) plan from the weekly category goals, the
// staleness ranking, and the user's per-day overrides. Returns
// { [idx]: { value, isAuto } } where value is a workout type or 'rest'.
//
// The goals lead. Each open day goes to whichever CATEGORY is furthest from its
// weekly goal (counting what's already logged and what you've pinned), and the
// most-overdue TYPE within that category fills it. Staleness still decides
// what you do; the goals decide what kind of day it is. Before this the
// suggester ranked types globally and ignored the goals entirely, so a
// weights: 3 goal was unreachable whenever you had fewer than three
// weights-categorised types — it would hand you five distinct stale types
// spanning every category and leave the Weights tile short.
//
// Rest days come from goals.rest (was hardcoded to 2) and are spread out.
// `recordedIdxs` = day indices that already have a logged workout — these are
// active days (the recorded workout is shown there), so they're skipped when
// placing suggestions. Otherwise the most-overdue type gets assigned to a day
// you already trained (e.g. Sunday) and is hidden behind the recorded workout.
//
// opts: { goals, categoryOf, loggedCatDays, todayIdx } — the weekly goals, a
// type→category resolver (must match the one the tally uses, or the two never
// converge), days already logged per category this week, and today's Sun..Sat
// index so the days still ahead of you are the only ones being planned.
function resolveWorkoutPlan(rankedTypes, overrides, workoutTypes, recordedIdxs = new Set(), recordedTypes = new Set(), opts = {}) {
  const goals = normalizeWorkoutGoals(opts.goals);
  const categoryOf = opts.categoryOf || (() => 'weights');
  const loggedCatDays = opts.loggedCatDays || {};
  // 0 = plan the whole week (a week that hasn't started). Anything earlier than
  // this index has already happened and can't be planned into.
  const todayIdx = Number.isFinite(opts.todayIdx) ? Math.min(6, Math.max(0, Math.round(opts.todayIdx))) : 0;

  const validTypes = new Set(workoutTypes);
  const fixed = {};
  for (const [k, v] of Object.entries(overrides || {})) {
    if (v === 'rest' || validTypes.has(v)) fixed[Number(k)] = v; // ignore stale values
  }
  const out = {};
  for (let i = 0; i < 7; i++) if (fixed[i] != null) out[i] = { value: fixed[i], isAuto: false };

  // A day that's gone by with nothing logged is a rest day — that's how the grid
  // draws it, whatever was planned there. Bank those against the rest goal and
  // keep them out of the pool below: a goal day handed to a day that already
  // happened is a goal day burned, which is how "Weights 2/3" could sit next to
  // two proposed rest days with the week's last workout stranded on Sunday.
  const pastRest = [];
  for (let i = 0; i < todayIdx; i++) {
    if (recordedIdxs.has(i)) continue;
    pastRest.push(i);
    out[i] = { value: 'rest', isAuto: fixed[i] !== 'rest' };
  }
  // Only rest you pinned on a day still to come counts on top of that.
  const restInFixed = Object.entries(fixed)
    .filter(([k, v]) => v === 'rest' && Number(k) >= todayIdx && !recordedIdxs.has(Number(k)))
    .length;
  const restNeeded = Math.max(0, goals.rest - pastRest.length - restInFixed);

  // Days each category has already banked: what's logged this week, plus the
  // days you pinned yourself. Goals count DAYS, matching tallyWorkouts. Pinned
  // days that are already logged, or already past, don't count — the first is
  // in the logged tally, the second never happened.
  const have = {};
  for (const cat of WORKOUT_KIND_KEYS) have[cat] = Math.max(0, Math.round(Number(loggedCatDays[cat]) || 0));
  for (const [k, v] of Object.entries(fixed)) {
    const i = Number(k);
    if (v === 'rest' || recordedIdxs.has(i) || i < todayIdx) continue;
    const cat = categoryOf(v);
    if (have[cat] != null) have[cat] += 1;
  }
  const need = {};
  for (const cat of WORKOUT_KIND_KEYS) need[cat] = Math.max(0, goals[cat] - have[cat]);

  const autoSlots = [];
  for (let i = todayIdx; i < 7; i++) if (fixed[i] == null && !recordedIdxs.has(i)) autoSlots.push(i);

  const restPos = spreadIndices(autoSlots.length, restNeeded);

  // Types grouped by category, stalest first, so a category that needs more days
  // than it has distinct types can cycle through them instead of running dry.
  const byCat = {};
  for (const cat of WORKOUT_KIND_KEYS) byCat[cat] = [];
  const rankIndex = new Map();
  rankedTypes.forEach((t, i) => {
    rankIndex.set(t, i);
    const cat = categoryOf(t);
    if (byCat[cat]) byCat[cat].push(t);
  });

  // Spent this week: pinned by you or already logged. Not fresh, but still
  // repeatable when a goal asks for more days than the category has types.
  const usedTypes = new Set([
    ...Object.values(fixed).filter(v => v !== 'rest'),
    ...recordedTypes,
  ]);
  const placedAt = {}; // type -> the position it was last placed at this week

  // The type this category would contribute next, without consuming it.
  function candidateFor(cat) {
    const pool = byCat[cat] || [];
    if (!pool.length) return null;
    const fresh = pool.find(t => !usedTypes.has(t));
    if (fresh) return fresh;
    // Every type here is spoken for — the goal wants more days than there are
    // distinct types, so cycle back to whichever came up longest ago. Pool is
    // stalest-first, so ties fall to the most overdue.
    let best = null, bestPos = Infinity;
    for (const t of pool) {
      const p = placedAt[t] ?? -1;
      if (p < bestPos) { best = t; bestPos = p; }
    }
    return best;
  }

  // Which category this day should serve: the one furthest from its goal, ties
  // broken by whose next type is the most overdue. `prevCat` is yesterday's
  // category — avoid stacking two of the same back to back unless this category
  // has to take every remaining day to make its number.
  function pickCategory(prevCat, left) {
    const cats = WORKOUT_KIND_KEYS.filter(c => need[c] > 0 && candidateFor(c));
    if (!cats.length) return null;
    const spread = cats.filter(c => c !== prevCat || need[c] >= left);
    const pool = spread.length ? spread : cats;
    let best = pool[0];
    for (const c of pool) {
      if (need[c] > need[best]) best = c;
      else if (need[c] === need[best]) {
        const a = rankIndex.get(candidateFor(c)) ?? Infinity;
        const b = rankIndex.get(candidateFor(best)) ?? Infinity;
        if (a < b) best = c;
      }
    }
    return best;
  }

  // Open days that aren't rest, in week order — what the goals get to fill.
  const workoutPositions = autoSlots.map((_, pos) => pos).filter(pos => !restPos.has(pos));
  for (const pos of restPos) out[autoSlots[pos]] = { value: 'rest', isAuto: true };

  workoutPositions.forEach((pos, i) => {
    const slot = autoSlots[pos];
    const left = workoutPositions.length - i;
    // Yesterday's category, whether it was pinned or auto-filled. A recorded day
    // isn't in `out`, so it simply imposes no constraint.
    const prev = out[slot - 1];
    const prevCat = prev && prev.value !== 'rest' ? categoryOf(prev.value) : null;

    const cat = pickCategory(prevCat, left);
    let type = cat ? candidateFor(cat) : null;
    if (type != null) {
      need[cat] -= 1;
    } else {
      // Goals are all met and the week still has room: fall back to the original
      // behaviour — the most overdue type that hasn't come up yet, else rest.
      type = rankedTypes.find(t => !usedTypes.has(t)) || null;
    }
    if (type == null) {
      out[slot] = { value: 'rest', isAuto: true };
      return;
    }
    usedTypes.add(type);
    placedAt[type] = pos;
    out[slot] = { value: type, isAuto: true };
  });
  return out;
}

// Local YYYY-MM-DD (never toISOString — that shifts by timezone and would
// mis-bucket days/workouts near midnight). Matches how workout docs store dates.
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, n) {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

// Every calendar day from start..end inclusive (for multi-day all-day events).
function eachDay(start, end) {
  const out = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let guard = 0;
  while (cur <= last && guard < 400) { out.push(new Date(cur)); cur.setDate(cur.getDate() + 1); guard += 1; }
  return out;
}

function fmtTime(d) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Sun..Sat index (0..6) for a 'YYYY-MM-DD' date — keys the workout plan
// (Prepare table is Sunday-anchored, so Sunday = 0 = earliest/"scheduled first").
function sundayIndexOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // 0=Sun..6=Sat
}

// Monday that starts the week containing `d`.
function mondayOf(d) {
  const dow = d.getDay(); // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1;
  const m = addDays(d, -back);
  m.setHours(0, 0, 0, 0);
  return m;
}

// Sunday that starts the week containing `d`. The Prepare table is Sun-anchored,
// so week navigation tracks this (not Monday) to stay aligned across all weeks.
function sundayOf(d) {
  const s = addDays(d, -d.getDay()); // getDay() 0 = Sunday
  s.setHours(0, 0, 0, 0);
  return s;
}

function loadWorkoutsRaw() {
  try {
    const raw = JSON.parse(localStorage.getItem('sunday-workout-log') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function loadTypeCategories() {
  try {
    const r = JSON.parse(localStorage.getItem('sunday-workout-type-categories'));
    if (r && typeof r === 'object') return r;
  } catch { /* ignore */ }
  return {};
}

function loadWorkoutTypes() {
  try {
    const r = JSON.parse(localStorage.getItem('sunday-workout-types'));
    if (Array.isArray(r)) return r;
  } catch { /* ignore */ }
  return [];
}

function loadTypeSkipDates() {
  try {
    const r = JSON.parse(localStorage.getItem('sunday-workout-type-skip-dates'));
    if (r && typeof r === 'object') return r;
  } catch { /* ignore */ }
  return {};
}

function loadNutritionGoals() {
  try {
    const r = JSON.parse(localStorage.getItem('sunday-nutrition-goals'));
    if (r && typeof r === 'object') return r;
  } catch { /* ignore */ }
  return null;
}

function loadDailyLog() {
  try {
    const r = JSON.parse(localStorage.getItem('sunday-daily-log'));
    if (r && typeof r === 'object') return r;
  } catch { /* ignore */ }
  return {};
}

const LOG_MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MACROS = [
  { key: 'calories', label: 'Cal', unit: '' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
];

// Per-day macro totals + % of goal for one date, mirroring DailyTotalsBar in
// the Log Meals page (skipped meals excluded; each skipped main meal trims the
// target by a third). Returns one row per macro.
function dayMacroRows(day, goals) {
  const empty = MACROS.map(m => ({ ...m, value: 0, pct: null, has: false }));
  if (!day || day.daySkipped) return empty;
  const skipped = Array.isArray(day.skippedMeals) ? day.skippedMeals : [];
  const entries = Array.isArray(day.entries) ? day.entries : [];
  const active = skipped.length
    ? entries.filter(e => {
        const slot = e.type === 'custom' && !e.mealSlot ? 'snack' : (LOG_MEAL_SLOTS.includes(e.mealSlot) ? e.mealSlot : 'snack');
        return !skipped.includes(slot);
      })
    : entries;
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of active) for (const m of MACROS) totals[m.key] += e.nutrition?.[m.key] || 0;
  const skippedMain = skipped.filter(s => ['breakfast', 'lunch', 'dinner'].includes(s)).length;
  const frac = Math.max(0, 1 - skippedMain / 3);
  return MACROS.map(m => {
    const val = totals[m.key];
    const goal = goals?.[m.key];
    const adj = goal ? goal * frac : 0;
    const pct = adj > 0 && val > 0 ? Math.round((val / adj) * 100) : null;
    return { ...m, value: val, pct, has: val > 0 };
  });
}

// Aggregate logged workouts into date -> [{ label, category }], mirroring the
// Workout page calendar's byDate so the Week Plan shows recorded days the same way.
// A stretch session isn't a workout day here: the player logs a finished
// routine as a workout (so it lands in History and Charts), but the Prepare
// table's workout row is about what you trained. Showing "🧘 Stretch" there
// reads as a logged workout AND makes the day count as already-trained, which
// suppresses the day's suggestion. Skipped in both — the cell falls through to
// the planned dropdown. `stretchRoutineNames` catches sessions logged before
// the `source` tag existed (see isStretchWorkout).
function buildWorkoutsByDate(workouts, typeCategories, stretchRoutineNames) {
  const m = new Map();
  for (const w of workouts || []) {
    if (!w?.date) continue;
    if (isStretchWorkout(w, stretchRoutineNames)) continue;
    // A sauna-only day (logged sauna with no exercises and no workout type) is a
    // placeholder that just carries the `sauna` flag — the 🧖 chip renders it from
    // saunaDates. It isn't a strength session, so skip it here; otherwise
    // workoutCalendarCategory would default the typeless record to "weights" and
    // the cell would show a phantom "🏋️ Weights".
    const hasEntries = Array.isArray(w.entries) && w.entries.length > 0;
    const hasType = (w.workoutType || '').trim().length > 0;
    if (!hasEntries && !hasType) continue;
    const cat = workoutCalendarCategory(w, typeCategories);
    const label = (w.workoutType || '').trim();
    const key = `${cat}|${label.toLowerCase()}`;
    if (!m.has(w.date)) m.set(w.date, []);
    const items = m.get(w.date);
    if (!items.some(it => it._key === key)) items.push({ _key: key, label, category: cat });
  }
  return m;
}

export function WeekPlanPage({ recipes, getRecipe, user, weeklyPlan = [], weeklyServings = {}, weekMealPlan = {}, weekWorkoutPlan = {}, onChangeMealPlan, onSetMealPlan, onChangeWorkoutPlan, onViewRecipe, onImportRecipe = () => {}, onOpenWorkout, onClose }) {
  const [weekStart, setWeekStart] = useState(() => sundayOf(new Date()));
  const [workoutsRaw, setWorkoutsRaw] = useState(loadWorkoutsRaw);
  const [typeCategories, setTypeCategories] = useState(loadTypeCategories);
  // Which (date|slot) cell currently has the add-recipe picker open.
  const [addingKey, setAddingKey] = useState(null);
  // Weekly workout goals (footer progress only) + the workout types & skip dates
  // that drive the days-since suggestion.
  const [workoutGoals, setWorkoutGoals] = useState(loadWorkoutGoals);
  const [workoutTypes, setWorkoutTypes] = useState(loadWorkoutTypes);
  const [typeSkipDates, setTypeSkipDates] = useState(loadTypeSkipDates);
  const [nutritionGoals, setNutritionGoals] = useState(loadNutritionGoals);
  const [dailyLog, setDailyLog] = useState(loadDailyLog);
  // Stretch routines (user doc `stretchRoutines`), only so a session logged
  // before the `source` tag existed can still be recognized by its routine name
  // and kept off the workout row.
  const [stretchRoutines, setStretchRoutines] = useState([]);
  // Weekly sauna goal + the user's per-day pin/veto decisions (user doc:
  // `saunaGoal` / `saunaOverrides`). Hydrated below; both feed resolveSaunaDates.
  const [saunaGoal, setSaunaGoal] = useState(DEFAULT_SAUNA_GOAL);
  const [saunaOverrides, setSaunaOverrides] = useState({});

  const todayKey = isoDate(new Date());
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStart, i))),
    [weekStart]
  );

  const stretchRoutineNames = useMemo(
    () => new Set(stretchRoutines.map(r => String(r?.name || '').trim().toLowerCase()).filter(Boolean)),
    [stretchRoutines],
  );

  // Logged workouts grouped by date, categorized exactly like the Workout
  // calendar (so the Week Plan shows recorded days the same way) — stretch
  // sessions excluded there too, which keeps the goal tally below in step.
  const workoutsByDate = useMemo(
    () => buildWorkoutsByDate(workoutsRaw, typeCategories, stretchRoutineNames),
    [workoutsRaw, typeCategories, stretchRoutineNames]
  );

  // Dates with a sauna logged (Workout.sauna, set on the mobile app) — drives
  // the 🧖 chip shown under the workout cell on the Prepare table.
  const saunaDates = useMemo(() => {
    const set = new Set();
    for (const w of workoutsRaw || []) {
      if (w?.sauna && w.date) set.add(w.date);
    }
    return set;
  }, [workoutsRaw]);

  // Pull the cross-device goals + type-categories like WorkoutCalendarView does,
  // so the seeded layout and recorded categories match even before visiting Workout.
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    loadField(user.uid, 'workoutWeeklyGoals').then(remote => {
      if (cancelled || !remote || typeof remote !== 'object') return;
      const merged = { ...DEFAULT_WORKOUT_GOALS, ...remote };
      setWorkoutGoals(merged);
      try { localStorage.setItem('sunday-workout-weekly-goals', JSON.stringify(merged)); } catch { /* ignore */ }
    }).catch(() => { /* keep local */ });
    loadField(user.uid, 'workoutTypeCategories').then(remote => {
      if (cancelled || !remote || typeof remote !== 'object') return;
      setTypeCategories(remote);
      try { localStorage.setItem('sunday-workout-type-categories', JSON.stringify(remote)); } catch { /* ignore */ }
    }).catch(() => { /* keep local */ });
    loadField(user.uid, 'workoutTypes').then(remote => {
      if (cancelled || !Array.isArray(remote)) return;
      setWorkoutTypes(remote);
      try { localStorage.setItem('sunday-workout-types', JSON.stringify(remote)); } catch { /* ignore */ }
    }).catch(() => { /* keep local */ });
    loadField(user.uid, 'workoutTypeSkipDates').then(remote => {
      if (cancelled || !remote || typeof remote !== 'object') return;
      setTypeSkipDates(remote);
      try { localStorage.setItem('sunday-workout-type-skip-dates', JSON.stringify(remote)); } catch { /* ignore */ }
    }).catch(() => { /* keep local */ });
    loadField(user.uid, 'stretchRoutines').then(remote => {
      if (!cancelled && Array.isArray(remote)) setStretchRoutines(remote);
    }).catch(() => { /* tag alone still catches current sessions */ });
    loadField(user.uid, 'saunaGoal').then(remote => {
      if (!cancelled && remote != null) setSaunaGoal(normalizeSaunaGoal(remote));
    }).catch(() => { /* keep default */ });
    loadField(user.uid, 'saunaOverrides').then(remote => {
      if (!cancelled && remote && typeof remote === 'object') setSaunaOverrides(normalizeSaunaOverrides(remote));
    }).catch(() => { /* keep default */ });
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Suggestion is driven by how overdue each workout TYPE is (days-since).
  // Most-overdue types fill the earliest auto days; the user's per-day picks in
  // weekWorkoutPlan (keyed Sun..Sat 0..6, value = type or 'rest') are honored and
  // the remaining days re-rank around them. Recomputes on every render so it
  // auto-adjusts when a day is changed/cleared or staleness changes.
  const rankedTypes = useMemo(
    () => rankWorkoutTypesByStaleness(workoutsRaw, workoutTypes, typeSkipDates),
    [workoutsRaw, workoutTypes, typeSkipDates]
  );
  // Which Sun..Sat (0..6) days of the CURRENT week already have a logged workout,
  // and which types were trained — so suggestions skip already-trained days and
  // don't re-suggest a freshly-done type. The Prepare table is Sunday-anchored to
  // the current week, so we walk this week's Sunday → Saturday dates.
  // Also counts the DAYS each category already has in the bank this week, the
  // same way tallyWorkouts does (one day can serve more than one category), so
  // the suggester and the goal tiles are counting the same thing.
  const { recordedWeekIdxs, recordedWeekTypes, recordedWeekCatDays } = useMemo(() => {
    const idxs = new Set();
    const types = new Set();
    const catDays = Object.fromEntries(WORKOUT_KIND_KEYS.map(c => [c, 0]));
    const today = new Date();
    const sunday = addDays(today, -today.getDay()); // back up to Sunday
    for (let i = 0; i < 7; i++) {
      const items = workoutsByDate.get(isoDate(addDays(sunday, i))) || [];
      if (items.length) {
        idxs.add(i);
        for (const it of items) if (it.label) types.add(it.label);
        const cats = new Set(items.map(it => it.category));
        for (const c of WORKOUT_KIND_KEYS) if (cats.has(c)) catDays[c] += 1;
      }
    }
    return { recordedWeekIdxs: idxs, recordedWeekTypes: types, recordedWeekCatDays: catDays };
  }, [workoutsByDate]);

  // One type→category resolver for the whole page. Must be the one
  // buildWorkoutsByDate uses (it falls back to keyword matching for types tagged
  // before categories existed) — if the planner and the tally disagreed about
  // what a type counts as, a goal could never close.
  const categoryOf = useCallback(
    (type) => workoutCalendarCategory({ workoutType: type }, typeCategories),
    [typeCategories],
  );

  const resolvedWorkoutPlan = useMemo(
    () => resolveWorkoutPlan(rankedTypes, weekWorkoutPlan, workoutTypes, recordedWeekIdxs, recordedWeekTypes, {
      goals: workoutGoals,
      categoryOf,
      loggedCatDays: recordedWeekCatDays,
      // The plan is always the CURRENT week's (recordedWeekIdxs is anchored to
      // today), so today's weekday is what splits done from still-to-come.
      todayIdx: sundayIndexOf(todayKey),
    }),
    [rankedTypes, weekWorkoutPlan, workoutTypes, recordedWeekIdxs, recordedWeekTypes, workoutGoals, categoryOf, recordedWeekCatDays, todayKey]
  );

  // ── Persist the resolved REST days (`plannedRestDates`) ──
  // The rest-day suggestion is computed here (staleness ranking + your per-day
  // overrides + what's already logged); the habit-automation cron can't
  // recompute it, so it can't tell a planned rest day from "hasn't happened
  // yet". We write the resolved rest DATES so the cron can auto-skip the
  // workout habit on them — including today, since a planned rest day is a
  // decision, not a day still waiting for a workout.
  //
  // Only written while viewing the CURRENT week: resolvedWorkoutPlan is always
  // the current week's resolution (recordedWeekIdxs is anchored to today), so
  // mapping it onto another week's dates would persist a guess. The cron only
  // ever looks at today/yesterday, so the current week is all it needs.
  const [plannedRestStored, setPlannedRestStored] = useState(null); // null = not loaded yet

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    loadField(user.uid, 'plannedRestDates')
      .then(v => { if (!cancelled) setPlannedRestStored(Array.isArray(v) ? v : []); })
      .catch(() => { if (!cancelled) setPlannedRestStored([]); });
    return () => { cancelled = true; };
  }, [user?.uid]);

  const isCurrentWeek = useMemo(
    () => isoDate(weekStart) === isoDate(sundayOf(new Date())),
    [weekStart]
  );

  // Dates in the visible week the plan resolves to Rest (auto-suggested or pinned).
  const weekRestDates = useMemo(
    () => days.filter(d => resolvedWorkoutPlan[sundayIndexOf(d)]?.value === 'rest'),
    [days, resolvedWorkoutPlan]
  );

  useEffect(() => {
    if (!user?.uid || plannedRestStored == null || !isCurrentWeek) return;
    const inWeek = new Set(days);
    const lo = isoDate(addDays(new Date(), -14));
    const hi = isoDate(addDays(new Date(), 28));
    const next = [...new Set([
      ...plannedRestStored.filter(d => !inWeek.has(d)), // leave other weeks alone
      ...weekRestDates,
    ])].filter(d => d >= lo && d <= hi).sort();
    // Compare sorted-to-sorted so a no-op render can't start a write loop.
    if (JSON.stringify(next) === JSON.stringify([...plannedRestStored].sort())) return;
    setPlannedRestStored(next);
    saveField(user.uid, 'plannedRestDates', next).catch(() => {});
  }, [user?.uid, plannedRestStored, weekRestDates, days, isCurrentWeek]);

  // value: a workout type, 'rest', or '__auto' (clears the day so it re-suggests).
  const setWorkoutCategory = useCallback((dayIndex, value) => {
    const next = { ...(weekWorkoutPlan || {}) };
    if (value === '__auto') delete next[dayIndex];
    else next[dayIndex] = value;
    onChangeWorkoutPlan(next);
  }, [weekWorkoutPlan, onChangeWorkoutPlan]);

  // The visible week's planned (non-rest, today-or-later) workout days — the
  // candidates a suggested sauna can attach to. Mirrors the cron's plannedDates:
  // a day only counts if the resolved plan gives it a real workout type.
  const plannedWorkoutDates = useMemo(() => {
    const out = [];
    for (const dateStr of days) {
      if (dateStr < todayKey) continue;
      const cell = resolvedWorkoutPlan[sundayIndexOf(dateStr)];
      if (cell?.value && cell.value !== 'rest') out.push(dateStr);
    }
    return out;
  }, [days, resolvedWorkoutPlan, todayKey]);

  // Days in the visible week that already have a sauna logged — they count
  // against the weekly goal, so the suggestion only tops up the difference.
  const loggedSaunaWeek = useMemo(() => days.filter(d => saunaDates.has(d)), [days, saunaDates]);

  // The days the goal says should get a sauna. Same helper the cron runs, so the
  // grid and the synced Google Calendar land on the same days.
  const suggestedSaunaDates = useMemo(() => resolveSaunaDates({
    weekDates: days,
    plannedDates: plannedWorkoutDates,
    loggedSaunaDays: loggedSaunaWeek,
    overrides: saunaOverrides,
    goal: saunaGoal,
    todayStr: todayKey,
  }), [days, plannedWorkoutDates, loggedSaunaWeek, saunaOverrides, saunaGoal, todayKey]);

  // Pin a sauna to a day, or veto one the goal suggested. Stored per-date so the
  // cron honors it too; past decisions are pruned on write.
  const toggleSaunaDay = useCallback((dateStr) => {
    const next = pruneSaunaOverrides(
      { ...saunaOverrides, [dateStr]: !suggestedSaunaDates.has(dateStr) },
      todayKey
    );
    setSaunaOverrides(next);
    if (user?.uid) saveField(user.uid, 'saunaOverrides', next).catch(() => {});
  }, [saunaOverrides, suggestedSaunaDates, todayKey, user?.uid]);

  // Write the workouts array everywhere the app expects it: the local mirror
  // (same 'sunday-workout-log' key WorkoutPage owns), our own state, and the
  // diff-aware per-workout Firestore writer. saveField('workoutLog') only
  // upserts/deletes the rows that actually changed, so this is a ~1-doc write.
  const persistWorkouts = useCallback((next) => {
    setWorkoutsRaw(next);
    try { localStorage.setItem('sunday-workout-log', JSON.stringify(next)); } catch { /* quota or disabled storage */ }
    if (user?.uid) saveField(user.uid, 'workoutLog', next).catch(() => {});
  }, [user?.uid]);

  // Log a real sauna day into workout history for `dateStr`: flip sauna:true on
  // an existing workout that date, or create a sauna-only day (empty entries).
  // Mirrors WorkoutPage.logSaunaDay so both surfaces write the same shape; the
  // Week Plan then reads it back as the solid "🧖 Sauna" logged chip. Read
  // fresh from localStorage so we never clobber a concurrent Workout-page save.
  const logSaunaForDate = useCallback((dateStr) => {
    const current = loadWorkoutsRaw();
    const existing = current.find(w => w?.date === dateStr);
    const workout = existing
      ? { ...existing, sauna: true, savedAt: new Date().toISOString() }
      : { id: newWorkoutId(), date: dateStr, gym: '', workoutType: '', entries: [], sauna: true, savedAt: new Date().toISOString() };
    const next = [workout, ...current.filter(w => w?.date !== dateStr)]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.savedAt || '').localeCompare(b.savedAt || ''));
    persistWorkouts(next);
  }, [persistWorkouts]);

  // Un-log a sauna from `dateStr`: drop a sauna-only day entirely, or just clear
  // the flag on a day that also has logged exercises (keep the workout itself).
  const removeSaunaForDate = useCallback((dateStr) => {
    const current = loadWorkoutsRaw();
    const existing = current.find(w => w?.date === dateStr && w?.sauna);
    if (!existing) return;
    const hasExercises = Array.isArray(existing.entries) && existing.entries.length > 0;
    let next;
    if (hasExercises) {
      const { sauna, ...rest } = existing; // eslint-disable-line no-unused-vars
      next = [{ ...rest, savedAt: new Date().toISOString() }, ...current.filter(w => w?.date !== dateStr)];
    } else {
      next = current.filter(w => !(w?.date === dateStr && w?.sauna));
    }
    next = next.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.savedAt || '').localeCompare(b.savedAt || ''));
    persistWorkouts(next);
  }, [persistWorkouts]);

  // The 🧖 chip under a workout cell. A logged sauna is a plain (solid) chip;
  // upcoming days get a clickable chip — dashed when suggested, ghosted when not
  // — so the weekly goal is visible and adjustable straight from the grid.
  const renderSaunaChip = useCallback((dateStr) => {
    // A real logged sauna (workout.sauna) — solid chip, click to un-log it.
    if (saunaDates.has(dateStr)) {
      return (
        <button
          type="button"
          className={`${styles.workoutSauna} ${styles.saunaLogged}`}
          onClick={(e) => { e.stopPropagation(); removeSaunaForDate(dateStr); }}
          title="Sauna logged — click to remove from workout history"
        >
          🧖 Sauna
        </button>
      );
    }
    if (dateStr < todayKey) return null;
    const on = suggestedSaunaDates.has(dateStr);
    const pinned = saunaOverrides[dateStr] === true;
    // A goal-suggested (or pinned) day is a plan, not history — clicking it
    // dismisses the suggestion (so the Google Calendar sync drops it too).
    if (on) {
      const title = pinned
        ? 'Sauna pinned to this day — click to remove from plan'
        : `Suggested to hit your goal of ${saunaGoal} saunas/week — click to remove from plan`;
      return (
        <button
          type="button"
          className={`${styles.workoutSauna} ${styles.saunaSuggested}${pinned ? ` ${styles.saunaPinned}` : ''}`}
          onClick={(e) => { e.stopPropagation(); toggleSaunaDay(dateStr); }}
          title={title}
        >
          🧖 Sauna
        </button>
      );
    }
    // Off — click logs a real sauna day straight into workout history.
    return (
      <button
        type="button"
        className={`${styles.workoutSauna} ${styles.saunaOff}`}
        onClick={(e) => { e.stopPropagation(); logSaunaForDate(dateStr); }}
        title="Click to log a sauna day"
      >
        🧖 Add
      </button>
    );
  }, [saunaDates, suggestedSaunaDates, saunaOverrides, saunaGoal, todayKey, toggleSaunaDay, logSaunaForDate, removeSaunaForDate]);

  // Render the workout cell for a given date (Prepare table). A recorded workout
  // wins; otherwise show the days-since suggestion with an editable dropdown of
  // your workout types + Rest + Auto. Keyed Sun..Sat.
  const renderDayWorkout = useCallback((dateStr) => {
    const saunaChip = renderSaunaChip(dateStr);
    const recorded = workoutsByDate.get(dateStr) || [];
    if (recorded.length) {
      // The chip is a sibling of the open-workouts button, never inside it —
      // it's a button itself on upcoming days, and buttons can't nest.
      return (
        <div className={styles.workoutBody}>
          <button className={styles.workoutOpen} onClick={onOpenWorkout} title="Open workouts" type="button">
            {recorded.map((it, ii) => (
              <span key={ii} className={styles.workoutItem}>
                <span className={styles.workoutIcon}>{CAL_ICON[it.category]}</span>
                <span className={styles.workoutName}>{it.label || WORKOUT_CAT_META[it.category]?.label || ''}</span>
              </span>
            ))}
          </button>
          {saunaChip}
        </div>
      );
    }
    const idx = sundayIndexOf(dateStr);
    let cell = resolvedWorkoutPlan[idx] || { value: 'rest', isAuto: true };
    // A past day with no recorded workout means the planned workout never
    // actually happened — show it as a Rest day instead of a misleading "Yoga"
    // that reads as if it were logged. This branch is only reached when nothing
    // was recorded for the date (recorded days return above), so it applies to
    // both auto suggestions AND manual weekly-plan picks: weekWorkoutPlan is a
    // recurring weekday template, so a past unlogged day of it is history, not a
    // plan. Today and future days keep their planned type.
    if (dateStr < isoDate(new Date()) && cell.value !== 'rest') {
      cell = { value: 'rest', isAuto: true };
    }
    const isRest = cell.value === 'rest';
    // Same resolver the planner and the tally use, so a type categorised only by
    // keyword doesn't show one icon here and count as something else in the goals.
    const iconCat = isRest ? 'rest' : categoryOf(cell.value);
    return (
      <div className={styles.workoutBody}>
        <span className={styles.workoutItem}>
          <span className={styles.workoutIcon}>{CAL_ICON[iconCat] || CAL_ICON.rest}</span>
          <select
            className={styles.workoutSelect}
            value={isRest ? '__rest' : cell.value}
            onChange={(e) => setWorkoutCategory(idx, e.target.value === '__rest' ? 'rest' : e.target.value)}
            aria-label="Planned workout"
          >
            <option value="__auto">Auto</option>
            {workoutTypes.map(t => <option key={t} value={t}>{t}</option>)}
            <option value="__rest">Rest</option>
          </select>
        </span>
        {cell.isAuto && <span className={styles.workoutAuto}>auto</span>}
        {saunaChip}
      </div>
    );
  }, [workoutsByDate, renderSaunaChip, resolvedWorkoutPlan, categoryOf, workoutTypes, setWorkoutCategory, onOpenWorkout]);

  // Refresh from localStorage when a Firestore sync hydrates it, or another tab writes.
  useEffect(() => {
    function refresh() {
      setWorkoutsRaw(loadWorkoutsRaw());
      setTypeCategories(loadTypeCategories());
      setWorkoutTypes(loadWorkoutTypes());
      setTypeSkipDates(loadTypeSkipDates());
      setWorkoutGoals(loadWorkoutGoals());
      setNutritionGoals(loadNutritionGoals());
      setDailyLog(loadDailyLog());
    }
    window.addEventListener('firestore-sync', refresh);
    window.addEventListener('storage', refresh);
    // The % of Meals Tracked chart edits the shared goal and fires this — keep
    // the Week goals · meals tile in sync when it changes.
    window.addEventListener('goals-updated', refresh);
    return () => {
      window.removeEventListener('firestore-sync', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('goals-updated', refresh);
    };
  }, []);

  // Daily Supplements (moved here from the Track Meals page) — always today's
  // list. If today hasn't been touched yet, carry forward the most recent prior
  // day's supplements (the first edit persists under dailyLog[today].supplements).
  const todaySupplements = useMemo(() => {
    if (dailyLog[todayKey]?.supplements !== undefined) return dailyLog[todayKey].supplements;
    const priorDates = Object.keys(dailyLog).filter(d => d < todayKey).sort().reverse();
    for (const d of priorDates) {
      const sups = dailyLog[d]?.supplements;
      if (Array.isArray(sups)) return sups;
    }
    return [];
  }, [dailyLog, todayKey]);

  const handleSupplementsChange = useCallback((next) => {
    setDailyLog(prev => {
      const all = { ...prev };
      if (!all[todayKey]) all[todayKey] = { entries: [] };
      all[todayKey] = { ...all[todayKey], supplements: next };
      saveDailyLog(all, user);
      return all;
    });
  }, [todayKey, user]);

  // ── Google Calendar ("Plans") ──
  const [calConnected, setCalConnected] = useState(() => hasGoogleToken());
  const [calendars, setCalendars] = useState([]);
  const [selectedCalIds, setSelectedCalIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SELECTED_KEY) || '[]'); } catch { return []; }
  });
  const [eventsByDate, setEventsByDate] = useState({});
  const [calLoading, setCalLoading] = useState(false);
  // Everything Google-Calendar-related lives in one "Google Calendar Integration"
  // modal: which calendars to show, the auto-sync toggle, and the event timing +
  // sauna goal. The calendar list needs no collapse in here — there's room.
  const [calModalOpen, setCalModalOpen] = useState(false);
  // Auto-sync planned workouts, saunas and cooking into a dedicated "Prep Day"
  // Google Calendar via the server cron (needs the calendar scope + a stored
  // refresh token). `googleCalendarAutoSync` / `googleWorkoutCalendarId` live on
  // the user doc, as does the per-kind timing in `calendarSyncSettings`.
  const [autoSyncWorkouts, setAutoSyncWorkouts] = useState(false);
  const [workoutCalId, setWorkoutCalId] = useState('');
  const [syncSettings, setSyncSettings] = useState(DEFAULT_CALENDAR_SYNC_SETTINGS);
  // Raw text for the standing-guest field. Declared up here with the rest of the
  // calendar-sync state because the hydrate effect below seeds it — same reason
  // the others live here rather than beside their updater.
  const [guestEmailDraft, setGuestEmailDraft] = useState('');

  // Hydrate the calendar-sync fields from the user doc. Kept next to their state
  // so the setters aren't referenced above their declaration.
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    loadField(user.uid, 'googleCalendarAutoSync').then(v => { if (!cancelled) setAutoSyncWorkouts(v === true); }).catch(() => {});
    loadField(user.uid, 'googleWorkoutCalendarId').then(v => { if (!cancelled && typeof v === 'string') setWorkoutCalId(v); }).catch(() => {});
    loadField(user.uid, 'calendarSyncSettings').then(v => {
      if (cancelled || !v || typeof v !== 'object') return;
      const norm = normalizeCalendarSyncSettings(v);
      setSyncSettings(norm);
      // Seed the guest field's draft here rather than deriving it from
      // syncSettings on every render — the stored value is lowercased, which
      // would rewrite the box under the cursor while the user types.
      setGuestEmailDraft(norm.guestEmail || '');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Enable/disable auto-sync to the dedicated Google Calendar. Enabling requires
  // a connected Google account (so a refresh token is stored server-side); if not
  // connected, kick off the OAuth popup first.
  const toggleAutoSyncWorkouts = useCallback((next) => {
    // Enabling always (re)opens Google consent: the cron needs a refresh token
    // carrying the broader `calendar` scope, which older connections don't have.
    if (next) openGoogleAuthPopup();
    setAutoSyncWorkouts(next);
    if (user?.uid) saveField(user.uid, 'googleCalendarAutoSync', next).catch(() => {});
  }, [user?.uid]);

  // Esc closes the integration modal (overlay click and × do too).
  useEffect(() => {
    if (!calModalOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setCalModalOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [calModalOpen]);

  // Patch one kind's timing. Kept local-first so typing stays responsive; the
  // write is debounced because number/time inputs fire per keystroke.
  const syncSaveTimer = useRef(null);
  const updateSyncSetting = useCallback((kind, patch) => {
    const next = normalizeCalendarSyncSettings({ ...syncSettings, [kind]: { ...syncSettings[kind], ...patch } });
    setSyncSettings(next);
    if (!user?.uid) return;
    clearTimeout(syncSaveTimer.current);
    syncSaveTimer.current = setTimeout(() => {
      saveField(user.uid, 'calendarSyncSettings', next).catch(() => {});
    }, 600);
  }, [syncSettings, user?.uid]);
  useEffect(() => () => clearTimeout(syncSaveTimer.current), []);

  // Standing guest on every synced event (draft state declared with the other
  // calendar-sync fields above). The input holds raw text so an in-progress
  // address isn't fought by normalization; only a valid address — or a
  // deliberate blank, meaning "invite nobody" — is ever persisted, so a
  // half-typed string can never reach the cron and get the wrong person emailed.
  const guestEmailInvalid = guestEmailDraft.trim() !== '' && !isValidGuestEmail(guestEmailDraft);
  const guestSaveTimer = useRef(null);
  const updateGuestEmail = useCallback((raw) => {
    setGuestEmailDraft(raw);
    const trimmed = raw.trim();
    if (trimmed !== '' && !isValidGuestEmail(trimmed)) return;
    const next = normalizeCalendarSyncSettings({ ...syncSettings, guestEmail: trimmed });
    setSyncSettings(next);
    if (!user?.uid) return;
    clearTimeout(guestSaveTimer.current);
    guestSaveTimer.current = setTimeout(() => {
      saveField(user.uid, 'calendarSyncSettings', next).catch(() => {});
    }, 600);
  }, [syncSettings, user?.uid]);
  useEffect(() => () => clearTimeout(guestSaveTimer.current), []);

  // Weekly sauna goal. Local-first + debounced for the same reason as the timing
  // fields: the number input fires per keystroke.
  const saunaGoalTimer = useRef(null);
  const updateSaunaGoal = useCallback((raw) => {
    const next = normalizeSaunaGoal(raw);
    setSaunaGoal(next);
    if (!user?.uid) return;
    clearTimeout(saunaGoalTimer.current);
    saunaGoalTimer.current = setTimeout(() => {
      saveField(user.uid, 'saunaGoal', next).catch(() => {});
    }, 600);
  }, [user?.uid]);
  useEffect(() => () => clearTimeout(saunaGoalTimer.current), []);

  // ── Rally events (pulled from the Rally app's Plans data) ──
  const [rallyByDate, setRallyByDate] = useState({});
  // ── Voting Calendar (civic election dates from the Rally app's Voting page) ──
  const [votingByDate, setVotingByDate] = useState({});

  // Render the "Events" cell for a given date (Prepare table bottom row):
  // Rally events (🎉) first, then the Google Calendar events for that day
  // from the calendars the user selected.
  const renderDayEvents = useCallback((dateStr) => {
    const rally = rallyByDate[dateStr] || [];
    const voting = votingByDate[dateStr] || [];
    const gcal = eventsByDate[dateStr] || [];
    if (!rally.length && !voting.length && !gcal.length) return <span className={styles.emptyHint}>—</span>;
    return (
      <>
        {rally.map((evt) => (
          <div key={`rally-${evt.id}`} className={styles.eventRow} title={evt.location ? `${evt.title} · ${evt.location}` : evt.title}>
            <span className={styles.eventDot} style={{ background: RALLY_COLOR }} />
            <span className={styles.eventTitle}>{evt.title}</span>
          </div>
        ))}
        {voting.map((evt) => (
          <div key={`vote-${evt.id}`} className={styles.eventRow} title={evt.title}>
            <span className={styles.eventDot} style={{ background: VOTE_COLOR }} />
            <span className={styles.eventTitle}>{evt.title}</span>
          </div>
        ))}
        {gcal.map((evt, idx) => (
          <div key={`g-${idx}`} className={styles.eventRow} title={evt.calendar ? `${evt.title} · ${evt.calendar}` : evt.title}>
            <span className={styles.eventDot} style={{ background: evt.color }} />
            <span className={styles.eventTitle}>{evt.title}</span>
          </div>
        ))}
      </>
    );
  }, [rallyByDate, votingByDate, eventsByDate]);

  useEffect(() => {
    try { localStorage.setItem(SELECTED_KEY, JSON.stringify(selectedCalIds)); } catch { /* ignore */ }
  }, [selectedCalIds]);

  // The OAuth popup posts the tokens back to this window on success.
  useEffect(() => {
    function onMessage(e) {
      if (e.data?.type === 'google-auth-success') {
        storeTokenFromPopup(e.data);
        setCalConnected(true);
        // Persist the refresh token server-side so the workout-calendar cron can
        // sync on your behalf even when the site is closed.
        if (e.data.refreshToken && user?.uid) {
          saveField(user.uid, 'googleCalendarRefreshToken', e.data.refreshToken).catch(() => {});
        }
      } else if (e.data?.type === 'google-auth-error') {
        // Surface the failure instead of letting the popup close silently.
        console.error('Google Calendar auth failed:', e.data.error);
        alert(`Google Calendar connection failed: ${e.data.error || 'unknown error'}`);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [user?.uid]);

  const loadCalendars = useCallback(async () => {
    const data = await fetchGoogleCalendars();
    if (data.needsAuth) { setCalConnected(false); return; }
    // The picker used to auto-open when nothing was selected; it's always
    // visible inside the integration modal now, so there's nothing to reveal.
    if (data.calendars) setCalendars(data.calendars);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (calConnected) loadCalendars();
  }, [calConnected, loadCalendars]);

  // Pull events for the visible week across every selected calendar.
  const refreshEvents = useCallback(async () => {
    if (!calConnected || selectedCalIds.length === 0) { setEventsByDate({}); return; }
    setCalLoading(true);
    const colorById = Object.fromEntries(calendars.map(c => [c.id, c.color]));
    const nameById = Object.fromEntries(calendars.map(c => [c.id, c.name]));
    // Cover both grids: the lower Mon–Sun grid AND the Sun-anchored Prepare
    // table (which starts the day BEFORE weekStart), so its leading Sunday and
    // its Saturday both have events.
    const start = addDays(weekStart, -1);
    const end = addDays(weekStart, 6);
    const timeMin = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0).toISOString();
    const timeMax = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59).toISOString();
    const map = {};
    for (const calId of selectedCalIds) {
      try {
        const data = await fetchGoogleEvents({ timeMin, timeMax, calendarId: calId });
        if (data.needsAuth) { setCalConnected(false); continue; }
        if (!data.events) continue;
        for (const evt of data.events) {
          const start = parseEventDate(evt.start);
          const endD = parseEventDate(evt.end || evt.start);
          if (!start) continue;
          const datesFor = evt.allDay ? eachDay(start, new Date(endD.getTime() - 86400000)) : [start];
          for (const d of datesFor) {
            const ds = isoDate(d);
            if (!map[ds]) map[ds] = [];
            const key = `${(evt.title || '').trim().toLowerCase()}|${evt.allDay ? 'allday' : start.getTime()}`;
            if (map[ds].some(e => e._key === key)) continue;
            map[ds].push({
              _key: key,
              title: evt.title,
              time: evt.allDay ? '' : fmtTime(start),
              color: colorById[calId] || '#4285F4',
              calendar: nameById[calId] || '',
              allDay: evt.allDay,
              rawStart: start.getTime(),
            });
          }
        }
      } catch { /* skip this calendar */ }
    }
    for (const ds of Object.keys(map)) {
      map[ds].sort((a, b) => {
        if (a.allDay && !b.allDay) return -1;
        if (!a.allDay && b.allDay) return 1;
        return a.rawStart - b.rawStart;
      });
    }
    setEventsByDate(map);
    setCalLoading(false);
  }, [calConnected, selectedCalIds, calendars, weekStart]);

  // Legitimate data-fetch: reload calendar events whenever the week or the
  // selected calendars change. refreshEvents sets loading/results state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refreshEvents(); }, [refreshEvents]);

  // Pull finalized Rally events for the visible week (server-side proxy hides
  // the shared secret and avoids a cross-origin call to the Rally app).
  const fetchRallyEvents = useCallback(async () => {
    // Span the day before weekStart (the Sun-anchored Prepare table's first day)
    // through the lower week's Sunday, matching the Google events window.
    const start = isoDate(addDays(weekStart, -1));
    const end = isoDate(addDays(weekStart, 6));
    try {
      const res = await fetch(`/api/rally-events?start=${start}&end=${end}`);
      const data = await res.json();
      setRallyByDate(data.eventsByDay || {});
    } catch {
      setRallyByDate({});
    }
  }, [weekStart]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchRallyEvents(); }, [fetchRallyEvents]);

  // Pull the Voting Calendar (civic election dates) for the visible week from the
  // Rally app, via the same server-side proxy pattern as Rally events.
  const fetchVotingEvents = useCallback(async () => {
    const start = isoDate(addDays(weekStart, -1));
    const end = isoDate(addDays(weekStart, 6));
    try {
      const res = await fetch(`/api/voting-events?start=${start}&end=${end}`);
      const data = await res.json();
      setVotingByDate(data.eventsByDay || {});
    } catch {
      setVotingByDate({});
    }
  }, [weekStart]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchVotingEvents(); }, [fetchVotingEvents]);

  function connectCalendar() { openGoogleAuthPopup(); }
  function disconnectCalendar() {
    disconnectGoogle();
    setCalConnected(false);
    setCalendars([]);
    setEventsByDate({});
    // Also stop the server-side workout sync and drop the stored token.
    setAutoSyncWorkouts(false);
    if (user?.uid) {
      saveField(user.uid, 'googleCalendarAutoSync', false).catch(() => {});
      saveField(user.uid, 'googleCalendarRefreshToken', '').catch(() => {});
    }
  }
  function toggleCalendar(id) {
    setSelectedCalIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  const weekEnd = addDays(weekStart, 6);
  const rangeLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const addRecipe = useCallback((date, slot, id) => {
    if (!id) { setAddingKey(null); return; }
    const existing = weekMealPlan?.[date]?.[slot] || [];
    if (!existing.includes(id)) onChangeMealPlan(date, slot, [...existing, id]);
    setAddingKey(null);
  }, [weekMealPlan, onChangeMealPlan]);

  const removeRecipe = useCallback((date, slot, id) => {
    const existing = weekMealPlan?.[date]?.[slot] || [];
    onChangeMealPlan(date, slot, existing.filter(x => x !== id));
  }, [weekMealPlan, onChangeMealPlan]);

  // This week's workout tally — days with each category logged; rest = empty
  // days up to today, mirroring the Workout calendar's per-week progress.
  const weekTally = useMemo(
    () => tallyWorkouts(days, workoutsByDate, todayKey),
    [days, workoutsByDate, todayKey],
  );

  // Sauna sessions this week = distinct days in the visible week that have at
  // least one workout with `sauna: true` (logged from the mobile app).
  const weekSaunas = useMemo(() => countSaunaDays(days, saunaDates), [days, saunaDates]);

  // This week's meal tracking: what % of the whole week's main meals
  // (breakfast/lunch/dinner across all 7 days = 21 slots) were logged or marked
  // skipped — same per-day definition as MealsTrackedChart — plus the total
  // number of meals eaten out. Denominator is the full week, so the tile climbs
  // toward 100% as the week is filled in. Eating-out spans all 7 days too.
  const mealStats = useMemo(() => mealStatsForDays(days, dailyLog), [days, dailyLog]);

  // This week's fruit & veg, summed from the same per-entry servings the
  // Prepare grid's Veg/Fruit rows and the Fruit & Veg chart read
  // (`nutrition.vegServings` / `fruitServings`). Days marked skipped contribute
  // nothing, and entries in a skipped meal slot are left out — matching
  // ServingsChart, so the week total equals the per-day rows added up.
  const produceStats = useMemo(() => produceForDays(days, dailyLog), [days, dailyLog]);

  // Weekly produce targets = the DAILY goals from Nutrition Goals × the 7 days
  // shown, so there's one place to edit them and the tile agrees with the
  // per-day Veg/Fruit rows. Defaults match NutritionGoalsPage (5 veg, 4 fruit).
  // Kept as the per-DAY figures so the history can scale them to any week's
  // length itself; the tile below multiplies by the 7 days on screen.
  const produceGoalsPerDay = useMemo(() => {
    const perDay = (v, fallback) => {
      const n = Number(v);
      return v == null || isNaN(n) || n < 0 ? fallback : n;
    };
    return {
      veg: perDay(nutritionGoals?.vegServings, 5),
      fruit: perDay(nutritionGoals?.fruitServings, 4),
    };
  }, [nutritionGoals]);
  const produceGoals = useMemo(() => ({
    veg: produceGoalsPerDay.veg * days.length,
    fruit: produceGoalsPerDay.fruit * days.length,
  }), [produceGoalsPerDay, days.length]);

  // Weekly meals-tracked target — reuses the same `dailyMealsTrackedPct` goal the
  // % of Meals Tracked chart edits (stored in sunday-nutrition-goals). Defaults
  // to 50% when unset, per the "at least 50% tracked" target.
  const mealsTrackedGoal = useMemo(() => {
    const v = nutritionGoals?.dailyMealsTrackedPct;
    if (v == null || isNaN(Number(v))) return 50;
    return Math.max(0, Math.min(100, Number(v)));
  }, [nutritionGoals]);

  // Distribute the "This Week" recipes across the visible week by servings:
  // each recipe fills one day-slot per serving (breakfast recipes → breakfast,
  // everything else → dinner), round-robin across the 7 days. Non-destructive:
  // merges into existing slots (deduped) so manual edits are kept.
  const fillFromThisWeek = useCallback(() => {
    const queues = { breakfast: [], dinner: [] };
    for (const id of weeklyPlan || []) {
      const r = getRecipe(id);
      if (!r) continue;
      const slot = r.category === 'breakfast' ? 'breakfast' : 'dinner';
      const servings = Math.max(1, Math.round(Number(weeklyServings?.[id] ?? r.servings ?? 1)) || 1);
      for (let s = 0; s < servings; s++) queues[slot].push(id);
    }
    const next = { ...weekMealPlan };
    const assign = (slot) => {
      queues[slot].forEach((id, idx) => {
        const date = days[idx % 7];
        const day = { ...(next[date] || {}) };
        const existing = day[slot] || [];
        if (!existing.includes(id)) day[slot] = [...existing, id];
        next[date] = day;
      });
    };
    assign('breakfast');
    assign('dinner');
    onSetMealPlan(next);
  }, [weeklyPlan, weeklyServings, getRecipe, weekMealPlan, days, onSetMealPlan]);

  const fillCount = (weeklyPlan || []).length;

  // Color-coded legend for the Events row — event rows show only a colored dot,
  // so this maps each color back to its source: Rally + Voting (when present),
  // then each selected Google calendar by name.
  const legendCals = calConnected ? calendars.filter(c => selectedCalIds.includes(c.id)) : [];
  const legendItems = [
    ...(Object.values(rallyByDate).some(a => a?.length) ? [{ id: 'rally', color: RALLY_COLOR, label: '🎉 Rally' }] : []),
    ...(Object.values(votingByDate).some(a => a?.length) ? [{ id: 'vote', color: VOTE_COLOR, label: '🗳️ Vote' }] : []),
    ...legendCals.map(c => ({ id: c.id, color: c.color, label: c.name })),
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Week Plan</h1>
          <p className={styles.subtitle}>{rangeLabel}</p>
        </div>
        <div className={styles.weekNav}>
          <button className={styles.navArrow} onClick={() => setWeekStart(s => addDays(s, -7))} aria-label="Previous week">‹</button>
          <button className={styles.todayBtn} onClick={() => setWeekStart(sundayOf(new Date()))}>This week</button>
          <button className={styles.navArrow} onClick={() => setWeekStart(s => addDays(s, 7))} aria-label="Next week">›</button>
        </div>
      </div>

      <div className={styles.prepareRow}>
      <div className={styles.prepareSection}>
        <DailyTrackerPage
          prepareOnly
          // Follow the ‹ › week nav. weekStart is now Sunday-anchored (sundayOf),
          // so this lines up with the Sun→Sat Prepare table on every week —
          // including Sundays, which the old Monday-anchored weekStart broke.
          prepareWeekStart={isoDate(weekStart)}
          recipes={recipes}
          getRecipe={getRecipe}
          user={user}
          weeklyPlan={weeklyPlan}
          weeklyServings={weeklyServings}
          onViewRecipe={onViewRecipe}
          onImportRecipe={() => {}}
          onClose={() => {}}
          renderDayWorkout={renderDayWorkout}
          renderDayEvents={(calConnected || Object.values(rallyByDate).some(a => a?.length) || Object.values(votingByDate).some(a => a?.length)) ? renderDayEvents : undefined}
        />
        {legendItems.length > 0 && (
          <div className={styles.calLegend}>
            {legendItems.map(item => (
              <span key={item.id} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: item.color }} />
                <span className={styles.legendLabel}>{item.label}</span>
              </span>
            ))}
          </div>
        )}

        {/* Everything Google-Calendar lives behind this one button. */}
        <div className={styles.calBar}>
          <button
            className={styles.calConnectBtn}
            onClick={() => setCalModalOpen(true)}
            aria-haspopup="dialog"
          >
            📅 Google Calendar Integration
            <span className={styles.calBtnNote}>
              {!calConnected
                ? 'Not connected'
                : [
                  selectedCalIds.length
                    ? `${selectedCalIds.length} calendar${selectedCalIds.length === 1 ? '' : 's'} shown`
                    : 'No calendars shown',
                  autoSyncWorkouts ? 'syncing' : null,
                ].filter(Boolean).join(' · ')}
            </span>
          </button>
        </div>

        {calModalOpen && (
          <div
            className={styles.modalOverlay}
            onClick={() => setCalModalOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Google Calendar Integration"
          >
            <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>📅 Google Calendar Integration</h3>
                <button className={styles.modalClose} onClick={() => setCalModalOpen(false)} aria-label="Close">×</button>
              </div>

              {/* 1 — read: whose events show on the Prepare grid. */}
              <div className={styles.calSection}>
                <div className={styles.calSectionHead}>
                  <span className={styles.syncGearTitle}>
                    Show events on the grid{calConnected && selectedCalIds.length ? ` · ${selectedCalIds.length}` : ''}
                  </span>
                  {calConnected && (
                    <span className={styles.calSectionActions}>
                      <button className={styles.calBtn} onClick={refreshEvents} disabled={calLoading}>
                        {calLoading ? 'Loading…' : '↻ Refresh'}
                      </button>
                      <button className={styles.calBtn} onClick={disconnectCalendar}>Disconnect</button>
                    </span>
                  )}
                </div>
                {!calConnected ? (
                  <>
                    <div className={styles.syncGearNote}>
                      Connect Google to show your existing events on the Prepare grid, and to let Prep Day
                      push your planned workouts, saunas and cooking back to a calendar of its own.
                    </div>
                    <button className={styles.calConnectBtn} onClick={connectCalendar}>📅 Connect Google Calendar</button>
                  </>
                ) : (
                  <div className={styles.calPicker}>
                    {calendars.length === 0 ? (
                      <span className={styles.emptyHint}>Loading your calendars…</span>
                    ) : calendars.map(c => (
                      <label key={c.id} className={styles.calRow}>
                        <input type="checkbox" checked={selectedCalIds.includes(c.id)} onChange={() => toggleCalendar(c.id)} />
                        <span className={styles.calColor} style={{ background: c.color }} />
                        <span className={styles.calName}>{c.name}</span>
                        {c.primary && <span className={styles.calBadge}>Primary</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* 2 — write: push the plan out to a dedicated calendar (server cron). */}
              <div className={styles.calSection}>
                <div className={styles.syncGearTitle}>Auto-sync the plan out</div>
                <label className={styles.workoutSyncToggle}>
                  <input type="checkbox" checked={autoSyncWorkouts} onChange={e => toggleAutoSyncWorkouts(e.target.checked)} />
                  <span>🏋️ Auto-sync workouts, sauna &amp; cooking to Google Calendar</span>
                </label>
                <div className={styles.syncGearNote}>
                  Creates a “Prep Day” calendar and updates it hourly with this &amp; next week’s workouts,
                  saunas and cooking. Turning this on asks Google for permission again — that’s expected.
                  {' '}<button className={styles.calBtn} onClick={connectCalendar}>Reconnect Google</button> if events don’t appear.
                </div>
              </div>

              {/* 3 — the settings the old ⚙ held. The sauna goal drives the grid's
                  suggestions too, so this section shows even when not connected. */}
              <div className={styles.calSection}>
                <div className={styles.syncGearTitle}>Event timing &amp; sauna goal</div>
                {SYNC_KINDS.map(kind => {
                  const cfg = syncSettings[kind.key];
                  return (
                    <div key={kind.key} className={styles.syncGearRow}>
                      <span className={styles.syncGearKind}>{kind.icon} {kind.label}</span>
                      <select
                        className={styles.syncGearSelect}
                        value={cfg.startMode === 'after' ? `after:${cfg.after}` : 'time'}
                        onChange={e => {
                          const v = e.target.value;
                          if (v === 'time') updateSyncSetting(kind.key, { startMode: 'time' });
                          else updateSyncSetting(kind.key, { startMode: 'after', after: v.slice(6) });
                        }}
                        aria-label={`${kind.label} start`}
                      >
                        <option value="time">At</option>
                        {anchorOptionsFor(kind.key).map(a => (
                          <option key={a} value={`after:${a}`}>
                            After {a === ANY_WORKOUT
                              ? 'the workout'
                              : SYNC_KINDS.find(k => k.key === a).label.toLowerCase()}
                          </option>
                        ))}
                      </select>
                      {cfg.startMode === 'time' ? (
                        <input
                          type="time"
                          className={styles.syncGearTime}
                          value={cfg.time}
                          onChange={e => updateSyncSetting(kind.key, { time: e.target.value })}
                          aria-label={`${kind.label} start time`}
                        />
                      ) : (
                        <span className={styles.syncGearChained} title={`Starts when ${cfg.after} ends`}>ends</span>
                      )}
                      <input
                        type="number"
                        className={styles.syncGearMins}
                        min="5"
                        max="720"
                        step="5"
                        value={cfg.durationMin}
                        onChange={e => updateSyncSetting(kind.key, { durationMin: e.target.value })}
                        aria-label={`${kind.label} length in minutes`}
                      />
                      <span className={styles.syncGearUnit}>min</span>
                    </div>
                  );
                })}
                <div className={styles.syncGearRow}>
                  <span className={styles.syncGearKind}>🧖 Sauna goal</span>
                  <input
                    type="number"
                    className={styles.syncGearMins}
                    min="0"
                    max={MAX_SAUNA_GOAL}
                    step="1"
                    value={saunaGoal}
                    onChange={e => updateSaunaGoal(e.target.value)}
                    aria-label="Weekly sauna goal"
                  />
                  <span className={styles.syncGearUnit}>per week</span>
                </div>
                <div className={styles.syncGearRow}>
                  <span className={styles.syncGearKind}>✉️ Invite guest</span>
                  <input
                    type="email"
                    className={styles.syncGearEmail}
                    placeholder="nobody@example.com"
                    value={guestEmailDraft}
                    onChange={e => updateGuestEmail(e.target.value)}
                    aria-label="Guest email added to every synced event"
                    aria-invalid={guestEmailInvalid}
                  />
                </div>
                <div className={styles.syncGearNote}>
                  {guestEmailInvalid
                    ? 'Not a valid email address — nobody will be invited until this is fixed.'
                    : syncSettings.guestEmail
                      ? <>Every event above is created with <strong>{syncSettings.guestEmail}</strong> as a guest, and Google emails them the invite. While someone’s invited, events are titled “<strong>Prep Day · 🏋️ Push</strong>” so the invitation email says where it came from. Clear the box to stop inviting them — existing events drop them and go back to the short title on the next sync.</>
                      : 'Optional. Add someone here and every workout, sauna and cooking event gets created with them as a guest — Google emails them the invite, and those events get titled “Prep Day · …” so the invitation says where it came from. Leave empty to invite nobody.'}
                </div>
                {/* One line per workout category — now that the three can be
                    timed apart, a single example day wouldn't show the split. */}
                <div className={styles.syncGearPreview}>
                  {WORKOUT_KINDS.map(wk => {
                    const wkMeta = SYNC_KINDS.find(k => k.key === wk);
                    return (
                      <div key={wk} className={styles.syncGearPreviewRow}>
                        <span className={styles.syncGearPreviewLabel}>{wkMeta.label} day</span>
                        {previewOrder(syncSettings, wk).map(p => {
                          const meta = SYNC_KINDS.find(k => k.key === p.key);
                          return `${meta.icon} ${minToHHMM(p.startMin)}–${minToHHMM(p.endMin)}`;
                        }).join(' · ')}
                      </div>
                    );
                  })}
                </div>
                <div className={styles.syncGearNote}>
                  Each workout uses its category’s time — a type counts as Weights, Cardio or Yoga based
                  on how it’s categorized on the Workout page. Sauna is suggested on your planned workout
                  days, spread across the week until it hits your goal, with ones you’ve already logged
                  counting toward it; click a 🧖 chip on the grid to pin or remove a day. Cooking uses the
                  days you’re cooking on the Prepare grid. A kind chained to something that isn’t on that
                  day falls back to its own time.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className={styles.goalsSidebar}>
        <div className={styles.goalsBlock}>
          <h2 className={styles.goalsHeading}>Week goals · workouts</h2>
          <div className={styles.workoutGoalsRow}>
            {WORKOUT_CATS.map(c => {
              const goal = workoutGoals[c.key] || 0;
              const got = weekTally[c.key] || 0;
              const met = goal > 0 && got >= goal;
              return (
                <span key={c.key} className={`${styles.wGoal}${met ? ` ${styles.wGoalMet}` : ''}`}>
                  <span className={styles.wGoalIcon}>{c.icon}</span>
                  <span className={styles.wGoalLabel}>{c.label}</span>
                  <span className={styles.wGoalCount}>{got}{goal > 0 ? `/${goal}` : ''}</span>
                  {met && <span className={styles.wGoalCheck}>✓</span>}
                </span>
              );
            })}
            {/* Sauna goal — counts saunas logged from the mobile app's 🧖 toggle,
                and notes how many more are suggested on upcoming workout days. */}
            {(() => {
              const met = weekSaunas >= saunaGoal;
              const planned = suggestedSaunaDates.size;
              const title = met
                ? `Goal met — ${weekSaunas} sauna${weekSaunas === 1 ? '' : 's'} logged this week`
                : `${weekSaunas} logged this week${planned ? `, ${planned} more suggested on upcoming workout days` : ''}. Set the goal in the ⚙ next to the calendar sync.`;
              return (
                <span title={title} className={`${styles.wGoal}${met ? ` ${styles.wGoalMet}` : ''}`}>
                  <span className={styles.wGoalIcon}>🧖</span>
                  <span className={styles.wGoalLabel}>Sauna</span>
                  <span className={styles.wGoalCount}>{weekSaunas}/{saunaGoal}</span>
                  {met ? <span className={styles.wGoalCheck}>✓</span>
                    : planned > 0 && <span className={styles.wGoalPlanned}>+{planned}</span>}
                </span>
              );
            })()}
          </div>
        </div>
        <div className={styles.goalsBlock}>
          <h2 className={styles.goalsHeading}>Week goals · meals</h2>
          <div className={styles.workoutGoalsRow}>
            {(() => {
              const { pct, ateOut } = mealStats;
              const met = pct >= mealsTrackedGoal;
              const trackedTitle = `${pct}% of this week's meals tracked (breakfast, lunch & dinner across all 7 days, logged or marked skipped; goal ${mealsTrackedGoal}%). Edit the goal on the “% of Meals Tracked” chart below.`;
              return (
                <>
                  <span title={trackedTitle} className={`${styles.wGoal}${met ? ` ${styles.wGoalMet}` : ''}`}>
                    <span className={styles.wGoalIcon}>🍽️</span>
                    <span className={styles.wGoalLabel}>Tracked</span>
                    <span className={styles.wGoalCount}>{pct}%/{mealsTrackedGoal}%</span>
                    {met && <span className={styles.wGoalCheck}>✓</span>}
                  </span>
                  <span
                    title={`${ateOut} meal${ateOut === 1 ? '' : 's'} eaten out this week`}
                    className={styles.wGoal}
                  >
                    <span className={styles.wGoalIcon}>🍔</span>
                    <span className={styles.wGoalLabel}>Ate out</span>
                    <span className={styles.wGoalCount}>{ateOut}</span>
                  </span>
                  {PRODUCE_TILES.map(t => {
                    const total = produceStats[t.key];
                    const goal = produceGoals[t.key];
                    const met = goal > 0 && total >= goal;
                    return (
                      <span
                        key={t.key}
                        title={`${fmtServings(total)} ${t.noun} serving${total === 1 ? '' : 's'} logged this week`
                          + ` (goal ${fmtServings(goal)} — ${fmtServings(goal / days.length)}/day × ${days.length} days).`
                          + ' Edit the daily goal on the Nutrition Goals page.'}
                        className={`${styles.wGoal}${met ? ` ${styles.wGoalMet}` : ''}`}
                      >
                        <span className={styles.wGoalIcon}>{t.icon}</span>
                        <span className={styles.wGoalLabel}>{t.label}</span>
                        <span className={styles.wGoalCount}>{fmtServings(total)}/{fmtServings(goal)}</span>
                        {met && <span className={styles.wGoalCheck}>✓</span>}
                      </span>
                    );
                  })}
                </>
              );
            })()}
          </div>
        </div>
        <GoalsHistory
          weekStart={weekStart}
          workoutsByDate={workoutsByDate}
          saunaDates={saunaDates}
          dailyLog={dailyLog}
          todayKey={todayKey}
          workoutGoals={workoutGoals}
          saunaGoal={saunaGoal}
          mealsTrackedGoal={mealsTrackedGoal}
          produceGoalsPerDay={produceGoalsPerDay}
        />
        <DailySupplementsPanel
          date={todayKey}
          supplements={todaySupplements}
          onChange={handleSupplementsChange}
        />
      </aside>
      </div>

      {/* Meal insights, moved here from the Track Meals page (below its Food Log). */}
      <div className={styles.belowWeekPlan}>
        <div className={styles.threeColRow}>
          <MealsTrackedChart dailyLog={dailyLog} />
          <HistoryChart dailyLog={dailyLog} user={user} />
          <ServingsChart dailyLog={dailyLog} />
        </div>
        <KpiAlerts
          dailyLog={dailyLog}
          recipes={recipes}
          onImportRecipe={onImportRecipe}
          cacheVersion={0}
          onViewRecipe={onViewRecipe}
          selectedDate={isoDate(new Date())}
          user={user}
        />
      </div>

    </div>
  );
}
