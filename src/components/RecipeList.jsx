import { RecipeCard } from './RecipeCard';
import styles from './RecipeList.module.css';

export function RecipeList({ recipes, onSelect, onAdd }) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.heading}>My Recipes</h2>
        <button className={styles.addBtn} onClick={onAdd}>
          + Add Recipe
        </button>
      </div>

      {recipes.length === 0 ? (
        <p className={styles.empty}>
          No recipes yet. Add your first one!
        </p>
      ) : (
        <div className={styles.grid}>
          {recipes.map(recipe => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onClick={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
