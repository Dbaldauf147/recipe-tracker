import { loadIngredients } from './ingredientsStore.js';
import { getSizeGrams } from './units.js';

// Gram equivalents for common measurements (used to convert between units)
const UNIT_TO_GRAMS = {
  g: 1, gram: 1,
  kg: 1000,
  oz: 28.35, ounce: 28.35,
  lb: 453.6, pound: 453.6,
  cup: 140,
  tbsp: 15, tablespoon: 15,
  tsp: 5, teaspoon: 5,
  ml: 1, liter: 1000,
  pinch: 0.5, dash: 0.5,
  clove: 3,
  slice: 30,
  piece: 50,
  can: 400, stick: 113,
};

const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRg2H-pU53B_n0WCG3f_vz3ye-8IicvsqvTM2xohwVaEitNIZr6PbrgRn8-5qlTn-cSwnt2m3FjXIae/pub?gid=960892864&single=true&output=csv';

// Column indices (0-based) in the CSV after the header row.
// Col H=7: Ingredient, I=8: Grams, J=9: Measurement,
// K=10: Protein, L=11: Carbs, M=12: Fat, N=13: Sugar, O=14: Salt,
// P=15: Potassium, Q=16: B12, R=17: C, S=18: Magnesium, T=19: Fiber,
// U=20: Zinc, V=21: Iron, W=22: Calcium, X=23: Calories,
// Y=24: Added Sugar, Z=25: Saturated Fat, AA=26: Leucine
const COL = {
  ingredient: 7,
  grams: 8,
  measurement: 9,
  protein: 10,
  carbs: 11,
  fat: 12,
  sugar: 13,
  sodium: 14,
  potassium: 15,
  vitaminB12: 16,
  vitaminC: 17,
  magnesium: 18,
  fiber: 19,
  zinc: 20,
  iron: 21,
  calcium: 22,
  calories: 23,
  addedSugar: 24,
  saturatedFat: 25,
  leucine: 26,
  omega3: 35,
};

let cachedRows = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

async function fetchSheetData() {
  // Check local ingredients database first (editable local copy)
  const localData = loadIngredients();
  if (localData && localData.length > 0) {
    return localData.map(item => ({
      name: (item.ingredient || '').trim(),
      measurement: (item.measurement || '').trim(),
      grams: parseFloat(item.grams) || 0,
      nutrients: {
        protein: parseFloat(item.protein) || 0,
        carbs: parseFloat(item.carbs) || 0,
        fat: parseFloat(item.fat) || 0,
        sugar: parseFloat(item.sugar) || 0,
        sodium: parseFloat(item.sodium) || 0,
        potassium: parseFloat(item.potassium) || 0,
        vitaminB12: parseFloat(item.vitaminB12) || 0,
        vitaminC: parseFloat(item.vitaminC) || 0,
        magnesium: parseFloat(item.magnesium) || 0,
        fiber: parseFloat(item.fiber) || 0,
        zinc: parseFloat(item.zinc) || 0,
        iron: parseFloat(item.iron) || 0,
        calcium: parseFloat(item.calcium) || 0,
        calories: parseFloat(item.calories) || 0,
        addedSugar: parseFloat(item.addedSugar) || 0,
        saturatedFat: parseFloat(item.saturatedFat) || 0,
        leucine: parseFloat(item.leucine) || 0,
        omega3: parseFloat(item.omega3) || 0,
      },
    })).filter(r => r.name);
  }

  // Fall back to Google Sheet CSV
  if (cachedRows && Date.now() - cacheTime < CACHE_TTL) return cachedRows;

  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) throw new Error('Failed to fetch Google Sheet');
  const text = await res.text();
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));

  // Skip first 2 header rows (recipe names + daily values), row 3 is column headers
  const dataLines = lines.slice(3);
  const rows = [];

  for (const line of dataLines) {
    if (!line.trim()) continue;
    const cols = parseCSVLine(line);
    const name = (cols[COL.ingredient] || '').trim();
    if (!name) continue;

    rows.push({
      name,
      measurement: (cols[COL.measurement] || '').trim(),
      grams: parseFloat(cols[COL.grams]) || 0,
      nutrients: {
        protein: parseFloat(cols[COL.protein]) || 0,
        carbs: parseFloat(cols[COL.carbs]) || 0,
        fat: parseFloat(cols[COL.fat]) || 0,
        sugar: parseFloat(cols[COL.sugar]) || 0,
        sodium: parseFloat(cols[COL.sodium]) || 0,
        potassium: parseFloat(cols[COL.potassium]) || 0,
        vitaminB12: parseFloat(cols[COL.vitaminB12]) || 0,
        vitaminC: parseFloat(cols[COL.vitaminC]) || 0,
        magnesium: parseFloat(cols[COL.magnesium]) || 0,
        fiber: parseFloat(cols[COL.fiber]) || 0,
        zinc: parseFloat(cols[COL.zinc]) || 0,
        iron: parseFloat(cols[COL.iron]) || 0,
        calcium: parseFloat(cols[COL.calcium]) || 0,
        calories: parseFloat(cols[COL.calories]) || 0,
        addedSugar: parseFloat(cols[COL.addedSugar]) || 0,
        saturatedFat: parseFloat(cols[COL.saturatedFat]) || 0,
        leucine: parseFloat(cols[COL.leucine]) || 0,
        omega3: parseFloat(cols[COL.omega3]) || 0,
      },
    });
  }

  cachedRows = rows;
  cacheTime = Date.now();
  return rows;
}

// Normalize a measurement string for comparison.
// "cup(s)" -> "cup", "clove(s)" -> "clove", "can(s)_5 oz" -> "can", etc.
function normalizeMeasurement(m) {
  return m.toLowerCase()
    .replace(/\(s\)/g, '')      // cup(s) -> cup
    .replace(/_.*$/, '')         // can_5 oz -> can
    .replace(/s$/, '')           // cups -> cup
    .trim();
}

// Try to find the best matching row for an ingredient name.
function findMatch(rows, ingredientName) {
  const search = ingredientName.trim().toLowerCase();

  // 1. Exact match
  const exact = rows.find(r => r.name.toLowerCase() === search);
  if (exact) return exact;

  // 2. Sheet name starts with search or search starts with sheet name
  const partial = rows.find(r => {
    const rn = r.name.toLowerCase();
    return rn.startsWith(search) || search.startsWith(rn);
  });
  if (partial) return partial;

  // 3. Search words all appear in sheet name or vice versa
  const searchWords = search.split(/[\s_-]+/);
  const wordMatch = rows.find(r => {
    const rn = r.name.toLowerCase();
    return searchWords.every(w => rn.includes(w));
  });
  if (wordMatch) return wordMatch;

  // 4. Any sheet name is contained in the search or vice versa
  const contains = rows.find(r => {
    const rn = r.name.toLowerCase();
    return rn.includes(search) || search.includes(rn);
  });
  if (contains) return contains;

  return null;
}

// Check if the recipe measurement is compatible with the sheet measurement.
function measurementsMatch(recipeMeasurement, sheetMeasurement) {
  if (!sheetMeasurement) return true; // sheet has no unit, assume it's generic
  const a = normalizeMeasurement(recipeMeasurement);
  const b = normalizeMeasurement(sheetMeasurement);
  return a === b;
}

/**
 * Look up an ingredient in the Google Sheet.
 * Returns a nutrition result (same shape as USDA results) or null if not found.
 */
export async function lookupFromSheet(ingredient) {
  const { quantity, measurement, ingredient: name } = ingredient;
  if (!name.trim()) return null;

  let rows;
  try {
    rows = await fetchSheetData();
  } catch {
    return null; // Sheet unavailable, fall through to USDA
  }

  const match = findMatch(rows, name);
  if (!match) return null;

  const rawQty = parseFloat(quantity);
  const qty = isNaN(rawQty) ? 1 : rawQty;

  // Determine multiplier.
  // Sheet nutrition values are per 1 serving of the sheet's measurement.
  // If recipe uses a different measurement, convert via gram equivalents.
  const recipeMeasNorm = normalizeMeasurement(measurement || '');
  const sheetMeasNorm = normalizeMeasurement(match.measurement || '');

  let multiplier = qty;

  // Check for size-based measurement (small/medium/large) with ingredient-specific weight
  const isSizeMeas = ['small', 'medium', 'large', 'extra large', 'xl', 'regular'].includes(recipeMeasNorm);
  if (isSizeMeas && match.grams > 0) {
    const sizeGrams = getSizeGrams(name, recipeMeasNorm);
    if (sizeGrams) {
      // Convert: qty units * grams-per-unit / sheet-grams-per-serving
      multiplier = qty * sizeGrams / match.grams;
    }
  }

  const isGrams = ['g', 'gram'].includes(recipeMeasNorm);
  if (isSizeMeas && multiplier !== qty) {
    // Already handled by size lookup above
  } else if (isGrams && match.grams > 0) {
    // Recipe in grams, sheet has grams-per-serving: e.g. 200g / 100g = 2x
    multiplier = qty / match.grams;
  } else if (!isSizeMeas && recipeMeasNorm && sheetMeasNorm && recipeMeasNorm !== sheetMeasNorm) {
    // Different volume/weight units: convert via gram equivalents
    // e.g. recipe=tsp(5g), sheet=tbsp(15g) → ratio = 5/15 = 0.333
    const recipeGrams = UNIT_TO_GRAMS[recipeMeasNorm];
    const sheetGrams = UNIT_TO_GRAMS[sheetMeasNorm];
    if (recipeGrams && sheetGrams) {
      multiplier = qty * (recipeGrams / sheetGrams);
    }
  }

  // Scale nutrition by multiplier. Sheet values are per 1 serving of the sheet's measurement.
  const nutrients = {};
  for (const [key, val] of Object.entries(match.nutrients)) {
    nutrients[key] = val * multiplier;
  }

  // Round values
  const { NUTRIENTS, computeVegServings, computeFruitServings } = await import('./nutrition.js');
  for (const n of NUTRIENTS) {
    if (n.id === null) continue;
    if (nutrients[n.key] !== undefined) {
      const factor = 10 ** n.decimals;
      nutrients[n.key] = Math.round(nutrients[n.key] * factor) / factor;
    }
  }

  const totalGrams = match.grams ? match.grams * multiplier : null;
  nutrients.vegServings = computeVegServings(name, totalGrams || 0);
  nutrients.fruitServings = computeFruitServings(name, totalGrams || 0);

  return {
    name: match.name + ' (from your sheet)',
    matchedTo: name,
    grams: totalGrams ? Math.round(totalGrams) : null,
    nutrients,
    source: 'sheet',
  };
}
