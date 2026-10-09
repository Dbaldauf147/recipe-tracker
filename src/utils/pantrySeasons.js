// Seasons for the Shopping List's Snacks and Fruit widgets.
//
// Two different things, kept apart on purpose:
//
//   • `seasonMonths` on a tracked item (1-12) — the months YOU want it on the
//     list. Set from the item's popup. Absent or empty = all year. Out of those
//     months the weekly auto-add skips it (findTopSince in pantryAutoAdd.js),
//     and the widget dims the row.
//   • naturalSeasonMonths(name) — when the food is at its peak in the
//     Northeast US, from the table below. Shown in the popup as a hint, and
//     one click copies it into seasonMonths. Never applied on its own.
//
// The mobile app mirrors inSeasonMonth in its src/utils/pantryAutoAdd.ts so
// both platforms auto-add the same snack and fruit.
import { foodWords } from './eatenMatch.js';

export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const SEASONS = [
  { key: 'spring', label: 'Spring', months: [3, 4, 5] },
  { key: 'summer', label: 'Summer', months: [6, 7, 8] },
  { key: 'fall', label: 'Fall', months: [9, 10, 11] },
  { key: 'winter', label: 'Winter', months: [12, 1, 2] },
];

const ALL_YEAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const range = (from, to) => {
  const out = [];
  for (let m = from; ; m = (m % 12) + 1) { out.push(m); if (m === to) break; }
  return out;
};

// Peak months in the Northeast US (local harvest; imported staples peak where
// they're grown). Keys are food words — singular, like foodWords() produces.
const NATURAL_SEASONS = {
  // Fruit
  apple: range(8, 11),
  apricot: range(6, 7),
  avocado: ALL_YEAR,
  banana: ALL_YEAR,
  blackberry: range(7, 9),
  blueberry: range(7, 8),
  cantaloupe: range(7, 9),
  cherry: range(6, 7),
  clementine: range(11, 2),
  coconut: ALL_YEAR,
  cranberry: range(9, 11),
  date: ALL_YEAR,
  fig: range(8, 10),
  grape: range(8, 10),
  grapefruit: range(12, 4),
  honeydew: range(7, 9),
  kiwi: range(11, 3),
  lemon: ALL_YEAR,
  lime: ALL_YEAR,
  mandarin: range(11, 2),
  mango: range(4, 8),
  melon: range(7, 9),
  nectarine: range(7, 9),
  olive: ALL_YEAR,
  orange: range(12, 4),
  papaya: ALL_YEAR,
  peach: range(7, 9),
  pear: range(8, 10),
  persimmon: range(10, 12),
  pineapple: range(3, 7),
  plum: range(7, 9),
  pomegranate: range(9, 12),
  raspberry: range(6, 9),
  rhubarb: range(4, 6),
  strawberry: range(6, 7),
  tangerine: range(11, 2),
  watermelon: range(7, 9),
  // Vegetables people snack on
  asparagus: range(4, 6),
  beet: range(7, 11),
  'bell pepper': range(7, 10),
  broccoli: range(6, 10),
  'brussel sprout': range(9, 12),
  'brussels sprout': range(9, 12),
  'butternut squash': range(9, 12),
  carrot: range(7, 11),
  cauliflower: range(9, 11),
  celery: range(8, 10),
  'cherry tomato': range(7, 9),
  corn: range(7, 9),
  cucumber: range(7, 9),
  edamame: range(8, 9),
  'green bean': range(7, 9),
  kale: range(6, 11),
  mushroom: ALL_YEAR,
  'snap pea': range(6, 7),
  'shishito pepper': range(7, 9),
  pumpkin: range(9, 11),
  radish: [5, 6, 9, 10],
  spinach: [5, 6, 9, 10],
  'sweet potato': range(9, 11),
  tomato: range(7, 9),
  zucchini: range(7, 9),
};

/** The food part of a tracked name: "apple(s)_honey crisp" → "apple(s)". */
function baseName(name) {
  const raw = String(name || '');
  const cut = raw.indexOf('_');
  return cut >= 0 ? raw.slice(0, cut) : raw;
}

/**
 * Peak months (1-12) for a food in the Northeast US, or null when it isn't a
 * fresh food we know (crackers, kefir, trail mix). The longest matching key
 * wins, so "sweet potato" isn't read as "potato" and "watermelon" isn't "melon".
 */
export function naturalSeasonMonths(name) {
  // foodWords leaves "tomatoes" as "tomatoe" (and "mangoes", "potatoes").
  const words = foodWords(baseName(name)).map(w => (w.endsWith('oe') ? w.slice(0, -1) : w));
  if (!words.length) return null;
  let best = null;
  let bestLen = 0;
  for (const [key, months] of Object.entries(NATURAL_SEASONS)) {
    const kw = key.split(' ');
    if (kw.length > bestLen && kw.every(w => words.includes(w))) { best = months; bestLen = kw.length; }
  }
  return best ? [...best] : null;
}

/** Sorted, de-duplicated 1-12 months; [] for absent/garbage. */
export function cleanMonths(months) {
  if (!Array.isArray(months)) return [];
  return [...new Set(months.map(Number).filter(m => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b);
}

/** Is a tracked item wanted this month? No seasonMonths = all year. */
export function inSeasonMonth(item, month) {
  const months = cleanMonths(item?.seasonMonths);
  return months.length === 0 || months.includes(month);
}

/**
 * "Jun–Aug", "Nov–Feb", "May–Jun, Sep–Oct", "All year". Runs wrap past
 * December, so a winter pick reads as one span.
 */
export function formatMonths(months) {
  const ms = cleanMonths(months);
  if (ms.length === 0 || ms.length === 12) return 'All year';
  const set = new Set(ms);
  // Start each run at a month whose predecessor isn't picked.
  const starts = ms.filter(m => !set.has(m === 1 ? 12 : m - 1));
  const runs = starts.map(start => {
    let end = start;
    while (set.has(end === 12 ? 1 : end + 1)) end = end === 12 ? 1 : end + 1;
    return start === end ? MONTH_ABBR[start - 1] : `${MONTH_ABBR[start - 1]}–${MONTH_ABBR[end - 1]}`;
  });
  return runs.join(', ');
}
