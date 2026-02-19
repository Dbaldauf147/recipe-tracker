const API_KEY = import.meta.env.VITE_USDA_API_KEY || 'DEMO_KEY';
const BASE_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

// All tracked nutrients with their USDA FoodData Central IDs, units, and rounding precision.
export const NUTRIENTS = [
  { key: 'calories',      label: 'Calories',        id: 1008, unit: '',    decimals: 0 },
  { key: 'protein',       label: 'Protein',         id: 1003, unit: 'g',   decimals: 1 },
  { key: 'carbs',         label: 'Carbs',           id: 1005, unit: 'g',   decimals: 1 },
  { key: 'fat',           label: 'Fat',             id: 1004, unit: 'g',   decimals: 1 },
  { key: 'saturatedFat',  label: 'Saturated Fat',   id: 1258, unit: 'g',   decimals: 1 },
  { key: 'sugar',         label: 'Sugar',           id: 2000, unit: 'g',   decimals: 1 },
  { key: 'addedSugar',    label: 'Added Sugar',     id: 1235, unit: 'g',   decimals: 1 },
  { key: 'fiber',         label: 'Fiber',           id: 1079, unit: 'g',   decimals: 1 },
  { key: 'sodium',        label: 'Salt',            id: 1093, unit: 'mg',  decimals: 0 },
  { key: 'potassium',     label: 'Potassium',       id: 1092, unit: 'mg',  decimals: 0 },
  { key: 'calcium',       label: 'Calcium',         id: 1087, unit: 'mg',  decimals: 0 },
  { key: 'iron',          label: 'Iron',            id: 1089, unit: 'mg',  decimals: 1 },
  { key: 'magnesium',     label: 'Magnesium',       id: 1090, unit: 'mg',  decimals: 0 },
  { key: 'zinc',          label: 'Zinc',            id: 1095, unit: 'mg',  decimals: 1 },
  { key: 'vitaminB12',    label: 'B12',             id: 1178, unit: 'µg',  decimals: 2 },
  { key: 'vitaminC',      label: 'Vitamin C',       id: 1162, unit: 'mg',  decimals: 1 },
  { key: 'leucine',       label: 'Leucine',         id: 1213, unit: 'g',   decimals: 2 },
];

// Map common ingredient names to better USDA search terms.
const ALIASES = {
  'egg': 'egg, whole, raw',
  'eggs': 'egg, whole, raw',
  'butter': 'butter, salted',
  'unsalted butter': 'butter, without salt',
  'flour': 'flour, wheat, all-purpose',
  'all-purpose flour': 'flour, wheat, all-purpose, enriched',
  'all purpose flour': 'flour, wheat, all-purpose, enriched',
  'ap flour': 'flour, wheat, all-purpose, enriched',
  'bread flour': 'flour, wheat, bread',
  'whole wheat flour': 'flour, whole wheat',
  'sugar': 'sugar, granulated',
  'white sugar': 'sugar, granulated',
  'granulated sugar': 'sugar, granulated',
  'brown sugar': 'sugar, brown',
  'powdered sugar': 'sugar, powdered',
  'confectioners sugar': 'sugar, powdered',
  'milk': 'milk, whole',
  'whole milk': 'milk, whole, 3.25%',
  'skim milk': 'milk, nonfat, fluid',
  '2% milk': 'milk, reduced fat, 2%',
  'heavy cream': 'cream, heavy whipping',
  'cream cheese': 'cream cheese, regular',
  'sour cream': 'sour cream, regular',
  'cheddar cheese': 'cheese, cheddar',
  'mozzarella': 'cheese, mozzarella, whole milk',
  'parmesan': 'cheese, parmesan, hard',
  'chocolate chips': 'chocolate, chips, semisweet',
  'semi-sweet chocolate chips': 'chocolate, chips, semisweet',
  'cocoa powder': 'cocoa, dry powder, unsweetened',
  'olive oil': 'oil, olive, salad or cooking',
  'vegetable oil': 'oil, vegetable, soybean',
  'canola oil': 'oil, canola',
  'coconut oil': 'oil, coconut',
  'salt': 'salt, table',
  'baking soda': 'leavening agents, baking soda',
  'baking powder': 'leavening agents, baking powder',
  'vanilla extract': 'vanilla extract',
  'vanilla': 'vanilla extract',
  'honey': 'honey',
  'maple syrup': 'syrups, maple',
  'rice': 'rice, white, long-grain, regular, raw',
  'brown rice': 'rice, brown, long-grain, raw',
  'pasta': 'pasta, dry, enriched',
  'spaghetti': 'pasta, spaghetti, dry, enriched',
  'chicken breast': 'chicken, breast, meat only, raw',
  'chicken thigh': 'chicken, thigh, meat only, raw',
  'chicken': 'chicken, breast, meat only, raw',
  'ground beef': 'beef, ground, 80% lean, raw',
  'beef': 'beef, ground, 80% lean, raw',
  'salmon': 'fish, salmon, atlantic, raw',
  'shrimp': 'shrimp, raw',
  'bacon': 'pork, cured, bacon, raw',
  'garlic': 'garlic, raw',
  'onion': 'onion, raw',
  'onions': 'onion, raw',
  'tomato': 'tomatoes, red, ripe, raw',
  'tomatoes': 'tomatoes, red, ripe, raw',
  'potato': 'potatoes, russet, flesh and skin, raw',
  'potatoes': 'potatoes, russet, flesh and skin, raw',
  'carrot': 'carrots, raw',
  'carrots': 'carrots, raw',
  'celery': 'celery, raw',
  'bell pepper': 'peppers, sweet, red, raw',
  'spinach': 'spinach, raw',
  'broccoli': 'broccoli, raw',
  'lemon juice': 'lemon juice, raw',
  'lime juice': 'lime juice, raw',
  'soy sauce': 'soy sauce',
  'worcestershire sauce': 'sauce, worcestershire',
  'mayo': 'mayonnaise',
  'mayonnaise': 'mayonnaise',
  'ketchup': 'catsup',
  'mustard': 'mustard, prepared, yellow',
  'peanut butter': 'peanut butter, smooth',
  'almonds': 'nuts, almonds',
  'walnuts': 'nuts, walnuts, english',
  'pecans': 'nuts, pecans',
  'oats': 'oats, regular and quick, not fortified, dry',
  'rolled oats': 'oats, regular and quick, not fortified, dry',
  'cornstarch': 'cornstarch',
  'cream of tartar': 'cream of tartar',
  'yeast': 'yeast, baker\'s, active dry',
  'banana': 'bananas, raw',
  'bananas': 'bananas, raw',
  'apple': 'apples, raw, with skin',
  'apples': 'apples, raw, with skin',
  'blueberries': 'blueberries, raw',
  'strawberries': 'strawberries, raw',
};

const PENALTY_WORDS = [
  'cookie', 'cookies', 'cake', 'bread', 'muffin', 'pie', 'sauce',
  'soup', 'stew', 'casserole', 'mix', 'prepared', 'frozen', 'canned',
  'restaurant', 'fast food', 'infant', 'baby', 'formula',
];

function getSearchTerm(ingredientName) {
  const lower = ingredientName.trim().toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  const singular = lower.endsWith('s') ? lower.slice(0, -1) : null;
  if (singular && ALIASES[singular]) return ALIASES[singular];
  return ingredientName;
}

function scoreMatch(food, searchTerm) {
  const desc = food.description.toLowerCase();
  const search = searchTerm.toLowerCase();
  const searchWords = search.split(/[\s,]+/).filter(Boolean);

  let score = 0;
  for (const word of searchWords) {
    if (desc.includes(word)) score -= 10;
  }
  score += desc.length * 0.1;
  if (food.dataType === 'Foundation') score -= 20;
  if (food.dataType === 'SR Legacy') score -= 15;
  for (const word of PENALTY_WORDS) {
    if (desc.includes(word)) score += 25;
  }
  if (desc.includes('raw')) score -= 5;
  return score;
}

const MEASUREMENT_TO_GRAMS = {
  g: 1, gram: 1, grams: 1,
  kg: 1000,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6,
  cup: 140, cups: 140,
  tbsp: 15, tablespoon: 15, tablespoons: 15,
  tsp: 5, teaspoon: 5, teaspoons: 5,
  ml: 1, liter: 1000, liters: 1000,
  pinch: 0.5, dash: 0.5,
  clove: 3, cloves: 3,
  slice: 30, slices: 30,
  piece: 50, pieces: 50,
  can: 400, stick: 113,
};

function estimateGrams(quantity, measurement) {
  const qty = parseFloat(quantity) || 1;
  const unit = (measurement || '').trim().toLowerCase();
  if (!unit || unit === 'whole' || unit === 'each' || unit === 'large' || unit === 'medium' || unit === 'small') {
    return qty * 100;
  }
  const factor = MEASUREMENT_TO_GRAMS[unit];
  if (factor) return qty * factor;
  return qty * 100;
}

function extractNutrients(foodNutrients) {
  const result = {};
  for (const n of NUTRIENTS) {
    const match = foodNutrients.find(fn => fn.nutrientId === n.id);
    result[n.key] = match ? match.value : 0;
  }
  return result;
}

function roundNutrient(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export async function fetchNutritionForIngredient(ingredient) {
  const { quantity, measurement, ingredient: name } = ingredient;
  if (!name.trim()) return null;

  const searchTerm = getSearchTerm(name);
  const url = `${BASE_URL}?api_key=${API_KEY}&query=${encodeURIComponent(searchTerm)}&pageSize=5&dataType=Foundation,SR%20Legacy`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`USDA API error: ${res.status}`);

  const data = await res.json();
  if (!data.foods || data.foods.length === 0) return null;

  const scored = data.foods
    .map(food => ({ food, score: scoreMatch(food, searchTerm) }))
    .sort((a, b) => a.score - b.score);

  const food = scored[0].food;
  const per100g = extractNutrients(food.foodNutrients);
  const grams = estimateGrams(quantity, measurement);
  const scale = grams / 100;

  const nutrients = {};
  for (const n of NUTRIENTS) {
    nutrients[n.key] = roundNutrient(per100g[n.key] * scale, n.decimals);
  }

  return {
    name: food.description,
    matchedTo: name,
    grams: Math.round(grams),
    nutrients,
  };
}

export async function fetchNutritionForRecipe(ingredients) {
  const results = await Promise.all(
    ingredients.map(ing =>
      fetchNutritionForIngredient(ing).catch(() => null)
    )
  );

  const items = results.filter(Boolean);
  const totals = {};
  for (const n of NUTRIENTS) {
    totals[n.key] = 0;
  }

  for (const item of items) {
    for (const n of NUTRIENTS) {
      totals[n.key] += item.nutrients[n.key];
    }
  }

  for (const n of NUTRIENTS) {
    totals[n.key] = roundNutrient(totals[n.key], n.decimals);
  }

  return { items, totals };
}
