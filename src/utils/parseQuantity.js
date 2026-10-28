// An ingredient quantity as a number, fractions included. ⚠️ MIRRORS PrepDay
// src/utils/parseQuantity.ts — change both.
//
// A drop-in for parseFloat on quantities: parseFloat("1/2") is 1 (it stops at
// the slash), which made "1/2 cup" count as a whole cup and doubled its
// nutrition next to the same line typed as ".5". Here "1/2", ".5", "0.5" and
// "½" are all 0.5, and "1 1/2", "1½" and "1.5" are all 1.5.
//
// Otherwise it behaves like parseFloat, so existing `|| 1` / isNaN fallbacks
// keep working: a leading amount wins and trailing text is ignored ("2 cups"
// → 2, "1-2" → 1), numbers pass straight through, and anything without a
// leading amount ('', 'to taste', null) is NaN.

const UNICODE_FRACTIONS = {
  '¼': '1/4', '½': '1/2', '¾': '3/4',
  '⅓': '1/3', '⅔': '2/3', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5',
  '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
};
const UNICODE_RE = /[¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g;

export function parseQuantity(value) {
  if (typeof value === 'number') return value;
  if (value == null) return NaN;
  const s = String(value)
    .replace(UNICODE_RE, ch => ` ${UNICODE_FRACTIONS[ch]}`)
    .replace(/⁄/g, '/') // fraction slash
    .trim();
  if (!s) return NaN;

  const frac = s.match(/^(\d+)\s*\/\s*(\d+)/);
  if (frac) return ratio(frac[1], frac[2]);

  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed) {
    const r = ratio(mixed[2], mixed[3]);
    return Number.isFinite(r) ? Number(mixed[1]) + r : NaN;
  }

  return parseFloat(s);
}

function ratio(num, den) {
  const d = Number(den);
  return d ? Number(num) / d : NaN;
}
