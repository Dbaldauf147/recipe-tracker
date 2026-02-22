import { useState, useEffect, useMemo } from 'react';
import { loadUserData } from '../utils/firestoreSync';
import styles from './RecipePickerPage.module.css';

const ADMIN_UID = import.meta.env.VITE_ADMIN_UID;

const CATEGORIES = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch-dinner', label: 'Lunch & Dinner' },
  { key: 'snacks', label: 'Snacks' },
  { key: 'desserts', label: 'Desserts' },
  { key: 'drinks', label: 'Drinks' },
];

export function RecipePickerPage({ onComplete }) {
  const [adminRecipes, setAdminRecipes] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchAdminRecipes() {
      try {
        const data = await loadUserData(ADMIN_UID);
        if (cancelled) return;
        const recipes = data?.recipes || [];
        setAdminRecipes(recipes);
        // Pre-select all recipes
        setSelected(new Set(recipes.map(r => r.id)));
      } catch (err) {
        if (!cancelled) setError('Failed to load starter recipes');
        console.error('Failed to load admin recipes:', err);
      }
    }
    fetchAdminRecipes();
    return () => { cancelled = true; };
  }, []);

  const grouped = useMemo(() => {
    if (!adminRecipes) return null;
    const groups = {};
    for (const cat of CATEGORIES) groups[cat.key] = [];
    for (const recipe of adminRecipes) {
      const key = recipe.category || 'lunch-dinner';
      if (groups[key]) {
        groups[key].push(recipe);
      } else {
        groups['lunch-dinner'].push(recipe);
      }
    }
    // Sort alphabetically within each group
    for (const cat of CATEGORIES) {
      groups[cat.key].sort((a, b) => a.title.localeCompare(b.title));
    }
    return groups;
  }, [adminRecipes]);

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (!adminRecipes) return;
    setSelected(new Set(adminRecipes.map(r => r.id)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  function handleSubmit() {
    const chosen = (adminRecipes || []).filter(r => selected.has(r.id));
    onComplete(chosen);
  }

  function ingredientCount(recipe) {
    return (recipe.ingredients || []).length;
  }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <img className={styles.logo} src="/sunday-logo.png" alt="Sunday" />
          <p className={styles.error}>{error}</p>
          <button className={styles.startBtn} onClick={() => onComplete([])}>
            Skip &amp; Get Started
          </button>
        </div>
      </div>
    );
  }

  if (!adminRecipes) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <img className={styles.logo} src="/sunday-logo.png" alt="Sunday" />
          <div className={styles.spinner} />
          <p className={styles.loadingText}>Loading starter recipes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <img className={styles.logo} src="/sunday-logo.png" alt="Sunday" />
        <h2 className={styles.title}>Pick some recipes to get started</h2>
        <p className={styles.subtitle}>(You can always add or remove recipes later)</p>

        <div className={styles.actions}>
          <button className={styles.actionBtn} onClick={selectAll}>Select All</button>
          <button className={styles.actionBtn} onClick={deselectAll}>Deselect All</button>
        </div>

        <div className={styles.recipeList}>
          {CATEGORIES.map(cat => {
            const recipes = grouped[cat.key];
            if (recipes.length === 0) return null;
            return (
              <div key={cat.key} className={styles.categoryGroup}>
                <h3 className={styles.categoryLabel}>{cat.label}</h3>
                {recipes.map(recipe => (
                  <div
                    key={recipe.id}
                    className={`${styles.recipeRow} ${selected.has(recipe.id) ? styles.recipeRowSelected : ''}`}
                    onClick={() => toggle(recipe.id)}
                  >
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={selected.has(recipe.id)}
                      onChange={() => toggle(recipe.id)}
                      onClick={e => e.stopPropagation()}
                    />
                    <span className={styles.recipeTitle}>{recipe.title}</span>
                    <span className={styles.ingredientCount}>
                      {ingredientCount(recipe)} ingredient{ingredientCount(recipe) !== 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <p className={styles.counter}>{selected.size} recipe{selected.size !== 1 ? 's' : ''} selected</p>

        <button className={styles.startBtn} onClick={handleSubmit}>
          Get Started
        </button>
      </div>
    </div>
  );
}
