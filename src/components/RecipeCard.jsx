import { getCachedMealImage } from '../utils/generateMealImage';
import { getRecipeTags, getTagInfo } from '../utils/ingredientTags';
import { detectCuisine } from '../utils/detectCuisine';
import { recipeStage } from '../utils/recipeStage';
import styles from './RecipeCard.module.css';

export function RecipeCard({ recipe, onClick, draggable = false, onAdd, editMode, onDelete, macroScore, showTags = true, dimmed = false, showStage = false }) {
  const mealImage = getCachedMealImage(recipe.id);
  // `devStage` is owner-only, so whether to show it is the caller's call — the
  // card has no auth of its own. Null unless asked AND actually set: an unset
  // stage prints nothing rather than a "Not set" pill, which would put a badge
  // on every card and say nothing.
  const stage = showStage ? recipeStage(recipe) : null;
  const cuisine = recipe.cuisine || detectCuisine(recipe.title, recipe.ingredients);
  const recipeTags = showTags ? getRecipeTags(recipe).slice(0, 4) : [];
  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', recipe.id);
    e.dataTransfer.effectAllowed = 'copyMove';
    e.currentTarget.style.opacity = '0.7';
    e.currentTarget.style.transform = 'scale(0.98)';
  }

  function handleDragEnd(e) {
    e.currentTarget.style.opacity = '';
    e.currentTarget.style.transform = '';
  }

  return (
    <div
      className={styles.card}
      role="button"
      tabIndex={0}
      onClick={() => onClick(recipe.id)}
      onKeyDown={e => { if (e.key === 'Enter') onClick(recipe.id); }}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={draggable ? handleDragEnd : undefined}
      // The stage colours the CARD'S OWN BORDER rather than printing a pill in
      // the tag row: at a glance down a long list you want to see which recipes
      // are settled, not read the word "settled" ninety times. The tag row is
      // for what's IN the recipe; how finished it is belongs to the card.
      //
      // Passed as a custom property, not as `borderColor`, so the value stays
      // defined once in recipeStage.js while the STYLESHEET keeps control of
      // how it's applied — an inline border-color would outrank the :hover rule
      // and silently kill the card's hover accent.
      data-stage={stage ? stage.key : undefined}
      style={{
        ...(dimmed ? { opacity: 0.45 } : null),
        ...(stage ? { '--stage-color': stage.color } : null),
      }}
      title={dimmed
        ? 'Matches your search but hidden by the active filter — click to open'
        : (stage ? `Stage: ${stage.label}` : undefined)}
    >
      {mealImage && (
        <img className={styles.thumbnail} src={mealImage} alt="" />
      )}
      <div className={styles.cardContent}>
        <span className={styles.name}>{recipe.title}</span>
        {dimmed && <span className={styles.filteredTag}>Hidden by filter</span>}
        <div className={styles.tags}>
          {/* No stage pill here — the card's border carries it (see above), so
              the tag row stays about what's in the recipe. The label is still
              reachable: it's the card's hover title, and the popup spells it
              out on the Stage chip that sets it. */}
          {recipe.source === 'shared' && recipe.sharedFrom && (
            <span className={styles.sharedFromTag}>from @{recipe.sharedFrom}</span>
          )}
          {recipeTags.map(tagKey => {
            const info = getTagInfo(tagKey);
            return (
              <span key={tagKey} className={styles.ingredientTag} style={{ color: info.color, borderColor: info.color }}>
                {info.label}
              </span>
            );
          })}
        </div>
      </div>
      {editMode && onDelete ? (
        <button
          className={styles.deleteBtn}
          onClick={e => { e.stopPropagation(); if (confirm(`Delete "${recipe.title}"?`)) onDelete(recipe.id); }}
          aria-label={`Delete ${recipe.title}`}
        >
          &minus;
        </button>
      ) : onAdd ? (
        <button
          className={styles.addBtn}
          onClick={e => { e.stopPropagation(); onAdd(recipe.id); }}
          aria-label={`Add ${recipe.title} to this week`}
        >
          +
        </button>
      ) : null}
    </div>
  );
}
