const API_BASE = 'https://world.openfoodfacts.org/api/v2/product';

function parseServingSize(servingSize) {
  if (!servingSize) return { quantity: '', measurement: '' };
  const match = servingSize.match(/^([\d.]+)\s*(\w+)/);
  if (!match) return { quantity: '', measurement: '' };
  return { quantity: match[1], measurement: match[2] };
}

function fmt(val) {
  if (val == null || val === 0) return '';
  const s = String(Math.round(val * 100) / 100);
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
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
 * Uses per-serving values when available, falls back to per-100g.
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

  // Prefer per-serving values; fall back to per-100g
  // Use serving_quantity (grams, always reliable) instead of parsing serving_size text
  const servingGrams = p.serving_quantity;
  const hasServing = !!(servingGrams && servingGrams > 0 && n['energy-kcal_serving'] != null);
  const suffix = hasServing ? '_serving' : '_100g';

  const grams = hasServing ? String(Math.round(servingGrams)) : '100';
  const measurement = 'g';

  const calories = n['energy-kcal' + suffix] || 0;
  const protein = n['proteins' + suffix] || 0;
  const fiber = n['fiber' + suffix] || 0;
  // OFF stores sodium in grams — website expects mg
  const sodiumMg = (n['sodium' + suffix] || 0) * 1000;

  const proteinPerCal = calories > 0 ? Math.round((protein / calories) * 10000) / 100 : 0;
  const fiberPerCal = calories > 0 ? Math.round((fiber / calories) * 10000) / 100 : 0;

  return {
    ingredient,
    grams,
    measurement,
    protein: fmt(protein),
    carbs: fmt(n['carbohydrates' + suffix]),
    fat: fmt(n['fat' + suffix]),
    sugar: fmt(n['sugars' + suffix]),
    sodium: fmt(sodiumMg),
    potassium: fmt(n['potassium' + suffix]),
    vitaminB12: fmt(n['vitamin-b12' + suffix]),
    vitaminC: fmt(n['vitamin-c' + suffix]),
    magnesium: fmt(n['magnesium' + suffix]),
    fiber: fmt(fiber),
    zinc: fmt(n['zinc' + suffix]),
    iron: fmt(n['iron' + suffix]),
    calcium: fmt(n['calcium' + suffix]),
    calories: fmt(calories),
    addedSugar: fmt(n['added-sugars' + suffix]),
    saturatedFat: fmt(n['saturated-fat' + suffix]),
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
