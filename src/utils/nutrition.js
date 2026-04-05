import { lookupFromSheet } from './sheetNutrition.js';
import { getSizeGrams } from './units.js';

const API_KEY = import.meta.env.VITE_USDA_API_KEY || 'DEMO_KEY';
const BASE_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

// All tracked nutrients with their USDA FoodData Central IDs, units, and rounding precision.
export const NUTRIENTS = [
  // Macros
  { key: 'calories',      label: 'Calories',        id: 1008, unit: '',    decimals: 0 },
  { key: 'protein',       label: 'Protein',         id: 1003, unit: 'g',   decimals: 0 },
  { key: 'carbs',         label: 'Carbs',           id: 1005, unit: 'g',   decimals: 0 },
  { key: 'fat',           label: 'Fat',             id: 1004, unit: 'g',   decimals: 0 },
  { key: 'saturatedFat',  label: 'Saturated Fat',   id: 1258, unit: 'g',   decimals: 1 },
  { key: 'transFat',      label: 'Trans Fat',       id: 1257, unit: 'g',   decimals: 1 },
  { key: 'cholesterol',   label: 'Cholesterol',     id: 1253, unit: 'mg',  decimals: 0 },
  { key: 'sugar',         label: 'Sugar',           id: 2000, unit: 'g',   decimals: 0 },
  { key: 'addedSugar',    label: 'Added Sugar',     id: 1235, unit: 'g',   decimals: 0 },
  { key: 'fiber',         label: 'Fiber',           id: 1079, unit: 'g',   decimals: 0 },
  // Minerals
  { key: 'sodium',        label: 'Sodium',          id: 1093, unit: 'mg',  decimals: 0 },
  { key: 'potassium',     label: 'Potassium',       id: 1092, unit: 'mg',  decimals: 0 },
  { key: 'calcium',       label: 'Calcium',         id: 1087, unit: 'mg',  decimals: 0 },
  { key: 'iron',          label: 'Iron',            id: 1089, unit: 'mg',  decimals: 1 },
  { key: 'magnesium',     label: 'Magnesium',       id: 1090, unit: 'mg',  decimals: 0 },
  { key: 'zinc',          label: 'Zinc',            id: 1095, unit: 'mg',  decimals: 1 },
  { key: 'phosphorus',    label: 'Phosphorus',      id: 1091, unit: 'mg',  decimals: 0 },
  { key: 'selenium',      label: 'Selenium',        id: 1103, unit: 'µg',  decimals: 1 },
  { key: 'copper',        label: 'Copper',          id: 1098, unit: 'mg',  decimals: 2 },
  { key: 'manganese',     label: 'Manganese',       id: 1101, unit: 'mg',  decimals: 2 },
  { key: 'chromium',      label: 'Chromium',        id: 1096, unit: 'µg',  decimals: 0 },
  // Vitamins
  { key: 'vitaminA',      label: 'Vitamin A',       id: 1106, unit: 'µg',  decimals: 0 },
  { key: 'vitaminC',      label: 'Vitamin C',       id: 1162, unit: 'mg',  decimals: 0 },
  { key: 'vitaminD',      label: 'Vitamin D',       id: 1114, unit: 'µg',  decimals: 1 },
  { key: 'vitaminE',      label: 'Vitamin E',       id: 1109, unit: 'mg',  decimals: 1 },
  { key: 'vitaminK',      label: 'Vitamin K',       id: 1185, unit: 'µg',  decimals: 0 },
  { key: 'vitaminB1',     label: 'Thiamin (B1)',    id: 1165, unit: 'mg',  decimals: 2 },
  { key: 'vitaminB2',     label: 'Riboflavin (B2)', id: 1166, unit: 'mg',  decimals: 2 },
  { key: 'vitaminB3',     label: 'Niacin (B3)',     id: 1167, unit: 'mg',  decimals: 1 },
  { key: 'vitaminB5',     label: 'Pantothenic Acid (B5)', id: 1170, unit: 'mg', decimals: 1 },
  { key: 'vitaminB6',     label: 'Vitamin B6',      id: 1175, unit: 'mg',  decimals: 2 },
  { key: 'vitaminB7',     label: 'Biotin (B7)',     id: 1176, unit: 'µg',  decimals: 0 },
  { key: 'vitaminB9',     label: 'Folate (B9)',     id: 1177, unit: 'µg',  decimals: 0 },
  { key: 'vitaminB12',    label: 'Vitamin B12',     id: 1178, unit: 'µg',  decimals: 1 },
  // Amino Acids
  { key: 'leucine',       label: 'Leucine',         id: 1213, unit: 'g',   decimals: 1 },
  { key: 'isoleucine',    label: 'Isoleucine',      id: 1212, unit: 'g',   decimals: 1 },
  { key: 'valine',        label: 'Valine',          id: 1219, unit: 'g',   decimals: 1 },
  { key: 'histidine',     label: 'Histidine',       id: 1221, unit: 'g',   decimals: 1 },
  { key: 'lysine',        label: 'Lysine',          id: 1214, unit: 'g',   decimals: 1 },
  { key: 'methionine',    label: 'Methionine',      id: 1215, unit: 'g',   decimals: 1 },
  { key: 'phenylalanine', label: 'Phenylalanine',   id: 1217, unit: 'g',   decimals: 1 },
  { key: 'threonine',     label: 'Threonine',       id: 1211, unit: 'g',   decimals: 1 },
  { key: 'tryptophan',    label: 'Tryptophan',      id: 1210, unit: 'g',   decimals: 2 },
  // Fatty Acids
  { key: 'omega3',        label: 'Omega-3',         id: 1404, unit: 'g',   decimals: 1 },
  { key: 'omega6',        label: 'Omega-6',         id: 1316, unit: 'g',   decimals: 1 },
  // Servings
  { key: 'vegServings',   label: 'Veg Servings',    id: null, unit: '',    decimals: 0 },
  { key: 'fruitServings', label: 'Fruit Servings',  id: null, unit: '',    decimals: 0 },
];

// 1 serving of vegetables ≈ 80g (WHO standard)
const VEG_SERVING_GRAMS = 80;

const VEGETABLE_KEYWORDS = [
  'spinach', 'kale', 'broccoli', 'cauliflower', 'carrot', 'celery',
  'bell pepper', 'pepper', 'zucchini', 'cucumber', 'asparagus',
  'green bean', 'string bean', 'pea', 'corn', 'eggplant',
  'cabbage', 'brussels sprout', 'brussel sprout', 'lettuce', 'arugula',
  'collard green', 'sweet potato', 'potato', 'beet', 'radish',
  'mushroom', 'shiitake', 'tomato', 'onion', 'shallot', 'leek',
  'artichoke', 'squash', 'pumpkin', 'turnip', 'parsnip', 'okra',
  'bok choy', 'chard', 'watercress', 'endive', 'fennel',
  'spring mix', 'coleslaw', 'edamame', 'green pea',
  'cauliflower rice', 'spaghetti squash',
];

// Ingredient forms that are NOT real vegetable servings
const VEG_EXCLUDE = [
  'powder', 'stock', 'broth', 'oil', 'extract', 'seasoning',
  'sauce', 'vinegar', 'dried', 'flakes', 'paste',
];

export function isVegetable(ingredientName) {
  const lower = (ingredientName || '').toLowerCase();
  if (VEG_EXCLUDE.some(ex => lower.includes(ex))) return false;
  return VEGETABLE_KEYWORDS.some(v => lower.includes(v));
}

export function computeVegServings(ingredientName, grams) {
  if (!isVegetable(ingredientName)) return 0;
  return Math.round((grams / VEG_SERVING_GRAMS) * 10) / 10;
}

// 1 serving of fruit ≈ 80g (WHO standard, same as vegetables)
const FRUIT_SERVING_GRAMS = 80;

const FRUIT_KEYWORDS = [
  'apple', 'banana', 'orange', 'grape', 'strawberry', 'blueberry',
  'raspberry', 'blackberry', 'mango', 'pineapple', 'peach', 'pear',
  'plum', 'cherry', 'watermelon', 'cantaloupe', 'honeydew', 'kiwi',
  'papaya', 'guava', 'lychee', 'passion fruit', 'pomegranate',
  'fig', 'date', 'apricot', 'nectarine', 'tangerine', 'clementine',
  'grapefruit', 'lemon', 'lime', 'coconut', 'avocado',
  'cranberry', 'gooseberry', 'dragonfruit', 'starfruit',
  'persimmon', 'jackfruit', 'durian', 'plantain',
  'mixed berries', 'berries', 'fruit',
];

// Ingredient forms that are NOT real fruit servings
const FRUIT_EXCLUDE = [
  'powder', 'stock', 'broth', 'oil', 'extract', 'seasoning',
  'sauce', 'vinegar', 'dried', 'flakes', 'paste', 'juice', 'jam',
  'jelly', 'preserve', 'syrup', 'concentrate', 'zest',
];

export function isFruit(ingredientName) {
  const lower = (ingredientName || '').toLowerCase();
  if (FRUIT_EXCLUDE.some(ex => lower.includes(ex))) return false;
  return FRUIT_KEYWORDS.some(f => lower.includes(f));
}

export function computeFruitServings(ingredientName, grams) {
  if (!isFruit(ingredientName)) return 0;
  return Math.round((grams / FRUIT_SERVING_GRAMS) * 10) / 10;
}

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
  'milk': 'milk, whole, 3.25% milkfat',
  'whole milk': 'milk, whole, 3.25% milkfat',
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
  // Clean: strip parenthetical notes, "or" alternatives, and special chars
  let cleaned = ingredientName.trim()
    .replace(/\([^)]*\)/g, '')           // remove (anything in parens)
    .replace(/\b(may substitute|or)\b.*/i, '') // remove "or ..." / "may substitute ..."
    .replace(/[^\w\s'-]/g, '')           // remove special characters except apostrophe/hyphen
    .replace(/\s{2,}/g, ' ')            // collapse multiple spaces
    .trim();
  if (!cleaned) cleaned = ingredientName.trim().replace(/[^\w\s]/g, '').trim();
  const lower = cleaned.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  const singular = lower.endsWith('s') ? lower.slice(0, -1) : null;
  if (singular && ALIASES[singular]) return ALIASES[singular];
  return cleaned;
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

function estimateGrams(quantity, measurement, ingredientName) {
  const rawQty = parseFloat(quantity);
  const qty = isNaN(rawQty) ? 1 : rawQty;
  const unit = (measurement || '').trim().toLowerCase();

  // Check for size-based measurements with ingredient-specific weights
  if (unit === 'small' || unit === 'medium' || unit === 'large' || unit === 'extra large' || unit === 'xl' || unit === 'regular') {
    const sizeGrams = getSizeGrams(ingredientName, unit);
    if (sizeGrams) return qty * sizeGrams;
  }

  if (!unit || unit === 'whole' || unit === 'each') {
    return qty * 100;
  }
  const factor = MEASUREMENT_TO_GRAMS[unit];
  if (factor) return qty * factor;
  return qty * 100;
}

function extractNutrients(foodNutrients) {
  const result = {};
  for (const n of NUTRIENTS) {
    if (n.id === null) { result[n.key] = 0; continue; }
    const match = foodNutrients.find(fn => fn.nutrientId === n.id);
    result[n.key] = match ? match.value : 0;
  }
  return result;
}

function roundNutrient(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function fetchFromUSDA(ingredient, dataTypes = 'Foundation,SR%20Legacy') {
  const { quantity, measurement, ingredient: name } = ingredient;
  if (!name.trim()) return null;

  const searchTerm = getSearchTerm(name);
  const url = `${BASE_URL}?api_key=${API_KEY}&query=${encodeURIComponent(searchTerm)}&pageSize=5&dataType=${dataTypes}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`USDA API error: ${res.status}`);

  const data = await res.json();
  if (!data.foods || data.foods.length === 0) return null;

  const scored = data.foods
    .map(food => ({ food, score: scoreMatch(food, searchTerm) }))
    .sort((a, b) => a.score - b.score);

  const food = scored[0].food;
  const per100g = extractNutrients(food.foodNutrients);
  const grams = estimateGrams(quantity, measurement, name);
  const scale = grams / 100;

  const nutrients = {};
  for (const n of NUTRIENTS) {
    nutrients[n.key] = roundNutrient(per100g[n.key] * scale, n.decimals);
  }
  nutrients.vegServings = computeVegServings(name, grams);
  nutrients.fruitServings = computeFruitServings(name, grams);

  const sourceLabel = dataTypes.includes('Branded') ? 'usda-branded' : 'usda';
  return {
    name: food.description,
    matchedTo: name,
    grams: Math.round(grams),
    nutrients,
    source: sourceLabel,
  };
}

// Open Food Facts name-based search (international coverage)
const OFF_SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';

async function fetchFromOpenFoodFacts(ingredient) {
  const { quantity, measurement, ingredient: name } = ingredient;
  if (!name.trim()) return null;

  const url = `${OFF_SEARCH_URL}?search_terms=${encodeURIComponent(name)}&search_simple=1&action=process&json=1&page_size=3&fields=product_name,nutriments,serving_quantity`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (!data.products || data.products.length === 0) return null;

  // Pick first product with nutriment data
  const product = data.products.find(p => p.nutriments && p.nutriments['energy-kcal_100g'] != null);
  if (!product) return null;

  const n = product.nutriments;
  const grams = estimateGrams(quantity, measurement, name);
  const scale = grams / 100;

  const toMg = (key) => {
    const val = n[key + '_100g'] || 0;
    const unit = n[key + '_unit'] || 'g';
    if (unit === 'mg') return val;
    if (unit === 'µg' || unit === 'mcg') return val / 1000;
    return val * 1000;
  };
  const toMcg = (key) => {
    const val = n[key + '_100g'] || 0;
    const unit = n[key + '_unit'] || 'g';
    if (unit === 'µg' || unit === 'mcg') return val;
    if (unit === 'mg') return val * 1000;
    return val * 1000000;
  };

  const nutrients = {
    calories:     roundNutrient((n['energy-kcal_100g'] || 0) * scale, 0),
    protein:      roundNutrient((n['proteins_100g'] || 0) * scale, 0),
    carbs:        roundNutrient((n['carbohydrates_100g'] || 0) * scale, 0),
    fat:          roundNutrient((n['fat_100g'] || 0) * scale, 0),
    saturatedFat: roundNutrient((n['saturated-fat_100g'] || 0) * scale, 1),
    sugar:        roundNutrient((n['sugars_100g'] || 0) * scale, 0),
    addedSugar:   roundNutrient((n['added-sugars_100g'] || 0) * scale, 0),
    fiber:        roundNutrient((n['fiber_100g'] || 0) * scale, 0),
    sodium:       roundNutrient(toMg('sodium') * scale, 0),
    potassium:    roundNutrient(toMg('potassium') * scale, 0),
    calcium:      roundNutrient(toMg('calcium') * scale, 0),
    iron:         roundNutrient(toMg('iron') * scale, 1),
    magnesium:    roundNutrient(toMg('magnesium') * scale, 0),
    zinc:         roundNutrient(toMg('zinc') * scale, 1),
    vitaminB12:   roundNutrient(toMcg('vitamin-b12') * scale, 1),
    vitaminC:     roundNutrient(toMg('vitamin-c') * scale, 0),
    leucine:      0,
    omega3:       0,
    vegServings:  computeVegServings(name, grams),
    fruitServings: computeFruitServings(name, grams),
  };

  return {
    name: product.product_name || name,
    matchedTo: name,
    grams: Math.round(grams),
    nutrients,
    source: 'openfoodfacts',
  };
}

// Canadian Nutrient File (CNF) via Canada Open Data API
const CNF_SEARCH_URL = 'https://food-nutrition.canada.ca/api/canadian-nutrient-file/food/?lang=en&type=json';

async function fetchFromCNF(ingredient) {
  const { quantity, measurement, ingredient: name } = ingredient;
  if (!name.trim()) return null;

  try {
    const searchUrl = `${CNF_SEARCH_URL}&name=${encodeURIComponent(name)}`;
    const res = await fetch(searchUrl);
    if (!res.ok) return null;

    const foods = await res.json();
    if (!Array.isArray(foods) || foods.length === 0) return null;

    const food = foods[0];
    const foodCode = food.food_code;

    // Fetch nutrients for this food
    const nutUrl = `https://food-nutrition.canada.ca/api/canadian-nutrient-file/nutrientamount/?lang=en&type=json&id=${foodCode}`;
    const nutRes = await fetch(nutUrl);
    if (!nutRes.ok) return null;

    const nutData = await nutRes.json();
    if (!Array.isArray(nutData)) return null;

    // CNF nutrient IDs (similar to USDA)
    const CNF_MAP = {
      208: 'calories', 203: 'protein', 205: 'carbs', 204: 'fat',
      606: 'saturatedFat', 605: 'transFat', 601: 'cholesterol',
      269: 'sugar', 291: 'fiber',
      307: 'sodium', 306: 'potassium', 301: 'calcium', 303: 'iron',
      304: 'magnesium', 309: 'zinc', 305: 'phosphorus', 317: 'selenium',
      312: 'copper', 315: 'manganese',
      320: 'vitaminA', 401: 'vitaminC', 324: 'vitaminD', 323: 'vitaminE', 430: 'vitaminK',
      404: 'vitaminB1', 405: 'vitaminB2', 406: 'vitaminB3', 410: 'vitaminB5',
      415: 'vitaminB6', 418: 'vitaminB12', 417: 'vitaminB9',
      504: 'leucine', 503: 'isoleucine', 510: 'valine', 512: 'histidine',
      505: 'lysine', 506: 'methionine', 508: 'phenylalanine', 502: 'threonine', 501: 'tryptophan',
    };

    const per100g = {};
    for (const entry of nutData) {
      const key = CNF_MAP[entry.nutrient_name_id || entry.nutrient_id];
      if (key) per100g[key] = entry.nutrient_value || 0;
    }

    const grams = estimateGrams(quantity, measurement, name);
    const scale = grams / 100;

    const nutrients = {};
    for (const n of NUTRIENTS) {
      nutrients[n.key] = roundNutrient((per100g[n.key] || 0) * scale, n.decimals);
    }
    nutrients.vegServings = computeVegServings(name, grams);
    nutrients.fruitServings = computeFruitServings(name, grams);

    return {
      name: food.food_description || name,
      matchedTo: name,
      grams: Math.round(grams),
      nutrients,
      source: 'cnf',
    };
  } catch {
    return null;
  }
}

// Multi-source lookup chain:
// 1. Custom Sheet (user-curated, highest priority)
// 2. USDA Foundation + SR Legacy (gold-standard raw ingredient data)
// 3. USDA Branded (packaged/restaurant products via FDC UPC)
// 4. Open Food Facts (international product data — covers BLS, NEVO, CoFID, NUTTAB, etc.)
// 5. Canadian Nutrient File (CNF — Canadian foods)
export async function fetchNutritionForIngredient(ingredient) {
  // 1. Custom sheet
  const sheetResult = await lookupFromSheet(ingredient).catch(() => null);
  if (sheetResult) return sheetResult;

  // 2. USDA Foundation + SR Legacy
  const usdaResult = await fetchFromUSDA(ingredient, 'Foundation,SR%20Legacy').catch(() => null);
  if (usdaResult) return usdaResult;

  // 3. USDA Branded (FDC UPC / Survey)
  const brandedResult = await fetchFromUSDA(ingredient, 'Branded,Survey%20(FNDDS)').catch(() => null);
  if (brandedResult) return brandedResult;

  // 4. Open Food Facts (international)
  const offResult = await fetchFromOpenFoodFacts(ingredient).catch(() => null);
  if (offResult) return offResult;

  // 5. Canadian Nutrient File
  const cnfResult = await fetchFromCNF(ingredient).catch(() => null);
  if (cnfResult) return cnfResult;

  return null;
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
