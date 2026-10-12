// "Seasonal only" recipes — a recipe with `seasonOnly` set ('spring' |
// 'summer' | 'fall' | 'winter') is only offered in Suggested Meals during that
// season. Absent or '' = year-round. Seasons are the same Northern-hemisphere
// month blocks the Shopping List's Snacks/Fruit popup uses (pantrySeasons.js).
//
// The mobile app mirrors this in src/utils/recipeSeason.ts so both platforms
// suggest the same meals.
import { SEASONS } from './pantrySeasons.js';

export { SEASONS as RECIPE_SEASONS };

export function seasonForMonth(month) {
  return SEASONS.find(s => s.months.includes(month))?.key || null;
}

export function seasonLabel(key) {
  return SEASONS.find(s => s.key === key)?.label || '';
}

// month is 1-12; defaults to now.
export function recipeInSeason(recipe, month = new Date().getMonth() + 1) {
  const only = recipe?.seasonOnly;
  if (!only || !SEASONS.some(s => s.key === only)) return true;
  return seasonForMonth(month) === only;
}
