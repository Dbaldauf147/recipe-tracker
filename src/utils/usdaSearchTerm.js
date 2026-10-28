// What to search USDA for, given a recipe's ingredient name: cleaned up, and
// swapped for a better USDA term where we know one ("salt" → "salt, table").
// Pure, so the website lookup (nutrition.js) and the server lookup the phone
// app uses (api/nutrition-lookup.js) share it.

// Map common ingredient names to better USDA search terms.
export const ALIASES = {
  'egg': 'egg, whole, raw',
  'eggs': 'egg, whole, raw',
  'butter': 'butter, salted',
  'unsalted butter': 'butter, without salt',
  'flour': 'flour, wheat, all-purpose',
  'all-purpose flour': 'flour, wheat, all-purpose, enriched',
  'all purpose flour': 'flour, wheat, all-purpose, enriched',
  'ap flour': 'flour, wheat, all-purpose, enriched',
  'bread flour': 'flour, wheat, bread',
  'whole wheat flour': 'flour, whole wheat',
  'sugar': 'sugar, granulated',
  'white sugar': 'sugar, granulated',
  'granulated sugar': 'sugar, granulated',
  'brown sugar': 'sugar, brown',
  'powdered sugar': 'sugar, powdered',
  'confectioners sugar': 'sugar, powdered',
  'milk': 'milk, whole, 3.25% milkfat',
  'whole milk': 'milk, whole, 3.25% milkfat',
  'skim milk': 'milk, nonfat, fluid',
  '2% milk': 'milk, reduced fat, 2%',
  'heavy cream': 'cream, heavy whipping',
  'cream cheese': 'cream cheese, regular',
  'sour cream': 'sour cream, regular',
  'cheddar cheese': 'cheese, cheddar',
  'mozzarella': 'cheese, mozzarella, whole milk',
  'parmesan': 'cheese, parmesan, hard',
  'chocolate chips': 'chocolate, chips, semisweet',
  'semi-sweet chocolate chips': 'chocolate, chips, semisweet',
  'cocoa powder': 'cocoa, dry powder, unsweetened',
  'olive oil': 'oil, olive, salad or cooking',
  'vegetable oil': 'oil, vegetable, soybean',
  'canola oil': 'oil, canola',
  'coconut oil': 'oil, coconut',
  'salt': 'salt, table',
  // USDA has one salt; every variety's search otherwise ends on butter or pickles.
  'sea salt': 'salt, table',
  'kosher salt': 'salt, table',
  'himalayan salt': 'salt, table',
  'pink salt': 'salt, table',
  'cinnamon': 'spices, cinnamon, ground',
  'ground cinnamon': 'spices, cinnamon, ground',
  'sweet potato': 'sweet potato, raw, unprepared',
  'sweet potatoes': 'sweet potato, raw, unprepared',
  'pumpkin puree': 'pumpkin, canned, without salt',
  'baking soda': 'leavening agents, baking soda',
  'baking powder': 'leavening agents, baking powder',
  'vanilla extract': 'vanilla extract',
  'vanilla': 'vanilla extract',
  'honey': 'honey',
  'maple syrup': 'syrups, maple',
  'rice': 'rice, white, long-grain, regular, raw',
  'brown rice': 'rice, brown, long-grain, raw',
  'pasta': 'pasta, dry, enriched',
  'spaghetti': 'pasta, spaghetti, dry, enriched',
  'chicken breast': 'chicken, breast, meat only, raw',
  'chicken thigh': 'chicken, thigh, meat only, raw',
  'chicken': 'chicken, breast, meat only, raw',
  'ground beef': 'beef, ground, 80% lean, raw',
  'beef': 'beef, ground, 80% lean, raw',
  'salmon': 'fish, salmon, atlantic, raw',
  'shrimp': 'shrimp, raw',
  'bacon': 'pork, cured, bacon, raw',
  'garlic': 'garlic, raw',
  'onion': 'onion, raw',
  'onions': 'onion, raw',
  'tomato': 'tomatoes, red, ripe, raw',
  'tomatoes': 'tomatoes, red, ripe, raw',
  'potato': 'potatoes, russet, flesh and skin, raw',
  'potatoes': 'potatoes, russet, flesh and skin, raw',
  'carrot': 'carrots, raw',
  'carrots': 'carrots, raw',
  'celery': 'celery, raw',
  'bell pepper': 'peppers, sweet, red, raw',
  'spinach': 'spinach, raw',
  'broccoli': 'broccoli, raw',
  'lemon juice': 'lemon juice, raw',
  'lime juice': 'lime juice, raw',
  'soy sauce': 'soy sauce',
  'worcestershire sauce': 'sauce, worcestershire',
  'mayo': 'mayonnaise',
  'mayonnaise': 'mayonnaise',
  'ketchup': 'catsup',
  'mustard': 'mustard, prepared, yellow',
  'peanut butter': 'peanut butter, smooth',
  'almonds': 'nuts, almonds',
  'walnuts': 'nuts, walnuts, english',
  'pecans': 'nuts, pecans',
  'oats': 'oats, regular and quick, not fortified, dry',
  'rolled oats': 'oats, regular and quick, not fortified, dry',
  'cornstarch': 'cornstarch',
  'cream of tartar': 'cream of tartar',
  'yeast': 'yeast, baker\'s, active dry',
  'banana': 'bananas, raw',
  'bananas': 'bananas, raw',
  'apple': 'apples, raw, with skin',
  'apples': 'apples, raw, with skin',
  'blueberries': 'blueberries, raw',
  'strawberries': 'strawberries, raw',
};

export function getSearchTerm(ingredientName) {
  // Clean: strip parenthetical notes, "or" alternatives, and special chars
  let cleaned = ingredientName.trim()
    .replace(/\([^)]*\)/g, '')           // remove (anything in parens)
    .replace(/\b(may substitute|or)\b.*/i, '') // remove "or ..." / "may substitute ..."
    .replace(/[^\w\s'-]/g, '')           // remove special characters except apostrophe/hyphen
    .replace(/\s{2,}/g, ' ')            // collapse multiple spaces
    .trim();
  if (!cleaned) cleaned = ingredientName.trim().replace(/[^\w\s]/g, '').trim();
  const lower = cleaned.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  const singular = lower.endsWith('s') ? lower.slice(0, -1) : null;
  if (singular && ALIASES[singular]) return ALIASES[singular];
  return cleaned;
}
