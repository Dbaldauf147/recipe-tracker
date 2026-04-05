import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { saveField } from '../utils/firestoreSync';
import styles from './GroceryStaples.module.css';

const STORAGE_KEY = 'sunday-grocery-staples';

function loadStaples() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveStaples(staples) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(staples));
  const user = auth.currentUser;
  if (user) saveField(user.uid, 'groceryStaples', staples);
}

export function GroceryStaples({ onMoveToShop, highlightNames }) {
  const [staples, setStaples] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(new Set());
  const [editingIndex, setEditingIndex] = useState(null);

  useEffect(() => {
    const saved = loadStaples();
    setStaples(saved || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!loading) {
      saveStaples(staples);
    }
  }, [staples, loading]);

  function updateItem(index, field, value) {
    setStaples(prev =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  function removeItem(index) {
    const item = staples[index];
    setStaples(prev => prev.filter((_, i) => i !== index));
    if (onMoveToShop) onMoveToShop(item, 'staples');
  }

  function addItem() {
    setStaples(prev => {
      const next = [...prev, { quantity: '', measurement: '', ingredient: '' }];
      setEditingIndex(next.length - 1);
      return next;
    });
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Grocery Staples <span className={styles.subtitle}>(Things you want everytime)</span></h2>
      {loading ? (
        <p className={styles.loading}>Loading...</p>
      ) : (
        <>
          <button className={styles.addBtn} onClick={addItem}>
            + Add item
          </button>
          <table className={styles.table}>
            <thead>
              <tr>
                <th></th>
                <th>Qty</th>
                <th>Measurement</th>
                <th>Ingredient</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...staples]
                .map((item, i) => ({ ...item, _i: i }))
                .sort((a, b) => {
                  if (a._i === editingIndex) return -1;
                  if (b._i === editingIndex) return 1;
                  return (a.ingredient || '').localeCompare(b.ingredient || '');
                })
                .map(({ _i: i, ...item }) => {
                  const highlighted = highlightNames && highlightNames.has((item.ingredient || '').toLowerCase().trim());
                  const key = (item.ingredient || '').toLowerCase().trim();
                  const done = checked.has(key);
                  const rowClass = [
                    highlighted ? styles.highlightRow : '',
                    done ? styles.checkedRow : '',
                  ].filter(Boolean).join(' ');
                  return (
                <tr key={i} className={rowClass} onClick={() => {
                  setChecked(prev => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                  });
                }}
                onBlur={i === editingIndex ? (e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setEditingIndex(null);
                } : undefined}
                >
                  <td className={styles.checkCell}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={done}
                      onChange={() => {
                        setChecked(prev => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key); else next.add(key);
                          return next;
                        });
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                  </td>
                  <td>
                    <input
                      className={styles.cellInput}
                      type="text"
                      value={item.quantity}
                      onChange={e => updateItem(i, 'quantity', e.target.value)}
                      placeholder="1"
                    />
                  </td>
                  <td>
                    <input
                      className={styles.cellInput}
                      type="text"
                      value={item.measurement}
                      onChange={e => updateItem(i, 'measurement', e.target.value)}
                      placeholder="unit"
                    />
                  </td>
                  <td>
                    <input
                      className={styles.cellInput}
                      type="text"
                      value={item.ingredient}
                      onChange={e => updateItem(i, 'ingredient', e.target.value)}
                      placeholder="ingredient"
                      autoFocus={i === editingIndex}
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
                  );
                })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
