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
