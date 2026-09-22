import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lastCompleteWeek, previousWeek, summarizeWeek, isEmptyWeek, renderWeeklySummary, TREND_WEEKS,
} from '../../lib/weeklySummary.js';
import { DEFAULT_SAUNA_GOAL } from './saunaPlan.js';

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

test('weight history is eight weeks, oldest first, using each week\'s last weigh-in', () => {
  const prior = previousWeek(WEEK);
  const weightLog = [
    { date: WEEK.days[1], weight: 179 },
    { date: WEEK.days[5], weight: 178.4 },   // last of the week wins
    { date: prior.days[2], weight: 176.4 },
    { date: previousWeek(previousWeek(prior)).days[0], weight: 181 }, // 4th week back
    { date: '2026-08-04', weight: 170 },     // after the window
  ];
  const s = summarizeWeek(emptyData({ weightLog }), WEEK);
  const h = s.weight.history;
  assert.equal(h.length, 8);
  assert.equal(h[7].start, WEEK.start);
  assert.equal(h[7].label, 'Jul 26');
  assert.deepEqual(h.map(w => w.weight), [null, null, null, null, 181, null, 176.4, 178.4]);
});

test('the email draws the weight chart with the goal line, and skips it with no weigh-ins', () => {
  const weightLog = [
    { date: previousWeek(WEEK).days[3], weight: 176.4 },
    { date: WEEK.days[4], weight: 178.4 },
  ];
  const stats = summarizeWeek(emptyData({ weightLog }), WEEK);
  const prior = summarizeWeek(emptyData({ weightLog }), previousWeek(WEEK));
  const email = renderWeeklySummary({ stats, priorStats: prior, bodyStats: { goalWeight: 175 } });
  assert.match(email.html, /Weight · last 8 weeks · lbs/);
  assert.match(email.html, /dashed line is your 175\.0 lbs goal/);
  assert.match(email.html, /border-top:1px dashed #9ca3af/);
  assert.match(email.html, />178\.4</);
  assert.match(email.html, /Vs prior week/);                 // the table stays
  assert.match(email.text, /Last weigh-in each week, last 8 weeks/);

  const none = renderWeeklySummary({
    stats: summarizeWeek(emptyData(), WEEK),
    priorStats: summarizeWeek(emptyData(), previousWeek(WEEK)),
    bodyStats: { goalWeight: 175 },
  });
  assert.doesNotMatch(none.html, /Weight · last/);
  assert.doesNotMatch(none.text, /Last weigh-in each week/);
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

test('an absent sauna goal means the Week Plan default, not "no goal"', () => {
  // The ⚙ popup writes `saunaGoal` only once it's edited, so the field is
  // simply missing for anyone still on the default — which the Week Plan is
  // showing them as a goal of DEFAULT_SAUNA_GOAL, so the email owes them the
  // row. Absent and an explicit 0 are different answers.
  const unset = { ...GOALS_CONFIG };
  delete unset.saunaGoal;
  const g = goalsFor({ workouts: [{ id: '1', date: WEEK.days[2], sauna: true }] }, unset);
  assert.equal(goalNamed(g, 'Sauna').target, DEFAULT_SAUNA_GOAL);
  assert.equal(goalNamed(g, 'Sauna').actual, 1);
  assert.equal(goalNamed(goalsFor({}, { ...GOALS_CONFIG, saunaGoal: 0 }), 'Sauna'), undefined);
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

test('the workout totals block is gone — only the lifts that need a decision remain', () => {
  // Sessions / sets / volume / top volume were a scoreboard nobody acted on.
  // A week WITH workouts is used deliberately: an empty week would pass this
  // by rendering nothing at all.
  const workouts = [
    {
      date: WEEK.days[1], gym: 'Edge', sauna: true, entries: [
        { exercise: 'Row', sets: ['10', '10'], weight: '100' },
      ],
    },
  ];
  const stats = summarizeWeek(emptyData({ workouts }), WEEK);
  const prior = summarizeWeek(emptyData(), previousWeek(WEEK));
  const { html, text } = renderWeeklySummary({ stats, priorStats: prior });
  assert.ok(stats.workouts.sessions > 0, 'the week really does have a workout in it');
  assert.doesNotMatch(html, /Sessions/);
  assert.doesNotMatch(html, /Top volume/);
  assert.doesNotMatch(html, /Timed work/);
  assert.doesNotMatch(text, /WORKOUTS/);
  assert.doesNotMatch(text, /Top volume/);
});

test('the email opens on the goals table — the stat tiles are gone', () => {
  const stats = summarizeWeek(emptyData(), WEEK, { goalsConfig: GOALS_CONFIG });
  const prior = summarizeWeek(emptyData(), previousWeek(WEEK));
  const { html, text } = renderWeeklySummary({ stats, priorStats: prior });
  assert.doesNotMatch(html, /slots · goal/);       // meals tile subtitle
  assert.doesNotMatch(html, /weigh-in/);           // weight tile subtitle
  assert.doesNotMatch(html, /vs prior week<\/span>/); // the tiles' delta chips
  assert.doesNotMatch(text, /^Meals tracked:/m);
  assert.doesNotMatch(text, /^Habits: /m);
});

test('the goals table renders bars, values and a met count', () => {
  const workouts = [{ id: '1', date: WEEK.days[1], workoutType: 'Push', entries: [{ exercise: 'Bench', sets: ['8'] }] }];
  const stats = summarizeWeek({ ...emptyData(), workouts }, WEEK, { goalsConfig: GOALS_CONFIG });
  const prior = summarizeWeek(emptyData(), previousWeek(WEEK));
  const { html, text } = renderWeeklySummary({ stats, priorStats: prior });
  assert.match(html, /Week goals/);
  assert.match(html, /of \d+<\/strong> goals met/);
  // The unit sits outside the nowrap span so it can drop to a second line on a
  // narrow phone without splitting the "1 / 3" itself.
  assert.match(html, /1 \/ 3<\/span> days/);
  assert.match(text, /WEEK GOALS — \d+ of \d+ met/);
  assert.doesNotMatch(html, /NaN|undefined/);
  // Singular unit when the target is 1.
  assert.match(html, /0 \/ 1<\/span> day</);
});

// ──────────────────────────────────────────── rolling met-rate (10 weeks)

function weekBack(n) {
  let w = WEEK;
  for (let i = 0; i < n; i++) w = previousWeek(w);
  return w;
}

/** `weightsDays` weights sessions in the Nth week back, one per day. */
function weightsWeek(n, weightsDays) {
  const w = weekBack(n);
  return Array.from({ length: weightsDays }, (_, i) => ({
    id: `w${n}-${i}`, date: w.days[i], workoutType: 'Push', entries: [{ exercise: 'Bench', sets: ['8'] }],
  }));
}

test('the rolling met-rate spans the reported week and the nine before it', () => {
  // Weights goal is 3/week. Hit in the reported week and the two before it,
  // missed in the third — four weeks with anything logged in them at all.
  const workouts = [
    ...weightsWeek(0, 3), ...weightsWeek(1, 3), ...weightsWeek(2, 3), ...weightsWeek(3, 1),
  ];
  const g = goalsFor({ workouts });
  assert.deepEqual(goalNamed(g, 'Weights').trend, { met: 3, weeks: 4, pct: 75 });
  assert.equal(g.trendSpan, TREND_WEEKS);
  assert.equal(g.trendWeeks, 4);
  // This week's own Result column is untouched by the history beside it.
  assert.equal(goalNamed(g, 'Weights').met, true);
});

test('weeks with nothing logged are dropped from the rate, not counted as misses', () => {
  // Six of the ten weeks are blank. Counting them would report 3/10 = 30% for a
  // goal that was met every week it was actually tracked — and would score Rest
  // as met in each of them, since a week with no workouts is seven rest days.
  const workouts = [...weightsWeek(0, 3), ...weightsWeek(1, 3), ...weightsWeek(2, 3)];
  const g = goalsFor({ workouts });
  assert.deepEqual(goalNamed(g, 'Weights').trend, { met: 3, weeks: 3, pct: 100 });
  assert.deepEqual(goalNamed(g, 'Rest').trend, { met: 3, weeks: 3, pct: 100 });
  assert.equal(g.trendWeeks, 3);
});

test('a meal-only week still counts as logged', () => {
  // Activity is not just workouts: someone who logged meals but never trained
  // has a real week, and their workout goals genuinely went unmet in it.
  const older = weekBack(1);
  const g = goalsFor({
    workouts: weightsWeek(0, 3),
    dailyLog: { [older.days[2]]: { entries: [{ mealSlot: 'lunch' }] } },
  });
  assert.equal(g.trendWeeks, 2);
  assert.deepEqual(goalNamed(g, 'Weights').trend, { met: 1, weeks: 2, pct: 50 });
});

test('the first ever week reports 1 of 1, not a percentage of nothing', () => {
  const g = goalsFor({ workouts: weightsWeek(0, 3) });
  assert.deepEqual(goalNamed(g, 'Weights').trend, { met: 1, weeks: 1, pct: 100 });
  assert.deepEqual(goalNamed(g, 'Cardio').trend, { met: 0, weeks: 1, pct: 0 });
});

test('a user with no history at all gets no rate rather than 0%', () => {
  // Nothing logged anywhere means no week qualifies, so there is no denominator
  // to divide by. A row of 0% would read as ten weeks of failure.
  const g = goalsFor({});
  assert.equal(g.trendWeeks, 0);
  assert.equal(goalNamed(g, 'Weights').trend, null);
});

test('the goals table carries the rolling met-rate column', () => {
  const workouts = [...weightsWeek(0, 3), ...weightsWeek(1, 3), ...weightsWeek(2, 1), ...weightsWeek(3, 1)];
  const stats = summarizeWeek({ ...emptyData(), workouts }, WEEK, { goalsConfig: GOALS_CONFIG });
  const prior = summarizeWeek(emptyData(), previousWeek(WEEK));
  const { html, text } = renderWeeklySummary({ stats, priorStats: prior });
  assert.match(html, /10 wks/);
  assert.match(html, />50%<\/span><br><span[^>]*>2\/4</);  // Weights: met 2 of 4 logged weeks
  assert.match(html, /Last column: weeks this goal was met out of the 4 logged weeks/);
  assert.match(text, /10wk 50% \(2\/4\)/);
  assert.doesNotMatch(html, /NaN|undefined/);
  assert.doesNotMatch(text, /NaN|undefined/);
});

// ─────────────────────────────────────────────────────── stretch board

// A library that tags the stretches, so the board keys off the user's own
// exerciseType exactly as the Workout page does.
const STRETCH_LIB = [
  { exercise: 'Hamstring Stretch', muscleGroup: 'Legs', exerciseType: 'Stretching' },
  { exercise: 'Pigeon Pose', muscleGroup: 'Legs', exerciseType: 'Stretching' },
  { exercise: 'Doorway Chest Stretch', muscleGroup: 'Chest', exerciseType: 'Stretching' },
  { exercise: 'Plank', muscleGroup: 'Abs', exerciseType: 'Strength Training' },
];

function stretchData(workouts, over = {}) {
  return { ...emptyData({ workouts, exerciseLibrary: STRETCH_LIB }), ...over };
}

test('the stretch board covers the reported week, not a rolling window', () => {
  const workouts = [
    // Inside the week.
    { id: 'a', date: WEEK.days[2], entries: [{ exercise: 'Hamstring Stretch', group: 'Legs', totalSeconds: 600 }] },
    // The day after the week ended — the loader pulls these for the trend
    // analysis, and they must not leak into the board.
    { id: 'b', date: '2026-08-02', entries: [{ exercise: 'Doorway Chest Stretch', group: 'Chest', totalSeconds: 900 }] },
    // Before the week started.
    { id: 'c', date: '2026-07-25', entries: [{ exercise: 'Pigeon Pose', group: 'Legs', totalSeconds: 900 }] },
  ];
  const s = summarizeWeek(stretchData(workouts), WEEK);
  const byGroup = Object.fromEntries(s.stretch.rows.map(r => [r.group, r.seconds]));
  assert.equal(byGroup.Legs, 600);
  assert.equal(byGroup.Chest, 0);
  assert.equal(s.stretch.totalSeconds, 600);
});

test('the board is always all seven regions, and only stretch-tagged time counts', () => {
  const workouts = [{
    id: 'a', date: WEEK.days[0], entries: [
      { exercise: 'Pigeon Pose', group: 'Legs', totalSeconds: 540 },   // → Hips/Glutes by name
      { exercise: 'Plank', group: 'Abs', totalSeconds: 180 },          // strength — excluded
    ],
  }];
  const s = summarizeWeek(stretchData(workouts), WEEK);
  assert.deepEqual(s.stretch.rows.map(r => r.group), [
    'Chest', 'Back', 'Shoulders', 'Arms', 'Abdominals', 'Hips/Glutes', 'Legs',
  ]);
  const byGroup = Object.fromEntries(s.stretch.rows.map(r => [r.group, r.seconds]));
  assert.equal(byGroup['Hips/Glutes'], 540);
  assert.equal(byGroup.Abdominals, 0, 'a timed plank is not stretching');
});

test('the goal comes from the user setting, and met is inclusive', () => {
  const workouts = [{
    id: 'a', date: WEEK.days[0],
    entries: [{ exercise: 'Hamstring Stretch', group: 'Legs', totalSeconds: 300 }],
  }];
  const s = summarizeWeek(stretchData(workouts, { stretchGoalMin: 5 }), WEEK);
  assert.equal(s.stretch.goalMin, 5);
  assert.equal(s.stretch.rows.find(r => r.group === 'Legs').met, true);
  assert.equal(s.stretch.met, 1);
  // Junk falls back to the app default rather than zeroing the bar.
  assert.equal(summarizeWeek(stretchData(workouts, { stretchGoalMin: 'x' }), WEEK).stretch.goalMin, 10);
});

test('the email renders the board, and omits it for someone who never stretches', () => {
  const workouts = [{
    id: 'a', date: WEEK.days[0],
    entries: [{ exercise: 'Hamstring Stretch', group: 'Legs', totalSeconds: 1020 }],
  }];
  const stats = summarizeWeek(stretchData(workouts), WEEK);
  const prior = summarizeWeek(stretchData([]), previousWeek(WEEK));
  const { html, text } = renderWeeklySummary({ stats, priorStats: prior });
  assert.match(html, /Stretching/);
  assert.match(html, /10 min \/ muscle group/);
  assert.match(html, /✓ 17m/);          // 1020s, goal met
  assert.match(html, />0s</);           // neglected regions still show
  assert.match(text, /STRETCHING — 1 of 7 regions/);
  assert.doesNotMatch(html, /NaN|undefined/);

  // Nothing tagged in either week — no section rather than seven zeros.
  const none = summarizeWeek(emptyData(), WEEK);
  const noneP = summarizeWeek(emptyData(), previousWeek(WEEK));
  const bare = renderWeeklySummary({ stats: none, priorStats: noneP });
  assert.doesNotMatch(bare.html, /Stretching/);
  assert.doesNotMatch(bare.text, /STRETCHING/);
});

test('a zero week still gets the board when the week before had stretching', () => {
  const priorWorkouts = [{
    id: 'p', date: previousWeek(WEEK).days[1],
    entries: [{ exercise: 'Hamstring Stretch', group: 'Legs', totalSeconds: 600 }],
  }];
  const stats = summarizeWeek(stretchData(priorWorkouts), WEEK);
  const prior = summarizeWeek(stretchData(priorWorkouts), previousWeek(WEEK));
  assert.equal(stats.stretch.totalSeconds, 0);
  const { html } = renderWeeklySummary({ stats, priorStats: prior });
  assert.match(html, /Stretching/);
  assert.match(html, /0 of 7<\/strong> regions/);
});

// ── the meals-section charts ───────────────────────────────────────────────

test('protein per day distinguishes a zero-protein day from an untracked one', () => {
  const dailyLog = {
    [WEEK.days[0]]: { entries: [{ mealSlot: 'lunch', nutrition: { protein: 40 } }, { mealSlot: 'dinner', nutrition: { protein: 55 } }] },
    [WEEK.days[1]]: { entries: [{ mealSlot: 'lunch', nutrition: { protein: 0 } }] },
    // days[2] has entries but no nutrition on them; days[3+] have nothing.
    [WEEK.days[2]]: { entries: [{ mealSlot: 'dinner' }] },
  };
  const s = summarizeWeek(emptyData({ dailyLog }), WEEK);
  const by = s.meals.proteinByDay;
  assert.equal(by.length, 7);
  assert.equal(by[0].protein, 95);
  assert.equal(by[1].protein, 0);        // logged, and it really was zero
  assert.equal(by[2].protein, null);     // logged a meal, never priced it
  assert.equal(by[6].protein, null);     // nothing logged at all
  assert.equal(by[0].dow, 'Sun');
  assert.equal(by[6].dow, 'Sat');
});

test('protein per meal averages the main meals and leaves snacks out', () => {
  const dailyLog = {
    // Two lunch items make one lunch: (30+10 + 50) / 2 meals = 45.
    [WEEK.days[0]]: { entries: [
      { mealSlot: 'lunch', nutrition: { protein: 30 } },
      { mealSlot: 'lunch', nutrition: { protein: 10 } },
      { mealSlot: 'dinner', nutrition: { protein: 50 } },
      { mealSlot: 'snack', nutrition: { protein: 20 } },
    ] },
    // Only a snack: a day total, but no meal to average.
    [WEEK.days[1]]: { entries: [{ mealSlot: 'snack', nutrition: { protein: 15 } }] },
  };
  const s = summarizeWeek(emptyData({ dailyLog }), WEEK);
  const by = s.meals.proteinByDay;
  assert.equal(by[0].protein, 110);
  assert.equal(by[0].perMeal, 45);
  assert.equal(by[1].protein, 15);
  assert.equal(by[1].perMeal, null);
  assert.equal(by[6].perMeal, null);

  const { html, text } = renderWeeklySummary({ stats: s, priorStats: s });
  assert.match(html, /Protein per day · g/);
  assert.match(html, /Avg protein per meal · g/);
  assert.match(text, /Avg protein per meal/);
});

test('a skipped day contributes no protein reading', () => {
  const dailyLog = { [WEEK.days[0]]: { daySkipped: true, entries: [{ nutrition: { protein: 40 } }] } };
  const s = summarizeWeek(emptyData({ dailyLog }), WEEK);
  assert.equal(s.meals.proteinByDay[0].protein, null);
});

test('the ate-out history is ten weeks, oldest first, ending with this one', () => {
  const dailyLog = {};
  // 3 this week, 1 the week before, 0 before that, 2 four weeks back.
  for (const d of WEEK.days.slice(0, 3)) dailyLog[d] = { entries: [{ mealSlot: 'dinner', eatingOut: true }] };
  const w1 = previousWeek(WEEK);
  dailyLog[w1.days[2]] = { entries: [{ mealSlot: 'lunch', eatingOut: true }] };
  const w3 = previousWeek(previousWeek(w1));
  dailyLog[w3.days[0]] = { eatingOutMeals: ['lunch', 'dinner'] };

  const s = summarizeWeek(emptyData({ dailyLog }), WEEK);
  const h = s.meals.ateOutHistory;
  assert.equal(h.length, 10);
  assert.deepEqual(h.map(x => x.ateOut), [0, 0, 0, 0, 0, 0, 2, 0, 1, 3]);
  assert.equal(h[9].start, WEEK.start);
  assert.equal(h[9].end, WEEK.end);
  assert.equal(h[6].start, w3.start);
  // The chart labels a column with the week's start alone, as the weight chart
  // does; the full span stays on `range` for the plain-text email.
  assert.equal(h[9].label, 'Jul 26');
  assert.equal(h[9].range, 'Jul 26–Aug 1');
  // A week inside one month says the month once.
  assert.equal(h[7].range, 'Jul 12–18');
  // The last point's count is the same number the "Ate out" line reports.
  assert.equal(h[9].ateOut, s.meals.ateOut);
});

test('ten weeks with nothing logged still return ten zero points', () => {
  const s = summarizeWeek(emptyData(), WEEK);
  assert.deepEqual(s.meals.ateOutHistory.map(x => x.ateOut), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('the email draws both charts, with the goal line and the week labels', () => {
  const dailyLog = {
    [WEEK.days[0]]: { entries: [{ mealSlot: 'dinner', nutrition: { protein: 160, calories: 900 } }] },
    [WEEK.days[1]]: { entries: [{ mealSlot: 'dinner', nutrition: { protein: 40, calories: 500 }, eatingOut: true }] },
  };
  const data = emptyData({ dailyLog });
  const s = summarizeWeek(data, WEEK, { withProgress: true });
  const email = renderWeeklySummary({
    stats: s,
    priorStats: summarizeWeek(data, previousWeek(WEEK)),
    goals: { protein: 145 },
  });
  assert.match(email.html, /Protein per day/);
  assert.match(email.html, /145g daily goal/);
  assert.match(email.html, /border-top:1px dashed/);      // the goal line itself
  assert.match(email.html, /Meals eaten out · last 10 weeks/);
  // Columns are labelled by week start, like the weight chart underneath.
  assert.match(email.html, /font-size:10px;color:#111827;white-space:nowrap;">Jul 26</);
  assert.match(email.html, /#16a34a/);                    // the 160g day beat the goal
  assert.match(email.html, /#dc2626/);                    // the 40g day fell well short
  // Plain text carries the same numbers rather than a shrug.
  assert.match(email.text, /Protein per day \(g\) — goal 145/);
  assert.match(email.text, /Sun {2}█+░* {2}160 {2}✓/);
  assert.match(email.text, /Wed {2}·+ {2}no data/);
  assert.match(email.text, /Meals eaten out, last 10 weeks/);
  // The text rows keep the full span even though the chart columns don't.
  assert.match(email.text, /Jul 26–Aug 1 {2}█+/);
});

test('with no protein goal the chart drops the goal line rather than inventing one', () => {
  const dailyLog = { [WEEK.days[0]]: { entries: [{ mealSlot: 'dinner', nutrition: { protein: 90, calories: 700 } }] } };
  const data = emptyData({ dailyLog });
  const s = summarizeWeek(data, WEEK, { withProgress: true });
  const email = renderWeeklySummary({ stats: s, priorStats: summarizeWeek(data, previousWeek(WEEK)), goals: {} });
  assert.match(email.html, /Protein per day/);
  assert.doesNotMatch(email.html, /daily goal/);
  assert.doesNotMatch(email.html, /border-top:1px dashed/);
});

test('a week with no nutrition at all draws no protein chart', () => {
  const dailyLog = { [WEEK.days[0]]: { entries: [{ mealSlot: 'dinner' }] } };
  const data = emptyData({ dailyLog });
  const s = summarizeWeek(data, WEEK, { withProgress: true });
  const email = renderWeeklySummary({ stats: s, priorStats: summarizeWeek(data, previousWeek(WEEK)), goals: { protein: 145 } });
  assert.doesNotMatch(email.html, /Protein per day/);
  // The eating-out breakdown still renders — zero is a real answer there.
  assert.match(email.html, /Meals eaten out/);
});

// ── per-meal protein hit rate and fibre, over the same ten weeks ─────────────
// The trend the eating-out chart established, applied to meal QUALITY: what
// share of logged meals cleared the per-meal protein goal, and how much fibre
// the average logged meal carried. The traps are both "unknown isn't zero" —
// a week nobody logged must not read as a 0% week, and a meal with no fibre
// figure must not drag the fibre average down.

test('the meal-quality history is ten weeks, oldest first, ending with this one', () => {
  const dailyLog = {
    [WEEK.days[0]]: {
      entries: [
        { mealSlot: 'breakfast', nutrition: { protein: 50, fiber: 10 } },
        { mealSlot: 'dinner', nutrition: { protein: 20, fiber: 4 } },
      ],
    },
  };
  const w2 = previousWeek(previousWeek(WEEK));
  dailyLog[w2.days[3]] = { entries: [{ mealSlot: 'lunch', nutrition: { protein: 60, fiber: 8 } }] };

  const h = summarizeWeek(emptyData({ dailyLog }), WEEK).meals.qualityHistory;
  assert.equal(h.length, 10);
  assert.deepEqual(h.map(w => w.meals), [0, 0, 0, 0, 0, 0, 0, 1, 0, 2]);
  assert.equal(h[9].start, WEEK.start);
  assert.equal(h[7].start, w2.start);
  // Labels match the eating-out history's, so the columns line up under it.
  assert.equal(h[9].label, 'Jul 26');
  assert.equal(h[9].range, 'Jul 26–Aug 1');
  assert.deepEqual(h[9].proteins, [50, 20]);
  assert.equal(h[9].fiberAvg, 7);
});

test('several entries in one slot are one meal, summed', () => {
  const dailyLog = {
    [WEEK.days[0]]: {
      entries: [
        { mealSlot: 'dinner', nutrition: { protein: 30, fiber: 5 } },
        { mealSlot: 'dinner', nutrition: { protein: 15, fiber: 3 } },
      ],
    },
  };
  const h = summarizeWeek(emptyData({ dailyLog }), WEEK).meals.qualityHistory;
  assert.equal(h[9].meals, 1);
  assert.deepEqual(h[9].proteins, [45]);
  assert.equal(h[9].fiberAvg, 8);
});

test('snacks and unpriced meals are not meals here', () => {
  const dailyLog = {
    [WEEK.days[0]]: {
      entries: [
        { mealSlot: 'snack', nutrition: { protein: 40, fiber: 9 } },
        { mealSlot: 'lunch' },                                   // logged, never priced
        { mealSlot: 'dinner', nutrition: { protein: 35, fiber: 6 } },
      ],
    },
    [WEEK.days[1]]: { daySkipped: true, entries: [{ mealSlot: 'dinner', nutrition: { protein: 99, fiber: 99 } }] },
  };
  const h = summarizeWeek(emptyData({ dailyLog }), WEEK).meals.qualityHistory;
  assert.deepEqual(h[9].proteins, [35]);
  assert.equal(h[9].fiberAvg, 6);
});

test('a meal with no fibre figure is left out of the fibre average, not counted as 0g', () => {
  const dailyLog = {
    [WEEK.days[0]]: {
      entries: [
        { mealSlot: 'breakfast', nutrition: { protein: 30, fiber: 12 } },
        { mealSlot: 'dinner', nutrition: { protein: 30 } },       // no fibre estimated
      ],
    },
  };
  const h = summarizeWeek(emptyData({ dailyLog }), WEEK).meals.qualityHistory;
  assert.equal(h[9].meals, 2);            // both count as meals for protein
  assert.deepEqual(h[9].fibers, [12]);    // only one carried fibre
  assert.equal(h[9].fiberAvg, 12);        // not 6
});

test('a week that priced nothing is null fibre, not a zero-fibre week', () => {
  const h = summarizeWeek(emptyData(), WEEK).meals.qualityHistory;
  assert.equal(h.length, 10);
  assert.deepEqual(h.map(w => w.fiberAvg), Array(10).fill(null));
  assert.deepEqual(h.map(w => w.meals), Array(10).fill(0));
});

test('the email charts the protein hit rate and the fibre average over ten weeks', () => {
  const dailyLog = {
    // 3 priced meals: two clear the 48g per-meal goal (145/3), one doesn't.
    [WEEK.days[0]]: {
      entries: [
        { mealSlot: 'breakfast', nutrition: { protein: 50, fiber: 12 } },
        { mealSlot: 'dinner', nutrition: { protein: 60, fiber: 6 } },
      ],
    },
    [WEEK.days[1]]: { entries: [{ mealSlot: 'lunch', nutrition: { protein: 20, fiber: 3 } }] },
  };
  const data = emptyData({ dailyLog });
  const s = summarizeWeek(data, WEEK, { withProgress: true });
  const email = renderWeeklySummary({
    stats: s,
    priorStats: summarizeWeek(data, previousWeek(WEEK)),
    goals: { protein: 145, fiber: 27 },
  });

  assert.match(email.html, /Meals hitting the 48g protein goal · last 10 weeks/);
  assert.match(email.html, /Avg fibre per meal · g · last 10 weeks/);
  assert.match(email.html, /dashed line is 9g \(your daily goal ÷ 3\)/);
  // 2 of 3 meals cleared the goal.
  assert.match(email.html, />67%</);
  // (12 + 6 + 3) / 3 = 7.0g — short of the 9g line, so the dot is amber.
  assert.match(email.html, />7\.0</);
  assert.match(email.html, /#d97706/);

  // Plain text carries the same two trends.
  assert.match(email.text, /Meals hitting the 48g protein goal, last 10 weeks \(%\)/);
  assert.match(email.text, /Jul 26–Aug 1 {2}█+░* {2}67%/);
  assert.match(email.text, /Avg fibre per meal, last 10 weeks \(g\) — goal 9/);
  assert.match(email.text, /Jul 26–Aug 1 {2}█+░* {2}7\.0/);
  // A week nobody logged is a dash, not a zero. (Labels are padded to the
  // width of the longest span, so the gap is variable.)
  assert.match(email.text, /May 24–30 +·+ {2}—/);
});

test('with no protein goal the hit-rate chart is dropped rather than assumed', () => {
  const dailyLog = {
    [WEEK.days[0]]: { entries: [{ mealSlot: 'dinner', nutrition: { protein: 40, fiber: 9 } }] },
  };
  const data = emptyData({ dailyLog });
  const s = summarizeWeek(data, WEEK, { withProgress: true });
  const email = renderWeeklySummary({
    stats: s,
    priorStats: summarizeWeek(data, previousWeek(WEEK)),
    goals: { fiber: 27 },
  });
  assert.doesNotMatch(email.html, /protein goal · last/);
  assert.doesNotMatch(email.text, /protein goal, last/);
  // Fibre stands on its own — it has its own goal.
  assert.match(email.html, /Avg fibre per meal/);
});

test('nobody who logs no fibre gets a fibre chart', () => {
  const dailyLog = {
    [WEEK.days[0]]: { entries: [{ mealSlot: 'dinner', nutrition: { protein: 60 } }] },
  };
  const data = emptyData({ dailyLog });
  const s = summarizeWeek(data, WEEK, { withProgress: true });
  const email = renderWeeklySummary({
    stats: s,
    priorStats: summarizeWeek(data, previousWeek(WEEK)),
    goals: { protein: 145, fiber: 27 },
  });
  assert.doesNotMatch(email.html, /Avg fibre per meal/);
  assert.doesNotMatch(email.text, /Avg fibre per meal/);
  // The protein hit rate still renders — that week's one meal missed the goal.
  assert.match(email.html, /Meals hitting the 48g protein goal/);
});

// ---- Users chart (owner only) ----------------------------------------------
// The growth series itself is covered in adminGrowth.test.js; these pin down
// the part that belongs to the email — that the section is OFF by default, and
// that both series reach the page when it is on.

test('the Users section only appears when growth data is passed in', () => {
  const stats = summarizeWeek(emptyData(), WEEK);
  const prior = summarizeWeek(emptyData(), previousWeek(WEEK));
  const growth = [
    { date: '2026-07-19', label: 'Jul 19', total: 8, active: 3 },
    { date: '2026-07-26', label: 'Jul 26', total: 11, active: 2 },
    { date: '2026-08-02', label: 'Aug 2', total: 14, active: 5 },
  ];

  // Everyone else's summary: no user numbers anywhere in it.
  const plain = renderWeeklySummary({ stats, priorStats: prior });
  assert.doesNotMatch(plain.html, /Total users/);
  assert.doesNotMatch(plain.text, /Total users/);

  const owner = renderWeeklySummary({ stats, priorStats: prior, adminGrowth: growth });
  assert.match(owner.html, /Users over time/);
  assert.match(owner.html, /Total users/);
  assert.match(owner.html, /Active \(7d\)/);
  // Both series are drawn, in the validated pair of hues.
  assert.match(owner.html, /background:#c96442/);
  assert.match(owner.html, /background:#2563eb/);
  // Latest figures and the change across the span.
  assert.match(owner.html, /14<\/span>|>14</);
  assert.match(owner.text, /Total users: 14 \(\+6 since Jul 19\)/);
  assert.match(owner.text, /Active \(7d\): 5 \(\+2 since Jul 19\)/);
  assert.match(owner.text, /Aug 2 +14 total · 5 active/);
  assert.doesNotMatch(owner.text, /NaN|undefined/);
});

test('one snapshot is not a trend, so no chart is drawn for it', () => {
  const stats = summarizeWeek(emptyData(), WEEK);
  const prior = summarizeWeek(emptyData(), previousWeek(WEEK));
  const one = renderWeeklySummary({
    stats, priorStats: prior,
    adminGrowth: [{ date: '2026-08-02', label: 'Aug 2', total: 14, active: 5 }],
  });
  assert.doesNotMatch(one.html, /Users over time/);
  // The headline rows still report what that single snapshot knows.
  assert.match(one.html, /Total users/);
  assert.doesNotMatch(one.html, /since Aug 2/);
});

test('a snapshot with no per-user rows draws the total line and skips active', () => {
  const stats = summarizeWeek(emptyData(), WEEK);
  const prior = summarizeWeek(emptyData(), previousWeek(WEEK));
  const email = renderWeeklySummary({
    stats, priorStats: prior,
    adminGrowth: [
      { date: '2026-07-26', label: 'Jul 26', total: 11, active: null },
      { date: '2026-08-02', label: 'Aug 2', total: 14, active: null },
    ],
  });
  assert.match(email.html, /Users over time/);
  assert.match(email.text, /Total users: 14/);
  // Unknown isn't zero: no "Active (7d): 0" headline invented for it.
  assert.doesNotMatch(email.text, /Active \(7d\): 0/);
  assert.match(email.text, /14 total · — active/);
});
