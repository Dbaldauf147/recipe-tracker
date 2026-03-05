const MEAT = [
  'chicken', 'beef', 'pork', 'lamb', 'turkey', 'duck', 'veal', 'venison', 'bison',
  'steak', 'bacon', 'ham', 'sausage', 'salami', 'pepperoni', 'prosciutto', 'pancetta',
  'ground beef', 'ground turkey', 'ground chicken', 'ground pork', 'ground lamb',
  'meatball', 'meatloaf', 'ribs', 'tenderloin', 'sirloin', 'brisket',
  'drumstick', 'chorizo', 'bratwurst', 'hot dog', 'deli meat', 'bologna',
  'pork chop', 'pork loin', 'pulled pork', 'carnitas', 'ribeye', 'filet mignon',
  'chicken breast', 'chicken thigh', 'chicken wing', 'chicken leg',
  'bone broth', 'chicken broth', 'beef broth', 'chicken stock', 'beef stock',
  'kielbasa', 'roast', 'pastrami', 'corned beef', 'jerky',
];

const FISH = [
  'salmon', 'tuna', 'cod', 'halibut', 'tilapia', 'trout', 'sardine', 'anchovy',
  'mackerel', 'swordfish', 'mahi mahi', 'snapper', 'bass', 'catfish', 'perch',
  'shrimp', 'prawn', 'crab', 'lobster', 'clam', 'mussel', 'oyster', 'scallop',
  'squid', 'calamari', 'octopus', 'crawfish', 'crayfish', 'walleye',
  'fish', 'seafood',
];

const DAIRY = [
  'milk', 'cheese', 'yogurt', 'butter', 'cream', 'ghee', 'whey',
  'cheddar', 'mozzarella', 'parmesan', 'feta', 'ricotta', 'gouda', 'brie',
  'gruyere', 'provolone', 'cream cheese', 'cottage cheese',
  'sour cream', 'heavy cream', 'whipping cream', 'half and half', 'buttermilk',
  'mascarpone', 'ice cream',
];

const NOT_DAIRY = [
  'coconut milk', 'almond milk', 'oat milk', 'soy milk', 'rice milk', 'cashew milk',
  'coconut cream', 'coconut butter', 'vegan cheese', 'vegan butter', 'plant butter',
  'peanut butter', 'almond butter', 'sunflower butter', 'cashew butter',
  'cocoa butter', 'shea butter',
];

const NOT_FISH = [
  'fish sauce', 'oyster sauce',
];

function buildPattern(words) {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp('\\b(' + escaped.join('|') + ')\\b', 'i');
}

const MEAT_PAT = buildPattern(MEAT);
const FISH_PAT = buildPattern(FISH);
const DAIRY_PAT = buildPattern(DAIRY);
const NOT_DAIRY_PAT = buildPattern(NOT_DAIRY);
const NOT_FISH_PAT = buildPattern(NOT_FISH);
const EGG_PAT = /\beggs?\b/i;

/**
 * Classify a recipe's meal type from its ingredients list.
 * Returns 'meat', 'pescatarian', 'vegetarian', or 'vegan'.
 */
export function classifyMealType(ingredients) {
  if (!ingredients || ingredients.length === 0) return '';

  const names = ingredients
    .map(ing => (typeof ing === 'string' ? ing : (ing.ingredient || '')).trim().toLowerCase())
    .filter(Boolean);

  if (names.length === 0) return '';

  let hasMeat = false;
  let hasFish = false;
  let hasDairy = false;
  let hasEggs = false;

  for (const name of names) {
    if (MEAT_PAT.test(name)) hasMeat = true;
    if (!NOT_FISH_PAT.test(name) && FISH_PAT.test(name)) hasFish = true;
    if (!NOT_DAIRY_PAT.test(name) && DAIRY_PAT.test(name)) hasDairy = true;
    if (EGG_PAT.test(name)) hasEggs = true;
  }

  if (hasMeat) return 'meat';
  if (hasFish) return 'pescatarian';
  if (hasDairy || hasEggs) return 'vegetarian';
  return 'vegan';
}
