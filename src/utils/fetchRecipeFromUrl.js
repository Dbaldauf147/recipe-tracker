/**
 * Fetches a recipe from a URL via CORS proxy, extracts structured data
 * (Schema.org JSON-LD), and returns a recipe object matching the app's shape.
 * Falls back to plain-text parsing when no structured data is found.
 */

import { parseRecipeText } from './parseRecipeText';
import { normalizeFractions, parseIngredientLine } from './parseRecipeText';

// ── CORS proxy helpers ──

async function fetchViaProxy(url) {
  const proxies = [
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  ];

  for (const makeUrl of proxies) {
    try {
      const res = await fetch(makeUrl(url));
      if (res.ok) return await res.text();
    } catch {
      // try next proxy
    }
  }
  throw new Error('Could not fetch the URL. The site may be blocking access.');
}

// ── JSON-LD extraction ──

function extractJsonLdRecipe(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');

  for (const script of scripts) {
    try {
      let data = JSON.parse(script.textContent);

      // Handle @graph arrays (common on WordPress sites)
      if (data['@graph']) data = data['@graph'];
      if (Array.isArray(data)) {
        const recipe = data.find(
          item => item['@type'] === 'Recipe' || (Array.isArray(item['@type']) && item['@type'].includes('Recipe'))
        );
        if (recipe) return recipe;
      } else if (data['@type'] === 'Recipe' || (Array.isArray(data['@type']) && data['@type'].includes('Recipe'))) {
        return data;
      }
    } catch {
      // malformed JSON-LD, skip
    }
  }
  return null;
}

// ── Normalizers ──

function normalizeInstructions(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map(item => {
        if (typeof item === 'string') return item;
        // HowToSection with itemListElement
        if (item['@type'] === 'HowToSection') {
          const heading = item.name ? `${item.name}\n` : '';
          const steps = (item.itemListElement || [])
            .map(s => s.text || s.name || '')
            .filter(Boolean)
            .join('\n');
          return heading + steps;
        }
        // HowToStep
        return item.text || item.name || '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(raw);
}

function normalizeServings(raw) {
  if (!raw) return '';
  const str = Array.isArray(raw) ? raw[0] : String(raw);
  const match = str.match(/(\d+)/);
  return match ? match[1] : str;
}

function parseISO8601Duration(iso) {
  if (!iso) return '';
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!m) return '';
  const parts = [];
  if (m[1]) parts.push(`${m[1]} hr`);
  if (m[2]) parts.push(`${m[2]} min`);
  if (m[3]) parts.push(`${m[3]} sec`);
  return parts.join(' ');
}

function normalizeIngredients(raw) {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map(line => {
    const text = normalizeFractions(typeof line === 'string' ? line : line.text || '');
    return parseIngredientLine(text);
  });
}

// ── Fallback: strip HTML to plain text ──

function htmlToPlainText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Remove noise elements
  doc.querySelectorAll('script, style, nav, footer, header, aside, .ad, .sidebar').forEach(el => el.remove());
  return (doc.body?.textContent || '').replace(/[ \t]+/g, ' ');
}

// ── Main export ──

export async function fetchRecipeFromUrl(url) {
  const html = await fetchViaProxy(url);

  // Try structured data first
  const ld = extractJsonLdRecipe(html);
  if (ld) {
    return {
      title: ld.name || '',
      description: ld.description || '',
      category: 'lunch-dinner',
      frequency: 'common',
      mealType: '',
      servings: normalizeServings(ld.recipeYield),
      prepTime: parseISO8601Duration(ld.prepTime),
      cookTime: parseISO8601Duration(ld.cookTime),
      sourceUrl: url,
      ingredients: normalizeIngredients(ld.recipeIngredient),
      instructions: normalizeInstructions(ld.recipeInstructions),
    };
  }

  // Fallback: plain text → existing parser
  const text = htmlToPlainText(html);
  const parsed = parseRecipeText(text);
  return {
    title: parsed.title,
    description: '',
    category: 'lunch-dinner',
    frequency: 'common',
    mealType: '',
    servings: '1',
    prepTime: '',
    cookTime: '',
    sourceUrl: url,
    ingredients: parsed.ingredients,
    instructions: parsed.instructions,
  };
}
