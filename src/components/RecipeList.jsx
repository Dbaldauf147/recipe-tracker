import { useState, useMemo, useEffect, useRef } from 'react';
import { RecipeCard } from './RecipeCard';
import { loadStarterRecipes } from '../utils/starterRecipes';
import { getUserKeyIngredients, normalize, recipeHasIngredient } from '../utils/keyIngredients';
import { exportToCSV, importFromCSV } from '../utils/exportData';
import { locationToRegion, getSeasonalIngredients, getRecipeSeasonalIngredients } from '../utils/seasonal';
import { useAuth } from '../contexts/AuthContext';
import { loadUserData, saveField, loadFriends, loadFriendRecipes, getPendingSharedRecipes } from '../utils/firestoreSync';
import { copyMealImage } from '../utils/generateMealImage';
import { ALL_TAGS, TAG_CATEGORIES, recipeMatchesTags } from '../utils/ingredientTags';
import styles from './RecipeList.module.css';

const ADMIN_UID = import.meta.env.VITE_ADMIN_UID;

const HISTORY_KEY = 'sunday-plan-history';
const SHOP_KEY = 'sunday-shopping-selection';
const WEEKLY_GOALS_KEY = 'sunday-weekly-goals';

function formatQty(n) {
  if (!n) return '';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
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

function ShopPreview({ shopItems, onClear }) {
  const [showMeals, setShowMeals] = useState(false);
  return (
    <div className={styles.shopBox}>
      <div className={styles.shopHeader}>
        <h3 className={styles.shopHeading}>Shopping List</h3>
        <div className={styles.shopActions}>
          <button
            className={`${styles.shopToggleBtn}${showMeals ? ` ${styles.shopToggleBtnActive}` : ''}`}
            onClick={() => setShowMeals(v => !v)}
          >
            {showMeals ? 'Hide Meals' : 'Show Meals'}
          </button>
          <button className={styles.clearBtn} onClick={onClear}>Clear</button>
        </div>
      </div>
      <table className={styles.shopTable}>
        <thead>
          <tr>
            <th>Qty</th>
            <th>Measure</th>
            <th>Ingredient</th>
            {showMeals && <th>Used In</th>}
          </tr>
        </thead>
        <tbody>
          {shopItems.map((item, i) => (
            <tr key={i}>
              <td>{formatQty(item.quantity)}</td>
              <td>{item.measurement}</td>
              <td>{item.ingredient}</td>
              {showMeals && (
                <td className={styles.shopMealCell}>{item.recipes.join(', ')}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecipeList({
  recipes,
  onSelect,
  onAdd,
  onImport,
  weeklyPlan,
  weeklyServings = {},
  onAddToWeek,
  onRemoveFromWeek,
  onClearWeek,
  onUpdateWeeklyServings,
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
  const [showRare, setShowRare] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const [checkedTypes, setCheckedTypes] = useState(new Set());
  const [checkedCategories, setCheckedCategories] = useState(new Set());
  const [checkedCuisines, setCheckedCuisines] = useState(new Set());
  const [checkedTags, setCheckedTags] = useState(new Set());
  const [mealFilterOpen, setMealFilterOpen] = useState(false);
  const mealFilterRef = useRef(null);
  const [showSaved, setShowSaved] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickCategory, setQuickCategory] = useState('lunch-dinner');
  const [importSearch, setImportSearch] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [discoverOpen, setDiscoverOpen] = useState(true);
  const [showDiscoverTip, setShowDiscoverTip] = useState(false);
  const [friendsWithAccess, setFriendsWithAccess] = useState([]);
  const [selectedFriend, setSelectedFriend] = useState('');
  const [friendRecipes, setFriendRecipes] = useState([]);
  const [friendRecipesLoading, setFriendRecipesLoading] = useState(false);
  const [pendingShares, setPendingShares] = useState([]);
  const [weekMenuOpen, setWeekMenuOpen] = useState(true);
  const [suggestOpen, setSuggestOpen] = useState(true);
  const [myRecipesOpen, setMyRecipesOpen] = useState(true);
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

  function getPlannedServings(recipe) {
    return weeklyServings[recipe.id] ?? (parseInt(recipe.servings) || 1);
  }

  // Load friends who have shared recipe access with you
  useEffect(() => {
    if (!user) return;
    loadFriends(user.uid).then(friends => {
      setFriendsWithAccess(friends.filter(f => f.hasGrantedAccess));
    }).catch(() => {});
    getPendingSharedRecipes(user.uid).then(shares => {
      setPendingShares(shares);
    }).catch(() => {});
  }, [user?.uid]);

  // Load selected friend's recipes
  useEffect(() => {
    if (!selectedFriend) { setFriendRecipes([]); return; }
    setFriendRecipesLoading(true);
    loadFriendRecipes(selectedFriend).then(data => {
      const existing = new Set(recipes.map(r => (r.title || '').toLowerCase()));
      setFriendRecipes(
        (data.recipes || [])
          .filter(r => r.title && (r.frequency || 'common') !== 'retired')
          .map(r => ({ ...r, alreadyHave: existing.has(r.title.toLowerCase()) }))
          .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
      );
    }).catch(() => setFriendRecipes([])).finally(() => setFriendRecipesLoading(false));
  }, [selectedFriend, recipes]);

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

  const [showAddTip, setShowAddTip] = useState(false);

  useEffect(() => {
    if (recipes.length === 0) {
      const timer = setTimeout(() => setShowAddTip(true), 600);
      return () => clearTimeout(timer);
    } else {
      setShowAddTip(false);
    }
  }, [recipes.length]);

  useEffect(() => {
    if (!mealFilterOpen) return;
    function handleClick(e) {
      if (mealFilterRef.current && !mealFilterRef.current.contains(e.target)) {
        setMealFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [mealFilterOpen]);

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
      const starterRecipes = await loadStarterRecipes();
      const existingTitles = new Set(recipes.map(r => r.title.toLowerCase()));
      const newCount = starterRecipes.filter(r => !existingTitles.has(r.title.toLowerCase())).length;
      onImport(starterRecipes);
      setImportResult(`Imported ${newCount} new recipe${newCount !== 1 ? 's' : ''} (${starterRecipes.length - newCount} already existed)`);
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

  const cuisineList = [...new Set(recipes.map(r => r.cuisine).filter(Boolean))].sort();

  // Filter by frequency, meal type, cuisine, and search query, then group by category
  const weekSet = new Set(weeklyPlan);
  let visible = recipes.filter(r => {
    const freq = r.frequency || 'common';
    if (freq === 'retired') return showRetired;
    if (freq === 'rare') return showRare;
    return true; // common always shown
  });
  if (checkedTypes.size > 0) {
    visible = visible.filter(r => checkedTypes.has(r.mealType || ''));
  }
  if (checkedCategories.size > 0) {
    visible = visible.filter(r => checkedCategories.has(r.category || 'lunch-dinner'));
  }
  if (checkedCuisines.size > 0) {
    visible = visible.filter(r => checkedCuisines.has(r.cuisine || ''));
  }
  if (checkedTags.size > 0) {
    visible = visible.filter(r => recipeMatchesTags(r, checkedTags));
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

  const filteredWeeklyRecipes = weeklyRecipes.filter(r => {
    if (checkedTypes.size > 0 && !checkedTypes.has(r.mealType || '')) return false;
    if (checkedCategories.size > 0 && !checkedCategories.has(r.category || 'lunch-dinner')) return false;
    if (checkedCuisines.size > 0 && !checkedCuisines.has(r.cuisine || '')) return false;
    return true;
  });

  // Build map: recipeId → days since last eaten (from plan history + daily tracker)
  const lastEatenMap = useMemo(() => {
    const map = {};
    // Plan history
    let history;
    try {
      const data = localStorage.getItem(HISTORY_KEY);
      history = data ? JSON.parse(data) : [];
    } catch { history = []; }
    const byRecent = [...history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    for (const entry of byRecent) {
      for (const rid of entry.recipeIds) {
        if (!map[rid]) map[rid] = entry.date;
      }
    }
    // Daily tracker (may have more recent dates)
    let dailyLog;
    try {
      const data = localStorage.getItem('sunday-daily-log');
      dailyLog = data ? JSON.parse(data) : {};
    } catch { dailyLog = {}; }
    for (const [dateStr, dayData] of Object.entries(dailyLog)) {
      for (const entry of (dayData.entries || [])) {
        if (entry.type === 'recipe' && entry.recipeId) {
          const existing = map[entry.recipeId];
          if (!existing || dateStr > existing) {
            map[entry.recipeId] = dateStr;
          }
        }
      }
    }
    // Convert dates to days-since
    const result = {};
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    for (const [rid, dateStr] of Object.entries(map)) {
      const then = new Date(dateStr + 'T00:00:00');
      result[rid] = Math.round((now - then) / (1000 * 60 * 60 * 24));
    }
    return result;
  }, [weeklyPlan, recipes]);

  // Aggregated shopping list from selected recipes
  const shopItems = useMemo(() => {
    const selected = weeklyRecipes.filter(r => shopSelection.has(r.id));
    if (selected.length === 0) return [];
    const map = new Map();
    for (const recipe of selected) {
      const baseServings = parseInt(recipe.servings) || 1;
      const plannedServings = getPlannedServings(recipe);
      const scale = plannedServings / baseServings;
      for (const ing of (recipe.ingredients || [])) {
        const name = (ing.ingredient || '').toLowerCase().trim();
        if (!name) continue;
        const meas = (ing.measurement || '').toLowerCase().trim();
        const key = `${name}|||${meas}`;
        const qty = (parseFloat(ing.quantity) || 0) * scale;
        if (map.has(key)) {
          const entry = map.get(key);
          entry.quantity += qty;
          if (!entry.recipes.includes(recipe.title)) entry.recipes.push(recipe.title);
        } else {
          map.set(key, {
            ingredient: ing.ingredient.trim(),
            measurement: ing.measurement || '',
            quantity: qty,
            recipes: [recipe.title],
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.ingredient.localeCompare(b.ingredient));
  }, [weeklyRecipes, shopSelection, weeklyServings]);

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
    available = available.filter(r => {
      const freq = r.frequency || 'common';
      if (freq === 'retired') return showRetired;
      if (freq === 'rare') return showRare;
      return true;
    });
    // Apply meal type filter
    if (checkedTypes.size > 0) {
      available = available.filter(r => checkedTypes.has(r.mealType || ''));
    }
    if (checkedCategories.size > 0) {
      available = available.filter(r => checkedCategories.has(r.category || 'lunch-dinner'));
    }
    if (checkedCuisines.size > 0) {
      available = available.filter(r => checkedCuisines.has(r.cuisine || ''));
    }
    available.sort((a, b) => a.title.localeCompare(b.title));
    if (!importSearch.trim()) return available;
    const q = importSearch.trim().toLowerCase();
    return available.filter(r => r.title.toLowerCase().includes(q));
  }, [adminRecipes, recipes, addedIds, importSearch, showRare, showRetired, checkedTypes, checkedCategories, checkedCuisines]);

  const [discoverSelected, setDiscoverSelected] = useState(new Set());

  function toggleDiscoverSelect(recipeTitle) {
    setDiscoverSelected(prev => {
      const next = new Set(prev);
      if (next.has(recipeTitle)) next.delete(recipeTitle);
      else next.add(recipeTitle);
      return next;
    });
  }

  function handleAddDiscoverSelected() {
    const toAdd = importableRecipes.filter(r => discoverSelected.has(r.title));
    for (const recipe of toAdd) {
      handleAddDiscover(recipe);
    }
    setDiscoverSelected(new Set());
  }

  function handleAddDiscover(recipe) {
    const { id: adminRecipeId, createdAt, ...rest } = recipe;
    const newRecipe = onAddRecipe({ ...rest, source: 'discover' });
    setAddedIds(prev => new Set(prev).add(recipe.title.toLowerCase()));

    // Copy the admin's meal image to the user's account
    if (user && ADMIN_UID && adminRecipeId && newRecipe?.id) {
      copyMealImage(ADMIN_UID, adminRecipeId, user.uid, newRecipe.id).catch(() => {});
    }
  }

  // Macro match scores for all recipes
  const macroMatchMap = useMemo(() => {
    const map = {};
    let goals = null;
    try {
      const raw = localStorage.getItem('sunday-nutrition-goals');
      goals = raw ? JSON.parse(raw) : null;
    } catch {}
    if (!goals || !goals.calories || goals.calories <= 0) return map;
    const pCal = (goals.protein || 0) * 4;
    const cCal = (goals.carbs || 0) * 4;
    const fCal = (goals.fat || 0) * 9;
    const total = pCal + cCal + fCal;
    if (total <= 0) return map;
    const goalPcts = {
      protein: pCal / total * 100,
      carbs: cCal / total * 100,
      fat: fCal / total * 100,
    };
    let cache = {};
    try {
      cache = JSON.parse(localStorage.getItem('sunday-nutrition-cache') || '{}');
    } catch {}
    for (const recipe of recipes) {
      const cached = cache[recipe.id];
      const nutData = cached?.data || cached;
      if (!nutData || !nutData.totals) continue;
      const t = nutData.totals;
      const cal = t.calories;
      if (!cal || cal <= 0) continue;
      const pPct = ((t.protein || 0) * 4) / cal * 100;
      const cPct = ((t.carbs || 0) * 4) / cal * 100;
      const fPct = ((t.fat || 0) * 9) / cal * 100;
      const deviation = (
        Math.abs(pPct - goalPcts.protein) +
        Math.abs(cPct - goalPcts.carbs) +
        Math.abs(fPct - goalPcts.fat)
      ) / 3;
      const score = Math.max(0, Math.round(100 - deviation * (100 / 30)));
      map[recipe.id] = score;
    }
    return map;
  }, [recipes]);

  // Suggested meals: score recipes by staleness + neglected key ingredients
  const suggestions = useMemo(() => {
    let history;
    try {
      const data = localStorage.getItem(HISTORY_KEY);
      history = data ? JSON.parse(data) : [];
    } catch {
      history = [];
    }

    // Also read daily tracker log for more granular "last eaten" data
    let dailyLog;
    try {
      const data = localStorage.getItem('sunday-daily-log');
      dailyLog = data ? JSON.parse(data) : {};
    } catch {
      dailyLog = {};
    }

    // Apply same filters as the recipe list
    let filtered = recipes.filter(r => {
      const freq = r.frequency || 'common';
      if (freq === 'retired') return showRetired;
      if (freq === 'rare') return showRare;
      return true;
    });
    if (checkedTypes.size > 0) {
      filtered = filtered.filter(r => checkedTypes.has(r.mealType || ''));
    }
    if (checkedCategories.size > 0) {
      filtered = filtered.filter(r => checkedCategories.has(r.category || 'lunch-dinner'));
    }
    if (checkedCuisines.size > 0) {
      filtered = filtered.filter(r => checkedCuisines.has(r.cuisine || ''));
    }
    const candidates = filtered.filter(r => !weekSet.has(r.id));
    if (candidates.length === 0) return { breakfasts: [], lunches: [] };

    // Sort history newest-first
    const byRecent = [...history].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    // Build map: recipeId → most recent date it was cooked (from plan history)
    const lastCookedMap = {};
    for (const entry of byRecent) {
      for (const rid of entry.recipeIds) {
        if (!lastCookedMap[rid]) lastCookedMap[rid] = entry.date;
      }
    }

    // Also check daily tracker entries for more recent "last eaten" dates
    for (const [dateStr, dayData] of Object.entries(dailyLog)) {
      for (const entry of (dayData.entries || [])) {
        if (entry.type === 'recipe' && entry.recipeId) {
          const existing = lastCookedMap[entry.recipeId];
          if (!existing || dateStr > existing) {
            lastCookedMap[entry.recipeId] = dateStr;
          }
        }
      }
    }

    // Build map: normalized key ingredient → most recent date it was eaten
    const userIngredients = getUserKeyIngredients();
    const ingredientDateMap = {};

    // From plan history
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

    // From daily tracker (may have more recent dates)
    for (const [dateStr, dayData] of Object.entries(dailyLog)) {
      for (const entry of (dayData.entries || [])) {
        if (entry.type === 'recipe' && entry.recipeId) {
          const recipe = getRecipe(entry.recipeId);
          if (!recipe) continue;
          for (const keyIng of userIngredients) {
            const normKey = normalize(keyIng);
            if (recipeHasIngredient(recipe, normKey)) {
              const existing = ingredientDateMap[normKey];
              if (!existing || dateStr > existing) {
                ingredientDateMap[normKey] = dateStr;
              }
            }
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

    // Seasonal ingredients for the user's region
    let seasonalSet = new Set();
    try {
      const loc = localStorage.getItem('sunday-user-location');
      const region = locationToRegion(loc);
      if (region) {
        const currentMonth = new Date().getMonth() + 1;
        seasonalSet = getSeasonalIngredients(region, currentMonth);
      }
    } catch {}

    // Load boosted recipes
    let boostedIds;
    try {
      boostedIds = new Set(JSON.parse(localStorage.getItem('sunday-boosted-recipes') || '[]'));
    } catch { boostedIds = new Set(); }


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

      // Seasonal boost: find in-season ingredients and add bonus
      const seasonalMatches = getRecipeSeasonalIngredients(recipe, seasonalSet);
      const seasonalBonus = seasonalMatches.length * 50;

      // Macro match score
      const macroScore = macroMatchMap[recipe.id] || 0;
      const macroBonus = macroScore * 2;

      const boostBonus = boostedIds.has(recipe.id) ? 100000 : 0;
      const totalScore = recipeDays + ingredientScore + seasonalBonus + macroBonus + boostBonus;

      // Build reason text
      const parts = [];
      if (recipeDays === 9999) parts.push('never cooked');
      else if (recipeDays >= 7) parts.push(`not cooked in ${recipeDays} days`);
      if (neglectedIngredients.length > 0) {
        parts.push('has ' + neglectedIngredients.slice(0, 3).join(', '));
      }
      const reason = parts.join(' · ') || 'good variety pick';

      return { recipe, totalScore, reason, recipeDays, neglectedIngredients, seasonalMatches };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);

    const breakfasts = scored.filter(s => s.recipe.category === 'breakfast').slice(0, 3);
    const lunches = scored.filter(s => s.recipe.category === 'lunch-dinner').slice(0, 3);
    return { breakfasts, lunches };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes, weeklyPlan, showRare, showRetired, checkedTypes, checkedCategories]);

  return (
    <div className={styles.container}>
      {/* Hidden file input for CSV import */}
      <input
        ref={importFileRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={handleImportCSV}
      />


      {/* Global meal filter dropdown */}
      <div className={styles.topFilterRow}>
        <div className={styles.mealFilterWrap} ref={mealFilterRef}>
          <button
            className={`${styles.filterBtn} ${(checkedTypes.size > 0 || checkedCategories.size > 0 || checkedCuisines.size > 0 || checkedTags.size > 0 || showRare || showRetired) ? styles.filterBtnActive : ''}`}
            onClick={() => setMealFilterOpen(p => !p)}
          >
            {(() => {
              const count = checkedTypes.size + checkedCategories.size + checkedCuisines.size + checkedTags.size + (showRare ? 1 : 0) + (showRetired ? 1 : 0);
              return `Filters${count > 0 ? ` (${count})` : ''}`;
            })()}
            <span className={styles.dropdownCaret}>&#9662;</span>
          </button>
          {mealFilterOpen && (
            <div className={styles.mealFilterDropdown}>
              <div className={styles.mealFilterGroup}>
                <span className={styles.mealFilterLabel}>Category</span>
                {[
                  { key: 'breakfast', label: 'Breakfast' },
                  { key: 'lunch-dinner', label: 'Lunch & Dinner' },
                  { key: 'snacks', label: 'Snacks' },
                  { key: 'desserts', label: 'Desserts' },
                  { key: 'drinks', label: 'Drinks' },
                ].map(opt => (
                  <label key={opt.key} className={styles.mealFilterOption}>
                    <input
                      type="checkbox"
                      checked={checkedCategories.has(opt.key)}
                      onChange={() => {
                        setCheckedCategories(prev => {
                          const next = new Set(prev);
                          if (next.has(opt.key)) next.delete(opt.key);
                          else next.add(opt.key);
                          return next;
                        });
                      }}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              {mealTypes.length > 0 && (
                <div className={styles.mealFilterGroup}>
                  <span className={styles.mealFilterLabel}>Meal Type</span>
                  {mealTypes.map(type => (
                    <label key={type} className={styles.mealFilterOption}>
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
              <div className={styles.mealFilterGroup}>
                <span className={styles.mealFilterLabel}>Frequency</span>
                <label className={styles.mealFilterOption}>
                  <input type="checkbox" checked={showRare} onChange={() => setShowRare(p => !p)} />
                  Rare
                </label>
                <label className={styles.mealFilterOption}>
                  <input type="checkbox" checked={showRetired} onChange={() => setShowRetired(p => !p)} />
                  Retired
                </label>
              </div>
              {cuisineList.length > 0 && (
                <div className={styles.mealFilterGroup}>
                  <span className={styles.mealFilterLabel}>Cuisine</span>
                  {cuisineList.map(c => (
                    <label key={c} className={styles.mealFilterOption}>
                      <input
                        type="checkbox"
                        checked={checkedCuisines.has(c)}
                        onChange={() => {
                          setCheckedCuisines(prev => {
                            const next = new Set(prev);
                            if (next.has(c)) next.delete(c);
                            else next.add(c);
                            return next;
                          });
                        }}
                      />
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </label>
                  ))}
                </div>
              )}
              <div className={styles.mealFilterGroup}>
                <span className={styles.mealFilterLabel}>Ingredient Tags</span>
                {Object.entries(TAG_CATEGORIES).map(([catKey, cat]) => {
                  const catTags = ALL_TAGS.filter(t => t.category === catKey);
                  return catTags.map(tag => (
                    <label key={tag.key} className={styles.mealFilterOption}>
                      <input
                        type="checkbox"
                        checked={checkedTags.has(tag.key)}
                        onChange={() => {
                          setCheckedTags(prev => {
                            const next = new Set(prev);
                            if (next.has(tag.key)) next.delete(tag.key);
                            else next.add(tag.key);
                            return next;
                          });
                        }}
                      />
                      <span style={{ color: cat.color, fontWeight: 600 }}>{tag.label}</span>
                    </label>
                  ));
                })}
              </div>
              {(checkedTypes.size > 0 || checkedCategories.size > 0 || checkedCuisines.size > 0 || checkedTags.size > 0 || showRare || showRetired) && (
                <button
                  className={styles.mealFilterClear}
                  onClick={() => { setCheckedTypes(new Set()); setCheckedCategories(new Set()); setCheckedCuisines(new Set()); setCheckedTags(new Set()); setShowRare(false); setShowRetired(false); }}
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 1. This Week's Menu — full-width, dominant */}
      <div className={styles.weekHeader}>
        <button className={styles.collapseToggle} onClick={() => setWeekMenuOpen(p => !p)}>
          <span className={`${styles.collapseArrow}${weekMenuOpen ? ` ${styles.collapseArrowOpen}` : ''}`}>&#9660;</span>
          <h3 className={styles.weekHeading}>This Week's Menu</h3>
        </button>
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
        {weekMenuOpen && (
        <div className={styles.weekContent}>
          <div className={styles.weekMain}>
            {filteredWeeklyRecipes.length === 0 ? (
              <div className={styles.weekEmpty}>
                <span className={styles.weekEmptyIcon}>🍽</span>
                <span>Drag recipes here to plan your week</span>
                <span className={styles.weekEmptyHint}>or click the + button on any recipe below</span>
              </div>
            ) : (
              <div className={styles.weekList}>
                {filteredWeeklyRecipes.map(recipe => {
                  const planned = getPlannedServings(recipe);
                  return (
                    <div
                      key={recipe.id}
                      className={`${styles.weekItem}${lastAdded === recipe.id ? ` ${styles.weekItemNew}` : ''}`}
                    >
                      <div className={styles.weekItemContent}>
                        <button
                          className={styles.weekItemName}
                          onClick={() => onSelect(recipe.id)}
                        >
                          {recipe.title}
                        </button>
                        <span className={styles.weekItemServingsControl}>
                          <button
                            className={styles.weekServingBtn}
                            onClick={() => onUpdateWeeklyServings(recipe.id, Math.max(1, planned - 1))}
                            aria-label="Decrease servings"
                          >
                            &minus;
                          </button>
                          <span className={styles.weekServingCount}>{planned} {planned === 1 ? 'serving' : 'servings'}</span>
                          <button
                            className={styles.weekServingBtn}
                            onClick={() => onUpdateWeeklyServings(recipe.id, planned + 1)}
                            aria-label="Increase servings"
                          >
                            +
                          </button>
                        </span>
                      </div>
                      <button
                        className={styles.weekRemoveBtn}
                        onClick={() => onRemoveFromWeek(recipe.id)}
                        aria-label={`Remove ${recipe.title} from this week`}
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className={styles.weekServings}>
            {(() => {
              const bCount = filteredWeeklyRecipes.filter(r => r.category === 'breakfast').reduce((sum, r) => sum + getPlannedServings(r), 0);
              const ldCount = filteredWeeklyRecipes.filter(r => r.category === 'lunch-dinner').reduce((sum, r) => sum + getPlannedServings(r), 0);
              return (
                <table className={styles.mealsTable}>
                  <thead>
                    <tr>
                      <th></th>
                      <th className={styles.mealsColHeader}>Meals</th>
                      <th className={styles.mealsColHeader}>Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className={styles.servingLabel}>Breakfast</td>
                      <td className={`${styles.servingCount} ${bCount >= weeklyGoals.breakfast ? styles.servingMet : styles.servingUnder}`}>
                        {bCount}
                      </td>
                      <td>
                        <input
                          className={styles.goalInput}
                          type="number"
                          min="0"
                          value={weeklyGoals.breakfast}
                          onChange={e => updateWeeklyGoal('breakfast', e.target.value)}
                        />
                      </td>
                    </tr>
                    <tr>
                      <td className={styles.servingLabel}>Lunch & Dinner</td>
                      <td className={`${styles.servingCount} ${ldCount >= weeklyGoals.lunchDinner ? styles.servingMet : styles.servingUnder}`}>
                        {ldCount}
                      </td>
                      <td>
                        <input
                          className={styles.goalInput}
                          type="number"
                          min="0"
                          value={weeklyGoals.lunchDinner}
                          onChange={e => updateWeeklyGoal('lunchDinner', e.target.value)}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              );
            })()}
          </div>
        </div>
        )}
      </div>

      {/* 2. Suggested Meals + Discover Recipes row */}
      <div className={styles.suggestDiscoverRow}>
      {(suggestions.breakfasts.length > 0 || suggestions.lunches.length > 0) && (
        <div className={styles.suggestBox} role="region" aria-label="Suggested Meals">
          <button className={styles.collapseToggle} onClick={() => setSuggestOpen(p => !p)}>
            <span className={`${styles.collapseArrow}${suggestOpen ? ` ${styles.collapseArrowOpen}` : ''}`}>&#9660;</span>
            <h3 className={styles.suggestHeading}>Suggested Meals</h3>
          </button>
          {suggestOpen && <div className={styles.suggestColumns}>
            {suggestions.breakfasts.length > 0 && (
              <div className={styles.suggestColumn}>
                <span className={styles.suggestCategoryLabel}>Breakfast</span>
                <table className={styles.suggestTable}>
                  <thead>
                    <tr>
                      <th>Meal</th>
                      <th>Days Since</th>
                      <th>Overdue Ingredients</th>
                      <th>Seasonal</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.breakfasts.map(({ recipe, recipeDays, neglectedIngredients, seasonalMatches }) => (
                      <tr
                        key={recipe.id}
                        draggable
                        onDragStart={e => e.dataTransfer.setData('text/plain', recipe.id)}
                        style={{ cursor: 'grab' }}
                      >
                        <td>
                          <button
                            className={styles.suggestName}
                            onClick={() => onSelect(recipe.id)}
                          >
                            {recipe.title}
                          </button>
                        </td>
                        <td className={styles.suggestDays}>
                          {recipeDays === 9999 ? 'Never' : recipeDays}
                        </td>
                        <td className={styles.suggestOverdue}>
                          {neglectedIngredients.length > 0
                            ? neglectedIngredients.slice(0, 3).join(', ')
                            : '—'}
                        </td>
                        <td className={styles.suggestSeasonal}>
                          {seasonalMatches.length > 0
                            ? seasonalMatches.slice(0, 3).join(', ')
                            : '—'}
                        </td>
                        <td>
                          <button
                            className={styles.suggestAddBtn}
                            onClick={() => handleAddToWeekWithPulse(recipe.id)}
                            aria-label={`Add ${recipe.title} to this week`}
                          >
                            +
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {suggestions.lunches.length > 0 && (
              <div className={styles.suggestColumn}>
                <span className={styles.suggestCategoryLabel}>Lunch & Dinner</span>
                <table className={styles.suggestTable}>
                  <thead>
                    <tr>
                      <th>Meal</th>
                      <th>Days Since</th>
                      <th>Overdue Ingredients</th>
                      <th>Seasonal</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.lunches.map(({ recipe, recipeDays, neglectedIngredients, seasonalMatches }) => (
                      <tr
                        key={recipe.id}
                        draggable
                        onDragStart={e => e.dataTransfer.setData('text/plain', recipe.id)}
                        style={{ cursor: 'grab' }}
                      >
                        <td>
                          <button
                            className={styles.suggestName}
                            onClick={() => onSelect(recipe.id)}
                          >
                            {recipe.title}
                          </button>
                        </td>
                        <td className={styles.suggestDays}>
                          {recipeDays === 9999 ? 'Never' : recipeDays}
                        </td>
                        <td className={styles.suggestOverdue}>
                          {neglectedIngredients.length > 0
                            ? neglectedIngredients.slice(0, 3).join(', ')
                            : '—'}
                        </td>
                        <td className={styles.suggestSeasonal}>
                          {seasonalMatches.length > 0
                            ? seasonalMatches.slice(0, 3).join(', ')
                            : '—'}
                        </td>
                        <td>
                          <button
                            className={styles.suggestAddBtn}
                            onClick={() => handleAddToWeekWithPulse(recipe.id)}
                            aria-label={`Add ${recipe.title} to this week`}
                          >
                            +
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>}
        </div>
      )}

      {/* Discover Recipes — collapsible panel */}
      <div className={styles.discoverPanel}>
        <div className={styles.discoverToggleWrap}>
          <button
            className={styles.discoverToggle}
            onClick={() => setDiscoverOpen(prev => !prev)}
            aria-expanded={discoverOpen}
          >
            <span className={`${styles.discoverArrow}${discoverOpen ? ` ${styles.discoverArrowOpen}` : ''}`}>▼</span>
            Discover Meals
          </button>
        </div>
        {discoverOpen && (
          <div className={styles.discoverContent}>
            <div className={styles.addRecipeBox}>
              <div className={styles.discoverSourceRow}>
                <select
                  className={styles.discoverSourceSelect}
                  value={selectedFriend || 'prepday'}
                  onChange={e => {
                    const val = e.target.value;
                    setSelectedFriend(val === 'prepday' ? '' : val);
                    setImportSearch('');
                  }}
                >
                  <option value="prepday">Prep Day Recipes</option>
                  <option value="shared">Shared with Me{pendingShares.length > 0 ? ` (${pendingShares.length} new)` : ''}</option>
                  {friendsWithAccess.map(f => (
                    <option key={f.uid} value={f.uid}>
                      @{f.username || f.displayName}'s Recipes
                    </option>
                  ))}
                </select>
                <input
                  className={styles.addRecipeInput}
                  type="text"
                  placeholder="Search..."
                  value={importSearch}
                  onChange={e => setImportSearch(e.target.value)}
                />
              </div>
              <div className={styles.importList}>
                {selectedFriend === 'shared' ? (
                  // Shared with me: pending + already accepted
                  (() => {
                    const acceptedShared = recipes.filter(r => r.source === 'shared');
                    const filteredAccepted = importSearch.trim()
                      ? acceptedShared.filter(r => r.title.toLowerCase().includes(importSearch.toLowerCase()))
                      : acceptedShared;
                    const filteredPending = importSearch.trim()
                      ? pendingShares.filter(s => (s.recipe?.title || '').toLowerCase().includes(importSearch.toLowerCase()))
                      : pendingShares;
                    const hasAnything = filteredPending.length > 0 || filteredAccepted.length > 0;

                    return !hasAnything ? (
                      <p className={styles.importEmpty}>No shared recipes.</p>
                    ) : (
                      <>
                        {filteredPending.length > 0 && (
                          <>
                            <p className={styles.importSectionLabel}>New</p>
                            {filteredPending.map(share => (
                              <div key={share.id} className={styles.importItem}>
                                <div className={styles.importInfo}>
                                  <span className={styles.importName}>{share.recipe?.title || 'Untitled'}</span>
                                  <span className={styles.importMeta}>from @{share.fromUsername}</span>
                                </div>
                                <div style={{ display: 'flex', gap: '0.3rem' }}>
                                  <button
                                    className={styles.importAddBtn}
                                    onClick={async () => {
                                      if (onAddRecipe && share.recipe) {
                                        const { id, ...rest } = share.recipe;
                                        onAddRecipe({ ...rest, source: 'shared' });
                                      }
                                      const { acceptSharedRecipe } = await import('../utils/firestoreSync');
                                      await acceptSharedRecipe(share.id);
                                      setPendingShares(prev => prev.filter(s => s.id !== share.id));
                                    }}
                                    title="Accept"
                                  >+</button>
                                  <button
                                    className={styles.importAddBtnDisabled}
                                    onClick={async () => {
                                      const { declineSharedRecipe } = await import('../utils/firestoreSync');
                                      await declineSharedRecipe(share.id);
                                      setPendingShares(prev => prev.filter(s => s.id !== share.id));
                                    }}
                                    title="Decline"
                                  >&times;</button>
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                        {filteredAccepted.length > 0 && (
                          <>
                            {filteredPending.length > 0 && <p className={styles.importSectionLabel}>Added</p>}
                            {filteredAccepted.map(r => (
                              <div key={r.id} className={styles.importItem}>
                                <div className={styles.importInfo}>
                                  <span className={styles.importName}>{r.title}</span>
                                  <span className={styles.importMeta}>
                                    {r.category === 'breakfast' ? 'Breakfast' : 'Lunch/Dinner'}
                                  </span>
                                </div>
                                <span className={styles.importAddBtnDisabled}>✓</span>
                              </div>
                            ))}
                          </>
                        )}
                      </>
                    );
                  })()
                ) : selectedFriend ? (
                  // Friend's recipes
                  friendRecipesLoading ? (
                    <p className={styles.importEmpty}>Loading...</p>
                  ) : (() => {
                    const filtered = importSearch.trim()
                      ? friendRecipes.filter(r => r.title.toLowerCase().includes(importSearch.toLowerCase()))
                      : friendRecipes;
                    return filtered.length === 0 ? (
                      <p className={styles.importEmpty}>{importSearch.trim() ? 'No matches' : 'No recipes shared.'}</p>
                    ) : (
                      filtered.slice(0, 15).map((recipe, i) => (
                        <div key={recipe.id || i} className={styles.importItem}>
                          <div className={styles.importInfo}>
                            <span className={styles.importName}>{recipe.title}</span>
                            <span className={styles.importMeta}>
                              {recipe.category === 'breakfast' ? 'Breakfast' : 'Lunch/Dinner'}
                            </span>
                          </div>
                          <button
                            className={recipe.alreadyHave ? styles.importAddBtnDisabled : styles.importAddBtn}
                            disabled={recipe.alreadyHave}
                            onClick={() => {
                              if (onAddRecipe) {
                                const { id, alreadyHave, ...rest } = recipe;
                                onAddRecipe({ ...rest, source: 'shared' });
                                setFriendRecipes(prev => prev.map(r => r === recipe ? { ...r, alreadyHave: true } : r));
                              }
                            }}
                          >
                            {recipe.alreadyHave ? '✓' : '+'}
                          </button>
                        </div>
                      ))
                    );
                  })()
                ) : (
                  // Prep Day recipes
                  <>
                    {discoverSelected.size > 0 && (
                      <div className={styles.discoverBulkRow}>
                        <span className={styles.discoverBulkCount}>{discoverSelected.size} selected</span>
                        <button className={styles.discoverBulkBtn} onClick={handleAddDiscoverSelected}>
                          Add {discoverSelected.size} Recipe{discoverSelected.size > 1 ? 's' : ''}
                        </button>
                      </div>
                    )}
                    {importableRecipes.slice(0, 20).map(recipe => (
                      <div key={recipe.id} className={`${styles.importItem} ${discoverSelected.has(recipe.title) ? styles.importItemSelected : ''}`}>
                        <input
                          type="checkbox"
                          checked={discoverSelected.has(recipe.title)}
                          onChange={() => toggleDiscoverSelect(recipe.title)}
                          className={styles.discoverCheck}
                        />
                        <div className={styles.importInfo} onClick={() => toggleDiscoverSelect(recipe.title)} style={{ cursor: 'pointer' }}>
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
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* 4. My Recipes heading + Search + Filter Row */}
      <div className={styles.sectionHeader}>
        <button className={styles.collapseToggle} onClick={() => setMyRecipesOpen(p => !p)}>
          <span className={`${styles.collapseArrow}${myRecipesOpen ? ` ${styles.collapseArrowOpen}` : ''}`}>&#9660;</span>
          <h3 className={styles.sectionHeading}>My Recipes</h3>
        </button>
      </div>
      {importResult && (
        <p className={styles.importResult}>{importResult}</p>
      )}
      {myRecipesOpen && <>
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search recipes..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>
      {/* Shopping List (from + selections) */}
      {shopItems.length > 0 && (
        <ShopPreview
          shopItems={shopItems}
          onClear={() => {
            setShopSelection(new Set());
            try { localStorage.setItem(SHOP_KEY, JSON.stringify([])); } catch {}
            if (user) saveField(user.uid, 'shoppingSelection', []);
          }}
        />
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
                    showTags={false}
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
                  showTags={false}
                />
              ))}
            </div>
          )}
        </div>
        <div className={styles.rightCol}>
          <div className={styles.addBtnWrap}>
            <button className={`${styles.addBtn} ${showAddTip ? styles.addBtnHighlight : ''}`} onClick={() => { onAdd(); setShowAddTip(false); }} style={{ width: '100%' }}>
              + Recipe
            </button>
            {showAddTip && (
              <div className={styles.addBtnTipPopup}>
                <button className={styles.addBtnTipClose} onClick={() => setShowAddTip(false)}>&times;</button>
                <strong>Start here!</strong> Import recipes from websites, social media, or let AI create them for you.
              </div>
            )}
          </div>
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
                      showTags={false}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          </div>
        </div>
      </div>
      </>}
    </div>
  );
}
