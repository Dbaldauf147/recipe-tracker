import { getCachedMealImage } from '../utils/generateMealImage';
import { getRecipeTags, getTagInfo } from '../utils/ingredientTags';
import styles from './RecipeCard.module.css';

export function RecipeCard({ recipe, onClick, draggable = false, onAdd, editMode, onDelete, macroScore, showTags = true }) {
  const mealImage = getCachedMealImage(recipe.id);
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

  const totalTime = (parseInt(recipe.prepTime) || 0) + (parseInt(recipe.cookTime) || 0);
  const isQuick = totalTime > 0 && totalTime <= 30;

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
    >
      {mealImage && (
        <img className={styles.thumbnail} src={mealImage} alt="" />
      )}
      <div className={styles.cardContent}>
        <span className={styles.name}>{recipe.title}</span>
        <div className={styles.tags}>
          {isQuick && (
            <span className={`${styles.signal} ${styles.signalQuick}`}>
              Quick
            </span>
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
