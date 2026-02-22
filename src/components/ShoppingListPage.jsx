import { useState, useCallback, useMemo } from 'react';
import { ShoppingList } from './ShoppingList';
import { GroceryStaples } from './GroceryStaples';
import { PantryList } from './PantryList';
import { useAuth } from '../contexts/AuthContext';
import { saveField } from '../utils/firestoreSync';
import styles from './ShoppingListPage.module.css';

const DEFAULT_SPICES = [
  'Parsley Flakes',
  'Garam Masala',
  'Turmeric',
  'Himalayan Salt',
  'Fenugreek Leaves',
  'Cayenne Powder',
  'Bay Leaves',
  'Paprika',
  'Everything But the Bagel Seasoning',
  'Italian Seasoning',
  'Ground Black Pepper',
  'Coriander',
  'Garlic Powder',
  'Curry Powder',
  'Red Pepper Flakes',
  'Tajin Seasoning',
  'Cardamom',
  'Thyme (Dried)',
  'Oregano (Dried)',
  'Old Bay Seasoning',
  'Harissa Powder',
].map(name => ({ ingredient: name }));

const DEFAULT_SAUCES = [
  'Balsamic Vinegar',
  'Olive Oil',
  'Dijon Mustard',
  'Sesame Oil',
  'Vegetable Oil',
  'Teriyaki Sauce',
  "Frank's RedHot",
  'Brown Mustard',
  'Honey',
].map(name => ({ ingredient: name }));

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

export function ShoppingListPage({ weeklyRecipes, onClose }) {
  const { user } = useAuth();
  const [extras, setExtras] = useState(loadExtras);
  const [dismissed, setDismissed] = useState(loadDismissed);
  const [resetKey, setResetKey] = useState(0);

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
        localStorage.setItem(key, JSON.stringify([...existing, ...items]));
      } catch {}
    }

    setExtras([]);
    saveExtras([]);
    setResetKey(k => k + 1);
  }, [extras]);

  const handleDismissItem = useCallback((ingredientName) => {
    setDismissed(prev => {
      const norm = ingredientName.toLowerCase().trim();
      if (prev.some(d => d.name === norm)) return prev;
      const next = [...prev, { name: norm, label: ingredientName.trim() }];
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
      if (user) saveField(user.uid, 'shopDismissed', next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const dismissedNames = useMemo(
    () => new Set(dismissed.map(d => d.name)),
    [dismissed]
  );

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

  const pantryMatchedItems = useMemo(() => {
    const matched = new Map();
    for (const recipe of weeklyRecipes) {
      for (const ing of (recipe.ingredients || [])) {
        const name = (ing.ingredient || '').toLowerCase().trim();
        if (name && pantryNames.has(name) && !matched.has(name)) {
          matched.set(name, ing.ingredient.trim());
        }
      }
    }
    for (const e of extras) {
      const name = (e.ingredient || '').toLowerCase().trim();
      if (name && pantryNames.has(name) && !matched.has(name)) {
        matched.set(name, e.ingredient.trim());
      }
    }
    // Also include dismissed items not already matched by pantry
    for (const d of dismissed) {
      if (!matched.has(d.name)) {
        matched.set(d.name, d.label);
      }
    }
    return { names: new Set(matched.keys()), labels: [...matched.values()].sort() };
  }, [weeklyRecipes, extras, pantryNames, dismissed]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>
          &larr; Back
        </button>
        <h2 className={styles.title}>Shopping List</h2>
      </div>

      <div className={styles.grid}>
        <div className={styles.cell}>
          <ShoppingList
            weeklyRecipes={weeklyRecipes}
            extraItems={extras}
            onClearExtras={handleClearExtras}
            onAddCustomItem={handleAddCustomItem}
            pantryNames={pantryNames}
            dismissedNames={dismissedNames}
            onDismissItem={handleDismissItem}
          />
        </div>
        <div className={styles.cell}>
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
          <GroceryStaples key={resetKey} onMoveToShop={handleMoveToShop} />
        </div>
        <div className={styles.cell}>
          <PantryList
            key={`spices-${resetKey}`}
            title="Spices"
            subtitle="(that you have already)"
            storageKey="sunday-pantry-spices"
            initialItems={DEFAULT_SPICES}
            onMoveToShop={handleMoveToShop}
            source="spices"
            highlightNames={pantryMatchedItems.names}
          />
        </div>
        <div className={styles.cell}>
          <PantryList
            key={`sauces-${resetKey}`}
            title="Sauces"
            subtitle="(that you have already)"
            storageKey="sunday-pantry-sauces"
            initialItems={DEFAULT_SAUCES}
            onMoveToShop={handleMoveToShop}
            source="sauces"
            highlightNames={pantryMatchedItems.names}
          />
        </div>
      </div>
    </div>
  );
}
