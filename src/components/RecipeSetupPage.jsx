import { useState, useRef, useMemo } from 'react';
import { useRecipes } from '../hooks/useRecipes';
import { parseDocxRecipes } from '../utils/parseDocx';
import { fetchRecipesFromSheet } from '../utils/sheetRecipes';
import styles from './RecipeSetupPage.module.css';

const MEAL_TYPE_LABELS = {
  meat: 'Meat',
  pescatarian: 'Pescatarian',
  vegan: 'Vegan',
  vegetarian: 'Vegetarian',
  '': 'Uncategorized',
};

const CATEGORY_LABELS = {
  breakfast: 'Breakfast',
  'lunch-dinner': 'Lunch & Dinner',
  drinks: 'Drinks',
  desserts: 'Desserts',
  snacks: 'Snacks',
};

const CATEGORY_ORDER = ['breakfast', 'lunch-dinner', 'snacks', 'desserts', 'drinks'];

export function RecipeSetupPage({ onComplete, onBack, onSkip }) {
  const { importRecipes } = useRecipes();
  const [status, setStatus] = useState(null); // { type: 'loading'|'success'|'error', message }
  const fileRef = useRef(null);

  // Starter-recipe filter step
  const [fetchedRecipes, setFetchedRecipes] = useState(null); // array when fetched
  const [selectedTypes, setSelectedTypes] = useState(new Set());
  const [checkedRecipes, setCheckedRecipes] = useState(new Set()); // individual recipe checkboxes

  // Derive available meal types from fetched recipes
  const availableTypes = useMemo(() => {
    if (!fetchedRecipes) return [];
    const types = new Set(fetchedRecipes.map(r => r.mealType || ''));
    // Fixed order: meat, pescatarian, vegetarian, vegan, then uncategorized last
    const order = ['meat', 'pescatarian', 'vegetarian', 'vegan', ''];
    return order.filter(t => types.has(t));
  }, [fetchedRecipes]);

  const filteredRecipes = useMemo(() => {
    if (!fetchedRecipes) return [];
    if (selectedTypes.size === 0) return fetchedRecipes;
    return fetchedRecipes.filter(r => selectedTypes.has(r.mealType || ''));
  }, [fetchedRecipes, selectedTypes]);

  // Group filtered recipes by category
  const groupedRecipes = useMemo(() => {
    const groups = {};
    for (const r of filteredRecipes) {
      const cat = r.category || 'lunch-dinner';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(r);
    }
    return CATEGORY_ORDER
      .filter(cat => groups[cat]?.length > 0)
      .map(cat => ({ category: cat, label: CATEGORY_LABELS[cat] || cat, recipes: groups[cat] }));
  }, [filteredRecipes]);

  async function handleDocxUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus({ type: 'loading', message: 'Parsing document...' });
    try {
      const recipes = await parseDocxRecipes(file);
      if (recipes.length === 0) {
        setStatus({ type: 'error', message: 'No recipes found in the document. Make sure recipe names are headings and ingredients are in lists.' });
        return;
      }
      importRecipes(recipes);
      setStatus({ type: 'success', message: `Imported ${recipes.length} recipe${recipes.length === 1 ? '' : 's'}!` });
      setTimeout(() => onComplete(), 1200);
    } catch (err) {
      console.error('Docx parse error:', err);
      setStatus({ type: 'error', message: 'Failed to parse the document. Please try a different .docx file.' });
    }
  }

  async function handleFetchStarter() {
    setStatus({ type: 'loading', message: 'Fetching starter recipes...' });
    try {
      const recipes = await fetchRecipesFromSheet();
      if (recipes.length === 0) {
        setStatus({ type: 'error', message: 'No recipes found. Please try again later.' });
        return;
      }
      const active = recipes.filter(r => (r.frequency || 'common') !== 'retired');
      setFetchedRecipes(active);
      setSelectedTypes(new Set()); // all selected by default (empty = all)
      setCheckedRecipes(new Set()); // none checked by default
      setStatus(null);
    } catch (err) {
      console.error('Starter recipes error:', err);
      setStatus({ type: 'error', message: 'Failed to fetch starter recipes. Please try again later.' });
    }
  }

  function toggleType(type) {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  function toggleRecipe(title) {
    setCheckedRecipes(prev => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  function toggleGroupAll(recipes, checked) {
    setCheckedRecipes(prev => {
      const next = new Set(prev);
      for (const r of recipes) {
        if (checked) next.add(r.title);
        else next.delete(r.title);
      }
      return next;
    });
  }

  const checkedCount = filteredRecipes.filter(r => checkedRecipes.has(r.title)).length;

  function handleImportFiltered() {
    const toImport = filteredRecipes.filter(r => checkedRecipes.has(r.title));
    if (toImport.length === 0) return;
    importRecipes(toImport);
    setStatus({ type: 'success', message: `Imported ${toImport.length} recipe${toImport.length === 1 ? '' : 's'}!` });
    setTimeout(() => onComplete(), 1200);
  }

  // ── Filter step after fetching starter recipes ──
  if (fetchedRecipes && !status) {
    return (
      <div className={styles.page}>
        <div className={styles.reviewCard}>
          <img className={styles.logo} src="/sunday-logo.png" alt="Sunday" />
          <h2 className={styles.title}>Filter by meal type</h2>
          <p className={styles.subtitle}>
            {checkedCount} of {filteredRecipes.length} recipes selected
          </p>

          <div className={styles.globalActions}>
            <button
              className={styles.selectAllBtn}
              onClick={() => toggleGroupAll(filteredRecipes, checkedCount < filteredRecipes.length)}
            >
              {checkedCount === filteredRecipes.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div className={styles.filterPills}>
            {availableTypes.map(type => {
              const active = selectedTypes.size === 0 || selectedTypes.has(type);
              const count = fetchedRecipes.filter(r => (r.mealType || '') === type).length;
              return (
                <button
                  key={type || '_none'}
                  className={`${styles.filterPill} ${active ? styles.filterPillActive : ''}`}
                  onClick={() => toggleType(type)}
                >
                  {MEAL_TYPE_LABELS[type] || type} ({count})
                </button>
              );
            })}
          </div>

          {groupedRecipes.map(group => {
            const groupChecked = group.recipes.filter(r => checkedRecipes.has(r.title)).length;
            return (
              <div key={group.category} className={styles.recipeGroup}>
                <h3 className={styles.groupTitle}>{group.label} ({groupChecked}/{group.recipes.length})</h3>
                <div className={styles.recipeTable}>
                  {group.recipes.map(r => (
                    <div
                      key={r.title}
                      className={`${styles.recipeRow} ${checkedRecipes.has(r.title) ? '' : styles.recipeRowUnchecked}`}
                      onClick={() => toggleRecipe(r.title)}
                    >
                      <input
                        type="checkbox"
                        className={styles.recipeCheckbox}
                        checked={checkedRecipes.has(r.title)}
                        onChange={() => toggleRecipe(r.title)}
                        onClick={e => e.stopPropagation()}
                      />
                      <span className={styles.recipeName}>{r.title}</span>
                      {r.mealType && (
                        <span className={styles.recipeTag}>{MEAL_TYPE_LABELS[r.mealType] || r.mealType}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className={styles.bottomActions}>
            <button className={styles.backBtn} onClick={() => setFetchedRecipes(null)}>
              &larr; Back
            </button>
            <button
              className={styles.importBtn}
              onClick={handleImportFiltered}
              disabled={checkedCount === 0}
            >
              Import {checkedCount} recipe{checkedCount === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <img className={styles.logo} src="/sunday-logo.png" alt="Sunday" />
        <h2 className={styles.title}>How would you like to set up your recipes?</h2>
        <p className={styles.subtitle}>You can always add more recipes later</p>

        {status && (
          <div className={`${styles.status} ${
            status.type === 'loading' ? styles.statusLoading :
            status.type === 'success' ? styles.statusSuccess :
            styles.statusError
          }`}>
            {status.message}
          </div>
        )}

        <div className={styles.optionList}>
          <div className={styles.optionCard} onClick={() => onComplete()}>
            <span className={styles.optionIcon}>+</span>
            <div className={styles.optionText}>
              <span className={styles.optionTitle}>Add a Recipe</span>
              <span className={styles.optionDesc}>Start fresh and add recipes manually in the app</span>
            </div>
          </div>

          <div className={styles.optionCard} onClick={() => fileRef.current?.click()}>
            <span className={styles.optionIcon}>{'\u{1F4C4}'}</span>
            <div className={styles.optionText}>
              <span className={styles.optionTitle}>Import from Word Document</span>
              <span className={styles.optionDesc}>Upload a .docx file with your recipes</span>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".docx"
            className={styles.fileInput}
            onChange={handleDocxUpload}
          />

          <div className={styles.optionCard} onClick={handleFetchStarter}>
            <span className={styles.optionIcon}>{'\u2B50'}</span>
            <div className={styles.optionText}>
              <span className={styles.optionTitle}>Dan's Starter Recipes</span>
              <span className={styles.optionDesc}>Import a curated set of recipes to get started</span>
            </div>
          </div>
        </div>

        <div className={styles.bottomActions}>
          {onBack && (
            <button className={styles.backBtn} onClick={onBack}>
              &larr; Back
            </button>
          )}
        </div>
        {onSkip && (
          <button className={styles.skipBtn} onClick={onSkip}>
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
