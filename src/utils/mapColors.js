// Eating Out map dot colours, chosen per viewer. Stored in this browser as
// { category: '#rrggbb' } holding ONLY the categories you changed, so a
// default changed later in code still reaches every category you left alone,
// and "Reset" is just forgetting the key.
//
// Pure (no DOM) apart from the storage object passed in, so it runs under
// `npm test`.

export const MAP_COLORS_KEY = 'prepday-eatingout-map-colors';

const HEX = /^#[0-9a-f]{6}$/i;

/** '#ABC' / '#AABBCC' → '#aabbcc'; anything else → null. */
export function normalizeHex(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  return HEX.test(s) ? s.toLowerCase() : null;
}

/** Defaults overlaid with the valid saved overrides for known categories. */
export function resolveMapColors(defaults, saved) {
  const out = { ...defaults };
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const k of Object.keys(defaults)) {
      const hex = normalizeHex(saved[k]);
      if (hex) out[k] = hex;
    }
  }
  return out;
}

/** Only the categories that differ from their default — what gets stored. */
export function mapColorOverrides(defaults, colors) {
  const out = {};
  for (const k of Object.keys(defaults)) {
    const hex = normalizeHex(colors?.[k]);
    if (hex && hex !== normalizeHex(defaults[k])) out[k] = hex;
  }
  return out;
}

export function readMapColors(defaults, storage) {
  try {
    const raw = storage?.getItem(MAP_COLORS_KEY);
    return resolveMapColors(defaults, raw ? JSON.parse(raw) : null);
  } catch {
    return { ...defaults };
  }
}

export function writeMapColors(defaults, colors, storage) {
  try {
    const overrides = mapColorOverrides(defaults, colors);
    if (Object.keys(overrides).length === 0) storage?.removeItem(MAP_COLORS_KEY);
    else storage?.setItem(MAP_COLORS_KEY, JSON.stringify(overrides));
  } catch { /* private mode / blocked storage — the colours just don't stick */ }
}
