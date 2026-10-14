// "Suggested for Coffee: Coffee shop · Bakery · …" — the categories your other
// Eating Out spots in the same bucket(s) use most, offered as one-tap chips
// under the Category field (categorize pop-up and the edit window).
//
// A spot counts once even when it shares several of the chosen buckets, and a
// category counts once per spot. Case-insensitive; the first spelling seen
// wins. Ranked by how many spots use it, then A–Z.
//
// `bucketsOf` / `categoriesOf` are passed in (they live in EatingOutPage.jsx)
// so this module stays pure for `node --test`.

export function categoriesForBuckets(restaurants, bucketKeys, {
  bucketsOf, categoriesOf, exclude = [], limit = 8, skipId = null,
} = {}) {
  const wanted = new Set(Array.isArray(bucketKeys) ? bucketKeys : []);
  if (wanted.size === 0) return [];
  const taken = new Set((exclude || []).map(c => String(c).trim().toLowerCase()));
  const counts = new Map(); // lower -> { name, count }
  for (const r of restaurants || []) {
    if (!r || (skipId != null && r.id === skipId)) continue;
    if (!bucketsOf(r).some(k => wanted.has(k))) continue;
    const seen = new Set();
    for (const raw of categoriesOf(r) || []) {
      const name = String(raw || '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key) || taken.has(key)) continue;
      seen.add(key);
      const hit = counts.get(key);
      if (hit) hit.count++;
      else counts.set(key, { name, count: 1 });
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}
