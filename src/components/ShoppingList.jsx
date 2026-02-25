import { useState, useMemo } from 'react';
import { loadIngredients } from '../utils/ingredientsStore.js';
import styles from './ShoppingList.module.css';

function parseFraction(str) {
  if (!str) return 0;
  const s = str.trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}

function formatQuantity(n) {
  if (n === 0) return '';
  if (Number.isInteger(n)) return String(n);
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

function mergeIntoMap(map, ingredient, measurement, quantity) {
  const name = ingredient.toLowerCase().trim();
  if (!name) return;
  const qty = parseFraction(quantity);
  if (map.has(name)) {
    const entry = map.get(name);
    entry.quantity += qty;
    // Keep the first non-empty measurement
    if (!entry.measurement && measurement) {
      entry.measurement = measurement;
    }
  } else {
    map.set(name, {
      ingredient: ingredient.trim(),
      measurement: measurement || '',
      quantity: qty,
    });
  }
}

function buildShoppingList(recipes) {
  const map = new Map();
  for (const recipe of recipes) {
    for (const ing of recipe.ingredients) {
      mergeIntoMap(map, ing.ingredient, ing.measurement, ing.quantity);
    }
  }
  return map;
}

export function ShoppingList({ weeklyRecipes, extraItems = [], onClearExtras, onAddCustomItem, pantryNames, dismissedNames, onDismissItem }) {
  const items = useMemo(() => {
    const map = buildShoppingList(weeklyRecipes);
    for (const e of extraItems) {
      mergeIntoMap(map, e.ingredient || '', e.measurement || '', e.quantity);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.ingredient.localeCompare(b.ingredient)
    );
  }, [weeklyRecipes, extraItems]);

  const displayItems = useMemo(() => {
    return items.filter(item => {
      const norm = item.ingredient.toLowerCase().trim();
      if (pantryNames) {
        for (const pn of pantryNames) {
          if (norm === pn || norm.includes(pn) || pn.includes(norm)) return false;
        }
      }
      if (dismissedNames) {
        for (const dn of dismissedNames) {
          if (norm === dn || norm.includes(dn) || dn.includes(norm)) return false;
        }
      }
      return true;
    });
  }, [items, pantryNames, dismissedNames]);

  const ingredientLinks = useMemo(() => {
    const db = loadIngredients() || [];
    const map = {};
    for (const row of db) {
      if (row.ingredient && row.link) {
        map[row.ingredient.toLowerCase().trim()] = row.link;
      }
    }
    return map;
  }, []);

  const [checked, setChecked] = useState(new Set());
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState('');

  function toggleItem(key) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleAddSubmit() {
    const name = newItem.trim();
    if (!name || !onAddCustomItem) return;
    onAddCustomItem({ ingredient: name, quantity: '', measurement: '' });
    setNewItem('');
  }

  if (displayItems.length === 0) {
    return (
      <div className={styles.panel}>
        <h2 className={styles.heading}>Shopping List</h2>
        <p className={styles.emptyMsg}>Shopping list is empty — add meals to populate</p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.headingRow}>
        <h2 className={styles.heading}>Shopping List</h2>
        {extraItems.length > 0 && (
          <button className={styles.clearBtn} onClick={onClearExtras}>
            Return items ({extraItems.length})
          </button>
        )}
      </div>
      {onAddCustomItem && (
        adding ? (
          <div className={styles.addRow}>
            <input
              className={styles.addInput}
              type="text"
              placeholder="Item name"
              value={newItem}
              onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddSubmit(); }}
              autoFocus
            />
            <button className={styles.addBtn} onClick={handleAddSubmit}>Add</button>
            <button className={styles.addBtn} onClick={() => { setAdding(false); setNewItem(''); }}>Cancel</button>
          </div>
        ) : (
          <button className={styles.addToggle} onClick={() => setAdding(true)}>+ Add item</button>
        )
      )}
      <table className={styles.table}>
        <thead>
          <tr>
            <th></th>
            <th>Qty</th>
            <th>Measurement</th>
            <th>Ingredient</th>
            <th>Link</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {displayItems.map((item, i) => {
            const key = `${item.ingredient}|||${item.measurement}`;
            const done = checked.has(key);
            const link = ingredientLinks[item.ingredient.toLowerCase().trim()];
            return (
              <tr
                key={i}
                className={done ? styles.checkedRow : ''}
                onClick={() => toggleItem(key)}
              >
                <td className={styles.checkCell}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={done}
                    onChange={() => toggleItem(key)}
                    onClick={e => e.stopPropagation()}
                  />
                </td>
                <td className={styles.qtyCell}>{formatQuantity(item.quantity)}</td>
                <td>{item.measurement}</td>
                <td>{item.ingredient}</td>
                <td className={styles.linkCell}>
                  {link && (
                    <a
                      href={link.startsWith('http') ? link : `https://${link}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className={styles.searchLink}
                    >
                      &#x1F50D;
                    </a>
                  )}
                </td>
                <td className={styles.dismissCell}>
                  {onDismissItem && (
                    <button
                      className={styles.dismissBtn}
                      onClick={e => { e.stopPropagation(); onDismissItem(item.ingredient); }}
                      title="Remove from list"
                    >
                      &times;
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
