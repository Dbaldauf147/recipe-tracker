import { useState, useMemo, useCallback } from 'react';
import { loadIngredients, saveIngredientsToFirestore } from '../utils/ingredientsStore.js';
import styles from './ShoppingList.module.css';

function parseFraction(str) {
  if (!str) return 0;
  const s = str.trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}

function formatQuantity(n) {
  if (n === 0) return '';
  if (Number.isInteger(n)) return n.toLocaleString();
  return parseFloat(n.toFixed(2)).toLocaleString();
}

// ── Grocery store section categorization ──
const SECTIONS = [
  { key: 'produce', label: 'Produce' },
  { key: 'meat',    label: 'Meat & Seafood' },
  { key: 'dairy',   label: 'Dairy & Eggs' },
  { key: 'bakery',  label: 'Bakery' },
  { key: 'frozen',  label: 'Frozen' },
  { key: 'grains',  label: 'Grains, Rice & Pasta' },
  { key: 'canned',  label: 'Canned & Jarred' },
  { key: 'baking',  label: 'Baking' },
  { key: 'spices',  label: 'Spices & Seasonings' },
  { key: 'oils',    label: 'Oils & Condiments' },
  { key: 'nuts',         label: 'Nuts & Dried Fruit' },
  { key: 'supplements', label: 'Supplements' },
  { key: 'drinks',        label: 'Drinks' },
  { key: 'international', label: 'International Food' },
  { key: 'other',         label: 'Other' },
];

const SECTION_KEYWORDS = {
  produce: [
    'apple', 'apricot', 'arugula', 'artichoke', 'asparagus', 'avocado',
    'banana', 'basil', 'beet', 'bell pepper', 'berry', 'blackberry',
    'blackberries', 'blueberry', 'blueberries', 'bok choy', 'broccoli',
    'broccolini', 'brussels sprout', 'butternut', 'cabbage', 'cantaloupe',
    'carrot', 'cauliflower', 'celery', 'chard', 'cherry', 'cherries',
    'chive', 'cilantro', 'clementine', 'collard', 'corn', 'cranberry',
    'cranberries', 'cucumber', 'daikon', 'dill', 'eggplant', 'endive',
    'escarole', 'fennel', 'fig', 'fruit', 'garlic', 'ginger', 'grape',
    'grapefruit', 'green bean', 'green onion', 'habanero', 'herb',
    'honeydew', 'jalapeno', 'jicama', 'kale', 'kiwi', 'kohlrabi',
    'kumquat', 'leek', 'lemon', 'lettuce', 'lime', 'lychee', 'mango',
    'melon', 'mint', 'mushroom', 'nectarine', 'okra', 'onion', 'orange',
    'papaya', 'parsley', 'parsnip', 'passion fruit', 'pea', 'peach',
    'pear', 'pepper', 'persimmon', 'pineapple', 'plantain', 'plum',
    'poblano', 'pomegranate', 'potato', 'pumpkin', 'radicchio', 'radish',
    'raspberry', 'raspberries', 'rhubarb', 'romaine', 'rosemary', 'rutabaga',
    'sage', 'scallion', 'serrano', 'shallot', 'snap pea', 'snow pea',
    'spinach', 'spring mix', 'sprout', 'squash', 'starfruit', 'strawberry',
    'strawberries', 'sweet potato', 'tangerine', 'thyme', 'tomatillo',
    'tomato', 'turnip', 'vegetable', 'veggie', 'watermelon', 'watercress',
    'yam', 'zucchini', 'edamame', 'mixed greens', 'baby spinach',
    'red onion', 'yellow onion', 'white onion', 'red pepper', 'green pepper',
    'yellow pepper', 'jalapeno pepper', 'roma tomato', 'cherry tomato',
    'grape tomato', 'heirloom tomato', 'russet potato', 'yukon gold',
    'baby carrot', 'fresh herb', 'mixed berry', 'mixed berries',
  ],
  meat: [
    'beef', 'bison', 'chicken', 'duck', 'ground turkey', 'ham', 'lamb',
    'pork', 'prosciutto', 'salami', 'sausage', 'steak', 'turkey', 'veal',
    'venison', 'bacon', 'chorizo', 'pepperoni', 'meatball', 'meat',
    'ground beef', 'ground pork', 'ground chicken', 'chicken breast',
    'chicken thigh', 'chicken wing', 'chicken drumstick', 'chicken tender',
    'pork chop', 'pork loin', 'pork tenderloin', 'pork belly', 'ribs',
    'short rib', 'sirloin', 'ribeye', 'filet', 'flank steak', 'roast',
    'tenderloin', 'brisket', 'pastrami', 'deli meat', 'lunch meat',
    'hot dog', 'bratwurst', 'kielbasa', 'andouille', 'italian sausage',
    'breakfast sausage', 'turkey sausage', 'chicken sausage',
    'salmon', 'tuna', 'shrimp', 'prawn', 'cod', 'tilapia', 'halibut',
    'crab', 'lobster', 'scallop', 'clam', 'mussel', 'oyster', 'anchovy',
    'sardine', 'trout', 'catfish', 'mahi', 'swordfish', 'fish', 'bass',
    'snapper', 'grouper', 'haddock', 'perch', 'pike', 'walleye',
    'seafood', 'calamari', 'octopus', 'crawfish', 'crayfish',
  ],
  dairy: [
    'butter', 'buttermilk', 'cheddar', 'cheese', 'colby', 'cottage cheese',
    'cream cheese', 'cream', 'crema', 'egg', 'feta', 'ghee', 'gouda',
    'gruyere', 'half and half', 'half-and-half', 'heavy cream',
    'heavy whipping', 'kefir', 'mascarpone', 'milk', 'monterey jack',
    'mozzarella', 'parmesan', 'pecorino', 'provolone', 'queso',
    'ricotta', 'sour cream', 'swiss', 'whipped cream', 'whipping cream',
    'yogurt', 'goat cheese', 'brie', 'camembert', 'havarti', 'muenster',
    'string cheese', 'american cheese', 'velveeta', 'neufchatel',
    'greek yogurt', 'plain yogurt', 'skyr', 'labneh',
    'whole milk', 'skim milk', '2% milk', '1% milk',
    'unsalted butter', 'salted butter', 'margarine',
    'egg white', 'egg yolk', 'liquid egg',
  ],
  bakery: [
    'bagel', 'baguette', 'bread', 'brioche', 'bun', 'ciabatta',
    'cornbread', 'crouton', 'english muffin', 'flatbread', 'focaccia',
    'hamburger bun', 'hot dog bun', 'naan', 'pita', 'roll', 'sourdough',
    'tortilla', 'wrap', 'croissant', 'muffin', 'donut', 'doughnut',
    'danish', 'scone', 'biscuit', 'cornbread mix', 'dinner roll',
    'hoagie', 'sub roll', 'slider bun', 'rye bread', 'pumpernickel',
    'whole wheat bread', 'white bread', 'multigrain', 'flour tortilla',
    'corn tortilla', 'lavash', 'challah', 'texas toast',
  ],
  frozen: [
    'frozen', 'ice cream', 'popsicle', 'sorbet', 'gelato',
    'frozen waffle', 'frozen pizza', 'frozen fruit', 'frozen vegetable',
  ],
  grains: [
    'barley', 'basmati', 'brown rice', 'buckwheat', 'bulgur', 'cereal',
    'couscous', 'farro', 'fusilli', 'granola', 'jasmine rice', 'linguine',
    'macaroni', 'noodle', 'oat', 'oatmeal', 'orzo', 'pasta', 'penne',
    'polenta', 'quinoa', 'ramen', 'rice', 'rigatoni', 'rotini',
    'spaghetti', 'udon', 'vermicelli', 'wild rice', 'white rice',
    'angel hair', 'bow tie', 'farfalle', 'lasagna', 'lasagne',
    'elbow macaroni', 'egg noodle', 'rice noodle', 'soba',
    'tortellini', 'ravioli', 'gnocchi', 'millet', 'amaranth',
    'cream of wheat', 'grits', 'instant oat', 'rolled oat',
    'steel cut oat', 'cracker', 'rice cake', 'popcorn',
    'pretzel', 'chip', 'tortilla chip',
  ],
  canned: [
    'canned', 'tinned', 'tomato paste', 'tomato sauce', 'crushed tomato',
    'diced tomato', 'stewed tomato', 'san marzano', 'bean', 'chickpea',
    'lentil', 'black bean', 'kidney bean', 'pinto bean', 'white bean',
    'navy bean', 'garbanzo', 'coconut milk', 'coconut cream',
    'broth', 'stock', 'bouillon', 'condensed', 'evaporated milk',
    'artichoke heart', 'roasted pepper', 'pickle', 'caper',
    'sun-dried tomato', 'sundried tomato', 'chipotle in adobo',
    'marinara sauce', 'enchilada sauce', 'green chile', 'diced green',
    'cream of mushroom', 'cream of chicken', 'tomato soup',
    'olive', 'kalamata', 'jalapeno jar', 'pepperoncini',
    'bamboo shoot', 'water chestnut', 'hearts of palm',
    'refried bean', 'baked bean', 'chili bean',
    'chicken broth', 'beef broth', 'vegetable broth', 'bone broth',
    'pasta sauce', 'pizza sauce', 'alfredo sauce',
  ],
  baking: [
    'flour', 'sugar', 'brown sugar', 'powdered sugar', 'confectioner',
    'baking soda', 'baking powder', 'yeast', 'cornstarch', 'corn starch',
    'cream of tartar', 'cocoa', 'chocolate chip', 'chocolate',
    'vanilla extract', 'almond extract', 'food coloring', 'sprinkles',
    'gelatin', 'pectin', 'molasses', 'corn syrup', 'shortening',
    'cake mix', 'brownie mix', 'pancake mix', 'bread crumb',
    'panko', 'graham cracker', 'coconut flour', 'almond flour',
    'tapioca starch', 'arrowroot', 'xanthan gum', 'meringue powder',
    'pie crust', 'puff pastry', 'phyllo', 'marshmallow',
    'sweetened condensed', 'evaporated', 'cream of coconut',
    'vanilla bean', 'extract', 'food color', 'icing',
    'whole wheat flour', 'self-rising flour', 'cake flour',
    'cornmeal', 'semolina',
  ],
  spices: [
    'allspice', 'anise', 'basil dried', 'bay leaf', 'black pepper',
    'cajun', 'cardamom', 'cayenne', 'chili flake', 'chili powder',
    'chinese five spice', 'cinnamon', 'clove', 'coriander', 'cumin',
    'curry', 'curry powder', 'dill weed', 'everything bagel', 'fennel seed',
    'garam masala', 'garlic powder', 'garlic salt', 'ginger powder',
    'italian seasoning', 'lemon pepper', 'marjoram', 'mustard powder',
    'mustard seed', 'nutmeg', 'onion powder', 'oregano', 'paprika',
    'pepper flake', 'red pepper flake', 'crushed red pepper',
    'rosemary dried', 'saffron', 'salt', 'sea salt', 'kosher salt',
    'seasoning', 'seasoned salt', 'sesame seed', 'smoked paprika',
    'star anise', 'sumac', 'tarragon', 'thyme dried', 'turmeric',
    'white pepper', 'spice', 'herb blend', 'za\'atar', 'tajin',
    'old bay', 'taco seasoning', 'ranch seasoning', 'adobo seasoning',
    'celery salt', 'celery seed', 'dried oregano', 'dried basil',
    'dried thyme', 'dried parsley', 'dried rosemary', 'poultry seasoning',
    'steak seasoning', 'montreal seasoning', 'chili lime',
  ],
  oils: [
    'olive oil', 'canola oil', 'coconut oil', 'cooking spray', 'corn oil',
    'avocado oil', 'fish sauce', 'grapeseed oil', 'hot sauce', 'hoisin',
    'honey', 'jam', 'jelly', 'ketchup', 'maple syrup', 'marinara',
    'mayo', 'mayonnaise', 'mirin', 'miso', 'mustard', 'dijon',
    'yellow mustard', 'whole grain mustard', 'oyster sauce',
    'peanut butter', 'almond butter', 'sunflower butter', 'nutella',
    'preserves', 'ranch', 'relish', 'salad dressing', 'salsa',
    'sesame oil', 'soy sauce', 'sriracha', 'tahini', 'tamari',
    'teriyaki', 'vinegar', 'vegetable oil', 'oil', 'worcestershire',
    'bbq sauce', 'buffalo sauce', 'chili sauce', 'chimichurri',
    'pesto', 'tzatziki', 'hummus', 'guacamole', 'agave',
    'rice vinegar', 'balsamic', 'apple cider vinegar', 'red wine vinegar',
    'white wine vinegar', 'sherry vinegar', 'champagne vinegar',
    'extra virgin', 'evoo', 'spray oil', 'cooking oil',
    'steak sauce', 'a1', 'chutney', 'aioli', 'remoulade',
    'cocktail sauce', 'tartar sauce', 'duck sauce', 'plum sauce',
    'truffle oil', 'walnut oil', 'flaxseed oil',
  ],
  nuts: [
    'almond', 'brazil nut', 'cashew', 'chestnut', 'dried cranberry',
    'craisin', 'date', 'dried apricot', 'dried fig', 'dried fruit',
    'flax', 'hazelnut', 'hemp seed', 'macadamia', 'mixed nut',
    'pecan', 'pine nut', 'pistachio', 'poppy seed', 'pumpkin seed',
    'raisin', 'seed', 'sunflower seed', 'trail mix', 'walnut',
    'chia', 'coconut flake', 'shredded coconut',
  ],
  supplements: [
    'protein powder', 'protien powder', 'whey', 'creatine', 'collagen',
    'multivitamin', 'vitamin', 'fish oil', 'omega', 'probiotic',
    'prebiotic', 'magnesium supplement', 'zinc supplement', 'iron supplement',
    'calcium supplement', 'b12', 'vitamin d', 'vitamin c supplement',
    'electrolyte', 'bcaa', 'spirulina', 'chlorella', 'maca powder',
    'ashwagandha', 'turmeric supplement', 'supplement', 'david bar',
  ],
  drinks: [
    'juice', 'orange juice', 'apple juice', 'cranberry juice', 'lemonade',
    'coffee', 'tea', 'matcha', 'kombucha', 'soda', 'seltzer', 'sparkling water',
    'coconut water', 'almond milk', 'oat milk', 'soy milk', 'beer', 'wine',
    'whiskey', 'vodka', 'rum', 'tequila', 'gin', 'hard seltzer', 'cider',
    'smoothie', 'energy drink', 'gatorade', 'sports drink',
  ],
  international: [
    'kimchi', 'gochujang', 'gochugaru', 'miso', 'nori', 'seaweed',
    'rice paper', 'wonton', 'dumpling', 'gyoza', 'tofu', 'tempeh',
    'sambal', 'curry paste', 'thai basil', 'lemongrass', 'galangal',
    'fish sauce', 'hoisin', 'hosin', 'oyster sauce', 'soba', 'udon',
    'ramen noodle', 'rice noodle', 'mirin', 'sake', 'wasabi',
    'harissa', 'tahini', 'za\'atar', 'sumac', 'pomegranate molasses',
    'tortilla chip', 'tostitos', 'salsa verde', 'chipotle', 'adobo',
    'plantain chip', 'coconut amino', 'tamarind', 'korma',
  ],
};

// Build a flat list of [keyword, section] pairs sorted longest-first so
// "tomato paste" matches canned before "tomato" matches produce, etc.
const ALL_KEYWORDS = Object.entries(SECTION_KEYWORDS)
  .flatMap(([section, keywords]) => keywords.map(kw => [kw, section]))
  .sort((a, b) => b[0].length - a[0].length);

function categorizeIngredient(name, dbSections) {
  // Normalize: lowercase, strip diacritics (jalapeño → jalapeno)
  const lower = name.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // If the ingredients DB has a section override for this ingredient, use it
  if (dbSections) {
    const override = dbSections[lower];
    if (override) return override;
  }

  // "frozen X" always goes to frozen
  if (lower.startsWith('frozen ')) return 'frozen';

  // Try all keywords longest-first; first match wins
  for (const [kw, section] of ALL_KEYWORDS) {
    const idx = lower.indexOf(kw);
    if (idx !== -1) {
      // Check word boundary before the match
      const before = idx === 0 || /[\s,(-]/.test(lower[idx - 1]);
      // Check word boundary after the match, allowing common plural suffixes (s, es)
      const afterPos = idx + kw.length;
      const after = afterPos >= lower.length
        || /^(\(s\)|\(es\)|s|es)?(\s|,|\)|$|-)/i.test(lower.slice(afterPos));
      if (before && after) return section;
    }
  }

  return 'other';
}

function groupBySection(items, dbSections) {
  const groups = {};
  for (const section of SECTIONS) {
    groups[section.key] = [];
  }
  for (const item of items) {
    const section = categorizeIngredient(item.ingredient, dbSections);
    groups[section].push(item);
  }
  // Sort items within each group alphabetically
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => a.ingredient.localeCompare(b.ingredient));
  }
  return groups;
}

function mergeIntoMap(map, ingredient, measurement, quantity) {
  const name = ingredient.toLowerCase().trim();
  if (!name) return;
  const qty = parseFraction(quantity);
  if (map.has(name)) {
    const entry = map.get(name);
    entry.quantity += qty;
    // Keep the first non-empty measurement
    if (!entry.measurement && measurement) {
      entry.measurement = measurement;
    }
  } else {
    map.set(name, {
      ingredient: ingredient.trim(),
      measurement: measurement || '',
      quantity: qty,
      recipes: [],
    });
  }
}

function buildShoppingList(recipes, weeklyServings = {}) {
  const map = new Map();
  for (const recipe of recipes) {
    const baseServings = parseInt(recipe.servings) || 1;
    const plannedServings = weeklyServings[recipe.id] ?? baseServings;
    const scale = plannedServings / baseServings;
    for (const ing of recipe.ingredients) {
      const qty = parseFraction(ing.quantity);
      const scaledQty = qty * scale;
      const name = (ing.ingredient || '').toLowerCase().trim();
      if (!name) continue;
      const meas = (ing.measurement || '').toLowerCase().trim();
      if (map.has(name)) {
        const entry = map.get(name);
        entry.quantity += scaledQty;
        if (!entry.measurement && ing.measurement) {
          entry.measurement = ing.measurement;
        }
        if (!entry.recipes.includes(recipe.title)) {
          entry.recipes.push(recipe.title);
        }
      } else {
        map.set(name, {
          ingredient: ing.ingredient.trim(),
          measurement: ing.measurement || '',
          quantity: scaledQty,
          recipes: [recipe.title],
        });
      }
    }
  }
  return map;
}

// Unit conversion tables
const VOLUME_TO_ML = { ml: 1, tsp: 4.93, tbsp: 14.79, 'fl oz': 29.57, cup: 236.59, pt: 473.18, qt: 946.35, gal: 3785.41, l: 1000 };
const WEIGHT_TO_G = { g: 1, mg: 0.001, oz: 28.35, lb: 453.59, kg: 1000 };
const VOLUME_UNITS = ['tsp', 'tbsp', 'fl oz', 'cup', 'pt', 'qt', 'gal', 'ml', 'l'];
const WEIGHT_UNITS = ['g', 'oz', 'lb', 'kg'];
const SIZE_UNITS = ['small', 'medium', 'large', 'piece', 'slice', 'whole', 'can'];

const UNIT_ALIASES = {
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp',
  'fluid ounce': 'fl oz', 'fl oz': 'fl oz',
  cup: 'cup', cups: 'cup',
  pint: 'pt', pints: 'pt', pt: 'pt',
  quart: 'qt', quarts: 'qt', qt: 'qt',
  gallon: 'gal', gallons: 'gal', gal: 'gal',
  milliliter: 'ml', milliliters: 'ml', ml: 'ml',
  liter: 'l', liters: 'l', l: 'l',
  gram: 'g', grams: 'g', g: 'g',
  milligram: 'mg', milligrams: 'mg', mg: 'mg',
  ounce: 'oz', ounces: 'oz', oz: 'oz',
  pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb',
  kilogram: 'kg', kilograms: 'kg', kg: 'kg',
};

function normalizeShopUnit(unit) {
  if (!unit) return '';
  return UNIT_ALIASES[unit.toLowerCase().trim()] || unit.toLowerCase().trim();
}

function getConversions(qty, measurement) {
  if (!measurement || !qty) return [];
  const num = parseFloat(qty);
  if (isNaN(num) || num === 0) return [];
  const unit = normalizeShopUnit(measurement);
  const results = [];

  function fmtConvert(val, unit) {
    // Round grams to nearest 1; others to 2 decimal places
    const rounded = (unit === 'g' || unit === 'mg') ? Math.round(val) : parseFloat(val.toFixed(2));
    // Add comma for thousands
    const display = rounded.toLocaleString();
    return { qty: rounded, label: `${display} ${unit}` };
  }

  if (VOLUME_TO_ML[unit]) {
    const ml = num * VOLUME_TO_ML[unit];
    for (const target of VOLUME_UNITS) {
      if (target === unit) continue;
      const converted = ml / VOLUME_TO_ML[target];
      if (converted >= 0.01 && converted <= 100000) {
        const fmt = fmtConvert(converted, target);
        results.push({ qty: fmt.qty, unit: target, label: fmt.label, type: 'volume' });
      }
    }
  } else if (WEIGHT_TO_G[unit]) {
    const g = num * WEIGHT_TO_G[unit];
    for (const target of WEIGHT_UNITS) {
      if (target === unit) continue;
      const converted = g / WEIGHT_TO_G[target];
      if (converted >= 0.01 && converted <= 100000) {
        const fmt = fmtConvert(converted, target);
        results.push({ qty: fmt.qty, unit: target, label: fmt.label, type: 'weight' });
      }
    }
  }
  return results;
}

export function ShoppingList({ weeklyRecipes, weeklyServings = {}, extraItems = [], onClearExtras, onAddCustomItem, pantryNames, dismissedNames, onDismissItem, user }) {
  const isAdmin = user?.email === 'baldaufdan@gmail.com';

  // Build map of ingredient name (lowercase) → grocerySection from DB
  const [ingredientSections, setIngredientSections] = useState(() => {
    const db = loadIngredients() || [];
    const map = {};
    for (const row of db) {
      if (row.ingredient && row.grocerySection) {
        map[row.ingredient.toLowerCase().trim()] = row.grocerySection;
      }
    }
    return map;
  });

  const handleSectionChange = useCallback(async (ingredientName, newSection) => {
    const db = loadIngredients() || [];
    const lower = ingredientName.toLowerCase().trim();
    let found = false;
    for (const row of db) {
      if (row.ingredient && row.ingredient.toLowerCase().trim() === lower) {
        row.grocerySection = newSection;
        found = true;
        break;
      }
    }
    if (!found) {
      db.push({ ingredient: ingredientName.trim(), grocerySection: newSection });
    }
    await saveIngredientsToFirestore(db);
    setIngredientSections(prev => ({ ...prev, [lower]: newSection }));
  }, []);

  const items = useMemo(() => {
    const map = buildShoppingList(weeklyRecipes, weeklyServings);
    for (const e of extraItems) {
      mergeIntoMap(map, e.ingredient || '', e.measurement || '', e.quantity);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.ingredient.localeCompare(b.ingredient)
    );
  }, [weeklyRecipes, weeklyServings, extraItems]);

  const displayItems = useMemo(() => {
    function wordMatch(a, b) {
      if (a === b) return true;
      // Strip parenthetical suffixes like "(dried)" for matching
      const cleanA = a.replace(/\s*\(.*?\)\s*/g, '').trim();
      const cleanB = b.replace(/\s*\(.*?\)\s*/g, '').trim();
      if (cleanA === cleanB) return true;
      // Check if one is a whole-word substring of the other
      const re = (s) => new RegExp('\\b' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      return re(cleanA).test(cleanB) || re(cleanB).test(cleanA);
    }
    return items.filter(item => {
      const norm = item.ingredient.toLowerCase().trim();
      if (pantryNames) {
        for (const pn of pantryNames) {
          if (wordMatch(norm, pn)) return false;
        }
      }
      if (dismissedNames) {
        for (const dn of dismissedNames) {
          if (wordMatch(norm, dn)) return false;
        }
      }
      return true;
    });
  }, [items, pantryNames, dismissedNames]);

  const ingredientLinks = useMemo(() => {
    const db = loadIngredients() || [];
    const map = {};
    for (const row of db) {
      if (row.ingredient && row.link) {
        map[row.ingredient.toLowerCase().trim()] = row.link;
      }
    }
    // Also collect links from recipe ingredients
    for (const recipe of weeklyRecipes) {
      for (const ing of (recipe.ingredients || [])) {
        if (ing.ingredient && ing.link) {
          const key = ing.ingredient.toLowerCase().trim();
          if (!map[key]) map[key] = ing.link;
        }
      }
    }
    return map;
  }, [weeklyRecipes]);

  const SHOP_LINKS_KEY = 'sunday-shop-links';
  const [customLinks, setCustomLinks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SHOP_LINKS_KEY) || '{}'); } catch { return {}; }
  });
  const [editingLink, setEditingLink] = useState(null); // ingredient key

  function saveCustomLink(ingredientKey, url) {
    setCustomLinks(prev => {
      const next = { ...prev, [ingredientKey]: url };
      localStorage.setItem(SHOP_LINKS_KEY, JSON.stringify(next));
      if (user) {
        import('../utils/firestoreSync').then(m => m.saveField(user.uid, 'shopLinks', next)).catch(() => {});
      }
      return next;
    });
    setEditingLink(null);
  }

  const [checked, setChecked] = useState(new Set());
  const [unitOverrides, setUnitOverrides] = useState({}); // { ingredientKey: targetUnit }
  const [convertPopup, setConvertPopup] = useState(null); // ingredientKey or null
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState('');

  // Build autocomplete suggestions from ingredient DB + recipe ingredients
  const ingredientSuggestions = useMemo(() => {
    const names = new Set();
    const db = loadIngredients() || [];
    for (const row of db) {
      if (row.ingredient) names.add(row.ingredient.trim());
    }
    for (const recipe of weeklyRecipes) {
      for (const ing of (recipe.ingredients || [])) {
        if (ing.ingredient) names.add(ing.ingredient.trim());
      }
    }
    return [...names].sort();
  }, [weeklyRecipes]);
  const [showMeals, setShowMeals] = useState(false);

  function toggleItem(key) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleAddSubmit() {
    const name = newItem.trim();
    if (!name || !onAddCustomItem) return;
    onAddCustomItem({ ingredient: name, quantity: '', measurement: '' });
    setNewItem('');
  }

  if (displayItems.length === 0) {
    return (
      <div className={styles.panel}>
        <h2 className={styles.heading}>Shopping List</h2>
        <p className={styles.emptyMsg}>Shopping list is empty — add meals to populate</p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.headingRow}>
        <h2 className={styles.heading}>Shopping List</h2>
        <div className={styles.headingActions}>
          <button
            className={`${styles.mealsToggle}${showMeals ? ` ${styles.mealsToggleActive}` : ''}`}
            onClick={() => setShowMeals(v => !v)}
          >
            {showMeals ? 'Hide Meals' : 'Show Meals'}
          </button>
          {onAddCustomItem && !adding && (
            <button className={styles.addToggle} onClick={() => setAdding(true)}>+ Add item</button>
          )}
          {extraItems.length > 0 && (
            <button className={styles.clearBtn} onClick={onClearExtras}>
              Return items ({extraItems.length})
            </button>
          )}
        </div>
      </div>
      {adding && onAddCustomItem && (
        <div className={styles.addRow}>
          <div className={styles.addInputWrap}>
            <input
              className={styles.addInput}
              type="text"
              placeholder="Item name"
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddSubmit();
                if (e.key === 'Escape') { setAdding(false); setNewItem(''); }
              }}
              autoFocus
            />
            {newItem.trim().length >= 2 && (() => {
              const q = newItem.trim().toLowerCase();
              const matches = ingredientSuggestions.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
              if (matches.length === 0) return null;
              return (
                <div className={styles.addSuggestions}>
                  {matches.map(n => (
                    <button key={n} className={styles.addSuggestionItem} onMouseDown={e => { e.preventDefault(); setNewItem(n); }}>
                      {n}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
          <button className={styles.addBtn} onClick={handleAddSubmit}>Add</button>
          <button className={styles.addBtn} onClick={() => { setAdding(false); setNewItem(''); }}>Cancel</button>
        </div>
      )}
      {(() => {
        const colCount = 5 + (showMeals ? 1 : 0) + (isAdmin ? 1 : 0) + (onDismissItem ? 1 : 0);
        const grouped = groupBySection(displayItems, ingredientSections);
        return (
          <table className={styles.table}>
            <colgroup>
              <col className={styles.colCheck} />
              <col className={styles.colQty} />
              <col className={styles.colMeas} />
              <col />
              <col className={styles.colLink} />
              {showMeals && <col className={styles.colMeals} />}
              {isAdmin && <col className={styles.colSection} />}
              {onDismissItem && <col className={styles.colDismiss} />}
            </colgroup>
            <tbody>
              {SECTIONS.map(section => {
                const sectionItems = grouped[section.key];
                if (sectionItems.length === 0) return null;
                return [
                  <tr key={`h-${section.key}`} className={styles.sectionHeaderRow}>
                    <td colSpan={colCount} className={styles.sectionHeading}>
                      {section.label}
                    </td>
                  </tr>,
                  ...sectionItems.map((item, i) => {
                    const key = `${item.ingredient}|||${item.measurement}`;
                    const done = checked.has(key);
                    const ingKey = item.ingredient.toLowerCase().trim();
                    const link = customLinks[ingKey] || ingredientLinks[ingKey];
                    const isEditingThis = editingLink === ingKey;
                    return (
                      <tr
                        key={`${section.key}-${i}`}
                        className={done ? styles.checkedRow : ''}
                        onClick={() => toggleItem(key)}
                      >
                        <td className={styles.checkCell}>
                          <input
                            type="checkbox"
                            className={styles.checkbox}
                            checked={done}
                            onChange={() => toggleItem(key)}
                            onClick={e => e.stopPropagation()}
                          />
                        </td>
                        {(() => {
                          const override = unitOverrides[ingKey];
                          const conversions = getConversions(item.quantity, item.measurement);
                          const hasConversions = conversions.length > 0;
                          let displayQty = item.quantity;
                          let displayUnit = item.measurement;

                          if (override && override.unit) {
                            displayQty = override.qty;
                            displayUnit = override.unit;
                          } else if (override) {
                            const match = conversions.find(c => c.unit === override);
                            if (match) { displayQty = match.qty; displayUnit = match.unit; }
                          }

                          return (
                            <>
                              <td className={styles.qtyCell}>{formatQuantity(displayQty)}</td>
                              <td
                                className={styles.measCell}
                                onClick={e => { e.stopPropagation(); setConvertPopup(convertPopup === ingKey ? null : ingKey); }}
                                style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                              >
                                {displayUnit || '—'}
                                {convertPopup === ingKey && (
                                  <div className={styles.convertDropdown} onClick={e => e.stopPropagation()}>
                                    <div className={styles.convertTitle}>Convert to:</div>
                                    <button
                                      className={`${styles.convertOption} ${!override ? styles.convertOptionActive : ''}`}
                                      onClick={() => { setUnitOverrides(prev => { const n = { ...prev }; delete n[ingKey]; return n; }); setConvertPopup(null); }}
                                    >
                                      {formatQuantity(item.quantity)} {item.measurement || '(none)'} (original)
                                    </button>
                                    {hasConversions && conversions.map(c => (
                                      <button
                                        key={c.unit}
                                        className={`${styles.convertOption} ${(typeof override === 'string' && override === c.unit) ? styles.convertOptionActive : ''}`}
                                        onClick={() => { setUnitOverrides(prev => ({ ...prev, [ingKey]: c.unit })); setConvertPopup(null); }}
                                      >
                                        {c.label}
                                      </button>
                                    ))}
                                    {!hasConversions && (
                                      <>
                                        <div className={styles.convertTitle}>Volume</div>
                                        {VOLUME_UNITS.map(u => (
                                          <button key={u} className={styles.convertOption} onClick={() => { setUnitOverrides(prev => ({ ...prev, [ingKey]: { unit: u, qty: item.quantity } })); setConvertPopup(null); }}>{u}</button>
                                        ))}
                                        <div className={styles.convertTitle}>Weight</div>
                                        {WEIGHT_UNITS.map(u => (
                                          <button key={u} className={styles.convertOption} onClick={() => { setUnitOverrides(prev => ({ ...prev, [ingKey]: { unit: u, qty: item.quantity } })); setConvertPopup(null); }}>{u}</button>
                                        ))}
                                      </>
                                    )}
                                  </div>
                                )}
                              </td>
                            </>
                          );
                        })()}
                        <td>{item.ingredient}</td>
                        <td className={styles.linkCol} onClick={e => e.stopPropagation()}>
                          {link ? (
                            <>
                              <a href={link.startsWith('http') ? link : `https://${link}`} target="_blank" rel="noopener noreferrer" className={styles.searchLink}>Link</a>
                              <button className={styles.editLinkBtn} onClick={() => setEditingLink(ingKey)}>&#x270E;</button>
                            </>
                          ) : (
                            <button className={styles.addLinkBtn} onClick={() => setEditingLink(ingKey)}>+</button>
                          )}
                          {isEditingThis && (
                            <div className={styles.linkPopup}>
                              <div className={styles.linkPopupContent}>
                                <span className={styles.linkPopupLabel}>Link for {item.ingredient}</span>
                                <input className={styles.linkPopupInput} type="url" defaultValue={link || ''} autoFocus placeholder="https://..." onKeyDown={e => { if (e.key === 'Enter') saveCustomLink(ingKey, e.target.value.trim()); if (e.key === 'Escape') setEditingLink(null); }} />
                                <div className={styles.linkPopupBtns}>
                                  <button className={styles.linkPopupCancel} onClick={() => setEditingLink(null)}>Cancel</button>
                                  <button className={styles.linkPopupSave} onClick={e => { const input = e.target.closest(`.${styles.linkPopupContent}`).querySelector('input'); saveCustomLink(ingKey, input.value.trim()); }}>Save</button>
                                </div>
                              </div>
                            </div>
                          )}
                        </td>
                        {showMeals && (
                          <td className={styles.mealsCell}>
                            {(item.recipes || []).join(', ')}
                          </td>
                        )}
                        {isAdmin && (
                          <td className={styles.sectionSelectCell}>
                            <select
                              className={styles.sectionSelect}
                              value={section.key}
                              onChange={e => { e.stopPropagation(); handleSectionChange(item.ingredient, e.target.value); }}
                              onClick={e => e.stopPropagation()}
                            >
                              {SECTIONS.map(s => (
                                <option key={s.key} value={s.key}>{s.label}</option>
                              ))}
                            </select>
                          </td>
                        )}
                        {onDismissItem && (
                          <td className={styles.dismissCell}>
                            <button
                              className={styles.dismissBtn}
                              onClick={e => { e.stopPropagation(); onDismissItem(item.ingredient, item.recipes || []); }}
                              title="Remove from list"
                            >
                              &times;
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        );
      })()}
    </div>
  );
}
