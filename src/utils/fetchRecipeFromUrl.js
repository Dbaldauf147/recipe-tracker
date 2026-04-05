/**
 * Fetches a recipe from a URL via server-side proxy, extracts structured data
 * (Schema.org JSON-LD), and returns a recipe object matching the app's shape.
 * Falls back to plain-text parsing when no structured data is found.
 */

import { parseRecipeText, titleCase } from './parseRecipeText';
import { normalizeFractions, parseIngredientLine } from './parseRecipeText';

// ── Server-side proxy (Vite dev middleware + Netlify function in prod) ──

async function fetchHtml(url) {
  const res = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const body = await res.text();
    let message = 'Could not fetch the URL.';
    try { message = JSON.parse(body).error || message; } catch {}
    throw new Error(message);
  }
  return await res.text();
}

// ── JSON-LD extraction ──

function isRecipeType(item) {
  return item['@type'] === 'Recipe' || (Array.isArray(item['@type']) && item['@type'].includes('Recipe'));
}

function extractJsonLdRecipe(html) {
  const all = extractAllJsonLdRecipes(html);
  return all.length > 0 ? all[0] : null;
}

function extractAllJsonLdRecipes(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  const recipes = [];

  for (const script of scripts) {
    try {
      let data = JSON.parse(script.textContent);
      if (data['@graph']) data = data['@graph'];
      if (Array.isArray(data)) {
        for (const item of data) {
          if (isRecipeType(item)) recipes.push(item);
        }
      } else if (isRecipeType(data)) {
        recipes.push(data);
      }
    } catch {}
  }
  return recipes;
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

// Try to extract multiple recipes from HTML by finding recipe sections
function extractMultipleRecipesFromHtml(html, pageUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, nav, footer, header, aside, .ad, .sidebar').forEach(el => el.remove());

  // Get the full text content split by headings
  const headings = [...doc.querySelectorAll('h2, h3, h4')];
  const recipeSections = [];

  // Also try splitting the full body text by recipe-like titles
  const bodyText = (doc.body?.textContent || '');

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const title = (heading.textContent || '').trim();
    // Skip non-recipe headings
    if (title.length < 5 || title.length > 100) continue;
    if (/^(comment|related|share|pin|more|about|tag|categor|newsletter|subscribe|search|archives|freezer meal prep|stock your|pin these|ingredients to add|at time of cooking)/i.test(title)) continue;

    // Collect ALL text content between this heading and the next heading of same or higher level
    let content = '';
    let el = heading.nextElementSibling;
    const headingLevel = parseInt(heading.tagName[1]);
    while (el) {
      if (/^H[1-6]$/.test(el.tagName)) {
        const elLevel = parseInt(el.tagName[1]);
        // Stop at same level or higher headings, but continue past sub-headings
        if (elLevel <= headingLevel) break;
      }
      content += el.textContent + '\n';
      el = el.nextElementSibling;
    }

    // If we didn't get much from siblings, try walking up to parent and getting all descendant text
    if (content.trim().length < 50) {
      const parent = heading.parentElement;
      if (parent) {
        let found = false;
        for (const child of parent.children) {
          if (child === heading) { found = true; continue; }
          if (found) {
            if (/^H[1-6]$/.test(child.tagName) && parseInt(child.tagName[1]) <= headingLevel) break;
            content += child.textContent + '\n';
          }
        }
      }
    }

    // Check if this section has ingredient-like content
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const ingredientLines = lines.filter(l =>
      /^\d|^½|^¼|^¾|^⅓|^⅔|^⅛|^\.\d/.test(l) ||
      /\b(cups?|tbsp|tsp|oz|pounds?|lbs?|teaspoons?|tablespoons?|ounces?|cloves?|cans?|inch|stalks?|medium|large|small|minced|diced|sliced)\b/i.test(l)
    );

    if (ingredientLines.length >= 2) {
      const ingredients = ingredientLines.map(line => parseIngredientLine(normalizeFractions(line))).filter(i => i.ingredient);
      const instructionLines = lines.filter(l => !ingredientLines.includes(l) && l.length > 20);
      if (ingredients.length >= 2) {
        recipeSections.push({
          title: titleCase(title),
          description: '',
          category: 'lunch-dinner',
          frequency: 'common',
          mealType: '',
          servings: '1',
          prepTime: '',
          cookTime: '',
          sourceUrl: pageUrl,
          ingredients,
          instructions: instructionLines.join('\n'),
        });
      }
    }
  }

  return recipeSections;
}

// ── Main export ──

function ldToRecipe(ld, url) {
  return {
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
  };
}

/**
 * Fetch ALL recipes from a URL. Returns an array.
 * If only one recipe is found, array has one item.
 */
// Extract recipe cards from WordPress Recipe Maker (WPRM) or similar plugins
function extractRecipeCardsFromHtml(html, pageUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const recipes = [];

  // WPRM recipe containers
  const wprmCards = doc.querySelectorAll('.wprm-recipe-container, .wprm-recipe');
  for (const card of wprmCards) {
    const title = card.querySelector('.wprm-recipe-name')?.textContent?.trim();
    const ingredients = [...(card.querySelectorAll('.wprm-recipe-ingredient') || [])].map(el => {
      const amt = el.querySelector('.wprm-recipe-ingredient-amount')?.textContent?.trim() || '';
      const unit = el.querySelector('.wprm-recipe-ingredient-unit')?.textContent?.trim() || '';
      const name = el.querySelector('.wprm-recipe-ingredient-name')?.textContent?.trim() || '';
      return parseIngredientLine(normalizeFractions(`${amt} ${unit} ${name}`.trim()));
    }).filter(i => i.ingredient);
    const instructions = [...(card.querySelectorAll('.wprm-recipe-instruction-text, .wprm-recipe-instruction') || [])].map(el => el.textContent?.trim()).filter(Boolean).join('\n');
    const servings = card.querySelector('.wprm-recipe-servings')?.textContent?.trim() || '1';
    const prepTime = card.querySelector('.wprm-recipe-prep_time-container')?.textContent?.trim() || '';
    const cookTime = card.querySelector('.wprm-recipe-cook_time-container')?.textContent?.trim() || '';
    if (title && ingredients.length > 0) {
      recipes.push({ title: titleCase(title), description: '', category: 'lunch-dinner', frequency: 'common', mealType: '', servings, prepTime, cookTime, sourceUrl: pageUrl, ingredients, instructions });
    }
  }

  // Tasty Recipes plugin
  if (recipes.length === 0) {
    const tastyCards = doc.querySelectorAll('.tasty-recipes');
    for (const card of tastyCards) {
      const title = card.querySelector('.tasty-recipes-title, h2')?.textContent?.trim();
      const ingredients = [...(card.querySelectorAll('.tasty-recipes-ingredients li, .tasty-recipe-ingredients li') || [])].map(el => parseIngredientLine(normalizeFractions(el.textContent?.trim() || ''))).filter(i => i.ingredient);
      const instructions = [...(card.querySelectorAll('.tasty-recipes-instructions li, .tasty-recipe-instructions li') || [])].map(el => el.textContent?.trim()).filter(Boolean).join('\n');
      if (title && ingredients.length > 0) {
        recipes.push({ title: titleCase(title), description: '', category: 'lunch-dinner', frequency: 'common', mealType: '', servings: '1', prepTime: '', cookTime: '', sourceUrl: pageUrl, ingredients, instructions });
      }
    }
  }

  // Generic recipe card patterns
  if (recipes.length === 0) {
    const genericCards = doc.querySelectorAll('[class*="recipe-card"], [class*="recipe_card"], [class*="easyrecipe"], .recipe');
    for (const card of genericCards) {
      const title = card.querySelector('h2, h3, [class*="title"]')?.textContent?.trim();
      const ings = [...(card.querySelectorAll('li') || [])].map(el => el.textContent?.trim()).filter(Boolean);
      const ingredients = ings.slice(0, Math.min(ings.length, 30)).map(line => parseIngredientLine(normalizeFractions(line))).filter(i => i.ingredient);
      if (title && ingredients.length > 2) {
        recipes.push({ title: titleCase(title), description: '', category: 'lunch-dinner', frequency: 'common', mealType: '', servings: '1', prepTime: '', cookTime: '', sourceUrl: pageUrl, ingredients, instructions: '' });
      }
    }
  }

  return recipes;
}

export async function fetchAllRecipesFromUrl(url) {
  const html = await fetchHtml(url);
  const ldRecipes = extractAllJsonLdRecipes(html);

  if (ldRecipes.length > 0) {
    return ldRecipes.map(ld => ldToRecipe(ld, url));
  }

  // Try HTML recipe card extraction (WPRM, Tasty Recipes, etc.)
  const cardRecipes = extractRecipeCardsFromHtml(html, url);
  if (cardRecipes.length > 0) {
    return cardRecipes;
  }

  // Try extracting multiple recipes from heading sections
  const sectionRecipes = extractMultipleRecipesFromHtml(html, url);

  // Fallback: plain text — try to split into multiple recipes
  const text = htmlToPlainText(html);
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  // Detect recipe titles: lines that look like food dish names
  // Must NOT be instructional phrases, sub-headings, or navigation text
  const NON_TITLE = /^(ingredient|at time|add to|thawed|salt and|comment|pin |share|related|more from|prep tip|stock your|freezer meal|minnesota|high-protein|simple dinner|spinach and|sweet potato|how to|what is|why |when |where |tip:|note:|step |instructions|directions|serve |garnish|nutrition|calories)/i;

  const titleCandidates = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Title-like: proper length, starts capitalized, looks like a dish name
    const wordCount = line.split(/\s+/).length;
    if (line.length >= 10 && line.length <= 60 && wordCount >= 3 && wordCount <= 8 &&
        !/^\d/.test(line) && /[A-Z]/.test(line[0]) &&
        !NON_TITLE.test(line) &&
        !/\b(cups?|tbsp|tsp|oz|pounds?|lbs?|teaspoons?|tablespoons?|ounces?|cans?)\b/i.test(line)) {
      // Check if ingredient lines follow within 20 lines
      let ingredientCount = 0;
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        if (/^\d|^½|^¼|^¾/.test(lines[j]) || /\b(cups?|tbsp|tsp|oz|pounds?|lbs?|teaspoons?|tablespoons?|ounces?|cans?|cloves?|stalks?|medium)\b/i.test(lines[j])) {
          ingredientCount++;
        }
      }
      if (ingredientCount >= 3) titleCandidates.push({ title: line, lineIndex: i });
    }
  }

  // If we found multiple title candidates, split into recipes
  if (titleCandidates.length >= 2) {
    const recipes = [];
    for (let t = 0; t < titleCandidates.length; t++) {
      const startLine = titleCandidates[t].lineIndex + 1;
      const endLine = t + 1 < titleCandidates.length ? titleCandidates[t + 1].lineIndex : lines.length;
      const sectionLines = lines.slice(startLine, endLine);
      const ingredientLines = sectionLines.filter(l =>
        /^\d|^½|^¼|^¾|^⅓|^⅔|^⅛/.test(l) ||
        /\b(cups?|tbsp|tsp|oz|pounds?|lbs?|teaspoons?|tablespoons?|ounces?|cans?|cloves?|stalks?|medium|large|small|minced|diced)\b/i.test(l)
      );
      const ingredients = ingredientLines.map(line => parseIngredientLine(normalizeFractions(line))).filter(i => i.ingredient);
      const instructionLines = sectionLines.filter(l => !ingredientLines.includes(l) && l.length > 25);
      if (ingredients.length >= 3) {
        recipes.push({
          title: titleCase(titleCandidates[t].title),
          description: '',
          category: 'lunch-dinner',
          frequency: 'common',
          mealType: '',
          servings: '1',
          prepTime: '',
          cookTime: '',
          sourceUrl: url,
          ingredients,
          instructions: instructionLines.join('\n'),
        });
      }
    }
    if (recipes.length > 0) {
      // Use whichever method found more recipes
      if (recipes.length >= sectionRecipes.length) return recipes;
    }
  }

  // Use heading-based results if we found any
  if (sectionRecipes.length > 0) return sectionRecipes;

  // Final fallback: single recipe
  const parsed = parseRecipeText(text);
  if (parsed.title || parsed.ingredients.length > 0) {
    return [{
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
    }];
  }
  return [];
}

export async function fetchRecipeFromUrl(url) {
  const all = await fetchAllRecipesFromUrl(url);
  return all[0] || {
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
  };
}
