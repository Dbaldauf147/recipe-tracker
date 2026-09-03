// The tracked-nutrient catalogue: keys, labels, USDA FoodData Central ids,
// display units and rounding precision.
//
// Split out of nutrition.js (which re-exports it, so `import { NUTRIENTS }
// from './nutrition'` still works) because nutrition.js reads
// `import.meta.env` at module load — that makes it unimportable from a plain
// `node --test` process. Keeping the catalogue in a dependency-free module
// lets pure logic (meal-goal evaluation, the suggestion solver) be tested
// without a bundler.

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
  // Derived from the ingredient name rather than a lab value — see
  // mealQualities.js for why.
  { key: 'fermentedServings', label: 'Fermented Foods', id: null, unit: '', decimals: 1 },
  { key: 'omega3Servings',    label: 'Omega-3 Sources', id: null, unit: '', decimals: 1 },
];

// key → catalogue entry. Callers formatting a value need the unit and the
// decimals together, and a linear find() over 50 rows per cell adds up.
export const NUTRIENT_BY_KEY = Object.fromEntries(NUTRIENTS.map(n => [n.key, n]));

// Calories per gram, used to turn macro grams into a % of the meal's energy.
export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 };
