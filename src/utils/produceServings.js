/**
 * Veg & fruit servings for the Week Plan's produce tiles and its goal history.
 *
 * Its own module, like utils/mealsTracked.js next door, so there is ONE
 * definition of the tally and one of the average — and so a test can load it
 * without dragging in a component full of CSS modules and Firebase.
 *
 * `lib/weeklySummary.js` keeps its own copy for the weekly email (it runs in a
 * serverless function and reads nothing from src/components); if the rules here
 * change, change them there too.
 */

const PRODUCE_MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Veg/fruit servings on ONE day. Skipped days and skipped slots contribute 0. */
export function produceForDay(day) {
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

export function produceForDays(days, dailyLog) {
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

/**
 * Average servings per day over the days of the week that have HAPPENED.
 *
 * Dividing by 7 all week would be arithmetic, not an average: on Wednesday it
 * reports a third of what you have actually been eating each day, so the tile
 * is guaranteed to read short until Saturday no matter how well the week is
 * going. Dividing by days lived makes it a running average that can be compared
 * against a daily goal on any day of the week. A finished week divides by 7
 * either way, so history is unaffected.
 *
 * A week entirely in the future has no average at all — `null`, not 0, because
 * nothing has been measured yet.
 */
export function produceAveragePerDay(days, dailyLog, todayKey) {
  const total = produceForDays(days, dailyLog);
  let elapsed = 0;
  for (const date of days) if (date <= todayKey) elapsed += 1;
  const avg = n => (elapsed === 0 ? null : Math.round((n / elapsed) * 10) / 10);
  return { veg: avg(total.veg), fruit: avg(total.fruit), elapsed, total };
}

