import { useState, useMemo, useEffect, useRef } from 'react';
import { RecipeCard } from './RecipeCard';
import { loadStarterRecipes } from '../utils/starterRecipes';
import { getUserKeyIngredients, normalize, recipeHasIngredient } from '../utils/keyIngredients';
import { exportToCSV, importFromCSV } from '../utils/exportData';
import { locationToRegion, getSeasonalIngredients, getRecipeSeasonalIngredients } from '../utils/seasonal';
import { useAuth } from '../contexts/AuthContext';
import { loadUserData, saveField, loadFriends, loadFriendRecipes, getPendingSharedRecipes, shareRecipe, getUsername } from '../utils/firestoreSync';
import { copyMealImage, loadAdminMealImages, generateMealImage, getCachedMealImage } from '../utils/generateMealImage';
import { ALL_TAGS, TAG_CATEGORIES, recipeMatchesTags } from '../utils/ingredientTags';
import { detectCuisine } from '../utils/detectCuisine';
import { WidgetLayout } from './WidgetLayout';
import GridLayoutLib, { WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
const GridLayout = WidthProvider(GridLayoutLib);
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

function getSeason() {
  const m = new Date().getMonth();
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'fall';
  return 'winter';
}

const SEASON_THEME = {
  spring: { bg: '#f0fdf4', border: '#86efac', title: '#166534', text: '#15803d', chipBg: '#dcfce7', chipText: '#166534', emoji: '🌱', label: 'Spring Produce' },
  summer: { bg: '#fefce8', border: '#fde047', title: '#854d0e', text: '#a16207', chipBg: '#fef9c3', chipText: '#854d0e', emoji: '☀️', label: 'Summer Produce' },
  fall:   { bg: '#fff7ed', border: '#fdba74', title: '#9a3412', text: '#c2410c', chipBg: '#ffedd5', chipText: '#9a3412', emoji: '🍂', label: 'Fall Harvest' },
  winter: { bg: '#eff6ff', border: '#93c5fd', title: '#1e3a5f', text: '#2563eb', chipBg: '#dbeafe', chipText: '#1e3a5f', emoji: '❄️', label: 'Winter Produce' },
};

const SEASON_FALLBACK = {
  spring: ['Asparagus', 'Peas', 'Artichokes', 'Radishes', 'Strawberries', 'Rhubarb', 'Spinach', 'Fava Beans', 'Arugula', 'Green Onions', 'Mint', 'Leeks'],
  summer: ['Tomatoes', 'Corn', 'Peaches', 'Zucchini', 'Blueberries', 'Watermelon', 'Basil', 'Bell Peppers', 'Cucumbers', 'Cherries', 'Eggplant', 'Mangoes'],
  fall:   ['Pumpkin', 'Butternut Squash', 'Apples', 'Sweet Potatoes', 'Cranberries', 'Pears', 'Brussels Sprouts', 'Figs', 'Pomegranate', 'Sage', 'Parsnips', 'Beets'],
  winter: ['Citrus', 'Kale', 'Cauliflower', 'Turnips', 'Clementines', 'Persimmons', 'Rutabaga', 'Collard Greens', 'Grapefruit', 'Blood Oranges', 'Cabbage', 'Leeks'],
};

const REGION_OPTIONS = [
  { key: 'northeast', label: 'Northeast' },
  { key: 'southeast', label: 'Southeast' },
  { key: 'midwest', label: 'Midwest' },
  { key: 'southwest', label: 'Southwest' },
  { key: 'west_coast', label: 'West Coast' },
  { key: 'pacific_northwest', label: 'Pacific Northwest' },
];

function SeasonalTicker() {
  const season = getSeason();
  const theme = SEASON_THEME[season];
  const region = useMemo(() => {
    try {
      const stats = JSON.parse(localStorage.getItem('sunday-body-stats') || '{}');
      return locationToRegion(stats.location) || 'southeast';
    } catch { return 'southeast'; }
  }, []);
  const month = new Date().getMonth();
  const items = useMemo(() => {
    const seasonal = getSeasonalIngredients(region, month);
    if (seasonal.size > 0) return [...seasonal].slice(0, 20);
    return SEASON_FALLBACK[season] || [];
  }, [region, month, season]);

  if (items.length === 0) return null;

  const tickerText = items.join('  ·  ');
  // Double the text for seamless loop
  return (
    <div className={styles.seasonalTicker}>
      <span className={styles.seasonalTickerLabel} style={{ background: theme.chipBg, color: theme.chipText }}>
        {theme.emoji} In Season
      </span>
      <div className={styles.seasonalTickerTrack}>
        <div className={styles.seasonalTickerScroll}>
          <span>{tickerText}</span>
          <span>{tickerText}</span>
        </div>
      </div>
    </div>
  );
}

function SeasonalSidebar() {
  const season = getSeason();
  const theme = SEASON_THEME[season];
  const [selectedRegion, setSelectedRegion] = useState(() => {
    const loc = localStorage.getItem('sunday-user-location');
    return locationToRegion(loc) || 'northeast';
  });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false);
    }
    if (dropdownOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  function changeRegion(key) {
    setSelectedRegion(key);
    localStorage.setItem('sunday-user-location', key);
    setDropdownOpen(false);
  }

  const month = new Date().getMonth() + 1;
  const seasonalSet = getSeasonalIngredients(selectedRegion, month);
  let items = [...seasonalSet].slice(0, 14).map(s => s.charAt(0).toUpperCase() + s.slice(1));
  if (items.length === 0) items = SEASON_FALLBACK[season];
  const regionLabel = REGION_OPTIONS.find(r => r.key === selectedRegion)?.label || 'Northeast';

  // Use JS scroll listener to manually position — immune to all CSS containing block issues
  const sidebarRef = useRef(null);
  useEffect(() => {
    function position() {
      if (!sidebarRef.current) return;
      sidebarRef.current.style.top = (window.scrollY + 75) + 'px';
    }
    position();
    window.addEventListener('scroll', position, { passive: true });
    return () => window.removeEventListener('scroll', position);
  }, []);

  return (
    <div ref={sidebarRef} style={{ position: 'absolute', right: '16px', top: '75px', width: '230px', zIndex: 5 }}>
      <div ref={dropdownRef} style={{ position: 'relative', marginBottom: '0.4rem' }}>
        <button
          onClick={() => setDropdownOpen(p => !p)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.35rem 0.65rem', background: 'rgba(232, 213, 176, 0.6)', border: '1px solid rgba(200, 176, 128, 0.4)',
            borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.75rem', fontWeight: 700, color: '#5C3D1A',
          }}
        >
          <span>📍 {regionLabel}</span>
          <span style={{ fontSize: '0.6rem', marginLeft: '0.3rem' }}>{dropdownOpen ? '▲' : '▼'}</span>
        </button>
        {dropdownOpen && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '2px',
            background: '#fff', border: '1px solid #CEDAE5', borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, overflow: 'hidden',
          }}>
            {REGION_OPTIONS.map(r => (
              <button
                key={r.key}
                onClick={() => changeRegion(r.key)}
                style={{
                  display: 'block', width: '100%', padding: '0.4rem 0.65rem', border: 'none',
                  background: r.key === selectedRegion ? '#EBF2F9' : '#fff', textAlign: 'left',
                  fontSize: '0.75rem', fontWeight: r.key === selectedRegion ? 700 : 500,
                  color: r.key === selectedRegion ? '#3B6B9C' : '#4A5B6E',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
                onMouseEnter={e => { if (r.key !== selectedRegion) e.target.style.background = '#F8FAFC'; }}
                onMouseLeave={e => { if (r.key !== selectedRegion) e.target.style.background = '#fff'; }}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={styles.seasonalSidebar}>
        <div className={styles.seasonalHeader}>
          {theme.emoji} {theme.label}
        </div>
        <div className={styles.seasonalSub}>What's fresh right now</div>
        <div className={styles.seasonalDivider} />
        <div className={styles.seasonalChips}>
          {items.map(item => (
            <span key={item} className={styles.seasonalChip}>
              {item}
            </span>
          ))}
        </div>
      </div>
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
  onUpdateRecipe,
  isNewUser,
}) {
  const { user } = useAuth();
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dragOverTarget, setDragOverTarget] = useState(null);
  const [showCommon, setShowCommon] = useState(true);
  const [showRare, setShowRare] = useState(false);
  const [showToTry, setShowToTry] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const [filterSearchQuery, setFilterSearchQuery] = useState('');
  const [hiddenCategories, setHiddenCategories] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('sunday-hidden-categories') || '[]')); } catch { return new Set(); }
  });
  const ALL_CAT_KEYS = ['breakfast', 'lunch-dinner', 'snacks', 'desserts', 'drinks'];
  const columnsRef = useRef(null);

  // Custom widgets inside the grid — per-user
  const CUSTOM_WIDGETS_KEY = user ? `sunday-custom-grid-widgets-${user.uid}` : 'sunday-custom-grid-widgets';
  const [customGridWidgets, setCustomGridWidgets] = useState(() => {
    try { return JSON.parse(localStorage.getItem(user ? `sunday-custom-grid-widgets-${user.uid}` : 'sunday-custom-grid-widgets')) || []; } catch { return []; }
  });
  const [addingGridWidget, setAddingGridWidget] = useState(false);
  const [newGridWidgetName, setNewGridWidgetName] = useState('');

  const FALLBACK_CAT_LAYOUT = [
    { i: 'breakfast', x: 0, y: 0, w: 4, h: 20 },
    { i: 'lunch-dinner', x: 4, y: 0, w: 8, h: 20 },
    { i: 'snacks', x: 0, y: 20, w: 4, h: 16 },
    { i: 'desserts', x: 4, y: 20, w: 4, h: 16 },
    { i: 'drinks', x: 8, y: 20, w: 4, h: 16 },
  ];

  const [adminDefaultLayout, setAdminDefaultLayout] = useState(null);

  // Load admin's default layout from Firestore
  useEffect(() => {
    loadUserData(ADMIN_UID).then(data => {
      if (data?.defaultCatLayout) setAdminDefaultLayout(data.defaultCatLayout);
    }).catch(() => {});
  }, []);

  const DEFAULT_CAT_LAYOUT = adminDefaultLayout || FALLBACK_CAT_LAYOUT;

  const [catLayout, setCatLayout] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sunday-cat-layout')) || FALLBACK_CAT_LAYOUT; } catch { return FALLBACK_CAT_LAYOUT; }
  });

  // Load user's saved layout from Firestore on mount
  useEffect(() => {
    if (!user) return;
    loadUserData(user.uid).then(data => {
      if (data?.catLayout) {
        setCatLayout(data.catLayout);
        localStorage.setItem('sunday-cat-layout', JSON.stringify(data.catLayout));
      } else if (adminDefaultLayout && !localStorage.getItem('sunday-cat-layout')) {
        setCatLayout(adminDefaultLayout);
      }
    }).catch(() => {});
  }, [user, adminDefaultLayout]);

  // Sync layout and custom widgets from Firestore when another device changes it
  useEffect(() => {
    const handleSync = () => {
      try {
        const saved = localStorage.getItem('sunday-cat-layout');
        if (saved) setCatLayout(JSON.parse(saved));
      } catch {}
      try {
        const saved = localStorage.getItem(CUSTOM_WIDGETS_KEY);
        if (saved) setCustomGridWidgets(JSON.parse(saved));
      } catch {}
    };
    window.addEventListener('firestore-sync', handleSync);
    return () => window.removeEventListener('firestore-sync', handleSync);
  }, []);


  const handleCatLayoutChange = (newLayout) => {
    const clean = newLayout
      .filter(item => ALL_CAT_KEYS.includes(item.i) || customWidgetIds.has(item.i))
      .map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    setCatLayout(clean);
    localStorage.setItem('sunday-cat-layout', JSON.stringify(clean));
    if (user) {
      saveField(user.uid, 'catLayout', clean);
    }
    if (user?.uid === ADMIN_UID) {
      saveField(user.uid, 'defaultCatLayout', clean);
    }
  };

  const visibleCats = ALL_CAT_KEYS.filter(k => !hiddenCategories.has(k));
  const allGridKeys = [...visibleCats, ...customGridWidgets.map(w => w.id)];
  const visibleLayout = (() => {
    const existing = catLayout.filter(l => allGridKeys.includes(l.i));
    const existingIds = new Set(existing.map(l => l.i));
    // Add default layout entries for custom widgets not yet in catLayout
    const maxY = existing.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    let extraY = maxY;
    for (const cw of customGridWidgets) {
      if (!existingIds.has(cw.id)) {
        existing.push({ i: cw.id, x: 0, y: extraY, w: 4, h: 16 });
        extraY += 16;
      }
    }
    return existing;
  })();
  const toggleCategory = (key) => {
    setHiddenCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      const arr = [...next];
      localStorage.setItem('sunday-hidden-categories', JSON.stringify(arr));
      if (user) saveField(user.uid, 'hiddenCategories', arr);
      return next;
    });
  };
  function saveCustomGridWidgets(widgets) {
    localStorage.setItem(CUSTOM_WIDGETS_KEY, JSON.stringify(widgets));
    if (user) saveField(user.uid, 'customGridWidgets', widgets);
  }

  function addGridWidget() {
    const name = newGridWidgetName.trim();
    if (!name) return;
    const id = 'cw_' + Date.now();
    const widget = { id, label: name, content: '' };
    const nextWidgets = [...customGridWidgets, widget];
    setCustomGridWidgets(nextWidgets);
    saveCustomGridWidgets(nextWidgets);
    // Add layout entry for the new widget — place below existing items
    const maxY = catLayout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    const newLayoutEntry = { i: id, x: 0, y: maxY, w: 4, h: 16 };
    const nextLayout = [...catLayout, newLayoutEntry];
    setCatLayout(nextLayout);
    localStorage.setItem('sunday-cat-layout', JSON.stringify(nextLayout));
    if (user) saveField(user.uid, 'catLayout', nextLayout);
    setNewGridWidgetName('');
    setAddingGridWidget(false);
  }

  function updateGridWidgetContent(id, content) {
    const next = customGridWidgets.map(w => w.id === id ? { ...w, content } : w);
    setCustomGridWidgets(next);
    saveCustomGridWidgets(next);
  }

  function renameGridWidget(id, newLabel) {
    const next = customGridWidgets.map(w => w.id === id ? { ...w, label: newLabel } : w);
    setCustomGridWidgets(next);
    saveCustomGridWidgets(next);
  }

  const [renamingWidgetId, setRenamingWidgetId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  function removeGridWidget(id) {
    const nextWidgets = customGridWidgets.filter(w => w.id !== id);
    setCustomGridWidgets(nextWidgets);
    saveCustomGridWidgets(nextWidgets);
    const nextLayout = catLayout.filter(l => l.i !== id);
    setCatLayout(nextLayout);
    localStorage.setItem('sunday-cat-layout', JSON.stringify(nextLayout));
    if (user) saveField(user.uid, 'catLayout', nextLayout);
  }

  const customWidgetIds = new Set(customGridWidgets.map(w => w.id));

  const [checkedTypes, setCheckedTypes] = useState(new Set());
  const [checkedCategories, setCheckedCategories] = useState(new Set());
  const [checkedCuisines, setCheckedCuisines] = useState(new Set());
  const [checkedTags, setCheckedTags] = useState(new Set());
  const [checkedSources, setCheckedSources] = useState(new Set());
  const [mealFilterOpen, setMealFilterOpen] = useState(false);
  const mealFilterRef = useRef(null);
  const [showSaved, setShowSaved] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickCategory, setQuickCategory] = useState('lunch-dinner');
  const [importSearch, setImportSearch] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [manageSelected, setManageSelected] = useState(new Set());
  const [manageFriends, setManageFriends] = useState(null);
  const [manageStatus, setManageStatus] = useState('');
  const [cookbookName, setCookbookName] = useState('');
  const [showCookbookInput, setShowCookbookInput] = useState(false);
  // Legacy compat
  const shareMode = manageMode;
  const shareSelected = manageSelected;
  const setShareSelected = setManageSelected;
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
  const [aiEnabled, setAiEnabled] = useState(() => localStorage.getItem('sunday-ai-meals-enabled') !== 'false');
  const [aiMeals, setAiMeals] = useState([]);
  const [aiPreview, setAiPreview] = useState(null);
  const [aiSkipping, setAiSkipping] = useState(null); // null or category string being loaded
  const skippedTitlesRef = useRef([]);

  function skipAiMeal(mealToSkip) {
    skippedTitlesRef.current.push(mealToSkip.title);
    setAiMeals(prev => prev.filter(p => p.title !== mealToSkip.title));
    // Fetch a replacement
    const skipCategory = mealToSkip.category || mealToSkip._category || 'lunch-dinner';
    setAiSkipping(skipCategory);
    const cuisineCounts = {};
    for (const r of recipes) {
      const c = r.cuisine || detectCuisine(r.title, r.ingredients);
      cuisineCounts[c] = (cuisineCounts[c] || 0) + 1;
    }
    const topCuisines = Object.entries(cuisineCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
    const ingCounts = {};
    for (const r of recipes) for (const ing of r.ingredients || []) {
      const k = (ing.ingredient || '').toLowerCase();
      if (k) ingCounts[k] = (ingCounts[k] || 0) + 1;
    }
    const topIngredients = Object.entries(ingCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([i]) => i);
    const recentRecipes = [...recipes.slice(0, 10).map(r => r.title), ...skippedTitlesRef.current];
    fetch('/api/recommend-meals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topCuisines, topIngredients, recentRecipes }),
    }).then(r => r.json()).then(data => {
      if (data.recipes) {
        // Find a replacement that isn't already shown or skipped
        const existingTitles = new Set([...aiMeals.map(m => m.title), ...skippedTitlesRef.current]);
        const targetCat = mealToSkip.category || mealToSkip._category;
        const replacement = data.recipes.find(m => !existingTitles.has(m.title) && (m.category === targetCat || (!targetCat && m.category !== 'breakfast')));
        if (replacement) {
          if (!replacement.category) replacement.category = targetCat || 'lunch-dinner';
          setAiMeals(prev => [...prev, replacement]);
        }
      }
    }).catch(() => {}).finally(() => setAiSkipping(null));
  }
  const [aiMealsLoading, setAiMealsLoading] = useState(false);
  const aiMealsFetched = useRef(false);
  const [suggestColsOpen, setSuggestColsOpen] = useState(false);
  const [suggestCols, setSuggestCols] = useState({ overdue: true, seasonal: true });
  const [myRecipesOpen, setMyRecipesOpen] = useState(true);
  const [lastAdded, setLastAdded] = useState(null);
  const [weeklyGoals, setWeeklyGoals] = useState(() => {
    try {
      const data = localStorage.getItem(WEEKLY_GOALS_KEY);
      return data ? JSON.parse(data) : { breakfast: 7, lunchDinner: 7 };
    } catch { return { breakfast: 7, lunchDinner: 7 }; }
  });
  const [editingGoals, setEditingGoals] = useState(false);
  const [showTargets, setShowTargets] = useState(() => {
    try { return localStorage.getItem('sunday-show-targets') === 'true'; } catch { return false; }
  });
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
    if (freq === 'toTry') return showToTry;
    if (freq === 'common') return showCommon;
    return showCommon;
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
    visible = visible.filter(r => {
      // Check ingredient-based tags
      if (recipeMatchesTags(r, checkedTags)) return true;
      // Check custom tags
      if (r.customTags?.length > 0) {
        return r.customTags.some(t => checkedTags.has('custom:' + t));
      }
      return false;
    });
  }
  if (checkedSources.size > 0) {
    visible = visible.filter(r => checkedSources.has(r.source || 'unknown'));
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
  const [adminImages, setAdminImages] = useState({});
  const [addedIds, setAddedIds] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    async function fetchAdmin() {
      try {
        const data = await loadUserData(ADMIN_UID);
        if (!cancelled) setAdminRecipes(data?.recipes || []);
        // Load admin meal images for discover thumbnails
        const images = await loadAdminMealImages(ADMIN_UID);
        if (!cancelled) setAdminImages(images);
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
    let available = adminRecipes.map(r => ({
      ...r,
      alreadyOwned: existingTitles.has(r.title.toLowerCase()) || addedIds.has(r.title.toLowerCase()),
    }));
    // Apply frequency filter
    available = available.filter(r => {
      const freq = r.frequency || 'common';
      if (freq === 'retired') return showRetired;
      if (freq === 'rare') return showRare;
      if (freq === 'common') return showCommon;
      return showCommon;
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
    available.sort((a, b) => {
      if (a.alreadyOwned !== b.alreadyOwned) return a.alreadyOwned ? 1 : -1;
      return a.title.localeCompare(b.title);
    });
    if (!importSearch.trim()) return available;
    const q = importSearch.trim().toLowerCase();
    return available.filter(r => r.title.toLowerCase().includes(q));
  }, [adminRecipes, recipes, addedIds, importSearch, showRare, showToTry, showRetired, checkedTypes, checkedCategories, checkedCuisines]);

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

  // Fetch AI meal suggestions (once, on first open)
  useEffect(() => {
    if (!suggestOpen || !aiEnabled || aiMealsFetched.current || recipes.length < 1) return;
    aiMealsFetched.current = true;
    setAiMealsLoading(true);
    const cuisineCounts = {};
    for (const r of recipes) {
      const c = r.cuisine || detectCuisine(r.title, r.ingredients);
      cuisineCounts[c] = (cuisineCounts[c] || 0) + 1;
    }
    const topCuisines = Object.entries(cuisineCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
    const ingCounts = {};
    for (const r of recipes) for (const ing of r.ingredients || []) {
      const k = (ing.ingredient || '').toLowerCase();
      if (k) ingCounts[k] = (ingCounts[k] || 0) + 1;
    }
    const topIngredients = Object.entries(ingCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([i]) => i);
    const recentRecipes = recipes.slice(0, 10).map(r => r.title);
    fetch('/api/recommend-meals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topCuisines, topIngredients, recentRecipes }),
    }).then(r => r.json()).then(data => {
      if (data.recipes && data.recipes.length > 0) {
        // Ensure at least one goes to breakfast, rest to lunch-dinner
        const meals = data.recipes.slice(0, 3);
        const hasBreakfast = meals.some(m => m.category === 'breakfast');
        if (!hasBreakfast && meals.length > 1) meals[0].category = 'breakfast';
        setAiMeals(meals);
      }
    }).catch((err) => { console.error('AI meals error:', err); }).finally(() => setAiMealsLoading(false));
  }, [suggestOpen, aiEnabled, recipes]);

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
      if (freq === 'common') return showCommon;
      return showCommon; // default to common behavior
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
    if (checkedTags.size > 0) {
      filtered = filtered.filter(r => {
        if (recipeMatchesTags(r, checkedTags)) return true;
        if (r.customTags?.length > 0) return r.customTags.some(t => checkedTags.has('custom:' + t));
        return false;
      });
    }
    if (checkedSources.size > 0) {
      filtered = filtered.filter(r => checkedSources.has(r.source || 'unknown'));
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

    const breakfasts = scored.filter(s => s.recipe.category === 'breakfast').slice(0, 10);
    const lunches = scored.filter(s => s.recipe.category === 'lunch-dinner').slice(0, 10);
    return { breakfasts, lunches };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes, weeklyPlan, showCommon, showRare, showToTry, showRetired, checkedTypes, checkedCategories, checkedCuisines, checkedTags, checkedSources]);

  return (
    <>
    <SeasonalSidebar />
    <div className={styles.container}>
      {/* Hidden file input for CSV import */}
      <input
        ref={importFileRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={handleImportCSV}
      />


      {/* Page header */}
      <div style={{ marginBottom: '0.75rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 0.25rem', letterSpacing: '-0.02em' }}>My Recipes</h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.45 }}>Your personal recipe collection. Add, organize, and plan meals from all your favorite sources.</p>
      </div>

      {/* Global meal filter dropdown */}
      <div className={styles.topFilterRow}>
        <button className={`${styles.addBtn} ${showAddTip ? styles.addBtnHighlight : ''}`} onClick={() => { onAdd(); setShowAddTip(false); }}>
          + Recipes
        </button>
        <button
          className={`${styles.importBtn}${manageMode ? ` ${styles.editBtnActive}` : ''}`}
          onClick={async () => {
            if (manageMode) {
              setManageMode(false);
              setManageSelected(new Set());
              setManageFriends(null);
              setManageStatus('');
              setShowCookbookInput(false);
            } else {
              setManageMode(true);
              setEditMode(false);
              setManageSelected(new Set());
              if (user) {
                loadFriends(user.uid).then(setManageFriends).catch(() => setManageFriends([]));
              }
            }
          }}
        >
          {manageMode ? 'Done' : 'Manage Recipes'}
        </button>
        <input
          className={styles.topSearchInput}
          type="text"
          placeholder="Search recipes..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <div className={styles.mealFilterWrap} ref={mealFilterRef}>
          <button
            className={`${styles.filterBtn} ${(checkedTypes.size > 0 || checkedCategories.size > 0 || checkedCuisines.size > 0 || checkedTags.size > 0 || checkedSources.size > 0 || showToTry || showRare || showRetired || !showCommon) ? styles.filterBtnActive : ''}`}
            onClick={() => setMealFilterOpen(p => !p)}
          >
            {(() => {
              const count = checkedTypes.size + checkedCategories.size + checkedCuisines.size + checkedTags.size + checkedSources.size + (showToTry ? 1 : 0) + (showRare ? 1 : 0) + (showRetired ? 1 : 0);
              return `Filter Recipes${count > 0 ? ` (${count})` : ''}`;
            })()}
            <span className={styles.dropdownCaret}>&#9662;</span>
          </button>
          {mealFilterOpen && (
            <div className={styles.mealFilterDropdown}>
              <input
                className={styles.filterSearch}
                type="text"
                placeholder="Search filters..."
                value={filterSearchQuery || ''}
                onChange={e => setFilterSearchQuery(e.target.value)}
                autoFocus
              />
              {(() => {
                const fq = (filterSearchQuery || '').toLowerCase();
                const match = label => !fq || label.toLowerCase().includes(fq);
                const catOpts = [
                  { key: 'breakfast', label: 'Breakfast' },
                  { key: 'lunch-dinner', label: 'Lunch & Dinner' },
                  { key: 'snacks', label: 'Snacks' },
                  { key: 'desserts', label: 'Desserts' },
                  { key: 'drinks', label: 'Drinks' },
                ].filter(o => match(o.label));
                const filteredTypes = mealTypes.filter(t => match(t));
                const freqOpts = [
                  { label: 'Common', checked: showCommon, toggle: () => setShowCommon(p => !p) },
                  { label: 'To Try', checked: showToTry, toggle: () => setShowToTry(p => !p) },
                  { label: 'Rare', checked: showRare, toggle: () => setShowRare(p => !p) },
                  { label: 'Retired', checked: showRetired, toggle: () => setShowRetired(p => !p) },
                ].filter(o => match(o.label));
                return <>
                  {catOpts.length > 0 && <div className={styles.mealFilterGroup}>
                    <span className={styles.mealFilterLabel}>Category</span>
                    {catOpts.map(opt => (
                      <label key={opt.key} className={styles.mealFilterOption}>
                        <input type="checkbox" checked={checkedCategories.has(opt.key)} onChange={() => {
                          setCheckedCategories(prev => { const next = new Set(prev); if (next.has(opt.key)) next.delete(opt.key); else next.add(opt.key); return next; });
                        }} />
                        {opt.label}
                      </label>
                    ))}
                  </div>}
                  {filteredTypes.length > 0 && <div className={styles.mealFilterGroup}>
                    <span className={styles.mealFilterLabel}>Meal Type</span>
                    {filteredTypes.map(type => (
                      <label key={type} className={styles.mealFilterOption}>
                        <input type="checkbox" checked={checkedTypes.has(type)} onChange={() => {
                          setCheckedTypes(prev => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next; });
                        }} />
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </label>
                    ))}
                  </div>}
                  {freqOpts.length > 0 && <div className={styles.mealFilterGroup}>
                    <span className={styles.mealFilterLabel}>Frequency</span>
                    {freqOpts.map(o => (
                      <label key={o.label} className={styles.mealFilterOption}>
                        <input type="checkbox" checked={o.checked} onChange={o.toggle} />
                        {o.label}
                      </label>
                    ))}
                  </div>}
                </>;
              })()}
              {(() => {
                const fq = (filterSearchQuery || '').toLowerCase();
                const match = label => !fq || label.toLowerCase().includes(fq);
                const filteredCuisines = cuisineList.filter(c => match(c));
                const filteredIngTags = ALL_TAGS.filter(t => match(t.label));
                const allCustomTags = [...new Set(recipes.flatMap(r => r.customTags || []))].sort().filter(t => match(t));
                return <>
                  {filteredCuisines.length > 0 && <div className={styles.mealFilterGroup}>
                    <span className={styles.mealFilterLabel}>Cuisine</span>
                    {filteredCuisines.map(c => (
                      <label key={c} className={styles.mealFilterOption}>
                        <input type="checkbox" checked={checkedCuisines.has(c)} onChange={() => {
                          setCheckedCuisines(prev => { const next = new Set(prev); if (next.has(c)) next.delete(c); else next.add(c); return next; });
                        }} />
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </label>
                    ))}
                  </div>}
                  {filteredIngTags.length > 0 && <div className={styles.mealFilterGroup}>
                    <span className={styles.mealFilterLabel}>Ingredient Tags</span>
                    {filteredIngTags.map(tag => {
                      const cat = TAG_CATEGORIES[tag.category];
                      return (
                        <label key={tag.key} className={styles.mealFilterOption}>
                          <input type="checkbox" checked={checkedTags.has(tag.key)} onChange={() => {
                            setCheckedTags(prev => { const next = new Set(prev); if (next.has(tag.key)) next.delete(tag.key); else next.add(tag.key); return next; });
                          }} />
                          <span style={{ color: cat.color, fontWeight: 600 }}>{tag.label}</span>
                        </label>
                      );
                    })}
                  </div>}
                  {allCustomTags.length > 0 && <div className={styles.mealFilterGroup}>
                    <span className={styles.mealFilterLabel}>Custom Tags</span>
                    {allCustomTags.map(tag => (
                      <label key={tag} className={styles.mealFilterOption}>
                        <input type="checkbox" checked={checkedTags.has('custom:' + tag)} onChange={() => {
                          setCheckedTags(prev => { const next = new Set(prev); const key = 'custom:' + tag; if (next.has(key)) next.delete(key); else next.add(key); return next; });
                        }} />
                        {tag}
                      </label>
                    ))}
                  </div>}
                  {(() => {
                    const sourceLabels = {
                      ai: 'AI Generated', discover: 'Prep Day Recipes', starter: 'Prep Day Recipes',
                      shared: 'Shared by Friend', bulk: 'Bulk Upload', url: 'Imported from URL',
                      tiktok: 'TikTok', instagram: 'Instagram', pinterest: 'Pinterest',
                      paste: 'Pasted Text', manual: 'Manual Entry', restaurant: 'Restaurant',
                      'admin-setup': 'Admin Setup',
                    };
                    const allSources = [...new Set(recipes.map(r => r.source || 'unknown'))].filter(s => s !== 'unknown').sort();
                    const filteredSources = allSources.filter(s => match(sourceLabels[s] || s));
                    if (filteredSources.length === 0) return null;
                    return <div className={styles.mealFilterGroup}>
                      <span className={styles.mealFilterLabel}>Source</span>
                      {filteredSources.map(src => (
                        <label key={src} className={styles.mealFilterOption}>
                          <input type="checkbox" checked={checkedSources.has(src)} onChange={() => {
                            setCheckedSources(prev => { const next = new Set(prev); if (next.has(src)) next.delete(src); else next.add(src); return next; });
                          }} />
                          {sourceLabels[src] || src}
                        </label>
                      ))}
                    </div>;
                  })()}
                </>;
              })()}
              {(checkedTypes.size > 0 || checkedCategories.size > 0 || checkedCuisines.size > 0 || checkedTags.size > 0 || checkedSources.size > 0 || showToTry || showRare || showRetired) && (
                <button
                  className={styles.mealFilterClear}
                  onClick={() => { setCheckedTypes(new Set()); setCheckedCategories(new Set()); setCheckedCuisines(new Set()); setCheckedTags(new Set()); setCheckedSources(new Set()); setShowCommon(true); setShowToTry(false); setShowRare(false); setShowRetired(false); }}
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <WidgetLayout userId={user?.uid}>
      {/* 1. This Week's Menu — full-width, dominant */}
      <div data-widget="weeklyMeals">
      <div className={styles.weekHeader}>
        <button className={styles.collapseToggle} onClick={() => setWeekMenuOpen(p => !p)}>
          <span className={`${styles.collapseArrow}${weekMenuOpen ? ` ${styles.collapseArrowOpen}` : ''}`}>&#9660;</span>
          <h3 className={styles.weekHeading}>This Week's Meals</h3>
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
        aria-label="This Week's Meals"
      >
        {weekMenuOpen && (
        <div className={styles.weekContent}>
          <div className={styles.weekMain}>
            {filteredWeeklyRecipes.length === 0 ? (
              <div className={styles.weekEmpty}>
                <span className={styles.weekEmptyIcon}>🍽</span>
                <span className={styles.weekEmptyTitle}>Click the + next to recipes below to add them to your shopping list</span>
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
              const bRecipes = filteredWeeklyRecipes.filter(r => r.category === 'breakfast');
              const ldRecipes = filteredWeeklyRecipes.filter(r => r.category === 'lunch-dinner');
              const bRecipeCount = bRecipes.length;
              const bServings = bRecipes.reduce((sum, r) => sum + getPlannedServings(r), 0);
              const ldRecipeCount = ldRecipes.length;
              const ldServings = ldRecipes.reduce((sum, r) => sum + getPlannedServings(r), 0);
              return (<>
                <table className={styles.mealsTable}>
                  <thead>
                    <tr>
                      <th></th>
                      <th className={styles.mealsColHeader}>Recipes</th>
                      <th className={styles.mealsColHeader}>Meals</th>
                      {showTargets && <th className={styles.mealsColHeader}>Target</th>}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className={styles.servingLabel}>Breakfast</td>
                      <td className={styles.servingCount}>{bRecipeCount}</td>
                      <td className={`${styles.servingCount} ${showTargets && bServings >= weeklyGoals.breakfast ? styles.servingMet : showTargets && bServings < weeklyGoals.breakfast ? styles.servingUnder : ''}`}>
                        {bServings}
                      </td>
                      {showTargets && (
                        <td>
                          <input
                            className={styles.goalInput}
                            type="number"
                            min="0"
                            value={weeklyGoals.breakfast}
                            onChange={e => updateWeeklyGoal('breakfast', e.target.value)}
                          />
                        </td>
                      )}
                    </tr>
                    <tr>
                      <td className={styles.servingLabel}>Lunch & Dinner</td>
                      <td className={styles.servingCount}>{ldRecipeCount}</td>
                      <td className={`${styles.servingCount} ${showTargets && ldServings >= weeklyGoals.lunchDinner ? styles.servingMet : showTargets && ldServings < weeklyGoals.lunchDinner ? styles.servingUnder : ''}`}>
                        {ldServings}
                      </td>
                      {showTargets && (
                        <td>
                          <input
                            className={styles.goalInput}
                            type="number"
                            min="0"
                            value={weeklyGoals.lunchDinner}
                            onChange={e => updateWeeklyGoal('lunchDinner', e.target.value)}
                          />
                        </td>
                      )}
                    </tr>
                  </tbody>
                </table>
                <button
                  onClick={() => {
                    const next = !showTargets;
                    setShowTargets(next);
                    localStorage.setItem('sunday-show-targets', String(next));
                  }}
                  style={{ background: 'none', border: 'none', fontSize: '0.72rem', color: 'var(--color-text-muted)', cursor: 'pointer', fontFamily: 'inherit', padding: '0.2rem 0', marginTop: '0.25rem' }}
                >
                  {showTargets ? 'Hide targets' : 'Show targets'}
                </button>
              </>);
            })()}
          </div>
        </div>
        )}
      </div>

      </div>
      {/* 2. Suggested Meals + Discover Recipes row */}
      <div data-widget="suggestedMeals"><div className={styles.suggestDiscoverRow}>
        <div className={styles.suggestBox} role="region" aria-label="Suggested Meals">
          <div className={styles.suggestHeadingRow}>
            <button className={styles.collapseToggle} onClick={() => setSuggestOpen(p => !p)}>
              <span className={`${styles.collapseArrow}${suggestOpen ? ` ${styles.collapseArrowOpen}` : ''}`}>&#9660;</span>
              <h3 className={styles.suggestHeading}>Suggested Meals</h3>
            </button>
            <SeasonalTicker />
            <div className={styles.suggestGearWrap}>
              <button
                className={styles.suggestGearBtn}
                onClick={() => setSuggestColsOpen(p => !p)}
                aria-label="Column settings"
                title="Column settings"
              >⚙</button>
              {suggestColsOpen && (
                <div className={styles.suggestGearPopup}>
                  <label className={styles.suggestGearLabel}>
                    <input
                      type="checkbox"
                      checked={aiEnabled}
                      onChange={() => {
                        const next = !aiEnabled;
                        setAiEnabled(next);
                        localStorage.setItem('sunday-ai-meals-enabled', String(next));
                        if (!next) { setAiMeals([]); aiMealsFetched.current = false; }
                      }}
                    />
                    ✨ AI Suggested Meals
                  </label>
                  <label className={styles.suggestGearLabel}>
                    <input
                      type="checkbox"
                      checked={suggestCols.overdue}
                      onChange={() => setSuggestCols(p => ({ ...p, overdue: !p.overdue }))}
                    />
                    Overdue Ingredients
                  </label>
                  <label className={styles.suggestGearLabel}>
                    <input
                      type="checkbox"
                      checked={suggestCols.seasonal}
                      onChange={() => setSuggestCols(p => ({ ...p, seasonal: !p.seasonal }))}
                    />
                    Seasonal
                  </label>
                </div>
              )}
            </div>
          </div>
          {suggestOpen && <div className={styles.suggestColumns}>
              <div className={styles.suggestColumn}>
                <span className={styles.suggestCategoryLabel}>Breakfast</span>
                {suggestions.breakfasts.length > 0 ? (
                <table className={styles.suggestTable}>
                  <thead>
                    <tr>
                      <th>Meal</th>
                      <th>Days Since</th>
                      {suggestCols.overdue && <th>Overdue Ingredients</th>}
                      {suggestCols.seasonal && <th>Seasonal</th>}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const regular = suggestions.breakfasts.map(s => ({ ...s, _type: 'regular' }));
                      const ai = aiMeals.filter(m => m.category === 'breakfast').map((m, i) => ({ _type: 'ai', _ai: m, _aiIdx: i }));
                      // Insert AI meals at stable evenly-spaced positions
                      const merged = [...regular];
                      for (let i = 0; i < ai.length; i++) {
                        const pos = Math.min(merged.length, Math.round((i + 1) * (regular.length + 1) / (ai.length + 1)));
                        merged.splice(pos + i, 0, ai[i]);
                      }
                      return merged.map((item, idx) => {
                        if (item._type === 'ai') {
                          const m = item._ai;
                          return (
                            <tr key={`ai-b-${item._aiIdx}`} className={styles.aiSuggestRow}>
                              <td>
                                <button className={styles.suggestName} style={{ color: '#7C3AED' }} onClick={() => setAiPreview({ ...m, _category: 'breakfast' })}>
                                  ✨ {m.title}
                                </button>
                              </td>
                              <td className={styles.suggestDays} style={{ color: '#7C3AED' }}>AI</td>
                              {suggestCols.overdue && <td>—</td>}
                              {suggestCols.seasonal && <td>—</td>}
                              <td style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                                <button className={styles.aiSuggestAddBtn} onClick={() => {
                                  const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
                                  onAddRecipe({ id, title: m.title, category: 'breakfast', frequency: 'common', mealType: '', servings: m.servings || 2, prepTime: m.prepTime || '', cookTime: m.cookTime || '', sourceUrl: '', ingredients: m.ingredients || [], instructions: m.instructions || '', createdAt: new Date().toISOString(), source: 'discover', cuisine: m.cuisine || '' });
                                  handleAddToWeekWithPulse(id);
                                  setAiMeals(prev => prev.filter(p => p.title !== m.title));
                                }}>+</button>
                                <button className={styles.aiSkipBtn} onClick={() => skipAiMeal(m)} disabled={!!aiSkipping} title="Skip this suggestion">×</button>
                              </td>
                            </tr>
                          );
                        }
                        const { recipe, recipeDays, neglectedIngredients, seasonalMatches } = item;
                        return (
                          <tr key={recipe.id} className={seasonalMatches.length > 0 ? styles.seasonalRow : ''} draggable onDragStart={e => e.dataTransfer.setData('text/plain', recipe.id)} style={{ cursor: 'grab' }}>
                            <td><button className={styles.suggestName} onClick={() => onSelect(recipe.id)}>{recipe.title}</button></td>
                            <td className={styles.suggestDays}>{recipeDays === 9999 ? 'Never' : recipeDays}</td>
                            {suggestCols.overdue && <td className={styles.suggestOverdue}>{neglectedIngredients.length > 0 ? neglectedIngredients.slice(0, 3).join(', ') : '—'}</td>}
                            {suggestCols.seasonal && <td className={styles.suggestSeasonal}>{seasonalMatches.length > 0 ? seasonalMatches.slice(0, 3).join(', ') : '—'}</td>}
                            <td><button className={styles.suggestAddBtn} onClick={() => handleAddToWeekWithPulse(recipe.id)} aria-label={`Add ${recipe.title} to this week`}>+</button></td>
                          </tr>
                        );
                      });
                    })()}
                    {aiSkipping === 'breakfast' && (
                      <tr className={styles.aiSuggestRow}>
                        <td colSpan={2 + (suggestCols.overdue ? 1 : 0) + (suggestCols.seasonal ? 1 : 0) + 1}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0', color: '#7C3AED', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                            <span className={styles.aiLoadingDot}>●</span> Finding another suggestion...
                          </span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                ) : (
                  <p className={styles.suggestEmpty}>Add breakfast recipes to see suggestions here.</p>
                )}
              </div>
              <div className={styles.suggestColumn}>
                <span className={styles.suggestCategoryLabel}>Lunch & Dinner</span>
                {suggestions.lunches.length > 0 ? (
                <table className={styles.suggestTable}>
                  <thead>
                    <tr>
                      <th>Meal</th>
                      <th>Days Since</th>
                      {suggestCols.overdue && <th>Overdue Ingredients</th>}
                      {suggestCols.seasonal && <th>Seasonal</th>}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const regular = suggestions.lunches.map(s => ({ ...s, _type: 'regular' }));
                      const ai = aiMeals.filter(m => m.category !== 'breakfast').map((m, i) => ({ _type: 'ai', _ai: m, _aiIdx: i }));
                      const merged = [...regular];
                      for (const a of ai) {
                        const pos = Math.floor(Math.random() * (merged.length + 1));
                        merged.splice(pos, 0, a);
                      }
                      return merged.map((item, idx) => {
                        if (item._type === 'ai') {
                          const m = item._ai;
                          return (
                            <tr key={`ai-l-${item._aiIdx}`} className={styles.aiSuggestRow}>
                              <td>
                                <button className={styles.suggestName} style={{ color: '#7C3AED' }} onClick={() => setAiPreview({ ...m, _category: m.category || 'lunch-dinner' })}>
                                  ✨ {m.title}
                                </button>
                              </td>
                              <td className={styles.suggestDays} style={{ color: '#7C3AED' }}>AI</td>
                              {suggestCols.overdue && <td>—</td>}
                              {suggestCols.seasonal && <td>—</td>}
                              <td style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                                <button className={styles.aiSuggestAddBtn} onClick={() => {
                                  const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
                                  onAddRecipe({ id, title: m.title, category: m.category || 'lunch-dinner', frequency: 'common', mealType: '', servings: m.servings || 2, prepTime: m.prepTime || '', cookTime: m.cookTime || '', sourceUrl: '', ingredients: m.ingredients || [], instructions: m.instructions || '', createdAt: new Date().toISOString(), source: 'discover', cuisine: m.cuisine || '' });
                                  handleAddToWeekWithPulse(id);
                                  setAiMeals(prev => prev.filter(p => p.title !== m.title));
                                }}>+</button>
                                <button className={styles.aiSkipBtn} onClick={() => skipAiMeal(m)} disabled={!!aiSkipping} title="Skip this suggestion">×</button>
                              </td>
                            </tr>
                          );
                        }
                        const { recipe, recipeDays, neglectedIngredients, seasonalMatches } = item;
                        return (
                          <tr key={recipe.id} className={seasonalMatches.length > 0 ? styles.seasonalRow : ''} draggable onDragStart={e => e.dataTransfer.setData('text/plain', recipe.id)} style={{ cursor: 'grab' }}>
                            <td><button className={styles.suggestName} onClick={() => onSelect(recipe.id)}>{recipe.title}</button></td>
                            <td className={styles.suggestDays}>{recipeDays === 9999 ? 'Never' : recipeDays}</td>
                            {suggestCols.overdue && <td className={styles.suggestOverdue}>{neglectedIngredients.length > 0 ? neglectedIngredients.slice(0, 3).join(', ') : '—'}</td>}
                            {suggestCols.seasonal && <td className={styles.suggestSeasonal}>{seasonalMatches.length > 0 ? seasonalMatches.slice(0, 3).join(', ') : '—'}</td>}
                            <td><button className={styles.suggestAddBtn} onClick={() => handleAddToWeekWithPulse(recipe.id)} aria-label={`Add ${recipe.title} to this week`}>+</button></td>
                          </tr>
                        );
                      });
                    })()}
                    {aiSkipping && aiSkipping !== 'breakfast' && (
                      <tr className={styles.aiSuggestRow}>
                        <td colSpan={2 + (suggestCols.overdue ? 1 : 0) + (suggestCols.seasonal ? 1 : 0) + 1}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0', color: '#7C3AED', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                            <span className={styles.aiLoadingDot}>●</span> Finding another suggestion...
                          </span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                ) : (
                  <p className={styles.suggestEmpty}>Add lunch & dinner recipes to see suggestions here.</p>
                )}
              </div>
          </div>}
        </div>

      </div>

      </div>
      {/* 4. My Recipes heading + Search + Filter Row */}
      <div data-widget="myRecipes" className={styles.myRecipesWidget}><div className={styles.sectionHeader}>
        <button className={styles.collapseToggle} onClick={() => setMyRecipesOpen(p => !p)}>
          <span className={`${styles.collapseArrow}${myRecipesOpen ? ` ${styles.collapseArrowOpen}` : ''}`}>&#9660;</span>
          <h3 className={styles.sectionHeading}>My Recipes</h3>
        </button>
      </div>
      {importResult && (
        <p className={styles.importResult}>{importResult}</p>
      )}
      {myRecipesOpen && <>
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

      {/* Hidden categories bar */}
      {hiddenCategories.size > 0 && (
        <div className={styles.hiddenCatBar}>
          {[...hiddenCategories].map(key => {
            const label = CATEGORIES.find(c => c.key === key)?.label || key;
            return <button key={key} className={styles.showCatBtn} onClick={() => toggleCategory(key)}>+ Show {label}</button>;
          })}
        </div>
      )}

      {/* 5. Recipe Category Columns — unified draggable */}
      {manageMode && manageSelected.size > 0 && (
        <div className={styles.shareBulkBar}>
          <span className={styles.shareBulkCount}>{manageSelected.size} recipe{manageSelected.size !== 1 ? 's' : ''} selected</span>
          <div className={styles.manageActions}>
            <button className={styles.manageActionBtn} style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }} onClick={() => { if (!confirm(`Delete ${manageSelected.size} recipe${manageSelected.size !== 1 ? 's' : ''}?`)) return; for (const id of manageSelected) onDelete(id); setManageSelected(new Set()); setManageStatus(`Deleted`); setTimeout(() => setManageStatus(''), 3000); }}>Delete</button>
            {manageFriends && manageFriends.length > 0 && (
              <div className={styles.shareBulkFriends}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Share with:</span>
                {manageFriends.map(f => (
                  <button key={f.uid} className={styles.shareBulkFriendBtn} onClick={async () => { setManageStatus('Sharing...'); try { const myUsername = await getUsername(user.uid); for (const recipeId of manageSelected) { const recipe = recipes.find(r => r.id === recipeId); if (recipe) { const { id, createdAt, ...rest } = recipe; await shareRecipe(user.uid, f.uid, myUsername || user.displayName, rest); } } setManageStatus(`Shared!`); setTimeout(() => setManageStatus(''), 3000); } catch { setManageStatus('Failed'); setTimeout(() => setManageStatus(''), 3000); } }}>@{f.username || f.displayName}</button>
                ))}
              </div>
            )}
            {!showCookbookInput ? (
              <button className={styles.manageActionBtn} onClick={() => setShowCookbookInput(true)}>+ Cookbook</button>
            ) : (
              <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                <input className={styles.cookbookInput} type="text" value={cookbookName} onChange={e => setCookbookName(e.target.value)} placeholder="Cookbook name" autoFocus onKeyDown={e => { if (e.key === 'Enter' && cookbookName.trim()) { const tag = cookbookName.trim(); for (const id of manageSelected) { const recipe = recipes.find(r => r.id === id); if (recipe) { const existing = recipe.customTags || []; if (!existing.includes(tag)) onUpdateRecipe(recipe.id, { customTags: [...existing, tag] }); } } setManageStatus(`Added to "${tag}"`); setCookbookName(''); setShowCookbookInput(false); setTimeout(() => setManageStatus(''), 3000); } if (e.key === 'Escape') setShowCookbookInput(false); }} />
                <button className={styles.manageActionBtn} onClick={() => { const tag = cookbookName.trim(); if (!tag) return; for (const id of manageSelected) { const recipe = recipes.find(r => r.id === id); if (recipe) { const existing = recipe.customTags || []; if (!existing.includes(tag)) onUpdateRecipe(recipe.id, { customTags: [...existing, tag] }); } } setManageStatus(`Added to "${tag}"`); setCookbookName(''); setShowCookbookInput(false); setTimeout(() => setManageStatus(''), 3000); }}>Add</button>
              </div>
            )}
            <button className={styles.manageActionBtn} onClick={async () => { const toGenerate = [...manageSelected].map(id => recipes.find(r => r.id === id)).filter(r => r && !getCachedMealImage(r.id)); if (toGenerate.length === 0) { setManageStatus('All have images'); setTimeout(() => setManageStatus(''), 3000); return; } setManageStatus(`Generating...`); let done = 0; for (const recipe of toGenerate) { try { await generateMealImage(recipe.id, recipe.title, recipe.ingredients, user?.uid); done++; setManageStatus(`${done}/${toGenerate.length}...`); } catch {} } setManageStatus(`Generated ${done}`); setTimeout(() => setManageStatus(''), 4000); }}>Generate Images</button>
          </div>
          {manageStatus && <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-success)' }}>{manageStatus}</span>}
        </div>
      )}
      <div ref={columnsRef} className={styles.gridContainer}>
          <GridLayout
            className={styles.catGrid}
            layout={visibleLayout}
            cols={12}
            rowHeight={10}
            isDraggable
            isResizable
            resizeHandles={['se', 'e', 'w', 's', 'n']}
            onLayoutChange={handleCatLayoutChange}
            draggableHandle={`.${styles.columnHeadingRow}`}
            compactType="vertical"
            margin={[8, 8]}
          >
            {visibleCats.map(catKey => {
              const cat = CATEGORIES.find(c => c.key === catKey);
              if (!cat) return null;
              return (
                <div key={catKey} className={styles.column} data-grid-id={catKey}>
                  <div className={styles.columnHeadingRow}>
                    <h3 className={styles.columnHeading}>{cat.label}</h3>
                    <div className={styles.columnControls}>
                      <span className={styles.columnDragIcon}>⋮⋮</span>
                      <button className={styles.columnHideBtn} onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); toggleCategory(catKey); }} title={`Hide ${cat.label}`}>✕</button>
                    </div>
                  </div>
                  <div className={styles.columnBody}>
                    {(grouped[catKey] || []).length === 0 ? (
                      <p className={styles.columnEmpty}>Drop recipes here</p>
                    ) : (
                      <div className={styles.list}>
                        {(grouped[catKey] || []).map(recipe => (
                          <div key={recipe.id} className={shareMode ? styles.shareCardWrap : undefined}>
                            {shareMode && (
                              <input type="checkbox" className={styles.shareCheck} checked={shareSelected.has(recipe.id)}
                                onChange={() => setShareSelected(prev => { const next = new Set(prev); if (next.has(recipe.id)) next.delete(recipe.id); else next.add(recipe.id); return next; })} />
                            )}
                            <RecipeCard
                              recipe={recipe}
                              onClick={shareMode ? () => setShareSelected(prev => { const next = new Set(prev); if (next.has(recipe.id)) next.delete(recipe.id); else next.add(recipe.id); return next; }) : onSelect}
                              draggable={!editMode && !shareMode}
                              onAdd={editMode || shareMode ? undefined : handleAddToWeekWithPulse}
                              editMode={editMode}
                              onDelete={onDelete}
                              showTags={false}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {customGridWidgets.map(cw => {
              const tagName = cw.label.toLowerCase();
              const taggedRecipes = visible.filter(r =>
                (r.customTags || []).some(t => t.toLowerCase() === tagName)
              ).sort((a, b) => a.title.localeCompare(b.title));
              return (
                <div key={cw.id} className={styles.column}>
                  <div className={styles.columnHeadingRow}>
                    {renamingWidgetId === cw.id ? (
                      <input
                        className={styles.widgetRenameInput}
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => { if (renameValue.trim()) renameGridWidget(cw.id, renameValue.trim()); setRenamingWidgetId(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') { if (renameValue.trim()) renameGridWidget(cw.id, renameValue.trim()); setRenamingWidgetId(null); } if (e.key === 'Escape') setRenamingWidgetId(null); }}
                        onMouseDown={e => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <h3 className={styles.columnHeading} onDoubleClick={e => { e.stopPropagation(); setRenamingWidgetId(cw.id); setRenameValue(cw.label); }}>{cw.label}</h3>
                    )}
                    <div className={styles.columnControls}>
                      <button className={styles.widgetEditBtn} onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setRenamingWidgetId(cw.id); setRenameValue(cw.label); }} title="Rename">&#9998;</button>
                      <span className={styles.columnDragIcon}>⋮⋮</span>
                      <button className={styles.columnHideBtn} onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); if (confirm(`Delete "${cw.label}"?`)) removeGridWidget(cw.id); }} title={`Delete ${cw.label}`}>✕</button>
                    </div>
                  </div>
                  <div className={styles.columnBody}>
                    {taggedRecipes.length === 0 ? (
                      <p className={styles.columnEmpty}>Tag recipes with "{cw.label}" to see them here</p>
                    ) : (
                      <div className={styles.list}>
                        {taggedRecipes.map(recipe => (
                          <div key={recipe.id} className={shareMode ? styles.shareCardWrap : undefined}>
                            {shareMode && (
                              <input type="checkbox" className={styles.shareCheck} checked={shareSelected.has(recipe.id)}
                                onChange={() => setShareSelected(prev => { const next = new Set(prev); if (next.has(recipe.id)) next.delete(recipe.id); else next.add(recipe.id); return next; })} />
                            )}
                            <RecipeCard
                              recipe={recipe}
                              onClick={shareMode ? () => setShareSelected(prev => { const next = new Set(prev); if (next.has(recipe.id)) next.delete(recipe.id); else next.add(recipe.id); return next; }) : onSelect}
                              draggable={!editMode && !shareMode}
                              onAdd={editMode || shareMode ? undefined : handleAddToWeekWithPulse}
                              editMode={editMode}
                              onDelete={onDelete}
                              showTags={false}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </GridLayout>
      </div>
      <div className={styles.addGridWidgetRow}>
        {!addingGridWidget ? (
          <button className={styles.addGridWidgetBtn} onClick={() => setAddingGridWidget(true)}>+ Add Widget</button>
        ) : (
          <div className={styles.addGridWidgetForm}>
            <input
              className={styles.addGridWidgetInput}
              type="text"
              placeholder="Widget name..."
              value={newGridWidgetName}
              onChange={e => setNewGridWidgetName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addGridWidget(); if (e.key === 'Escape') setAddingGridWidget(false); }}
              autoFocus
            />
            <button className={styles.addGridWidgetSave} onClick={addGridWidget}>Add</button>
            <button className={styles.addGridWidgetCancel} onClick={() => { setAddingGridWidget(false); setNewGridWidgetName(''); }}>Cancel</button>
          </div>
        )}
      </div>
      </>}
      </div>
      </WidgetLayout>

      {/* AI Recipe Preview Modal */}
      {aiPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setAiPreview(null)}>
          <div style={{ background: 'var(--color-surface)', borderRadius: '16px', maxWidth: '600px', width: '100%', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', padding: '1.5rem' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: 'var(--color-text)' }}>✨ {aiPreview.title}</h2>
                {aiPreview.cuisine && <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', background: '#EDE9FE', padding: '2px 8px', borderRadius: '999px', marginTop: '0.25rem', display: 'inline-block' }}>{aiPreview.cuisine}</span>}
              </div>
              <button onClick={() => setAiPreview(null)} style={{ background: 'none', border: 'none', fontSize: '1.3rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}>×</button>
            </div>

            {aiPreview.description && <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', margin: '0.5rem 0 1rem', lineHeight: 1.5 }}>{aiPreview.description}</p>}

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              {aiPreview.servings && <span>🍽 {aiPreview.servings} servings</span>}
              {aiPreview.prepTime && <span>⏱ Prep: {aiPreview.prepTime}</span>}
              {aiPreview.cookTime && <span>🔥 Cook: {aiPreview.cookTime}</span>}
            </div>

            {(aiPreview.ingredients || []).length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 0.5rem' }}>Ingredients</h3>
                {aiPreview.ingredients.map((ing, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.3rem', padding: '0.25rem 0', fontSize: '0.88rem', borderBottom: '1px solid var(--color-border-light)' }}>
                    <span style={{ color: 'var(--color-accent)', fontWeight: 600, minWidth: '60px' }}>{ing.quantity} {ing.measurement}</span>
                    <span style={{ color: 'var(--color-text)' }}>{ing.ingredient}</span>
                  </div>
                ))}
              </div>
            )}

            {aiPreview.instructions && (
              <div style={{ marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 0.5rem' }}>Instructions</h3>
                <div style={{ fontSize: '0.88rem', color: 'var(--color-text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{aiPreview.instructions}</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border-light)' }}>
              <button
                onClick={() => { skipAiMeal(aiPreview); setAiPreview(null); }}
                style={{ padding: '0.5rem 1rem', border: '1px solid var(--color-border)', borderRadius: '8px', background: 'var(--color-surface)', fontSize: '0.85rem', fontWeight: 500, fontFamily: 'inherit', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
              >
                Skip
              </button>
              <button
                onClick={() => {
                  const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
                  onAddRecipe({ id, title: aiPreview.title, category: aiPreview._category || 'lunch-dinner', frequency: 'common', mealType: '', servings: aiPreview.servings || 2, prepTime: aiPreview.prepTime || '', cookTime: aiPreview.cookTime || '', sourceUrl: '', ingredients: aiPreview.ingredients || [], instructions: aiPreview.instructions || '', createdAt: new Date().toISOString(), source: 'discover', cuisine: aiPreview.cuisine || '' });
                  handleAddToWeekWithPulse(id);
                  setAiMeals(prev => prev.filter(p => p.title !== aiPreview.title));
                  setAiPreview(null);
                }}
                style={{ padding: '0.5rem 1.25rem', border: 'none', borderRadius: '8px', background: 'var(--color-accent)', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit', color: '#fff', cursor: 'pointer' }}
              >
                + Add to My Recipes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
