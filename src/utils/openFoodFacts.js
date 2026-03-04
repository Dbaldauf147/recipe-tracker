const API_BASE = 'https://world.openfoodfacts.org/api/v2/product';

function parseServingSize(servingSize) {
  if (!servingSize) return { quantity: '', measurement: '' };
  const match = servingSize.match(/^([\d.]+)\s*(\w+)/);
  if (!match) return { quantity: '', measurement: '' };
  return { quantity: match[1], measurement: match[2] };
}

function fmt(val) {
  if (val == null || val === 0) return '';
  return String(Math.round(val * 100) / 100).replace(/\.?0+$/, '');
}

export async function lookupBarcode(barcode) {
  const res = await fetch(`${API_BASE}/${barcode}.json`);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;

  const p = data.product;
  const brand = (p.brands || '').split(',')[0].trim();
  const name = p.product_name || '';
  if (!name) return null;

  const ingredient = brand ? `${brand} ${name}` : name;
  const { quantity, measurement } = parseServingSize(p.serving_size);

  return {
    quantity,
    measurement,
    ingredient,
    notes: p.quantity || '',
  };
}

/**
 * Full nutrition lookup — returns all 30 ingredient fields pre-filled.
 * Nutrition values are per 100g from OpenFoodFacts.
 */
export async function lookupBarcodeFullNutrition(barcode) {
  const res = await fetch(`${API_BASE}/${barcode}.json`);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;

  const p = data.product;
  const brand = (p.brands || '').split(',')[0].trim();
  const name = p.product_name || '';
  if (!name) return null;

  const ingredient = brand ? `${brand} ${name}` : name;
  const n = p.nutriments || {};

  const calories = n['energy-kcal_100g'] || 0;
  const protein = n['proteins_100g'] || 0;
  const fiber = n['fiber_100g'] || 0;
  // OFF stores sodium in grams — website expects mg
  const sodiumMg = (n['sodium_100g'] || 0) * 1000;

  const proteinPerCal = calories > 0 ? Math.round((protein / calories) * 10000) / 100 : 0;
  const fiberPerCal = calories > 0 ? Math.round((fiber / calories) * 10000) / 100 : 0;

  return {
    ingredient,
    grams: '100',
    measurement: 'g',
    protein: fmt(protein),
    carbs: fmt(n['carbohydrates_100g']),
    fat: fmt(n['fat_100g']),
    sugar: fmt(n['sugars_100g']),
    sodium: fmt(sodiumMg),
    potassium: fmt(n['potassium_100g']),
    vitaminB12: fmt(n['vitamin-b12_100g']),
    vitaminC: fmt(n['vitamin-c_100g']),
    magnesium: fmt(n['magnesium_100g']),
    fiber: fmt(fiber),
    zinc: fmt(n['zinc_100g']),
    iron: fmt(n['iron_100g']),
    calcium: fmt(n['calcium_100g']),
    calories: fmt(calories),
    addedSugar: fmt(n['added-sugars_100g']),
    saturatedFat: fmt(n['saturated-fat_100g']),
    leucine: '',
    notes: `Scanned: ${barcode}`,
    link: `https://world.openfoodfacts.org/product/${barcode}`,
    processed: '',
    omega3: '',
    proteinPerCal: fmt(proteinPerCal),
    fiberPerCal: fmt(fiberPerCal),
    lastBought: '',
    storage: '',
    minShelf: '',
    maxShelf: '',
  };
}
