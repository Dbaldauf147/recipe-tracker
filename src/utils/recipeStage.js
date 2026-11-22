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

/* ── "Adjustments made" — the follow-up on a Work-in-progress recipe ──
 *
 * A Work-in-progress recipe carries an `adjustmentsMade` tick (owner-only, like
 * devStage): did the tweaks from the last cook get written into the recipe?
 * Adding the recipe to This Week's Meals unticks it — another cook is coming,
 * so there'll be something new to adjust — and the weekly email lists the
 * Work-in-progress meals cooked/eaten that week (logged on one of its days)
 * whose box is still unticked.
 *
 * ⚠️ Shared data: the PrepDay phone app reads and writes the same field and the
 * same rules (prepday src/utils/recipeAdjustments.ts). Keep the two in step. */

/** True for a Work-in-progress recipe whose adjustments aren't ticked off yet. */
export function needsAdjustments(recipe) {
  return String(recipe?.devStage || '').trim() === 'wip' && recipe?.adjustmentsMade !== true;
}

/** The change to save when a recipe is added to the week: untick the box. */
export function adjustmentsOnAddToWeek(recipe) {
  return recipe?.adjustmentsMade === true ? { adjustmentsMade: false } : null;
}

/**
 * Logging a meal moves a recipe with no stage, or New, to Work in progress —
 * once you've cooked it, it's being worked on. Only logs on or after
 * STAGE_FROM_LOG_SINCE count, so turning this on didn't re-stage every recipe
 * ever logged. Nailed-down and Work-in-progress recipes are left alone.
 *
 * `dailyLog` is the app's { [YYYY-MM-DD]: { entries: [...] } } map; a logged
 * recipe is an entry with type 'recipe' and its recipeId (website and phone
 * write the same shape). Returns the ids to move.
 */
export const STAGE_FROM_LOG_SINCE = '2026-11-12';
export function recipesToStartFromLog(recipes, dailyLog, since = STAGE_FROM_LOG_SINCE) {
  const logged = new Set();
  for (const [date, day] of Object.entries(dailyLog || {})) {
    if (!(date >= since) || !Array.isArray(day?.entries)) continue;
    for (const e of day.entries) if (e && e.type === 'recipe' && e.recipeId) logged.add(String(e.recipeId));
  }
  if (!logged.size) return [];
  return (recipes || [])
    .filter(r => r && logged.has(String(r.id)))
    .filter(r => { const s = String(r.devStage || '').trim(); return s === '' || s === 'new'; })
    .map(r => r.id);
}

/**
 * The Work-in-progress meals cooked/eaten this week — logged as a recipe on any
 * of `days` (the week's date keys) — still awaiting adjustments. In the order
 * they were first logged, each once. What's on This Week's Meals doesn't count:
 * a meal planned but not eaten has nothing to adjust yet.
 */
export function weekNeedingAdjustments(recipes, dailyLog, days) {
  const byId = new Map((recipes || []).filter(Boolean).map(r => [String(r.id), r]));
  const seen = new Set();
  const out = [];
  for (const date of [...(Array.isArray(days) ? days : [])].sort()) {
    const entries = dailyLog?.[date]?.entries;
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (!e || e.type !== 'recipe' || !e.recipeId) continue;
      const r = byId.get(String(e.recipeId));
      if (!r || seen.has(r.id) || !needsAdjustments(r)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}
