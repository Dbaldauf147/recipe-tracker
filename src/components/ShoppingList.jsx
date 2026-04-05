import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { loadIngredients, saveIngredientsToFirestore } from '../utils/ingredientsStore.js';
import { saveField } from '../utils/firestoreSync';
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
    'raspberry', 'raspberries', 'rasberry', 'rasberries', 'rhubarb', 'romaine', 'rosemary', 'rutabaga',
    'sage', 'scallion', 'serrano', 'shallot', 'snap pea', 'snow pea',
    'spinach', 'spring mix', 'sprout', 'squash', 'starfruit', 'strawberry',
    'strawberries', 'sweet potato', 'tangerine', 'thyme', 'tomatillo',
    'tomato', 'turnip', 'vegetable', 'veggie', 'watermelon', 'watercress',
    'yam', 'zucchini', 'edamame', 'mixed greens', 'baby spinach',
    'red onion', 'yellow onion', 'white onion', 'red pepper', 'green pepper',
    'yellow pepper', 'jalapeno pepper', 'roma tomato', 'cherry tomato',
    'grape tomato', 'heirloom tomato', 'russet potato', 'yukon gold',
    'baby carrot', 'fresh herb', 'mixed berry', 'mixed berries',
    // Additional produce
    'acorn squash', 'spaghetti squash', 'delicata squash', 'kabocha',
    'chayote', 'jackfruit', 'dragon fruit', 'guava', 'tamarillo',
    'blood orange', 'mandarin', 'tangelo', 'ugli fruit', 'key lime',
    'meyer lemon', 'enoki', 'shiitake', 'portobello', 'cremini',
    'oyster mushroom', 'chanterelle', 'porcini', 'white mushroom',
    'baby bella', 'button mushroom', 'king trumpet',
    'napa cabbage', 'red cabbage', 'savoy cabbage', 'purple cabbage',
    'iceberg', 'butter lettuce', 'bibb lettuce', 'red leaf',
    'green leaf', 'frisee', 'mesclun', 'microgreen', 'power green',
    'baby kale', 'baby arugula', 'watercress', 'sorrel',
    'sugar snap', 'english pea', 'black eyed pea', 'split pea',
    'gold potato', 'red potato', 'fingerling', 'new potato', 'idaho',
    'vidalia', 'walla walla', 'pearl onion', 'cipollini',
    'anaheim', 'banana pepper', 'fresno', 'thai chili', 'scotch bonnet',
    'ghost pepper', 'hungarian wax', 'cubanelle', 'piquillo',
    'portabella', 'cremini mushroom',
    'baby corn', 'corn on the cob', 'ear of corn',
    'fresh basil', 'fresh cilantro', 'fresh parsley', 'fresh dill',
    'fresh mint', 'fresh thyme', 'fresh rosemary', 'fresh sage',
    'fresh oregano', 'fresh chive', 'fresh tarragon', 'fresh ginger',
    'whole garlic', 'garlic clove', 'minced garlic',
    'head of lettuce', 'bunch of', 'stalk',
    'lemon juice', 'lime juice', 'orange zest', 'lemon zest', 'lime zest',
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
    // Additional meat & seafood
    'salmon fillet', 'salmon filet', 'salmon steak', 'smoked salmon',
    'wild salmon', 'atlantic salmon', 'sockeye salmon', 'king salmon',
    'ahi tuna', 'tuna steak', 'yellowfin', 'albacore',
    'chicken leg', 'chicken quarter', 'whole chicken', 'rotisserie chicken',
    'chicken cutlet', 'chicken strip', 'chicken nugget', 'chicken patty',
    'bone-in chicken', 'boneless chicken', 'skinless chicken',
    'turkey breast', 'turkey leg', 'ground turkey breast', 'turkey burger',
    'turkey bacon', 'turkey deli', 'smoked turkey',
    'pork shoulder', 'pork butt', 'pork rib', 'pork roast', 'pulled pork',
    'baby back rib', 'spare rib', 'st louis rib', 'country rib',
    'new york strip', 't-bone', 'porterhouse', 'tri-tip', 'chuck roast',
    'eye of round', 'bottom round', 'top round', 'london broil',
    'skirt steak', 'hanger steak', 'flat iron', 'prime rib',
    'beef tenderloin', 'beef stew', 'stew meat', 'beef jerky',
    'corned beef', 'roast beef', 'ground bison',
    'rack of lamb', 'lamb chop', 'lamb shank', 'leg of lamb', 'ground lamb',
    'duck breast', 'duck leg', 'duck confit',
    'elk', 'rabbit', 'quail', 'cornish hen', 'game hen', 'goose', 'pheasant',
    'pancetta', 'guanciale', 'capicola', 'mortadella', 'sopressata',
    'canadian bacon', 'center cut bacon', 'thick cut bacon',
    'polish sausage', 'smoked sausage', 'link sausage', 'pork sausage',
    'linguica', 'merguez', 'boudin', 'blood sausage',
    'frankfurter', 'vienna sausage', 'liverwurst', 'bologna',
    'cod fillet', 'cod filet', 'cod loin', 'pacific cod', 'atlantic cod',
    'sea bass', 'striped bass', 'chilean sea bass', 'branzino',
    'sole', 'flounder', 'pollock', 'monkfish', 'arctic char',
    'barramundi', 'wahoo', 'opah', 'escolar', 'orange roughy',
    'canned tuna', 'canned salmon', 'smoked trout', 'lox', 'gravlax',
    'king crab', 'snow crab', 'dungeness', 'soft shell crab', 'crab cake',
    'crab leg', 'crab meat', 'imitation crab', 'surimi',
    'lobster tail', 'lobster claw', 'lobster meat',
    'shrimp cocktail', 'jumbo shrimp', 'tiger shrimp', 'rock shrimp',
    'bay scallop', 'sea scallop', 'diver scallop',
    'littleneck', 'cherrystone', 'manila clam', 'steamer clam',
    'black mussel', 'green lip mussel', 'pei mussel',
    'squid', 'cuttlefish', 'conch',
    'fish fillet', 'fish filet', 'fish stick', 'fish cake',
    'ground meat', 'meat loaf', 'meatloaf',
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
    // Additional dairy
    'sharp cheddar', 'mild cheddar', 'white cheddar', 'aged cheddar',
    'pepper jack', 'colby jack', 'cojack', 'manchego',
    'blue cheese', 'gorgonzola', 'roquefort', 'stilton',
    'fontina', 'asiago', 'romano', 'parmigiano', 'parm',
    'burrata', 'fresh mozzarella', 'buffalo mozzarella', 'low moisture mozzarella',
    'shredded cheese', 'sliced cheese', 'cheese blend', 'mexican blend',
    'italian blend', 'pizza cheese', 'nacho cheese',
    'cream cheese spread', 'whipped cream cheese', 'chive cream cheese',
    'crumbled feta', 'crumbled goat cheese', 'crumbled blue cheese',
    'queso fresco', 'cotija', 'oaxaca', 'paneer', 'halloumi',
    'emmental', 'jarlsberg', 'comte', 'raclette',
    'whole egg', 'large egg', 'medium egg', 'dozen egg', 'free range egg',
    'cage free egg', 'pasture raised egg', 'organic egg', 'brown egg',
    'vanilla yogurt', 'strawberry yogurt', 'blueberry yogurt',
    'coconut yogurt', 'dairy free yogurt',
    'half & half', 'light cream', 'table cream',
    'clotted cream', 'creme fraiche', 'double cream',
    'clarified butter', 'cultured butter', 'european butter',
    'plant butter', 'vegan butter', 'earth balance',
    'eggnog', 'custard',
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
    // Additional bakery
    'kaiser roll', 'pretzel bun', 'potato bun', 'onion roll',
    'whole wheat tortilla', 'spinach tortilla', 'low carb tortilla',
    'keto bread', 'gluten free bread', 'ezekiel bread',
    'raisin bread', 'cinnamon bread', 'banana bread', 'zucchini bread',
    'garlic bread', 'breadstick', 'bread bowl',
    'pita pocket', 'pita chip', 'naan bread',
    'pancake', 'waffle', 'french toast', 'crepe',
    'pie shell', 'tart shell', 'pizza dough', 'pizza crust',
    'cake', 'cupcake', 'cookie', 'brownie', 'pastry',
    'cinnamon roll', 'sticky bun', 'bear claw', 'eclair',
    'turnover', 'strudel', 'kolache',
  ],
  frozen: [
    'frozen', 'ice cream', 'popsicle', 'sorbet', 'gelato',
    'frozen waffle', 'frozen pizza', 'frozen fruit', 'frozen vegetable',
    // Additional frozen
    'frozen dinner', 'frozen entree', 'frozen meal', 'tv dinner',
    'frozen burrito', 'frozen dumpling', 'frozen pierogi',
    'frozen fry', 'frozen fries', 'tater tot', 'hash brown',
    'frozen corn', 'frozen pea', 'frozen broccoli', 'frozen spinach',
    'frozen berry', 'frozen mango', 'frozen banana',
    'frozen shrimp', 'frozen fish', 'frozen chicken',
    'ice pop', 'frozen yogurt', 'frozen bar',
    'frozen pie', 'frozen cake', 'frozen cookie dough',
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
    // Additional grains
    'arborio', 'calrose', 'sushi rice', 'sticky rice', 'forbidden rice',
    'black rice', 'red rice', 'long grain', 'short grain', 'minute rice',
    'instant rice', 'rice pilaf', 'rice a roni', 'spanish rice',
    'whole wheat pasta', 'chickpea pasta', 'lentil pasta', 'protein pasta',
    'gluten free pasta', 'ziti', 'cavatappi', 'orecchiette', 'bucatini',
    'ditalini', 'campanelle', 'gemelli', 'paccheri', 'pappardelle',
    'tagliatelle', 'fettuccine', 'fettucine', 'manicotti', 'cannelloni',
    'stuffed shell', 'pasta sheet', 'lasagna sheet', 'wonton noodle',
    'lo mein', 'chow mein', 'pad thai noodle', 'glass noodle',
    'bean thread', 'cellophane noodle', 'sweet potato noodle',
    'corn flake', 'bran flake', 'cheerio', 'frosted flake',
    'granola bar', 'oat bar', 'breakfast bar', 'fiber bar',
    'overnight oat', 'muesli', 'porridge',
    'pita chip', 'veggie chip', 'sweet potato chip', 'kettle chip',
    'goldfish', 'cheese cracker', 'wheat thin', 'ritz',
    'graham', 'animal cracker', 'saltine', 'oyster cracker',
    'microwave popcorn', 'kettle corn',
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
    // Additional canned & jarred
    'great northern bean', 'cannellini', 'lima bean', 'butter bean',
    'split pea', 'red lentil', 'green lentil', 'brown lentil',
    'french lentil', 'black lentil',
    'fire roasted tomato', 'whole peeled tomato', 'petite diced tomato',
    'tomato puree', 'tomato juice', 'v8', 'clam juice',
    'anchovy paste', 'fish paste', 'shrimp paste',
    'pumpkin puree', 'sweet potato puree',
    'applesauce', 'apple butter', 'cranberry sauce',
    'mandarin orange', 'canned pineapple', 'maraschino',
    'canned corn', 'cream corn', 'creamed corn',
    'canned pea', 'canned green bean', 'canned beet',
    'sauerkraut', 'pickled jalapeno', 'pickled onion', 'pickled ginger',
    'banana pepper ring', 'roasted red pepper',
    'stuffed olive', 'green olive', 'black olive', 'castelvetrano',
    'pimento', 'giardiniera', 'relish',
    'canned chicken', 'canned beef', 'spam', 'corned beef hash',
    'chili con carne', 'chili no bean', 'hormel',
    'condensed soup', 'progresso', 'campbells',
    'coconut cream', 'cream of celery',
    'taco sauce', 'verde sauce', 'mole sauce', 'adobo sauce',
    'teriyaki sauce', 'stir fry sauce', 'pad thai sauce',
    'gravy', 'brown gravy', 'turkey gravy', 'mushroom gravy',
    'bouillon cube', 'better than bouillon', 'demi glace',
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
    // Additional baking
    'bread flour', 'pastry flour', 'oat flour', 'rice flour',
    'cassava flour', 'teff flour', 'spelt flour', 'rye flour',
    'vital wheat gluten', 'potato starch', 'modified starch',
    'turbinado', 'demerara', 'cane sugar', 'coconut sugar',
    'monk fruit', 'stevia', 'erythritol', 'swerve', 'splenda',
    'truvia', 'equal', 'sweet n low', 'xylitol',
    'dark chocolate', 'milk chocolate', 'white chocolate',
    'baking chocolate', 'cocoa powder', 'dutch process', 'cacao',
    'chocolate bar', 'chocolate chip', 'mini chocolate chip',
    'butterscotch chip', 'peanut butter chip', 'white chocolate chip',
    'instant pudding', 'pudding mix', 'jello', 'gelatin sheet',
    'frosting', 'fondant', 'royal icing', 'writing gel',
    'muffin mix', 'biscuit mix', 'bisquick', 'jiffy',
    'active dry yeast', 'instant yeast', 'rapid rise yeast',
    'italian bread crumb', 'seasoned bread crumb', 'plain bread crumb',
    'oreo', 'nilla wafer', 'cookie crumb',
    'pie filling', 'cherry pie filling', 'apple pie filling',
    'canned frosting', 'whipped topping', 'cool whip',
    'unflavored gelatin', 'agar', 'agar agar',
    'parchment paper', 'cupcake liner', 'muffin liner',
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
    // Additional spices
    'ground ginger', 'ground cinnamon', 'ground cumin', 'ground coriander',
    'ground nutmeg', 'ground clove', 'ground allspice', 'ground cardamom',
    'ground mustard', 'ground turmeric', 'ground black pepper',
    'ground white pepper', 'ground cayenne', 'ground fennel',
    'ancho chili', 'chipotle powder', 'guajillo', 'pasilla',
    'chili de arbol', 'new mexico chili', 'korean chili',
    'five spice', 'herbes de provence', 'bouquet garni', 'fines herbes',
    'ras el hanout', 'berbere', 'jerk seasoning', 'creole seasoning',
    'blackening seasoning', 'lemon herb', 'garlic herb',
    'onion salt', 'garlic pepper', 'seasoning salt',
    'msg', 'accent seasoning', 'umami powder',
    'pink salt', 'himalayan salt', 'flaky salt', 'finishing salt',
    'black salt', 'smoked salt', 'truffle salt',
    'peppercorn', 'pink peppercorn', 'green peppercorn',
    'szechuan peppercorn', 'sichuan pepper',
    'nigella seed', 'caraway seed', 'ajwain', 'fenugreek',
    'dried chili', 'dried chile', 'whole spice', 'pickling spice',
    'pumpkin pie spice', 'apple pie spice', 'chai spice',
    'everything seasoning', 'furikake',
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
    // Additional oils & condiments
    'peanut oil', 'safflower oil', 'sunflower oil', 'light olive oil',
    'toasted sesame oil', 'chili oil', 'garlic oil', 'infused oil',
    'ghee', 'lard', 'tallow', 'duck fat', 'bacon grease', 'schmaltz',
    'pam', 'nonstick spray', 'butter spray',
    'dijon mustard', 'spicy mustard', 'stone ground mustard', 'honey mustard',
    'kewpie', 'japanese mayo', 'duke mayo', 'hellmann',
    'sambal oelek', 'gochujang', 'chili garlic sauce', 'cholula',
    'tabasco', 'frank red hot', 'valentina', 'tapatio', 'crystal',
    'green tabasco', 'chipotle hot sauce', 'habanero sauce',
    'horseradish', 'prepared horseradish', 'horseradish sauce',
    'caesar dressing', 'italian dressing', 'ranch dressing',
    'thousand island', 'blue cheese dressing', 'french dressing',
    'vinaigrette', 'balsamic glaze', 'balsamic reduction',
    'pancake syrup', 'golden syrup', 'date syrup',
    'strawberry jam', 'grape jelly', 'orange marmalade', 'apricot jam',
    'cashew butter', 'hazelnut spread',
    'dipping sauce', 'wing sauce', 'garlic sauce', 'yum yum sauce',
    'marinara dip', 'queso dip', 'french onion dip',
    'liquid smoke', 'liquid amino', 'bragg',
    'white miso', 'red miso', 'miso paste',
    'anchovy paste', 'tomato concentrate',
  ],
  nuts: [
    'almond', 'brazil nut', 'cashew', 'chestnut', 'dried cranberry',
    'craisin', 'date', 'dried apricot', 'dried fig', 'dried fruit',
    'flax', 'hazelnut', 'hemp seed', 'macadamia', 'mixed nut',
    'pecan', 'pine nut', 'pistachio', 'poppy seed', 'pumpkin seed',
    'raisin', 'seed', 'sunflower seed', 'trail mix', 'walnut',
    'chia', 'coconut flake', 'shredded coconut',
    // Additional nuts & dried fruit
    'chia seed', 'flax seed', 'flaxseed', 'sesame', 'hemp heart',
    'golden raisin', 'sultana', 'currant', 'dried mango',
    'dried pineapple', 'dried papaya', 'dried cherry', 'dried blueberry',
    'dried banana', 'banana chip', 'apple chip', 'veggie crisp',
    'medjool date', 'deglet noor', 'pitted date',
    'slivered almond', 'sliced almond', 'whole almond', 'marcona',
    'roasted cashew', 'raw cashew', 'cashew piece',
    'chopped walnut', 'walnut half', 'walnut piece',
    'pecan half', 'chopped pecan', 'candied pecan',
    'roasted pistachio', 'shelled pistachio',
    'blanched almond', 'almond sliver',
    'raw nut', 'roasted nut', 'salted nut', 'unsalted nut',
    'nut mix', 'nut butter', 'seed mix', 'seed butter',
    'desiccated coconut', 'toasted coconut', 'coconut chip',
    'goji berry', 'acai', 'cacao nib', 'cocoa nib',
    'prune', 'dried plum',
  ],
  supplements: [
    'protein powder', 'protien powder', 'whey', 'creatine', 'collagen',
    'multivitamin', 'vitamin', 'fish oil', 'omega', 'probiotic',
    'prebiotic', 'magnesium supplement', 'zinc supplement', 'iron supplement',
    'calcium supplement', 'b12', 'vitamin d', 'vitamin c supplement',
    'electrolyte', 'bcaa', 'spirulina', 'chlorella', 'maca powder',
    'ashwagandha', 'turmeric supplement', 'supplement', 'david bar',
    // Additional supplements
    'casein', 'protein bar', 'protein shake', 'meal replacement',
    'collagen peptide', 'bone broth protein', 'pea protein', 'hemp protein',
    'soy protein', 'rice protein', 'egg white protein',
    'pre workout', 'post workout', 'intra workout',
    'greens powder', 'super greens', 'athletic greens', 'ag1',
    'fiber supplement', 'psyllium', 'metamucil',
    'melatonin', 'zinc', 'magnesium', 'iron',
    'biotin', 'folate', 'folic acid', 'coq10',
    'glucosamine', 'turmeric capsule', 'curcumin',
    'elderberry', 'echinacea', 'garlic supplement',
    'quest bar', 'rxbar', 'kind bar', 'clif bar', 'luna bar',
    'power bar', 'think thin', 'one bar', 'built bar',
    'premier protein', 'fairlife', 'muscle milk',
  ],
  drinks: [
    'juice', 'orange juice', 'apple juice', 'cranberry juice', 'lemonade',
    'coffee', 'tea', 'matcha', 'kombucha', 'soda', 'seltzer', 'sparkling water',
    'coconut water', 'almond milk', 'oat milk', 'soy milk', 'beer', 'wine',
    'whiskey', 'vodka', 'rum', 'tequila', 'gin', 'hard seltzer', 'cider',
    'smoothie', 'energy drink', 'gatorade', 'sports drink',
    // Additional drinks
    'cold brew', 'espresso', 'instant coffee', 'ground coffee', 'coffee bean',
    'k cup', 'coffee pod', 'decaf', 'french roast', 'colombian coffee',
    'green tea', 'black tea', 'herbal tea', 'chamomile', 'earl grey',
    'english breakfast', 'oolong', 'jasmine tea', 'chai', 'chai latte',
    'yerba mate', 'rooibos',
    'hot chocolate', 'hot cocoa', 'cocoa mix',
    'grape juice', 'grapefruit juice', 'tomato juice', 'pineapple juice',
    'prune juice', 'pomegranate juice', 'carrot juice', 'beet juice',
    'limeade', 'fruit punch', 'kool aid', 'tang', 'crystal light',
    'la croix', 'topo chico', 'perrier', 'pellegrino', 'mineral water',
    'club soda', 'tonic water', 'ginger ale', 'sprite', 'coke', 'pepsi',
    'dr pepper', 'root beer', 'cream soda', 'mountain dew',
    'diet soda', 'diet coke', 'zero sugar',
    'cashew milk', 'rice milk', 'hemp milk', 'flax milk', 'pea milk',
    'macadamia milk', 'banana milk', 'pistachio milk',
    'chocolate milk', 'strawberry milk',
    'protein shake', 'protein water',
    'white wine', 'red wine', 'rose wine', 'champagne', 'prosecco',
    'pinot noir', 'cabernet', 'merlot', 'chardonnay', 'sauvignon blanc',
    'bourbon', 'scotch', 'rye whiskey', 'irish whiskey',
    'mezcal', 'triple sec', 'cointreau', 'kahlua', 'baileys',
    'vermouth', 'aperol', 'campari', 'amaretto', 'limoncello',
    'ipa', 'lager', 'stout', 'porter', 'pale ale', 'wheat beer',
    'hard cider', 'hard kombucha', 'white claw', 'truly',
    'pedialyte', 'liquid iv', 'nuun', 'body armor', 'prime',
    'water bottle', 'spring water', 'distilled water', 'alkaline water',
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
    // Additional international
    'dashi', 'bonito', 'kombu', 'wakame', 'hijiki', 'dulse',
    'furikake', 'shichimi', 'togarashi', 'ponzu',
    'mochi', 'red bean', 'azuki', 'matcha powder',
    'panko bread crumb', 'tempura batter',
    'spring roll wrapper', 'egg roll wrapper', 'wonton wrapper',
    'dumpling wrapper', 'bao bun', 'mantou',
    'soy bean', 'silken tofu', 'firm tofu', 'extra firm tofu',
    'smoked tofu', 'tofu skin', 'yuba',
    'tikka masala', 'vindaloo', 'madras', 'tandoori',
    'naan bread', 'papadum', 'roti', 'paratha', 'chapati',
    'basmati rice', 'jasmine rice', 'sticky rice',
    'chutney', 'raita', 'ghee',
    'pho', 'pho broth', 'sriracha', 'hoisin sauce',
    'red curry paste', 'green curry paste', 'yellow curry paste',
    'massaman', 'panang', 'tom yum', 'tom kha',
    'pad thai sauce', 'satay sauce', 'sweet chili sauce',
    'black bean sauce', 'char siu sauce', 'plum sauce',
    'five spice powder', 'shaoxing wine', 'rice wine',
    'szechuan sauce', 'xo sauce', 'doubanjiang', 'chili crisp',
    'lao gan ma', 'black vinegar', 'chinkiang',
    'peri peri', 'piri piri', 'berbere spice',
    'injera', 'teff', 'couscous',
    'sofrito', 'recaito', 'sazon', 'goya', 'mojo',
    'taco shell', 'tostada', 'empanada shell',
    'mole', 'achiote', 'annatto', 'epazote', 'mexican oregano',
    'queso fresco', 'cotija cheese', 'oaxaca cheese',
    'paneer', 'halloumi',
  ],
};

// Build a flat list of [keyword, section] pairs sorted longest-first so
// "tomato paste" matches canned before "tomato" matches produce, etc.
const ALL_KEYWORDS = Object.entries(SECTION_KEYWORDS)
  .flatMap(([section, keywords]) => keywords.map(kw => [kw, section]))
  .sort((a, b) => b[0].length - a[0].length);

// Common descriptors to strip before matching (e.g. "boneless skinless chicken breast" → "chicken breast")
const STRIP_DESCRIPTORS = /\b(organic|fresh|raw|cooked|chopped|diced|sliced|minced|crushed|grated|shredded|ground|whole|boneless|skinless|bone-in|skin-on|thick cut|thin cut|center cut|wild caught|farm raised|grass fed|pasture raised|free range|cage free|natural|pure|unbleached|bleached|enriched|fortified|low sodium|reduced sodium|no salt|unsalted|salted|sweetened|unsweetened|flavored|unflavored|plain|original|classic|regular|extra|jumbo|large|medium|small|mini|baby|young|mature|aged|smoked|cured|dried|dehydrated|freeze dried|roasted|toasted|grilled|baked|fried|sauteed|steamed|blanched|marinated|seasoned|breaded|stuffed|packed|loosely packed|firmly packed|heaping|level|rounded|approximately|about|roughly)\b/g;

// Valid section keys for DB override validation
const VALID_SECTIONS = new Set(SECTIONS.map(s => s.key));

function categorizeIngredient(name, dbSections) {
  // Normalize: lowercase, strip diacritics (jalapeño → jalapeno)
  const lower = name.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // If the ingredients DB has a valid section override for this ingredient, use it
  // (skip 'other' so keyword matching gets a chance to find a better category)
  if (dbSections) {
    const override = dbSections[lower];
    if (override && override !== 'other' && VALID_SECTIONS.has(override)) return override;
  }

  // "frozen X" always goes to frozen
  if (lower.startsWith('frozen ')) return 'frozen';

  // Normalize underscores to spaces (e.g. "salmon_raw" → "salmon raw")
  const normalized = lower.replace(/_/g, ' ');

  // Try matching with the full name first, then with descriptors stripped
  const variants = [normalized];
  if (normalized !== lower) variants.unshift(lower); // also try original
  const stripped = normalized.replace(STRIP_DESCRIPTORS, '').replace(/\s{2,}/g, ' ').trim();
  if (stripped && stripped !== normalized) variants.push(stripped);

  for (const variant of variants) {
    // Try all keywords longest-first; first match wins
    for (const [kw, section] of ALL_KEYWORDS) {
      const idx = variant.indexOf(kw);
      if (idx !== -1) {
        // Check word boundary before the match
        const before = idx === 0 || /[\s,(_-]/.test(variant[idx - 1]);
        // Check word boundary after the match, allowing common plural suffixes (s, es)
        const afterPos = idx + kw.length;
        const after = afterPos >= variant.length
          || /^(\(s\)|\(es\)|s|es)?(\s|,|\)|$|_|-)/i.test(variant.slice(afterPos));
        if (before && after) return section;
      }
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
    const userServings = weeklyServings[recipe.id];
    // Only scale if user explicitly changed servings in This Week's Menu
    const scale = userServings != null ? userServings / baseServings : 1;
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

const CHECKED_KEY = 'sunday-shopping-checked';

function loadCheckedItems() {
  try {
    const raw = localStorage.getItem(CHECKED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveCheckedItems(checkedSet, user) {
  const arr = [...checkedSet];
  localStorage.setItem(CHECKED_KEY, JSON.stringify(arr));
  if (user) {
    saveField(user.uid, 'shoppingChecked', arr);
  }
}

export function ShoppingList({ weeklyRecipes, weeklyServings = {}, extraItems = [], onClearExtras, onAddCustomItem, pantryNames, dismissedNames, onDismissItem, user }) {
  const isAdmin = user?.email === 'baldaufdan@gmail.com';

  // Build map of ingredient name (lowercase) → grocerySection from DB
  // Only include valid, non-'other' section values
  const [ingredientSections, setIngredientSections] = useState(() => {
    const db = loadIngredients() || [];
    const map = {};
    for (const row of db) {
      const section = (row.grocerySection || '').trim().toLowerCase();
      if (row.ingredient && section && section !== 'other' && VALID_SECTIONS.has(section)) {
        map[row.ingredient.toLowerCase().trim()] = section;
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

  const [checked, setChecked] = useState(() => loadCheckedItems());

  // Re-hydrate checked state when Firestore sync happens (cross-browser)
  // Debounce to avoid overwriting with stale data during rapid toggles
  const lastLocalSaveRef = useRef(0);
  const origSaveCheckedItems = useRef(saveCheckedItems);

  function toggleItem(key) {
    lastLocalSaveRef.current = Date.now();
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveCheckedItems(next, user);
      return next;
    });
  }

  useEffect(() => {
    const handleSync = () => {
      // Skip if we saved locally in the last 3 seconds (avoid overwrite from stale Firestore)
      if (Date.now() - lastLocalSaveRef.current < 3000) return;
      setChecked(loadCheckedItems());
    };
    window.addEventListener('firestore-sync', handleSync);
    return () => window.removeEventListener('firestore-sync', handleSync);
  }, []);

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

  // toggleItem defined above with debounce protection

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
              {extraItems.length} Grocery Staples Added
            </button>
          )}
        </div>
      </div>
      {adding && onAddCustomItem && (
        <div className={styles.addRow} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setAdding(false); setNewItem(''); } }}>
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
            {newItem.trim().length >= 1 && (() => {
              const q = newItem.trim().toLowerCase();
              const matches = ingredientSuggestions.filter(n => n.toLowerCase().startsWith(q)).slice(0, 10);
              // Also include contains-matches after starts-with
              const containsMatches = ingredientSuggestions.filter(n => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q)).slice(0, 5);
              const all = [...matches, ...containsMatches];
              if (all.length === 0) return null;
              return (
                <div className={styles.addSuggestions}>
                  {all.map(n => (
                    <button key={n} className={styles.addSuggestionItem} onMouseDown={e => {
                      e.preventDefault();
                      setNewItem(n);
                      if (onAddCustomItem) {
                        onAddCustomItem({ ingredient: n, quantity: '', measurement: '' });
                        setNewItem('');
                      }
                    }}>
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
                          const UNIT_FULL = {
                            tbsp: 'tablespoon', tbs: 'tablespoon', tablespoon: 'tablespoon', tablespoons: 'tablespoons',
                            tsp: 'teaspoon', teaspoon: 'teaspoon', teaspoons: 'teaspoons',
                            oz: 'ounce', ounce: 'ounce', ounces: 'ounces',
                            lb: 'pound', lbs: 'pound', pound: 'pound', pounds: 'pounds',
                            g: 'gram', gram: 'gram', grams: 'grams',
                            kg: 'kilogram', kilogram: 'kilogram', kilograms: 'kilograms',
                            ml: 'milliliter', milliliter: 'milliliter', milliliters: 'milliliters',
                            l: 'liter', liter: 'liter', liters: 'liters',
                            'fl oz': 'fluid ounce', 'fluid ounce': 'fluid ounce', 'fluid ounces': 'fluid ounces',
                            cup: 'cup', cups: 'cups',
                            pt: 'pint', pint: 'pint', pints: 'pints',
                            qt: 'quart', quart: 'quart', quarts: 'quarts',
                            gal: 'gallon', gallon: 'gallon', gallons: 'gallons',
                            can: 'can', cans: 'cans',
                            clove: 'clove', cloves: 'cloves',
                            slice: 'slice', slices: 'slices',
                            piece: 'piece', pieces: 'pieces',
                            stalk: 'stalk', stalks: 'stalks',
                            head: 'head', heads: 'heads',
                            bunch: 'bunch', bunches: 'bunches',
                            sprig: 'sprig', sprigs: 'sprigs',
                            pinch: 'pinch', dash: 'dash',
                            stick: 'stick', sticks: 'sticks',
                            pkg: 'package', package: 'package', packages: 'packages',
                            small: 'small', medium: 'medium', large: 'large',
                            handful: 'handful', handfuls: 'handfuls',
                          };
                          const rawUnit = (item.measurement || '').toLowerCase().replace(/\.$/, '');
                          const qty = parseFloat(item.quantity) || 0;
                          let fullUnit = UNIT_FULL[rawUnit] || item.measurement;
                          // Pluralize if qty > 1 and unit is singular
                          if (qty > 1 && fullUnit && !fullUnit.endsWith('s') && fullUnit !== 'dash' && fullUnit !== 'pinch') {
                            fullUnit = fullUnit + 's';
                          }
                          let displayUnit = fullUnit;

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
                                onMouseLeave={() => { if (convertPopup === ingKey) setConvertPopup(null); }}
                                style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', position: 'relative' }}
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
                                    {!hasConversions && (() => {
                                      const srcUnit = normalizeShopUnit(item.measurement);
                                      const isWeight = !!WEIGHT_TO_G[srcUnit];
                                      const isVolume = !!VOLUME_TO_ML[srcUnit];
                                      if (!isWeight && !isVolume) {
                                        return <div className={styles.convertNoAvail}>Conversion not available for {item.measurement || 'this unit'}</div>;
                                      }
                                      const num = parseFloat(item.quantity) || 0;
                                      function calcConvert(targetUnit) {
                                        if (isWeight && WEIGHT_TO_G[targetUnit]) {
                                          return parseFloat((num * WEIGHT_TO_G[srcUnit] / WEIGHT_TO_G[targetUnit]).toFixed(2));
                                        }
                                        if (isVolume && VOLUME_TO_ML[targetUnit]) {
                                          return parseFloat((num * VOLUME_TO_ML[srcUnit] / VOLUME_TO_ML[targetUnit]).toFixed(2));
                                        }
                                        return null;
                                      }
                                      return <>
                                        {isVolume && <>
                                          <div className={styles.convertTitle}>Volume</div>
                                          {VOLUME_UNITS.filter(u => u !== srcUnit).map(u => {
                                            const qty = calcConvert(u);
                                            if (qty === null) return null;
                                            return <button key={u} className={styles.convertOption} onClick={() => { setUnitOverrides(prev => ({ ...prev, [ingKey]: { unit: u, qty } })); setConvertPopup(null); }}>{qty} {u}</button>;
                                          })}
                                        </>}
                                        {isWeight && <>
                                          <div className={styles.convertTitle}>Weight</div>
                                          {WEIGHT_UNITS.filter(u => u !== srcUnit).map(u => {
                                            const qty = calcConvert(u);
                                            if (qty === null) return null;
                                            return <button key={u} className={styles.convertOption} onClick={() => { setUnitOverrides(prev => ({ ...prev, [ingKey]: { unit: u, qty } })); setConvertPopup(null); }}>{qty} {u}</button>;
                                          })}
                                        </>}
                                      </>;
                                    })()}
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
