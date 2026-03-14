// Vercel serverless function: looks up nutrition data from USDA FoodData Central
// with estimation for missing nutrients (leucine, omega-3, etc.)
// Auto-routed at /api/nutrition-lookup

const USDA_API_KEY = process.env.VITE_USDA_API_KEY || process.env.USDA_API_KEY || 'DEMO_KEY';
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

// USDA nutrient IDs
const NUTRIENT_IDS = {
  calories: 1008,
  protein: 1003,
  carbs: 1005,
  fat: 1004,
  saturatedFat: 1258,
  transFat: 1257,
  cholesterol: 1253,
  sugar: 2000,
  addedSugar: 1235,
  fiber: 1079,
  sodium: 1093,
  potassium: 1092,
  calcium: 1087,
  iron: 1089,
  magnesium: 1090,
  zinc: 1095,
  phosphorus: 1091,
  selenium: 1103,
  copper: 1098,
  manganese: 1101,
  chromium: 1096,
  vitaminA: 1106,
  vitaminC: 1162,
  vitaminD: 1114,
  vitaminE: 1109,
  vitaminK: 1185,
  vitaminB1: 1165,
  vitaminB2: 1166,
  vitaminB3: 1167,
  vitaminB5: 1170,
  vitaminB6: 1175,
  vitaminB7: 1176,
  vitaminB9: 1177,
  vitaminB12: 1178,
  leucine: 1213,
  isoleucine: 1212,
  valine: 1219,
  histidine: 1221,
  lysine: 1214,
  methionine: 1215,
  phenylalanine: 1217,
  threonine: 1211,
  tryptophan: 1210,
  omega3DHA: 1272,
  omega3EPA: 1278,
  omega3ALA: 1404,
  omega6: 1316,
};

// Typical leucine content as % of total protein by food category
const LEUCINE_PROTEIN_RATIOS = {
  dairy: 0.10,    // ~10% of protein
  egg: 0.086,
  beef: 0.081,
  pork: 0.079,
  chicken: 0.075,
  turkey: 0.076,
  fish: 0.081,
  seafood: 0.078,
  soy: 0.079,
  legume: 0.078,
  grain: 0.070,
  wheat: 0.069,
  rice: 0.082,
  oat: 0.076,
  corn: 0.122,
  nut: 0.066,
  seed: 0.067,
  vegetable: 0.059,
  fruit: 0.050,
  default: 0.075,
};

// Common portion sizes in grams
const PORTION_WEIGHTS = {
  slice: { bread: 50, cheese: 28, pizza: 107, cake: 80, default: 30 },
  cup: { milk: 244, flour: 125, rice: 185, oats: 80, sugar: 200, default: 140 },
  tbsp: { default: 15 },
  tsp: { default: 5 },
  oz: { default: 28.35 },
  piece: { default: 100 },
  can: { default: 354 },
  serving: { default: 100 },
  medium: { apple: 182, banana: 118, orange: 131, potato: 150, egg: 50, default: 120 },
  large: { egg: 56, apple: 223, banana: 136, potato: 213, default: 160 },
  small: { egg: 38, apple: 149, banana: 101, default: 80 },
};

function classifyFood(description) {
  const d = description.toLowerCase();
  if (/milk|cheese|yogurt|cream|butter|whey|casein/.test(d)) return 'dairy';
  if (/\begg\b/.test(d)) return 'egg';
  if (/beef|steak|ground beef|veal/.test(d)) return 'beef';
  if (/pork|ham|bacon|sausage/.test(d)) return 'pork';
  if (/chicken/.test(d)) return 'chicken';
  if (/turkey/.test(d)) return 'turkey';
  if (/salmon|tuna|cod|tilapia|trout|bass|halibut|sardine|mackerel|fish/.test(d)) return 'fish';
  if (/shrimp|crab|lobster|clam|mussel|oyster|scallop|seafood/.test(d)) return 'seafood';
  if (/soy|tofu|tempeh|edamame/.test(d)) return 'soy';
  if (/bean|lentil|chickpea|pea(?!nut)|legume/.test(d)) return 'legume';
  if (/wheat|bread|pasta|flour|tortilla|bagel|croissant/.test(d)) return 'wheat';
  if (/\brice\b/.test(d)) return 'rice';
  if (/\boat\b|oatmeal|granola/.test(d)) return 'oat';
  if (/\bcorn\b|maize|polenta/.test(d)) return 'corn';
  if (/cereal|grain|quinoa|barley|millet/.test(d)) return 'grain';
  if (/almond|walnut|cashew|pecan|pistachio|peanut|nut|hazelnut/.test(d)) return 'nut';
  if (/seed|chia|flax|sunflower|pumpkin seed|hemp/.test(d)) return 'seed';
  if (/apple|banana|orange|berry|grape|mango|peach|pear|melon|fruit/.test(d)) return 'fruit';
  return 'default';
}

function estimateLeucine(protein, foodDescription) {
  const category = classifyFood(foodDescription);
  const ratio = LEUCINE_PROTEIN_RATIOS[category] || LEUCINE_PROTEIN_RATIOS.default;
  return Math.round(protein * ratio * 1000) / 1000;
}

function parsePortionFromText(text) {
  // Try to extract quantity, unit, and ingredient from text like "2 cups rice" or "50g chicken breast"
  const cleaned = text.trim();

  // Match patterns like "100g", "50 g", "2 cups", "1 slice", "a medium apple"
  const match = cleaned.match(
    /^(?:(\d+(?:\.\d+)?)\s*(?:x\s*)?)?(?:(g|oz|cup|cups|tbsp|tsp|slice|slices|piece|pieces|can|cans|serving|servings|medium|large|small|lb|lbs|kg)\s+)?(?:of\s+)?(.+)$/i
  );

  // Also try "ingredient, Xg" format
  const commaMatch = cleaned.match(/^(.+?),?\s+(\d+(?:\.\d+)?)\s*(g|oz|ml|cups?|tbsp|tsp|lbs?|kg)$/i);

  if (commaMatch) {
    return {
      ingredient: commaMatch[1].trim(),
      quantity: parseFloat(commaMatch[2]) || 1,
      unit: commaMatch[3].toLowerCase().replace(/s$/, ''),
    };
  }

  if (match) {
    const quantity = match[1] ? parseFloat(match[1]) : 1;
    const unit = match[2] ? match[2].toLowerCase().replace(/s$/, '') : null;
    const ingredient = match[3] ? match[3].trim() : cleaned;
    return { ingredient, quantity, unit };
  }

  return { ingredient: cleaned, quantity: 1, unit: null };
}

function resolveGrams(quantity, unit, ingredient) {
  if (!unit) return quantity * 100; // default to 100g per serving
  if (unit === 'g') return quantity;
  if (unit === 'kg') return quantity * 1000;
  if (unit === 'lb') return quantity * 453.6;
  if (unit === 'ml') return quantity; // approximate 1ml = 1g for most foods

  const portionMap = PORTION_WEIGHTS[unit];
  if (portionMap) {
    const ingLower = ingredient.toLowerCase();
    for (const [key, grams] of Object.entries(portionMap)) {
      if (key !== 'default' && ingLower.includes(key)) {
        return quantity * grams;
      }
    }
    return quantity * (portionMap.default || 100);
  }

  return quantity * 100;
}

function extractNutrient(foodNutrients, nutrientId) {
  const match = foodNutrients.find(fn => fn.nutrientId === nutrientId);
  return match ? match.value : null;
}

function fmtVal(val) {
  if (val == null || val === 0) return '';
  const s = String(Math.round(val * 100) / 100);
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

// Build a row from USDA food data
function buildRowFromUSDA(food, grams, scaleFactor, quantity, unit) {
  const nutrients = food.foodNutrients || [];
  const per100 = {};
  for (const [key, nid] of Object.entries(NUTRIENT_IDS)) {
    per100[key] = extractNutrient(nutrients, nid);
  }

  const row = {
    ingredient: food.description,
    grams: String(Math.round(grams)),
    measurement: unit ? `${quantity} ${unit}${quantity > 1 ? 's' : ''}` : `${Math.round(grams)}g`,
  };

  const nutrientKeys = ['calories', 'protein', 'carbs', 'fat', 'saturatedFat', 'transFat',
    'cholesterol', 'sugar', 'addedSugar', 'fiber', 'sodium', 'potassium', 'calcium', 'iron',
    'magnesium', 'zinc', 'phosphorus', 'selenium', 'copper', 'manganese', 'chromium',
    'vitaminA', 'vitaminC', 'vitaminD', 'vitaminE', 'vitaminK',
    'vitaminB1', 'vitaminB2', 'vitaminB3', 'vitaminB5', 'vitaminB6', 'vitaminB7', 'vitaminB9', 'vitaminB12'];

  for (const key of nutrientKeys) {
    const val = per100[key];
    row[key] = val != null ? fmtVal(val * scaleFactor) : '';
  }

  // Amino acids (USDA stores in mg, convert to g)
  const aminoKeys = ['leucine', 'isoleucine', 'valine', 'histidine', 'lysine', 'methionine', 'phenylalanine', 'threonine', 'tryptophan'];
  const protein = per100.protein || 0;
  for (const key of aminoKeys) {
    const val = per100[key];
    if (val != null && val > 0) {
      row[key] = fmtVal(val * scaleFactor / 1000); // mg → g
    } else if (key === 'leucine' && protein > 0) {
      row[key] = fmtVal(estimateLeucine(protein * scaleFactor, food.description));
    } else {
      row[key] = '';
    }
  }

  // Omega-3: sum DHA + EPA + ALA
  const dha = per100.omega3DHA || 0;
  const epa = per100.omega3EPA || 0;
  const ala = per100.omega3ALA || 0;
  const totalOmega3 = (dha + epa + ala) * scaleFactor;
  row.omega3 = totalOmega3 > 0 ? fmtVal(totalOmega3) : '';
  row.omega6 = per100.omega6 != null ? fmtVal(per100.omega6 * scaleFactor) : '';

  const cal = parseFloat(row.calories) || 0;
  const prot = parseFloat(row.protein) || 0;
  const fib = parseFloat(row.fiber) || 0;
  row.proteinPerCal = cal > 0 ? fmtVal(prot / cal) : '';
  row.fiberPerCal = cal > 0 ? fmtVal(fib / cal) : '';
  row.notes = `USDA ${food.dataType || ''} #${food.fdcId}`;

  return row;
}

async function lookupFromUSDA(ingredient, grams, scaleFactor, quantity, unit, dataTypes) {
  const url = `${USDA_SEARCH_URL}?api_key=${USDA_API_KEY}&query=${encodeURIComponent(ingredient)}&pageSize=3&dataType=${dataTypes}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.foods || data.foods.length === 0) return null;
  return buildRowFromUSDA(data.foods[0], grams, scaleFactor, quantity, unit);
}

// Open Food Facts name-based search
async function lookupFromOpenFoodFacts(ingredient, grams, scaleFactor, quantity, unit) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(ingredient)}&search_simple=1&action=process&json=1&page_size=3&fields=product_name,nutriments`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.products || data.products.length === 0) return null;

  const product = data.products.find(p => p.nutriments && p.nutriments['energy-kcal_100g'] != null);
  if (!product) return null;

  const n = product.nutriments;
  const toMg = (key) => {
    const val = n[key + '_100g'] || 0;
    const u = n[key + '_unit'] || 'g';
    if (u === 'mg') return val;
    if (u === 'µg' || u === 'mcg') return val / 1000;
    return val * 1000;
  };
  const toMcg = (key) => {
    const val = n[key + '_100g'] || 0;
    const u = n[key + '_unit'] || 'g';
    if (u === 'µg' || u === 'mcg') return val;
    if (u === 'mg') return val * 1000;
    return val * 1000000;
  };

  const protein = (n['proteins_100g'] || 0) * scaleFactor;
  const row = {
    ingredient: product.product_name || ingredient,
    grams: String(Math.round(grams)),
    measurement: unit ? `${quantity} ${unit}${quantity > 1 ? 's' : ''}` : `${Math.round(grams)}g`,
    calories: fmtVal((n['energy-kcal_100g'] || 0) * scaleFactor),
    protein: fmtVal(protein),
    carbs: fmtVal((n['carbohydrates_100g'] || 0) * scaleFactor),
    fat: fmtVal((n['fat_100g'] || 0) * scaleFactor),
    saturatedFat: fmtVal((n['saturated-fat_100g'] || 0) * scaleFactor),
    sugar: fmtVal((n['sugars_100g'] || 0) * scaleFactor),
    addedSugar: fmtVal((n['added-sugars_100g'] || 0) * scaleFactor),
    fiber: fmtVal((n['fiber_100g'] || 0) * scaleFactor),
    sodium: fmtVal(toMg('sodium') * scaleFactor),
    potassium: fmtVal(toMg('potassium') * scaleFactor),
    calcium: fmtVal(toMg('calcium') * scaleFactor),
    iron: fmtVal(toMg('iron') * scaleFactor),
    magnesium: fmtVal(toMg('magnesium') * scaleFactor),
    zinc: fmtVal(toMg('zinc') * scaleFactor),
    vitaminB12: fmtVal(toMcg('vitamin-b12') * scaleFactor),
    vitaminC: fmtVal(toMg('vitamin-c') * scaleFactor),
    leucine: protein > 0 ? fmtVal(estimateLeucine(protein, product.product_name || ingredient)) : '',
    omega3: '',
    notes: `Open Food Facts`,
  };
  const cal = parseFloat(row.calories) || 0;
  const prot = parseFloat(row.protein) || 0;
  const fib = parseFloat(row.fiber) || 0;
  row.proteinPerCal = cal > 0 ? fmtVal(prot / cal) : '';
  row.fiberPerCal = cal > 0 ? fmtVal(fib / cal) : '';
  return row;
}

// Canadian Nutrient File (CNF)
async function lookupFromCNF(ingredient, grams, scaleFactor, quantity, unit) {
  const searchUrl = `https://food-nutrition.canada.ca/api/canadian-nutrient-file/food/?lang=en&type=json&name=${encodeURIComponent(ingredient)}`;
  const res = await fetch(searchUrl);
  if (!res.ok) return null;
  const foods = await res.json();
  if (!Array.isArray(foods) || foods.length === 0) return null;

  const food = foods[0];
  const nutUrl = `https://food-nutrition.canada.ca/api/canadian-nutrient-file/nutrientamount/?lang=en&type=json&id=${food.food_code}`;
  const nutRes = await fetch(nutUrl);
  if (!nutRes.ok) return null;
  const nutData = await nutRes.json();
  if (!Array.isArray(nutData)) return null;

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

  const per100 = {};
  for (const entry of nutData) {
    const key = CNF_MAP[entry.nutrient_name_id || entry.nutrient_id];
    if (key) per100[key] = entry.nutrient_value || 0;
  }

  const nutrientKeys = ['calories', 'protein', 'carbs', 'fat', 'saturatedFat', 'transFat',
    'cholesterol', 'sugar', 'addedSugar', 'fiber', 'sodium', 'potassium', 'calcium', 'iron',
    'magnesium', 'zinc', 'phosphorus', 'selenium', 'copper', 'manganese',
    'vitaminA', 'vitaminC', 'vitaminD', 'vitaminE', 'vitaminK',
    'vitaminB1', 'vitaminB2', 'vitaminB3', 'vitaminB5', 'vitaminB6', 'vitaminB9', 'vitaminB12'];

  const row = {
    ingredient: food.food_description || ingredient,
    grams: String(Math.round(grams)),
    measurement: unit ? `${quantity} ${unit}${quantity > 1 ? 's' : ''}` : `${Math.round(grams)}g`,
  };

  for (const key of nutrientKeys) {
    row[key] = per100[key] != null ? fmtVal(per100[key] * scaleFactor) : '';
  }

  // Amino acids (CNF stores in mg, convert to g)
  const protein = per100.protein || 0;
  const aminoKeys = ['leucine', 'isoleucine', 'valine', 'histidine', 'lysine', 'methionine', 'phenylalanine', 'threonine', 'tryptophan'];
  for (const key of aminoKeys) {
    const val = per100[key];
    if (val != null && val > 0) {
      row[key] = fmtVal(val * scaleFactor / 1000);
    } else if (key === 'leucine' && protein > 0) {
      row[key] = fmtVal(estimateLeucine(protein * scaleFactor, food.food_description || ingredient));
    } else {
      row[key] = '';
    }
  }
  row.omega3 = '';
  row.omega6 = '';

  const cal = parseFloat(row.calories) || 0;
  const prot = parseFloat(row.protein) || 0;
  const fib = parseFloat(row.fiber) || 0;
  row.proteinPerCal = cal > 0 ? fmtVal(prot / cal) : '';
  row.fiberPerCal = cal > 0 ? fmtVal(fib / cal) : '';
  row.notes = `Canadian Nutrient File #${food.food_code}`;
  return row;
}

// Multi-source lookup chain:
// 1. USDA Foundation + SR Legacy (gold-standard raw ingredient data)
// 2. USDA Branded + Survey/FNDDS (packaged foods, restaurant items)
// 3. Open Food Facts (international — aggregates BLS, NEVO, CoFID, NUTTAB, Frida, IFCDB data)
// 4. Canadian Nutrient File (CNF)
async function lookupIngredient(ingredientText) {
  const { ingredient, quantity, unit } = parsePortionFromText(ingredientText);
  const grams = resolveGrams(quantity, unit, ingredient);
  const scaleFactor = grams / 100;

  // 1. USDA Foundation + SR Legacy
  const usdaResult = await lookupFromUSDA(ingredient, grams, scaleFactor, quantity, unit, 'Foundation,SR%20Legacy').catch(() => null);
  if (usdaResult) return usdaResult;

  // 2. USDA Branded + Survey
  const brandedResult = await lookupFromUSDA(ingredient, grams, scaleFactor, quantity, unit, 'Branded,Survey%20(FNDDS)').catch(() => null);
  if (brandedResult) return brandedResult;

  // 3. Open Food Facts
  const offResult = await lookupFromOpenFoodFacts(ingredient, grams, scaleFactor, quantity, unit).catch(() => null);
  if (offResult) return offResult;

  // 4. Canadian Nutrient File
  const cnfResult = await lookupFromCNF(ingredient, grams, scaleFactor, quantity, unit).catch(() => null);
  if (cnfResult) return cnfResult;

  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, ingredients } = req.body || {};

  try {
    if (ingredients && Array.isArray(ingredients)) {
      // Multiple ingredients passed as array
      const results = [];
      for (const ing of ingredients) {
        const result = await lookupIngredient(ing);
        if (result) results.push(result);
      }
      return res.status(200).json(results);
    }

    if (text) {
      // Parse text: split by newlines, commas, or semicolons
      const lines = text
        .split(/[\n;]+/)
        .map(l => l.trim())
        .filter(l => l.length > 0 && !/^(nutrition|facts|per serving|amount|daily value|ingredients:)/i.test(l));

      if (lines.length === 0) {
        return res.status(400).json({ error: 'No ingredients found in text' });
      }

      const results = [];
      for (const line of lines) {
        try {
          const result = await lookupIngredient(line);
          if (result) results.push(result);
        } catch {
          // Skip individual failures
        }
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'No nutrition data found for any of the ingredients' });
      }

      return res.status(200).json(results.length === 1 ? results[0] : results);
    }

    return res.status(400).json({ error: 'Missing text or ingredients in request body' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
