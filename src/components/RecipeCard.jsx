import styles from './RecipeCard.module.css';

export function RecipeCard({ recipe, onClick, draggable = false }) {
  function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', recipe.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <button
      className={styles.link}
      onClick={() => onClick(recipe.id)}
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
    >
      {recipe.title}
    </button>
  );
}
