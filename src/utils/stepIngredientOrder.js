/**
 * Move one ingredient assignment inside a recipe's `stepIngredients` map.
 *
 * `stepIngredients` maps a step index to the ordered list of recipe-ingredient
 * indices shown beside that step. The order of that list is the order the
 * ingredients are listed in the step, so reordering is a splice within it;
 * dropping onto another step moves the assignment there.
 *
 * `toPos` is the position the dragged item should occupy after the move,
 * counted in the destination list as it looks with the item removed when the
 * move stays in one step (the same convention as Array.splice out-then-in).
 * It is clamped to the list, so a drop past the end appends.
 *
 * Returns a new map; the input is never mutated. Steps left empty are removed,
 * matching how the rest of RecipeDetail writes the map.
 */
export function moveStepIngredient(map, fromStep, fromPos, toStep, toPos) {
  const src = map?.[fromStep] || [];
  if (fromPos < 0 || fromPos >= src.length) return map || {};
  const sameStep = String(fromStep) === String(toStep);
  if (sameStep && fromPos === toPos) return map || {};

  const next = { ...(map || {}) };
  const from = [...src];
  const [moved] = from.splice(fromPos, 1);
  const to = sameStep ? from : [...(next[toStep] || [])].filter(i => i !== moved);
  const at = Math.max(0, Math.min(toPos, to.length));
  to.splice(at, 0, moved);

  if (!sameStep) {
    if (from.length) next[fromStep] = from;
    else delete next[fromStep];
  }
  next[toStep] = to;
  return next;
}
