import { useState, useCallback } from 'react';
import { ShoppingList } from './ShoppingList';
import { GroceryStaples } from './GroceryStaples';
import { PantryList } from './PantryList';
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

function loadExtras() {
  try {
    const data = localStorage.getItem(EXTRAS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveExtras(extras) {
  localStorage.setItem(EXTRAS_KEY, JSON.stringify(extras));
}

const SOURCE_KEYS = {
  staples: 'sunday-grocery-staples',
  spices: 'sunday-pantry-spices',
  sauces: 'sunday-pantry-sauces',
};

export function ShoppingListPage({ weeklyRecipes, onClose }) {
  const [extras, setExtras] = useState(loadExtras);
  const [resetKey, setResetKey] = useState(0);

  const handleMoveToShop = useCallback((item, source) => {
    setExtras(prev => {
      const next = [...prev, { ...item, source }];
      saveExtras(next);
      return next;
    });
  }, []);

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
          />
        </div>
        <div className={styles.cell}>
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
          />
        </div>
      </div>
    </div>
  );
}
