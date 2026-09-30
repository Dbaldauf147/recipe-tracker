import test from 'node:test';
import assert from 'node:assert/strict';
import { rangeDays, summarizeMealLog, renderMealLogEmail, rangeLabel, MAX_RANGE_DAYS } from '../../lib/mealLogSummary.js';

test('rangeDays is inclusive and rejects bad or oversized ranges', () => {
  assert.deepEqual(rangeDays('2026-09-28', '2026-10-01'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']);
  assert.equal(rangeDays('2026-10-01', '2026-09-28'), null);
  assert.equal(rangeDays('nope', '2026-09-28'), null);
  assert.equal(rangeDays('2026-01-01', '2026-03-01'), null);
  assert.equal(rangeDays('2026-01-01', '2026-01-31').length, MAX_RANGE_DAYS);
});

test('the admin "Last 30 days" range is accepted; 32 days is not', () => {
  // daysAgo(30)..daysAgo(1): 30 full days, here crossing a month end and DST.
  const days = rangeDays('2026-10-15', '2026-11-13');
  assert.equal(days.length, 30);
  assert.equal(days[0], '2026-10-15');
  assert.equal(days[29], '2026-11-13');
  assert.equal(rangeDays('2026-10-01', '2026-10-31').length, 31);
  assert.equal(rangeDays('2026-10-01', '2026-11-01'), null); // 32 days
});

test('a 30-day email renders every day, averages only days with nutrition', () => {
  const days = rangeDays('2026-10-15', '2026-11-13');
  const meal = { mealSlot: 'lunch', recipeName: 'Chili', nutrition: { calories: 600, protein: 40, carbs: 50, fat: 20 } };
  const log = { '2026-10-15': { entries: [meal] }, '2026-11-13': { entries: [meal, { ...meal, mealSlot: 'dinner' }] } };
  const summary = summarizeMealLog(log, days);
  assert.equal(summary.days.length, 30);
  assert.equal(summary.macroDays, 2);
  assert.equal(summary.avg.calories, 900);
  const { subject, text } = renderMealLogEmail({ name: 'Dan', start: days[0], end: days[29], summary });
  assert.equal(subject, "Dan's meal log — Oct 15 – Nov 13, 2026");
  assert.match(text, /Daily average \(2 days with nutrition\): 900 cal/);
});

test('meals are listed per day in slot order with a day total; unknown nutrition stays unknown', () => {
  const log = {
    '2026-09-21': {
      entries: [
        { type: 'recipe', recipeName: 'Chili', mealSlot: 'dinner', servings: 1.5, nutrition: { calories: 600, protein: 40, carbs: 50, fat: 20 } },
        { type: 'custom', ingredientName: 'Greek yogurt', quantity: 170, measurement: 'g', mealSlot: 'breakfast', nutrition: { calories: 100, protein: 17, carbs: 6, fat: 0 } },
        { type: 'custom_meal', recipeName: 'Mystery bowl', mealSlot: 'lunch', eatingOut: true },
      ],
    },
    '2026-09-22': { daySkipped: true, entries: [] },
    '2026-09-23': { skippedMeals: ['lunch'], eatingOutMeals: ['dinner'], entries: [{ recipeName: 'Soup', mealSlot: 'lunch', nutrition: { calories: 300 } }] },
  };
  const s = summarizeMealLog(log, ['2026-09-21', '2026-09-22', '2026-09-23']);
  const [d1, d2, d3] = s.days;
  assert.deepEqual(d1.meals.map(m => m.slot), ['breakfast', 'lunch', 'dinner']);
  assert.equal(d1.meals[0].name, 'Greek yogurt — 170 g');
  assert.equal(d1.meals[1].nutrition, null);
  assert.equal(d1.meals[2].servings, 1.5);
  assert.deepEqual(d1.totals, { calories: 700, protein: 57, carbs: 56, fat: 20 });
  assert.equal(d2.totals, null);
  assert.match(d2.notes.join(), /not tracked/);
  // A skipped slot's entry is left out; the ate-out mark still shows.
  assert.equal(d3.meals.length, 0);
  assert.match(d3.notes.join(), /Lunch skipped/);
  assert.match(d3.notes.join(), /Dinner: ate out/);
  // Average is over days WITH nutrition, not calendar days.
  assert.equal(s.macroDays, 1);
  assert.equal(s.avg.calories, 700);
  assert.equal(s.mealCount, 3);
});

test('the email names the user, escapes meal names and shows goals', () => {
  const log = { '2026-09-21': { entries: [{ recipeName: '<b>Tacos</b>', mealSlot: 'dinner', nutrition: { calories: 800, protein: 45, carbs: 70, fat: 30 } }] } };
  const s = summarizeMealLog(log, ['2026-09-21']);
  const email = renderMealLogEmail({ name: 'Sam', start: '2026-09-21', end: '2026-09-21', summary: s, goals: { protein: 150 } });
  assert.equal(email.subject, "Sam's meal log — Sep 21, 2026");
  assert.match(email.html, /&lt;b&gt;Tacos&lt;\/b&gt;/);
  assert.doesNotMatch(email.html, /<b>Tacos/);
  assert.match(email.html, /Day total/);
  assert.match(email.html, /30%/); // 45 of 150 g protein
  assert.match(email.text, /Dinner: <b>Tacos<\/b> — 800 cal, 45g P, 70g C, 30g F/);
});

test('rangeLabel reads naturally across months and years', () => {
  assert.equal(rangeLabel('2026-09-21', '2026-09-27'), 'Sep 21–27, 2026');
  assert.equal(rangeLabel('2026-09-28', '2026-10-04'), 'Sep 28 – Oct 4, 2026');
  assert.equal(rangeLabel('2026-12-28', '2027-01-03'), 'Dec 28, 2026 – Jan 3, 2027');
});
