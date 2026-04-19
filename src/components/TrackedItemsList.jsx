import { useEffect, useMemo, useState } from 'react';
import { auth } from '../firebase';
import { saveField } from '../utils/firestoreSync';
import { loadIngredients } from '../utils/ingredientsStore';
import styles from './GroceryStaples.module.css';

function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  if (isNaN(then)) return null;
  const now = new Date();
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

// Warmer tint as an item ages — lerp between a pale pink (7d) and deep red (120d).
function sinceBg(days) {
  if (days == null) return 'transparent';
  const clamped = Math.max(0, Math.min(120, days - 7));
  if (clamped <= 0) return 'transparent';
  const alpha = (clamped / 120) * 0.55;
  return `rgba(220, 38, 38, ${alpha.toFixed(2)})`;
}

// Normalize a snack name for fuzzy matching against eatenMap keys.
function normalizeSnackName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\(s\)/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Look up the most-recent eaten date for this snack from a normalized
// ingredient-name → ISO-date map. Tries exact then contains-either-direction.
function lookupEatenDate(snackIngredient, eatenMap) {
  if (!eatenMap || typeof eatenMap.get !== 'function') return null;
  const key = normalizeSnackName(snackIngredient);
  if (!key) return null;
  const exact = eatenMap.get(key);
  if (exact) return exact;
  // Partial match — e.g. snack "rice cake white cheddar" vs recipe ingredient
  // "rice cakes". Require ≥4 chars of overlap to keep false positives down.
  let best = null;
  for (const [k, date] of eatenMap) {
    if (k.length < 4 || key.length < 4) continue;
    if (k.includes(key) || key.includes(k)) {
      if (!best || date > best) best = date;
    }
  }
  return best;
}

export function TrackedItemsList({ storageKey, firestoreField, hideHeader, title, subtitle, highlightNames, initialItems, eatenMap }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newQty, setNewQty] = useState('');
  const [newMeas, setNewMeas] = useState('');
  const [newName, setNewName] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const allIngredientNames = useMemo(() => {
    const db = loadIngredients() || [];
    return [...new Set(db.filter(r => r.ingredient).map(r => r.ingredient.trim()))].sort();
  }, []);

  useEffect(() => {
    try {
      const data = localStorage.getItem(storageKey);
      const parsed = data ? JSON.parse(data) : null;
      if (Array.isArray(parsed) && parsed.length > 0) setItems(parsed);
      else if (initialItems) setItems(initialItems);
      else setItems([]);
    } catch { setItems([]); }
    setLoading(false);
  }, [storageKey]);

  useEffect(() => {
    if (loading) return;
    try { localStorage.setItem(storageKey, JSON.stringify(items)); } catch {}
    const user = auth.currentUser;
    if (user && firestoreField) saveField(user.uid, firestoreField, items);
  }, [items, loading, storageKey, firestoreField]);

  // Re-read from localStorage when Firestore pushes a sync (cross-device or
  // after first-mount user resolution).
  useEffect(() => {
    function onSync() {
      try {
        const data = localStorage.getItem(storageKey);
        const parsed = data ? JSON.parse(data) : null;
        if (Array.isArray(parsed)) setItems(parsed);
      } catch { /* ignore */ }
    }
    window.addEventListener('firestore-sync', onSync);
    return () => window.removeEventListener('firestore-sync', onSync);
  }, [storageKey]);

  function commitAdd(name) {
    const trimmed = (name || newName).trim();
    if (!trimmed) { setAdding(false); return; }
    if (items.some(it => (it.ingredient || '').toLowerCase() === trimmed.toLowerCase())) {
      setAdding(false); setNewName(''); setNewQty(''); setNewMeas('');
      return;
    }
    setItems(prev => [...prev, {
      quantity: newQty.trim(),
      measurement: newMeas.trim(),
      ingredient: trimmed,
      lastPurchased: new Date().toISOString(),
    }]);
    setNewName(''); setNewQty(''); setNewMeas('');
    setAdding(false);
  }

  function bumpItem(idx) {
    setItems(prev => prev.map((it, i) =>
      i === idx ? { ...it, lastPurchased: new Date().toISOString() } : it
    ));
  }

  function removeItem(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className={styles.panel}>
      {!hideHeader && (
        <h2 className={styles.heading}>{title}{subtitle && <span className={styles.subtitle}>{subtitle}</span>}</h2>
      )}
      {loading ? (
        <p className={styles.loading}>Loading...</p>
      ) : (
        <>
          {!adding ? (
            <button className={styles.addBtn} onClick={() => setAdding(true)}>+ Add item</button>
          ) : (
            <div style={{ position: 'relative', marginBottom: '0.5rem' }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) { setAdding(false); } }}>
              <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                <input className={styles.cellInput} type="text" value={newQty} onChange={e => setNewQty(e.target.value)} placeholder="Qty" style={{ width: '3rem' }} />
                <input className={styles.cellInput} type="text" value={newMeas} onChange={e => setNewMeas(e.target.value)} placeholder="Unit" style={{ width: '4rem' }} />
                <input
                  className={styles.cellInput}
                  type="text"
                  value={newName}
                  onChange={e => { setNewName(e.target.value); setShowSuggestions(true); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitAdd();
                    if (e.key === 'Escape') setAdding(false);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="Item name..."
                  autoFocus
                  style={{ flex: 1 }}
                />
                <button className={styles.addBtn} onClick={() => commitAdd()} style={{ margin: 0 }}>Add</button>
                <button className={styles.removeBtn} onClick={() => setAdding(false)}>&times;</button>
              </div>
              {showSuggestions && newName.trim().length >= 1 && (() => {
                const q = newName.trim().toLowerCase();
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
                      }}>{n}</button>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Qty</th>
                <th>Unit</th>
                <th>Ingredient</th>
                <th>Since</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...items]
                .map((item, i) => {
                  const eaten = lookupEatenDate(item.ingredient, eatenMap);
                  // Use the more-recent of the meal-log eaten date and the
                  // manual lastPurchased bump. Reset Shopping List writes
                  // lastPurchased=today for everything on the list, so that
                  // should win over any older meal-log match.
                  let source = null;
                  if (eaten && item.lastPurchased) {
                    source = new Date(eaten) > new Date(item.lastPurchased) ? eaten : item.lastPurchased;
                  } else {
                    source = eaten || item.lastPurchased || null;
                  }
                  const d = daysSince(source);
                  // Never-eaten items sort above the oldest known date.
                  const sortValue = d == null ? Number.POSITIVE_INFINITY : d;
                  return { ...item, _i: i, _since: sortValue };
                })
                .sort((a, b) => {
                  if (b._since !== a._since) return b._since - a._since;
                  return (a.ingredient || '').localeCompare(b.ingredient || '');
                })
                .map(({ _i: i, _since, ...item }) => {
                  const highlighted = highlightNames && highlightNames.has((item.ingredient || '').toLowerCase().trim());
                  // Prefer the "eaten" date from the daily log (automatic
                  // tracking) over a manual lastPurchased bump.
                  const eatenDate = lookupEatenDate(item.ingredient, eatenMap);
                  let sourceDate = null;
                  if (eatenDate && item.lastPurchased) {
                    sourceDate = new Date(eatenDate) > new Date(item.lastPurchased) ? eatenDate : item.lastPurchased;
                  } else {
                    sourceDate = eatenDate || item.lastPurchased || null;
                  }
                  const since = daysSince(sourceDate);
                  const sinceTitle = eatenDate
                    ? `Last eaten on ${eatenDate}`
                    : item.lastPurchased
                      ? `Marked purchased on ${item.lastPurchased.slice(0, 10)}`
                      : 'Click to mark as just purchased';
                  return (
                    <tr
                      key={i}
                      className={highlighted ? styles.highlightRow : ''}
                      onClick={() => bumpItem(i)}
                      title="Click to mark as just purchased (resets manual Since)"
                      style={{ cursor: 'pointer' }}
                    >
                      <td><span className={styles.cellText}>{item.quantity}</span></td>
                      <td><span className={styles.cellText}>{item.measurement}</span></td>
                      <td><span className={styles.cellText}>{item.ingredient}</span></td>
                      <td
                        style={{ background: sinceBg(since), textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                        title={sinceTitle}
                      >
                        <span className={styles.cellText}>{since == null ? '—' : since}</span>
                      </td>
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
