import React, { useState, useEffect } from 'react';
import { loadSharedRecipe, saveField } from '../utils/firestoreSync';
import { auth } from '../firebase';
import styles from './SharedRecipePage.module.css';

const STORAGE_KEY = 'recipe-tracker-recipes';
const PENDING_SHARE_KEY = 'sunday-pending-shared-recipe';

function saveRecipeToProfile(recipe) {
  const newRecipe = {
    ...recipe,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  // Remove the original id so it doesn't clash
  delete newRecipe.originalId;

  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const next = [newRecipe, ...existing];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    const user = auth.currentUser;
    if (user) saveField(user.uid, 'recipes', next);
  } catch {}
  return newRecipe;
}

export function SharedRecipePage({ token, user }) {
  const [recipe, setRecipe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSharedRecipe(token)
      .then(r => {
        if (r) setRecipe(r);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  function handleSave() {
    if (!recipe) return;
    saveRecipeToProfile(recipe);
    setSaved(true);
  }

  function handleSaveAndSignUp() {
    if (!recipe) return;
    // Stash recipe so it can be imported after sign-up/login
    try {
      localStorage.setItem(PENDING_SHARE_KEY, JSON.stringify(recipe));
    } catch {}
    // Navigate to home (login page)
    window.location.href = window.location.origin;
  }

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

      {user ? (
        <div className={styles.saveRow}>
          {saved ? (
            <span className={styles.savedMsg}>Recipe saved to your profile!</span>
          ) : (
            <button className={styles.saveBtn} onClick={handleSave}>
              Save to My Recipes
            </button>
          )}
        </div>
      ) : (
        <div className={styles.saveRow}>
          <button className={styles.saveBtn} onClick={handleSaveAndSignUp}>
            Sign up to save this recipe
          </button>
        </div>
      )}

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
