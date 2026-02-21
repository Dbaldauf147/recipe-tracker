import { useState } from 'react';
import { NutritionPanel } from './NutritionPanel';
import styles from './RecipeDetail.module.css';

const STOP_WORDS = new Set([
  'the','a','an','and','or','with','in','on','of','for','my','our','easy',
  'best','quick','simple','classic','homemade','style','recipe',
]);

function buildImageUrl(recipe) {
  const words = recipe.title.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  const keywords = words.slice(0, 2).join(',');
  let hash = 0;
  for (const ch of recipe.id) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return `https://loremflickr.com/800/400/food,${keywords}?lock=${Math.abs(hash)}`;
}

export function RecipeDetail({ recipe, onEdit, onDelete, onBack }) {
  const [imgError, setImgError] = useState(false);

  if (!recipe) {
    return (
      <div className={styles.container}>
        <button className={styles.backBtn} onClick={onBack}>
          &larr; Back to recipes
        </button>
        <p>Recipe not found.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onBack}>
        &larr; Back to recipes
      </button>

      {!imgError && (
        <div className={styles.heroWrap}>
          <img
            className={styles.heroImg}
            src={buildImageUrl(recipe)}
            alt={recipe.title}
            onError={() => setImgError(true)}
          />
        </div>
      )}

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
          <NutritionPanel recipeId={recipe.id} ingredients={recipe.ingredients} servings={parseInt(recipe.servings) || 1} />
        </div>
      </div>

      <div className={styles.section}>
        <h3>Instructions</h3>
        <ol className={styles.steps}>
          {(recipe.instructions || '')
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
