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

const PLURAL_UNITS = {
  cup: 'cups', cups: 'cups',
  scoop: 'scoops', scoops: 'scoops',
  tablespoon: 'tablespoons', tablespoons: 'tablespoons',
  teaspoon: 'teaspoons', teaspoons: 'teaspoons',
};

function displayMeasurement(measurement, ingredientName, qty) {
  if (!measurement) return '';
  const trimmed = measurement.trim();
  if (ingredientName) {
    const name = ingredientName.trim().toLowerCase();
    let liquid = LIQUIDS.has(name);
    if (!liquid) {
      for (const l of LIQUIDS) {
        if (name.includes(l) || l.includes(name)) { liquid = true; break; }
      }
    }
    if (liquid && OZ_PATTERN.test(trimmed)) return 'fl oz';
  }
  const num = parseFloat(qty);
  const key = trimmed.toLowerCase().replace(/\(s\)$/i, '');
  if (key in PLURAL_UNITS) {
    if (!isNaN(num) && num > 1) return PLURAL_UNITS[key];
    return PLURAL_UNITS[key].replace(/s$/, '');
  }
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
  // Kept beside the recipe, not inside it — see loadSharedRecipe.
  const [sharedByName, setSharedByName] = useState('');

  useEffect(() => {
    loadSharedRecipe(token)
      .then(r => {
        if (r?.recipe) { setRecipe(r.recipe); setSharedByName(r.sharedByName || ''); }
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

  const sharedBy = sharedByName.trim();

  return (
    <div className={styles.page}>
      {/* This page is the only Prep Day most of its visitors will ever see:
          somebody was sent a link by a friend and has no idea what this is.
          It carried a bare recipe and one line of pitch at the very bottom,
          which is past the instructions and past the point anyone is still
          reading. The brand goes at the top, where the question "what am I
          looking at" is actually asked. */}
      <header className={styles.brandBar}>
        <a className={styles.brandLink} href={window.location.origin}>
          <img className={styles.brandLogo} src="/prep-day-logo.png" alt="" />
          <span className={styles.brandName}>Prep Day</span>
        </a>
        <a className={styles.brandCta} href={window.location.origin}>Try it free</a>
      </header>

      <div className={styles.container}>
      <div className={styles.header}>
        <p className={styles.sharedTag}>
          {sharedBy ? `${sharedBy} shared a recipe with you` : 'A recipe was shared with you'}
        </p>
        <h1 className={styles.title}>{recipe.title}</h1>
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
                const amount = [row.quantity || '', displayMeasurement(row.measurement, row.ingredient, row.quantity)].filter(Boolean).join(' ');
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

      {/* The pitch, at the end, where someone who has just read a recipe they
          liked is the most receptive they will ever be. Three things the app
          does, not adjectives about it. */}
      <div className={styles.cta}>
        <img className={styles.ctaLogo} src="/prep-day-logo.png" alt="" />
        <h2 className={styles.ctaTitle}>Keep this recipe</h2>
        <p className={styles.ctaText}>
          Prep Day saves the recipes you actually cook, turns the week's meals into one
          shopping list, and keeps track of what you ate.
        </p>
        <ul className={styles.ctaPoints}>
          <li>Save recipes from anywhere — a photo, a link, or a friend</li>
          <li>Plan the week and get the shopping list built for you</li>
          <li>Track meals, weight and habits in one place</li>
        </ul>
        <a className={styles.ctaBtn} href={window.location.origin}>Get Prep Day — it's free</a>
        <p className={styles.ctaFine}>No card needed. Works on the web and on iPhone.</p>
      </div>
      </div>

      <footer className={styles.footer}>
        <img className={styles.footerLogo} src="/prep-day-logo.png" alt="" />
        <span>Prep Day · <a href={window.location.origin}>prep-day.com</a></span>
      </footer>
    </div>
  );
}
