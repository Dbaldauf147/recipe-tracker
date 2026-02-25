/**
 * Heuristic parser for pasted recipe text from websites, Instagram, TikTok, etc.
 * Returns { title, ingredients: [{ quantity, measurement, ingredient }], instructions }
 */

const UNICODE_FRACTIONS = {
  '\u00BC': '1/4', '\u00BD': '1/2', '\u00BE': '3/4',
  '\u2150': '1/7', '\u2151': '1/9', '\u2152': '1/10',
  '\u2153': '1/3', '\u2154': '2/3', '\u2155': '1/5',
  '\u2156': '2/5', '\u2157': '3/5', '\u2158': '4/5',
  '\u2159': '1/6', '\u215A': '5/6', '\u215B': '1/8',
  '\u215C': '3/8', '\u215D': '5/8', '\u215E': '7/8',
};

const MEASUREMENTS = [
  'cups?', 'c\\.', 'tbsps?', 'tablespoons?', 'tbs?\\.?',
  'tsps?', 'teaspoons?', 'ozs?\\.?', 'ounces?',
  'lbs?\\.?', 'pounds?', 'grams?', 'g\\.?', 'kgs?\\.?', 'kilograms?',
  'mls?\\.?', 'milliliters?', 'liters?', 'l\\.?',
  'pints?', 'pts?\\.?', 'quarts?', 'qts?\\.?', 'gallons?', 'gal\\.?',
  'pinch(?:es)?', 'dash(?:es)?', 'bunche?s?', 'cloves?', 'cans?',
  'packages?', 'pkgs?\\.?', 'pieces?', 'pcs?\\.?', 'slices?',
  'sticks?', 'heads?', 'stalks?', 'sprigs?', 'handfuls?',
  'small', 'medium', 'large',
];

const HEADING_INGREDIENTS = /^(?:ingredients|you(?:'ll)?\s+(?:need|will need)|what you(?:'ll)?\s+need)\s*:?\s*$/i;
const HEADING_INSTRUCTIONS = /^(?:instructions|directions|steps|method|preparation|how to(?: make(?: it)?)?)\s*:?\s*$/i;
const HEADING_ANY = /^(?:ingredients|you(?:'ll)?\s+(?:need|will need)|what you(?:'ll)?\s+need|instructions|directions|steps|method|preparation|how to(?: make(?: it)?)?|notes?|tips?|nutrition(?: info(?:rmation)?)?|equipment|tools|servings?|yield|source)\s*:?\s*$/i;

// Inline heading variants: "Ingredients:" at the start of a line with content after
const INLINE_HEADING_INGREDIENTS = /^(?:ingredients|you(?:'ll)?\s+(?:need|will need))\s*:\s*(.+)/i;
const INLINE_HEADING_INSTRUCTIONS = /^(?:instructions|directions|steps|method|preparation)\s*:\s*(.+)/i;

// Lines that look like social media commentary, not recipe titles
const COMMENTARY_PATTERN = /^(this|you|i |my |omg|best|wow|try|make|save|tag|share|follow|link|comment|dm|wait|stop|hear|trust)/i;

const QTY_PATTERN = /^(\d+\s*\/\s*\d+|\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?(?:\s+\d+\s*\/\s*\d+)?)\s*/;
const MEAS_PATTERN = new RegExp(`^(${MEASUREMENTS.join('|')})\\b\\.?\\s*`, 'i');

const HASHTAG_LINE = /^\s*#\w/;
const URL_LINE = /^\s*https?:\/\//i;
const DECORATIVE_LINE = /^[-=_*~]{3,}\s*$/;

// Common food words to help identify ingredient lines without quantities
const FOOD_WORDS = new Set([
  'salt', 'pepper', 'sugar', 'flour', 'butter', 'oil', 'olive', 'garlic', 'onion',
  'onions', 'tomato', 'tomatoes', 'cheese', 'cream', 'milk', 'egg', 'eggs', 'rice',
  'pasta', 'chicken', 'beef', 'pork', 'fish', 'salmon', 'shrimp', 'tofu', 'lemon',
  'lime', 'vinegar', 'soy', 'sauce', 'honey', 'mustard', 'mayo', 'mayonnaise',
  'basil', 'oregano', 'thyme', 'rosemary', 'cilantro', 'parsley', 'cumin',
  'paprika', 'cinnamon', 'ginger', 'turmeric', 'chili', 'cayenne', 'nutmeg',
  'vanilla', 'cocoa', 'chocolate', 'bread', 'tortilla', 'tortillas', 'noodles',
  'broccoli', 'spinach', 'kale', 'lettuce', 'avocado', 'cucumber', 'carrot',
  'carrots', 'celery', 'potato', 'potatoes', 'corn', 'beans', 'lentils',
  'chickpeas', 'quinoa', 'oats', 'yogurt', 'sour', 'cream cheese',
  'mozzarella', 'parmesan', 'cheddar', 'feta', 'bacon', 'ham', 'turkey',
  'mushroom', 'mushrooms', 'zucchini', 'eggplant', 'bell pepper', 'jalapeño',
  'coconut', 'almond', 'peanut', 'walnut', 'pecan', 'sesame', 'flaxseed',
  'chia', 'maple', 'agave', 'sriracha', 'ketchup', 'worcestershire',
  'balsamic', 'tahini', 'hummus', 'pesto', 'salsa', 'dressing',
  'water', 'broth', 'stock', 'wine', 'beer', 'juice', 'syrup',
]);

// Cooking verbs that signal instruction lines
const COOKING_VERBS = /^(preheat|heat|boil|simmer|sauté|saute|fry|bake|roast|grill|broil|steam|cook|stir|mix|combine|whisk|blend|fold|chop|dice|mince|slice|drain|rinse|season|add|pour|spread|place|set|let|allow|serve|garnish|top|toss|marinate|brush|coat|transfer|remove|flip|turn|cover|uncover|reduce|bring|cut|arrange|layer|stuff|roll|wrap|shape|form|knead|rest|cool|chill|freeze|thaw|melt|dissolve|soak|squeeze)\b/i;

// Numbered step pattern: "1." or "1)" or "Step 1:" etc.
const NUMBERED_STEP = /^(?:step\s*)?\d+[\.\):\-]\s*/i;

export function normalizeFractions(text) {
  return text.replace(/(\d)?([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (_, leading, ch) => {
    const frac = UNICODE_FRACTIONS[ch] || ch;
    return leading ? leading + ' ' + frac : frac;
  });
}

function hasQuantity(line) {
  return QTY_PATTERN.test(line.trim().replace(/^[-•*▪▸►🔸🔹]\s*/, ''));
}

function looksLikeIngredient(line) {
  const trimmed = line.trim().replace(/^[-•*▪▸►🔸🔹]\s*/, '');
  if (!trimmed) return false;

  // Has a quantity at the start (e.g., "2 cups flour")
  if (QTY_PATTERN.test(trimmed)) return true;

  // Short line containing known food words (e.g., "Salt and pepper to taste")
  if (trimmed.length <= 60) {
    const lower = trimmed.toLowerCase();
    // Check for "to taste", "as needed", "for garnish" patterns
    if (/\b(to taste|as needed|for (garnish|serving|topping|dipping))\b/i.test(lower)) return true;
    // Check if line contains food words and is short enough to be an ingredient
    const words = lower.split(/\s+/);
    if (words.length <= 8) {
      const foodCount = words.filter(w => FOOD_WORDS.has(w)).length;
      if (foodCount >= 1 && !COOKING_VERBS.test(trimmed)) return true;
    }
  }

  return false;
}

function looksLikeInstruction(line) {
  const trimmed = line.trim().replace(/^[-•*▪▸►🔸🔹]\s*/, '').replace(NUMBERED_STEP, '');
  if (!trimmed) return false;

  // Starts with a cooking verb
  if (COOKING_VERBS.test(trimmed)) return true;

  // Is a sentence (contains multiple words and ends with punctuation or is long)
  if (trimmed.length > 60) return true;
  if (/[.!]$/.test(trimmed) && trimmed.split(/\s+/).length >= 4) return true;

  // Has a numbered step prefix
  if (NUMBERED_STEP.test(line.trim())) return true;

  return false;
}

export function parseIngredientLine(line) {
  let text = line.trim();

  // Strip leading bullet/dash/emoji
  text = text.replace(/^[-•*▪▸►🔸🔹]\s*/, '');

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

  // Strip leading "of " after measurement
  text = text.replace(/^of\s+/i, '');

  return {
    quantity,
    measurement,
    ingredient: text.trim(),
  };
}

export function titleCase(str) {
  if (!str || str !== str.toUpperCase()) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

export function parseRecipeText(rawText) {
  if (!rawText || !rawText.trim()) {
    return { title: '', ingredients: [], instructions: '' };
  }

  const normalized = normalizeFractions(rawText);
  const lines = normalized
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => !DECORATIVE_LINE.test(l));

  // Detect section headings
  let ingredientsStart = -1;
  let instructionsStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (ingredientsStart === -1 && HEADING_INGREDIENTS.test(trimmed)) {
      ingredientsStart = i;
    } else if (instructionsStart === -1 && HEADING_INSTRUCTIONS.test(trimmed)) {
      instructionsStart = i;
    }
  }

  // Also check for inline headings (e.g., "Ingredients: 2 cups flour, 1 cup sugar")
  if (ingredientsStart === -1) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].trim().match(INLINE_HEADING_INGREDIENTS);
      if (match) {
        // Split inline content into separate lines and splice them in
        const inlineContent = match[1].split(/,\s*/).map(s => s.trim()).filter(Boolean);
        lines.splice(i, 1, 'Ingredients:', ...inlineContent);
        ingredientsStart = i;
        break;
      }
    }
  }

  if (instructionsStart === -1) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].trim().match(INLINE_HEADING_INSTRUCTIONS);
      if (match) {
        const inlineContent = match[1];
        lines.splice(i, 1, 'Instructions:', inlineContent);
        instructionsStart = i;
        break;
      }
    }
  }

  const hasHeadings = ingredientsStart !== -1 || instructionsStart !== -1;

  let title = '';
  const ingredients = [];
  let instructions = '';

  if (hasHeadings) {
    // ── Structured recipe (has section headings) ──
    const firstHeading = Math.min(
      ingredientsStart !== -1 ? ingredientsStart : Infinity,
      instructionsStart !== -1 ? instructionsStart : Infinity
    );
    // Find title: prefer non-commentary lines; fall back to first significant line
    let titleFallback = '';
    for (let i = 0; i < firstHeading; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || URL_LINE.test(trimmed) || HASHTAG_LINE.test(trimmed) || HEADING_ANY.test(trimmed)) continue;
      const cleaned = trimmed.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
      if (!titleFallback) titleFallback = trimmed;
      // Skip commentary lines
      if (COMMENTARY_PATTERN.test(cleaned) && cleaned.length > 20) continue;
      title = trimmed;
      break;
    }
    if (!title) title = titleFallback;

    // Ingredients: lines between ingredients heading and next section
    if (ingredientsStart !== -1) {
      let end;
      if (instructionsStart !== -1 && instructionsStart > ingredientsStart) {
        end = instructionsStart;
      } else if (instructionsStart !== -1) {
        end = findNextHeading(lines, ingredientsStart + 1);
      } else {
        // No instructions heading — stop at first blank line followed by non-ingredient content
        end = lines.length;
        for (let i = ingredientsStart + 1; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (HEADING_ANY.test(trimmed)) { end = i; break; }
          if (!trimmed) {
            // Check if content after blank line looks like instructions, not ingredients
            let nextContentIsIngredient = false;
            for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
              const next = lines[j].trim();
              if (!next) continue;
              if ((hasQuantity(next) || looksLikeIngredient(next)) && !looksLikeInstruction(next)) {
                nextContentIsIngredient = true;
              }
              break;
            }
            if (!nextContentIsIngredient) { end = i; break; }
          }
        }
      }
      for (let i = ingredientsStart + 1; i < end; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed || HASHTAG_LINE.test(trimmed) || URL_LINE.test(trimmed)) continue;
        if (HEADING_ANY.test(trimmed)) break;
        ingredients.push(parseIngredientLine(trimmed));
      }
    }

    // Instructions: lines after instructions heading
    if (instructionsStart !== -1) {
      const instrLines = [];
      for (let i = instructionsStart + 1; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (HEADING_ANY.test(trimmed)) break;
        if (HASHTAG_LINE.test(trimmed)) continue;
        instrLines.push(lines[i]);
      }
      instructions = instrLines.join('\n').trim();
    } else if (ingredientsStart !== -1) {
      // Has ingredients heading but no instructions heading —
      // Find where ingredients end (first blank line or non-ingredient after them)
      // then collect everything after as instructions
      let ingredientsEnd = ingredientsStart + 1;
      for (let i = ingredientsStart + 1; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (HEADING_ANY.test(trimmed)) break;
        if (!trimmed) {
          // Blank line — check if there's more ingredient-like content after
          let hasMoreIngredients = false;
          for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
            const next = lines[j].trim();
            if (next && (hasQuantity(next) || looksLikeIngredient(next)) && !looksLikeInstruction(next)) {
              hasMoreIngredients = true;
              break;
            }
          }
          if (!hasMoreIngredients) { ingredientsEnd = i; break; }
        }
        ingredientsEnd = i + 1;
      }

      const instrLines = [];
      for (let i = ingredientsEnd; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (HEADING_ANY.test(trimmed)) continue;
        if (HASHTAG_LINE.test(trimmed)) continue;
        if (!trimmed && instrLines.length === 0) continue; // skip leading blanks
        instrLines.push(lines[i]);
      }
      const joined = instrLines.join('\n').trim();
      if (joined) instructions = joined;
    }
  } else {
    // ── Freeform text (Instagram/TikTok style, no headings) ──
    // Use smarter classification for each line

    const classified = lines.map((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) return { line, type: 'blank', i };
      if (URL_LINE.test(trimmed)) return { line, type: 'skip', i };
      if (HASHTAG_LINE.test(trimmed)) return { line, type: 'skip', i };
      return { line, type: 'unknown', i };
    });

    // Find title: first non-blank line that looks like a short recipe name
    // Skip commentary lines (common in social media captions)
    let titleIndex = -1;
    for (const item of classified) {
      if (item.type !== 'unknown') continue;
      const trimmed = item.line.trim();
      const cleaned = trimmed.replace(/^[-•*▪▸►🔸🔹]\s*/, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
      // Skip lines that are clearly ingredients or instructions
      if (hasQuantity(trimmed)) continue;
      if (COOKING_VERBS.test(cleaned)) continue;
      if (NUMBERED_STEP.test(trimmed)) continue;
      // Title should be relatively short
      if (cleaned.length > 80) continue;
      // Skip social media commentary lines
      if (COMMENTARY_PATTERN.test(cleaned) && cleaned.length > 30) continue;
      // Accept first short, non-sentence line as title
      title = trimmed.replace(/^[-•*▪▸►🔸🔹]\s*/, '');
      titleIndex = item.i;
      break;
    }

    // Classify remaining lines as ingredient or instruction
    // Strategy: look for clusters. If we see consecutive ingredient-like lines,
    // they're probably ingredients. Same for instructions.
    for (const item of classified) {
      if (item.type !== 'unknown' || item.i === titleIndex) continue;
      const trimmed = item.line.trim();

      if (looksLikeIngredient(trimmed) && !looksLikeInstruction(trimmed)) {
        item.type = 'ingredient';
      } else if (looksLikeInstruction(trimmed)) {
        item.type = 'instruction';
      } else {
        // Ambiguous — decide based on context (neighbors)
        item.type = 'ambiguous';
      }
    }

    // Resolve ambiguous lines based on their neighbors
    for (let i = 0; i < classified.length; i++) {
      if (classified[i].type !== 'ambiguous') continue;

      // Look at the nearest non-blank classified neighbor
      let prevType = null;
      let nextType = null;
      for (let j = i - 1; j >= 0; j--) {
        if (classified[j].type === 'ingredient' || classified[j].type === 'instruction') {
          prevType = classified[j].type;
          break;
        }
        if (classified[j].type === 'blank') break;
      }
      for (let j = i + 1; j < classified.length; j++) {
        if (classified[j].type === 'ingredient' || classified[j].type === 'instruction') {
          nextType = classified[j].type;
          break;
        }
        if (classified[j].type === 'blank') break;
      }

      if (prevType && prevType === nextType) {
        classified[i].type = prevType;
      } else if (prevType) {
        classified[i].type = prevType;
      } else if (nextType) {
        classified[i].type = nextType;
      } else {
        // Default: short lines → ingredient, long lines → instruction
        const trimmed = classified[i].line.trim();
        classified[i].type = trimmed.length <= 40 ? 'ingredient' : 'instruction';
      }
    }

    // Collect ingredients and instructions
    const instrLines = [];
    for (const item of classified) {
      if (item.i === titleIndex) continue;
      if (item.type === 'ingredient') {
        ingredients.push(parseIngredientLine(item.line));
      } else if (item.type === 'instruction') {
        instrLines.push(item.line);
      }
    }
    instructions = instrLines.join('\n').trim();
  }

  // Clean up instruction step numbering for consistency
  if (instructions) {
    instructions = instructions
      .split('\n')
      .map(l => l.replace(/^(?:step\s*)?\d+[\.\):\-]\s*/i, '').trimStart() || l)
      .join('\n');
  }

  return { title: titleCase(title), ingredients, instructions };
}

function findNextHeading(lines, startAfter) {
  for (let i = startAfter; i < lines.length; i++) {
    if (HEADING_ANY.test(lines[i].trim())) return i;
  }
  return lines.length;
}
