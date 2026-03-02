import React, { useState, useEffect } from 'react';
import { loadSharedRecipe, loadUserData, saveField } from '../utils/firestoreSync';
import styles from './SharedRecipePage.module.css';

const PENDING_SHARE_KEY = 'sunday-pending-shared-recipe';

const VOLUME_UNITS = new Set([
  'tsp', 'teaspoon', 'teaspoons', 'tbsp', 'tablespoon', 'tablespoons',
  'fl oz', 'cup', 'cups', 'pint', 'pints', 'quart', 'quarts',
  'gallon', 'gallons', 'liter', 'liters', 'l', 'ml',
  'pinch', 'dash', 'smidgen', 'can', 'cans', 'handful', 'handfuls', 'bunch', 'bunches',
]);
const WEIGHT_UNITS = new Set([
  'g', 'gram', 'grams', 'kg', 'oz', 'ounce', 'ounces',
  'lb', 'lbs', 'pound', 'pounds', 'clove', 'cloves', 'slice', 'slices',
  'stick', 'sticks', 'piece', 'pieces', 'head', 'heads',
  'stalk', 'stalks', 'sprig', 'sprigs',
  'whole', 'each', 'large', 'medium', 'small',
]);

const LIQUIDS = new Set([
  'water', 'milk', 'cream', 'half and half', 'half-and-half', 'buttermilk',
  'broth', 'stock', 'chicken broth', 'beef broth', 'vegetable broth',
  'chicken stock', 'beef stock', 'vegetable stock', 'bone broth',
  'juice', 'orange juice', 'lemon juice', 'lime juice', 'apple juice',
  'oil', 'olive oil', 'vegetable oil', 'canola oil', 'coconut oil', 'sesame oil', 'avocado oil',
  'vinegar', 'apple cider vinegar', 'balsamic vinegar', 'red wine vinegar', 'white vinegar', 'rice vinegar',
  'wine', 'red wine', 'white wine', 'cooking wine', 'beer',
  'soy sauce', 'fish sauce', 'hot sauce', 'worcestershire sauce', 'teriyaki sauce',
  'maple syrup', 'honey', 'agave', 'corn syrup', 'molasses',
  'vanilla extract', 'extract', 'almond extract',
  'coffee', 'espresso', 'tea',
  'coconut milk', 'almond milk', 'oat milk', 'soy milk',
  'heavy cream', 'whipping cream', 'sour cream',
]);

const OZ_PATTERN = /^(oz|ounce|ounces)$/i;

function displayMeasurement(measurement, ingredientName) {
  if (!measurement) return '';
  if (!ingredientName) return measurement;
  const name = ingredientName.trim().toLowerCase();
  let liquid = LIQUIDS.has(name);
  if (!liquid) {
    for (const l of LIQUIDS) {
      if (name.includes(l) || l.includes(name)) { liquid = true; break; }
    }
  }
  if (liquid && OZ_PATTERN.test(measurement.trim())) return 'fl oz';
  return measurement;
}

function classifyUnit(measurement) {
  if (!measurement) return null;
  const unit = measurement.trim().toLowerCase().replace(/\(s\)$/i, '');
  if (!unit) return null;
  if (VOLUME_UNITS.has(unit)) return 'volume';
  if (WEIGHT_UNITS.has(unit)) return 'weight';
  return null;
}

export function SharedRecipePage({ token, user }) {
  const [recipe, setRecipe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSharedRecipe(token)
      .then(r => {
        if (r) setRecipe(r);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSave() {
    if (!recipe || !user || saving) return;
    setSaving(true);
    try {
      const newRecipe = {
        ...recipe,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      // Read current recipes from Firestore to avoid stale localStorage
      const userData = await loadUserData(user.uid);
      const existing = userData?.recipes || [];
      const next = [newRecipe, ...existing];
      // Await the Firestore write so it completes before user navigates away
      await saveField(user.uid, 'recipes', next);
      setSaved(true);
    } catch (err) {
      console.error('Save shared recipe error:', err);
    } finally {
      setSaving(false);
    }
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
            <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save to My Recipes'}
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
                <th>Amount</th>
                <th>Ingredient</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map((row, i) => {
                const amount = [row.quantity || '', displayMeasurement(row.measurement, row.ingredient)].filter(Boolean).join(' ');
                return (
                <tr key={i}>
                  <td>{amount}</td>
                  <td>{row.ingredient}</td>
                  <td>{row.notes || ''}</td>
                </tr>
                );
              })}
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
