import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  const envContent = await readFile(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY in .env');
  process.exit(1);
}

// ─── STYLE GUIDE (tweak once, applies everywhere) ─────────────────────
const STYLE = {
  lighting: 'soft warm natural window light from the left side, golden hour warmth',
  focus: 'shallow depth of field, dish in sharp focus, background gently blurred',
  tones: 'warm appetizing color tones, slightly golden amber warmth, high dynamic range',
  styling: 'clean minimal food styling, no clutter, professional food photography',
  surface: 'light wood table',
  props: 'max 2-3 small props: fresh herbs, a fork, a linen napkin',
  composition: 'negative space on the right side for text overlay',
  quality: 'photorealistic professional food photography, 8k, magazine quality, NOT illustration NOT cartoon NOT AI-art style',
};

const ANGLES = {
  plated: '45-degree angle, eye-level perspective',
  flatlay: 'overhead flat-lay, top-down view',
  stacked: 'slight low-angle, hero shot looking slightly up',
};

// ─── PROMPT BUILDER ───────────────────────────────────────────────────
function buildPrompt(recipeName, description, angle = 'plated') {
  const cameraAngle = ANGLES[angle] || ANGLES.plated;
  return [
    `Professional food photography of ${recipeName}.`,
    description,
    `Camera: ${cameraAngle}.`,
    `Lighting: ${STYLE.lighting}.`,
    `Focus: ${STYLE.focus}.`,
    `Color: ${STYLE.tones}.`,
    `Surface: ${STYLE.surface}. Props: ${STYLE.props}.`,
    `Composition: ${STYLE.composition}.`,
    `Style: ${STYLE.quality}. ${STYLE.styling}.`,
  ].join(' ');
}

// ─── IMAGE GENERATION (DeepInfra — free, no API key) ─────────────────
async function generateImage(prompt, size, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://api.deepinfra.com/v1/openai/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'black-forest-labs/FLUX-1-schnell',
          prompt,
          size,
          n: 1,
          response_format: 'b64_json',
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          const wait = res.status === 429 ? 15000 : 5000;
          console.log(`    HTTP ${res.status}, retrying in ${wait / 1000}s (${attempt + 1}/${retries})...`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw new Error(`DeepInfra error ${res.status}: ${err.slice(0, 200)}`);
      }

      const data = await res.json();
      return Buffer.from(data.data[0].b64_json, 'base64');
    } catch (err) {
      if (attempt < retries && (err.message?.includes('429') || err.message?.includes('500') || err.message?.includes('fetch'))) {
        console.log(`    Error, retrying (${attempt + 1}/${retries})...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      throw err;
    }
  }
}

function getSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function generateRecipeImages(recipeName, description, angle = 'plated') {
  const slug = getSlug(recipeName);
  const cardPath = join(__dirname, `${slug}-card.png`);
  const heroPath = join(__dirname, `${slug}-hero.png`);

  // Skip if both images already exist
  if (existsSync(cardPath) && existsSync(heroPath)) {
    console.log(`  SKIP (already exists)`);
    return { cardPath, heroPath, skipped: true };
  }

  const prompt = buildPrompt(recipeName, description, angle);

  // Generate only missing images
  if (!existsSync(cardPath)) {
    console.log(`  Generating card (1024x1024)...`);
    const cardBuffer = await generateImage(prompt, '1024x1024');
    await writeFile(cardPath, cardBuffer);
    console.log(`  Saved: ${slug}-card.png`);
  }

  // Small delay between requests to avoid rate limiting
  await new Promise(r => setTimeout(r, 1500));

  if (!existsSync(heroPath)) {
    console.log(`  Generating hero (1792x1024)...`);
    const heroBuffer = await generateImage(prompt, '1792x1024');
    await writeFile(heroPath, heroBuffer);
    console.log(`  Saved: ${slug}-hero.png`);
  }

  return { cardPath, heroPath, skipped: false };
}

// ─── ALL RECIPES ─────────────────────────────────────────────────────
const recipes = [
  // ── BREAKFAST ──
  {
    name: 'Protein Pancakes',
    description: 'Stack of golden fluffy protein pancakes topped with fresh blueberries and a drizzle of maple syrup, served on a white ceramic plate',
    angle: 'stacked',
  },
  {
    name: 'Veggie Omelette',
    description: 'Folded golden omelette filled with colorful diced bell peppers, spinach, tomatoes, and melted cheese, served on a white plate with a side of fresh herbs',
    angle: 'plated',
  },
  {
    name: 'Turkey and Eggs Breakfast Bowl',
    description: 'Hearty breakfast bowl with scrambled eggs, seasoned ground turkey, sauteed spinach, diced sweet potatoes, and a sprinkle of everything bagel seasoning',
    angle: 'flatlay',
  },
  {
    name: 'Cottage Cheese Bowl',
    description: 'White bowl of creamy cottage cheese topped with fresh mixed berries, pumpkin seeds, and a drizzle of honey, bright and fresh looking',
    angle: 'flatlay',
  },
  {
    name: 'Egg Bake',
    description: 'Golden bubbly egg bake casserole in a baking dish with melted cheese, vegetables, and herbs visible on top, freshly out of the oven',
    angle: 'plated',
  },
  {
    name: 'Chopped Egg Salad',
    description: 'Fresh chopped egg salad with diced eggs, crisp vegetables, herbs, served in a white bowl with whole grain crackers on the side',
    angle: 'flatlay',
  },
  {
    name: 'Egg & Sweet Potatos',
    description: 'Roasted sweet potato cubes with sunny-side-up eggs on top, sprinkled with fresh herbs and cracked black pepper, served on a white plate',
    angle: 'plated',
  },
  {
    name: 'Feta Fried Egg',
    description: 'Crispy fried eggs with crumbled feta cheese, cherry tomatoes, fresh herbs, and a drizzle of olive oil, served in a small cast iron skillet',
    angle: 'plated',
  },
  {
    name: 'Black Bean Smothered Burrito',
    description: 'Large flour tortilla burrito smothered in black bean sauce with melted cheese, sour cream, and fresh cilantro on top, served on a plate',
    angle: 'plated',
  },
  {
    name: 'Eggs & Beans',
    description: 'Scrambled eggs served alongside seasoned black beans with diced tomatoes, avocado slices, and fresh cilantro in a breakfast bowl',
    angle: 'flatlay',
  },
  {
    name: 'Quinoa Breakfast Bowl',
    description: 'Warm quinoa breakfast bowl topped with sliced bananas, berries, pumpkin seeds, and a drizzle of almond butter, served in a deep ceramic bowl',
    angle: 'flatlay',
  },
  {
    name: 'Breakfast Burrito',
    description: 'Golden grilled breakfast burrito cut in half showing scrambled eggs, cheese, beans, and vegetables inside, served on a plate with salsa',
    angle: 'stacked',
  },
  {
    name: 'Shakshouka',
    description: 'Vibrant shakshuka with poached eggs nestled in a rich spiced tomato and pepper sauce, topped with fresh herbs and crumbled feta, in a cast iron skillet',
    angle: 'flatlay',
  },
  {
    name: 'Overnight Oats (Apple Pie)',
    description: 'Mason jar of creamy overnight oats layered with cinnamon apple chunks, granola, and a sprinkle of cinnamon on top, cozy autumn vibes',
    angle: 'plated',
  },
  {
    name: 'Overnight Oats (Summer)',
    description: 'Mason jar of overnight oats topped with fresh summer berries, sliced peaches, coconut flakes, and chia seeds, bright and colorful',
    angle: 'plated',
  },
  {
    name: 'Banana Bread Baked Oats',
    description: 'Golden baked oats in a ramekin with caramelized banana slices on top, warm and rustic, with a spoon ready to dig in',
    angle: 'plated',
  },
  {
    name: 'Avocado Toast',
    description: 'Thick slice of artisan toast topped with mashed avocado, everything bagel seasoning, red pepper flakes, and a squeeze of lemon, on a ceramic plate',
    angle: 'plated',
  },

  // ── SMOOTHIES & DRINKS ──
  {
    name: 'Maca Smoothie',
    description: 'Thick creamy golden-brown maca smoothie in a tall glass with banana slices and a dusting of maca powder on top, straw inserted',
    angle: 'plated',
  },
  {
    name: 'Spirulina Smoothie',
    description: 'Vibrant green spirulina smoothie in a tall glass topped with chia seeds and a slice of banana, deep emerald green color',
    angle: 'plated',
  },
  {
    name: 'Berry Smoothie',
    description: 'Thick purple-pink berry smoothie in a tall glass with fresh berries on top and a colorful straw, condensation on the glass',
    angle: 'plated',
  },
  {
    name: 'Cherry Mango Smoothie',
    description: 'Vibrant orange-red smoothie in a tall glass with fresh mango chunks and cherries as garnish, tropical and colorful',
    angle: 'plated',
  },
  {
    name: 'Green Juice',
    description: 'Fresh bright green juice in a tall glass with celery stalk and kale leaf garnish, vibrant healthy green color, dewdrops on glass',
    angle: 'plated',
  },
  {
    name: 'Ginger Tea',
    description: 'Clear glass mug of warm amber ginger tea with thin slices of fresh ginger and a lemon wedge floating, steam rising',
    angle: 'plated',
  },
  {
    name: 'Hot Honey Lime Margarita',
    description: 'Craft margarita in a salt-rimmed glass with lime wheel garnish, drizzle of hot honey, golden amber color with ice, festive presentation',
    angle: 'plated',
  },

  // ── LUNCH/DINNER – SEAFOOD ──
  {
    name: 'Shrimp Spring Roll',
    description: 'Fresh translucent rice paper spring rolls with pink shrimp, julienned vegetables, and herbs visible through the wrapper, served with peanut dipping sauce in a small bowl',
    angle: 'plated',
  },
  {
    name: 'Salmoncado',
    description: 'Fresh salmon slices fanned over ripe avocado halves with sesame seeds, microgreens, and a drizzle of soy glaze, served on a white plate',
    angle: 'plated',
  },
  {
    name: 'Shrimp Tacos',
    description: 'Three soft corn tortilla tacos filled with seasoned shrimp, shredded cabbage, avocado crema, pickled onions, and fresh cilantro, served on a plate with lime wedges',
    angle: 'plated',
  },
  {
    name: 'Crispy Salmon Bites',
    description: 'Golden crispy bite-sized salmon pieces with a crunchy coating, served on a plate with a creamy dipping sauce and lemon wedges',
    angle: 'plated',
  },
  {
    name: 'Tuna Toast',
    description: 'Thick toast slices topped with seasoned tuna salad, sliced avocado, microgreens, and everything bagel seasoning, served on a white plate',
    angle: 'plated',
  },
  {
    name: 'Kimchi Fried Rice',
    description: 'Bowl of kimchi fried rice with visible kimchi pieces, a fried egg on top with runny yolk, sesame seeds, and sliced scallions',
    angle: 'flatlay',
  },
  {
    name: 'Salmon Broccoli & Quinoa',
    description: 'Perfectly seared salmon fillet with crispy skin alongside roasted broccoli florets and fluffy quinoa, served on a white plate with lemon wedge',
    angle: 'plated',
  },
  {
    name: 'Pineapple Shrimp Fried Rice',
    description: 'Fried rice with plump shrimp and pineapple chunks served inside a hollowed-out pineapple half, garnished with scallions and sesame seeds',
    angle: 'plated',
  },
  {
    name: 'Tuna Lettuce Wrap',
    description: 'Crisp butter lettuce cups filled with seasoned tuna salad, diced vegetables, and avocado, arranged on a plate with lemon wedges',
    angle: 'flatlay',
  },
  {
    name: 'Salmon Tacos',
    description: 'Three soft tortilla tacos with flaked grilled salmon, mango salsa, shredded purple cabbage, avocado crema, and fresh cilantro, with lime wedges',
    angle: 'plated',
  },
  {
    name: 'Mediterranean Protein Pasta',
    description: 'Bowl of pasta tossed with sun-dried tomatoes, kalamata olives, crumbled feta cheese, artichoke hearts, fresh basil, and a drizzle of olive oil',
    angle: 'plated',
  },

  // ── LUNCH/DINNER – MEAT ──
  {
    name: 'Airfried Chicken Nuggets',
    description: 'Golden crispy air-fried chicken nuggets arranged on a plate with a small bowl of dipping sauce, fresh herbs, and lemon wedge garnish',
    angle: 'plated',
  },
  {
    name: 'Turkey Chilli',
    description: 'Hearty bowl of turkey chili topped with shredded cheese, diced avocado, sour cream, and fresh cilantro, rich and steaming',
    angle: 'plated',
  },
  {
    name: 'Chicken Salad',
    description: 'Fresh chicken salad with grilled chicken strips over mixed greens, cherry tomatoes, cucumber, red onion, and a light vinaigrette',
    angle: 'flatlay',
  },
  {
    name: 'Veggie & Chicken Bowl',
    description: 'Colorful grain bowl with sliced grilled chicken, roasted vegetables, quinoa, fresh greens, and a tahini drizzle',
    angle: 'flatlay',
  },
  {
    name: 'Buffalo Chicken Dip',
    description: 'Bubbly golden buffalo chicken dip in a small baking dish with melted cheese on top, surrounded by celery sticks and tortilla chips for dipping',
    angle: 'plated',
  },

  // ── LUNCH/DINNER – VEGETARIAN/VEGAN ──
  {
    name: 'Coconut Dal',
    description: 'Rich creamy golden coconut dal in a bowl with a swirl of coconut cream, fresh cilantro, and red chili flakes, served with naan bread on the side',
    angle: 'plated',
  },
  {
    name: 'Tofu Tikka Masala',
    description: 'Vibrant orange-red tikka masala sauce with golden crispy tofu cubes, served in a bowl with basmati rice and fresh cilantro garnish',
    angle: 'plated',
  },
  {
    name: 'Tofu Bowl',
    description: 'Colorful Buddha bowl with crispy baked tofu, steamed rice, edamame, shredded carrots, cucumber, avocado, and a sesame ginger dressing',
    angle: 'flatlay',
  },
  {
    name: 'Lentil Salad',
    description: 'Hearty lentil salad with cooked green lentils, diced cucumber, cherry tomatoes, red onion, feta cheese, and fresh herbs in a bowl',
    angle: 'flatlay',
  },
  {
    name: 'Lentil Soup',
    description: 'Warm bowl of hearty lentil soup with a rich amber broth, vegetables visible, topped with a swirl of olive oil and crusty bread on the side',
    angle: 'plated',
  },
  {
    name: 'Veggie Chilli',
    description: 'Hearty vegetarian chili loaded with beans, corn, diced peppers, and tomatoes, topped with avocado slices, cilantro, and a dollop of sour cream',
    angle: 'plated',
  },
  {
    name: 'Baked Feta Pasta',
    description: 'Baked feta pasta with burst cherry tomatoes, melted feta cheese, fresh basil, and penne pasta tossed together, vibrant red and white colors',
    angle: 'plated',
  },
  {
    name: 'Eggplant Parmesan Meatballs',
    description: 'Golden brown eggplant parmesan meatballs in marinara sauce with melted mozzarella cheese, fresh basil garnish, served in a baking dish',
    angle: 'plated',
  },
  {
    name: 'Eggplant Rollatini',
    description: 'Rolled eggplant slices filled with ricotta cheese in marinara sauce with melted mozzarella on top, fresh basil garnish, in a baking dish',
    angle: 'plated',
  },
  {
    name: 'Brussels Sprout Slaw',
    description: 'Fresh shredded Brussels sprout slaw with dried cranberries, toasted almonds, shaved parmesan, and a light citrus dressing in a serving bowl',
    angle: 'flatlay',
  },
  {
    name: 'Harvest Bowl',
    description: 'Autumn harvest bowl with roasted sweet potatoes, quinoa, kale, dried cranberries, pumpkin seeds, and a tahini dressing',
    angle: 'flatlay',
  },
  {
    name: 'Extra Vegetables Fried Rice',
    description: 'Colorful vegetable fried rice with diced carrots, peas, corn, bell peppers, scallions, and a fried egg on top, served in a bowl',
    angle: 'flatlay',
  },
  {
    name: 'Channa Masala',
    description: 'Rich spiced chickpea curry in a deep amber sauce with fresh cilantro, served in a bowl alongside fluffy basmati rice and naan bread',
    angle: 'plated',
  },
  {
    name: 'Burrito Bowl',
    description: 'Colorful burrito bowl with cilantro lime rice, black beans, corn, pico de gallo, guacamole, sour cream, and shredded lettuce',
    angle: 'flatlay',
  },
  {
    name: 'Crunchwrap Supreme',
    description: 'Golden crispy crunchwrap cut in half showing layers of seasoned filling, cheese, lettuce, tomato, and sour cream inside, served on a plate',
    angle: 'stacked',
  },
  {
    name: 'Buffalo Cauliflower Wrap',
    description: 'Flour tortilla wrap filled with crispy buffalo cauliflower, ranch dressing, shredded lettuce, and diced celery, cut in half showing the filling',
    angle: 'stacked',
  },
  {
    name: 'Pickled Beet Salad',
    description: 'Vibrant magenta pickled beet salad with crumbled goat cheese, toasted walnuts, arugula, and a balsamic drizzle on a white plate',
    angle: 'flatlay',
  },
  {
    name: 'Cabage Soup',
    description: 'Hearty cabbage soup in a bowl with visible cabbage, carrots, tomatoes, and herbs in a savory broth, steam rising, with crusty bread on the side',
    angle: 'plated',
  },
  {
    name: 'Johnny Salad',
    description: 'Large fresh mixed green salad with colorful vegetables, cherry tomatoes, cucumber, shredded carrots, and seeds, with dressing on the side',
    angle: 'flatlay',
  },
  {
    name: 'Beyond Sausages',
    description: 'Grilled plant-based sausages with char marks on a plate with sauteed peppers and onions, whole grain mustard on the side',
    angle: 'plated',
  },
  {
    name: 'Beyond Burger',
    description: 'Juicy plant-based burger on a toasted brioche bun with lettuce, tomato, onion, pickles, and melted cheese, served with a side of fries',
    angle: 'stacked',
  },

  // ── SNACKS ──
  {
    name: 'Cottage Cheese Bread',
    description: 'Sliced homemade cottage cheese bread with a golden crust, fluffy interior visible, served on a cutting board with butter',
    angle: 'stacked',
  },
  {
    name: 'Cottage Cheese Bell Pepper',
    description: 'Colorful bell pepper halves stuffed with seasoned cottage cheese, topped with everything bagel seasoning, arranged on a plate',
    angle: 'flatlay',
  },
  {
    name: 'Cottage Cheese Toast',
    description: 'Thick toast slices spread with cottage cheese, topped with sliced tomatoes, everything bagel seasoning, and a drizzle of olive oil',
    angle: 'plated',
  },
  {
    name: 'Trail Mix',
    description: 'Colorful trail mix with mixed nuts, dried fruits, seeds, and dark chocolate chips scattered on parchment paper, overhead view',
    angle: 'flatlay',
  },
  {
    name: 'Ham and Havarti Roll-ups',
    description: 'Neat spiral roll-ups of sliced ham wrapped around havarti cheese with a toothpick, arranged on a small plate with pickles and mustard',
    angle: 'plated',
  },
  {
    name: 'Crispy Smashed Potatoes',
    description: 'Golden crispy smashed baby potatoes on a baking sheet with fresh rosemary, garlic, flaky sea salt, and a side of aioli dipping sauce',
    angle: 'flatlay',
  },
  {
    name: 'Pickled Onions',
    description: 'Vibrant magenta quick-pickled red onions in a glass mason jar with visible peppercorns and bay leaf, bright and tangy looking',
    angle: 'plated',
  },
  {
    name: 'Watermelon Feta Salad',
    description: 'Fresh cubed watermelon salad with crumbled white feta cheese, fresh mint leaves, and a balsamic drizzle on a white plate, summer vibes',
    angle: 'flatlay',
  },
  {
    name: 'Black Bean Dip',
    description: 'Creamy black bean dip in a bowl topped with cotija cheese, cilantro, and a drizzle of lime crema, surrounded by tortilla chips',
    angle: 'flatlay',
  },
  {
    name: 'Chocolate Chia Seed Pudding',
    description: 'Rich dark chocolate chia seed pudding in a small glass jar with visible chia seeds, topped with fresh raspberries and coconut flakes',
    angle: 'plated',
  },

  // ── DESSERTS ──
  {
    name: 'Healthy Brownies',
    description: 'Rich dark chocolate brownies cut into squares showing a fudgy interior, stacked on parchment paper with a dusting of cocoa powder',
    angle: 'stacked',
  },
  {
    name: 'Magic Bars',
    description: 'Layered magic cookie bars with a golden graham cracker crust, chocolate chips, coconut flakes, and condensed milk, cut into squares and stacked',
    angle: 'stacked',
  },
];

// ─── RUN ──────────────────────────────────────────────────────────────
const total = recipes.length;
let completed = 0;
let skipped = 0;
let failed = 0;

console.log(`\n=== Generating images for ${total} recipes ===\n`);

for (const recipe of recipes) {
  completed++;
  console.log(`[${completed}/${total}] ${recipe.name}`);
  try {
    const result = await generateRecipeImages(recipe.name, recipe.description, recipe.angle);
    if (result.skipped) skipped++;
  } catch (err) {
    failed++;
    console.error(`  FAILED: ${err.message}`);
  }
}

console.log(`\n=== DONE ===`);
console.log(`  Generated: ${completed - skipped - failed}`);
console.log(`  Skipped (existing): ${skipped}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total: ${total}\n`);
