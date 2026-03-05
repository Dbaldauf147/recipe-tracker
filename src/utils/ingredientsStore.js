import { saveField, loadUserData } from './firestoreSync';

const STORAGE_KEY = 'sunday-ingredients-db';
const ADMIN_UID = import.meta.env.VITE_ADMIN_UID;

const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRg2H-pU53B_n0WCG3f_vz3ye-8IicvsqvTM2xohwVaEitNIZr6PbrgRn8-5qlTn-cSwnt2m3FjXIae/pub?gid=960892864&single=true&output=csv';

// Maps CSV column indices to named object keys.
export const INGREDIENT_FIELDS = [
  { key: 'ingredient',    csvIdx: 7,  label: 'Ingredient' },
  { key: 'grams',         csvIdx: 8,  label: 'Grams' },
  { key: 'measurement',   csvIdx: 9,  label: 'Measurement' },
  { key: 'protein',       csvIdx: 10, label: 'Protein (g)' },
  { key: 'carbs',         csvIdx: 11, label: 'Carbs (g)' },
  { key: 'fat',           csvIdx: 12, label: 'Fat (g)' },
  { key: 'sugar',         csvIdx: 13, label: 'Sugar (g)' },
  { key: 'sodium',        csvIdx: 14, label: 'Salt (mg)' },
  { key: 'potassium',     csvIdx: 15, label: 'Potassium (mg)' },
  { key: 'vitaminB12',    csvIdx: 16, label: 'B12 (µg)' },
  { key: 'vitaminC',      csvIdx: 17, label: 'Vit C (mg)' },
  { key: 'magnesium',     csvIdx: 18, label: 'Magnesium (mg)' },
  { key: 'fiber',         csvIdx: 19, label: 'Fiber (g)' },
  { key: 'zinc',          csvIdx: 20, label: 'Zinc (mg)' },
  { key: 'iron',          csvIdx: 21, label: 'Iron (mg)' },
  { key: 'calcium',       csvIdx: 22, label: 'Calcium (mg)' },
  { key: 'calories',      csvIdx: 23, label: 'Calories' },
  { key: 'addedSugar',    csvIdx: 24, label: 'Added Sugar' },
  { key: 'saturatedFat',  csvIdx: 25, label: 'Sat Fat' },
  { key: 'leucine',       csvIdx: 26, label: 'Leucine (g)' },
  { key: 'notes',         csvIdx: 27, label: 'Notes' },
  { key: 'link',          csvIdx: 31, label: 'Link' },
  { key: 'processed',     csvIdx: 32, label: 'Processed?' },
  { key: 'omega3',        csvIdx: 35, label: 'Omega 3' },
  { key: 'proteinPerCal', csvIdx: 37, label: 'Protein/Cal' },
  { key: 'fiberPerCal',   csvIdx: 38, label: 'Fiber/Cal' },
  { key: 'lastBought',    csvIdx: 39, label: 'Last Bought' },
  { key: 'storage',       csvIdx: 40, label: 'Storage' },
  { key: 'minShelf',      csvIdx: 41, label: 'Min Shelf (days)' },
  { key: 'maxShelf',      csvIdx: 42, label: 'Max Shelf (days)' },
  { key: 'grocerySection', csvIdx: 43, label: 'Grocery Section' },
];

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

export function loadIngredients() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function saveIngredients(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export async function fetchAndSeedIngredients() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error('Failed to fetch ingredients sheet');
  const text = await res.text();
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));

  const data = [];
  for (let i = 3; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const ingredient = (cols[7] || '').trim();
    if (!ingredient) continue;
    const obj = {};
    for (const field of INGREDIENT_FIELDS) {
      obj[field.key] = (cols[field.csvIdx] || '').trim();
    }
    data.push(obj);
  }

  saveIngredients(data);
  return data;
}

// Grams per 1 serving (keyed by lowercase ingredient name)
const GRAMS_LOOKUP = {
  'garlic': 3, 'unsweetened almond milk': 240, 'soy sauce (shoyu)': 16, 'scallion(s)': 15,
  'cumin': 2, 'chilli powder': 8, 'ground black pepper': 2, 'nutritional yeast (fortified)': 60,
  'celery': 40, 'feta_crumbled': 150, 'pumpkin seeds': 129, 'spinach': 30,
  'parmesean cheese_grated': 5, 'egg(s)_raw': 50, 'whole wheat tortillas_52g': 52,
  'broccoli (frozen)': 156, 'broccoli (head)': 91, 'cayenne powder': 8, 'flaxseed meal': 7,
  'cheddar cheese_block': 113, 'lemon juice': 31, 'black beans': 172, 'cinnamon': 8,
  'chia seeds': 12, 'shiitake mushrooms': 145, 'tumeric': 7, 'red pepper flakes': 5,
  'cherries_frozen': 155, 'almonds': 143, 'almonds, sliced': 92,
  'yellow onion(s)': 150, 'red onion(s)': 150, 'sesame seeds': 9, 'sesame seeds_black': 9,
  'oregano_dried': 5, 'garlic powder': 10, 'almond butter': 16, 'brown rice': 185,
  'brown rice_frozen': 163, 'quaker oats, old fashioned': 80, 'vidalia onion(s)': 150,
  'bakery bread': 32, 'green lentil rotini_tolerant pasta': 57, 'kale': 21, 'kale_frozen': 130,
  'banana(s)': 118, 'banana(s)_frozen': 118, 'bell pepper(s)': 150, 'mango(s)_frozen': 155,
  'avocado(s)': 200, 'avocado(s)_frozen': 200, 'carrots_baby': 10, 'shredded carrots': 10,
  'sweet potato(s)': 130, 'quinoa_uncooked': 170, 'quinoa_cooked': 185,
  'goat cheese_crumbled': 115, 'blueberries': 148, 'blueberries_frozen': 155,
  'cashews, crushed': 130, 'cucumber(s)': 301, 'mayonnaise_hellmans light': 15,
  'apple(s)_honey crisp': 200, 'apples(s)_green': 182, 'red cabage': 89,
  'alfalfa sprouts': 33, 'apple cider vinegar': 15, 'arugula': 20, 'asparagus': 16,
  'baking powder': 5, 'balsamic vinagrette': 16, 'balsamic vinegar': 16, 'basil': 3,
  'basil seeds': 13, 'black beans, spicy': 172, 'blackberry(s)': 144,
  'boars head ham_thinly sliced': 454, 'bone broth': 240, 'brazil nuts': 133,
  'brown mustard': 5, 'brown sugar': 4, 'brussel sprouts': 21, 'butter_unsalted': 14,
  'cacao': 5, 'cardamom': 6, 'cheddar cheese_shredded': 113, 'chicken breast': 174,
  'cholula hot sauce': 15, 'cilantro': 2, 'coconut flour': 7, 'coconut milk': 369,
  'coconut oil': 14, 'coffee_organic': 237, 'collard greens': 36, 'coriander': 5,
  'corn': 154, 'corn starch': 128, 'cream cheese': 28, 'crispy chili oil': 5,
  'cucumber(s)_persian': 119, 'curry powder': 2, "dan's salad dressing": 15,
  'dark chocolate_ghirardelli chips': 3, 'date(s)': 24,
  'diced tomatoes_canned basil, garlic, and oregano': 241, 'dijon mustard': 5,
  'edamame': 155, 'edamame_dried': 160, 'egg whites': 243, 'eggplant': 458,
  'everything but the bagel seasoning': 4, 'franks redhot': 15, 'garam masala': 6,
  'ginger root': 96, 'graham cracker crumbs': 7, 'green beans': 125,
  'green onion(s)': 15, 'green peas': 145, 'ground nutmeg': 2, 'harrisa powder': 6,
  'heavy cream': 238, 'heinz ketchup': 17, 'heinz mustard': 5, 'hemp seeds': 10,
  'himalayan salt': 6, 'honey': 21, 'honey dijon mustard': 15, 'honey mustard': 15,
  'hummus_garlic': 15, 'italian seasoning': 5, 'jalapeno': 14,
  "ken's sweet vidalia onion dressing": 16, 'kimchi': 150, 'korma sauce': 240,
  'lemon(s)': 58, 'lentils_green_dried': 192, 'lentils_green_cooked': 198,
  'lettuce_iceberg': 72, 'lettuce_romaine': 6, 'lettuce_spring mix': 30,
  'lime juice': 31, 'lime(s)': 67, 'lipton onion soup mix': 7, 'maple syrup': 20,
  'matcha powder': 2, 'mayple syrup': 20, 'milk': 244, 'mint': 2,
  'mozarella_shredded': 113, 'navy beans': 182, 'dark chocolate chips': 15,
  'old bay seasoning': 6, 'olive oil': 14, 'onion powder': 2, 'panko bread crumbs': 60,
  'paprika': 7, 'parsley flakes': 1, 'peanut butter': 16, 'peanuts': 146,
  'pear': 178, 'pecans': 109, 'pecorino cheese': 28, 'pesto verde': 260,
  'pine nuts': 135, 'pistachios': 123, 'powdered sugar': 120, 'radishes': 5,
  'raisins': 145, "rao's tomato basil pasta sauce": 244, 'rasberries': 123,
  'rasberries_frozen': 140, 'red wine vinegar': 15, 'ricotta cheese': 246,
  'sesame oil': 14, 'shallot': 60, 'sriracha': 17, 'sriracha mayo': 15,
  'strawberries': 152, 'string beans': 110, 'sundried tomatos': 54,
  'sunflower seeds': 140, 'sweet baby rays': 21, 'sweet baby rays bbq sauce': 21,
  'sweetened coconut, shredded': 93, 'sweetened condensed milk': 19,
  'swiss cheese_shredded': 108, 'tahini sauce': 15, 'tajin seasoning': 5,
  'teriaki sauce': 18, 'thyme_dried': 5, 'tomato paste': 16,
  'tostitos salsa_chunky spicy': 16, 'unsweetned coconut, shredded': 5,
  'vanilla extract': 4, 'vegetable oil': 14, 'vegetable stock': 240,
  'walnuts': 117, 'water': 237, 'watermelon': 152, 'watermelon seeds': 146,
  'whiskey': 28, 'white onion(s)': 150, 'white vinegar_distilled': 15,
  'whole grain dijon mustard': 15, 'whole wheat toast': 33, 'yogurt_plain': 245,
  'zucchini': 196, 'maca powder': 7, 'oat flour': 104, 'spirulina': 3,
  'ice': 237, 'peanut butter_pb2': 6, 'rice paper(s)': 10, 'hosin sauce': 16,
  'coleslaw mix': 90, 'jalapeno_pickled': 136, 'rice vinegar': 239,
  'chicken apple sausage': 85, 'pepper jack cheese_sliced': 21,
  'cheddar cheese_slice': 21, 'mozzarella cheese sticks': 28,
  'whole wheat tortillas_10 inch': 70, 'beets_pickled': 170, 'beyond meat': 113,
  'beyond meat patties': 113, 'beyond sausages_hot italian': 76, 'red potatoes': 170,
  'rice cake(s)_white cheddar': 9, 'tofu_firm': 252, 'cauliflower rice': 840,
  'beefsteak tomato(s)': 182, 'tomato_cherry': 17, 'tomato_roma': 62,
  'brioche bun': 65, 'kaiser rolls': 57, 'pickle(s)': 65, 'pickle(s)_sliced': 65,
  'pineapple': 905, 'spaghetti squash': 1800, 'protien powder_naked': 30,
  'whey protien_chocolate': 35, 'whey protien_peanut butter': 35,
  'whey protien_vanilla': 35, 'david bars': 50, 'frito lays_chilli seasoned': 2,
  'm&ms_milk chocolate': 28,
};

/**
 * Apply researched grams data to ingredients that have empty grams.
 * Only fills in missing values — never overwrites existing ones.
 * Returns the updated array (or original if nothing changed).
 */
export function applyGramsData(rows) {
  let changed = false;
  const updated = rows.map(row => {
    if (row.grams && String(row.grams).trim() !== '') return row;
    const key = (row.ingredient || '').trim().toLowerCase();
    if (key && GRAMS_LOOKUP[key] !== undefined) {
      changed = true;
      return { ...row, grams: String(GRAMS_LOOKUP[key]) };
    }
    return row;
  });
  return changed ? updated : rows;
}

/**
 * Load the ingredients database from the admin's Firestore user doc.
 * Caches to localStorage so other pages (RecipeDetail, ShoppingList) can read it.
 * Returns the data array, or null if Firestore has no ingredientsDb yet.
 */
export async function loadIngredientsFromFirestore() {
  if (!ADMIN_UID) return null;
  try {
    const userData = await loadUserData(ADMIN_UID);
    if (userData?.ingredientsDb) {
      saveIngredients(userData.ingredientsDb);
      return userData.ingredientsDb;
    }
  } catch (err) {
    console.error('loadIngredientsFromFirestore:', err);
  }
  return null;
}

/**
 * Save the ingredients database to localStorage immediately,
 * then persist to the admin's Firestore user doc.
 */
export async function saveIngredientsToFirestore(data) {
  saveIngredients(data);
  if (!ADMIN_UID) return;
  try {
    await saveField(ADMIN_UID, 'ingredientsDb', data);
  } catch (err) {
    console.error('saveIngredientsToFirestore:', err);
  }
}
