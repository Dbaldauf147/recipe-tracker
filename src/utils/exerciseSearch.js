// Type-ahead search over every exercise the workout picker can offer, across
// all types and muscle groups, so an exercise can be found by name without
// first choosing its type and group. The same ranking as the mobile app's
// src/utils/exerciseSearch.ts — keep the two in step.

const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * How well `name` matches `query` — lower is better, null for no match.
 *   0  the name starts with the query ("bench" → "Bench Press")
 *   1  a word in the name starts with the query ("press" → "Bench Press")
 *   2  the query appears somewhere in the name
 *   3  every word typed starts a word of the name, in any order
 *      ("db curl" → "DB Hammer Curl", "curl hammer" → "Hammer Curl")
 */
export function exerciseMatchRank(name, query) {
  const q = String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return null;
  const n = String(name || '').toLowerCase();
  if (n.startsWith(q)) return 0;
  const nameWords = words(n);
  if (nameWords.some(w => w.startsWith(q))) return 1;
  if (n.includes(q)) return 2;
  const typed = words(q);
  if (typed.length > 1 && typed.every(t => nameWords.some(w => w.startsWith(t)))) return 3;
  return null;
}

/**
 * The best matches for `query` among [{ name, group, exType }]: best rank
 * first, then shorter names, then alphabetical. The same exercise under two
 * groups shows once per group, since picking it fills in that group.
 */
export function searchExercises(items, query, limit = 50) {
  const seen = new Set();
  const hits = [];
  for (const item of items || []) {
    const key = `${String(item.name).toLowerCase()}|${String(item.group).toLowerCase()}`;
    if (seen.has(key)) continue;
    const rank = exerciseMatchRank(item.name, query);
    if (rank == null) continue;
    seen.add(key);
    hits.push({ item, rank });
  }
  hits.sort((a, b) => a.rank - b.rank
    || a.item.name.length - b.item.name.length
    || a.item.name.localeCompare(b.item.name, undefined, { sensitivity: 'base' })
    || a.item.group.localeCompare(b.item.group, undefined, { sensitivity: 'base' }));
  return hits.slice(0, limit).map(h => h.item);
}

/** True when an exercise with exactly this name (any case) already exists. */
export function hasExactExercise(items, query) {
  const q = String(query || '').trim().toLowerCase();
  return !!q && (items || []).some(i => String(i.name).trim().toLowerCase() === q);
}
