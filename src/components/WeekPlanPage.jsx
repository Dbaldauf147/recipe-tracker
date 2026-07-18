import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
} from '../utils/calendarSyncSettings';
import {
  DEFAULT_SAUNA_GOAL, MAX_SAUNA_GOAL, normalizeSaunaGoal, normalizeSaunaOverrides,
  pruneSaunaOverrides, resolveSaunaDates, spreadIndices,
} from '../utils/saunaPlan';
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

function loadWorkoutGoals() {
  try {
    const r = JSON.parse(localStorage.getItem('sunday-workout-weekly-goals'));
    if (r && typeof r === 'object') return { ...DEFAULT_WORKOUT_GOALS, ...r };
  } catch { /* ignore */ }
  return DEFAULT_WORKOUT_GOALS;
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

// Build the full Sun..Sat (0..6) plan from the staleness ranking + the user's
// per-day overrides. Most-overdue types fill the earliest auto days; exactly 2
// rest days total, spread out; no type repeats in a week. Returns
// { [idx]: { value, isAuto } } where value is a workout type or 'rest'.
// `recordedIdxs` = day indices that already have a logged workout — these are
// active days (the recorded workout is shown there), so they're skipped when
// placing suggestions. Otherwise the most-overdue type gets assigned to a day
// you already trained (e.g. Sunday) and is hidden behind the recorded workout.
function resolveWorkoutPlan(rankedTypes, overrides, workoutTypes, recordedIdxs = new Set(), recordedTypes = new Set()) {
  const validTypes = new Set(workoutTypes);
  const fixed = {};
  for (const [k, v] of Object.entries(overrides || {})) {
    if (v === 'rest' || validTypes.has(v)) fixed[Number(k)] = v; // ignore stale values
  }
  const out = {};
  for (let i = 0; i < 7; i++) if (fixed[i] != null) out[i] = { value: fixed[i], isAuto: false };

  const restInFixed = Object.values(fixed).filter(v => v === 'rest').length;
  const restNeeded = Math.max(0, 2 - restInFixed);
  const usedTypes = new Set(Object.values(fixed).filter(v => v !== 'rest'));
  // Drop types already trained this week from the suggestion pool — a freshly
  // logged type isn't overdue, so don't re-suggest it later in the same week.
  const available = rankedTypes.filter(t => !usedTypes.has(t) && !recordedTypes.has(t));

  const autoSlots = [];
  for (let i = 0; i < 7; i++) if (fixed[i] == null && !recordedIdxs.has(i)) autoSlots.push(i);

  const restPos = spreadIndices(autoSlots.length, restNeeded);
  let ti = 0;
  autoSlots.forEach((slot, pos) => {
    if (restPos.has(pos) || ti >= available.length) {
      out[slot] = { value: 'rest', isAuto: true };
    } else {
      out[slot] = { value: available[ti++], isAuto: true };
    }
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
function buildWorkoutsByDate(workouts, typeCategories) {
  const m = new Map();
  for (const w of workouts || []) {
    if (!w?.date) continue;
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
  // Weekly sauna goal + the user's per-day pin/veto decisions (user doc:
  // `saunaGoal` / `saunaOverrides`). Hydrated below; both feed resolveSaunaDates.
  const [saunaGoal, setSaunaGoal] = useState(DEFAULT_SAUNA_GOAL);
  const [saunaOverrides, setSaunaOverrides] = useState({});

  const todayKey = isoDate(new Date());
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekStart, i))),
    [weekStart]
  );

  // Logged workouts grouped by date, categorized exactly like the Workout
  // calendar (so the Week Plan shows recorded days the same way).
  const workoutsByDate = useMemo(
    () => buildWorkoutsByDate(workoutsRaw, typeCategories),
    [workoutsRaw, typeCategories]
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
  const { recordedWeekIdxs, recordedWeekTypes } = useMemo(() => {
    const idxs = new Set();
    const types = new Set();
    const today = new Date();
    const sunday = addDays(today, -today.getDay()); // back up to Sunday
    for (let i = 0; i < 7; i++) {
      const items = workoutsByDate.get(isoDate(addDays(sunday, i))) || [];
      if (items.length) {
        idxs.add(i);
        for (const it of items) if (it.label) types.add(it.label);
      }
    }
    return { recordedWeekIdxs: idxs, recordedWeekTypes: types };
  }, [workoutsByDate]);
  const resolvedWorkoutPlan = useMemo(
    () => resolveWorkoutPlan(rankedTypes, weekWorkoutPlan, workoutTypes, recordedWeekIdxs, recordedWeekTypes),
    [rankedTypes, weekWorkoutPlan, workoutTypes, recordedWeekIdxs, recordedWeekTypes]
  );

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
    // A past day with no recorded workout + an auto (non-manual) plan means the
    // suggested workout never actually happened — show it as a Rest day instead
    // of a misleading "Cardio · auto". Manual plans are left as the user set them.
    if (dateStr < isoDate(new Date()) && cell.isAuto && cell.value !== 'rest') {
      cell = { value: 'rest', isAuto: true };
    }
    const isRest = cell.value === 'rest';
    const iconCat = isRest ? 'rest' : (typeCategories[cell.value] || 'weights');
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
  }, [workoutsByDate, renderSaunaChip, resolvedWorkoutPlan, typeCategories, workoutTypes, setWorkoutCategory, onOpenWorkout]);

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
    return () => {
      window.removeEventListener('firestore-sync', refresh);
      window.removeEventListener('storage', refresh);
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

  // Hydrate the calendar-sync fields from the user doc. Kept next to their state
  // so the setters aren't referenced above their declaration.
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    loadField(user.uid, 'googleCalendarAutoSync').then(v => { if (!cancelled) setAutoSyncWorkouts(v === true); }).catch(() => {});
    loadField(user.uid, 'googleWorkoutCalendarId').then(v => { if (!cancelled && typeof v === 'string') setWorkoutCalId(v); }).catch(() => {});
    loadField(user.uid, 'calendarSyncSettings').then(v => {
      if (!cancelled && v && typeof v === 'object') setSyncSettings(normalizeCalendarSyncSettings(v));
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
  const weekTally = useMemo(() => {
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
  }, [days, workoutsByDate, todayKey]);

  // Sauna sessions this week = distinct days in the visible week that have at
  // least one workout with `sauna: true` (logged from the mobile app).
  const weekSaunas = useMemo(() => {
    const inWeek = new Set(days);
    const saunaDays = new Set();
    for (const w of workoutsRaw || []) {
      if (w?.sauna && w.date && inWeek.has(w.date)) saunaDays.add(w.date);
    }
    return saunaDays.size;
  }, [workoutsRaw, days]);

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
