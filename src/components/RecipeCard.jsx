import styles from './RecipeCard.module.css';

export function RecipeCard({ recipe, onClick }) {
  return (
    <div className={styles.card} onClick={() => onClick(recipe.id)}>
      <h3 className={styles.title}>{recipe.title}</h3>
      {recipe.description && (
        <p className={styles.description}>{recipe.description}</p>
      )}
      <span className={styles.meta}>
        {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? 's' : ''}
      </span>
    </div>
  );
}
