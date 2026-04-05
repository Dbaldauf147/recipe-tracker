/**
 * Greenhouse Gas (GHG) Emissions Data
 * Values in kg CO2e per kg of food product
 * Sources: Poore & Nemecek (2018), Our World in Data, EPA
 */

export const GHG_EMISSIONS = {
  // ── Red meat ──
  'beef': 27.0,
  'ground beef': 27.0,
  'beef steak': 27.0,
  'steak': 27.0,
  'beef brisket': 27.0,
  'roast beef': 27.0,
  'beef chuck': 27.0,
  'beef sirloin': 27.0,
  'beef tenderloin': 27.0,
  'lamb': 24.0,
  'lamb chop': 24.0,
  'lamb shoulder': 24.0,
  'veal': 22.0,
  'bison': 18.0,
  'venison': 10.0,
  'goat': 20.0,

  // ── Pork ──
  'pork': 7.6,
  'pork chop': 7.6,
  'pork tenderloin': 7.6,
  'pork shoulder': 7.6,
  'pork belly': 7.6,
  'bacon': 7.6,
  'ham': 7.6,
  'sausage': 7.6,
  'prosciutto': 7.6,
  'pepperoni': 7.6,
  'salami': 7.6,
  'hot dog': 7.6,
  'bratwurst': 7.6,

  // ── Poultry ──
  'chicken': 6.9,
  'chicken breast': 6.9,
  'chicken thigh': 6.9,
  'chicken drumstick': 6.9,
  'chicken wing': 6.9,
  'ground chicken': 6.9,
  'turkey': 5.7,
  'ground turkey': 5.7,
  'turkey breast': 5.7,
  'duck': 6.4,

  // ── Seafood ──
  'salmon': 6.0,
  'salmon fillet': 6.0,
  'smoked salmon': 6.0,
  'tuna': 6.1,
  'canned tuna': 6.1,
  'shrimp': 11.8,
  'prawns': 11.8,
  'cod': 5.4,
  'tilapia': 5.0,
  'crab': 10.0,
  'lobster': 12.0,
  'mussels': 0.6,
  'clams': 1.8,
  'oysters': 0.6,
  'scallops': 5.0,
  'sardines': 3.5,
  'anchovies': 3.5,
  'catfish': 5.0,
  'halibut': 5.4,
  'trout': 5.0,
  'swordfish': 5.4,
  'sea bass': 5.4,
  'fish': 5.4,
  'white fish': 5.4,

  // ── Dairy ──
  'milk': 3.2,
  'whole milk': 3.2,
  'skim milk': 3.2,
  'heavy cream': 5.6,
  'whipping cream': 5.6,
  'cream': 5.6,
  'half and half': 4.3,
  'half-and-half': 4.3,
  'sour cream': 5.0,
  'cheese': 13.5,
  'cheddar': 13.5,
  'cheddar cheese': 13.5,
  'mozzarella': 10.0,
  'mozzarella cheese': 10.0,
  'parmesan': 13.5,
  'parmesan cheese': 13.5,
  'swiss cheese': 13.5,
  'cream cheese': 10.5,
  'goat cheese': 8.5,
  'feta': 8.5,
  'feta cheese': 8.5,
  'ricotta': 6.0,
  'cottage cheese': 4.5,
  'butter': 12.1,
  'ghee': 12.1,
  'yogurt': 3.5,
  'greek yogurt': 3.5,
  'eggs': 4.7,
  'egg': 4.7,
  'egg(s)': 4.7,
  'buttermilk': 3.2,
  'condensed milk': 3.8,
  'evaporated milk': 3.5,
  'ice cream': 5.0,
  'whey': 2.5,

  // ── Plant-based dairy alternatives ──
  'almond milk': 0.7,
  'oat milk': 0.9,
  'soy milk': 1.0,
  'coconut milk': 1.2,

  // ── Grains & cereals ──
  'rice': 4.5,
  'white rice': 4.5,
  'brown rice': 4.5,
  'basmati rice': 4.5,
  'jasmine rice': 4.5,
  'wild rice': 4.5,
  'wheat': 1.6,
  'oats': 1.6,
  'oatmeal': 1.6,
  'rolled oats': 1.6,
  'quinoa': 1.5,
  'pasta': 1.8,
  'spaghetti': 1.8,
  'penne': 1.8,
  'noodles': 1.8,
  'bread': 1.6,
  'white bread': 1.6,
  'whole wheat bread': 1.6,
  'tortilla': 1.6,
  'flour tortilla': 1.6,
  'corn tortilla': 1.2,
  'pita': 1.6,
  'couscous': 1.6,
  'barley': 1.5,
  'cornmeal': 1.2,
  'polenta': 1.2,
  'millet': 1.2,
  'bulgur': 1.5,
  'farro': 1.5,
  'cereal': 1.8,
  'granola': 2.0,
  'breadcrumbs': 1.6,
  'panko': 1.6,
  'croutons': 1.8,

  // ── Legumes ──
  'beans': 2.0,
  'black beans': 2.0,
  'kidney beans': 2.0,
  'pinto beans': 2.0,
  'cannellini beans': 2.0,
  'navy beans': 2.0,
  'white beans': 2.0,
  'lima beans': 2.0,
  'lentils': 0.9,
  'red lentils': 0.9,
  'green lentils': 0.9,
  'chickpeas': 2.0,
  'peanuts': 2.5,
  'peanut butter': 2.5,
  'tofu': 3.0,
  'tempeh': 1.5,
  'edamame': 1.0,
  'hummus': 2.0,
  'soybeans': 2.0,

  // ── Vegetables ──
  'tomato': 2.1,
  'tomatoes': 2.1,
  'tomato paste': 2.5,
  'tomato sauce': 2.1,
  'canned tomatoes': 2.3,
  'diced tomatoes': 2.3,
  'cherry tomatoes': 2.1,
  'sun-dried tomatoes': 3.0,
  'potato': 0.5,
  'potatoes': 0.5,
  'sweet potato': 0.5,
  'sweet potatoes': 0.5,
  'onion': 0.5,
  'onions': 0.5,
  'yellow onion': 0.5,
  'red onion': 0.5,
  'white onion': 0.5,
  'green onion': 0.5,
  'green onions': 0.5,
  'scallion': 0.5,
  'scallions': 0.5,
  'shallot': 0.5,
  'shallots': 0.5,
  'carrot': 0.4,
  'carrots': 0.4,
  'broccoli': 0.9,
  'spinach': 0.9,
  'kale': 0.8,
  'pepper': 1.0,
  'bell pepper': 1.0,
  'bell peppers': 1.0,
  'red pepper': 1.0,
  'green pepper': 1.0,
  'jalapeno': 1.0,
  'habanero': 1.0,
  'serrano': 1.0,
  'chili pepper': 1.0,
  'mushroom': 1.0,
  'mushrooms': 1.0,
  'corn': 1.1,
  'sweet corn': 1.1,
  'peas': 0.9,
  'green peas': 0.9,
  'snap peas': 0.9,
  'lettuce': 0.7,
  'romaine': 0.7,
  'iceberg lettuce': 0.7,
  'arugula': 0.7,
  'cucumber': 0.7,
  'cucumbers': 0.7,
  'celery': 0.5,
  'zucchini': 0.7,
  'squash': 0.7,
  'butternut squash': 0.7,
  'acorn squash': 0.7,
  'spaghetti squash': 0.7,
  'eggplant': 0.8,
  'cauliflower': 0.7,
  'avocado': 2.5,
  'avocados': 2.5,
  'garlic': 0.5,
  'ginger': 0.6,
  'cabbage': 0.5,
  'red cabbage': 0.5,
  'brussels sprouts': 0.8,
  'asparagus': 0.9,
  'artichoke': 0.8,
  'beet': 0.4,
  'beets': 0.4,
  'radish': 0.4,
  'turnip': 0.4,
  'parsnip': 0.4,
  'leek': 0.5,
  'leeks': 0.5,
  'fennel': 0.5,
  'okra': 0.7,
  'bok choy': 0.6,
  'swiss chard': 0.8,
  'collard greens': 0.8,
  'watercress': 0.7,
  'green beans': 0.8,
  'string beans': 0.8,
  'snow peas': 0.9,
  'bean sprouts': 0.5,
  'sprouts': 0.5,
  'seaweed': 0.5,
  'nori': 0.5,
  'olives': 1.8,
  'pickles': 0.8,
  'capers': 0.8,
  'jalapenos': 1.0,

  // ── Fruits ──
  'apple': 0.4,
  'apples': 0.4,
  'banana': 0.9,
  'bananas': 0.9,
  'orange': 0.5,
  'oranges': 0.5,
  'strawberry': 1.3,
  'strawberries': 1.3,
  'blueberry': 1.3,
  'blueberries': 1.3,
  'raspberry': 1.3,
  'raspberries': 1.3,
  'grape': 1.1,
  'grapes': 1.1,
  'mango': 1.0,
  'mangoes': 1.0,
  'pineapple': 1.0,
  'watermelon': 0.4,
  'lemon': 0.3,
  'lemons': 0.3,
  'lime': 0.3,
  'limes': 0.3,
  'peach': 0.7,
  'peaches': 0.7,
  'pear': 0.4,
  'pears': 0.4,
  'plum': 0.5,
  'plums': 0.5,
  'cherry': 1.1,
  'cherries': 1.1,
  'cranberry': 1.1,
  'cranberries': 1.1,
  'pomegranate': 1.2,
  'fig': 0.8,
  'figs': 0.8,
  'date': 0.9,
  'dates': 0.9,
  'raisins': 1.2,
  'dried fruit': 1.5,
  'coconut': 2.3,
  'kiwi': 0.6,
  'papaya': 0.9,
  'passion fruit': 0.7,
  'guava': 0.7,
  'grapefruit': 0.5,
  'melon': 0.5,
  'cantaloupe': 0.5,
  'honeydew': 0.5,
  'apricot': 0.7,
  'nectarine': 0.7,

  // ── Nuts & seeds ──
  'almond': 2.3,
  'almonds': 2.3,
  'walnut': 2.0,
  'walnuts': 2.0,
  'cashew': 3.4,
  'cashews': 3.4,
  'peanut': 2.5,
  'pecan': 2.0,
  'pecans': 2.0,
  'pistachio': 1.6,
  'pistachios': 1.6,
  'hazelnut': 1.8,
  'hazelnuts': 1.8,
  'macadamia': 2.0,
  'sunflower seeds': 1.5,
  'sunflower': 1.5,
  'pumpkin seeds': 1.5,
  'sesame seeds': 1.5,
  'chia seeds': 1.5,
  'chia': 1.5,
  'flax seeds': 1.0,
  'flaxseed': 1.0,
  'flax': 1.0,
  'hemp seeds': 1.2,
  'pine nuts': 2.5,
  'tahini': 2.0,

  // ── Oils & fats ──
  'olive oil': 6.0,
  'coconut oil': 5.0,
  'canola oil': 3.5,
  'vegetable oil': 3.5,
  'avocado oil': 3.5,
  'sesame oil': 3.5,
  'peanut oil': 3.5,
  'sunflower oil': 3.5,
  'corn oil': 3.5,
  'lard': 7.6,
  'shortening': 4.0,
  'margarine': 3.5,
  'cooking spray': 3.5,

  // ── Sweeteners ──
  'sugar': 1.2,
  'white sugar': 1.2,
  'brown sugar': 1.2,
  'powdered sugar': 1.2,
  'cane sugar': 1.2,
  'honey': 1.5,
  'maple syrup': 1.3,
  'agave': 1.3,
  'agave nectar': 1.3,
  'corn syrup': 1.2,
  'molasses': 1.2,
  'stevia': 0.5,

  // ── Beverages & cocoa ──
  'coffee': 8.0,
  'coffee beans': 8.0,
  'ground coffee': 8.0,
  'espresso': 8.0,
  'tea': 1.0,
  'green tea': 1.0,
  'cocoa': 4.5,
  'cocoa powder': 4.5,
  'chocolate': 4.5,
  'dark chocolate': 4.5,
  'chocolate chips': 4.5,
  'white chocolate': 4.0,

  // ── Pantry staples ──
  'flour': 1.6,
  'all-purpose flour': 1.6,
  'all purpose flour': 1.6,
  'bread flour': 1.6,
  'whole wheat flour': 1.6,
  'almond flour': 2.3,
  'coconut flour': 2.3,
  'cornstarch': 1.2,
  'baking powder': 1.0,
  'baking soda': 0.8,
  'yeast': 1.0,
  'salt': 0.3,
  'sea salt': 0.3,
  'kosher salt': 0.3,
  'pepper': 1.0,
  'black pepper': 1.0,
  'vinegar': 1.2,
  'apple cider vinegar': 1.2,
  'balsamic vinegar': 1.5,
  'red wine vinegar': 1.2,
  'white vinegar': 1.0,
  'rice vinegar': 1.2,
  'soy sauce': 1.2,
  'fish sauce': 2.5,
  'worcestershire sauce': 1.5,
  'hot sauce': 1.2,
  'ketchup': 1.5,
  'mustard': 1.0,
  'dijon mustard': 1.0,
  'mayonnaise': 3.0,
  'sriracha': 1.2,
  'teriyaki sauce': 1.5,
  'barbecue sauce': 1.5,
  'salsa': 1.2,
  'pesto': 3.0,
  'tahini': 2.0,
  'broth': 1.5,
  'chicken broth': 2.5,
  'beef broth': 5.0,
  'vegetable broth': 0.8,
  'stock': 1.5,
  'chicken stock': 2.5,
  'beef stock': 5.0,
  'vegetable stock': 0.8,
  'bone broth': 5.0,
  'coconut cream': 2.0,
  'gelatin': 5.0,
  'vanilla extract': 2.0,
  'vanilla': 2.0,
  'extract': 2.0,
  'almond extract': 2.0,
  'food coloring': 0.5,
  'wine': 1.6,
  'red wine': 1.6,
  'white wine': 1.6,
  'cooking wine': 1.6,
  'beer': 1.2,
  'miso': 1.5,
  'miso paste': 1.5,
  'nutritional yeast': 1.5,

  // ── Spices (low footprint per kg, used in small quantities) ──
  'cinnamon': 1.0,
  'cumin': 1.0,
  'turmeric': 1.0,
  'paprika': 1.0,
  'smoked paprika': 1.0,
  'oregano': 1.0,
  'basil': 1.0,
  'fresh basil': 0.8,
  'thyme': 1.0,
  'fresh thyme': 0.8,
  'rosemary': 1.0,
  'fresh rosemary': 0.8,
  'parsley': 0.8,
  'fresh parsley': 0.8,
  'cilantro': 0.8,
  'fresh cilantro': 0.8,
  'dill': 0.8,
  'mint': 0.8,
  'fresh mint': 0.8,
  'bay leaf': 1.0,
  'bay leaves': 1.0,
  'chili flakes': 1.0,
  'red pepper flakes': 1.0,
  'chili powder': 1.0,
  'cayenne': 1.0,
  'cayenne pepper': 1.0,
  'curry powder': 1.0,
  'garam masala': 1.0,
  'garlic powder': 1.0,
  'onion powder': 1.0,
  'nutmeg': 1.0,
  'cloves': 1.0,
  'cardamom': 1.0,
  'coriander': 1.0,
  'fennel seeds': 1.0,
  'mustard seeds': 1.0,
  'saffron': 1.5,
  'allspice': 1.0,
  'star anise': 1.0,
  'lemongrass': 0.8,
  'sage': 1.0,
  'tarragon': 1.0,
  'marjoram': 1.0,
  'poppy seeds': 1.0,
  'caraway seeds': 1.0,
  'italian seasoning': 1.0,
  'herbs de provence': 1.0,
  'taco seasoning': 1.0,
  'everything bagel seasoning': 1.0,
};

/**
 * Get a GHG rating string for a given kg CO2e value
 */
export function getGHGRating(kgCO2e) {
  if (kgCO2e < 1) return 'low';
  if (kgCO2e < 4) return 'medium';
  if (kgCO2e < 10) return 'high';
  return 'very-high';
}

/**
 * Look up GHG emissions for an ingredient name.
 * Tries exact match, then partial/substring match, then word match.
 * Returns { kgCO2e: number, rating: 'low'|'medium'|'high'|'very-high' } or null
 */
export function getGHGEmissions(ingredientName) {
  if (!ingredientName) return null;
  const name = ingredientName.trim().toLowerCase();
  if (!name) return null;

  // 1. Exact match
  if (GHG_EMISSIONS[name] !== undefined) {
    const val = GHG_EMISSIONS[name];
    return { kgCO2e: val, rating: getGHGRating(val) };
  }

  // 2. Check if any key is contained in the name, or name is contained in a key
  //    Prefer longest matching key for specificity
  let bestMatch = null;
  let bestLen = 0;
  for (const key of Object.keys(GHG_EMISSIONS)) {
    if (name.includes(key) && key.length > bestLen) {
      bestMatch = key;
      bestLen = key.length;
    } else if (key.includes(name) && name.length > bestLen) {
      bestMatch = key;
      bestLen = name.length;
    }
  }
  if (bestMatch) {
    const val = GHG_EMISSIONS[bestMatch];
    return { kgCO2e: val, rating: getGHGRating(val) };
  }

  // 3. Word-level match: check if any significant word from the ingredient matches a key
  const words = name.split(/\s+/).filter(w => w.length > 2);
  for (const word of words) {
    if (GHG_EMISSIONS[word] !== undefined) {
      const val = GHG_EMISSIONS[word];
      return { kgCO2e: val, rating: getGHGRating(val) };
    }
  }

  return null;
}

/**
 * Estimate grams for an ingredient row using measurement conversion.
 * Mirrors the logic in nutrition.js MEASUREMENT_TO_GRAMS.
 */
const MEASUREMENT_TO_GRAMS = {
  g: 1, gram: 1, grams: 1,
  kg: 1000,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6,
  cup: 140, cups: 140,
  tbsp: 15, tablespoon: 15, tablespoons: 15,
  tsp: 5, teaspoon: 5, teaspoons: 5,
  ml: 1, liter: 1000, liters: 1000,
  pinch: 0.5, dash: 0.5,
  clove: 3, cloves: 3,
  slice: 30, slices: 30,
  piece: 50, pieces: 50,
  can: 400, stick: 113,
  small: 80, medium: 120, large: 180,
  whole: 100, each: 100,
};

export function estimateGramsForGHG(quantity, measurement) {
  const rawQty = parseFloat(quantity);
  const qty = isNaN(rawQty) ? 1 : rawQty;
  const unit = (measurement || '').trim().toLowerCase();

  if (!unit) return qty * 100; // default ~100g per unit
  const factor = MEASUREMENT_TO_GRAMS[unit];
  if (factor) return qty * factor;
  return qty * 100;
}

/**
 * Compute total GHG emissions for a recipe's ingredient list.
 * Each ingredient: { quantity, measurement, ingredient }
 * Returns total kg CO2e (sum of all matched ingredients).
 */
export function computeRecipeGHG(ingredients) {
  let total = 0;
  let matched = 0;
  for (const row of ingredients) {
    const ghg = getGHGEmissions(row.ingredient);
    if (!ghg) continue;
    const grams = estimateGramsForGHG(row.quantity, row.measurement);
    const kg = grams / 1000;
    total += ghg.kgCO2e * kg;
    matched++;
  }
  return { totalKgCO2e: Math.round(total * 100) / 100, matchedCount: matched, totalCount: ingredients.length };
}
