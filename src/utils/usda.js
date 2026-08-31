// Shared USDA FoodData Central lookup. Used by the Ingredients page's search
// modal and by the "Add to database" flow on the recipe ingredient rows.
const USDA_API_KEY = import.meta.env.VITE_USDA_API_KEY || 'DEMO_KEY';
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

// Nutrient IDs for extracting per-100g values from USDA results
export const USDA_NUTRIENT_IDS = {
  calories: 1008, protein: 1003, carbs: 1005, fat: 1004,
  saturatedFat: 1258, sugar: 2000, addedSugar: 1235, fiber: 1079,
  sodium: 1093, potassium: 1092, calcium: 1087, iron: 1089,
  magnesium: 1090, zinc: 1095, vitaminB12: 1178, vitaminC: 1162,
  leucine: 1213, omega3: 1404,
};

/** Trim a number to at most 2 decimals; blank for 0/null so cells stay empty. */
export function fmtVal(val) {
  if (val == null || val === 0) return '';
  const s = String(Math.round(val * 100) / 100);
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/** Search USDA. Throws on a network/API error; returns [] when nothing matched. */
export async function searchUSDA(query, pageSize = 5) {
  const url = `${USDA_SEARCH_URL}?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query)}&pageSize=${pageSize}&dataType=Foundation,SR%20Legacy`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`USDA API error: ${res.status}`);
  const data = await res.json();
  return data.foods || [];
}

/** Per-100g nutrient values from a USDA food, keyed by our ingredient fields. */
export function usdaNutrients(food) {
  const nutrients = food?.foodNutrients || [];
  const out = {};
  for (const [key, nid] of Object.entries(USDA_NUTRIENT_IDS)) {
    const match = nutrients.find(fn => fn.nutrientId === nid);
    if (match) out[key] = fmtVal(match.value);
  }
  return out;
}
