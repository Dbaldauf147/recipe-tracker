/**
 * How settled a recipe is — the owner-only `devStage` field.
 *
 * Set from the Stage chip on the recipe popup (RecipeDetail) and shown as an
 * outlined pill on the recipe cards (RecipeCard). The definitions live here
 * rather than beside either surface so the label a card prints can't drift from
 * the one on the dropdown that set it.
 *
 * The colours run as a journey, not good-to-bad: cool for untried, amber while
 * it's being tuned, green once settled — deliberately not a success/danger pair,
 * because a new recipe isn't a failure. They match the chip's own text colours
 * in RecipeDetail.module.css (.stageChipNew / Wip / Nailed); `nailed` is
 * --color-success spelled out, since a card pill sets its colour inline.
 */
export const RECIPE_STAGES = [
  { key: 'new', label: 'New', color: '#2A5CAA' },
  { key: 'wip', label: 'Work in progress', color: '#92400E' },
  { key: 'nailed', label: 'Nailed down', color: '#2E7D4F' },
];

/** The recipe's stage, or null when it has none (or an unrecognised one). */
export function recipeStage(recipe) {
  const key = String(recipe?.devStage || '').trim();
  return RECIPE_STAGES.find(s => s.key === key) || null;
}
