import styles from './RecipeCard.module.css';

export function RecipeCard({ recipe, onClick, draggable = false, onAdd, editMode, onDelete }) {
  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', recipe.id);
    e.dataTransfer.effectAllowed = 'copyMove';
  }

  return (
    <div
      className={styles.link}
      role="button"
      tabIndex={0}
      onClick={() => onClick(recipe.id)}
      onKeyDown={e => { if (e.key === 'Enter') onClick(recipe.id); }}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
    >
      <span className={styles.name}>{recipe.title}</span>
      {editMode && onDelete ? (
        <button
          className={styles.deleteBtn}
          onClick={e => { e.stopPropagation(); if (confirm(`Delete "${recipe.title}"?`)) onDelete(recipe.id); }}
          title="Delete recipe"
        >
          &minus;
        </button>
      ) : onAdd ? (
        <button
          className={styles.addBtn}
          onClick={e => { e.stopPropagation(); onAdd(recipe.id); }}
          title="Add to this week"
        >
          +
        </button>
      ) : null}
    </div>
  );
}
