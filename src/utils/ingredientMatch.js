// Relevance score for an ingredient name against a query. Lower = better:
// exact < "query …" prefix < prefix < whole-word < substring < no-match.
// Shared across every predictive ingredient picker so the user's own DB
// entries — especially a freshly-added exact/prefix match — are prioritized
// and surface at the top of the list. Mirrors the mobile app's
// ingredientMatchScore (src/services/api.ts) so both platforms rank the same.
export function ingredientMatchScore(name, q) {
  const n = (name || '').toLowerCase().trim();
  const query = (q || '').toLowerCase().trim();
  if (!query) return 5;
  if (n === query) return 0;                                   // exact
  if (n.startsWith(query + ' ')) return 1;                     // "sweet potato …"
  if (n.startsWith(query)) return 2;                           // prefix
  if (n.includes(' ' + query + ' ') || n.endsWith(' ' + query)) return 3; // whole word
  if (n.includes(query)) return 4;                             // substring
  return 5;                                                    // no match
}
