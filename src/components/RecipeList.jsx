import { useState, useMemo, useEffect, useRef } from 'react';
import { RecipeCard } from './RecipeCard';
import { fetchRecipesFromSheet } from '../utils/sheetRecipes';
import { getUserKeyIngredients, normalize, recipeHasIngredient } from '../utils/keyIngredients';
import { exportToCSV, importFromCSV } from '../utils/exportData';
import { useAuth } from '../contexts/AuthContext';
import { loadUserData, saveField } from '../utils/firestoreSync';
import styles from './RecipeList.module.css';

const ADMIN_UID = import.meta.env.VITE_ADMIN_UID;

const HISTORY_KEY = 'sunday-plan-history';
const SHOP_KEY = 'sunday-shopping-selection';
const WEEKLY_GOALS_KEY = 'sunday-weekly-goals';

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

const MAIN_CATS = CATEGORIES.filter(c => c.key === 'breakfast');
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
  onAddRecipe,
  onDelete,
  isNewUser,
}) {
  const { user } = useAuth();
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dragOverTarget, setDragOverTarget] = useState(null);
  const [freqFilter, setFreqFilter] = useState(isNewUser ? 'all' : 'common');
  const [checkedTypes, setCheckedTypes] = useState(new Set());
  const [showSaved, setShowSaved] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickCategory, setQuickCategory] = useState('lunch-dinner');
  const [importSearch, setImportSearch] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);
  const [lastAdded, setLastAdded] = useState(null);
  const [weeklyGoals, setWeeklyGoals] = useState(() => {
    try {
      const data = localStorage.getItem(WEEKLY_GOALS_KEY);
      return data ? JSON.parse(data) : { breakfast: 7, lunchDinner: 7 };
    } catch { return { breakfast: 7, lunchDinner: 7 }; }
  });
  const [editingGoals, setEditingGoals] = useState(false);
  const [shopSelection, setShopSelection] = useState(() => {
    try {
      const data = localStorage.getItem(SHOP_KEY);
      return data ? new Set(JSON.parse(data)) : new Set();
    } catch { return new Set(); }
  });

  const importFileRef = useRef(null);
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (isNewUser && !scrolledRef.current) {
      scrolledRef.current = true;
      setTimeout(() => {
        const el = document.getElementById('weekly-menu');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [isNewUser]);

  useEffect(() => {
    if (!settingsOpen) return;
    function handleClick(e) {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [settingsOpen]);

  function updateWeeklyGoal(key, value) {
    const num = parseInt(value) || 0;
    setWeeklyGoals(prev => {
      const next = { ...prev, [key]: num };
      localStorage.setItem(WEEKLY_GOALS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function toggleShopRecipe(id) {
    setShopSelection(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      const arr = [...next];
      try { localStorage.setItem(SHOP_KEY, JSON.stringify(arr)); } catch {}
      if (user) saveField(user.uid, 'shoppingSelection', arr);
      return next;
    });
  }

  function handleSaveClick() {
    onSaveToHistory();
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 3000);
  }

  function handleAddToWeekWithPulse(id) {
    onAddToWeek(id);
    setLastAdded(id);
    setTimeout(() => setLastAdded(null), 600);
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

  function handleImportCSV(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const result = importFromCSV(event.target.result);
        alert(`Imported ${result.newRecipes} new recipe${result.newRecipes !== 1 ? 's' : ''} (${result.totalRecipes - result.newRecipes} already existed). Reloading...`);
        window.location.reload();
      } catch (err) {
        alert('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // Collect all preset meal types + any custom ones from recipes
  const PRESET_TYPES = ['meat', 'pescatarian', 'vegan', 'vegetarian'];
  const customTypes = recipes.map(r => r.mealType).filter(Boolean)
    .filter(t => !PRESET_TYPES.includes(t.toLowerCase()));
  const mealTypes = [...new Set([...PRESET_TYPES, ...customTypes])].sort();

  // Filter by frequency, meal type, and search query, then group by category
  const weekSet = new Set(weeklyPlan);
  let visible = freqFilter === 'all'
    ? recipes
    : recipes.filter(r => (r.frequency || 'common') === freqFilter);
  if (checkedTypes.size > 0) {
    visible = visible.filter(r => checkedTypes.has(r.mealType || ''));
  }
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    visible = visible.filter(r => r.title.toLowerCase().includes(q));
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
      handleAddToWeekWithPulse(recipeId);
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

  // Discover recipes: admin recipes matching key ingredients not yet in user's collection
  const [adminRecipes, setAdminRecipes] = useState(null);
  const [addedIds, setAddedIds] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    async function fetchAdmin() {
      try {
        const data = await loadUserData(ADMIN_UID);
        if (!cancelled) setAdminRecipes(data?.recipes || []);
      } catch (err) {
        console.error('Failed to load admin recipes:', err);
        if (!cancelled) setAdminRecipes([]);
      }
    }
    fetchAdmin();
    return () => { cancelled = true; };
  }, []);

  const discoverRecipes = useMemo(() => {
    if (!adminRecipes) return [];
    const userKeys = getUserKeyIngredients();
    const normKeys = userKeys.map(k => normalize(k));
    const existingTitles = new Set(recipes.map(r => r.title.toLowerCase()));
    return adminRecipes
      .filter(r => {
        if (existingTitles.has(r.title.toLowerCase())) return false;
        if (addedIds.has(r.title.toLowerCase())) return false;
        return normKeys.some(nk => recipeHasIngredient(r, nk));
      })
      .sort((a, b) => {
        const aCount = normKeys.filter(nk => recipeHasIngredient(a, nk)).length;
        const bCount = normKeys.filter(nk => recipeHasIngredient(b, nk)).length;
        return bCount - aCount || a.title.localeCompare(b.title);
      });
  }, [adminRecipes, recipes, addedIds]);

  const importableRecipes = useMemo(() => {
    if (!adminRecipes) return [];
    const existingTitles = new Set(recipes.map(r => r.title.toLowerCase()));
    let available = adminRecipes
      .filter(r => !existingTitles.has(r.title.toLowerCase()) && !addedIds.has(r.title.toLowerCase()));
    // Apply frequency filter
    if (freqFilter !== 'all') {
      available = available.filter(r => (r.frequency || 'common') === freqFilter);
    }
    // Apply meal type filter
    if (checkedTypes.size > 0) {
      available = available.filter(r => checkedTypes.has(r.mealType || ''));
    }
    available.sort((a, b) => a.title.localeCompare(b.title));
    if (!importSearch.trim()) return available;
    const q = importSearch.trim().toLowerCase();
    return available.filter(r => r.title.toLowerCase().includes(q));
  }, [adminRecipes, recipes, addedIds, importSearch, freqFilter, checkedTypes]);

  function handleAddDiscover(recipe) {
    const { id, createdAt, ...rest } = recipe;
    onAddRecipe(rest);
    setAddedIds(prev => new Set(prev).add(recipe.title.toLowerCase()));
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
    if (candidates.length === 0) return { option1: [], option2: [] };

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
    const userIngredients = getUserKeyIngredients();
    const ingredientDateMap = {};
    for (const keyIng of userIngredients) {
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
      for (const keyIng of userIngredients) {
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

    const breakfasts = scored.filter(s => s.recipe.category === 'breakfast').slice(0, 4);
    const lunches = scored.filter(s => s.recipe.category === 'lunch-dinner').slice(0, 4);
    return { breakfasts, lunches };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes, weeklyPlan, freqFilter, checkedTypes]);

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <h2 className={styles.heading}>My Recipes</h2>
        <div className={styles.actions}>
          <input
            ref={importFileRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={handleImportCSV}
          />
          <div className={styles.settingsWrap} ref={settingsRef}>
            <button
              className={styles.gearBtn}
              onClick={() => setSettingsOpen(prev => !prev)}
              aria-label="Settings"
            >
              &#9881;
            </button>
            {settingsOpen && (
              <div className={styles.settingsDropdown}>
                <button
                  className={styles.settingsItem}
                  onClick={() => { importFileRef.current?.click(); setSettingsOpen(false); }}
                >
                  Import Recipe Data
                </button>
                <button
                  className={styles.settingsItem}
                  onClick={() => { exportToCSV(); setSettingsOpen(false); }}
                >
                  Export Recipe Data
                </button>
                {user?.email === 'baldaufdan@gmail.com' && (
                  <button
                    className={styles.settingsItem}
                    onClick={() => { handleImport(); setSettingsOpen(false); }}
                    disabled={importing}
                  >
                    {importing ? 'Importing...' : 'Import from Sheet'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {importResult && (
        <p className={styles.importResult}>{importResult}</p>
      )}

      {/* 1. This Week's Menu — full-width, dominant */}
      <div
        id="weekly-menu"
        className={`${styles.weekBox} ${dragOverTarget === 'weekly' ? styles.weekBoxDragOver : ''}`}
        onDragOver={handleWeekDragOver}
        onDrop={handleWeekDrop}
        onDragEnter={() => handleDragEnter('weekly')}
        onDragLeave={e => handleDragLeave(e, 'weekly')}
        role="region"
        aria-label="This Week's Menu"
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
        <div className={styles.weekContent}>
          <div className={styles.weekMain}>
            {weeklyRecipes.length === 0 ? (
              <div className={styles.weekEmpty}>
                <span className={styles.weekEmptyIcon}>🍽</span>
                <span>Drag recipes here to plan your week</span>
                <span className={styles.weekEmptyHint}>or click the + button on any recipe below</span>
              </div>
            ) : (
              <div className={styles.weekCategories}>
                {[
                  { key: 'breakfast', label: 'Breakfast' },
                  { key: 'lunch-dinner', label: 'Lunch & Dinner' },
                ].map(cat => {
                  const catRecipes = weeklyRecipes.filter(r => r.category === cat.key);
                  if (catRecipes.length === 0) return null;
                  return (
                    <div key={cat.key} className={styles.weekCatGroup}>
                      <h4 className={styles.weekCatLabel}>{cat.label}</h4>
                      <div className={styles.weekList}>
                        {catRecipes.map(recipe => (
                          <div
                            key={recipe.id}
                            className={`${styles.weekItem}${lastAdded === recipe.id ? ` ${styles.weekItemNew}` : ''}`}
                          >
                            <button
                              className={styles.weekItemName}
                              onClick={() => onSelect(recipe.id)}
                            >
                              {recipe.title}
                            </button>
                            <button
                              className={styles.weekRemoveBtn}
                              onClick={() => onRemoveFromWeek(recipe.id)}
                              aria-label={`Remove ${recipe.title} from this week`}
                            >
                              &times;
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {(() => {
                  const otherRecipes = weeklyRecipes.filter(r => r.category !== 'breakfast' && r.category !== 'lunch-dinner');
                  if (otherRecipes.length === 0) return null;
                  return (
                    <div className={styles.weekCatGroup}>
                      <h4 className={styles.weekCatLabel}>Other</h4>
                      <div className={styles.weekList}>
                        {otherRecipes.map(recipe => (
                          <div
                            key={recipe.id}
                            className={`${styles.weekItem}${lastAdded === recipe.id ? ` ${styles.weekItemNew}` : ''}`}
                          >
                            <button
                              className={styles.weekItemName}
                              onClick={() => onSelect(recipe.id)}
                            >
                              {recipe.title}
                            </button>
                            <button
                              className={styles.weekRemoveBtn}
                              onClick={() => onRemoveFromWeek(recipe.id)}
                              aria-label={`Remove ${recipe.title} from this week`}
                            >
                              &times;
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
          <div className={styles.weekServings}>
            <h4 className={styles.weekServingsTitle}>
              Weekly Servings
              <button className={styles.goalEditBtn} onClick={() => setEditingGoals(prev => !prev)}>
                {editingGoals ? 'Done' : 'Set Targets'}
              </button>
            </h4>
            {(() => {
              const bCount = weeklyRecipes.filter(r => r.category === 'breakfast').reduce((sum, r) => sum + (parseInt(r.servings) || 1), 0);
              const ldCount = weeklyRecipes.filter(r => r.category === 'lunch-dinner').reduce((sum, r) => sum + (parseInt(r.servings) || 1), 0);
              return (
                <>
                  <div className={styles.servingRow}>
                    <span className={styles.servingLabel}>Breakfast</span>
                    <span className={`${styles.servingCount} ${bCount >= weeklyGoals.breakfast ? styles.servingMet : styles.servingUnder}`}>
                      {bCount}
                    </span>
                    <span className={styles.servingGoal}>/ {weeklyGoals.breakfast}</span>
                    {editingGoals && (
                      <input
                        className={styles.goalInput}
                        type="number"
                        min="0"
                        value={weeklyGoals.breakfast}
                        onChange={e => updateWeeklyGoal('breakfast', e.target.value)}
                      />
                    )}
                  </div>
                  <div className={styles.servingRow}>
                    <span className={styles.servingLabel}>Lunch & Dinner</span>
                    <span className={`${styles.servingCount} ${ldCount >= weeklyGoals.lunchDinner ? styles.servingMet : styles.servingUnder}`}>
                      {ldCount}
                    </span>
                    <span className={styles.servingGoal}>/ {weeklyGoals.lunchDinner}</span>
                    {editingGoals && (
                      <input
                        className={styles.goalInput}
                        type="number"
                        min="0"
                        value={weeklyGoals.lunchDinner}
                        onChange={e => updateWeeklyGoal('lunchDinner', e.target.value)}
                      />
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* 2. Suggested Meals + Discover Recipes row */}
      <div className={styles.suggestDiscoverRow}>
      {(suggestions.breakfasts.length > 0 || suggestions.lunches.length > 0) && (
        <div className={styles.suggestBox} role="region" aria-label="Suggested Meals">
          <h3 className={styles.suggestHeading}>Suggested Meals</h3>
          <div className={styles.suggestColumns}>
            {suggestions.breakfasts.length > 0 && (
              <div className={styles.suggestColumn}>
                <span className={styles.suggestCategoryLabel}>Breakfast</span>
                <div className={styles.suggestList}>
                  {suggestions.breakfasts.map(({ recipe, reason }) => (
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
                        onClick={() => handleAddToWeekWithPulse(recipe.id)}
                        aria-label={`Add ${recipe.title} to this week`}
                      >
                        +
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {suggestions.lunches.length > 0 && (
              <div className={styles.suggestColumn}>
                <span className={styles.suggestCategoryLabel}>Lunch & Dinner</span>
                <div className={styles.suggestList}>
                  {suggestions.lunches.map(({ recipe, reason }) => (
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
                        onClick={() => handleAddToWeekWithPulse(recipe.id)}
                        aria-label={`Add ${recipe.title} to this week`}
                      >
                        +
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Discover Recipes — collapsible panel */}
      <div className={styles.discoverPanel}>
        <button
          className={styles.discoverToggle}
          onClick={() => setDiscoverOpen(prev => !prev)}
          aria-expanded={discoverOpen}
        >
          <span className={`${styles.discoverArrow}${discoverOpen ? ` ${styles.discoverArrowOpen}` : ''}`}>▼</span>
          Discover Recipes
        </button>
        {discoverOpen && (
          <div className={styles.discoverContent}>
            <div className={styles.addRecipeBox}>
              <input
                className={styles.addRecipeInput}
                type="text"
                placeholder="Search recipes..."
                value={importSearch}
                onChange={e => setImportSearch(e.target.value)}
              />
              <div className={styles.importList}>
                {importableRecipes.slice(0, 5).map(recipe => (
                  <div key={recipe.id} className={styles.importItem}>
                    <div className={styles.importInfo}>
                      <span className={styles.importName}>{recipe.title}</span>
                    </div>
                    <button
                      className={styles.importAddBtn}
                      onClick={() => handleAddDiscover(recipe)}
                      aria-label={`Add ${recipe.title} to My Recipes`}
                    >
                      +
                    </button>
                  </div>
                ))}
                {adminRecipes && importableRecipes.length === 0 && (
                  <p className={styles.importEmpty}>
                    {importSearch.trim() ? 'No matches' : 'All imported'}
                  </p>
                )}
                {!adminRecipes && (
                  <p className={styles.importEmpty}>Loading...</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* 4. Search + Filter Row */}
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search recipes..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>
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

      {/* Shopping List (from + selections) */}
      {shopItems.length > 0 && (
        <div className={styles.shopBox}>
          <div className={styles.shopHeader}>
            <h3 className={styles.shopHeading}>Shopping List</h3>
            <button
              className={styles.clearBtn}
              onClick={() => {
                setShopSelection(new Set());
                try { localStorage.setItem(SHOP_KEY, JSON.stringify([])); } catch {}
                if (user) saveField(user.uid, 'shoppingSelection', []);
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

      {/* 5. Recipe Category Columns */}
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
            role="region"
            aria-label={cat.label}
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
                    draggable={!editMode}
                    onAdd={editMode ? undefined : handleAddToWeekWithPulse}
                    editMode={editMode}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        <div
          id="cat-lunch-dinner"
          className={`${styles.column} ${styles.wideColumn} ${dragOverTarget === 'lunch-dinner' ? styles.columnDragOver : ''}`}
          onDragOver={handleColumnDragOver}
          onDrop={e => handleColumnDrop(e, 'lunch-dinner')}
          onDragEnter={() => handleDragEnter('lunch-dinner')}
          onDragLeave={e => handleDragLeave(e, 'lunch-dinner')}
          role="region"
          aria-label="Lunch & Dinner"
        >
          <h3 className={styles.columnHeading}>Lunch & Dinner</h3>
          {grouped['lunch-dinner'].length === 0 ? (
            <p className={styles.columnEmpty}>Drop recipes here</p>
          ) : (
            <div className={styles.list}>
              {grouped['lunch-dinner'].map(recipe => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  onClick={onSelect}
                  draggable={!editMode}
                  onAdd={editMode ? undefined : handleAddToWeekWithPulse}
                  editMode={editMode}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
        </div>
        <div className={styles.rightCol}>
          <button className={styles.addBtn} onClick={onAdd} style={{ width: '100%' }}>
            + Add Recipe
          </button>
          <button
            className={`${styles.importBtn}${editMode ? ` ${styles.editBtnActive}` : ''}`}
            onClick={() => setEditMode(prev => !prev)}
            style={{ width: '100%' }}
          >
            {editMode ? 'Done' : 'Remove Recipes'}
          </button>
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
              role="region"
              aria-label={cat.label}
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
                      draggable={!editMode}
                      onAdd={editMode ? undefined : handleAddToWeekWithPulse}
                      editMode={editMode}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}
