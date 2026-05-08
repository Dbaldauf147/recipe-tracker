// Parse the user's spreadsheet TSV into Restaurant objects matching the
// schema both the website and the mobile app share.
//
// Expected column order (tab-separated):
//   0  Place
//   1  Meal       (e.g., "Lunch/Dinner - Regular", "Drinking", "Coffee", "All")
//   2  Cat        (e.g., "Bowls", "Sushi", "Cocktail, Dance")
//   3  Meal/Drink (specific dish recommendation OR a URL)
//   4  Rating     ("bad" | "ok" | "good" | "great" | "top" | "incredible"
//                  | "try next" | "closed" | "")
//   5  Combine    (concatenated derived field — IGNORED)
//   6  Days       (days-since-visit derived field — IGNORED)
//   7  Notes
//   8  Healthy?   ("Healthy, Workout", "Unhealthy", etc.)
//   9  Meat?      ("Meat, Vegetarian", "Pescatarian", etc.)
//  10  Area       (Williamsburg, Manhattan, …)
//  11  Last Time  (M/D/YYYY)

const RATING_TO_STARS = {
  bad: 1,
  ok: 2,
  good: 3,
  great: 4,
  top: 5,
  incredible: 5,
};
// Labels that count as "rated/visited" even if they don't map to a star value.
const RATED_LABELS = new Set([
  ...Object.keys(RATING_TO_STARS),
  'closed',
]);

export function ratingLabelToStars(label) {
  if (!label) return null;
  const stars = RATING_TO_STARS[String(label).toLowerCase().trim()];
  return typeof stars === 'number' ? stars : null;
}

function parseMeal(raw) {
  // Returns { mealType, frequency } from values like:
  //   "Lunch/Dinner - Regular"  -> { mealType: 'lunch-dinner', frequency: 'regular' }
  //   "Lunch/Dinner - Special"
  //   "Lunch/Dinner - Retired"
  //   "Breakfast - Regular"
  //   "Drinking"                -> { mealType: 'drinking' }
  //   "Drinking - Retired"
  //   "Coffee"                  -> { mealType: 'coffee' }
  //   "Other"                   -> { mealType: 'other' }
  //   "All" / "All Day"         -> { mealType: 'all' }
  //   "Dinner/Lunch"            -> { mealType: 'lunch-dinner' }
  //   "Lunch/Dinner Breakfast"  -> { mealType: 'all' }
  //   "Retired"                 -> { frequency: 'retired' }
  const out = {};
  if (!raw) return out;
  const v = String(raw).trim();
  if (!v) return out;

  const lower = v.toLowerCase();
  if (lower === 'retired') return { frequency: 'retired' };

  const [headRaw, tailRaw] = v.split(/\s*-\s*/, 2);
  const head = (headRaw || '').toLowerCase().trim();
  const tail = (tailRaw || '').toLowerCase().trim();

  if (head.includes('lunch/dinner breakfast') || head === 'all' || head === 'all day') {
    out.mealType = 'all';
  } else if (head.includes('lunch') || head.includes('dinner')) {
    out.mealType = 'lunch-dinner';
  } else if (head.includes('breakfast')) {
    out.mealType = 'breakfast';
  } else if (head.includes('drink')) {
    out.mealType = 'drinking';
  } else if (head.includes('coffee')) {
    out.mealType = 'coffee';
  } else if (head.includes('other')) {
    out.mealType = 'other';
  }

  if (tail === 'regular' || tail === 'special' || tail === 'retired') {
    out.frequency = tail;
  }

  return out;
}

function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900) {
      const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }
  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) return fallback.toISOString();
  return null;
}

function splitTags(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function isUrlLike(s) {
  if (!s) return false;
  return /^https?:\/\//i.test(String(s).trim());
}

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function inferStatus({ ratingLabel, lastVisit, frequency }) {
  if (ratingLabel === 'try next') return 'want-to-try';
  if (lastVisit) return 'visited';
  if (ratingLabel && RATED_LABELS.has(ratingLabel)) return 'visited';
  if (frequency === 'retired') return 'visited';
  return 'want-to-try';
}

/**
 * Parse one TSV row into a Restaurant. Returns null when the row has no
 * usable place name.
 */
export function parseTsvRow(cells, now = new Date().toISOString()) {
  const place = (cells[0] || '').trim();
  if (!place) return null;

  const meal = (cells[1] || '').trim();
  const cat = (cells[2] || '').trim();
  const dishRaw = (cells[3] || '').trim();
  const rating = (cells[4] || '').trim().toLowerCase();
  const notes = (cells[7] || '').trim();
  const healthy = (cells[8] || '').trim();
  const meat = (cells[9] || '').trim();
  const area = (cells[10] || '').trim();
  const lastTime = (cells[11] || '').trim();

  const { mealType, frequency } = parseMeal(meal);
  const ratingLabel = rating || undefined;
  const stars = ratingLabelToStars(rating);
  const lastVisit = parseDate(lastTime);

  // Sometimes the dish column actually holds a link (the user pasted IG URLs
  // there). Promote those to the URL field.
  let dish;
  let url;
  if (dishRaw) {
    if (isUrlLike(dishRaw)) url = dishRaw;
    else dish = dishRaw;
  }
  // Notes column may also contain a link.
  let cleanedNotes = notes;
  if (notes && isUrlLike(notes) && !url) {
    url = notes;
    cleanedNotes = '';
  }

  const cuisines = splitTags(cat);
  const locations = area ? [area] : [];
  const dietTags = splitTags(healthy);
  const meatTags = splitTags(meat);
  const status = inferStatus({ ratingLabel, lastVisit, frequency });

  return {
    id: generateId(),
    name: place,
    url,
    cuisines,
    locations,
    rating: stars,
    ratingLabel,
    status,
    mealType,
    frequency,
    dish,
    notes: cleanedNotes || undefined,
    dietTags: dietTags.length ? dietTags : undefined,
    meatTags: meatTags.length ? meatTags : undefined,
    lastVisit: lastVisit || undefined,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Parse pasted TSV / spreadsheet rows. Returns an array of Restaurant
 * objects, skipping unusable rows. Tolerates blank rows, missing columns,
 * and the "46,150" placeholder Days values from the source sheet.
 */
export function parseRestaurantTsv(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.split('\t');
    // If the user pasted with comma separators by accident, fall back to
    // a CSV split — but only when there are no tabs at all.
    const cellList = cells.length === 1 ? line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/) : cells;
    const row = parseTsvRow(cellList);
    if (row) out.push(row);
  }
  return out;
}

/**
 * Detect duplicates against the existing list (case-insensitive name match).
 * Returns { fresh, duplicates } so the UI can let the user decide whether to
 * merge or skip.
 */
export function partitionDuplicates(parsed, existing) {
  const existingNames = new Set((existing || []).map(r => (r.name || '').toLowerCase().trim()));
  const fresh = [];
  const duplicates = [];
  for (const r of parsed) {
    if (existingNames.has((r.name || '').toLowerCase().trim())) {
      duplicates.push(r);
    } else {
      fresh.push(r);
    }
  }
  return { fresh, duplicates };
}
