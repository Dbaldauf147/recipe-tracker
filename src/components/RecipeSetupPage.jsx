import { useState, useRef } from 'react';
import { useRecipes } from '../hooks/useRecipes';
import { parseDocxRecipes } from '../utils/parseDocx';
import { fetchRecipesFromSheet } from '../utils/sheetRecipes';
import styles from './RecipeSetupPage.module.css';

export function RecipeSetupPage({ onComplete, onBack, onSkip }) {
  const { importRecipes } = useRecipes();
  const [status, setStatus] = useState(null); // { type: 'loading'|'success'|'error', message }
  const fileRef = useRef(null);

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

  async function handleStarterRecipes() {
    setStatus({ type: 'loading', message: 'Fetching starter recipes...' });
    try {
      const recipes = await fetchRecipesFromSheet();
      if (recipes.length === 0) {
        setStatus({ type: 'error', message: 'No recipes found. Please try again later.' });
        return;
      }
      importRecipes(recipes);
      setStatus({ type: 'success', message: `Imported ${recipes.length} recipe${recipes.length === 1 ? '' : 's'}!` });
      setTimeout(() => onComplete(), 1200);
    } catch (err) {
      console.error('Starter recipes error:', err);
      setStatus({ type: 'error', message: 'Failed to fetch starter recipes. Please try again later.' });
    }
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

          <div className={styles.optionCard} onClick={handleStarterRecipes}>
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
