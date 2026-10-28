// Which of USDA's search results best fits the ingredient you typed. Lower
// score = better. Used by nutrition.js's fetchFromUSDA.
//
// Words are compared WHOLE: USDA ranks "Butter, salted" above "Salt, table"
// for "salt", and a substring check ("salt" in "salted") kept the butter on
// top. A description whose leading part (before the first comma — USDA puts
// the food itself there: "Salt, table", "Milk, whole") is what you typed gets
// the biggest pull.
import { nameWords } from './sheetMatch.js';

export const PENALTY_WORDS = [
  'cookie', 'cookies', 'cake', 'bread', 'muffin', 'pie', 'sauce',
  'soup', 'stew', 'casserole', 'mix', 'prepared', 'frozen', 'canned',
  'restaurant', 'fast food', 'infant', 'baby', 'formula',
];

const sameWords = (a, b) => a.length === b.length && a.every((w, i) => w === b[i]);
const startsWith = (a, b) => b.length > 0 && b.length <= a.length && b.every((w, i) => a[i] === w);

export function scoreUsdaMatch(food, searchTerm, rank = 0) {
  const desc = (food.description || '').toLowerCase();
  const descWords = nameWords(desc);
  const descSet = new Set(descWords);
  const searchWords = nameWords(searchTerm);
  const lead = nameWords(desc.split(',')[0]);
  // A penalty word only counts when you didn't ask for it ("pumpkin pie
  // spice" shouldn't be marked down for "pie").
  const searchSet = new Set(searchWords);

  let score = 0;
  // Every word you typed that's missing costs more than a hit earns, so
  // "Pumpkin, raw" can't beat "Spices, pumpkin pie spice" on its short name.
  for (const word of searchWords) {
    score += descSet.has(word) ? -10 : 15;
  }
  if (sameWords(lead, searchWords)) score -= 30;
  else if (startsWith(searchWords, lead) || startsWith(lead, searchWords)) score -= 15;
  score += desc.length * 0.1;
  if (food.dataType === 'Foundation') score -= 20;
  if (food.dataType === 'SR Legacy') score -= 15;
  for (const word of PENALTY_WORDS) {
    const w = nameWords(word);
    if (w.every(x => searchSet.has(x))) continue;
    if (w.length === 1 ? descSet.has(w[0]) : desc.includes(word)) score += 25;
  }
  if (descSet.has('raw')) score -= 5;
  // USDA's own relevance order, as a light tiebreak between near-equals.
  score += rank * 0.5;
  return score;
}

/** The best-scoring food of a USDA result list, or null when it's empty. */
export function pickUsdaFood(foods, searchTerm) {
  if (!foods || foods.length === 0) return null;
  return foods
    .map((food, i) => ({ food, i, score: scoreUsdaMatch(food, searchTerm, i) }))
    .sort((a, b) => a.score - b.score || a.i - b.i)[0].food;
}
