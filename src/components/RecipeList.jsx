import { useState, useMemo } from 'react';
import { RecipeCard } from './RecipeCard';
import { fetchRecipesFromSheet } from '../utils/sheetRecipes';
import { KEY_INGREDIENTS, normalize, recipeHasIngredient } from '../utils/keyIngredients';
import styles from './RecipeList.module.css';

const HISTORY_KEY = 'sunday-plan-history';
const SHOP_KEY = 'sunday-shopping-selection';

function formatQty(n) {
  if (!n) return '';
  if (Number.isInteger(n)) return String(n);
  const whole = Math.floor(n);
  const frac = n - whole;
  const fracs = { 0.25: '\u00BC', 0.333: '\u2153', 0.5: '\u00BD', 0.667: '\u2154', 0.75: '\u00BE' };
  for (const [dec, ch] of Object.entries(fracs)) {
    if (Math.abs(frac - parseFloat(dec)) < 0.05) return whole ? `${whole} ${ch}` : ch;
  }
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

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
  const [showSaved, setShowSaved] = useState(false);
  const [shopSelection, setShopSelection] = useState(() => {
    try {
      const data = localStorage.getItem(SHOP_KEY);
      return data ? new Set(JSON.parse(data)) : new Set();
    } catch { return new Set(); }
  });

  function toggleShopRecipe(id) {
    setShopSelection(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(SHOP_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  function handleSaveClick() {
    onSaveToHistory();
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 3000);
  }

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

  // Collect all preset meal types + any custom ones from recipes
  const PRESET_TYPES = ['meat', 'pescatarian', 'vegan', 'vegetarian'];
  const customTypes = recipes.map(r => r.mealType).filter(Boolean)
    .filter(t => !PRESET_TYPES.includes(t.toLowerCase()));
  const mealTypes = [...new Set([...PRESET_TYPES, ...customTypes])].sort();

  // Filter by frequency and meal type, then group by category
  const weekSet = new Set(weeklyPlan);
  let visible = freqFilter === 'all'
    ? recipes
    : recipes.filter(r => (r.frequency || 'common') === freqFilter);
  if (checkedTypes.size > 0) {
    visible = visible.filter(r => checkedTypes.has(r.mealType || ''));
  }
  visible = visible.filter(r => !weekSet.has(r.id));

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

  // Aggregated shopping list from selected recipes
  const shopItems = useMemo(() => {
    const selected = weeklyRecipes.filter(r => shopSelection.has(r.id));
    if (selected.length === 0) return [];
    const map = new Map();
    for (const recipe of selected) {
      for (const ing of (recipe.ingredients || [])) {
        const name = (ing.ingredient || '').toLowerCase().trim();
        if (!name) continue;
        const meas = (ing.measurement || '').toLowerCase().trim();
        const key = `${name}|||${meas}`;
        const qty = parseFloat(ing.quantity) || 0;
        if (map.has(key)) {
          map.get(key).quantity += qty;
        } else {
          map.set(key, {
            ingredient: ing.ingredient.trim(),
            measurement: ing.measurement || '',
            quantity: qty,
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.ingredient.localeCompare(b.ingredient));
  }, [weeklyRecipes, shopSelection]);

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

  // Suggested meals: score recipes by staleness + neglected key ingredients
  const suggestions = useMemo(() => {
    let history;
    try {
      const data = localStorage.getItem(HISTORY_KEY);
      history = data ? JSON.parse(data) : [];
    } catch {
      history = [];
    }

    // Apply same filters as the recipe list
    let filtered = freqFilter === 'all'
      ? recipes
      : recipes.filter(r => (r.frequency || 'common') === freqFilter);
    if (checkedTypes.size > 0) {
      filtered = filtered.filter(r => checkedTypes.has(r.mealType || ''));
    }
    const candidates = filtered.filter(r => !weekSet.has(r.id));
    if (candidates.length === 0) return [];

    // Sort history newest-first
    const byRecent = [...history].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    // Build map: recipeId → most recent date it was cooked
    const lastCookedMap = {};
    for (const entry of byRecent) {
      for (const rid of entry.recipeIds) {
        if (!lastCookedMap[rid]) lastCookedMap[rid] = entry.date;
      }
    }

    // Build map: normalized key ingredient → most recent date it was eaten
    const ingredientDateMap = {};
    for (const keyIng of KEY_INGREDIENTS) {
      const normKey = normalize(keyIng);
      for (const entry of byRecent) {
        if (ingredientDateMap[normKey]) break;
        for (const rid of entry.recipeIds) {
          if (ingredientDateMap[normKey]) break;
          const recipe = getRecipe(rid);
          if (recipeHasIngredient(recipe, normKey)) {
            ingredientDateMap[normKey] = entry.date;
          }
        }
      }
    }

    function daysSince(dateStr) {
      const then = new Date(dateStr + 'T00:00:00');
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      return Math.round((now - then) / (1000 * 60 * 60 * 24));
    }

    const scored = candidates.map(recipe => {
      const lastCooked = lastCookedMap[recipe.id];
      const recipeDays = lastCooked ? daysSince(lastCooked) : 9999;

      // Sum days-since-last-eaten for each key ingredient this recipe has
      let ingredientScore = 0;
      const neglectedIngredients = [];
      for (const keyIng of KEY_INGREDIENTS) {
        const normKey = normalize(keyIng);
        if (recipeHasIngredient(recipe, normKey)) {
          const ingDate = ingredientDateMap[normKey];
          const ingDays = ingDate ? daysSince(ingDate) : 9999;
          ingredientScore += ingDays;
          if (ingDays >= 14) {
            const label = keyIng.replace(/_/g, ' ');
            neglectedIngredients.push(label);
          }
        }
      }

      const totalScore = recipeDays + ingredientScore;

      // Build reason text
      const parts = [];
      if (recipeDays === 9999) parts.push('never cooked');
      else if (recipeDays >= 7) parts.push(`not cooked in ${recipeDays} days`);
      if (neglectedIngredients.length > 0) {
        parts.push('has ' + neglectedIngredients.slice(0, 3).join(', '));
      }
      const reason = parts.join(' · ') || 'good variety pick';

      return { recipe, totalScore, reason };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);

    // Pick top 2 breakfast + top 2 lunch-dinner
    const breakfast = scored.filter(s => s.recipe.category === 'breakfast').slice(0, 2);
    const lunchDinner = scored.filter(s => s.recipe.category === 'lunch-dinner').slice(0, 2);
    return [...breakfast, ...lunchDinner];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes, weeklyPlan, freqFilter, checkedTypes]);

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
          <div className={styles.filterBar}>
            {mealTypes.map(type => (
              <button
                key={type}
                className={`${styles.filterBtn} ${checkedTypes.has(type) ? styles.filterBtnActive : ''}`}
                onClick={() => {
                  setCheckedTypes(prev => {
                    const next = new Set(prev);
                    if (next.has(type)) next.delete(type);
                    else next.add(type);
                    return next;
                  });
                }}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.weekRow}>
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
                <button className={styles.saveHistoryBtn} onClick={handleSaveClick}>
                  Save to History
                </button>
                {showSaved && (
                  <span className={styles.savedToast}>Saved!</span>
                )}
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

        {/* Suggested Meals */}
        {suggestions.length > 0 && (
          <div className={styles.suggestBox}>
            <h3 className={styles.suggestHeading}>Suggested Meals</h3>
            <div className={styles.suggestList}>
              {suggestions.map(({ recipe, reason }) => (
                <div key={recipe.id} className={styles.suggestItem}>
                  <div className={styles.suggestInfo}>
                    <button
                      className={styles.suggestName}
                      onClick={() => onSelect(recipe.id)}
                    >
                      {recipe.title}
                    </button>
                    <span className={styles.suggestReason}>{reason}</span>
                  </div>
                  <button
                    className={styles.suggestAddBtn}
                    onClick={() => onAddToWeek(recipe.id)}
                    title="Add to this week"
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Shopping List (from + selections) */}
      {shopItems.length > 0 && (
        <div className={styles.shopBox}>
          <div className={styles.shopHeader}>
            <h3 className={styles.shopHeading}>Shopping List</h3>
            <button
              className={styles.clearBtn}
              onClick={() => {
                setShopSelection(new Set());
                try { localStorage.removeItem(SHOP_KEY); } catch {}
              }}
            >
              Clear
            </button>
          </div>
          <table className={styles.shopTable}>
            <thead>
              <tr>
                <th>Qty</th>
                <th>Measure</th>
                <th>Ingredient</th>
              </tr>
            </thead>
            <tbody>
              {shopItems.map((item, i) => (
                <tr key={i}>
                  <td>{formatQty(item.quantity)}</td>
                  <td>{item.measurement}</td>
                  <td>{item.ingredient}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                      onAdd={onAddToWeek}
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
                        onAdd={onAddToWeek}
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
