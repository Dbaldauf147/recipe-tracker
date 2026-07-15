// Per-ingredient count-unit weights — "1 regular stick of celery = 66.5 g".
//
// Stored as `unitWeights: [{ unit, grams, isDefault? }]` on an ingredientsDb row.
//
// ⚠️ THIS IS THE SAME FIELD THE MOBILE APP WRITES — see PrepDay's
// src/types/ingredient.ts (UnitWeight) and src/utils/unitConversion.ts. Both
// apps read/write the SAME admin-owned `ingredientsDb` doc, so the shape and the
// unit-name normalization must stay in sync: a size taught here shows up on the
// phone and vice versa. `unit` is ONE string — mobile stores "medium", "large",
// "clove". We compose "<size> <name>" ("regular stick") or just the size
// ("large") when no name is given, both of which are valid mobile units.

// The size qualifiers offered in the recipe editor's unit column.
export const UNIT_SIZES = ['regular', 'small', 'large'];

// Mirrors mobile's normalize(): case- and plural-insensitive, so "Sticks",
// "stick(s)" and "stick" are the same unit.
export function normalizeUnitName(unit) {
  return (unit || '')
    .trim()
    .toLowerCase()
    .replace(/\(s\)$/i, '')
    .replace(/\(es\)$/i, '')
    .replace(/s$/, '');
}

// "regular" + "stick" → "regular stick". A size with no name stays just the
// size ("large"), matching how mobile already stores sizes.
export function composeUnit(size, name) {
  return [(size || '').trim(), (name || '').trim()].filter(Boolean).join(' ');
}

// Split a stored unit back into the editor's two inputs.
export function splitUnit(unit) {
  const parts = (unit || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { size: '', name: '' };
  const first = parts[0].toLowerCase();
  if (UNIT_SIZES.includes(first)) return { size: first, name: parts.slice(1).join(' ') };
  return { size: '', name: parts.join(' ') };
}

// The unitWeights entry matching `unit`, or null.
export function findUnitWeight(row, unit) {
  const u = normalizeUnitName(unit);
  if (!u || !row?.unitWeights?.length) return null;
  return row.unitWeights.find(w => normalizeUnitName(w.unit) === u) || null;
}

// The entry an ingredient prefers — the flagged default, else the first.
export function defaultUnitWeight(row) {
  if (!row?.unitWeights?.length) return null;
  return row.unitWeights.find(w => w.isDefault) || row.unitWeights[0];
}

// The noun of a unit — the last word, so "regular stick" → "stick".
function nounOf(unit) {
  const parts = normalizeUnitName(unit).split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

// A recipe line that just says "2 sticks celery" carries no size qualifier, so
// it won't strictly match a taught "regular stick". Fall back to the entry whose
// NOUN matches (preferring the default), because resolving it to the size you
// taught beats the generic table — where a "stick" is a stick of BUTTER
// (WEIGHT_TO_G.stick = 113.4 g). Deliberately more lenient than mobile's
// exact-match toGrams; the stored shape is identical, only the lookup is
// friendlier, so nothing about the shared data diverges.
function matchByNoun(row, unit) {
  const u = normalizeUnitName(unit);
  if (!u || UNIT_SIZES.includes(u) || !row?.unitWeights?.length) return null;
  const hits = row.unitWeights.filter(w => nounOf(w.unit) === u);
  if (!hits.length) return null;
  return hits.find(w => w.isDefault) || hits[0];
}

// Grams for `qty` of `unit` of this ingredient, or null if we don't know the
// unit. Per-ingredient units win over any generic table.
export function unitWeightGrams(row, qty, unit) {
  if (!Number.isFinite(qty)) return null;
  const hit = findUnitWeight(row, unit) || matchByNoun(row, unit);
  if (!hit || !(hit.grams > 0)) return null;
  return qty * hit.grams;
}

// "regular stick" + 2 → "regular sticks". Pluralizes the noun (the last word),
// so the size qualifier stays put.
export function pluralizeUnit(unit, count) {
  const u = (unit || '').trim();
  if (!u || Math.abs(count - 1) < 1e-9) return u;
  const parts = u.split(/\s+/);
  parts[parts.length - 1] += 's';
  return parts.join(' ');
}

// Upsert one count-unit weight onto a list, keeping any others. Returns a new
// array; the first entry stays the default when none is flagged.
export function upsertUnitWeight(list, unit, grams) {
  const u = normalizeUnitName(unit);
  const kept = (Array.isArray(list) ? list : []).filter(w => normalizeUnitName(w.unit) !== u);
  const entry = { unit: (unit || '').trim(), grams: Math.round(grams * 100) / 100 };
  const next = [...kept, entry];
  if (!next.some(w => w.isDefault)) next[0].isDefault = true;
  return next;
}
