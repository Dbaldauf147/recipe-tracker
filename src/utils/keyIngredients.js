export const DEFAULT_KEY_INGREDIENTS = [
  'almonds',
  'avocado',
  'beets',
  'bell_pepper',
  'black_beans',
  'blueberries',
  'broccoli',
  'brown_rice',
  'brussels_sprouts',
  'carrots_baby',
  'cauliflower',
  'chicken_breast',
  'chickpeas',
  'cottage_cheese',
  'edamame',
  'eggs',
  'garlic',
  'ginger',
  'greek_yogurt',
  'green_beans',
  'kale',
  'lentils',
  'mushrooms',
  'oats',
  'onion',
  'peanut_butter',
  'peas',
  'potatoes',
  'quinoa',
  'salmon',
  'sardines',
  'shrimp',
  'spinach',
  'strawberries',
  'sweet_potato',
  'tempeh',
  'tofu',
  'tomatoes',
  'tuna',
  'turkey_breast',
  'walnuts',
  'whole_wheat_pasta',
  'zucchini',
];

/** Backwards-compatible alias */
export const KEY_INGREDIENTS = DEFAULT_KEY_INGREDIENTS;

const KEY_INGREDIENTS_STORAGE = 'sunday-key-ingredients';

/** Get the user's chosen key ingredients (falls back to defaults) */
export function getUserKeyIngredients() {
  try {
    const data = localStorage.getItem(KEY_INGREDIENTS_STORAGE);
    if (data) {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_KEY_INGREDIENTS;
}

/** Format a snake_case ingredient key for display */
export function displayName(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Normalize a string for fuzzy matching */
export function normalize(str) {
  return str
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\(.*?\)/g, '')
    .trim();
}

/** Check if a recipe contains a key ingredient */
export function recipeHasIngredient(recipe, normKey) {
  if (!recipe || !recipe.ingredients) return false;
  return recipe.ingredients.some(ing => {
    const normIng = normalize(ing.ingredient || '');
    return normIng && (normIng.includes(normKey) || normKey.includes(normIng));
  });
}
