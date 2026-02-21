import styles from './RecipeCard.module.css';

export function RecipeCard({ recipe, onClick, draggable = false, onAdd }) {
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
      {onAdd && (
        <button
          className={styles.addBtn}
          onClick={e => { e.stopPropagation(); onAdd(recipe.id); }}
          title="Add to this week"
        >
          +
        </button>
      )}
    </div>
  );
}
