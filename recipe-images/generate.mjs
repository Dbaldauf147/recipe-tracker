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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
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

// ─── IMAGE GENERATION ─────────────────────────────────────────────────
async function generateImage(prompt, size, retries = 2) {
  console.log(`  Generating ${size}...`);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt,
          n: 1,
          size,
          quality: 'standard',
          response_format: 'b64_json',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status >= 500 && attempt < retries) {
          console.log(`  Server error, retrying (${attempt + 1}/${retries})...`);
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
        throw new Error(`OpenAI API error ${res.status}: ${JSON.stringify(err)}`);
      }

      const data = await res.json();
      return Buffer.from(data.data[0].b64_json, 'base64');
    } catch (err) {
      if (attempt < retries && err.message?.includes('500')) {
        console.log(`  Error, retrying (${attempt + 1}/${retries})...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
  }
}

async function generateRecipeImages(recipeName, description, angle = 'plated') {
  const slug = recipeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const prompt = buildPrompt(recipeName, description, angle);

  console.log(`\nGenerating images for: ${recipeName}`);
  console.log(`Prompt: ${prompt.slice(0, 120)}...\n`);

  // DALL-E 3 supported sizes: 1024x1024, 1024x1792, 1792x1024
  // Run sequentially to avoid API rate limits
  const cardBuffer = await generateImage(prompt, '1024x1024');
  const heroBuffer = await generateImage(prompt, '1792x1024');

  const cardPath = join(__dirname, `${slug}-card.png`);
  const heroPath = join(__dirname, `${slug}-hero.png`);

  await writeFile(cardPath, cardBuffer);
  await writeFile(heroPath, heroBuffer);

  console.log(`  Saved: ${slug}-card.png`);
  console.log(`  Saved: ${slug}-hero.png`);
  console.log('  Done!\n');

  return { cardPath, heroPath };
}

// ─── BATCH SUPPORT ────────────────────────────────────────────────────
// Add recipes here and run: node generate.mjs
const recipes = [
  {
    name: 'Classic Spaghetti Carbonara',
    description: 'Creamy pasta with crispy pancetta, parmesan, and cracked black pepper, served in a white ceramic bowl with a fork twirled in the pasta, fresh parsley garnish',
    angle: 'plated',
  },
  // Add more recipes:
  // { name: 'Berry Smoothie', description: '...', angle: 'plated' },
];

// ─── RUN ──────────────────────────────────────────────────────────────
for (const recipe of recipes) {
  try {
    await generateRecipeImages(recipe.name, recipe.description, recipe.angle);
  } catch (err) {
    console.error(`Failed to generate ${recipe.name}:`, err.message);
  }
}
