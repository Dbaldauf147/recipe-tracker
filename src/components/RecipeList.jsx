import { useState } from 'react';
import { RecipeCard } from './RecipeCard';
import { fetchRecipesFromSheet } from '../utils/sheetRecipes';
import styles from './RecipeList.module.css';

const CATEGORIES = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch-dinner', label: 'Lunch & Dinner' },
  { key: 'snacks', label: 'Snacks' },
  { key: 'desserts', label: 'Desserts' },
  { key: 'drinks', label: 'Drinks' },
];

const MAIN_CATS = CATEGORIES.filter(c => c.key === 'breakfast' || c.key === 'lunch-dinner');
const SIDE_CATS = CATEGORIES.filter(c => c.key === 'snacks' || c.key === 'desserts' || c.key === 'drinks');

export function RecipeList({
  recipes,
  onSelect,
  onAdd,
  onImport,
  weeklyPlan,
  onAddToWeek,
  onRemoveFromWeek,
  onClearWeek,
  onCategoryChange,
  getRecipe,
  onSaveToHistory,
}) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dragOverTarget, setDragOverTarget] = useState(null);
  const [freqFilter, setFreqFilter] = useState('common');
  const [checkedTypes, setCheckedTypes] = useState(new Set());

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

  // Collect unique meal types for filter buttons
  const mealTypes = [...new Set(recipes.map(r => r.mealType).filter(Boolean))].sort();

  // Filter by frequency and meal type, then group by category
  let visible = freqFilter === 'all'
    ? recipes
    : recipes.filter(r => (r.frequency || 'common') === freqFilter);
  if (checkedTypes.size > 0) {
    visible = visible.filter(r => checkedTypes.has(r.mealType || ''));
  }

  const grouped = {};
  for (const cat of CATEGORIES) {
    grouped[cat.key] = [];
  }
  for (const recipe of visible) {
    const key = recipe.category || 'lunch-dinner';
    if (grouped[key]) {
      grouped[key].push(recipe);
    } else if (key === 'snacks-desserts') {
      grouped['snacks'].push(recipe);
    } else {
      grouped['lunch-dinner'].push(recipe);
    }
  }
  for (const cat of CATEGORIES) {
    grouped[cat.key].sort((a, b) => a.title.localeCompare(b.title));
  }

  // Weekly plan recipes
  const weeklyRecipes = weeklyPlan
    .map(id => getRecipe(id))
    .filter(Boolean);

  // Drag handlers for category columns
  function handleColumnDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleColumnDrop(e, categoryKey) {
    e.preventDefault();
    setDragOverTarget(null);
    const recipeId = e.dataTransfer.getData('text/plain');
    if (recipeId) {
      onCategoryChange(recipeId, categoryKey);
    }
  }

  // Drag handlers for weekly plan box
  function handleWeekDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function handleWeekDrop(e) {
    e.preventDefault();
    setDragOverTarget(null);
    const recipeId = e.dataTransfer.getData('text/plain');
    if (recipeId) {
      onAddToWeek(recipeId);
    }
  }

  function handleDragEnter(target) {
    setDragOverTarget(target);
  }

  function handleDragLeave(e, target) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      if (dragOverTarget === target) setDragOverTarget(null);
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

      <div className={styles.filterRow}>
        <div className={styles.filterBar}>
          {[
            { key: 'all', label: 'All' },
            { key: 'common', label: 'Common' },
            { key: 'rare', label: 'Rare' },
            { key: 'retired', label: 'Retired' },
          ].map(opt => (
            <button
              key={opt.key}
              className={`${styles.filterBtn} ${freqFilter === opt.key ? styles.filterBtnActive : ''}`}
              onClick={() => setFreqFilter(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {mealTypes.length > 0 && (
          <div className={styles.checkboxGroup}>
            <span className={styles.checkboxLabel}>Meal Type</span>
            {mealTypes.map(type => (
              <label key={type} className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={checkedTypes.has(type)}
                  onChange={() => {
                    setCheckedTypes(prev => {
                      const next = new Set(prev);
                      if (next.has(type)) next.delete(type);
                      else next.add(type);
                      return next;
                    });
                  }}
                />
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* This Week's Menu */}
      <div
        id="weekly-menu"
        className={`${styles.weekBox} ${dragOverTarget === 'weekly' ? styles.weekBoxDragOver : ''}`}
        onDragOver={handleWeekDragOver}
        onDrop={handleWeekDrop}
        onDragEnter={() => handleDragEnter('weekly')}
        onDragLeave={e => handleDragLeave(e, 'weekly')}
      >
        <div className={styles.weekHeader}>
          <h3 className={styles.weekHeading}>This Week's Menu</h3>
          {weeklyRecipes.length > 0 && (
            <div className={styles.weekActions}>
              <button className={styles.saveHistoryBtn} onClick={onSaveToHistory}>
                Save to History
              </button>
              <button className={styles.clearBtn} onClick={onClearWeek}>
                Clear all
              </button>
            </div>
          )}
        </div>
        {weeklyRecipes.length === 0 ? (
          <p className={styles.weekEmpty}>
            Drag recipes here to plan your week
          </p>
        ) : (
          <div className={styles.weekList}>
            {weeklyRecipes.map(recipe => (
              <div key={recipe.id} className={styles.weekItem}>
                <button
                  className={styles.weekItemName}
                  onClick={() => onSelect(recipe.id)}
                >
                  {recipe.title}
                </button>
                <button
                  className={styles.weekRemoveBtn}
                  onClick={() => onRemoveFromWeek(recipe.id)}
                  title="Remove from this week"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {recipes.length === 0 ? (
        <p className={styles.empty}>
          No recipes yet. Add your first one!
        </p>
      ) : (
        <div className={styles.columns}>
          {MAIN_CATS.map(cat => (
            <div
              key={cat.key}
              id={`cat-${cat.key}`}
              className={`${styles.column} ${dragOverTarget === cat.key ? styles.columnDragOver : ''}`}
              onDragOver={handleColumnDragOver}
              onDrop={e => handleColumnDrop(e, cat.key)}
              onDragEnter={() => handleDragEnter(cat.key)}
              onDragLeave={e => handleDragLeave(e, cat.key)}
            >
              <h3 className={styles.columnHeading}>{cat.label}</h3>
              {grouped[cat.key].length === 0 ? (
                <p className={styles.columnEmpty}>Drop recipes here</p>
              ) : (
                <div className={styles.list}>
                  {grouped[cat.key].map(recipe => (
                    <RecipeCard
                      key={recipe.id}
                      recipe={recipe}
                      onClick={onSelect}
                      draggable
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className={styles.stackedCol}>
            {SIDE_CATS.map(cat => (
              <div
                key={cat.key}
                id={`cat-${cat.key}`}
                className={`${styles.column} ${dragOverTarget === cat.key ? styles.columnDragOver : ''}`}
                onDragOver={handleColumnDragOver}
                onDrop={e => handleColumnDrop(e, cat.key)}
                onDragEnter={() => handleDragEnter(cat.key)}
                onDragLeave={e => handleDragLeave(e, cat.key)}
              >
                <h3 className={styles.columnHeading}>{cat.label}</h3>
                {grouped[cat.key].length === 0 ? (
                  <p className={styles.columnEmpty}>Drop recipes here</p>
                ) : (
                  <div className={styles.list}>
                    {grouped[cat.key].map(recipe => (
                      <RecipeCard
                        key={recipe.id}
                        recipe={recipe}
                        onClick={onSelect}
                        draggable
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
