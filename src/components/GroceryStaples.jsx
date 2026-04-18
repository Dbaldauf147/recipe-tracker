import { useState, useEffect, useMemo, useRef } from 'react';
import { auth } from '../firebase';
import { saveField } from '../utils/firestoreSync';
import { loadIngredients } from '../utils/ingredientsStore';
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
  const [checked, setChecked] = useState(() => {
    try { const raw = localStorage.getItem('sunday-staples-checked'); return raw ? new Set(JSON.parse(raw)) : new Set(); }
    catch { return new Set(); }
  });
  const lastStapleSaveRef = useRef(0);

  function saveStaplesChecked(next) {
    const arr = [...next];
    localStorage.setItem('sunday-staples-checked', JSON.stringify(arr));
    lastStapleSaveRef.current = Date.now();
    const uid = auth.currentUser?.uid;
    if (uid) saveField(uid, 'staplesChecked', arr);
  }

  // Sync from Firestore (or a local reset that removed the key)
  useEffect(() => {
    const handleSync = () => {
      if (Date.now() - lastStapleSaveRef.current < 3000) return;
      try {
        const raw = localStorage.getItem('sunday-staples-checked');
        setChecked(raw ? new Set(JSON.parse(raw)) : new Set());
      } catch {}
    };
    window.addEventListener('firestore-sync', handleSync);
    return () => window.removeEventListener('firestore-sync', handleSync);
  }, []);
  const [addingNew, setAddingNew] = useState(false);
  const [newIngName, setNewIngName] = useState('');
  const [newIngQty, setNewIngQty] = useState('');
  const [newIngMeas, setNewIngMeas] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const allIngredientNames = useMemo(() => {
    const db = loadIngredients() || [];
    return [...new Set(db.filter(r => r.ingredient).map(r => r.ingredient.trim()))].sort();
  }, []);

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

  function startAdd() {
    setAddingNew(true);
    setNewIngName('');
    setNewIngQty('');
    setNewIngMeas('');
  }

  function commitAdd(name) {
    const trimmed = (name || newIngName).trim();
    if (!trimmed) { setAddingNew(false); return; }
    setStaples(prev => [...prev, { quantity: newIngQty.trim(), measurement: newIngMeas.trim(), ingredient: trimmed }]);
    setNewIngName('');
    setNewIngQty('');
    setNewIngMeas('');
    setAddingNew(false);
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Grocery Staples <span className={styles.subtitle}>(Things you want everytime)</span></h2>
      {loading ? (
        <p className={styles.loading}>Loading...</p>
      ) : (
        <>
          {!addingNew ? (
            <button className={styles.addBtn} onClick={startAdd}>+ Add item</button>
          ) : (
            <div style={{ position: 'relative', marginBottom: '0.5rem' }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setAddingNew(false); } }}>
              <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                <input className={styles.cellInput} type="text" value={newIngQty} onChange={e => setNewIngQty(e.target.value)} placeholder="Qty" style={{ width: '3rem' }} />
                <input className={styles.cellInput} type="text" value={newIngMeas} onChange={e => setNewIngMeas(e.target.value)} placeholder="Unit" style={{ width: '4rem' }} />
                <input
                  className={styles.cellInput}
                  type="text"
                  value={newIngName}
                  onChange={e => { setNewIngName(e.target.value); setShowSuggestions(true); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitAdd();
                    if (e.key === 'Escape') { setAddingNew(false); }
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="Ingredient name..."
                  autoFocus
                  style={{ flex: 1 }}
                />
                <button className={styles.addBtn} onClick={() => commitAdd()} style={{ margin: 0 }}>Add</button>
                <button className={styles.removeBtn} onClick={() => setAddingNew(false)}>&times;</button>
              </div>
              {showSuggestions && newIngName.trim().length >= 1 && (() => {
                const q = newIngName.trim().toLowerCase();
                const starts = allIngredientNames.filter(n => n.toLowerCase().startsWith(q)).slice(0, 8);
                const contains = allIngredientNames.filter(n => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q)).slice(0, 4);
                const matches = [...starts, ...contains];
                if (matches.length === 0) return null;
                return (
                  <div className={styles.suggestions}>
                    {matches.map(n => (
                      <button key={n} className={styles.suggestionItem} onMouseDown={e => {
                        e.preventDefault();
                        commitAdd(n);
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
                .sort((a, b) => (a.ingredient || '').localeCompare(b.ingredient || ''))
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
                    saveStaplesChecked(next);
                    return next;
                  });
                }}>
                  <td className={styles.checkCell}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={done}
                      onChange={() => {
                        setChecked(prev => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key); else next.add(key);
                          saveStaplesChecked(next);
                          return next;
                        });
                      }}
                      onClick={e => e.stopPropagation()}
                    />
                  </td>
                  <td><span className={styles.cellText}>{item.quantity}</span></td>
                  <td><span className={styles.cellText}>{item.measurement}</span></td>
                  <td><span className={styles.cellText}>{item.ingredient}</span></td>
                  <td>
                    <button
                      className={styles.removeBtn}
                      onClick={(e) => { e.stopPropagation(); removeItem(i); }}
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
