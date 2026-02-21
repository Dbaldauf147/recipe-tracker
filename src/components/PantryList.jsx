import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { saveField } from '../utils/firestoreSync';
import styles from './GroceryStaples.module.css';

const STORAGE_TO_FIELD = {
  'sunday-pantry-spices': 'pantrySpices',
  'sunday-pantry-sauces': 'pantrySauces',
};

export function PantryList({ title, subtitle, storageKey, initialItems, onMoveToShop, source }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    try {
      const data = localStorage.getItem(storageKey);
      const parsed = data ? JSON.parse(data) : [];
      if (parsed.length > 0) {
        setItems(parsed);
      } else if (initialItems) {
        setItems(initialItems);
      }
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(items));
    const user = auth.currentUser;
    const field = STORAGE_TO_FIELD[storageKey];
    if (user && field) saveField(user.uid, field, items);
  }, [items, storageKey]);

  function updateItem(index, field, value) {
    setItems(prev =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  function removeItem(index) {
    const item = items[index];
    setItems(prev => prev.filter((_, i) => i !== index));
    if (onMoveToShop) onMoveToShop(item, source);
  }

  function addItem() {
    setItems(prev => [...prev, { ingredient: '' }]);
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>{title} {subtitle && <span className={styles.subtitle}>{subtitle}</span>}</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Item</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {[...items]
            .map((item, i) => ({ ...item, _i: i }))
            .sort((a, b) => (a.ingredient || '').localeCompare(b.ingredient || ''))
            .map(({ _i: i, ...item }) => (
            <tr key={i}>
              <td>
                <input
                  className={styles.cellInput}
                  type="text"
                  value={item.ingredient}
                  onChange={e => updateItem(i, 'ingredient', e.target.value)}
                  placeholder="item"
                />
              </td>
              <td>
                <button
                  className={styles.removeBtn}
                  onClick={() => removeItem(i)}
                  title="Remove"
                >
                  &times;
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className={styles.addBtn} onClick={addItem}>
        + Add item
      </button>
    </div>
  );
}
