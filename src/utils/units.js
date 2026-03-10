// Ingredient-specific gram weights for size-based measurements (small / medium / large)
// Maps lowercase ingredient keyword → { small, medium, large } in grams per 1 unit
export const SIZE_GRAMS = {
  'egg':              { small: 38, medium: 44, large: 50, 'extra large': 56, 'xl': 56 },
  'eggs':             { small: 38, medium: 44, large: 50, 'extra large': 56, 'xl': 56 },
  'egg(s)':           { small: 38, medium: 44, large: 50, 'extra large': 56, 'xl': 56 },
  'chicken breast':   { small: 170, medium: 230, large: 280 },
  'chicken thigh':    { small: 85,  medium: 115, large: 150 },
  'chicken drumstick':{ small: 75,  medium: 95,  large: 120 },
  'banana':           { small: 80,  medium: 118, large: 136 },
  'banana(s)':        { small: 80,  medium: 118, large: 136 },
  'avocado':          { small: 135, medium: 170, large: 200 },
  'avocado(s)':       { small: 135, medium: 170, large: 200 },
  'apple':            { small: 150, medium: 182, large: 220 },
  'apple(s)':         { small: 150, medium: 182, large: 220 },
  'potato':           { small: 170, medium: 213, large: 280 },
  'sweet potato':     { small: 100, medium: 130, large: 180 },
  'sweet potato(s)':  { small: 100, medium: 130, large: 180 },
  'tomato':           { small: 90,  medium: 123, large: 182 },
  'onion':            { small: 70,  medium: 110, large: 150 },
  'yellow onion':     { small: 70,  medium: 110, large: 150 },
  'yellow onion(s)':  { small: 70,  medium: 110, large: 150 },
  'red onion':        { small: 70,  medium: 110, large: 150 },
  'red onion(s)':     { small: 70,  medium: 110, large: 150 },
  'white onion':      { small: 70,  medium: 110, large: 150 },
  'white onion(s)':   { small: 70,  medium: 110, large: 150 },
  'bell pepper':      { small: 100, medium: 120, large: 165 },
  'bell pepper(s)':   { small: 100, medium: 120, large: 165 },
  'zucchini':         { small: 130, medium: 196, large: 300 },
  'carrot':           { small: 50,  medium: 61,  large: 72 },
  'carrots':          { small: 50,  medium: 61,  large: 72 },
  'lemon':            { small: 45,  medium: 58,  large: 84 },
  'lemon(s)':         { small: 45,  medium: 58,  large: 84 },
  'lime':             { small: 44,  medium: 67,  large: 90 },
  'lime(s)':          { small: 44,  medium: 67,  large: 90 },
  'orange':           { small: 96,  medium: 131, large: 184 },
  'pear':             { small: 148, medium: 178, large: 230 },
  'peach':            { small: 130, medium: 150, large: 175 },
  'cucumber':         { small: 160, medium: 200, large: 300 },
  'cucumber(s)':      { small: 160, medium: 200, large: 300 },
  'eggplant':         { small: 300, medium: 458, large: 600 },
  'shallot':          { small: 30,  medium: 60,  large: 90 },
  'salmon fillet':    { small: 115, medium: 170, large: 225 },
  'steak':            { small: 170, medium: 225, large: 340 },
  'pork chop':        { small: 115, medium: 170, large: 225 },
};

/**
 * Get grams for a sized ingredient.
 * Returns the gram weight if the measurement is a size (small/medium/large)
 * and the ingredient has a specific entry, otherwise returns null.
 *
 * @param {string} ingredientName - e.g. "chicken breast"
 * @param {string} size - e.g. "large", "small", "medium"
 * @returns {number|null} grams per 1 unit, or null if no match
 */
export function getSizeGrams(ingredientName, size) {
  if (!ingredientName || !size) return null;
  const sizeLower = size.toLowerCase().trim();
  const ingLower = ingredientName.toLowerCase().trim();

  // Direct match
  if (SIZE_GRAMS[ingLower] && SIZE_GRAMS[ingLower][sizeLower] !== undefined) {
    return SIZE_GRAMS[ingLower][sizeLower];
  }

  // Partial match — check if ingredient name contains a key
  for (const [key, sizes] of Object.entries(SIZE_GRAMS)) {
    if (ingLower.includes(key) && sizes[sizeLower] !== undefined) {
      return sizes[sizeLower];
    }
  }

  return null;
}

// All measurements in ml (volume) or grams (weight) for conversion
export const VOLUME_TO_ML = {
  tsp: 4.929, teaspoon: 4.929, teaspoons: 4.929,
  tbsp: 14.787, tablespoon: 14.787, tablespoons: 14.787,
  'fl oz': 29.574,
  cup: 236.588, cups: 236.588,
  pint: 473.176, pints: 473.176,
  quart: 946.353, quarts: 946.353,
  gallon: 3785.41, gallons: 3785.41,
  liter: 1000, liters: 1000, l: 1000,
  ml: 1,
  cl: 10, centiliter: 10, centiliters: 10,
  dl: 100, deciliter: 100, deciliters: 100,
  c: 236.588,
  pt: 473.176,
  qt: 946.353,
  gal: 3785.41,
  pinch: 0.31, dash: 0.62, smidgen: 0.16,
  can: 400, cans: 400,
  handful: 50, handfuls: 50,
  bunch: 200, bunches: 200,
};

export const WEIGHT_TO_G = {
  mg: 0.001, milligram: 0.001, milligrams: 0.001,
  g: 1, gram: 1, grams: 1,
  kg: 1000,
  oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
  lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
  clove: 5, cloves: 5,
  slice: 30, slices: 30,
  stick: 113.4, sticks: 113.4,
  piece: 50, pieces: 50,
  head: 500, heads: 500,
  stalk: 50, stalks: 50,
  sprig: 2, sprigs: 2,
  whole: 100, each: 100,
  large: 150, medium: 100, small: 75,
};

// Dropdown options for the barcode scanner measurement picker (no grams/g/kg/mg)
export const MEASUREMENT_OPTIONS = [
  {
    label: 'Volume',
    options: ['tsp', 'tbsp', 'fl oz', 'cup', 'ml', 'l', 'can'],
  },
  {
    label: 'Weight',
    options: ['oz', 'lb'],
  },
  {
    label: 'Count',
    options: ['each', 'slice', 'piece', 'whole', 'clove', 'stalk', 'head', 'sprig', 'stick'],
  },
];
