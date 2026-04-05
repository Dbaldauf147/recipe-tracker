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

// Promo / spam / social media CTA lines to strip entirely
const PROMO_PATTERN = /\b(comment\s+["'"].+["'"]|i['']ll\s+dm\s+you|dm\s+(me|you)|link\s+in\s+(bio|my\s+bio|profile|description)|follow\s+(me|for\s+more|@)|subscribe|cookbook\s+with\s+\d+|save\s+this\s+(post|recipe|reel|video)|tag\s+(a\s+friend|someone)|share\s+this|turn\s+on\s+(post\s+)?notifications|check\s+out\s+my|swipe\s+(left|right|up)|tap\s+the\s+link|join\s+my|sign\s+up|free\s+(ebook|guide|download|pdf)|grab\s+(my|the|your)\s+(free|ebook|guide|cookbook)|double\s+tap|drop\s+a|leave\s+a\s+comment|limited\s+time|discount\s+code|use\s+code|promo\s+code|affiliate|sponsored|paid\s+partnership|#ad\b|click\s+the\s+link|get\s+the\s+full\s+recipe\s+in\s+my|full\s+recipe\s+on\s+my|recipes?\s+just\s+like\s+this)\b/i;

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

// Words/phrases in parentheses that are cooking instructions (not ingredient descriptors)
const INSTRUCTION_PARENS = /\b(drained|rinsed|diced|chopped|minced|sliced|cubed|crushed|grated|shredded|mashed|melted|softened|thawed|halved|quartered|julienned|peeled|seeded|deveined|trimmed|divided|packed|sifted|beaten|whisked|room temperature|at room temp|to taste|for garnish|for serving|for topping|optional|or more|or less|plus more|if desired|see note|adjusted|as needed|patted dry|cut into|torn into|broken into|squeezed|zested|juiced)\b/i;

// Embedded measurement pattern: finds "N unit" inside ingredient name (e.g., "4 ounce chicken breast")
const EMBEDDED_MEAS = new RegExp(
  `(\\d+(?:\\.\\d+)?(?:\\s*-\\s*\\d+(?:\\.\\d+)?)?)\\s*[-–]?\\s*(${MEASUREMENTS.join('|')})\\b\\.?\\s+`,
  'i'
);

export function parseIngredientLine(line) {
  let text = line.trim();

  // Strip leading bullet/dash/emoji and hashtags
  text = text.replace(/^[-•*▪▸►🔸🔹]\s*/, '');
  text = text.replace(/#\w+/g, '').trim();
  // Skip lines that are only symbols, hashtags, or emojis
  if (!text || /^[^a-zA-Z0-9]*$/.test(text)) return null;

  let quantity = '';
  let measurement = '';
  const tips = [];

  // Extract parenthetical content
  const parenParts = [];
  text = text.replace(/\(([^)]+)\)/g, (match, inner) => {
    const trimmedInner = inner.trim();
    // Check if the content contains cooking instructions
    if (INSTRUCTION_PARENS.test(trimmedInner)) {
      tips.push(trimmedInner);
      return '';
    }
    // Check if it contains a measurement amount (e.g., "(4 ounce)")
    const measInParen = trimmedInner.match(EMBEDDED_MEAS);
    if (measInParen) {
      // If we don't have a quantity yet, use this as the measurement
      if (!quantity) {
        quantity = measInParen[1].trim();
        measurement = measInParen[2].replace(/\.$/, '').trim();
      }
      // Remaining text after the measurement in the paren
      const remainder = trimmedInner.slice(measInParen[0].length).trim();
      if (remainder) tips.push(remainder);
      return '';
    }
    // Check if it's just a number + unit (e.g., "(15 oz)")
    const simpleQtyMeas = trimmedInner.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(${MEASUREMENTS.join('|')})\\b\\.?\\s*$`, 'i'));
    if (simpleQtyMeas) {
      if (!quantity) {
        quantity = simpleQtyMeas[1].trim();
        measurement = simpleQtyMeas[2].replace(/\.$/, '').trim();
      }
      return '';
    }
    // Keep other parenthetical content (ingredient descriptors like "(red)" or "(boneless)")
    return match;
  });

  text = text.replace(/\s{2,}/g, ' ').trim();

  // Now parse leading quantity
  const qtyMatch = text.match(QTY_PATTERN);
  if (qtyMatch) {
    // Only override if we didn't already get quantity from parens
    if (!quantity) {
      quantity = qtyMatch[1].trim();
    }
    text = text.slice(qtyMatch[0].length);
  }

  const measMatch = text.match(MEAS_PATTERN);
  if (measMatch) {
    if (!measurement) {
      measurement = measMatch[1].replace(/\.$/, '').trim();
    }
    text = text.slice(measMatch[0].length);
  }

  // Strip leading "of " after measurement
  text = text.replace(/^of\s+/i, '');

  // Check for embedded measurements still in the ingredient name
  // e.g., "chicken breast 4 ounce" or "4 ounce chicken breast" (when qty already extracted)
  if (!measurement) {
    const embeddedMatch = text.match(EMBEDDED_MEAS);
    if (embeddedMatch) {
      if (!quantity) quantity = embeddedMatch[1].trim();
      measurement = embeddedMatch[2].replace(/\.$/, '').trim();
      text = text.replace(EMBEDDED_MEAS, ' ').trim();
    }
  }

  // Clean up comma-separated instructions at end (e.g., "chicken breast, diced and seasoned")
  const commaInstr = text.match(/,\s*(.+)$/);
  if (commaInstr) {
    const afterComma = commaInstr[1].trim();
    if (INSTRUCTION_PARENS.test(afterComma) && afterComma.split(/\s+/).length <= 6) {
      tips.push(afterComma);
      text = text.slice(0, commaInstr.index).trim();
    }
  }

  const result = {
    quantity,
    measurement,
    ingredient: text.trim(),
  };

  if (tips.length > 0) {
    result.notes = tips.join('; ');
  }

  return result;
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

  // Pre-process: split inline bullet/emoji items into separate lines
  // e.g. "▪️2 Eggs▪️Salt & Pepper▪️Avocado" → one per line
  // Also split numbered emoji steps: "1️⃣ Step one 2️⃣ Step two" → one per line
  let preprocessed = normalized
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  // Split on bullet emojis (▪ with optional variation selector ️) followed by text
  preprocessed = preprocessed.replace(/([^\n])\s*[▪▸►🔸🔹][\uFE0E\uFE0F]?\s*/g, '$1\n');
  preprocessed = preprocessed.replace(/^[▪▸►🔸🔹][\uFE0E\uFE0F]?\s*/gm, '');
  // Split on numbered emoji steps (1️⃣, 2️⃣, etc.) that are inline
  preprocessed = preprocessed.replace(/([^\n])\s*([1-9]\uFE0F?\u20E3)/g, '$1\n$2');

  const lines = preprocessed
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.trim() !== '')  // Remove blank lines
    .filter(l => !DECORATIVE_LINE.test(l))
    .filter(l => !PROMO_PATTERN.test(l));  // Remove promo/spam lines

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
        const parsed = parseIngredientLine(trimmed);
        if (parsed) ingredients.push(parsed);
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
        const parsed = parseIngredientLine(item.line);
        if (parsed) ingredients.push(parsed);
      } else if (item.type === 'instruction') {
        instrLines.push(item.line);
      }
    }
    instructions = instrLines.join('\n').trim();
  }

  // Split inline numbered steps and clean up numbering for consistency
  if (instructions) {
    // Split "... sentence. 2. Next step..." into separate lines
    instructions = instructions.replace(/\.\s+(\d+[\.\):])\s+/g, '.\n$1 ');
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
