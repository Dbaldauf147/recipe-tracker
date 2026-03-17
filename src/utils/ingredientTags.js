// Ingredient tag definitions and auto-tagging logic

export const TAG_CATEGORIES = {
  macro: { label: 'Macronutrient', color: '#6366f1' },
  carbType: { label: 'Carb Type', color: '#f59e0b' },
  gi: { label: 'GI Level', color: '#ef4444' },
  dietary: { label: 'Dietary', color: '#22c55e' },
  other: { label: 'Other', color: '#8b5cf6' },
};

export const ALL_TAGS = [
  { key: 'high-protein', label: 'High Protein', category: 'macro' },
  { key: 'high-fat', label: 'High Fat', category: 'macro' },
  { key: 'high-carb', label: 'High Carb', category: 'macro' },
  { key: 'starchy', label: 'Starchy', category: 'carbType' },
  { key: 'non-starchy', label: 'Non-Starchy', category: 'carbType' },
  { key: 'simple-sugar', label: 'Simple Sugar', category: 'carbType' },
  { key: 'low-gi', label: 'Low GI', category: 'gi' },
  { key: 'medium-gi', label: 'Medium GI', category: 'gi' },
  { key: 'high-gi', label: 'High GI', category: 'gi' },
  { key: 'vegan', label: 'Vegan', category: 'dietary' },
  { key: 'gluten-free', label: 'Gluten-Free', category: 'dietary' },
  { key: 'dairy-free', label: 'Dairy-Free', category: 'dietary' },
  { key: 'fermented', label: 'Fermented', category: 'other' },
];

// Known ingredient → tag mappings for auto-tagging
// Comprehensive list covering carb type, GI, macros, and dietary tags.
//
// CARB TYPES:
//   starchy       = primarily starch-based (grains, tubers, starchy roots)
//   non-starchy   = fibrous vegetables, leafy greens, low-carb produce
//   simple-sugar  = primarily simple sugars / refined carbs
//
// GI LEVELS (glycemic index):
//   low-gi    = GI under 55
//   medium-gi = GI 55-69
//   high-gi   = GI 70+
//
// MACRO TAGS:
//   high-protein = >20g protein per 100g
//   high-fat     = >20g fat per 100g (or is an oil/fat)
//   high-carb    = >40g carbs per 100g
//
// DIETARY:
//   vegan, gluten-free, dairy-free

const INGREDIENT_TAG_MAP = {
  // ═══════════════════════════════════════════════════════════════
  // HIGH PROTEIN (>20g per 100g) — Meats, fish, poultry
  // ═══════════════════════════════════════════════════════════════
  chicken: ['high-protein', 'gluten-free', 'dairy-free'],
  'chicken breast': ['high-protein', 'gluten-free', 'dairy-free'],
  'chicken thigh': ['high-protein', 'gluten-free', 'dairy-free'],
  'chicken wing': ['high-protein', 'gluten-free', 'dairy-free'],
  'ground chicken': ['high-protein', 'gluten-free', 'dairy-free'],
  turkey: ['high-protein', 'gluten-free', 'dairy-free'],
  'ground turkey': ['high-protein', 'gluten-free', 'dairy-free'],
  'turkey breast': ['high-protein', 'gluten-free', 'dairy-free'],
  beef: ['high-protein', 'gluten-free', 'dairy-free'],
  'ground beef': ['high-protein', 'gluten-free', 'dairy-free'],
  steak: ['high-protein', 'gluten-free', 'dairy-free'],
  'sirloin steak': ['high-protein', 'gluten-free', 'dairy-free'],
  'ribeye steak': ['high-protein', 'high-fat', 'gluten-free', 'dairy-free'],
  'flank steak': ['high-protein', 'gluten-free', 'dairy-free'],
  'beef tenderloin': ['high-protein', 'gluten-free', 'dairy-free'],
  brisket: ['high-protein', 'gluten-free', 'dairy-free'],
  pork: ['high-protein', 'gluten-free', 'dairy-free'],
  'pork chop': ['high-protein', 'gluten-free', 'dairy-free'],
  'pork loin': ['high-protein', 'gluten-free', 'dairy-free'],
  'pork tenderloin': ['high-protein', 'gluten-free', 'dairy-free'],
  'ground pork': ['high-protein', 'gluten-free', 'dairy-free'],
  ham: ['high-protein', 'gluten-free', 'dairy-free'],
  lamb: ['high-protein', 'gluten-free', 'dairy-free'],
  'ground lamb': ['high-protein', 'gluten-free', 'dairy-free'],
  'lamb chop': ['high-protein', 'gluten-free', 'dairy-free'],
  bison: ['high-protein', 'gluten-free', 'dairy-free'],
  venison: ['high-protein', 'gluten-free', 'dairy-free'],
  duck: ['high-protein', 'high-fat', 'gluten-free', 'dairy-free'],
  bacon: ['high-fat', 'high-protein', 'gluten-free', 'dairy-free'],
  sausage: ['high-protein', 'high-fat', 'gluten-free', 'dairy-free'],
  'italian sausage': ['high-protein', 'high-fat', 'gluten-free', 'dairy-free'],
  'chicken sausage': ['high-protein', 'gluten-free', 'dairy-free'],
  'chicken apple sausage': ['high-protein', 'gluten-free', 'dairy-free'],
  pepperoni: ['high-protein', 'high-fat', 'gluten-free', 'dairy-free'],
  prosciutto: ['high-protein', 'gluten-free', 'dairy-free'],
  'deli meat': ['high-protein', 'gluten-free', 'dairy-free'],

  // Fish & seafood (high protein)
  salmon: ['high-protein', 'gluten-free', 'dairy-free'],
  'smoked salmon': ['high-protein', 'gluten-free', 'dairy-free'],
  tuna: ['high-protein', 'gluten-free', 'dairy-free'],
  'canned tuna': ['high-protein', 'gluten-free', 'dairy-free'],
  cod: ['high-protein', 'gluten-free', 'dairy-free'],
  tilapia: ['high-protein', 'gluten-free', 'dairy-free'],
  halibut: ['high-protein', 'gluten-free', 'dairy-free'],
  mahi: ['high-protein', 'gluten-free', 'dairy-free'],
  swordfish: ['high-protein', 'gluten-free', 'dairy-free'],
  trout: ['high-protein', 'gluten-free', 'dairy-free'],
  bass: ['high-protein', 'gluten-free', 'dairy-free'],
  catfish: ['high-protein', 'gluten-free', 'dairy-free'],
  sardine: ['high-protein', 'gluten-free', 'dairy-free'],
  anchovy: ['high-protein', 'gluten-free', 'dairy-free'],
  shrimp: ['high-protein', 'gluten-free', 'dairy-free'],
  prawn: ['high-protein', 'gluten-free', 'dairy-free'],
  crab: ['high-protein', 'gluten-free', 'dairy-free'],
  lobster: ['high-protein', 'gluten-free', 'dairy-free'],
  scallop: ['high-protein', 'gluten-free', 'dairy-free'],
  mussel: ['high-protein', 'gluten-free', 'dairy-free'],
  clam: ['high-protein', 'gluten-free', 'dairy-free'],
  oyster: ['high-protein', 'gluten-free', 'dairy-free'],
  calamari: ['high-protein', 'gluten-free', 'dairy-free'],
  squid: ['high-protein', 'gluten-free', 'dairy-free'],
  octopus: ['high-protein', 'gluten-free', 'dairy-free'],

  // Eggs & dairy protein
  egg: ['high-protein', 'gluten-free', 'dairy-free'],
  'egg white': ['high-protein', 'gluten-free', 'dairy-free'],
  'greek yogurt': ['high-protein', 'gluten-free', 'low-gi'],
  yogurt: ['high-protein', 'gluten-free', 'fermented', 'low-gi'],
  'cottage cheese': ['high-protein', 'gluten-free'],
  cottage: ['high-protein', 'gluten-free'],
  'ricotta cheese': ['high-protein', 'gluten-free'],
  ricotta: ['high-protein', 'gluten-free'],
  whey: ['high-protein', 'gluten-free'],
  'whey protein': ['high-protein', 'gluten-free'],
  'protein powder': ['high-protein', 'gluten-free'],
  'protien powder': ['high-protein', 'gluten-free'],
  casein: ['high-protein', 'gluten-free'],

  // Plant-based protein (>20g per 100g dry)
  tofu: ['high-protein', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  tempeh: ['high-protein', 'vegan', 'dairy-free', 'fermented', 'low-gi'],
  seitan: ['high-protein', 'vegan', 'dairy-free'],
  'beyond meat': ['high-protein', 'vegan', 'gluten-free', 'dairy-free'],
  'beyond sausage': ['high-protein', 'vegan', 'gluten-free', 'dairy-free'],
  'impossible burger': ['high-protein', 'vegan', 'gluten-free', 'dairy-free'],
  edamame: ['high-protein', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'soy protein': ['high-protein', 'vegan', 'gluten-free', 'dairy-free'],
  'pea protein': ['high-protein', 'vegan', 'gluten-free', 'dairy-free'],
  'nutritional yeast': ['high-protein', 'vegan', 'gluten-free', 'dairy-free'],

  // Legumes (high protein, low GI)
  lentil: ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'green lentil': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'red lentil': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'brown lentil': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  chickpea: ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'garbanzo bean': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  hummus: ['vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'black bean': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'kidney bean': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'navy bean': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'pinto bean': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'cannellini bean': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'white bean': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'lima bean': ['high-protein', 'high-carb', 'starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'butter bean': ['high-protein', 'high-carb', 'starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'split pea': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'green pea': ['high-carb', 'starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'black-eyed pea': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'fava bean': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'mung bean': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'adzuki bean': ['high-protein', 'high-carb', 'non-starchy', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],

  // ═══════════════════════════════════════════════════════════════
  // STARCHY CARBS — Grains, tubers, starchy roots
  // ═══════════════════════════════════════════════════════════════

  // White/refined grains (high GI, starchy)
  'white rice': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'jasmine rice': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'sticky rice': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'arborio rice': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'instant rice': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  rice: ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'rice cake': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'rice paper': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'rice noodle': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // Brown/whole grains (medium or low GI, starchy)
  'brown rice': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'wild rice': ['high-carb', 'starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'basmati rice': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'black rice': ['high-carb', 'starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // Wheat & bread products
  bread: ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  'white bread': ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  'whole wheat bread': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  'whole grain bread': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  'sourdough bread': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free', 'fermented'],
  'rye bread': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  'pumpernickel bread': ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  'ezekiel bread': ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  'pita bread': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  naan: ['high-carb', 'starchy', 'high-gi', 'dairy-free'],
  'bakery bread': ['high-carb', 'starchy', 'high-gi', 'dairy-free'],
  'brioche bun': ['high-carb', 'starchy', 'high-gi', 'dairy-free'],
  'kaiser roll': ['high-carb', 'starchy', 'high-gi', 'dairy-free'],
  'whole wheat toast': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  bagel: ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  croissant: ['high-carb', 'starchy', 'high-gi'],
  baguette: ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  ciabatta: ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  focaccia: ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  'english muffin': ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  crouton: ['high-carb', 'starchy', 'high-gi', 'dairy-free'],

  // Pasta & noodles
  pasta: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  'white pasta': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  'whole wheat pasta': ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  spaghetti: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  penne: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  rotini: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  'lentil pasta': ['high-carb', 'starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'chickpea pasta': ['high-carb', 'starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  noodle: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  'egg noodle': ['high-carb', 'starchy', 'medium-gi', 'dairy-free'],
  'soba noodle': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  'udon noodle': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  'glass noodle': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  couscous: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  'pearl couscous': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  orzo: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  gnocchi: ['high-carb', 'starchy', 'high-gi', 'dairy-free'],
  ravioli: ['high-carb', 'starchy', 'medium-gi', 'dairy-free'],
  lasagna: ['high-carb', 'starchy', 'medium-gi', 'dairy-free'],

  // Wraps & flatbreads
  tortilla: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  'whole wheat tortilla': ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  'corn tortilla': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'flour tortilla': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  wrap: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  taco: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  'taco shell': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // Whole grains (mostly low-medium GI)
  oat: ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  oatmeal: ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  'rolled oat': ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  'steel cut oat': ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  'instant oat': ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  'oat flour': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  quinoa: ['high-carb', 'starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  barley: ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  'pearl barley': ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  bulgur: ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  farro: ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  freekeh: ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  millet: ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  amaranth: ['high-carb', 'starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  teff: ['high-carb', 'starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  buckwheat: ['high-carb', 'starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  spelt: ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  kamut: ['high-carb', 'starchy', 'low-gi', 'vegan', 'dairy-free'],
  sorghum: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  polenta: ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  grits: ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  granola: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],

  // Starchy tubers & roots
  potato: ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'red potato': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'russet potato': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'yukon gold potato': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'baked potato': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'mashed potato': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'french fries': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'hash brown': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'sweet potato': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  yam: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  taro: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  cassava: ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  plantain: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  parsnip: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  turnip: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // Other starchy
  corn: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'corn starch': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  cornmeal: ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  popcorn: ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'spaghetti squash': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // Flour types (starchy)
  flour: ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  'all-purpose flour': ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  'whole wheat flour': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],
  'bread flour': ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  'cake flour': ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  'almond flour': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'coconut flour': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'tapioca flour': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'rice flour': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'chickpea flour': ['high-carb', 'starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'panko bread crumb': ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  'bread crumb': ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  panko: ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  'graham cracker': ['high-carb', 'starchy', 'high-gi', 'dairy-free'],

  // Breakfast cereals (starchy)
  cereal: ['high-carb', 'starchy', 'high-gi', 'vegan', 'dairy-free'],
  'corn flakes': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'rice krispies': ['high-carb', 'starchy', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'bran flakes': ['high-carb', 'starchy', 'medium-gi', 'vegan', 'dairy-free'],

  // ═══════════════════════════════════════════════════════════════
  // NON-STARCHY VEGETABLES (complex carbs, low GI)
  // ═══════════════════════════════════════════════════════════════

  // Leafy greens
  spinach: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  kale: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  lettuce: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'romaine lettuce': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'iceberg lettuce': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  arugula: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'spring mix': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'collard green': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'swiss chard': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  chard: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'bok choy': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'mustard green': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'turnip green': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  watercress: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  endive: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  radicchio: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // Cruciferous
  broccoli: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'broccoli rabe': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  broccolini: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  cauliflower: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'cauliflower rice': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  cabbage: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'red cabbage': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'napa cabbage': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'brussel sprout': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'brussels sprout': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  kohlrabi: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // Nightshades & fruiting vegetables
  tomato: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'cherry tomato': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'roma tomato': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'beefsteak tomato': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'sundried tomato': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'tomato paste': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'tomato sauce': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'diced tomato': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'crushed tomato': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  pepper: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'bell pepper': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'red pepper': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'green pepper': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  jalapeno: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  serrano: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  habanero: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  poblano: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'anaheim pepper': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  eggplant: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  okra: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // Squash & gourds (non-starchy types)
  zucchini: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'yellow squash': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'summer squash': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  cucumber: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'persian cucumber': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  pickle: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'butternut squash': ['high-carb', 'starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'acorn squash': ['high-carb', 'starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'delicata squash': ['high-carb', 'starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  pumpkin: ['high-carb', 'starchy', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // Alliums
  onion: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'yellow onion': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'red onion': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'white onion': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'vidalia onion': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'green onion': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  scallion: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  shallot: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  leek: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  chive: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  garlic: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // Root vegetables (non-starchy)
  carrot: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'baby carrot': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  celery: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  radish: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  daikon: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  beet: ['non-starchy', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  jicama: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  rutabaga: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  celeriac: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  ginger: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'ginger root': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // Other non-starchy vegetables
  asparagus: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  artichoke: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'green bean': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'string bean': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'snap pea': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'snow pea': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  mushroom: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'shiitake mushroom': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'cremini mushroom': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  portobello: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'oyster mushroom': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'button mushroom': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  fennel: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'bean sprout': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'alfalfa sprout': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'water chestnut': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'bamboo shoot': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'hearts of palm': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  rhubarb: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'coleslaw mix': ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  seaweed: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  nori: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  kelp: ['non-starchy', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // ═══════════════════════════════════════════════════════════════
  // FRUITS (vary by GI — generally simple sugars but whole fruit
  // has fiber so many are low-medium GI)
  // ═══════════════════════════════════════════════════════════════

  // Low GI fruits (under 55)
  apple: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  pear: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  peach: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  plum: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  nectarine: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  apricot: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  cherry: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  strawberry: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  blueberry: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  raspberry: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  blackberry: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  cranberry: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  grapefruit: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  orange: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  tangerine: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  clementine: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  mandarin: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  lemon: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  lime: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'lemon juice': ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'lime juice': ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  grape: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  kiwi: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  guava: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  pomegranate: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'passion fruit': ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  fig: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  persimmon: ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'dragon fruit': ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'star fruit': ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  avocado: ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // Medium GI fruits (55-69)
  banana: ['medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  mango: ['medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  papaya: ['medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  pineapple: ['medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  cantaloupe: ['medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  honeydew: ['medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'dried fig': ['medium-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // High GI fruits (70+)
  watermelon: ['high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  date: ['high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  raisin: ['medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'dried cranberry': ['medium-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // ═══════════════════════════════════════════════════════════════
  // SIMPLE SUGARS & SWEETENERS
  // ═══════════════════════════════════════════════════════════════
  sugar: ['high-carb', 'simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'white sugar': ['high-carb', 'simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'brown sugar': ['high-carb', 'simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'powdered sugar': ['high-carb', 'simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'confectioners sugar': ['high-carb', 'simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'cane sugar': ['high-carb', 'simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'turbinado sugar': ['high-carb', 'simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'coconut sugar': ['high-carb', 'simple-sugar', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  honey: ['high-carb', 'simple-sugar', 'high-gi', 'gluten-free', 'dairy-free'],
  'maple syrup': ['high-carb', 'simple-sugar', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  agave: ['high-carb', 'simple-sugar', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'agave nectar': ['high-carb', 'simple-sugar', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  molasses: ['high-carb', 'simple-sugar', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'corn syrup': ['high-carb', 'simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'rice syrup': ['high-carb', 'simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'condensed milk': ['high-carb', 'simple-sugar', 'medium-gi', 'gluten-free'],
  'sweetened condensed milk': ['high-carb', 'simple-sugar', 'medium-gi', 'gluten-free'],
  jam: ['high-carb', 'simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  jelly: ['high-carb', 'simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  marmalade: ['high-carb', 'simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'chocolate chips': ['high-carb', 'simple-sugar', 'medium-gi', 'gluten-free'],
  'dark chocolate': ['simple-sugar', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'milk chocolate': ['simple-sugar', 'high-gi', 'gluten-free'],
  'white chocolate': ['simple-sugar', 'high-gi', 'gluten-free'],
  'fruit juice': ['simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'orange juice': ['simple-sugar', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'apple juice': ['simple-sugar', 'high-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'cranberry juice': ['simple-sugar', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'apple cider': ['simple-sugar', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'vanilla extract': ['vegan', 'gluten-free', 'dairy-free'],

  // ═══════════════════════════════════════════════════════════════
  // HIGH FAT (>20g fat per 100g) — Oils, nuts, seeds, fatty dairy
  // ═══════════════════════════════════════════════════════════════

  // Oils (100% fat)
  'olive oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'extra virgin olive oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'coconut oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'vegetable oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'canola oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'avocado oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'sesame oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'peanut oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'sunflower oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'grapeseed oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'flaxseed oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'walnut oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'truffle oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'chili oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'crispy chili oil': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  ghee: ['high-fat', 'gluten-free'],
  lard: ['high-fat', 'gluten-free', 'dairy-free'],

  // Butter & spreads
  butter: ['high-fat', 'gluten-free'],
  'unsalted butter': ['high-fat', 'gluten-free'],
  margarine: ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'coconut cream': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],

  // Nuts (high fat, low GI)
  almond: ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  walnut: ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  pecan: ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  cashew: ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  pistachio: ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  macadamia: ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'brazil nut': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  hazelnut: ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'pine nut': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  peanut: ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'peanut butter': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'almond butter': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'cashew butter': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'sunflower seed butter': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  tahini: ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  coconut: ['high-fat', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'shredded coconut': ['high-fat', 'medium-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'coconut milk': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],

  // Seeds (high fat, low GI)
  'chia seed': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'flaxseed': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'flaxseed meal': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'hemp seed': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'pumpkin seed': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'sunflower seed': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'sesame seed': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'poppy seed': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'watermelon seed': ['high-fat', 'low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  'basil seed': ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],

  // ═══════════════════════════════════════════════════════════════
  // DAIRY (vary by type — generally gluten-free)
  // ═══════════════════════════════════════════════════════════════
  milk: ['gluten-free', 'low-gi'],
  'whole milk': ['gluten-free', 'low-gi'],
  'skim milk': ['gluten-free', 'low-gi'],
  '2% milk': ['gluten-free', 'low-gi'],
  cream: ['high-fat', 'gluten-free'],
  'heavy cream': ['high-fat', 'gluten-free'],
  'whipping cream': ['high-fat', 'gluten-free'],
  'half and half': ['high-fat', 'gluten-free'],
  'sour cream': ['high-fat', 'gluten-free'],
  'cream cheese': ['high-fat', 'gluten-free'],
  cheese: ['high-fat', 'gluten-free'],
  mozzarella: ['high-fat', 'high-protein', 'gluten-free'],
  cheddar: ['high-fat', 'high-protein', 'gluten-free'],
  parmesan: ['high-fat', 'high-protein', 'gluten-free'],
  parmesean: ['high-fat', 'high-protein', 'gluten-free'],
  pecorino: ['high-fat', 'high-protein', 'gluten-free'],
  gruyere: ['high-fat', 'high-protein', 'gluten-free'],
  swiss: ['high-fat', 'high-protein', 'gluten-free'],
  provolone: ['high-fat', 'high-protein', 'gluten-free'],
  gouda: ['high-fat', 'high-protein', 'gluten-free'],
  brie: ['high-fat', 'gluten-free'],
  camembert: ['high-fat', 'gluten-free'],
  'blue cheese': ['high-fat', 'gluten-free'],
  gorgonzola: ['high-fat', 'gluten-free'],
  feta: ['high-fat', 'gluten-free'],
  'goat cheese': ['high-fat', 'gluten-free'],
  'pepper jack': ['high-fat', 'gluten-free'],
  'jack cheese': ['high-fat', 'gluten-free'],
  'colby jack': ['high-fat', 'gluten-free'],
  'american cheese': ['high-fat', 'gluten-free'],
  'string cheese': ['gluten-free'],
  mascarpone: ['high-fat', 'gluten-free'],
  'queso fresco': ['high-fat', 'gluten-free'],
  paneer: ['high-fat', 'high-protein', 'gluten-free'],

  // Non-dairy milk alternatives
  'almond milk': ['vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'oat milk': ['vegan', 'dairy-free'],
  'soy milk': ['vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'coconut milk': ['high-fat', 'vegan', 'gluten-free', 'dairy-free'],
  'cashew milk': ['vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'rice milk': ['vegan', 'gluten-free', 'dairy-free', 'high-gi'],

  // ═══════════════════════════════════════════════════════════════
  // FERMENTED FOODS
  // ═══════════════════════════════════════════════════════════════
  kimchi: ['fermented', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  sauerkraut: ['fermented', 'vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  miso: ['fermented', 'vegan', 'dairy-free', 'low-gi'],
  'miso paste': ['fermented', 'vegan', 'dairy-free', 'low-gi'],
  'soy sauce': ['fermented', 'vegan', 'dairy-free'],
  tamari: ['fermented', 'vegan', 'gluten-free', 'dairy-free'],
  'fish sauce': ['fermented', 'gluten-free', 'dairy-free'],
  kombucha: ['fermented', 'vegan', 'gluten-free', 'dairy-free'],
  kefir: ['fermented', 'gluten-free', 'low-gi'],
  'apple cider vinegar': ['fermented', 'vegan', 'gluten-free', 'dairy-free'],
  'balsamic vinegar': ['fermented', 'vegan', 'gluten-free', 'dairy-free'],
  'red wine vinegar': ['fermented', 'vegan', 'gluten-free', 'dairy-free'],
  'white vinegar': ['fermented', 'vegan', 'gluten-free', 'dairy-free'],
  'rice vinegar': ['fermented', 'vegan', 'gluten-free', 'dairy-free'],

  // ═══════════════════════════════════════════════════════════════
  // CONDIMENTS & SAUCES
  // ═══════════════════════════════════════════════════════════════
  ketchup: ['vegan', 'gluten-free', 'dairy-free'],
  mustard: ['vegan', 'gluten-free', 'dairy-free'],
  'dijon mustard': ['vegan', 'gluten-free', 'dairy-free'],
  'brown mustard': ['vegan', 'gluten-free', 'dairy-free'],
  'honey mustard': ['gluten-free', 'dairy-free'],
  mayonnaise: ['gluten-free', 'dairy-free'],
  'bbq sauce': ['vegan', 'gluten-free', 'dairy-free'],
  sriracha: ['vegan', 'gluten-free', 'dairy-free'],
  'hot sauce': ['vegan', 'gluten-free', 'dairy-free'],
  salsa: ['vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  pesto: ['gluten-free'],
  'hoisin sauce': ['vegan', 'dairy-free'],
  'teriyaki sauce': ['vegan', 'dairy-free'],
  'oyster sauce': ['gluten-free', 'dairy-free'],
  'worcestershire sauce': ['dairy-free'],
  'steak sauce': ['vegan', 'dairy-free'],
  'pasta sauce': ['vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  marinara: ['vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'korma sauce': ['gluten-free'],
  'curry paste': ['vegan', 'gluten-free', 'dairy-free'],
  'coconut amino': ['vegan', 'gluten-free', 'dairy-free'],

  // Dressings & vinaigrettes
  'balsamic vinaigrette': ['vegan', 'gluten-free', 'dairy-free'],
  'ranch dressing': ['gluten-free'],
  'italian dressing': ['vegan', 'gluten-free', 'dairy-free'],
  vinaigrette: ['vegan', 'gluten-free', 'dairy-free'],

  // ═══════════════════════════════════════════════════════════════
  // HERBS & SPICES (all vegan, gluten-free, dairy-free, low-gi)
  // ═══════════════════════════════════════════════════════════════
  basil: ['vegan', 'gluten-free', 'dairy-free'],
  cilantro: ['vegan', 'gluten-free', 'dairy-free'],
  parsley: ['vegan', 'gluten-free', 'dairy-free'],
  mint: ['vegan', 'gluten-free', 'dairy-free'],
  dill: ['vegan', 'gluten-free', 'dairy-free'],
  rosemary: ['vegan', 'gluten-free', 'dairy-free'],
  thyme: ['vegan', 'gluten-free', 'dairy-free'],
  oregano: ['vegan', 'gluten-free', 'dairy-free'],
  sage: ['vegan', 'gluten-free', 'dairy-free'],
  tarragon: ['vegan', 'gluten-free', 'dairy-free'],
  bay: ['vegan', 'gluten-free', 'dairy-free'],
  cumin: ['vegan', 'gluten-free', 'dairy-free'],
  coriander: ['vegan', 'gluten-free', 'dairy-free'],
  paprika: ['vegan', 'gluten-free', 'dairy-free'],
  'smoked paprika': ['vegan', 'gluten-free', 'dairy-free'],
  cayenne: ['vegan', 'gluten-free', 'dairy-free'],
  'chili powder': ['vegan', 'gluten-free', 'dairy-free'],
  'red pepper flake': ['vegan', 'gluten-free', 'dairy-free'],
  turmeric: ['vegan', 'gluten-free', 'dairy-free'],
  cinnamon: ['vegan', 'gluten-free', 'dairy-free'],
  nutmeg: ['vegan', 'gluten-free', 'dairy-free'],
  clove: ['vegan', 'gluten-free', 'dairy-free'],
  cardamom: ['vegan', 'gluten-free', 'dairy-free'],
  'garam masala': ['vegan', 'gluten-free', 'dairy-free'],
  'curry powder': ['vegan', 'gluten-free', 'dairy-free'],
  'italian seasoning': ['vegan', 'gluten-free', 'dairy-free'],
  'old bay': ['vegan', 'gluten-free', 'dairy-free'],
  'garlic powder': ['vegan', 'gluten-free', 'dairy-free'],
  'onion powder': ['vegan', 'gluten-free', 'dairy-free'],
  salt: ['vegan', 'gluten-free', 'dairy-free'],
  'black pepper': ['vegan', 'gluten-free', 'dairy-free'],
  'white pepper': ['vegan', 'gluten-free', 'dairy-free'],
  'lemon pepper': ['vegan', 'gluten-free', 'dairy-free'],
  tajin: ['vegan', 'gluten-free', 'dairy-free'],
  'everything bagel seasoning': ['vegan', 'gluten-free', 'dairy-free'],
  harrisa: ['vegan', 'gluten-free', 'dairy-free'],
  'five spice': ['vegan', 'gluten-free', 'dairy-free'],
  saffron: ['vegan', 'gluten-free', 'dairy-free'],
  allspice: ['vegan', 'gluten-free', 'dairy-free'],
  'star anise': ['vegan', 'gluten-free', 'dairy-free'],

  // ═══════════════════════════════════════════════════════════════
  // BAKING & PANTRY
  // ═══════════════════════════════════════════════════════════════
  'baking powder': ['vegan', 'gluten-free', 'dairy-free'],
  'baking soda': ['vegan', 'gluten-free', 'dairy-free'],
  yeast: ['vegan', 'gluten-free', 'dairy-free'],
  gelatin: ['gluten-free', 'dairy-free'],
  cocoa: ['vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  cacao: ['vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'cocoa powder': ['vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'matcha powder': ['vegan', 'gluten-free', 'dairy-free', 'low-gi'],
  'maca powder': ['vegan', 'gluten-free', 'dairy-free'],
  spirulina: ['vegan', 'gluten-free', 'dairy-free'],

  // ═══════════════════════════════════════════════════════════════
  // BROTHS & STOCKS
  // ═══════════════════════════════════════════════════════════════
  'chicken broth': ['gluten-free', 'dairy-free'],
  'chicken stock': ['gluten-free', 'dairy-free'],
  'beef broth': ['gluten-free', 'dairy-free'],
  'beef stock': ['gluten-free', 'dairy-free'],
  'vegetable broth': ['vegan', 'gluten-free', 'dairy-free'],
  'vegetable stock': ['vegan', 'gluten-free', 'dairy-free'],
  'bone broth': ['gluten-free', 'dairy-free'],

  // ═══════════════════════════════════════════════════════════════
  // BEVERAGES
  // ═══════════════════════════════════════════════════════════════
  coffee: ['vegan', 'gluten-free', 'dairy-free'],
  tea: ['vegan', 'gluten-free', 'dairy-free'],
  'green tea': ['vegan', 'gluten-free', 'dairy-free'],
  water: ['vegan', 'gluten-free', 'dairy-free'],
  'coconut water': ['low-gi', 'vegan', 'gluten-free', 'dairy-free'],
  wine: ['vegan', 'gluten-free', 'dairy-free'],
  beer: ['vegan', 'dairy-free'],
};

/**
 * Get auto-tags for an ingredient name by matching against known mappings.
 * Uses substring matching (longest match first).
 */
export function getIngredientTags(ingredientName) {
  if (!ingredientName) return [];
  const lower = ingredientName.toLowerCase().trim();

  // Try exact match first
  if (INGREDIENT_TAG_MAP[lower]) return [...INGREDIENT_TAG_MAP[lower]];

  // Try substring matches, longest first
  const keys = Object.keys(INGREDIENT_TAG_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key)) return [...INGREDIENT_TAG_MAP[key]];
  }

  return [];
}

/**
 * Get the union of all tags for a recipe's ingredients.
 */
export function getRecipeTags(recipe) {
  if (!recipe?.ingredients) return [];
  const tagSet = new Set();
  for (const ing of recipe.ingredients) {
    const tags = getIngredientTags(ing.ingredient);
    for (const tag of tags) tagSet.add(tag);
  }
  return [...tagSet];
}

/**
 * Check if a recipe matches ANY of the given tag filters.
 */
export function recipeMatchesTags(recipe, tagFilters) {
  if (!tagFilters || tagFilters.size === 0) return true;
  const recipeTags = new Set(getRecipeTags(recipe));
  for (const tag of tagFilters) {
    if (recipeTags.has(tag)) return true;
  }
  return false;
}

/**
 * Get tag info (label, color) for a tag key.
 */
export function getTagInfo(tagKey) {
  const tag = ALL_TAGS.find(t => t.key === tagKey);
  if (!tag) return { label: tagKey, color: '#999' };
  const cat = TAG_CATEGORIES[tag.category];
  return { label: tag.label, color: cat?.color || '#999' };
}
