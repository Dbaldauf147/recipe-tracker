// Grams for a VOLUME amount, from a reference weight given in another volume.
//
// The recipe editor's Count column only works when a row can be turned into
// grams (the count teaches what one unit weighs: grams ÷ count). A row in
// tablespoons of something the ingredient database weighs per CUP used to come
// back "unknown" — the lookup only accepted the exact same unit — so the Count
// box stayed disabled on every volumetric ingredient that wasn't measured in
// the database's own unit. Volume units convert among themselves exactly, so
// one known "1 cup = 216 g" answers "2 tbsp" too.
//
// Deliberately only TRUE volume units: units.js's VOLUME_TO_ML also carries
// rough stand-ins (can = 400 ml, handful = 50 ml, bunch = 200 ml) that are fine
// for a ballpark but would invent a precise weight here.

const ML = {
  tsp: 4.929, teaspoon: 4.929, teaspoons: 4.929,
  tbsp: 14.787, tablespoon: 14.787, tablespoons: 14.787, tbs: 14.787, tbl: 14.787,
  'fl oz': 29.574, 'fluid ounce': 29.574, 'fluid ounces': 29.574,
  cup: 236.588, cups: 236.588, c: 236.588,
  pint: 473.176, pints: 473.176, pt: 473.176,
  quart: 946.353, quarts: 946.353, qt: 946.353,
  gallon: 3785.41, gallons: 3785.41, gal: 3785.41,
  liter: 1000, liters: 1000, litre: 1000, litres: 1000, l: 1000,
  ml: 1, milliliter: 1, milliliters: 1, millilitre: 1, millilitres: 1,
  cl: 10, dl: 100,
};

/** Millilitres in one of `unit`, or null when it isn't a true volume unit. */
export function mlPerUnit(unit) {
  const u = String(unit || '').trim().toLowerCase().replace(/\(s\)$/, '');
  return ML[u] ?? null;
}

/**
 * Grams in `qty` of `unit`, given that one `refUnit` weighs `refGrams`.
 * Null unless both are true volume units and the numbers are usable.
 */
export function volumeGrams(qty, unit, refGrams, refUnit) {
  const a = mlPerUnit(unit);
  const b = mlPerUnit(refUnit);
  if (!a || !b || !(qty > 0) || !(refGrams > 0)) return null;
  return qty * a * (refGrams / b);
}
