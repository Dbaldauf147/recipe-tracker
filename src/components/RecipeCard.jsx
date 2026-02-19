import styles from './RecipeCard.module.css';

export function RecipeCard({ recipe, onClick, draggable = false }) {
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
      {recipe.title}
    </div>
  );
}
