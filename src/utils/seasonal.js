import SEASONAL_DATA from '../data/seasonalIngredients.js';

// Map user location strings (from setup) to seasonal data region keys
const LOCATION_TO_REGION = {
  northeast: 'northeast',
  southeast: 'southeast',
  midwest: 'midwest',
  southwest: 'southwest',
  'west coast': 'west_coast',
  'pacific northwest': 'pacific_northwest',
  // Common alternate names
  'north east': 'northeast',
  'south east': 'southeast',
  'mid west': 'midwest',
  'south west': 'southwest',
  'west_coast': 'west_coast',
  'pacific_northwest': 'pacific_northwest',
  'pnw': 'pacific_northwest',
  // US states → regions
  'maine': 'northeast', 'new hampshire': 'northeast', 'vermont': 'northeast',
  'massachusetts': 'northeast', 'rhode island': 'northeast', 'connecticut': 'northeast',
  'new york': 'northeast', 'new jersey': 'northeast', 'pennsylvania': 'northeast',
  'maryland': 'northeast', 'delaware': 'northeast',
  'virginia': 'southeast', 'west virginia': 'southeast', 'north carolina': 'southeast',
  'south carolina': 'southeast', 'georgia': 'southeast', 'florida': 'southeast',
  'alabama': 'southeast', 'mississippi': 'southeast', 'tennessee': 'southeast',
  'kentucky': 'southeast', 'louisiana': 'southeast', 'arkansas': 'southeast',
  'ohio': 'midwest', 'michigan': 'midwest', 'indiana': 'midwest', 'illinois': 'midwest',
  'wisconsin': 'midwest', 'minnesota': 'midwest', 'iowa': 'midwest', 'missouri': 'midwest',
  'north dakota': 'midwest', 'south dakota': 'midwest', 'nebraska': 'midwest', 'kansas': 'midwest',
  'texas': 'southwest', 'oklahoma': 'southwest', 'new mexico': 'southwest', 'arizona': 'southwest',
  'nevada': 'southwest', 'utah': 'southwest', 'colorado': 'southwest',
  'california': 'west_coast', 'hawaii': 'west_coast',
  'oregon': 'pacific_northwest', 'washington': 'pacific_northwest', 'idaho': 'pacific_northwest',
  'montana': 'pacific_northwest', 'wyoming': 'pacific_northwest', 'alaska': 'pacific_northwest',
};

export function locationToRegion(location) {
  if (!location) return null;
  const key = location.toLowerCase().trim();
  return LOCATION_TO_REGION[key] || null;
}

/**
 * Returns a Set of ingredient names that are in season for the given region and month.
 */
export function getSeasonalIngredients(region, month) {
  const data = SEASONAL_DATA[region];
  if (!data) return new Set();
  const result = new Set();
  for (const [ingredient, months] of Object.entries(data)) {
    if (months.includes(month)) {
      result.add(ingredient);
    }
  }
  return result;
}

/**
 * Given a recipe and a Set of seasonal ingredient names,
 * returns the recipe's ingredients that are currently in season.
 */
export function getRecipeSeasonalIngredients(recipe, seasonalSet) {
  if (!recipe?.ingredients || seasonalSet.size === 0) return [];
  const matches = [];
  for (const ing of recipe.ingredients) {
    const name = (ing.ingredient || '').toLowerCase().trim();
    if (!name) continue;
    for (const seasonal of seasonalSet) {
      if (name.includes(seasonal) || seasonal.includes(name)) {
        matches.push(seasonal);
        break;
      }
    }
  }
  return [...new Set(matches)];
}
