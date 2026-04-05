export const INGREDIENT_CATEGORIES = {
  Protein: [
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
    'black_beans',
    'brown_rice',
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
    'extra_virgin_olive_oil',
    'ground_flaxseed',
    'parmesan_cheese',
    'pumpkin_seeds',
    'walnuts',
  ],
};

export const DEFAULT_KEY_INGREDIENTS = Object.values(INGREDIENT_CATEGORIES).flat();

/**
 * Diet compatibility map.
 * Each diet lists ingredient keys that are NOT compatible (excluded).
 * Ingredients not listed are assumed compatible.
 */
const DIET_EXCLUSIONS = {
  Vegan: [
    'chicken_breast', 'eggs', 'greek_yogurt', 'kefir', 'salmon', 'sardines',
    'trout', 'turkey_breast', 'parmesan_cheese',
  ],
  Vegetarian: [
    'chicken_breast', 'salmon', 'sardines', 'trout', 'turkey_breast',
  ],
  Pescatarian: [
    'chicken_breast', 'turkey_breast',
  ],
  Keto: [
    'apples', 'barley', 'black_beans', 'brown_rice', 'kiwi', 'oats',
    'oranges', 'potatoes', 'quinoa', 'sweet_potatoes', 'whole_wheat_pasta',
    'chickpeas', 'lentils',
  ],
  Paleo: [
    'barley', 'black_beans', 'brown_rice', 'oats', 'quinoa', 'whole_wheat_pasta',
    'chickpeas', 'edamame', 'greek_yogurt', 'kefir', 'lentils', 'soy_milk',
    'tempeh', 'tofu', 'parmesan_cheese', 'potatoes',
  ],
  Carnivore: [
    'chickpeas', 'edamame', 'lentils', 'soy_milk', 'tempeh', 'tofu',
    'apples', 'barley', 'black_beans', 'brown_rice', 'kiwi', 'oats',
    'oranges', 'potatoes', 'quinoa', 'sweet_potatoes', 'whole_wheat_pasta',
    'asparagus', 'bell_peppers', 'blueberries', 'broccoli', 'brussels_sprouts',
    'cabbage', 'carrots', 'cauliflower', 'kale', 'mushrooms', 'raspberries',
    'spinach', 'strawberries', 'tomatoes',
    'almonds', 'avocado', 'chia_seeds', 'extra_virgin_olive_oil',
    'ground_flaxseed', 'pumpkin_seeds', 'walnuts',
  ],
  Mediterranean: [
    // Mediterranean is broad — only exclude heavily processed or uncommon items
  ],
  Whole30: [
    'barley', 'black_beans', 'brown_rice', 'oats', 'quinoa', 'whole_wheat_pasta',
    'chickpeas', 'edamame', 'greek_yogurt', 'kefir', 'lentils', 'soy_milk',
    'tempeh', 'tofu', 'parmesan_cheese',
  ],
  'Gluten-Free': [
    'barley', 'whole_wheat_pasta',
  ],
  'Dairy-Free': [
    'greek_yogurt', 'kefir', 'parmesan_cheese',
  ],
  'Low-Carb': [
    'apples', 'barley', 'black_beans', 'brown_rice', 'kiwi', 'oats',
    'oranges', 'potatoes', 'quinoa', 'sweet_potatoes', 'whole_wheat_pasta',
  ],
  'High-Protein': [
    // High-protein doesn't exclude anything, just emphasizes protein sources
  ],
};

/** Get ingredients filtered by the user's selected diets */
export function getDietFilteredIngredients(allIngredients) {
  try {
    const diets = JSON.parse(localStorage.getItem('sunday-user-diet'));
    if (!diets || !Array.isArray(diets) || diets.length === 0) return allIngredients;

    const excluded = new Set();
    for (const diet of diets) {
      const excl = DIET_EXCLUSIONS[diet];
      if (excl) excl.forEach(k => excluded.add(k));
    }
    return allIngredients.filter(k => !excluded.has(k));
  } catch {
    return allIngredients;
  }
}

/** Get diet-filtered version of INGREDIENT_CATEGORIES */
export function getDietFilteredCategories() {
  try {
    const diets = JSON.parse(localStorage.getItem('sunday-user-diet'));
    if (!diets || !Array.isArray(diets) || diets.length === 0) return INGREDIENT_CATEGORIES;

    const excluded = new Set();
    for (const diet of diets) {
      const excl = DIET_EXCLUSIONS[diet];
      if (excl) excl.forEach(k => excluded.add(k));
    }

    const filtered = {};
    for (const [cat, items] of Object.entries(INGREDIENT_CATEGORIES)) {
      const kept = items.filter(k => !excluded.has(k));
      if (kept.length > 0) filtered[cat] = kept;
    }
    return filtered;
  } catch {
    return INGREDIENT_CATEGORIES;
  }
}

/** Backwards-compatible alias */
export const KEY_INGREDIENTS = DEFAULT_KEY_INGREDIENTS;

const KEY_INGREDIENTS_STORAGE = 'sunday-key-ingredients';

/** Get the user's chosen key ingredients (falls back to diet-filtered defaults) */
export function getUserKeyIngredients() {
  try {
    const data = localStorage.getItem(KEY_INGREDIENTS_STORAGE);
    if (data) {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return getDietFilteredIngredients(parsed);
      }
    }
  } catch {}
  return getDietFilteredIngredients(DEFAULT_KEY_INGREDIENTS);
}

/** Save the user's key ingredients list */
export function saveUserKeyIngredients(ingredients) {
  try {
    localStorage.setItem(KEY_INGREDIENTS_STORAGE, JSON.stringify(ingredients));
  } catch {}
}

/** Format a snake_case ingredient key for display */
export function displayName(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Normalize a string for fuzzy matching — strips (s), trailing s, underscores */
export function normalize(str) {
  return str
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\(.*?\)/g, '')
    .replace(/s$/, '')
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
