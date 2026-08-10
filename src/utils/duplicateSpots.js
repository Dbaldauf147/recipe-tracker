// Finding the same place entered twice on the Eating Out list.
//
// Duplicates arrive by ordinary means: added once from a friend's share and
// again by hand, or once as "Joe's Pizza" and again as "Joes Pizza Co." after a
// lookup filled the name differently. Two rows for one place split its ratings
// and visit history in half, and nothing on the page says so.
//
// The match is deliberately CONSERVATIVE. A false flag on two genuinely
// different places (a chain with two branches, which SHOULD be two rows) is
// worse than a missed duplicate, because it asks you to act on something that
// isn't wrong. So: normalise hard, then require an exact match on the
// normalised form. No fuzzy distance, no partial credit.

/** Lowercase, strip punctuation and accents, collapse whitespace. */
function base(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // café -> cafe
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Articles, which never identify a place wherever they sit.
const LEADING_NOISE = new Set(['the', 'a']);
// Category and corporate words, stripped only from the END. A leading one is
// part of the name — "Bar Primi" is not "Primi", and "Kitchen Table" is not
// "Table" — while a trailing one usually isn't: "Primi Bar" is Primi.
const TRAILING_NOISE = new Set([
  'restaurant', 'cafe', 'coffee', 'bar', 'grill', 'kitchen',
  'co', 'company', 'inc', 'llc', 'ltd',
]);

/**
 * A name reduced to what identifies the place.
 *
 * "The Joe's Pizza Co." and "Joes Pizza" both land on "joe pizza". Trailing
 * noise only — a leading "Bar" is part of the name ("Bar Primi"), while a
 * trailing one usually isn't ("Primi Bar").
 */
export function normalizeSpotName(name) {
  // Punctuation is already gone, so "Joe's" arrives as "joe s". Drop that
  // orphaned possessive before anything else, or it survives as its own word
  // and "Joe's Pizza" never meets "Joes Pizza" — which is the single most
  // likely way one place gets entered twice.
  const words = base(name).split(' ').filter(w => w && w !== 's');
  while (words.length > 1 && LEADING_NOISE.has(words[0])) words.shift();
  while (words.length > 1 && TRAILING_NOISE.has(words[words.length - 1])) words.pop();
  // Crude plural fold, so "Joes" and "Joe" meet.
  return words.map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).join(' ');
}

// Street-type abbreviations, so "123 Main St" and "123 Main Street" match.
const STREET_WORDS = {
  st: 'street', str: 'street', rd: 'road', ave: 'avenue', av: 'avenue',
  blvd: 'boulevard', dr: 'drive', ln: 'lane', ct: 'court', pl: 'place',
  sq: 'square', hwy: 'highway', pkwy: 'parkway', ter: 'terrace',
  n: 'north', s: 'south', e: 'east', w: 'west',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
  ste: 'suite', apt: 'suite', unit: 'suite', fl: 'floor',
};

/**
 * An address reduced to its identifying form.
 *
 * Returns '' for anything too short to be an address — a blank or a stray "NYC"
 * must never match another blank, or every row without an address would flag
 * every other one.
 */
export function normalizeSpotAddress(address) {
  const words = base(address).split(' ').filter(Boolean).map(w => STREET_WORDS[w] || w);
  const out = words.join(' ');
  // Needs a number and some street text to be worth comparing on.
  if (out.length < 6 || !/\d/.test(out)) return '';
  return out;
}

/**
 * Which rows share a name or an address with another row.
 *
 * Returns a Map of id -> { name: [...others], address: [...others] }, each a
 * list of the OTHER rows' display names. Only rows with at least one clash
 * appear. Rows without an id are skipped — there'd be no way to key the flag.
 *
 * Compared across the WHOLE list, not the filtered view: a duplicate you can't
 * currently see is still a duplicate, and finding out only when a filter
 * happens to show both is how they survive.
 */
export function findDuplicateSpots(rows = []) {
  const byName = new Map();
  const byAddress = new Map();

  for (const r of rows) {
    if (!r || r.id == null) continue;
    const n = normalizeSpotName(r.name);
    if (n) {
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(r);
    }
    const a = normalizeSpotAddress(r.address);
    if (a) {
      if (!byAddress.has(a)) byAddress.set(a, []);
      byAddress.get(a).push(r);
    }
  }

  const out = new Map();
  const add = (row, kind, others) => {
    if (!out.has(row.id)) out.set(row.id, { name: [], address: [] });
    const entry = out.get(row.id);
    for (const o of others) {
      const label = String(o.name || 'Untitled').trim();
      if (!entry[kind].includes(label)) entry[kind].push(label);
    }
  };

  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const r of group) add(r, 'name', group.filter(o => o.id !== r.id));
  }
  for (const group of byAddress.values()) {
    if (group.length < 2) continue;
    for (const r of group) add(r, 'address', group.filter(o => o.id !== r.id));
  }
  return out;
}

/** One line explaining a flag, for the row's tooltip. */
export function duplicateReason(entry) {
  if (!entry) return '';
  const parts = [];
  if (entry.name.length) parts.push(`same name as ${entry.name.join(', ')}`);
  if (entry.address.length) parts.push(`same address as ${entry.address.join(', ')}`);
  if (!parts.length) return '';
  return `Possible duplicate — ${parts.join('; ')}`;
}
