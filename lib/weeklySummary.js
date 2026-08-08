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

const MAIN_MEALS = ['breakfast', 'lunch', 'dinner'];
const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat'];
const LB_PER_KG = 2.2046226218;
const APP_URL = 'https://prep-day.com';
const ACCENT = '#c96442';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
export function summarizeWeek(data, week) {
  return {
    week,
    meals: summarizeMeals(data.dailyLog, week.days),
    weight: summarizeWeight(data.weightLog, week.days),
    workouts: summarizeWorkouts(data.workouts, week.days),
    habits: summarizeHabits(data.habits, data.habitLog, week.days),
  };
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

function signed(n, digits = 0, suffix = '') {
  const r = round(n, digits);
  if (r == null) return null;
  if (r === 0) return `no change`;
  return `${r > 0 ? '+' : '−'}${fmtNum(Math.abs(r), digits)}${suffix}`;
}

/**
 * "vs last week" chip. `goodDirection` decides the colour: 'up', 'down', or
 * 'neutral' when better/worse isn't a judgement the app should make (weight,
 * where the goal may be either way).
 */
function deltaChip(now, before, { digits = 0, suffix = '', goodDirection = 'up' } = {}) {
  if (now == null || before == null || !Number.isFinite(now) || !Number.isFinite(before)) return '';
  const diff = now - before;
  const label = signed(diff, digits, suffix);
  if (!label) return '';
  let color = '#6b7280';
  if (diff !== 0 && goodDirection !== 'neutral') {
    const good = goodDirection === 'up' ? diff > 0 : diff < 0;
    color = good ? '#16a34a' : '#dc2626';
  }
  return `<span style="color:${color};font-size:11px;white-space:nowrap;">${escapeHtml(label)} vs prior week</span>`;
}

function deltaText(now, before, { digits = 0, suffix = '' } = {}) {
  if (now == null || before == null || !Number.isFinite(now) || !Number.isFinite(before)) return '';
  const label = signed(now - before, digits, suffix);
  return label ? ` (${label} vs prior week)` : '';
}

function tile({ label, value, sub, delta }) {
  return `<td style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;vertical-align:top;width:25%;">`
    + `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;font-weight:600;">${escapeHtml(label)}</div>`
    + `<div style="font-size:22px;font-weight:700;color:#111827;line-height:1.2;margin-top:2px;">${value}</div>`
    + (sub ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">${sub}</div>` : '')
    + (delta ? `<div style="margin-top:4px;">${delta}</div>` : '')
    + `</td>`;
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

function goalPct(value, goal) {
  if (value == null || !goal || goal <= 0) return '';
  return ` <span style="color:#6b7280;">(${Math.round((value / goal) * 100)}% of goal)</span>`;
}

/**
 * Build the weekly progress email.
 *
 * @param {object} opts
 * @param {object} opts.stats       summarizeWeek() for the reported week
 * @param {object} opts.priorStats  summarizeWeek() for the week before
 * @param {object} [opts.goals]     nutritionGoals (daily targets)
 * @param {object} [opts.bodyStats] for goalWeight
 * @param {string} [opts.weightUnit] 'lb' | 'kg' — workout volume display unit
 * @param {string} [opts.name]      display name for the greeting
 */
export function renderWeeklySummary({ stats, priorStats, goals = null, bodyStats = null, weightUnit = 'lb', name = '' }) {
  const s = stats;
  const p = priorStats;
  const g = goals || {};
  const kg = weightUnit === 'kg';
  const volNow = kg ? s.workouts.volume / LB_PER_KG : s.workouts.volume;
  const volPrior = kg ? p.workouts.volume / LB_PER_KG : p.workouts.volume;
  const mealsGoal = (() => {
    const v = g.dailyMealsTrackedPct;
    return v == null || isNaN(Number(v)) ? 50 : Math.max(0, Math.min(100, Number(v)));
  })();
  const goalWeight = Number(bodyStats?.goalWeight);

  const subject = `Prep Day — your week: ${s.week.label}`;
  const greeting = name ? `Here's how ${escapeHtml(name.split(' ')[0])}'s week went.` : `Here's how your week went.`;

  // ── tiles ──
  const tiles = [
    tile({
      label: 'Meals tracked',
      value: `${s.meals.pct}%`,
      sub: `${s.meals.trackedSlots}/${s.meals.totalSlots} slots · goal ${mealsGoal}%`,
      delta: deltaChip(s.meals.pct, p.meals.pct, { suffix: '%' }),
    }),
    tile({
      label: 'Workouts',
      value: `${s.workouts.sessions}`,
      sub: s.workouts.sessions > 0 ? `${fmtNum(s.workouts.sets)} sets` : 'no sessions logged',
      delta: deltaChip(s.workouts.sessions, p.workouts.sessions),
    }),
    tile({
      label: 'Habits',
      value: s.habits.rate == null ? '—' : `${s.habits.rate}%`,
      sub: s.habits.due > 0 ? `${s.habits.hit}/${s.habits.due - s.habits.skipped} done` : 'nothing due',
      delta: deltaChip(s.habits.rate, p.habits.rate, { suffix: '%' }),
    }),
    tile({
      label: 'Weight',
      value: s.weight.last == null ? '—' : `${fmtNum(s.weight.last, 1)}`,
      sub: s.weight.count > 0
        ? `${s.weight.count} weigh-in${s.weight.count === 1 ? '' : 's'} · lbs`
        : 'no weigh-ins',
      delta: deltaChip(s.weight.last, p.weight.last, { digits: 1, suffix: ' lbs', goodDirection: 'neutral' }),
    }),
  ].join('');

  // ── nutrition ──
  const nutritionRows = [
    row('Days with meals', `${s.meals.daysWithMeals}/7${deltaText(s.meals.daysWithMeals, p.meals.daysWithMeals)}`),
    row('Meals logged', `${fmtNum(s.meals.entriesLogged)}${deltaText(s.meals.entriesLogged, p.meals.entriesLogged)}`),
  ];
  if (s.meals.macroDays > 0) {
    nutritionRows.push(row(
      'Avg per day',
      `${fmtNum(s.meals.avg.calories)} cal${goalPct(s.meals.avg.calories, g.calories)}`
      + ` · ${fmtNum(s.meals.avg.protein)}g protein${goalPct(s.meals.avg.protein, g.protein)}`
      + ` · ${fmtNum(s.meals.avg.carbs)}g carbs · ${fmtNum(s.meals.avg.fat)}g fat`
      + `<div style="font-size:11px;color:#9ca3af;">across ${s.meals.macroDays} day${s.meals.macroDays === 1 ? '' : 's'} with nutrition data</div>`,
    ));
  }
  nutritionRows.push(row(
    'Veg & fruit',
    `${fmtNum(s.meals.veg, 1)} veg${goalPct(s.meals.veg, (g.vegServings ?? 5) * 7)}`
    + ` · ${fmtNum(s.meals.fruit, 1)} fruit${goalPct(s.meals.fruit, (g.fruitServings ?? 4) * 7)}`,
  ));
  nutritionRows.push(row('Ate out', `${s.meals.ateOut} meal${s.meals.ateOut === 1 ? '' : 's'}${deltaText(s.meals.ateOut, p.meals.ateOut)}`));

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

  // ── workouts ──
  const workoutRows = [
    row('Sessions', `${s.workouts.sessions}${deltaText(s.workouts.sessions, p.workouts.sessions)}`),
    row('Sets', `${fmtNum(s.workouts.sets)}${deltaText(s.workouts.sets, p.workouts.sets)}`),
    row('Volume', `${fmtNum(volNow)} ${kg ? 'kg' : 'lbs'}${deltaText(volNow, volPrior)}`),
    row('Exercises', `${s.workouts.exercises}`),
  ];
  if (s.workouts.minutes > 0) workoutRows.push(row('Timed work', `${fmtNum(s.workouts.minutes)} min`));
  if (s.workouts.saunas > 0) workoutRows.push(row('Sauna', `${s.workouts.saunas} day${s.workouts.saunas === 1 ? '' : 's'}`));
  if (s.workouts.top.length > 0) {
    workoutRows.push(row(
      'Top volume',
      s.workouts.top
        .map(t => `${escapeHtml(t.name)} <span style="color:#9ca3af;">${fmtNum(kg ? t.volume / LB_PER_KG : t.volume)} ${kg ? 'kg' : 'lbs'}</span>`)
        .join('<br/>'),
    ));
  }

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

  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;max-width:720px;">`
    + `<h1 style="font-size:20px;font-weight:700;margin:0 0 2px 0;">Your Prep Day week</h1>`
    + `<p style="font-size:13px;color:#6b7280;margin:0 0 14px 0;">${escapeHtml(s.week.label)} — ${greeting}</p>`
    + `<table role="presentation" cellspacing="8" cellpadding="0" border="0" style="border-collapse:separate;width:100%;table-layout:fixed;margin-left:-8px;"><tr>${tiles}</tr></table>`
    + sectionHeading('Meals & nutrition') + table(nutritionRows)
    + sectionHeading('Weight') + table(weightRows)
    + sectionHeading('Workouts') + table(workoutRows)
    + sectionHeading('Habits') + table(habitRows)
    + `<p style="margin:24px 0 0 0;"><a href="${APP_URL}" style="background:${ACCENT};color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;display:inline-block;">Open Prep Day</a></p>`
    + `<p style="color:#9ca3af;font-size:12px;margin-top:24px;">Sent weekly from Prep Day. Turn this off in Account Settings → Email Reminders.</p>`
    + `</div>`;

  // ── plain-text twin ──
  const t = [];
  t.push(`Your Prep Day week — ${s.week.label}`);
  t.push('');
  t.push(`Meals tracked: ${s.meals.pct}% (${s.meals.trackedSlots}/${s.meals.totalSlots} slots, goal ${mealsGoal}%)${deltaText(s.meals.pct, p.meals.pct, { suffix: '%' })}`);
  t.push(`Workouts: ${s.workouts.sessions} session${s.workouts.sessions === 1 ? '' : 's'}, ${fmtNum(s.workouts.sets)} sets${deltaText(s.workouts.sessions, p.workouts.sessions)}`);
  t.push(`Habits: ${s.habits.rate == null ? 'nothing due' : `${s.habits.rate}% (${s.habits.hit}/${s.habits.due - s.habits.skipped})`}${deltaText(s.habits.rate, p.habits.rate, { suffix: '%' })}`);
  t.push(`Weight: ${s.weight.last == null ? 'no weigh-ins' : `${fmtNum(s.weight.last, 1)} lbs${deltaText(s.weight.last, p.weight.last, { digits: 1, suffix: ' lbs' })}`}`);
  t.push('');
  t.push('MEALS & NUTRITION');
  t.push(`  Days with meals: ${s.meals.daysWithMeals}/7`);
  t.push(`  Meals logged: ${s.meals.entriesLogged}`);
  if (s.meals.macroDays > 0) {
    t.push(`  Avg per day: ${fmtNum(s.meals.avg.calories)} cal / ${fmtNum(s.meals.avg.protein)}p / ${fmtNum(s.meals.avg.carbs)}c / ${fmtNum(s.meals.avg.fat)}f (over ${s.meals.macroDays} day${s.meals.macroDays === 1 ? '' : 's'})`);
  }
  t.push(`  Veg & fruit: ${fmtNum(s.meals.veg, 1)} veg / ${fmtNum(s.meals.fruit, 1)} fruit`);
  t.push(`  Ate out: ${s.meals.ateOut}`);
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
  t.push('');
  t.push('WORKOUTS');
  t.push(`  Sessions: ${s.workouts.sessions} · Sets: ${fmtNum(s.workouts.sets)} · Volume: ${fmtNum(volNow)} ${kg ? 'kg' : 'lbs'}`);
  if (s.workouts.saunas > 0) t.push(`  Sauna: ${s.workouts.saunas} day${s.workouts.saunas === 1 ? '' : 's'}`);
  for (const top of s.workouts.top) {
    t.push(`  Top volume: ${top.name} — ${fmtNum(kg ? top.volume / LB_PER_KG : top.volume)} ${kg ? 'kg' : 'lbs'}`);
  }
  t.push('');
  t.push('HABITS');
  if (s.habits.due > 0) {
    t.push(`  Completion: ${s.habits.rate}% (${s.habits.hit}/${s.habits.due - s.habits.skipped})`);
    t.push(`  ★ ${s.habits.exceeded} · ✓ ${s.habits.done} · ⏭ ${s.habits.skipped} · ✕ ${s.habits.missed}${s.habits.unlogged > 0 ? ` · ${s.habits.unlogged} never logged` : ''}`);
    if (s.habits.perfect.length > 0) t.push(`  Perfect week: ${s.habits.perfect.slice(0, 8).join(', ')}`);
    for (const h of s.habits.struggling) t.push(`  Needs attention: ${h.name} (${h.hit}/${h.due})`);
  } else {
    t.push('  Nothing was due this week.');
  }
  t.push('');
  t.push(`Open Prep Day: ${APP_URL}`);
  t.push('');
  t.push('— Prep Day');

  return { subject, text: t.join('\n'), html };
}
