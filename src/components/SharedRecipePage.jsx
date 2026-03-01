import React, { useState, useEffect } from 'react';
import { loadSharedRecipe } from '../utils/firestoreSync';
import styles from './SharedRecipePage.module.css';

export function SharedRecipePage({ token }) {
  const [recipe, setRecipe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    loadSharedRecipe(token)
      .then(r => {
        if (r) setRecipe(r);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className={styles.loading}>Loading recipe...</div>;
  if (error || !recipe) return <div className={styles.error}>Recipe not found or link expired.</div>;

  const steps = (recipe.instructions || '')
    .split('\n')
    .map(s => s.replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean);

  const ingredients = (recipe.ingredients || []).filter(r => (r.ingredient || '').trim());

  return (
    <div className={styles.container}>
      {recipe.imageUrl && (
        <img className={styles.heroImg} src={recipe.imageUrl} alt={recipe.title} />
      )}

      <div className={styles.header}>
        <h1 className={styles.title}>{recipe.title}</h1>
        {recipe.description && <p className={styles.description}>{recipe.description}</p>}
        <div className={styles.meta}>
          {recipe.servings && (
            <span className={styles.metaItem}><strong>{recipe.servings}</strong> servings</span>
          )}
          {recipe.prepTime && (
            <span className={styles.metaItem}>Prep: <strong>{recipe.prepTime}</strong></span>
          )}
          {recipe.cookTime && (
            <span className={styles.metaItem}>Cook: <strong>{recipe.cookTime}</strong></span>
          )}
        </div>
      </div>

      {ingredients.length > 0 && (
        <div className={styles.section}>
          <h3>Ingredients</h3>
          <table className={styles.ingredientTable}>
            <thead>
              <tr>
                <th>Quantity</th>
                <th>Measurement</th>
                <th>Ingredient</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map((row, i) => (
                <tr key={i}>
                  <td>{row.quantity || ''}</td>
                  <td>{row.measurement || ''}</td>
                  <td>{row.ingredient}</td>
                  <td>{row.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {steps.length > 0 && (
        <div className={styles.section}>
          <h3>Instructions</h3>
          <ol className={styles.stepsList}>
            {steps.map((step, i) => (
              <li key={i} className={styles.stepItem}>
                <span className={styles.stepNumber}>{i + 1}</span>
                <span className={styles.stepText}>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className={styles.cta}>
        <p>Get Prep Day to save recipes and plan your week</p>
        <a className={styles.ctaBtn} href={window.location.origin}>Try Prep Day</a>
      </div>
    </div>
  );
}
