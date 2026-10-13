// Which frequencies an Eating Out spot can carry, from its buckets.
//
// Drinking and Going Out places don't get a frequency (2026-10-13): "regular"
// and "special" are meal-planning answers. Retired still applies — it's the
// switch that hides a spot from the list, not a how-often answer. A spot that
// is ALSO a meal place (a brewpub in Lunch / Dinner + Drinking) keeps the full
// set. Mirrored in PrepDay src/utils/spotFrequency.ts — change both together.
//
// Pure: no React / Firebase, so node --test can load it.

export const NO_FREQUENCY_BUCKETS = new Set(['drinking', 'going-out']);

/** True when every bucket is drinking / going-out (and there is at least one). */
export function frequencyExempt(bucketKeys) {
  const keys = Array.isArray(bucketKeys) ? bucketKeys : [];
  return keys.length > 0 && keys.every(k => NO_FREQUENCY_BUCKETS.has(k));
}

/** The frequency options to offer, given the full option list. */
export function frequencyOptionsFor(bucketKeys, options) {
  return frequencyExempt(bucketKeys) ? options.filter(f => f.key === 'retired') : options;
}

/** The frequency a spot may keep: unchanged, or undefined when not allowed. */
export function allowedFrequency(bucketKeys, frequency) {
  if (!frequency) return undefined;
  if (frequencyExempt(bucketKeys) && frequency !== 'retired') return undefined;
  return frequency;
}
