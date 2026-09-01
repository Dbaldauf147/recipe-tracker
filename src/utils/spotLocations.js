/**
 * Turning a geocoder's address parts into a spot's "Neighborhoods / cities".
 *
 * Nominatim does not label places at a consistent granularity, so there is no
 * single field to read. Two real results:
 *
 *   567 Union Ave, Brooklyn   → quarter: Williamsburg, suburb: Brooklyn,
 *                               city: New York
 *   237 St James Pl, Philly   → suburb: Center City,   city: Philadelphia
 *
 * Read `suburb` and you file one spot under a borough and the other under a
 * neighborhood. Read `quarter` and Philadelphia has none at all. The level that
 * deserves the name is a local convention, not a field.
 *
 * So the answer comes from the user's own list instead: every area the geocoder
 * names is a candidate, and any candidate they ALREADY use as a location wins,
 * in their spelling. Someone who files by borough matches Brooklyn; someone who
 * files by neighborhood matches Williamsburg; someone who uses both gets both.
 * Only when nothing matches — a first import, or a new city — does it fall back
 * to a guess, and then it takes the most specific area plus the city, because a
 * name that is too precise is easy to widen and a name like "New York" on its
 * own is not.
 */

// Sub-city areas, MOST SPECIFIC FIRST. Order is what makes the fallback pick
// Williamsburg over Brooklyn; the match path ignores it and takes every hit.
const AREA_KEYS = ['neighbourhood', 'neighborhood', 'quarter', 'suburb', 'city_district', 'borough'];
// The city itself. `municipality` last: it's often a county-ish wrapper.
const CITY_KEYS = ['city', 'town', 'village', 'municipality'];

function cleanName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Candidate place names from a Nominatim `address` object, specific → broad. */
export function geocodeAreaNames(parts) {
  const out = [];
  const seen = new Set();
  for (const key of [...AREA_KEYS, ...CITY_KEYS]) {
    const name = cleanName(parts?.[key]);
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue; // e.g. city === town on some results
    seen.add(k);
    out.push(name);
  }
  return out;
}

/**
 * The locations to file a spot under.
 *
 * @param {object} parts     Nominatim `address` object.
 * @param {string[]} existing The location names already in use.
 * @returns {string[]} Names to add, in the user's own spelling where matched.
 */
export function locationsFromGeocode(parts, existing = []) {
  const candidates = geocodeAreaNames(parts);
  if (candidates.length === 0) return [];

  // Their spelling wins over the geocoder's: someone whose list says "Bed-Stuy"
  // should not end up with a second chip reading "Bedford-Stuyvesant".
  const known = new Map();
  for (const name of existing) {
    const clean = cleanName(name);
    if (clean) known.set(clean.toLowerCase(), clean);
  }

  const matched = candidates
    .filter(c => known.has(c.toLowerCase()))
    .map(c => known.get(c.toLowerCase()));
  if (matched.length > 0) return matched;

  // Nothing recognised — guess. Most specific area, then the city when it adds
  // something (in Philadelphia the "area" IS Center City and the city is
  // Philadelphia; in a town with no sub-areas the two collapse to one).
  const city = CITY_KEYS.map(k => cleanName(parts?.[k])).find(Boolean) || '';
  const area = AREA_KEYS.map(k => cleanName(parts?.[k])).find(Boolean) || '';
  const guess = [];
  if (area) guess.push(area);
  if (city && city.toLowerCase() !== area.toLowerCase()) guess.push(city);
  return guess;
}

/**
 * Merge derived locations into what's on the form, skipping any already there.
 * Case-insensitive, and it never reorders or rewrites what the user typed.
 */
export function mergeLocations(current = [], derived = []) {
  const have = new Set(current.map(l => cleanName(l).toLowerCase()).filter(Boolean));
  const added = derived.filter(d => {
    const k = cleanName(d).toLowerCase();
    if (!k || have.has(k)) return false;
    have.add(k);
    return true;
  });
  return added.length > 0 ? [...current, ...added] : current;
}
