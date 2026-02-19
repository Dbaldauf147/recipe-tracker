import { useState, useMemo } from 'react';
import { RecipeCard } from './RecipeCard';
import { fetchRecipesFromSheet } from '../utils/sheetRecipes';
import styles from './RecipeList.module.css';

const CATEGORIES = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch-dinner', label: 'Lunch & Dinner' },
  { key: 'snacks-desserts', label: 'Snacks & Desserts' },
];

function parseFraction(str) {
  if (!str) return 0;
  const s = str.trim();
  // Handle mixed numbers like "1 1/2"
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  // Handle fractions like "1/2"
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  // Handle decimals/integers
  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}

function formatQuantity(n) {
  if (n === 0) return '';
  if (Number.isInteger(n)) return String(n);
  // Common fractions
  const whole = Math.floor(n);
  const frac = n - whole;
  const fracs = { 0.25: '1/4', 0.333: '1/3', 0.5: '1/2', 0.667: '2/3', 0.75: '3/4' };
  for (const [dec, str] of Object.entries(fracs)) {
    if (Math.abs(frac - parseFloat(dec)) < 0.05) {
      return whole > 0 ? `${whole} ${str}` : str;
    }
  }
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function buildShoppingList(weeklyRecipes) {
  const map = new Map();
  for (const recipe of weeklyRecipes) {
    for (const ing of recipe.ingredients) {
      const name = ing.ingredient.toLowerCase().trim();
      if (!name) continue;
      const meas = (ing.measurement || '').toLowerCase().trim();
      const key = `${name}|||${meas}`;
      if (map.has(key)) {
        const existing = map.get(key);
        existing.quantity += parseFraction(ing.quantity);
      } else {
        map.set(key, {
          ingredient: ing.ingredient.trim(),
          measurement: ing.measurement || '',
          quantity: parseFraction(ing.quantity),
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.ingredient.localeCompare(b.ingredient)
  );
}

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
}) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dragOverTarget, setDragOverTarget] = useState(null);

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

  // Group recipes by category
  const grouped = {};
  for (const cat of CATEGORIES) {
    grouped[cat.key] = [];
  }
  for (const recipe of recipes) {
    const key = recipe.category || 'lunch-dinner';
    if (grouped[key]) {
      grouped[key].push(recipe);
    } else {
      grouped['lunch-dinner'].push(recipe);
    }
  }

  // Weekly plan recipes
  const weeklyRecipes = weeklyPlan
    .map(id => getRecipe(id))
    .filter(Boolean);

  // Shopping list
  const shoppingList = useMemo(
    () => buildShoppingList(weeklyRecipes),
    [weeklyPlan, recipes]
  );

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

      {recipes.length === 0 ? (
        <p className={styles.empty}>
          No recipes yet. Add your first one!
        </p>
      ) : (
        <>
          <div className={styles.columns}>
            {CATEGORIES.map(cat => (
              <div
                key={cat.key}
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

          {/* This Week's Menu */}
          <div
            className={`${styles.weekBox} ${dragOverTarget === 'weekly' ? styles.weekBoxDragOver : ''}`}
            onDragOver={handleWeekDragOver}
            onDrop={handleWeekDrop}
            onDragEnter={() => handleDragEnter('weekly')}
            onDragLeave={e => handleDragLeave(e, 'weekly')}
          >
            <div className={styles.weekHeader}>
              <h3 className={styles.weekHeading}>This Week's Menu</h3>
              {weeklyRecipes.length > 0 && (
                <button className={styles.clearBtn} onClick={onClearWeek}>
                  Clear all
                </button>
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

          {/* Shopping List */}
          {shoppingList.length > 0 && (
            <div className={styles.shoppingBox}>
              <h3 className={styles.shoppingHeading}>Shopping List</h3>
              <p className={styles.shoppingSubtext}>
                Based on {weeklyRecipes.length} recipe{weeklyRecipes.length !== 1 ? 's' : ''} this week
              </p>
              <ul className={styles.shoppingList}>
                {shoppingList.map((item, i) => (
                  <li key={i} className={styles.shoppingItem}>
                    <span className={styles.shoppingQty}>
                      {formatQuantity(item.quantity)}
                      {item.measurement ? ` ${item.measurement}` : ''}
                    </span>
                    <span className={styles.shoppingName}>{item.ingredient}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
