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

const HEADING_INGREDIENTS = /^ingredients\s*:?$/i;
const HEADING_INSTRUCTIONS = /^(?:instructions|directions|steps|method|preparation|how to make(?: it)?)\s*:?$/i;
const HEADING_ANY = /^(?:ingredients|instructions|directions|steps|method|preparation|how to make(?: it)?|notes?|tips?|nutrition(?: info(?:rmation)?)?|equipment|tools|servings?|yield|source)\s*:?$/i;

const QTY_PATTERN = /^(\d+\s*\/\s*\d+|\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?(?:\s+\d+\s*\/\s*\d+)?)\s*/;
const MEAS_PATTERN = new RegExp(`^(${MEASUREMENTS.join('|')})\\b\\.?\\s*`, 'i');

const HASHTAG_LINE = /^\s*#\w/;
const URL_LINE = /^\s*https?:\/\//i;
const DECORATIVE_LINE = /^[-=_*~]{3,}\s*$/;

function normalizeFractions(text) {
  // Insert a space before the fraction if preceded by a digit (e.g. 1½ → 1 1/2)
  return text.replace(/(\d)?([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (_, leading, ch) => {
    const frac = UNICODE_FRACTIONS[ch] || ch;
    return leading ? leading + ' ' + frac : frac;
  });
}

function isIngredientLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return QTY_PATTERN.test(trimmed);
}

function parseIngredientLine(line) {
  let text = line.trim();

  // Strip leading bullet/dash
  text = text.replace(/^[-•*▪▸►]\s*/, '');

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

  const hasHeadings = ingredientsStart !== -1 || instructionsStart !== -1;

  let title = '';
  const ingredients = [];
  let instructions = '';

  if (hasHeadings) {
    // ── Structured recipe (has section headings) ──

    // Title: first significant line before any heading
    const firstHeading = Math.min(
      ingredientsStart !== -1 ? ingredientsStart : Infinity,
      instructionsStart !== -1 ? instructionsStart : Infinity
    );
    for (let i = 0; i < firstHeading; i++) {
      const trimmed = lines[i].trim();
      if (trimmed && !URL_LINE.test(trimmed) && !HASHTAG_LINE.test(trimmed) && !HEADING_ANY.test(trimmed)) {
        title = trimmed;
        break;
      }
    }

    // Ingredients: lines between ingredients heading and next heading (or instructions heading)
    if (ingredientsStart !== -1) {
      const end = instructionsStart !== -1 && instructionsStart > ingredientsStart
        ? instructionsStart
        : findNextHeading(lines, ingredientsStart + 1);
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
    }
  } else {
    // ── Freeform text (Instagram/TikTok style, no headings) ──

    const ingredientLineIndices = new Set();
    let titleIndex = -1;

    // Find title: first non-blank line that isn't an ingredient, URL, or hashtag
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      if (URL_LINE.test(trimmed) || HASHTAG_LINE.test(trimmed)) continue;
      if (isIngredientLine(trimmed)) continue;
      title = trimmed;
      titleIndex = i;
      break;
    }

    // Collect ingredient lines
    for (let i = 0; i < lines.length; i++) {
      if (i === titleIndex) continue;
      const trimmed = lines[i].trim();
      if (!trimmed || URL_LINE.test(trimmed) || HASHTAG_LINE.test(trimmed)) continue;
      if (isIngredientLine(trimmed)) {
        ingredients.push(parseIngredientLine(trimmed));
        ingredientLineIndices.add(i);
      }
    }

    // Instructions: remaining non-title, non-ingredient, non-hashtag lines
    const instrLines = [];
    for (let i = 0; i < lines.length; i++) {
      if (i === titleIndex) continue;
      if (ingredientLineIndices.has(i)) continue;
      const trimmed = lines[i].trim();
      if (HASHTAG_LINE.test(trimmed) || URL_LINE.test(trimmed)) continue;
      instrLines.push(lines[i]);
    }
    instructions = instrLines.join('\n').trim();
  }

  return { title, ingredients, instructions };
}

function findNextHeading(lines, startAfter) {
  for (let i = startAfter; i < lines.length; i++) {
    if (HEADING_ANY.test(lines[i].trim())) return i;
  }
  return lines.length;
}
