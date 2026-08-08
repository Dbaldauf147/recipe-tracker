import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lastCompleteWeek, previousWeek, summarizeWeek, isEmptyWeek, renderWeeklySummary,
} from '../../lib/weeklySummary.js';

// The weekly progress email (api/send-weekly-summary.js). Lives in lib/ with
// the other email renderers; tested from here because `npm test` only globs
// src/**/*.test.js.
//
// The window math is the part worth pinning down: pick the wrong week and every
// number in the email is right for the wrong seven days, with nothing to hint
// at it. The rest of these cover the tallies that mirror the app's own pages.

test('lastCompleteWeek is the finished Sun–Sat week, on every weekday', () => {
  // 2026-08-02 is a Sunday; the week that just ended is Jul 26 – Aug 1.
  for (const day of ['2026-08-02', '2026-08-03', '2026-08-05', '2026-08-08']) {
    const w = lastCompleteWeek(day);
    assert.equal(w.start, '2026-07-26', day);
    assert.equal(w.end, '2026-08-01', day);
    assert.equal(w.days.length, 7);
  }
  // The next Sunday rolls forward a whole week — never a partial one.
  assert.equal(lastCompleteWeek('2026-08-09').start, '2026-08-02');
  // Saturday still reports the week BEFORE the one it sits in: today isn't over.
  assert.equal(lastCompleteWeek('2026-08-08').end, '2026-08-01');
});

test('previousWeek is the seven days before the window', () => {
  const w = lastCompleteWeek('2026-08-02');
  const p = previousWeek(w);
  assert.equal(p.start, '2026-07-19');
  assert.equal(p.end, '2026-07-25');
});

test('the window crosses a month and a year boundary cleanly', () => {
  const w = lastCompleteWeek('2026-01-03'); // Saturday
  assert.equal(w.start, '2025-12-21');
  assert.equal(w.end, '2025-12-27');
  assert.equal(w.label, 'Dec 21 – Dec 27, 2025');
});

const WEEK = lastCompleteWeek('2026-08-02'); // Jul 26 – Aug 1

function emptyData(over = {}) {
  return { dailyLog: {}, weightLog: [], workouts: [], habits: [], habitLog: {}, ...over };
}

test('meals-tracked % counts skipped and eating-out slots, like the Week Plan tile', () => {
  const dailyLog = {
    [WEEK.days[0]]: { entries: [{ mealSlot: 'breakfast' }, { mealSlot: 'dinner' }] },
    [WEEK.days[1]]: { skippedMeals: ['breakfast'], eatingOutMeals: ['dinner'], entries: [{ mealSlot: 'lunch' }] },
    [WEEK.days[2]]: { daySkipped: true, entries: [] },
  };
  const s = summarizeWeek(emptyData({ dailyLog }), WEEK);
  // 2 + 3 (all three accounted) + 3 (skipped day) = 8 of 21 slots.
  assert.equal(s.meals.trackedSlots, 8);
  assert.equal(s.meals.pct, Math.round((8 / 21) * 100));
  assert.equal(s.meals.ateOut, 1);
  assert.equal(s.meals.daysWithMeals, 2);
});

test('macro averages are per day WITH nutrition, not per calendar day', () => {
  const dailyLog = {
    [WEEK.days[0]]: { entries: [{ mealSlot: 'lunch', nutrition: { calories: 800, protein: 50 } }] },
    [WEEK.days[1]]: { entries: [{ mealSlot: 'lunch', nutrition: { calories: 1200, protein: 90 } }] },
    [WEEK.days[2]]: { entries: [{ mealSlot: 'lunch' }] }, // logged, but no nutrition data
  };
  const s = summarizeWeek(emptyData({ dailyLog }), WEEK);
  assert.equal(s.meals.macroDays, 2);
  assert.equal(s.meals.avg.calories, 1000);
  assert.equal(s.meals.avg.protein, 70);
});

test('weight reports first/last inside the window only', () => {
  const weightLog = [
    { date: '2026-07-20', weight: 190 },  // prior week — must not leak in
    { date: WEEK.days[1], weight: 186 },
    { date: WEEK.days[5], weight: 184 },
    { date: '2026-08-04', weight: 180 },  // after the window
  ];
  const s = summarizeWeek(emptyData({ weightLog }), WEEK);
  assert.equal(s.weight.count, 2);
  assert.equal(s.weight.first, 186);
  assert.equal(s.weight.last, 184);
  assert.equal(s.weight.change, -2);
});

test('workout volume honours per-set weights and per-arm loads', () => {
  const workouts = [
    {
      id: 'a', date: WEEK.days[1], entries: [
        { exercise: 'Row', sets: ['10', '10'], weight: '50', perArm: true },             // 100 × 20 reps
        { exercise: 'Curl', sets: ['8', '6'], useSetWeights: true, setWeights: ['30', '35'] }, // 240 + 210
        { exercise: 'Plank', sets: ['60s'] },                                             // time, no volume
      ],
    },
    { id: 'b', date: '2026-08-04', entries: [{ exercise: 'Row', sets: ['10'], weight: '50' }] }, // outside
  ];
  const s = summarizeWeek(emptyData({ workouts }), WEEK);
  assert.equal(s.workouts.sessions, 1);
  assert.equal(s.workouts.sets, 5);
  assert.equal(s.workouts.volume, 2000 + 450);
  assert.equal(s.workouts.minutes, 1);
  assert.equal(s.workouts.top[0].name, 'Row');
});

test('habit tallies respect trackDays, parked statuses and the weekly bucket', () => {
  const habits = [
    { id: 'daily', name: 'Read', cadence: 'Daily' },
    { id: 'weekdays', name: 'Floss', cadence: 'Daily', trackDays: [1, 2, 3, 4, 5] },
    { id: 'weekly', name: 'Meal prep', cadence: 'Weekly' },
    { id: 'parked', name: 'Old thing', cadence: 'Daily', status: 'On Hold' },
    { id: 'monthly', name: 'Budget', cadence: 'Monthly' },
  ];
  const habitLog = {};
  WEEK.days.forEach((d, i) => { habitLog[d] = { daily: i < 6 ? 'done' : 'missed' }; });
  habitLog[WEEK.days[1]].weekdays = 'skipped';
  habitLog['2026-W31'] = { weekly: 'exceeded' }; // Sunday-anchored key for Jul 26

  const s = summarizeWeek(emptyData({ habits, habitLog }), WEEK);
  // 7 daily + 5 weekday + 1 weekly. Parked and monthly are not scored.
  assert.equal(s.habits.due, 13);
  assert.equal(s.habits.trackedHabits, 3);
  assert.equal(s.habits.done, 6);
  assert.equal(s.habits.exceeded, 1);
  assert.equal(s.habits.missed, 1);
  assert.equal(s.habits.skipped, 1);
  assert.equal(s.habits.unlogged, 4); // Floss: 4 untouched weekdays
  // A skip is excluded from the denominator, not counted as a failure.
  assert.equal(s.habits.rate, Math.round((7 / 12) * 100));
  assert.deepEqual(s.habits.perfect, ['Meal prep']);
});

test('isEmptyWeek only fires when literally nothing was recorded', () => {
  assert.equal(isEmptyWeek(summarizeWeek(emptyData(), WEEK)), true);
  const oneWeighIn = emptyData({ weightLog: [{ date: WEEK.days[0], weight: 180 }] });
  assert.equal(isEmptyWeek(summarizeWeek(oneWeighIn, WEEK)), false);
});

test('renderWeeklySummary survives a week with no data at all', () => {
  const stats = summarizeWeek(emptyData(), WEEK);
  const prior = summarizeWeek(emptyData(), previousWeek(WEEK));
  const { subject, text, html } = renderWeeklySummary({ stats, priorStats: prior });
  assert.match(subject, /Jul 26 – Aug 1, 2026/);
  assert.match(text, /No weigh-ins logged this week/);
  assert.match(html, /Your Prep Day week/);
  assert.doesNotMatch(text, /NaN|undefined/);
});

// ---- Week goals table ------------------------------------------------------
// These mirror the Week Plan sidebar's goal tiles. The tally is the fiddly
// half: which logged records count as a workout DAY, and which are excluded.

const GOALS_CONFIG = {
  workoutWeeklyGoals: { weights: 3, cardio: 1, yoga: 1, rest: 2 },
  workoutTypeCategories: { Push: 'weights', Pull: 'weights' },
  saunaGoal: 3,
  nutritionGoals: { dailyMealsTrackedPct: 80, vegServings: 5, fruitServings: 4 },
};

function goalsFor(data, config = GOALS_CONFIG) {
  return summarizeWeek({ ...emptyData(), ...data }, WEEK, { goalsConfig: config }).weekGoals;
}

function goalNamed(weekGoals, label) {
  return weekGoals.rows.find(r => r.label === label);
}

test('workout day tally excludes stretch sessions and sauna-only records', () => {
  const workouts = [
    { id: '1', date: WEEK.days[1], workoutType: 'Push', entries: [{ exercise: 'Bench', sets: ['8'] }] },
    { id: '2', date: WEEK.days[3], workoutType: 'Running', entries: [{ exercise: 'Run', sets: ['30m'] }] },
    { id: '3', date: WEEK.days[5], workoutType: 'Vinyasa', entries: [{ exercise: 'Flow', sets: ['45m'] }] },
    // A logged stretch routine is not a workout day — the day stays "rest".
    { id: '4', date: WEEK.days[2], source: 'stretch', entries: [{ exercise: 'Hamstring', sets: ['60s'] }] },
    // Sauna-only placeholder: no type, no entries. Counts for sauna, not weights.
    { id: '5', date: WEEK.days[4], sauna: true },
  ];
  const g = goalsFor({ workouts });
  assert.equal(goalNamed(g, 'Weights').actual, 1);
  assert.equal(goalNamed(g, 'Cardio').actual, 1);   // "Running" → cardio by keyword
  assert.equal(goalNamed(g, 'Yoga').actual, 1);     // "Vinyasa" → yoga by keyword
  assert.equal(goalNamed(g, 'Rest').actual, 4);     // days 0, 2, 4, 6
  assert.equal(goalNamed(g, 'Sauna').actual, 1);
});

test('an explicit type category beats the keyword guess', () => {
  // "Pull" matches no keyword and would default to weights anyway; "Recovery
  // Walk" would be guessed as cardio, but the user filed it under yoga.
  const workouts = [
    { id: '1', date: WEEK.days[1], workoutType: 'Recovery Walk', entries: [{ exercise: 'Walk', sets: ['20m'] }] },
  ];
  assert.equal(goalNamed(goalsFor({ workouts }), 'Cardio').actual, 1);
  const tagged = goalsFor({ workouts }, { ...GOALS_CONFIG, workoutTypeCategories: { 'Recovery Walk': 'yoga' } });
  assert.equal(goalNamed(tagged, 'Cardio').actual, 0);
  assert.equal(goalNamed(tagged, 'Yoga').actual, 1);
});

test('goals with no target set are left out of the table', () => {
  const g = goalsFor({}, {
    workoutWeeklyGoals: { weights: 2, cardio: 0, yoga: 0, rest: 0 },
    saunaGoal: 0,
    nutritionGoals: { dailyMealsTrackedPct: 50, vegServings: 0, fruitServings: 0 },
  });
  // A 0 goal is "not set" — a row reading 0/0 ✓ would claim unearned credit.
  assert.deepEqual(g.rows.map(r => r.label), ['Weights', 'Meals tracked']);
  assert.equal(g.total, 2);
});

test('produce goals scale the daily target across the week', () => {
  const g = goalsFor({});
  assert.equal(goalNamed(g, 'Veg').target, 35);   // 5/day × 7
  assert.equal(goalNamed(g, 'Fruit').target, 28); // 4/day × 7
});

test('met is inclusive, and overshooting still reads as met', () => {
  const workouts = [0, 1, 2, 3].map((i, n) => ({
    id: `w${n}`, date: WEEK.days[i], workoutType: 'Push', entries: [{ exercise: 'Bench', sets: ['5'] }],
  }));
  const g = goalsFor({ workouts });
  assert.equal(goalNamed(g, 'Weights').actual, 4);
  assert.equal(goalNamed(g, 'Weights').met, true);
});

test('the email omits the goals section entirely when nothing is configured', () => {
  const stats = summarizeWeek(emptyData(), WEEK);            // no goalsConfig
  const prior = summarizeWeek(emptyData(), previousWeek(WEEK));
  const { html, text } = renderWeeklySummary({ stats, priorStats: prior });
  assert.equal(stats.weekGoals, null);
  assert.doesNotMatch(html, /Week goals/);
  assert.doesNotMatch(text, /WEEK GOALS/);
});

test('the goals table renders bars, values and a met count', () => {
  const workouts = [{ id: '1', date: WEEK.days[1], workoutType: 'Push', entries: [{ exercise: 'Bench', sets: ['8'] }] }];
  const stats = summarizeWeek({ ...emptyData(), workouts }, WEEK, { goalsConfig: GOALS_CONFIG });
  const prior = summarizeWeek(emptyData(), previousWeek(WEEK));
  const { html, text } = renderWeeklySummary({ stats, priorStats: prior });
  assert.match(html, /Week goals/);
  assert.match(html, /of \d+<\/strong> goals met/);
  assert.match(html, /1 \/ 3 days/);
  assert.match(text, /WEEK GOALS — \d+ of \d+ met/);
  assert.doesNotMatch(html, /NaN|undefined/);
  // Singular unit when the target is 1.
  assert.match(html, /0 \/ 1 day</);
});
