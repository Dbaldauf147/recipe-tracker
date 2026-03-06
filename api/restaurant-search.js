// Vercel serverless function: searches USDA FoodData Central Branded database
// for restaurant and fast food menu items.
// Auto-routed at /api/restaurant-search

const USDA_API_KEY = process.env.VITE_USDA_API_KEY || process.env.USDA_API_KEY || 'DEMO_KEY';
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const USDA_FOOD_URL = 'https://api.nal.usda.gov/fdc/v1/food';

const NUTRIENT_IDS = {
  calories: 1008,
  protein: 1003,
  carbs: 1005,
  fat: 1004,
  saturatedFat: 1258,
  sugar: 2000,
  fiber: 1079,
  sodium: 1093,
  potassium: 1092,
  calcium: 1087,
  iron: 1089,
  magnesium: 1090,
  zinc: 1095,
  vitaminB12: 1178,
  vitaminC: 1162,
  cholesterol: 1253,
};

function extractNutrient(foodNutrients, nutrientId) {
  const match = foodNutrients.find(fn =>
    (fn.nutrientId || fn.nutrient?.id) === nutrientId
  );
  return match ? (match.value ?? match.amount ?? null) : null;
}

function fmtVal(val) {
  if (val == null || val === 0) return 0;
  return Math.round(val * 100) / 100;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query, type, fdcId } = req.query;

  if (!query && !fdcId) {
    return res.status(400).json({ error: 'Missing query or fdcId parameter' });
  }

  try {
    if (type === 'nutrients' && fdcId) {
      // Get full nutrition for a specific food by FDC ID
      const url = `${USDA_FOOD_URL}/${fdcId}?api_key=${USDA_API_KEY}`;
      const response = await fetch(url);

      if (!response.ok) {
        return res.status(response.status).json({ error: `USDA API error: ${response.status}` });
      }

      const food = await response.json();
      const foodNutrients = food.foodNutrients || [];

      // Branded items: nutrients are per serving (servingSize field)
      const nutrients = {};
      for (const [key, nid] of Object.entries(NUTRIENT_IDS)) {
        const val = extractNutrient(foodNutrients, nid);
        nutrients[key] = val != null ? fmtVal(val) : 0;
      }

      const servingSize = food.servingSize || food.householdServingFullText || '';
      const servingUnit = food.servingSizeUnit || 'g';

      return res.status(200).json({
        name: food.description,
        brandName: food.brandName || food.brandOwner || '',
        servingSize: servingSize ? `${servingSize}${servingUnit}` : '',
        servingDescription: food.householdServingFullText || '',
        nutrients,
      });
    }

    // Default: search Branded database for restaurant/fast food items
    const searchQuery = (query || '').trim();
    if (!searchQuery) {
      return res.status(400).json({ error: 'Missing query parameter' });
    }

    const url = `${USDA_SEARCH_URL}?api_key=${USDA_API_KEY}&query=${encodeURIComponent(searchQuery)}&dataType=Branded&pageSize=20&sortBy=dataType.keyword&sortOrder=desc`;
    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({ error: `USDA API error: ${response.status}` });
    }

    const data = await response.json();

    if (!data.foods || data.foods.length === 0) {
      return res.status(200).json({ results: [] });
    }

    const results = data.foods.map(food => {
      const calories = extractNutrient(food.foodNutrients || [], 1008);
      const protein = extractNutrient(food.foodNutrients || [], 1003);
      return {
        fdcId: food.fdcId,
        name: food.description,
        brandName: food.brandName || food.brandOwner || '',
        servingSize: food.servingSize,
        servingSizeUnit: food.servingSizeUnit || 'g',
        householdServing: food.householdServingFullText || '',
        calories: calories != null ? Math.round(calories) : null,
        protein: protein != null ? Math.round(protein) : null,
      };
    });

    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
