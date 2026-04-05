// ---------------------------------------------------------------------------
// detectCuisine.js  --  cuisine detection + ingredient shelf-life utility
// ---------------------------------------------------------------------------

// ---- Cuisine keyword rules ------------------------------------------------
// Each rule: { cuisine, titleKeywords[], ingredientKeywords[] }
// Title matches score 3 pts, ingredient matches score 1 pt.

const CUISINE_RULES = [
  {
    cuisine: 'Italian',
    titleKeywords: [
      'italian', 'pasta', 'pizza', 'risotto', 'lasagna', 'lasagne',
      'parmigiana', 'bruschetta', 'gnocchi', 'carbonara', 'bolognese',
      'marinara', 'alfredo', 'pesto', 'ravioli', 'tiramisu', 'focaccia',
      'prosciutto', 'caprese', 'osso buco', 'minestrone', 'antipasto',
    ],
    ingredientKeywords: [
      'parmesan', 'parmigiano', 'mozzarella', 'ricotta', 'mascarpone',
      'pancetta', 'prosciutto', 'basil', 'oregano', 'marinara',
      'pesto', 'balsamic', 'sun-dried tomato', 'sundried tomato',
      'italian sausage', 'pecorino', 'arborio', 'polenta', 'capers',
      'focaccia', 'ciabatta',
    ],
  },
  {
    cuisine: 'Mexican',
    titleKeywords: [
      'mexican', 'taco', 'tacos', 'burrito', 'enchilada', 'quesadilla',
      'fajita', 'tamale', 'tamales', 'tostada', 'pozole', 'elote',
      'churro', 'chilaquiles', 'carnitas', 'barbacoa', 'al pastor',
      'mole', 'guacamole', 'salsa verde', 'nachos', 'huevos rancheros',
    ],
    ingredientKeywords: [
      'tortilla', 'cumin', 'jalape', 'chipotle', 'cilantro', 'lime',
      'avocado', 'black beans', 'refried beans', 'queso', 'cotija',
      'chorizo', 'salsa', 'taco seasoning', 'chili powder', 'ancho',
      'guajillo', 'pasilla', 'poblano', 'serrano', 'habanero',
      'corn tortilla', 'flour tortilla', 'pinto beans', 'adobo',
    ],
  },
  {
    cuisine: 'Chinese',
    titleKeywords: [
      'chinese', 'stir fry', 'stir-fry', 'lo mein', 'chow mein',
      'kung pao', 'general tso', 'fried rice', 'dim sum', 'dumpling',
      'wonton', 'egg roll', 'spring roll', 'mapo tofu', 'char siu',
      'peking duck', 'hot pot', 'hotpot', 'szechuan', 'sichuan',
      'cantonese', 'hunan', 'dan dan', 'congee', 'bao',
    ],
    ingredientKeywords: [
      'soy sauce', 'sesame oil', 'hoisin', 'oyster sauce',
      'rice vinegar', 'five spice', 'star anise', 'szechuan pepper',
      'sichuan pepper', 'doubanjiang', 'shaoxing', 'bok choy',
      'water chestnut', 'bamboo shoot', 'wonton wrapper', 'tofu',
      'ginger', 'scallion', 'green onion', 'bean sprouts', 'napa cabbage',
      'chili oil', 'black bean sauce', 'fermented black bean',
    ],
  },
  {
    cuisine: 'Japanese',
    titleKeywords: [
      'japanese', 'sushi', 'ramen', 'teriyaki', 'tempura', 'udon',
      'soba', 'yakitori', 'katsu', 'tonkatsu', 'gyoza', 'onigiri',
      'miso', 'sashimi', 'donburi', 'okonomiyaki', 'takoyaki',
      'edamame', 'matcha', 'poke', 'chirashi',
    ],
    ingredientKeywords: [
      'miso', 'dashi', 'nori', 'wasabi', 'mirin', 'sake',
      'panko', 'tofu', 'seaweed', 'rice vinegar', 'pickled ginger',
      'soy sauce', 'sesame', 'shiitake', 'enoki', 'bonito',
      'kombu', 'furikake', 'yuzu', 'shiso', 'matcha',
    ],
  },
  {
    cuisine: 'Indian',
    titleKeywords: [
      'indian', 'curry', 'tikka', 'masala', 'tandoori', 'biryani',
      'dal', 'daal', 'dhal', 'naan', 'samosa', 'pakora', 'paneer',
      'vindaloo', 'korma', 'rogan josh', 'chana', 'palak',
      'butter chicken', 'saag', 'aloo', 'raita', 'chutney',
    ],
    ingredientKeywords: [
      'turmeric', 'cumin', 'coriander', 'garam masala', 'cardamom',
      'curry powder', 'curry paste', 'ghee', 'paneer', 'naan',
      'basmati', 'lentil', 'chickpea', 'chana', 'tamarind',
      'fenugreek', 'mustard seed', 'asafoetida', 'curry leaves',
      'coconut milk', 'yogurt', 'chili powder', 'saffron',
    ],
  },
  {
    cuisine: 'Thai',
    titleKeywords: [
      'thai', 'pad thai', 'pad see ew', 'tom yum', 'tom kha',
      'green curry', 'red curry', 'yellow curry', 'massaman',
      'panang', 'larb', 'som tum', 'satay', 'pad krapow',
      'khao soi', 'basil chicken', 'mango sticky rice',
    ],
    ingredientKeywords: [
      'fish sauce', 'coconut milk', 'lemongrass', 'galangal',
      'thai basil', 'kaffir lime', 'makrut lime', 'palm sugar',
      'thai chili', 'bird eye chili', 'curry paste', 'green curry paste',
      'red curry paste', 'tamarind', 'peanut sauce', 'rice noodle',
      'bean sprouts', 'cilantro', 'lime', 'shrimp paste',
    ],
  },
  {
    cuisine: 'Mediterranean',
    titleKeywords: [
      'mediterranean', 'greek', 'hummus', 'falafel', 'shawarma',
      'kebab', 'tabbouleh', 'fattoush', 'moussaka', 'gyro',
      'spanakopita', 'souvlaki', 'tzatziki', 'baklava', 'pita',
    ],
    ingredientKeywords: [
      'olive oil', 'feta', 'hummus', 'tahini', 'chickpea',
      'pita', 'za\'atar', 'sumac', 'pomegranate', 'lemon',
      'cucumber', 'kalamata', 'oregano', 'dill', 'mint',
      'bulgur', 'couscous', 'eggplant', 'lamb', 'yogurt',
      'harissa', 'preserved lemon',
    ],
  },
  {
    cuisine: 'Korean',
    titleKeywords: [
      'korean', 'kimchi', 'bibimbap', 'bulgogi', 'bulgogi',
      'japchae', 'tteokbokki', 'galbi', 'kalbi', 'banchan',
      'sundubu', 'jjigae', 'kimbap', 'bossam', 'samgyeopsal',
      'korean bbq', 'dakgalbi',
    ],
    ingredientKeywords: [
      'gochujang', 'gochugaru', 'kimchi', 'doenjang', 'sesame oil',
      'soy sauce', 'rice vinegar', 'korean chili', 'red pepper flake',
      'tofu', 'scallion', 'green onion', 'perilla', 'korean pear',
      'sweet potato noodle', 'dried seaweed', 'sesame seed',
    ],
  },
  {
    cuisine: 'French',
    titleKeywords: [
      'french', 'coq au vin', 'ratatouille', 'bouillabaisse',
      'souffle', 'souffl\u00e9', 'crepe', 'cr\u00eape', 'quiche', 'croissant',
      'baguette', 'brioche', 'confit', 'gratin', 'dauphinoise',
      'bourguignon', 'cassoulet', 'bisque', 'bechamel', 'b\u00e9chamel',
      'hollandaise', 'nicoise', 'proven\u00e7al', 'provencal', 'creme brulee',
    ],
    ingredientKeywords: [
      'butter', 'cream', 'shallot', 'tarragon', 'thyme',
      'herbes de provence', 'dijon', 'gruyere', 'brie', 'camembert',
      'cr\u00e8me fra\u00eeche', 'creme fraiche', 'wine', 'cognac', 'brandy',
      'duck fat', 'duck confit', 'escargot', 'truffle', 'chervil',
    ],
  },
  {
    cuisine: 'Southern/BBQ',
    titleKeywords: [
      'bbq', 'barbeque', 'barbecue', 'southern', 'cajun', 'creole',
      'smoked', 'pulled pork', 'brisket', 'cornbread', 'gumbo',
      'jambalaya', 'po boy', 'po\' boy', 'hush puppy', 'hushpuppy',
      'collard', 'fried chicken', 'grits', 'biscuits and gravy',
      'shrimp and grits', 'low country', 'lowcountry', 'soul food',
    ],
    ingredientKeywords: [
      'bbq sauce', 'barbecue sauce', 'smoked paprika', 'liquid smoke',
      'cornmeal', 'buttermilk', 'collard greens', 'okra', 'grits',
      'andouille', 'cayenne', 'hot sauce', 'black eyed pea',
      'sweet potato', 'pecan', 'bourbon', 'brown sugar', 'molasses',
      'pork butt', 'pork shoulder', 'baby back rib', 'spare rib',
    ],
  },
  {
    cuisine: 'American',
    titleKeywords: [
      'american', 'burger', 'hamburger', 'cheeseburger', 'hot dog',
      'mac and cheese', 'macaroni', 'meatloaf', 'pot roast',
      'sloppy joe', 'buffalo wing', 'chicken wing', 'pancake',
      'waffle', 'club sandwich', 'blt', 'philly cheesesteak',
      'cobb salad', 'clam chowder', 'apple pie', 'brownie',
    ],
    ingredientKeywords: [
      'cheddar', 'american cheese', 'ketchup', 'mustard', 'mayo',
      'mayonnaise', 'ranch', 'ground beef', 'hamburger bun',
      'hot dog bun', 'bacon', 'cream cheese', 'velveeta',
      'tater tot', 'french fries', 'potato chip', 'pickle',
      'relish', 'worcestershire', 'steak sauce',
    ],
  },
];

// ---- Public cuisine list ---------------------------------------------------

export const ALL_CUISINES = [
  'Italian',
  'Mexican',
  'Chinese',
  'Japanese',
  'Indian',
  'Thai',
  'Mediterranean',
  'Korean',
  'French',
  'Southern/BBQ',
  'American',
  'Other',
];

// ---- detectCuisine ---------------------------------------------------------

/**
 * Detect the most likely cuisine for a recipe.
 * @param {string} title        - recipe title
 * @param {Array<{ingredient:string}>} ingredients - ingredient objects
 * @returns {string} cuisine name (one of ALL_CUISINES)
 */
export function detectCuisine(title, ingredients) {
  const lowerTitle = (title || '').toLowerCase();

  const ingredientTexts = (ingredients || []).map((i) =>
    (typeof i === 'string' ? i : i?.ingredient || '').toLowerCase()
  );

  const scores = {};

  for (const rule of CUISINE_RULES) {
    let score = 0;

    // Title keyword matches (3 pts each)
    for (const kw of rule.titleKeywords) {
      if (lowerTitle.includes(kw)) {
        score += 3;
      }
    }

    // Ingredient keyword matches (1 pt each)
    for (const kw of rule.ingredientKeywords) {
      for (const ingText of ingredientTexts) {
        if (ingText.includes(kw)) {
          score += 1;
          break; // count each keyword once
        }
      }
    }

    if (score > 0) {
      scores[rule.cuisine] = score;
    }
  }

  // Find highest-scoring cuisine
  let best = null;
  let bestScore = 0;
  for (const [cuisine, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = cuisine;
      bestScore = score;
    }
  }

  return bestScore >= 2 ? best : 'Other';
}

// ---- Shelf-life database ---------------------------------------------------
// Values are in days.  null = not applicable / not recommended.

const SHELF_LIFE_DB = {
  // -- Dairy --
  milk:              { fridge: 7,   freezer: 90,  pantry: null, tip: 'Sniff test is reliable. Freeze in ice cube trays for cooking.' },
  'whole milk':      { fridge: 7,   freezer: 90,  pantry: null, tip: 'Keeps slightly longer than skim due to fat content.' },
  'skim milk':       { fridge: 7,   freezer: 90,  pantry: null, tip: 'Freeze in measured portions for smoothies.' },
  'oat milk':        { fridge: 10,  freezer: 90,  pantry: null, tip: 'Shake well; separation is normal after freezing.' },
  'almond milk':     { fridge: 10,  freezer: 90,  pantry: null, tip: 'Opened cartons go bad faster than dairy milk.' },
  cream:             { fridge: 10,  freezer: 90,  pantry: null, tip: 'Heavy cream freezes well for cooking but won\'t whip after thawing.' },
  'heavy cream':     { fridge: 10,  freezer: 90,  pantry: null, tip: 'Freeze in ice cube trays for sauces.' },
  'sour cream':      { fridge: 21,  freezer: 180, pantry: null, tip: 'Texture changes when frozen; best for cooking after thawing.' },
  'cream cheese':    { fridge: 14,  freezer: 60,  pantry: null, tip: 'Wrap tightly; texture softens after freezing.' },
  butter:            { fridge: 30,  freezer: 270, pantry: null, tip: 'Salted butter lasts longer than unsalted.' },
  'unsalted butter': { fridge: 21,  freezer: 270, pantry: null, tip: 'Freeze in sticks for easy portioning.' },
  yogurt:            { fridge: 14,  freezer: 60,  pantry: null, tip: 'Stir if liquid separates on top; that\'s just whey.' },
  'greek yogurt':    { fridge: 14,  freezer: 60,  pantry: null, tip: 'Higher protein; freezes slightly better than regular.' },
  cheese:            { fridge: 28,  freezer: 180, pantry: null, tip: 'Wrap in parchment then plastic; hard cheeses last longer.' },
  cheddar:           { fridge: 28,  freezer: 180, pantry: null, tip: 'Hard cheeses keep longer. Mold on surface can be cut away.' },
  mozzarella:        { fridge: 7,   freezer: 180, pantry: null, tip: 'Fresh mozzarella lasts only a few days; shredded lasts longer.' },
  parmesan:          { fridge: 180, freezer: 365, pantry: null, tip: 'Grate and freeze for long storage. Rind adds flavour to soups.' },
  feta:              { fridge: 14,  freezer: 90,  pantry: null, tip: 'Store in brine to extend fridge life.' },
  ricotta:           { fridge: 7,   freezer: 90,  pantry: null, tip: 'Drain excess liquid before freezing.' },
  eggs:              { fridge: 35,  freezer: 365, pantry: null, tip: 'Float test: if it floats, toss it. Freeze beaten eggs in trays.' },
  egg:               { fridge: 35,  freezer: 365, pantry: null, tip: 'Store pointed-end down to keep yolks centred.' },

  // -- Meat & Poultry --
  'chicken breast':  { fridge: 2,  freezer: 270, pantry: null, tip: 'Pat dry before storing; moisture breeds bacteria.' },
  'chicken thigh':   { fridge: 2,  freezer: 270, pantry: null, tip: 'Bone-in lasts slightly longer in the freezer.' },
  chicken:           { fridge: 2,  freezer: 270, pantry: null, tip: 'Always store on the lowest fridge shelf to prevent drips.' },
  'ground chicken':  { fridge: 2,  freezer: 120, pantry: null, tip: 'Flatten in bags before freezing for quick thawing.' },
  turkey:            { fridge: 2,  freezer: 270, pantry: null, tip: 'Thaw in fridge: allow 24 hrs per 5 lbs.' },
  'ground turkey':   { fridge: 2,  freezer: 120, pantry: null, tip: 'Freeze in pre-portioned patties.' },
  'ground beef':     { fridge: 2,  freezer: 120, pantry: null, tip: 'Flatten in zip-lock bags for faster thawing.' },
  beef:              { fridge: 4,  freezer: 365, pantry: null, tip: 'Steaks and roasts keep longer than ground.' },
  steak:             { fridge: 4,  freezer: 365, pantry: null, tip: 'Vacuum seal for best freezer results.' },
  'pork chop':       { fridge: 4,  freezer: 180, pantry: null, tip: 'Brine before cooking for juicier results.' },
  pork:              { fridge: 4,  freezer: 180, pantry: null, tip: 'Wrap individually before freezing.' },
  'ground pork':     { fridge: 2,  freezer: 120, pantry: null, tip: 'Mix with seasonings before freezing for quick meal prep.' },
  'pork shoulder':   { fridge: 4,  freezer: 180, pantry: null, tip: 'Great for slow cooking from frozen.' },
  bacon:             { fridge: 7,  freezer: 180, pantry: null, tip: 'Separate slices with parchment paper before freezing.' },
  sausage:           { fridge: 2,  freezer: 60,  pantry: null, tip: 'Cooked sausage lasts 3-4 days in fridge.' },
  'italian sausage': { fridge: 2,  freezer: 60,  pantry: null, tip: 'Remove casings and freeze in crumbles for pasta sauces.' },
  ham:               { fridge: 5,  freezer: 60,  pantry: null, tip: 'Sliced deli ham spoils faster than whole cuts.' },
  lamb:              { fridge: 4,  freezer: 270, pantry: null, tip: 'Trim excess fat before freezing to reduce off-flavours.' },

  // -- Seafood --
  salmon:            { fridge: 2,  freezer: 90,  pantry: null, tip: 'Fresh salmon should smell like the ocean, not fishy.' },
  shrimp:            { fridge: 2,  freezer: 180, pantry: null, tip: 'Freeze in a single layer first, then bag together.' },
  tuna:              { fridge: 2,  freezer: 90,  pantry: null, tip: 'Sushi-grade should be used same day.' },
  'canned tuna':     { fridge: 4,  freezer: null, pantry: 1825, tip: 'Transfer to a non-metal container after opening.' },
  cod:               { fridge: 2,  freezer: 180, pantry: null, tip: 'Mild flavour makes it great for fish tacos.' },
  tilapia:           { fridge: 2,  freezer: 180, pantry: null, tip: 'Thaw in fridge overnight for best texture.' },
  scallops:          { fridge: 2,  freezer: 90,  pantry: null, tip: 'Pat very dry before searing for a golden crust.' },
  crab:              { fridge: 2,  freezer: 180, pantry: null, tip: 'Cooked crab meat lasts up to 5 days.' },

  // -- Produce (Vegetables) --
  onion:             { fridge: 60,  freezer: 240, pantry: 30,  tip: 'Store in a cool dark place; keep away from potatoes.' },
  garlic:            { fridge: null, freezer: 365, pantry: 180, tip: 'Whole heads last months; peeled cloves use within 7 days.' },
  potato:            { fridge: null, freezer: 365, pantry: 21,  tip: 'Don\'t refrigerate raw potatoes; cold converts starch to sugar.' },
  'sweet potato':    { fridge: null, freezer: 365, pantry: 21,  tip: 'Store in a cool dark place, not the fridge.' },
  tomato:            { fridge: 7,   freezer: 180, pantry: 5,   tip: 'Never refrigerate unripe tomatoes; it kills flavour.' },
  carrot:            { fridge: 28,  freezer: 365, pantry: null, tip: 'Store in water in the fridge to keep crisp.' },
  celery:            { fridge: 14,  freezer: 365, pantry: null, tip: 'Wrap in foil to keep crisp for weeks.' },
  broccoli:          { fridge: 7,   freezer: 365, pantry: null, tip: 'Blanch before freezing to preserve colour and texture.' },
  cauliflower:       { fridge: 7,   freezer: 365, pantry: null, tip: 'Wrap in a damp paper towel for longer fridge life.' },
  spinach:           { fridge: 5,   freezer: 365, pantry: null, tip: 'Freeze fresh spinach for smoothies; no need to blanch.' },
  kale:              { fridge: 7,   freezer: 365, pantry: null, tip: 'Remove stems before freezing; massage leaves for salads.' },
  lettuce:           { fridge: 7,   freezer: null, pantry: null, tip: 'Wrap in paper towels to absorb excess moisture.' },
  cucumber:          { fridge: 7,   freezer: null, pantry: null, tip: 'Keep at room temp if eating within 3 days; fridge otherwise.' },
  'bell pepper':     { fridge: 10,  freezer: 365, pantry: null, tip: 'Dice and freeze on a sheet pan for easy use.' },
  pepper:            { fridge: 10,  freezer: 365, pantry: null, tip: 'Green peppers last longer than red or yellow.' },
  zucchini:          { fridge: 7,   freezer: 90,  pantry: null, tip: 'Grate and freeze for baking; squeeze out moisture first.' },
  squash:            { fridge: 7,   freezer: 90,  pantry: null, tip: 'Winter squash stores for months at room temperature.' },
  mushroom:          { fridge: 7,   freezer: 365, pantry: null, tip: 'Store in a paper bag, not plastic, to avoid sliminess.' },
  corn:              { fridge: 3,   freezer: 365, pantry: null, tip: 'Blanch ears before freezing; cut kernels off for easy use.' },
  'green beans':     { fridge: 7,   freezer: 365, pantry: null, tip: 'Blanch in boiling water 3 mins then ice bath before freezing.' },
  asparagus:         { fridge: 5,   freezer: 365, pantry: null, tip: 'Store upright in a glass of water like a bouquet.' },
  cabbage:           { fridge: 14,  freezer: 365, pantry: null, tip: 'Whole heads last much longer than shredded.' },
  'green onion':     { fridge: 7,   freezer: 365, pantry: null, tip: 'Freeze sliced in a bottle; shake out what you need.' },
  scallion:          { fridge: 7,   freezer: 365, pantry: null, tip: 'Regrow from roots in a glass of water.' },
  avocado:           { fridge: 5,   freezer: 180, pantry: 4,   tip: 'Add lemon juice to cut surfaces to slow browning.' },
  'bok choy':        { fridge: 5,   freezer: 365, pantry: null, tip: 'Wrap loosely in a damp towel.' },
  eggplant:          { fridge: 5,   freezer: 180, pantry: null, tip: 'Salt slices to draw out bitterness before cooking.' },
  peas:              { fridge: 5,   freezer: 365, pantry: null, tip: 'Frozen peas are picked at peak ripeness and very nutritious.' },
  artichoke:         { fridge: 7,   freezer: 180, pantry: null, tip: 'Sprinkle cut sides with lemon to prevent browning.' },

  // -- Fruits --
  apple:             { fridge: 28,  freezer: 240, pantry: 7,   tip: 'One bad apple spoils the bunch -- remove bruised ones.' },
  banana:            { fridge: 7,   freezer: 180, pantry: 5,   tip: 'Peel before freezing; perfect for smoothies and baking.' },
  lemon:             { fridge: 21,  freezer: 120, pantry: 7,   tip: 'Zest before juicing to get the most out of each lemon.' },
  lime:              { fridge: 21,  freezer: 120, pantry: 7,   tip: 'Roll on counter before juicing to get more juice.' },
  orange:            { fridge: 21,  freezer: 120, pantry: 7,   tip: 'Zest can be frozen separately for later use.' },
  strawberry:        { fridge: 5,   freezer: 365, pantry: null, tip: 'Don\'t wash until ready to eat; moisture causes mould.' },
  blueberry:         { fridge: 10,  freezer: 365, pantry: null, tip: 'Freeze in a single layer then transfer to bags.' },
  raspberry:         { fridge: 3,   freezer: 365, pantry: null, tip: 'Extremely fragile; check for mould daily.' },
  grape:             { fridge: 14,  freezer: 365, pantry: null, tip: 'Frozen grapes make a great snack.' },
  mango:             { fridge: 7,   freezer: 365, pantry: 5,   tip: 'Dice and freeze for smoothies.' },
  pineapple:         { fridge: 5,   freezer: 365, pantry: 3,   tip: 'Cut pineapple should be stored in its own juice.' },
  peach:             { fridge: 5,   freezer: 365, pantry: 3,   tip: 'Ripen on counter then move to fridge.' },
  watermelon:        { fridge: 5,   freezer: 365, pantry: 7,   tip: 'Cut melon deteriorates fast; eat within a few days.' },
  cherry:            { fridge: 7,   freezer: 365, pantry: null, tip: 'Pit before freezing for easy use in recipes.' },

  // -- Pantry Staples --
  rice:              { fridge: 5,   freezer: 180, pantry: 730, tip: 'Cooked rice: fridge 5 days. Dry white rice lasts years.' },
  'brown rice':      { fridge: 5,   freezer: 180, pantry: 180, tip: 'Higher oil content means shorter shelf life than white rice.' },
  pasta:             { fridge: 4,   freezer: 60,  pantry: 730, tip: 'Cooked pasta: fridge 4 days. Toss with a little oil to prevent sticking.' },
  flour:             { fridge: 365, freezer: 730, pantry: 240, tip: 'Whole wheat flour goes rancid faster than all-purpose.' },
  'all-purpose flour': { fridge: 365, freezer: 730, pantry: 365, tip: 'Freeze for 48 hours after buying to kill any pantry moth eggs.' },
  sugar:             { fridge: null, freezer: null, pantry: 730, tip: 'Sugar never truly expires; keep dry and sealed.' },
  'brown sugar':     { fridge: null, freezer: null, pantry: 730, tip: 'Place a marshmallow in the bag to keep it soft.' },
  'powdered sugar':  { fridge: null, freezer: null, pantry: 730, tip: 'Sift before using to remove lumps.' },
  salt:              { fridge: null, freezer: null, pantry: 3650, tip: 'Pure salt never expires. Add rice grains to prevent clumping.' },
  'baking soda':     { fridge: null, freezer: null, pantry: 540, tip: 'Test by adding vinegar; if it fizzes, it\'s still good.' },
  'baking powder':   { fridge: null, freezer: null, pantry: 365, tip: 'Test by adding hot water; if it bubbles, it\'s active.' },
  'vanilla extract': { fridge: null, freezer: null, pantry: 1825, tip: 'Pure vanilla improves with age, like wine.' },
  'olive oil':       { fridge: null, freezer: null, pantry: 540, tip: 'Store away from heat and light. Goes rancid faster than you think.' },
  'vegetable oil':   { fridge: null, freezer: null, pantry: 365, tip: 'Smell test: rancid oil smells like crayons.' },
  'coconut oil':     { fridge: null, freezer: null, pantry: 730, tip: 'Solid at room temp is normal. Longest lasting cooking oil.' },
  'sesame oil':      { fridge: 365, freezer: null, pantry: 180, tip: 'Toasted sesame oil is a finishing oil; don\'t cook with it at high heat.' },
  vinegar:           { fridge: null, freezer: null, pantry: 1825, tip: 'Virtually indefinite shelf life. "Mother" strands are harmless.' },
  'apple cider vinegar': { fridge: null, freezer: null, pantry: 1825, tip: 'The "mother" (cloudy bits) is a sign of quality.' },
  'balsamic vinegar': { fridge: null, freezer: null, pantry: 1095, tip: 'High-quality balsamic improves with age.' },
  'soy sauce':       { fridge: 1095, freezer: null, pantry: 365, tip: 'Refrigerate after opening for best quality.' },
  honey:             { fridge: null, freezer: null, pantry: 3650, tip: 'Never expires. If crystallised, warm gently in water.' },
  'maple syrup':     { fridge: 365, freezer: null, pantry: null, tip: 'Refrigerate after opening; mould can grow on surface.' },
  'peanut butter':   { fridge: 180, freezer: null, pantry: 90,  tip: 'Natural PB: refrigerate after opening. Stir before storing.' },
  oats:              { fridge: null, freezer: 365, pantry: 365, tip: 'Store in airtight container. Steel-cut keeps longer.' },
  'canned beans':    { fridge: 4,   freezer: 180, pantry: 1825, tip: 'Rinse canned beans to reduce sodium by up to 40%.' },
  'black beans':     { fridge: 4,   freezer: 180, pantry: 1825, tip: 'Dried beans last 2+ years; canned about 5 years.' },
  lentils:           { fridge: 5,   freezer: 180, pantry: 365, tip: 'Dried lentils don\'t need soaking -- cook directly.' },
  chickpeas:         { fridge: 4,   freezer: 180, pantry: 1825, tip: 'Save aquafaba (the liquid) -- it whips like egg whites.' },
  'canned tomatoes':  { fridge: 5,   freezer: 180, pantry: 1095, tip: 'Store opened cans in a non-metal container in fridge.' },
  'tomato paste':    { fridge: 7,   freezer: 180, pantry: 730, tip: 'Freeze leftover paste in tablespoon portions on parchment.' },
  'tomato sauce':    { fridge: 7,   freezer: 180, pantry: 365, tip: 'Freeze in portions in muffin tins.' },
  'chicken broth':   { fridge: 5,   freezer: 180, pantry: 365, tip: 'Freeze in ice cube trays for small amounts.' },
  'beef broth':      { fridge: 5,   freezer: 180, pantry: 365, tip: 'Homemade broth gels when cold -- that means it\'s rich in collagen.' },
  bread:             { fridge: null, freezer: 90,  pantry: 5,   tip: 'Never refrigerate bread; it stales faster. Freeze instead.' },
  tortillas:         { fridge: 21,  freezer: 180, pantry: 7,   tip: 'Separate with parchment paper before freezing.' },
  'bread crumbs':    { fridge: null, freezer: 180, pantry: 180, tip: 'Make your own from stale bread -- much better flavour.' },
  nuts:              { fridge: 180, freezer: 365, pantry: 90,  tip: 'Nuts go rancid at room temp. Refrigerate or freeze for long storage.' },
  almonds:           { fridge: 180, freezer: 365, pantry: 90,  tip: 'Toast before using for maximum flavour.' },
  walnuts:           { fridge: 180, freezer: 365, pantry: 30,  tip: 'Most perishable common nut; always refrigerate.' },
  pecans:            { fridge: 180, freezer: 730, pantry: 60,  tip: 'High oil content makes refrigeration important.' },
  chocolate:         { fridge: null, freezer: 365, pantry: 365, tip: 'White bloom is cosmetic only -- still safe to eat.' },
  'chocolate chips':  { fridge: null, freezer: 730, pantry: 365, tip: 'Store in a cool place; they melt easily.' },
  cocoa:             { fridge: null, freezer: null, pantry: 1095, tip: 'Natural and Dutch-process are not interchangeable in baking.' },
  'coconut milk':    { fridge: 5,   freezer: 90,  pantry: 730, tip: 'Shake can well; freeze leftovers in ice cube trays.' },
  tofu:              { fridge: 7,   freezer: 150, pantry: null, tip: 'Change water daily for opened tofu. Freezing changes texture to chewier.' },

  // -- Condiments & Sauces --
  ketchup:           { fridge: 180, freezer: null, pantry: 30,  tip: 'The acidity keeps it safe for a long time.' },
  mustard:           { fridge: 365, freezer: null, pantry: 30,  tip: 'Yellow mustard lasts longest; Dijon shortest.' },
  mayonnaise:        { fridge: 60,  freezer: null, pantry: null, tip: 'Never leave mayo out more than 2 hours.' },
  'hot sauce':       { fridge: 1825, freezer: null, pantry: 365, tip: 'Vinegar-based hot sauces last nearly forever.' },
  'fish sauce':      { fridge: 1095, freezer: null, pantry: 365, tip: 'Gets better with age like wine. Nearly indestructible.' },
  'hoisin sauce':    { fridge: 365, freezer: null, pantry: null, tip: 'Refrigerate after opening.' },
  'oyster sauce':    { fridge: 365, freezer: null, pantry: null, tip: 'Colour darkens over time but remains safe.' },
  'worcestershire':  { fridge: 1095, freezer: null, pantry: 365, tip: 'Fermented, so it keeps a very long time.' },
  jam:               { fridge: 180, freezer: 365, pantry: null, tip: 'Always use a clean spoon to prevent mould.' },
  jelly:             { fridge: 180, freezer: 365, pantry: null, tip: 'Higher sugar content means longer shelf life.' },
  salsa:             { fridge: 14,  freezer: 60,  pantry: null, tip: 'Fresh salsa lasts days; jarred lasts weeks.' },
  tahini:            { fridge: 180, freezer: null, pantry: 90,  tip: 'Stir well before using; oil separation is normal.' },
  miso:              { fridge: 365, freezer: null, pantry: null, tip: 'Fermented, so it lasts a very long time refrigerated.' },

  // -- Herbs & Spices --
  basil:             { fridge: 7,   freezer: 180, pantry: null, tip: 'Store fresh basil at room temperature in water, like flowers.' },
  cilantro:          { fridge: 10,  freezer: 180, pantry: null, tip: 'Store in a jar of water with a bag over the top.' },
  parsley:           { fridge: 10,  freezer: 180, pantry: null, tip: 'Treat like flowers: trim stems and store in water.' },
  rosemary:          { fridge: 14,  freezer: 365, pantry: null, tip: 'Wrap in a damp paper towel. Woody herb that dries well.' },
  thyme:             { fridge: 10,  freezer: 365, pantry: null, tip: 'Strip leaves from stems for freezing.' },
  mint:              { fridge: 7,   freezer: 180, pantry: null, tip: 'Freeze in ice cube trays with water for drinks.' },
  dill:              { fridge: 7,   freezer: 180, pantry: null, tip: 'Delicate herb; add at end of cooking.' },
  chives:            { fridge: 7,   freezer: 180, pantry: null, tip: 'Snip with scissors instead of chopping for cleaner cuts.' },
  oregano:           { fridge: 7,   freezer: 180, pantry: null, tip: 'Dried oregano is actually more potent than fresh.' },
  sage:              { fridge: 7,   freezer: 365, pantry: null, tip: 'Fries beautifully in butter for a crispy garnish.' },
  ginger:            { fridge: 21,  freezer: 180, pantry: 7,   tip: 'Freeze whole and grate from frozen -- much easier.' },
  lemongrass:        { fridge: 14,  freezer: 365, pantry: null, tip: 'Freeze whole stalks; slice from frozen.' },
  'dried oregano':   { fridge: null, freezer: null, pantry: 1095, tip: 'Crush between fingers to check potency -- should smell strong.' },
  'dried basil':     { fridge: null, freezer: null, pantry: 730, tip: 'Replace every 1-2 years; loses flavour quickly.' },
  'cumin':           { fridge: null, freezer: null, pantry: 1095, tip: 'Whole seeds last much longer than ground.' },
  'paprika':         { fridge: null, freezer: null, pantry: 1095, tip: 'Refrigerate to preserve colour and potency.' },
  'cinnamon':        { fridge: null, freezer: null, pantry: 1095, tip: 'Ground loses potency after 6 months; sticks last longer.' },
  'chili powder':    { fridge: null, freezer: null, pantry: 730, tip: 'Toast briefly in a dry pan to revive faded spices.' },
  'black pepper':    { fridge: null, freezer: null, pantry: 1095, tip: 'Whole peppercorns keep flavour far longer than pre-ground.' },
  'red pepper flakes': { fridge: null, freezer: null, pantry: 730, tip: 'Oils dry out over time, reducing heat.' },
  'turmeric':        { fridge: null, freezer: null, pantry: 1095, tip: 'Stains everything -- use gloves when handling fresh turmeric.' },
  'garlic powder':   { fridge: null, freezer: null, pantry: 1095, tip: 'Clumps mean moisture got in. Replace if flavour is weak.' },
  'onion powder':    { fridge: null, freezer: null, pantry: 1095, tip: 'Add a few grains of rice to the jar to absorb moisture.' },
  'curry powder':    { fridge: null, freezer: null, pantry: 730, tip: 'Toast in oil at the start of cooking to bloom flavour.' },
  'bay leaves':      { fridge: null, freezer: null, pantry: 1095, tip: 'Snap in half -- if it doesn\'t smell, replace it.' },
  'garam masala':    { fridge: null, freezer: null, pantry: 180, tip: 'Make your own for dramatically better flavour.' },
  nutmeg:            { fridge: null, freezer: null, pantry: 1460, tip: 'Whole nutmeg lasts 4+ years; grate fresh as needed.' },
};

// ---- Helpers for duration formatting ----------------------------------------

function formatDays(days) {
  if (days == null) return null;
  if (days >= 3650) return 'indefinitely';
  if (days >= 730)  return `${Math.round(days / 365)} years`;
  if (days >= 365)  return '1 year';
  if (days >= 60)   return `${Math.round(days / 30)} months`;
  if (days >= 30)   return '1 month';
  if (days >= 14)   return `${Math.round(days / 7)} weeks`;
  if (days >= 7)    return '1 week';
  return `${days} day${days !== 1 ? 's' : ''}`;
}

// ---- getShelfLife -----------------------------------------------------------

/**
 * Look up shelf-life info for a given ingredient name.
 * Uses fuzzy matching: the DB key is contained in the query or vice-versa.
 *
 * @param {string} ingredientName
 * @returns {{ fridge: string|null, freezer: string|null, pantry: string|null, tip: string, found: boolean }}
 */
export function getShelfLife(ingredientName) {
  const query = (ingredientName || '').toLowerCase().trim();

  if (!query) {
    return { fridge: null, freezer: null, pantry: null, tip: '', found: false };
  }

  // Try exact match first, then fuzzy
  let match = null;
  let bestLen = 0;

  for (const key of Object.keys(SHELF_LIFE_DB)) {
    // Exact
    if (key === query) {
      match = key;
      break;
    }
    // Fuzzy: key contained in query or query contained in key
    if (query.includes(key) || key.includes(query)) {
      // Prefer the longest matching key (more specific)
      if (key.length > bestLen) {
        bestLen = key.length;
        match = key;
      }
    }
  }

  if (!match) {
    return { fridge: null, freezer: null, pantry: null, tip: '', found: false };
  }

  const entry = SHELF_LIFE_DB[match];
  return {
    fridge:  formatDays(entry.fridge),
    freezer: formatDays(entry.freezer),
    pantry:  formatDays(entry.pantry),
    tip:     entry.tip || '',
    found:   true,
  };
}
