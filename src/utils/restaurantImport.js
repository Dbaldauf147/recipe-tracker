// Mapping-driven importer for the Eating Out page.
//
// Flow:
//   1. splitTsv(text)               -> string[][] of rows/cells
//   2. autoDetectMapping(rows, ...) -> { columnIndex: fieldKey }
//   3. applyMapping(rows, mapping)  -> Restaurant[]
//
// The UI lets the user override the detected mapping before applying.
// Field keys are listed in IMPORT_FIELDS and matched to header text via
// the regex table in HEADER_HINTS.

export const IMPORT_FIELDS = [
  { key: 'ignore', label: 'Ignore' },
  { key: 'id', label: 'ID (round-trip)' },
  { key: 'name', label: 'Place / Name' },
  { key: 'status', label: 'Status (want-to-try / visited)' },
  { key: 'mealAndFrequency', label: 'Meal context (e.g., "Lunch/Dinner - Regular")' },
  { key: 'mealType', label: 'Meal type only' },
  { key: 'frequency', label: 'Frequency (Regular / Special / Retired)' },
  { key: 'cuisine', label: 'Cuisine / category' },
  { key: 'categories', label: 'Categories (for voting)' },
  { key: 'dish', label: 'What to order' },
  { key: 'url', label: 'URL / link' },
  { key: 'imageUrl', label: 'Image URL (preview)' },
  { key: 'description', label: 'Description (scraped from URL)' },
  { key: 'rating', label: 'Rating (text or stars)' },
  { key: 'notes', label: 'Notes' },
  { key: 'diet', label: 'Diet tags (Healthy / Unhealthy / Workout)' },
  { key: 'meat', label: 'Diet preferences (Meat / Vegetarian / Pescatarian)' },
  { key: 'location', label: 'Neighborhood / city' },
  { key: 'lastVisit', label: 'Last visit date' },
  { key: 'address', label: 'Address' },
  { key: 'lat', label: 'Latitude' },
  { key: 'lng', label: 'Longitude' },
  { key: 'takenJoanne', label: 'Taken Joanne (true/false)' },
];

const FIELD_KEYS = new Set(IMPORT_FIELDS.map(f => f.key));

// Regex hints used to auto-detect mapping from header text. Order matters —
// the first match wins.
const HEADER_HINTS = [
  // Round-trip fields produced by the exporter — check these first so the
  // names ("status", "id") don't get swallowed by broader patterns below.
  [/^id$|^uuid$/i, 'id'],
  [/^status$/i, 'status'],
  [/^lat$|latitude/i, 'lat'],
  [/^lng$|^lon$|longitude/i, 'lng'],
  [/image[\s_-]?url|^image$/i, 'imageUrl'],
  [/^description$|scraped/i, 'description'],
  [/^takenJoanne$|taken[\s_-]?joanne/i, 'takenJoanne'],

  [/^place$|name|restaurant|spot/i, 'name'],
  [/^meal$|^when$|when to eat/i, 'mealAndFrequency'],
  // Exact "categories" (the exporter header) → the voting categories field,
  // before the broader cuisine matcher below so it isn't swallowed.
  [/^categories$/i, 'categories'],
  [/^cat$|category|cuisine|type$|food.?type/i, 'cuisine'],
  [/dish|order|meal\/?drink|drink/i, 'dish'],
  [/url|link|website|instagram|insta/i, 'url'],
  [/rating|score|stars/i, 'rating'],
  [/combine/i, 'ignore'],   // user-derived concat column
  [/days/i, 'ignore'],       // user-derived "days since visit"
  [/notes?/i, 'notes'],
  [/healthy/i, 'diet'],
  [/meat\??$|diet preference/i, 'meat'],
  [/area|neighborhood|city|location/i, 'location'],
  [/last[\s_-]?(time|visit)|visited|when last/i, 'lastVisit'],
  [/address|street|line ?1|addr/i, 'address'],
];

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
  // "Lunch/Dinner - Regular" -> { mealType: 'lunch-dinner', frequency: 'regular' }
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

/**
 * Split pasted text into a 2-D grid of strings. Tabs preferred; falls back
 * to a CSV-ish split when no tabs are present in any row. Trailing blank
 * rows are dropped but interior blanks are kept so column indexes stay
 * stable across rows.
 */
export function splitTsv(text) {
  if (!text) return [];
  const lines = String(text).replace(/\r/g, '').split('\n');
  // Trim trailing fully-empty lines.
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length === 0) return [];

  const hasTab = lines.some(l => l.includes('\t'));
  return lines.map(line => {
    if (hasTab) return line.split('\t');
    // Naive CSV split that respects quoted commas.
    return line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c =>
      c.replace(/^\s*"(.*)"\s*$/, '$1'),
    );
  });
}

/**
 * Heuristic header detection. Treats the first row as headers when most of
 * its cells look like field names rather than values.
 */
export function detectHasHeader(rows) {
  if (!rows.length) return false;
  const first = rows[0];
  if (first.length < 2) return false;

  let nameLike = 0;
  let valueLike = 0;
  for (const cell of first) {
    const v = (cell || '').trim();
    if (!v) continue;
    if (/^https?:\/\//i.test(v) || /^\d/.test(v) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v)) {
      valueLike++;
    } else if (/^[A-Za-z][A-Za-z\s/?\-]{0,30}$/.test(v)) {
      nameLike++;
    }
  }
  return nameLike >= 2 && nameLike >= valueLike;
}

/**
 * Auto-detect a column→field mapping. Uses the header row when present
 * (matches against HEADER_HINTS); otherwise leaves columns as 'ignore'.
 *
 * Returns an object: { [columnIndex]: fieldKey }.
 */
export function autoDetectMapping(rows) {
  const mapping = {};
  if (!rows.length) return mapping;
  const hasHeader = detectHasHeader(rows);
  if (!hasHeader) return mapping;
  const header = rows[0];
  const used = new Set();
  for (let i = 0; i < header.length; i++) {
    const text = String(header[i] || '').trim();
    if (!text) continue;
    for (const [re, key] of HEADER_HINTS) {
      if (re.test(text) && !used.has(key)) {
        mapping[i] = key;
        // Allow array fields to repeat (cuisine, categories, location, diet,
        // meat) but de-dupe scalar fields.
        if (!['cuisine', 'categories', 'location', 'diet', 'meat', 'ignore'].includes(key)) {
          used.add(key);
        }
        break;
      }
    }
  }
  return mapping;
}

function inferStatus({ ratingLabel, lastVisit, frequency }) {
  if (ratingLabel === 'try next') return 'want-to-try';
  if (lastVisit) return 'visited';
  if (ratingLabel && RATED_LABELS.has(ratingLabel)) return 'visited';
  if (frequency === 'retired') return 'visited';
  return 'want-to-try';
}

function isUsefulValue(v) {
  if (v == null) return false;
  const s = String(v).trim();
  return s.length > 0;
}

/**
 * Build a Restaurant from a single row using the user-confirmed mapping.
 * Returns null if the row has no usable name.
 */
function buildRestaurantFromRow(cells, mapping, now) {
  // Collect values per field key.
  const collected = {}; // key -> string[] (multi) or first non-empty (scalar)
  for (const idxStr of Object.keys(mapping)) {
    const idx = Number(idxStr);
    const key = mapping[idxStr];
    if (key === 'ignore' || !FIELD_KEYS.has(key)) continue;
    const raw = (cells[idx] || '').trim();
    if (!isUsefulValue(raw)) continue;
    if (!collected[key]) collected[key] = [];
    collected[key].push(raw);
  }

  const nameVal = (collected.name || [])[0];
  if (!nameVal) return null;

  // Dish / URL: dish columns sometimes hold a URL (the user pasted IG URLs
  // there). Promote to URL when it looks like one.
  let dish;
  let url;
  for (const v of collected.dish || []) {
    if (isUrlLike(v) && !url) url = v;
    else if (!dish) dish = v;
  }
  if (!url) {
    const explicit = (collected.url || [])[0];
    if (explicit) url = explicit;
  }
  // Notes column may also hold a URL.
  let notes;
  for (const v of collected.notes || []) {
    if (isUrlLike(v) && !url) url = v;
    else if (!notes) notes = v;
  }

  let mealType, frequency;
  for (const v of collected.mealAndFrequency || []) {
    const parsed = parseMeal(v);
    if (parsed.mealType && !mealType) mealType = parsed.mealType;
    if (parsed.frequency && !frequency) frequency = parsed.frequency;
  }
  if (!mealType && (collected.mealType || []).length) {
    mealType = parseMeal((collected.mealType || [])[0]).mealType;
  }
  if (!frequency && (collected.frequency || []).length) {
    const f = String((collected.frequency || [])[0]).toLowerCase();
    if (f === 'regular' || f === 'special' || f === 'retired') frequency = f;
  }

  const ratingLabelRaw = (collected.rating || [])[0];
  const ratingLabel = ratingLabelRaw ? ratingLabelRaw.toLowerCase() : undefined;
  // If the rating column contains a number, take it directly as stars.
  let stars = null;
  if (ratingLabelRaw && /^\d+(?:\.\d+)?$/.test(ratingLabelRaw)) {
    const n = Math.round(parseFloat(ratingLabelRaw));
    if (n >= 1 && n <= 5) stars = n;
  }
  if (stars == null) stars = ratingLabelToStars(ratingLabelRaw);

  const lastVisitRaw = (collected.lastVisit || [])[0];
  const lastVisit = parseDate(lastVisitRaw);

  const cuisines = [];
  for (const v of collected.cuisine || []) cuisines.push(...splitTags(v));
  const categories = [];
  for (const v of collected.categories || []) categories.push(...splitTags(v));
  const locations = [];
  for (const v of collected.location || []) locations.push(...splitTags(v));
  const dietTags = [];
  for (const v of collected.diet || []) dietTags.push(...splitTags(v));
  const meatTags = [];
  for (const v of collected.meat || []) meatTags.push(...splitTags(v));

  const address = (collected.address || []).join(', ') || undefined;

  const explicitId = (collected.id || [])[0];
  const explicitStatusRaw = ((collected.status || [])[0] || '').toLowerCase().trim();
  const explicitStatus = (explicitStatusRaw === 'want-to-try' || explicitStatusRaw === 'visited')
    ? explicitStatusRaw
    : null;
  const status = explicitStatus || inferStatus({ ratingLabel, lastVisit, frequency });

  const latRaw = (collected.lat || [])[0];
  const lngRaw = (collected.lng || [])[0];
  const latNum = latRaw != null && latRaw !== '' ? parseFloat(latRaw) : NaN;
  const lngNum = lngRaw != null && lngRaw !== '' ? parseFloat(lngRaw) : NaN;
  const lat = Number.isFinite(latNum) ? latNum : undefined;
  const lng = Number.isFinite(lngNum) ? lngNum : undefined;
  const imageUrl = (collected.imageUrl || [])[0] || undefined;
  const description = (collected.description || [])[0] || undefined;
  const takenJoanneRaw = ((collected.takenJoanne || [])[0] || '').toString().toLowerCase().trim();
  const takenJoanne = takenJoanneRaw === 'true' || takenJoanneRaw === 'yes' || takenJoanneRaw === '1' ? true : undefined;

  return {
    id: explicitId || generateId(),
    name: nameVal,
    url: url || undefined,
    imageUrl,
    description,
    cuisines: dedupe(cuisines),
    categories: categories.length ? dedupe(categories) : undefined,
    locations: dedupe(locations),
    rating: stars,
    ratingLabel: ratingLabelRaw ? ratingLabelRaw : undefined,
    status,
    mealType: mealType || undefined,
    frequency: frequency || undefined,
    dish: dish || undefined,
    notes: notes || undefined,
    dietTags: dietTags.length ? dedupe(dietTags) : undefined,
    meatTags: meatTags.length ? dedupe(meatTags) : undefined,
    lastVisit: lastVisit || undefined,
    address,
    lat,
    lng,
    takenJoanne,
    createdAt: now,
    updatedAt: now,
  };
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * Apply a column mapping to a 2-D grid. `hasHeader` controls whether the
 * first row is skipped. Returns a Restaurant[].
 */
export function applyMapping(rows, mapping, { hasHeader = false, now } = {}) {
  if (!rows.length) return [];
  const out = [];
  const ts = now || new Date().toISOString();
  const start = hasHeader ? 1 : 0;
  for (let i = start; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells || cells.every(c => !((c || '').trim()))) continue;
    const r = buildRestaurantFromRow(cells, mapping, ts);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Detect duplicates against the existing list. Matches by `id` when the
 * incoming row carries one (round-trip from the exporter), otherwise falls
 * back to case-insensitive name match.
 */
export function partitionDuplicates(parsed, existing) {
  const existingIds = new Set((existing || []).map(r => r.id).filter(Boolean));
  const existingNames = new Set((existing || []).map(r => (r.name || '').toLowerCase().trim()));
  const fresh = [];
  const duplicates = [];
  for (const r of parsed) {
    const idHit = r.id && existingIds.has(r.id);
    const nameHit = existingNames.has((r.name || '').toLowerCase().trim());
    if (idHit || nameHit) duplicates.push(r);
    else fresh.push(r);
  }
  return { fresh, duplicates };
}
