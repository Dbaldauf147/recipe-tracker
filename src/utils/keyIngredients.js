export const INGREDIENT_CATEGORIES = {
  Protein: [
    'black_beans',
    'chicken_breast',
    'chickpeas',
    'edamame',
    'eggs',
    'greek_yogurt',
    'kefir',
    'lentils',
    'salmon',
    'sardines',
    'soy_milk',
    'tempeh',
    'tofu',
    'trout',
    'turkey_breast',
  ],
  Carbs: [
    'apples',
    'barley',
    'brown_rice',
    'buckwheat_groats',
    'kiwi',
    'oats',
    'oranges',
    'potatoes',
    'quinoa',
    'sweet_potatoes',
    'whole_wheat_pasta',
  ],
  Fiber: [
    'asparagus',
    'bell_peppers',
    'blueberries',
    'broccoli',
    'brussels_sprouts',
    'cabbage',
    'carrots',
    'cauliflower',
    'kale',
    'mushrooms',
    'raspberries',
    'spinach',
    'strawberries',
    'tomatoes',
  ],
  Fats: [
    'almonds',
    'avocado',
    'chia_seeds',
    'dark_chocolate',
    'extra_virgin_olive_oil',
    'ground_flaxseed',
    'parmesan_cheese',
    'popcorn_kernels',
    'pumpkin_seeds',
    'walnuts',
  ],
};

export const DEFAULT_KEY_INGREDIENTS = Object.values(INGREDIENT_CATEGORIES).flat();

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
