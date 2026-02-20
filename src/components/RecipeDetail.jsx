import { NutritionPanel } from './NutritionPanel';
import styles from './RecipeDetail.module.css';

export function RecipeDetail({ recipe, onEdit, onDelete, onBack }) {
  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onBack}>
        &larr; Back to recipes
      </button>

      <h2 className={styles.title}>{recipe.title}</h2>

      {recipe.description && (
        <p className={styles.description}>{recipe.description}</p>
      )}

      {(recipe.servings || recipe.prepTime || recipe.cookTime) && (
        <p className={styles.servings}>
          {recipe.servings && <>Serves {recipe.servings}</>}
          {recipe.servings && recipe.prepTime && <> &middot; </>}
          {recipe.prepTime && <>Prep: {recipe.prepTime}</>}
          {(recipe.servings || recipe.prepTime) && recipe.cookTime && <> &middot; </>}
          {recipe.cookTime && <>Cook: {recipe.cookTime}</>}
        </p>
      )}

      {recipe.sourceUrl && (
        <p className={styles.sourceLink}>
          <a
            href={recipe.sourceUrl.startsWith('http') ? recipe.sourceUrl : `https://${recipe.sourceUrl}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View original recipe &#x2197;
          </a>
        </p>
      )}

      <div className={styles.columns}>
        <div className={styles.ingredientsCol}>
          <h3>Ingredients</h3>
          <table className={styles.ingredientTable}>
            <thead>
              <tr>
                <th>Quantity</th>
                <th>Measurement</th>
                <th>Ingredient</th>
              </tr>
            </thead>
            <tbody>
              {recipe.ingredients.map((item, i) => (
                <tr key={i}>
                  <td>{item.quantity}</td>
                  <td>{item.measurement}</td>
                  <td>{item.ingredient}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.nutritionCol}>
          <NutritionPanel ingredients={recipe.ingredients} servings={parseInt(recipe.servings) || 1} />
        </div>
      </div>

      <div className={styles.section}>
        <h3>Instructions</h3>
        <ol className={styles.steps}>
          {recipe.instructions
            .split('\n')
            .map(s => s.replace(/^\d+[\.\)]\s*/, '').trim())
            .filter(Boolean)
            .map((step, i) => (
              <li key={i} className={styles.step}>
                <span className={styles.stepLabel}>Step {i + 1}</span>
                {step}
              </li>
            ))}
        </ol>
      </div>

      <div className={styles.actions}>
        <button className={styles.editBtn} onClick={() => onEdit(recipe.id)}>
          Edit
        </button>
        <button
          className={styles.deleteBtn}
          onClick={() => {
            if (confirm('Delete this recipe?')) onDelete(recipe.id);
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
