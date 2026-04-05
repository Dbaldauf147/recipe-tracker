import { useState, useEffect, useMemo } from 'react';
import { auth } from '../firebase';
import { saveField } from '../utils/firestoreSync';
import { loadIngredients } from '../utils/ingredientsStore';
import styles from './GroceryStaples.module.css';

const STORAGE_TO_FIELD = {
  'sunday-pantry-spices': 'pantrySpices',
  'sunday-pantry-sauces': 'pantrySauces',
};

export function PantryList({ title, subtitle, storageKey, initialItems, onMoveToShop, source, highlightNames, hideHeader }) {
  const [items, setItems] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const allIngredientNames = useMemo(() => {
    const db = loadIngredients() || [];
    return [...new Set(db.filter(r => r.ingredient).map(r => r.ingredient.trim()))].sort();
  }, []);

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

  const [addingNew, setAddingNew] = useState(false);
  const [newItemText, setNewItemText] = useState('');

  function addItem() {
    setAddingNew(true);
    setNewItemText('');
  }

  function commitNewItem(name) {
    const trimmed = (name || newItemText).trim();
    if (!trimmed) { setAddingNew(false); return; }
    // Don't add duplicates
    if (items.some(it => (it.ingredient || '').toLowerCase() === trimmed.toLowerCase())) {
      setAddingNew(false);
      setNewItemText('');
      return;
    }
    setItems(prev => [...prev, { ingredient: trimmed }]);
    setNewItemText('');
    setAddingNew(false);
  }

  return (
    <div className={styles.panel}>
      {!hideHeader && <h2 className={styles.heading}>{title} {subtitle && <span className={styles.subtitle}>{subtitle}</span>}</h2>}
      {!addingNew ? (
        <button className={styles.addBtn} onClick={addItem}>+ Add item</button>
      ) : (
        <div style={{ position: 'relative', marginBottom: '0.5rem' }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setAddingNew(false); setNewItemText(''); } }}>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              className={styles.cellInput}
              type="text"
              value={newItemText}
              onChange={e => { setNewItemText(e.target.value); setShowSuggestions(true); }}
              onKeyDown={e => {
                if (e.key === 'Enter') commitNewItem();
                if (e.key === 'Escape') { setAddingNew(false); setNewItemText(''); }
              }}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Type ingredient name..."
              autoFocus
              style={{ flex: 1 }}
            />
            <button className={styles.addBtn} onClick={() => commitNewItem()} style={{ margin: 0 }}>Add</button>
            <button className={styles.removeBtn} onClick={() => { setAddingNew(false); setNewItemText(''); }}>&times;</button>
          </div>
          {showSuggestions && newItemText.trim().length >= 1 && (() => {
            const q = newItemText.trim().toLowerCase();
            const starts = allIngredientNames.filter(n => n.toLowerCase().startsWith(q)).slice(0, 8);
            const contains = allIngredientNames.filter(n => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q)).slice(0, 4);
            const matches = [...starts, ...contains];
            if (matches.length === 0) return null;
            return (
              <div className={styles.suggestions}>
                {matches.map(n => (
                  <button key={n} className={styles.suggestionItem} onMouseDown={e => {
                    e.preventDefault();
                    commitNewItem(n);
                  }}>
                    {n}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      )}
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
            .map(({ _i: i, ...item }) => {
              const highlighted = highlightNames && highlightNames.has((item.ingredient || '').toLowerCase().trim());
              return (
            <tr key={i} className={highlighted ? styles.highlightRow : ''}>
              <td>
                <span className={styles.cellText}>{item.ingredient}</span>
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
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
