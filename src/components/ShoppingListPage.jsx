import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ShoppingList } from './ShoppingList';
import { GroceryStaples } from './GroceryStaples';
import { PantryList } from './PantryList';
import { TrackedItemsList } from './TrackedItemsList';
import { useAuth } from '../contexts/AuthContext';
import { saveField, loadDailyLogFromFirestore, loadFriends, loadFriendShoppingList } from '../utils/firestoreSync';
import GridLayoutLib, { WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import styles from './ShoppingListPage.module.css';

const GridLayout = WidthProvider(GridLayoutLib);

const DEFAULT_SPICES = [];
const DEFAULT_SAUCES = [];
const DEFAULT_SNACKS = [
  { quantity: '1',  measurement: 'bag(s)',  ingredient: 'rice cake(s)_white cheddar' },
  { quantity: '1',  measurement: 'bag(s)',  ingredient: 'brussel sprouts' },
  { quantity: '1',  measurement: 'regular', ingredient: 'hummus_garlic' },
  { quantity: '1',  measurement: 'jar',     ingredient: 'pickle(s)' },
  { quantity: '24', measurement: 'stick(s)', ingredient: 'venison sticks' },
  { quantity: '10', measurement: 'regular', ingredient: 'asparagus' },
  { quantity: '2',  measurement: 'regular', ingredient: 'sweet potato(s)' },
  { quantity: '3',  measurement: 'regular', ingredient: 'bell pepper(s)' },
  { quantity: '1',  measurement: 'box',     ingredient: 'kefir' },
  { quantity: '1',  measurement: 'bag(s)',  ingredient: 'shahshito peppers' },
  { quantity: '1',  measurement: 'box',     ingredient: 'flaxseed crackers' },
  { quantity: '1',  measurement: 'bag(s)',  ingredient: 'trail mix' },
  { quantity: '1',  measurement: 'bag(s)',  ingredient: 'watermelon seeds' },
  { quantity: '',   measurement: '',        ingredient: 'pistachios' },
  { quantity: '',   measurement: '',        ingredient: 'toasted seaweed' },
  { quantity: '1',  measurement: 'bag',     ingredient: 'popcorn' },
  { quantity: '1',  measurement: 'jar',     ingredient: 'kimchi' },
];
const DEFAULT_FRUITS = [
  { quantity: '5', measurement: 'regular', ingredient: 'apple(s)_honey crisp' },
  { quantity: '5', measurement: 'regular', ingredient: 'banana(s)' },
  { quantity: '4', measurement: 'regular', ingredient: 'orange(s)' },
  { quantity: '1', measurement: 'jar',     ingredient: 'olive(s)_pitted black' },
  { quantity: '1', measurement: 'bag(s)',  ingredient: 'grapes_red' },
  { quantity: '1', measurement: 'regular', ingredient: 'pineapple' },
  { quantity: '5', measurement: 'regular', ingredient: 'mango(s)' },
  { quantity: '5', measurement: 'regular', ingredient: 'kiwi(s)' },
  { quantity: '1', measurement: 'regular', ingredient: 'melon(s)' },
  { quantity: '4', measurement: 'regular', ingredient: 'pear' },
  { quantity: '1', measurement: 'box',     ingredient: 'cherries' },
  { quantity: '1', measurement: 'regular', ingredient: 'watermelon' },
  { quantity: '5', measurement: 'regular', ingredient: 'peach(es)' },
];

const EXTRAS_KEY = 'sunday-shop-extras';
const DISMISSED_KEY = 'sunday-shop-dismissed';

function loadExtras() {
  try {
    const data = localStorage.getItem(EXTRAS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveExtrasToStorage(extras) {
  localStorage.setItem(EXTRAS_KEY, JSON.stringify(extras));
}

function loadDismissed() {
  try {
    const data = localStorage.getItem(DISMISSED_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

const SOURCE_KEYS = {
  staples: 'sunday-grocery-staples',
  spices: 'sunday-pantry-spices',
  sauces: 'sunday-pantry-sauces',
};

// Normalize ingredient names for fuzzy matching between snacks and daily-log
// entries (strip "(s)", underscores/dashes, collapse whitespace, lowercase).
function normalizeIngName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\(s\)/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Look up the most-recent eaten date for a given ingredient name from the
// eatenMap. Tries exact match first, then contains-either-direction with a
// 4-char floor to keep false positives down.
function lookupEatenDate(ingredient, eatenMap) {
  if (!eatenMap || typeof eatenMap.get !== 'function') return null;
  const key = normalizeIngName(ingredient);
  if (!key) return null;
  const exact = eatenMap.get(key);
  if (exact) return exact;
  let best = null;
  for (const [k, date] of eatenMap) {
    if (k.length < 4 || key.length < 4) continue;
    if (k.includes(key) || key.includes(k)) {
      if (!best || date > best) best = date;
    }
  }
  return best;
}

function daysSinceDate(d) {
  if (!d) return null;
  const then = new Date(d);
  if (isNaN(then)) return null;
  return Math.max(0, Math.floor((new Date() - then) / 86400000));
}

// Resolve the effective "last known" date for a tracked item — most recent
// of the meal-log date and a manual lastPurchased bump.
function effectiveDate(item, eatenMap) {
  const eaten = lookupEatenDate(item.ingredient, eatenMap);
  if (eaten && item.lastPurchased) {
    return new Date(eaten) > new Date(item.lastPurchased) ? eaten : item.lastPurchased;
  }
  return eaten || item.lastPurchased || null;
}

// Pick the item from `list` with the highest Since (never-touched items win).
function findTopSince(list, eatenMap) {
  let best = null;
  let bestDays = -1;
  for (const item of (list || [])) {
    if (!(item?.ingredient || '').trim()) continue;
    const d = effectiveDate(item, eatenMap);
    const days = d == null ? Number.POSITIVE_INFINITY : daysSinceDate(d);
    if (days > bestDays) { bestDays = days; best = item; }
  }
  return best;
}

// Build a map of normalized-ingredient-name → ISO date of the most recent
// daily-log entry that included that ingredient. Used by the Snacks widget
// to show "days since last eaten".
function buildIngredientEatenMap(getRecipe) {
  const map = new Map();
  let log;
  try { log = JSON.parse(localStorage.getItem('sunday-daily-log') || '{}'); } catch { return map; }
  if (!log || typeof log !== 'object') return map;
  const dates = Object.keys(log).sort(); // ascending so later overwrites earlier
  for (const date of dates) {
    const entries = log[date]?.entries || [];
    for (const entry of entries) {
      const names = [];
      if (Array.isArray(entry.ingredientNutrition)) {
        for (const ing of entry.ingredientNutrition) {
          if (ing?.ingredient) names.push(ing.ingredient);
        }
      }
      // Always also pull the recipe's current ingredient list (even when
      // ingredientNutrition was stored at log time) — the stored list may be
      // stale, and the recipe itself may have been updated since.
      if (entry.recipeId && typeof getRecipe === 'function') {
        const r = getRecipe(entry.recipeId);
        if (r && Array.isArray(r.ingredients)) {
          for (const ing of r.ingredients) {
            if (ing?.ingredient) names.push(ing.ingredient);
          }
        }
      }
      if (names.length === 0 && entry.type === 'custom' && entry.mealName) {
        names.push(entry.mealName);
      }
      // Custom-meal entries can also store their own ingredient list.
      if (Array.isArray(entry.ingredients)) {
        for (const ing of entry.ingredients) {
          if (typeof ing === 'string') names.push(ing);
          else if (ing?.ingredient) names.push(ing.ingredient);
        }
      }
      for (const n of names) {
        const key = normalizeIngName(n);
        if (!key) continue;
        map.set(key, date); // dates are iterated ascending → last-write-wins = latest
      }
    }
  }
  return map;
}

export function ShoppingListPage({ weeklyRecipes, weeklyServings = {}, getRecipe, onClose, onSaveToHistory }) {
  const { user } = useAuth();
  const [extras, setExtras] = useState(loadExtras);
  const [dismissed, setDismissed] = useState(loadDismissed);
  const [resetKey, setResetKey] = useState(0);
  const [saved, setSaved] = useState(false);

  // --- Resizable grid for spices/sauces/custom widgets ---
  const GRID_LAYOUT_KEY = user ? `sunday-shop-grid-layout-${user.uid}` : 'sunday-shop-grid-layout';
  const CUSTOM_WIDGETS_KEY = user ? `sunday-shop-custom-widgets-${user.uid}` : 'sunday-shop-custom-widgets';

  const FALLBACK_LAYOUT = [
    { i: 'spices', x: 0, y: 0, w: 3, h: 20 },
    { i: 'sauces', x: 3, y: 0, w: 3, h: 20 },
    { i: 'snacks', x: 6, y: 0, w: 3, h: 20 },
    { i: 'fruit',  x: 9, y: 0, w: 3, h: 20 },
  ];

  const [gridLayout, setGridLayout] = useState(() => {
    try { return JSON.parse(localStorage.getItem(user ? `sunday-shop-grid-layout-${user?.uid}` : 'sunday-shop-grid-layout')) || FALLBACK_LAYOUT; } catch { return FALLBACK_LAYOUT; }
  });

  const [customWidgets, setCustomWidgets] = useState(() => {
    try { return JSON.parse(localStorage.getItem(user ? `sunday-shop-custom-widgets-${user?.uid}` : 'sunday-shop-custom-widgets')) || []; } catch { return []; }
  });

  // Map of normalized ingredient → most-recent date eaten. Rebuilt when the
  // daily log changes on disk (or when another device syncs).
  const [eatenMap, setEatenMap] = useState(() => buildIngredientEatenMap(getRecipe));
  useEffect(() => {
    function rebuild() { setEatenMap(buildIngredientEatenMap(getRecipe)); }
    window.addEventListener('firestore-sync', rebuild);
    window.addEventListener('storage', rebuild);
    return () => {
      window.removeEventListener('firestore-sync', rebuild);
      window.removeEventListener('storage', rebuild);
    };
  }, [getRecipe]);

  // Snacks + Fruit lists — needed for both auto-adding the longest-since
  // item into the shopping list and for bumping lastPurchased on Reset.
  const [snacksList, setSnacksList] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sunday-pantry-snacks') || '[]'); } catch { return []; }
  });
  const [fruitList, setFruitList] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sunday-pantry-fruit') || '[]'); } catch { return []; }
  });
  useEffect(() => {
    function reload() {
      try { setSnacksList(JSON.parse(localStorage.getItem('sunday-pantry-snacks') || '[]')); } catch { /* ignore */ }
      try { setFruitList(JSON.parse(localStorage.getItem('sunday-pantry-fruit') || '[]')); } catch { /* ignore */ }
    }
    window.addEventListener('firestore-sync', reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener('firestore-sync', reload);
      window.removeEventListener('storage', reload);
    };
  }, []);

  const topSnack = useMemo(() => findTopSince(snacksList, eatenMap), [snacksList, eatenMap]);
  const topFruit = useMemo(() => findTopSince(fruitList, eatenMap), [fruitList, eatenMap]);

  // Friends who have shared their weekly shopping list (planned meals) with
  // me. Each entry: { uid, username, meals: [{ id, title, servings, category }] }.
  const [sharedFromFriends, setSharedFromFriends] = useState([]);
  useEffect(() => {
    if (!user?.uid) { setSharedFromFriends([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const friends = await loadFriends(user.uid);
        const sharers = friends.filter(f => f.hasSharedShoppingWithMe);
        const lists = await Promise.all(sharers.map(async f => {
          const data = await loadFriendShoppingList(f.uid);
          return {
            uid: f.uid,
            username: data.username || f.username || f.displayName || 'friend',
            meals: data.meals || [],
          };
        }));
        if (!cancelled) setSharedFromFriends(lists.filter(l => l.meals.length > 0));
      } catch { /* ignore — fail silently, just don't show shared section */ }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Pull the daily log subcollection from Firestore on mount so this page
  // has fresh data even if the user hasn't visited Track Meals this session
  // (localStorage can be stale/empty for fresh devices).
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    loadDailyLogFromFirestore(user.uid).then(remote => {
      if (cancelled || !remote) return;
      try {
        const localRaw = localStorage.getItem('sunday-daily-log');
        const local = localRaw ? JSON.parse(localRaw) : {};
        // Merge: prefer the side with more entries for each date.
        const merged = { ...remote };
        for (const date of Object.keys(local)) {
          const le = local[date]?.entries || [];
          const re = merged[date]?.entries || [];
          if (le.length >= re.length) merged[date] = local[date];
        }
        localStorage.setItem('sunday-daily-log', JSON.stringify(merged));
      } catch { /* ignore */ }
      setEatenMap(buildIngredientEatenMap(getRecipe));
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [user?.uid, getRecipe]);

  // Re-read grid layout + custom widgets whenever the user.uid becomes known
  // (after the initial mount) or whenever Firestore fires a sync event. The
  // useState initializers above only run once, so without this the first
  // render's anonymous/stale key sticks and resized widgets appear to reset.
  useEffect(() => {
    function loadFromStorage() {
      try {
        const layout = JSON.parse(localStorage.getItem(GRID_LAYOUT_KEY));
        if (Array.isArray(layout) && layout.length > 0) setGridLayout(layout);
      } catch { /* ignore */ }
      try {
        const widgets = JSON.parse(localStorage.getItem(CUSTOM_WIDGETS_KEY));
        if (Array.isArray(widgets)) setCustomWidgets(widgets);
      } catch { /* ignore */ }
    }
    loadFromStorage();
    window.addEventListener('firestore-sync', loadFromStorage);
    return () => window.removeEventListener('firestore-sync', loadFromStorage);
  }, [GRID_LAYOUT_KEY, CUSTOM_WIDGETS_KEY]);

  const [addingWidget, setAddingWidget] = useState(false);
  const [newWidgetName, setNewWidgetName] = useState('');
  const [renamingWidgetId, setRenamingWidgetId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const gridRef = useRef(null);

  const allGridKeys = ['spices', 'sauces', 'snacks', 'fruit', ...customWidgets.map(w => w.id)];
  const customWidgetIds = new Set(customWidgets.map(w => w.id));

  const visibleLayout = useMemo(() => {
    const existing = gridLayout.filter(l => allGridKeys.includes(l.i));
    const existingIds = new Set(existing.map(l => l.i));
    let maxY = existing.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    for (const cw of customWidgets) {
      if (!existingIds.has(cw.id)) {
        existing.push({ i: cw.id, x: 0, y: maxY, w: 6, h: 16 });
        maxY += 16;
      }
    }
    return existing;
  }, [gridLayout, customWidgets]);

  function saveGridLayout(layout) {
    const clean = layout
      .filter(item => allGridKeys.includes(item.i))
      .map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
    setGridLayout(clean);
    localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(clean));
    if (user) saveField(user.uid, 'shopGridLayout', clean);
  }

  function saveCustomWidgets(widgets) {
    localStorage.setItem(CUSTOM_WIDGETS_KEY, JSON.stringify(widgets));
    if (user) saveField(user.uid, 'shopCustomWidgets', widgets);
  }

  function addWidget() {
    const name = newWidgetName.trim();
    if (!name) return;
    const id = 'cw_' + Date.now();
    const widget = { id, label: name, content: '' };
    const next = [...customWidgets, widget];
    setCustomWidgets(next);
    saveCustomWidgets(next);
    const maxY = gridLayout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    const nextLayout = [...gridLayout, { i: id, x: 0, y: maxY, w: 6, h: 16 }];
    setGridLayout(nextLayout);
    localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(nextLayout));
    if (user) saveField(user.uid, 'shopGridLayout', nextLayout);
    setNewWidgetName('');
    setAddingWidget(false);
  }

  function updateWidgetContent(id, content) {
    const next = customWidgets.map(w => w.id === id ? { ...w, content } : w);
    setCustomWidgets(next);
    saveCustomWidgets(next);
  }

  function renameWidget(id, newLabel) {
    const next = customWidgets.map(w => w.id === id ? { ...w, label: newLabel } : w);
    setCustomWidgets(next);
    saveCustomWidgets(next);
  }

  function removeWidget(id) {
    const nextWidgets = customWidgets.filter(w => w.id !== id);
    setCustomWidgets(nextWidgets);
    saveCustomWidgets(nextWidgets);
    const nextLayout = gridLayout.filter(l => l.i !== id);
    setGridLayout(nextLayout);
    localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(nextLayout));
    if (user) saveField(user.uid, 'shopGridLayout', nextLayout);
  }

  function saveExtras(list) {
    saveExtrasToStorage(list);
    if (user) saveField(user.uid, 'shopExtras', list);
  }

  const handleMoveToShop = useCallback((item, source) => {
    setExtras(prev => {
      const next = [...prev, { ...item, source }];
      saveExtras(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleAddCustomItem = useCallback((item) => {
    setExtras(prev => {
      const next = [...prev, { ...item, source: 'custom' }];
      saveExtras(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleClearExtras = useCallback(() => {
    // Group extras by source and append back to their localStorage keys
    const bySource = {};
    for (const item of extras) {
      if (!bySource[item.source]) bySource[item.source] = [];
      const { source, ...rest } = item;
      bySource[source].push(rest);
    }

    for (const [source, items] of Object.entries(bySource)) {
      const key = SOURCE_KEYS[source];
      if (!key) continue;
      try {
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        // Only add back items that aren't already in the list (prevent duplicates)
        const existingNames = new Set(existing.map(e => (e.ingredient || '').toLowerCase().trim()));
        const newItems = items.filter(item => {
          const name = (item.ingredient || '').toLowerCase().trim();
          return name && !existingNames.has(name);
        });
        if (newItems.length > 0) {
          localStorage.setItem(key, JSON.stringify([...existing, ...newItems]));
        }
      } catch {}
    }

    setExtras([]);
    saveExtras([]);
    setDismissed([]);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([]));
    if (user) saveField(user.uid, 'shopDismissed', []);
    setResetKey(k => k + 1);
  }, [extras, user]);

  const handleDismissItem = useCallback((ingredientName, recipes) => {
    setDismissed(prev => {
      const norm = ingredientName.toLowerCase().trim();
      if (prev.some(d => d.name === norm)) return prev;
      const next = [...prev, { name: norm, label: ingredientName.trim(), recipes: recipes || [] }];
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
      if (user) saveField(user.uid, 'shopDismissed', next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const pantryNames = useMemo(() => {
    const names = new Set();
    try {
      const spices = JSON.parse(localStorage.getItem('sunday-pantry-spices') || '[]');
      const sauces = JSON.parse(localStorage.getItem('sunday-pantry-sauces') || '[]');
      for (const item of [...spices, ...sauces]) {
        if (item.ingredient) names.add(item.ingredient.toLowerCase().trim());
      }
    } catch {}
    return names;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, extras.length]);

  const shopIngredientNames = useMemo(() => {
    const names = new Set();
    for (const recipe of weeklyRecipes) {
      for (const ing of (recipe.ingredients || [])) {
        const name = (ing.ingredient || '').toLowerCase().trim();
        if (name) names.add(name);
      }
    }
    for (const e of extras) {
      const name = (e.ingredient || '').toLowerCase().trim();
      if (name) names.add(name);
    }
    return names;
  }, [weeklyRecipes, extras]);

  function wordMatch(a, b) {
    if (a === b) return true;
    const cleanA = a.replace(/\s*\(.*?\)\s*/g, '').trim();
    const cleanB = b.replace(/\s*\(.*?\)\s*/g, '').trim();
    if (cleanA === cleanB) return true;
    const re = (s) => new RegExp('\\b' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    return re(cleanA).test(cleanB) || re(cleanB).test(cleanA);
  }

  function matchesPantry(name) {
    for (const pn of pantryNames) {
      if (wordMatch(name, pn)) return true;
    }
    return false;
  }

  const dismissedNames = useMemo(
    () => new Set(dismissed.map(d => d.name)),
    [dismissed]
  );

  // Items manually hidden (x'd) that aren't just pantry matches
  const hiddenItems = useMemo(
    () => dismissed.filter(d => d.recipes && d.recipes.length > 0),
    [dismissed]
  );

  const pantryMatchedItems = useMemo(() => {
    const matched = new Map();
    for (const recipe of weeklyRecipes) {
      for (const ing of (recipe.ingredients || [])) {
        const name = (ing.ingredient || '').toLowerCase().trim();
        if (name && matchesPantry(name) && !matched.has(name)) {
          matched.set(name, ing.ingredient.trim());
        }
      }
    }
    for (const e of extras) {
      const name = (e.ingredient || '').toLowerCase().trim();
      if (name && matchesPantry(name) && !matched.has(name)) {
        matched.set(name, e.ingredient.trim());
      }
    }
    // Also include dismissed items, but only if they're still in pantry
    for (const d of dismissed) {
      if (!matched.has(d.name) && matchesPantry(d.name)) {
        matched.set(d.name, d.label);
      }
    }
    return { names: new Set(matched.keys()), labels: [...matched.values()].sort() };
  }, [weeklyRecipes, extras, pantryNames, dismissed]);

  // Shopping list = user extras + auto-injected top-since snack and fruit.
  // Skip auto-add if the user already put that item in extras manually.
  const extrasWithAutoAdds = useMemo(() => {
    const list = [...extras];
    const has = (ing) => list.some(e => normalizeIngName(e.ingredient) === normalizeIngName(ing));
    if (topSnack?.ingredient && !has(topSnack.ingredient)) {
      list.push({ ...topSnack, source: 'auto-snack' });
    }
    if (topFruit?.ingredient && !has(topFruit.ingredient)) {
      list.push({ ...topFruit, source: 'auto-fruit' });
    }
    return list;
  }, [extras, topSnack, topFruit]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>Shopping List</h2>
          {weeklyRecipes.length > 0 && (
            <div className={styles.mealBubbles}>
              {weeklyRecipes.map(r => (
                <span key={r.id} className={styles.mealBubble}>{r.title}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {sharedFromFriends.length > 0 && (
        <div className={styles.sharedSection}>
          {sharedFromFriends.map(s => (
            <div key={s.uid} className={styles.sharedFriendBlock}>
              <div className={styles.sharedFriendHeading}>
                Shared with you · from <strong>@{s.username}</strong>
              </div>
              <div className={styles.mealBubbles}>
                {s.meals.map(m => (
                  <span key={m.id} className={styles.mealBubble} title={m.servings ? `${m.servings} serving${m.servings === 1 ? '' : 's'}` : ''}>
                    {m.title}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {weeklyRecipes.length > 0 && onSaveToHistory && (
        <div className={styles.completedRow}>
          <button
            className={styles.completedBtn}
            onClick={() => {
              // Gather every ingredient name that's on the current shopping
              // list so we can mark them as "just eaten" on each matching
              // snack/fruit. Must happen BEFORE handleClearExtras wipes them.
              const shoppingNames = new Set();
              for (const r of weeklyRecipes) {
                for (const ing of (r.ingredients || [])) {
                  if (ing?.ingredient) shoppingNames.add(normalizeIngName(ing.ingredient));
                }
              }
              for (const e of extrasWithAutoAdds) {
                if (e?.ingredient) shoppingNames.add(normalizeIngName(e.ingredient));
              }
              try {
                const staples = JSON.parse(localStorage.getItem('sunday-grocery-staples') || '[]');
                for (const s of staples) {
                  if (s?.ingredient) shoppingNames.add(normalizeIngName(s.ingredient));
                }
              } catch { /* ignore */ }

              const today = new Date().toISOString();
              function bumpMatches(list) {
                let changed = false;
                const next = (list || []).map(item => {
                  const key = normalizeIngName(item.ingredient);
                  if (!key) return item;
                  let hit = shoppingNames.has(key);
                  if (!hit) {
                    for (const n of shoppingNames) {
                      if (n.length >= 4 && key.length >= 4 && (n.includes(key) || key.includes(n))) {
                        hit = true;
                        break;
                      }
                    }
                  }
                  if (!hit) return item;
                  changed = true;
                  return { ...item, lastPurchased: today };
                });
                return { next, changed };
              }
              const sBump = bumpMatches(snacksList);
              if (sBump.changed) {
                setSnacksList(sBump.next);
                try { localStorage.setItem('sunday-pantry-snacks', JSON.stringify(sBump.next)); } catch {}
                if (user) saveField(user.uid, 'pantrySnacks', sBump.next);
              }
              const fBump = bumpMatches(fruitList);
              if (fBump.changed) {
                setFruitList(fBump.next);
                try { localStorage.setItem('sunday-pantry-fruit', JSON.stringify(fBump.next)); } catch {}
                if (user) saveField(user.uid, 'pantryFruit', fBump.next);
              }

              onSaveToHistory();
              // Send grocery staples back to their boxes
              handleClearExtras();
              // Clear checked items for both the shopping list and grocery staples
              localStorage.removeItem('sunday-shopping-checked');
              localStorage.removeItem('sunday-staples-checked');
              if (user) {
                saveField(user.uid, 'shoppingChecked', []);
                saveField(user.uid, 'staplesChecked', []);
              }
              window.dispatchEvent(new Event('firestore-sync'));
              setSaved(true);
              setTimeout(() => setSaved(false), 3000);
            }}
          >
            Reset Shopping List
          </button>
          {saved && <span className={styles.savedToast}>Saved to history!</span>}
        </div>
      )}

      <div className={styles.pageLayout}>
        {/* Left side: fixed Shopping List + Grocery Staples columns */}
        <div className={styles.fixedLeft}>
          <div className={styles.fixedCol}>
            <ShoppingList
              weeklyRecipes={weeklyRecipes}
              weeklyServings={weeklyServings}
              extraItems={extrasWithAutoAdds}
              onClearExtras={handleClearExtras}
              onAddCustomItem={handleAddCustomItem}
              pantryNames={pantryNames}
              dismissedNames={dismissedNames}
              onDismissItem={handleDismissItem}
              user={user}
            />
          </div>
          <div className={styles.fixedCol}>
            {hiddenItems.length > 0 && (
              <div className={styles.hiddenBox}>
                <h3 className={styles.hiddenHeading}>Hidden from Shopping List</h3>
                <ul className={styles.hiddenList}>
                  {hiddenItems.map(d => (
                    <li key={d.name} className={styles.hiddenItem}>
                      <div className={styles.hiddenItemTop}>
                        <span className={styles.hiddenItemName}>{d.label}</span>
                        <button
                          className={styles.hiddenUndoBtn}
                          onClick={() => {
                            setDismissed(prev => {
                              const next = prev.filter(x => x.name !== d.name);
                              localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
                              if (user) saveField(user.uid, 'shopDismissed', next);
                              return next;
                            });
                          }}
                          title="Add back to shopping list"
                        >
                          Unhide
                        </button>
                      </div>
                      {d.recipes.length > 0 && (
                        <span className={styles.hiddenItemMeals}>Used in: {d.recipes.join(', ')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pantryMatchedItems.labels.length > 0 && (
              <div className={styles.pantryMatchBox}>
                <h3 className={styles.pantryMatchHeading}>Already In Your Pantry</h3>
                <p className={styles.pantryMatchSubtext}>
                  These recipe ingredients were removed from the shopping list
                </p>
                <ul className={styles.pantryMatchList}>
                  {pantryMatchedItems.labels.map(name => (
                    <li key={name} className={styles.pantryMatchItem}>{name}</li>
                  ))}
                </ul>
              </div>
            )}
            <GroceryStaples key={resetKey} onMoveToShop={handleMoveToShop} highlightNames={shopIngredientNames} />
          </div>
        </div>

        {/* Right side: resizable Spices, Sauces, Custom Widgets */}
        <div className={styles.widgetRight}>
          <div ref={gridRef} className={styles.gridContainer}>
            <GridLayout
              className={styles.widgetGrid}
              layout={visibleLayout}
              cols={12}
              rowHeight={10}
              isDraggable
              isResizable
              resizeHandles={['se', 'e', 'w', 's', 'n']}
              onLayoutChange={saveGridLayout}
              draggableHandle={`.${styles.widgetHeadingRow}`}
              compactType="vertical"
              margin={[8, 8]}
            >
              <div key="spices" className={styles.widgetBox}>
                <div className={styles.widgetHeadingRow}>
                  <h3 className={styles.widgetHeading}>Spices</h3>
                  <div className={styles.widgetControls}>
                    <span className={styles.widgetDragIcon}>&#8942;&#8942;</span>
                  </div>
                </div>
                <div className={styles.widgetBody}>
                  <PantryList
                    key={`spices-${resetKey}`}
                    title=""
                    subtitle=""
                    storageKey="sunday-pantry-spices"
                    initialItems={DEFAULT_SPICES}
                    onMoveToShop={handleMoveToShop}
                    source="spices"
                    highlightNames={pantryMatchedItems.names}
                    hideHeader
                  />
                </div>
              </div>
              <div key="sauces" className={styles.widgetBox}>
                <div className={styles.widgetHeadingRow}>
                  <h3 className={styles.widgetHeading}>Sauces</h3>
                  <div className={styles.widgetControls}>
                    <span className={styles.widgetDragIcon}>&#8942;&#8942;</span>
                  </div>
                </div>
                <div className={styles.widgetBody}>
                  <PantryList
                    key={`sauces-${resetKey}`}
                    title=""
                    subtitle=""
                    storageKey="sunday-pantry-sauces"
                    initialItems={DEFAULT_SAUCES}
                    onMoveToShop={handleMoveToShop}
                    source="sauces"
                    highlightNames={pantryMatchedItems.names}
                    hideHeader
                  />
                </div>
              </div>
              <div key="snacks" className={styles.widgetBox}>
                <div className={styles.widgetHeadingRow}>
                  <h3 className={styles.widgetHeading}>Snacks</h3>
                  <div className={styles.widgetControls}>
                    <span className={styles.widgetDragIcon}>&#8942;&#8942;</span>
                  </div>
                </div>
                <div className={styles.widgetBody}>
                  <TrackedItemsList
                    key={`snacks-${resetKey}`}
                    storageKey="sunday-pantry-snacks"
                    firestoreField="pantrySnacks"
                    highlightNames={pantryMatchedItems.names}
                    initialItems={DEFAULT_SNACKS}
                    eatenMap={eatenMap}
                    hideHeader
                  />
                </div>
              </div>
              <div key="fruit" className={styles.widgetBox}>
                <div className={styles.widgetHeadingRow}>
                  <h3 className={styles.widgetHeading}>Fruit</h3>
                  <div className={styles.widgetControls}>
                    <span className={styles.widgetDragIcon}>&#8942;&#8942;</span>
                  </div>
                </div>
                <div className={styles.widgetBody}>
                  <TrackedItemsList
                    key={`fruit-${resetKey}`}
                    storageKey="sunday-pantry-fruit"
                    firestoreField="pantryFruit"
                    highlightNames={pantryMatchedItems.names}
                    initialItems={DEFAULT_FRUITS}
                    eatenMap={eatenMap}
                    hideHeader
                  />
                </div>
              </div>
              {customWidgets.map(cw => (
                <div key={cw.id} className={styles.widgetBox}>
                  <div className={styles.widgetHeadingRow}>
                    {renamingWidgetId === cw.id ? (
                      <input
                        className={styles.widgetRenameInput}
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => { if (renameValue.trim()) renameWidget(cw.id, renameValue.trim()); setRenamingWidgetId(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') { if (renameValue.trim()) renameWidget(cw.id, renameValue.trim()); setRenamingWidgetId(null); } if (e.key === 'Escape') setRenamingWidgetId(null); }}
                        onMouseDown={e => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <h3 className={styles.widgetHeading} onDoubleClick={e => { e.stopPropagation(); setRenamingWidgetId(cw.id); setRenameValue(cw.label); }}>{cw.label}</h3>
                    )}
                    <div className={styles.widgetControls}>
                      <button className={styles.widgetEditBtn} onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setRenamingWidgetId(cw.id); setRenameValue(cw.label); }} title="Rename">&#9998;</button>
                      <span className={styles.widgetDragIcon}>&#8942;&#8942;</span>
                      <button className={styles.widgetDeleteBtn} onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); if (confirm(`Delete "${cw.label}"?`)) removeWidget(cw.id); }} title={`Delete ${cw.label}`}>&#10005;</button>
                    </div>
                  </div>
                  <div className={styles.widgetBody}>
                    <div
                      className={styles.customWidgetContent}
                      contentEditable
                      suppressContentEditableWarning
                      ref={el => { if (el && !el.dataset.init) { el.innerHTML = cw.content || ''; el.dataset.init = '1'; } }}
                      onBlur={e => updateWidgetContent(cw.id, e.currentTarget.innerHTML)}
                      data-placeholder="Type notes, links, or anything here..."
                    />
                  </div>
                </div>
              ))}
            </GridLayout>
          </div>

          {/* Add Widget button */}
          <div className={styles.addWidgetRow}>
            {!addingWidget ? (
              <button className={styles.addWidgetBtn} onClick={() => setAddingWidget(true)}>+ Add Widget</button>
            ) : (
              <div className={styles.addWidgetForm}>
                <input
                  className={styles.addWidgetInput}
                  type="text"
                  placeholder="Widget name..."
                  value={newWidgetName}
                  onChange={e => setNewWidgetName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addWidget(); if (e.key === 'Escape') { setAddingWidget(false); setNewWidgetName(''); } }}
                  autoFocus
                />
                <button className={styles.addWidgetSave} onClick={addWidget}>Add</button>
                <button className={styles.addWidgetCancel} onClick={() => { setAddingWidget(false); setNewWidgetName(''); }}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
