import { useState } from 'react';
import { RecipeCard } from './RecipeCard';
import { fetchRecipesFromSheet } from '../utils/sheetRecipes';
import styles from './RecipeList.module.css';

export function RecipeList({ recipes, onSelect, onAdd, onImport }) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  async function handleImport() {
    setImporting(true);
    setImportResult(null);
    try {
      const sheetRecipes = await fetchRecipesFromSheet();
      const existingTitles = new Set(recipes.map(r => r.title.toLowerCase()));
      const newCount = sheetRecipes.filter(r => !existingTitles.has(r.title.toLowerCase())).length;
      onImport(sheetRecipes);
      setImportResult(`Imported ${newCount} new recipe${newCount !== 1 ? 's' : ''} (${sheetRecipes.length - newCount} already existed)`);
    } catch (err) {
      setImportResult('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.heading}>My Recipes</h2>
        <div className={styles.actions}>
          <button
            className={styles.importBtn}
            onClick={handleImport}
            disabled={importing}
          >
            {importing ? 'Importing...' : 'Import from Sheet'}
          </button>
          <button className={styles.addBtn} onClick={onAdd}>
            + Add Recipe
          </button>
        </div>
      </div>

      {importResult && (
        <p className={styles.importResult}>{importResult}</p>
      )}

      {recipes.length === 0 ? (
        <p className={styles.empty}>
          No recipes yet. Add your first one!
        </p>
      ) : (
        <div className={styles.grid}>
          {recipes.map(recipe => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onClick={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
