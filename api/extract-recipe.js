/**
 * Vercel serverless function: fetches a URL, extracts structured recipe data
 * (Schema.org JSON-LD via cheerio), and returns a parsed recipe object.
 * Falls back to plain text extraction when no structured data is found.
 *
 * Used by the mobile app which cannot use DOMParser.
 * Auto-routed at /api/extract-recipe?url=...
 */

import * as cheerio from 'cheerio';

// ── Fraction normalization (same as web app) ──

const UNICODE_FRACTIONS = {
  '\u00BC': '1/4', '\u00BD': '1/2', '\u00BE': '3/4',
  '\u2153': '1/3', '\u2154': '2/3', '\u2155': '1/5',
  '\u2156': '2/5', '\u2157': '3/5', '\u2158': '4/5',
  '\u2159': '1/6', '\u215A': '5/6', '\u215B': '1/8',
  '\u215C': '3/8', '\u215D': '5/8', '\u215E': '7/8',
};

function normalizeFractions(text) {
  return text.replace(/(\d)?([¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (_, leading, ch) => {
    const frac = UNICODE_FRACTIONS[ch] || ch;
    return leading ? leading + ' ' + frac : frac;
  });
}

// ── Ingredient line parser (same as web app) ──

const MEASUREMENTS = [
  'cups?', 'c\\.', 'tbsps?', 'tablespoons?', 'tbs?\\.?',
  'tsps?', 'teaspoons?', 'ozs?\\.?', 'ounces?',
  'lbs?\\.?', 'pounds?', 'grams?', 'g\\.?', 'kgs?\\.?',
  'mls?\\.?', 'milliliters?', 'liters?',
  'pints?', 'quarts?', 'gallons?',
  'pinch(?:es)?', 'dash(?:es)?', 'cloves?', 'cans?',
  'packages?', 'pkgs?\\.?', 'pieces?', 'slices?',
  'sticks?', 'heads?', 'stalks?', 'sprigs?', 'handfuls?',
  'small', 'medium', 'large',
];

const QTY_PATTERN = /^(\d+\s*\/\s*\d+|\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?(?:\s+\d+\s*\/\s*\d+)?)\s*/;
const MEAS_PATTERN = new RegExp(`^(${MEASUREMENTS.join('|')})\\b\\.?\\s*`, 'i');

function parseIngredientLine(line) {
  let text = line.trim().replace(/^[-•*▪▸►]\s*/, '');
  let quantity = '';
  let measurement = '';
  const qtyMatch = text.match(QTY_PATTERN);
  if (qtyMatch) {
    quantity = qtyMatch[1].trim();
    text = text.slice(qtyMatch[0].length);
  }
  const measMatch = text.match(MEAS_PATTERN);
  if (measMatch) {
    measurement = measMatch[1].replace(/\.$/, '').trim();
    text = text.slice(measMatch[0].length);
  }
  text = text.replace(/^of\s+/i, '');
  return { quantity, measurement, ingredient: text.trim() };
}

// ── JSON-LD extraction via cheerio ──

function extractJsonLdRecipe($) {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      let data = JSON.parse($(scripts[i]).html());
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
        if (item['@type'] === 'HowToSection') {
          const heading = item.name ? `${item.name}\n` : '';
          const steps = (item.itemListElement || [])
            .map(s => s.text || s.name || '')
            .filter(Boolean)
            .join('\n');
          return heading + steps;
        }
        return item.text || item.name || '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(raw);
}

function normalizeServings(raw) {
  if (!raw) return '1';
  const str = Array.isArray(raw) ? raw[0] : String(raw);
  const match = str.match(/(\d+)/);
  return match ? match[1] : '1';
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

function titleCase(str) {
  if (!str || str !== str.toUpperCase()) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ── Handler ──

export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PrepDayMealPlanner/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Upstream returned ${response.status}` });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Try structured data first
    const ld = extractJsonLdRecipe($);
    if (ld) {
      return res.status(200).json({
        title: titleCase(ld.name || ''),
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
      });
    }

    // Fallback: strip HTML to plain text
    $('script, style, nav, footer, header, aside, .ad, .sidebar').remove();
    const text = $('body').text().replace(/[ \t]+/g, ' ').trim();

    // Return raw text for client-side parsing
    return res.status(200).json({
      title: '',
      description: '',
      category: 'lunch-dinner',
      frequency: 'common',
      mealType: '',
      servings: '1',
      prepTime: '',
      cookTime: '',
      sourceUrl: url,
      ingredients: [],
      instructions: '',
      rawText: text,
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
