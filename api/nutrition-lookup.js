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
  sugar: 2000,
  addedSugar: 1235,
  fiber: 1079,
  sodium: 1093,
  potassium: 1092,
  calcium: 1087,
  iron: 1089,
  magnesium: 1090,
  zinc: 1095,
  vitaminB12: 1178,
  vitaminC: 1162,
  leucine: 1213,
  omega3DHA: 1272,   // DHA
  omega3EPA: 1278,   // EPA
  omega3ALA: 1404,   // ALA
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

async function lookupIngredient(ingredientText) {
  const { ingredient, quantity, unit } = parsePortionFromText(ingredientText);
  const grams = resolveGrams(quantity, unit, ingredient);
  const scaleFactor = grams / 100; // USDA values are per 100g

  // Search USDA
  const url = `${USDA_SEARCH_URL}?api_key=${USDA_API_KEY}&query=${encodeURIComponent(ingredient)}&pageSize=3&dataType=Foundation,SR%20Legacy`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`USDA API error: ${res.status}`);
  const data = await res.json();

  if (!data.foods || data.foods.length === 0) {
    return null;
  }

  const food = data.foods[0];
  const nutrients = food.foodNutrients || [];

  // Extract per-100g values
  const per100 = {};
  for (const [key, nid] of Object.entries(NUTRIENT_IDS)) {
    per100[key] = extractNutrient(nutrients, nid);
  }

  // Scale to requested portion
  const row = {
    ingredient: food.description,
    grams: String(Math.round(grams)),
    measurement: unit ? `${quantity} ${unit}${quantity > 1 ? 's' : ''}` : `${Math.round(grams)}g`,
  };

  // Main nutrients - scale from per-100g
  const nutrientKeys = ['calories', 'protein', 'carbs', 'fat', 'saturatedFat', 'sugar',
    'addedSugar', 'fiber', 'sodium', 'potassium', 'calcium', 'iron',
    'magnesium', 'zinc', 'vitaminB12', 'vitaminC'];

  for (const key of nutrientKeys) {
    const val = per100[key];
    row[key] = val != null ? fmtVal(val * scaleFactor) : '';
  }

  // Leucine: use USDA value if available, otherwise estimate from protein
  const usdaLeucine = per100.leucine;
  const protein = per100.protein || 0;
  if (usdaLeucine != null && usdaLeucine > 0) {
    row.leucine = fmtVal(usdaLeucine * scaleFactor / 1000); // USDA leucine is in mg, convert to g
  } else if (protein > 0) {
    const estimatedLeucine = estimateLeucine(protein * scaleFactor, food.description);
    row.leucine = fmtVal(estimatedLeucine);
  } else {
    row.leucine = '';
  }

  // Omega-3: sum DHA + EPA + ALA from USDA, all in g per 100g
  const dha = per100.omega3DHA || 0;
  const epa = per100.omega3EPA || 0;
  const ala = per100.omega3ALA || 0;
  const totalOmega3 = (dha + epa + ala) * scaleFactor;
  row.omega3 = totalOmega3 > 0 ? fmtVal(totalOmega3) : '';

  // Derived fields
  const cal = parseFloat(row.calories) || 0;
  const prot = parseFloat(row.protein) || 0;
  const fib = parseFloat(row.fiber) || 0;
  row.proteinPerCal = cal > 0 ? fmtVal(prot / cal) : '';
  row.fiberPerCal = cal > 0 ? fmtVal(fib / cal) : '';

  // Source info
  row.notes = `USDA ${food.dataType || ''} #${food.fdcId}`;

  return row;
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
