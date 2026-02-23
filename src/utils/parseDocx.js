import { parseIngredientLine } from './parseRecipeText.js';

/**
 * Parse a .docx File into an array of recipe objects.
 * Uses mammoth for docx → HTML conversion, then DOMParser for structure extraction.
 *
 * Expected document format:
 *   Heading (h1-h3) = recipe title
 *   <ul>/<ol> = ingredients
 *   <p> after ingredients = instructions
 */
export async function parseDocxRecipes(file) {
  // Dynamic import for code-splitting (~200KB)
  const mammoth = await import('mammoth/mammoth.browser');

  const arrayBuffer = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const elements = Array.from(doc.body.children);

  const recipes = [];
  let current = null;

  for (const el of elements) {
    const tag = el.tagName.toLowerCase();

    // Headings mark recipe boundaries
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      if (current && (current.ingredients.length > 0 || current.instructions)) {
        recipes.push(current);
      }
      current = {
        title: el.textContent.trim(),
        description: '',
        servings: '',
        ingredients: [],
        instructions: '',
      };
      continue;
    }

    if (!current) continue;

    // Lists → ingredients
    if (tag === 'ul' || tag === 'ol') {
      const items = el.querySelectorAll('li');
      for (const li of items) {
        const text = li.textContent.trim();
        if (text) {
          current.ingredients.push(parseIngredientLine(text));
        }
      }
      continue;
    }

    // Paragraphs after ingredients → instructions
    if (tag === 'p') {
      const text = el.textContent.trim();
      if (!text) continue;

      // If we haven't collected any ingredients yet, check if paragraph looks like an ingredient
      if (current.ingredients.length === 0 && !current.instructions) {
        // Just accumulate as description for now
        continue;
      }

      // Otherwise it's an instruction paragraph
      current.instructions += (current.instructions ? '\n' : '') + text;
    }
  }

  // Don't forget the last recipe
  if (current && (current.ingredients.length > 0 || current.instructions)) {
    recipes.push(current);
  }

  return recipes;
}
