import { useState, useMemo } from 'react';
import { useRecipes } from '../hooks/useRecipes';
import { loadStarterRecipes } from '../utils/starterRecipes';
import { fetchRecipeFromUrl } from '../utils/fetchRecipeFromUrl';
import { fetchInstagramCaption } from '../utils/fetchInstagramCaption';
import { parseRecipeText } from '../utils/parseRecipeText';
import { RecipeForm } from './RecipeForm';
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
  const { importRecipes, addRecipe } = useRecipes();
  const [status, setStatus] = useState(null); // { type: 'loading'|'success'|'error', message }

  // Paste text mode
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // URL import step
  const [urlMode, setUrlMode] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [parsedRecipe, setParsedRecipe] = useState(null);

  // Manual add mode
  const [manualMode, setManualMode] = useState(false);

  // Instagram import mode
  const [instagramMode, setInstagramMode] = useState(false);
  const [instagramUrl, setInstagramUrl] = useState('');
  const [instagramCaption, setInstagramCaption] = useState('');

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

  async function handleFetchStarter() {
    setStatus({ type: 'loading', message: 'Fetching starter recipes...' });
    try {
      const recipes = await loadStarterRecipes();
      if (recipes.length === 0) {
        setStatus({ type: 'error', message: 'No recipes found. Please try again later.' });
        return;
      }
      setFetchedRecipes(recipes);
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
    const toImport = filteredRecipes
      .filter(r => checkedRecipes.has(r.title))
      .map(r => ({ ...r, source: 'starter' }));
    if (toImport.length === 0) return;
    importRecipes(toImport);
    setStatus({ type: 'success', message: `Imported ${toImport.length} recipe${toImport.length === 1 ? '' : 's'}!` });
    setTimeout(() => onComplete(), 1200);
  }

  async function handleFetchFromUrl() {
    const url = sourceUrl.trim();
    if (!url) return;
    setFetching(true);
    setFetchError('');
    try {
      const recipe = await fetchRecipeFromUrl(url);
      setParsedRecipe(recipe);
    } catch (err) {
      setFetchError(err.message || 'Failed to fetch recipe from URL.');
    } finally {
      setFetching(false);
    }
  }

  function handleUrlRecipeSave(data) {
    addRecipe({ ...data, source: data.source || 'url' });
    setStatus({ type: 'success', message: 'Recipe imported!' });
    setParsedRecipe(null);
    setUrlMode(false);
    setSourceUrl('');
    setTimeout(() => onComplete(), 1200);
  }

  async function handleFetchInstagramCaption() {
    const url = instagramUrl.trim();
    if (!url) return;
    setFetching(true);
    setFetchError('');
    try {
      const caption = await fetchInstagramCaption(url);
      setInstagramCaption(caption);
    } catch (err) {
      setFetchError(err.message || 'Failed to fetch Instagram caption.');
    } finally {
      setFetching(false);
    }
  }

  function handleParseInstagram() {
    const text = instagramCaption.trim();
    if (!text) return;
    const recipe = parseRecipeText(text);
    recipe.sourceUrl = instagramUrl.trim();
    recipe.source = 'instagram';
    setParsedRecipe(recipe);
    setInstagramMode(false);
  }

  function handleManualSave(data) {
    addRecipe({ ...data, source: 'manual' });
    setStatus({ type: 'success', message: 'Recipe added!' });
    setManualMode(false);
    setTimeout(() => onComplete(), 1200);
  }

  // ── Manual recipe entry ──
  if (manualMode) {
    return (
      <div className={styles.page}>
        <div className={styles.reviewCard}>
          <button className={styles.backBtn} onClick={() => setManualMode(false)}>
            &larr; Back
          </button>
          <RecipeForm
            onSave={handleManualSave}
            onCancel={() => setManualMode(false)}
          />
        </div>
      </div>
    );
  }

  // ── Paste text step ──
  if (pasteMode) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <img className={styles.logo} src="/sunday-logo.png" alt="Sunday" />
          <h2 className={styles.title}>Paste Recipe Text</h2>
          <p className={styles.subtitle}>Paste your recipe below and we'll parse it automatically</p>

          <textarea
            className={styles.urlInput}
            rows={10}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder={"Chicken Parmesan\n\nIngredients:\n2 chicken breasts\n1 cup breadcrumbs\n...\n\nInstructions:\n1. Preheat oven to 400°F\n..."}
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />

          <div className={styles.bottomActions}>
            <button className={styles.backBtn} onClick={() => { setPasteMode(false); setPasteText(''); }}>
              &larr; Back
            </button>
            <button
              className={styles.importBtn}
              onClick={() => {
                const recipe = parseRecipeText(pasteText.trim());
                recipe.source = 'paste';
                setParsedRecipe(recipe);
                setPasteMode(false);
              }}
              disabled={!pasteText.trim()}
            >
              Parse Recipe
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Instagram import step ──
  if (instagramMode) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <img className={styles.logo} src="/sunday-logo.png" alt="Sunday" />
          <h2 className={styles.title}>Import from Instagram</h2>
          <p className={styles.subtitle}>Paste an Instagram post link or the caption text</p>

          <div className={styles.urlInputGroup}>
            <input
              className={styles.urlInput}
              type="url"
              value={instagramUrl}
              onChange={e => setInstagramUrl(e.target.value)}
              placeholder="https://www.instagram.com/p/..."
              disabled={fetching}
              onKeyDown={e => { if (e.key === 'Enter' && instagramUrl.trim()) handleFetchInstagramCaption(); }}
            />
            <button
              className={styles.importBtn}
              onClick={handleFetchInstagramCaption}
              disabled={!instagramUrl.trim() || fetching}
            >
              {fetching ? 'Fetching...' : 'Fetch Caption'}
            </button>
          </div>

          {fetchError && (
            <div className={`${styles.status} ${styles.statusError}`}>
              {fetchError}
            </div>
          )}

          <p className={styles.subtitle} style={{ marginTop: '1rem' }}>
            Or paste the caption text directly:
          </p>
          <textarea
            className={styles.urlInput}
            rows={6}
            value={instagramCaption}
            onChange={e => setInstagramCaption(e.target.value)}
            placeholder="Paste recipe caption here..."
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />

          <div className={styles.bottomActions}>
            <button className={styles.backBtn} onClick={() => { setInstagramMode(false); setFetchError(''); setInstagramUrl(''); setInstagramCaption(''); }}>
              &larr; Back
            </button>
            <button
              className={styles.importBtn}
              onClick={handleParseInstagram}
              disabled={!instagramCaption.trim()}
            >
              Parse Recipe
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Review step for URL-imported recipe ──
  if (parsedRecipe) {
    return (
      <div className={styles.page}>
        <div className={styles.reviewCard}>
          <button className={styles.backBtn} onClick={() => setParsedRecipe(null)}>
            &larr; Back
          </button>
          <RecipeForm
            recipe={parsedRecipe}
            onSave={handleUrlRecipeSave}
            onCancel={() => setParsedRecipe(null)}
          />
        </div>
      </div>
    );
  }

  // ── URL input step ──
  if (urlMode) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <img className={styles.logo} src="/sunday-logo.png" alt="Sunday" />
          <h2 className={styles.title}>Import from URL</h2>
          <p className={styles.subtitle}>Paste a link to any recipe page</p>

          <div className={styles.urlInputGroup}>
            <input
              className={styles.urlInput}
              type="url"
              value={sourceUrl}
              onChange={e => setSourceUrl(e.target.value)}
              placeholder="https://www.allrecipes.com/recipe/..."
              disabled={fetching}
              onKeyDown={e => { if (e.key === 'Enter' && sourceUrl.trim()) handleFetchFromUrl(); }}
            />
            <button
              className={styles.importBtn}
              onClick={handleFetchFromUrl}
              disabled={!sourceUrl.trim() || fetching}
            >
              {fetching ? 'Fetching...' : 'Fetch Recipe'}
            </button>
          </div>

          {fetchError && (
            <div className={`${styles.status} ${styles.statusError}`}>
              {fetchError}
            </div>
          )}

          <div className={styles.bottomActions}>
            <button className={styles.backBtn} onClick={() => { setUrlMode(false); setFetchError(''); setSourceUrl(''); }}>
              &larr; Back
            </button>
          </div>
        </div>
      </div>
    );
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
        <h2 className={styles.title}>Where are your recipes today?</h2>
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
          <div className={styles.optionCard} onClick={() => setManualMode(true)}>
            <span className={styles.optionIcon}>+</span>
            <div className={styles.optionText}>
              <span className={styles.optionTitle}>Add a Recipe Manually</span>
              <span className={styles.optionDesc}>Enter your recipe details by hand</span>
            </div>
          </div>

          <div className={styles.optionCard} onClick={() => setUrlMode(true)}>
            <span className={styles.optionIcon}>{'\u{1F517}'}</span>
            <div className={styles.optionText}>
              <span className={styles.optionTitle}>Import from URL</span>
              <span className={styles.optionDesc}>Paste a link to any recipe website</span>
            </div>
          </div>

          <div className={styles.optionCard} onClick={() => setInstagramMode(true)}>
            <span className={styles.optionIcon}>{'\u{1F4F7}'}</span>
            <div className={styles.optionText}>
              <span className={styles.optionTitle}>Import from Instagram</span>
              <span className={styles.optionDesc}>Fetch a recipe from an Instagram post</span>
            </div>
          </div>

          <div className={styles.optionCard} onClick={() => setPasteMode(true)}>
            <span className={styles.optionIcon}>{'\u{1F4CB}'}</span>
            <div className={styles.optionText}>
              <span className={styles.optionTitle}>Paste Recipe Text</span>
              <span className={styles.optionDesc}>Paste a recipe and we'll parse it for you</span>
            </div>
          </div>

          <div className={styles.optionCard} onClick={handleFetchStarter}>
            <span className={styles.optionIcon}>{'\u2B50'}</span>
            <div className={styles.optionText}>
              <span className={styles.optionTitle}>Import Starter Recipes</span>
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
