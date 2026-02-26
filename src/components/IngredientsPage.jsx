import { useState, useEffect, useCallback, useRef } from 'react';
import {
  INGREDIENT_FIELDS,
  loadIngredients,
  saveIngredients,
  fetchAndSeedIngredients,
} from '../utils/ingredientsStore.js';
import styles from './IngredientsPage.module.css';

// Display order of columns (by field key)
const DISPLAY_KEYS = [
  'ingredient', 'grams', 'measurement', 'calories', 'protein', 'carbs', 'fat',
  'fiber', 'sugar', 'saturatedFat', 'addedSugar', 'sodium', 'potassium',
  'vitaminB12', 'vitaminC', 'magnesium', 'zinc', 'iron', 'calcium',
  'leucine', 'omega3', 'proteinPerCal', 'fiberPerCal', 'notes',
  'lastBought', 'storage', 'minShelf', 'maxShelf', 'processed', 'link',
];

const FIELD_MAP = Object.fromEntries(INGREDIENT_FIELDS.map(f => [f.key, f]));

const COL_WIDTHS_KEY = 'sunday-ingredients-col-widths';
const DEFAULT_WIDTHS = { ingredient: 140, measurement: 70, notes: 100, link: 80, storage: 70 };

function loadColWidths() {
  try {
    const saved = localStorage.getItem(COL_WIDTHS_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch { return {}; }
}

export function IngredientsPage({ onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [colWidths, setColWidths] = useState(loadColWidths);
  const resizing = useRef(null);

  useEffect(() => {
    const data = loadIngredients();
    if (data && data.length > 0) {
      setRows(data);
      setLoading(false);
    } else {
      fetchAndSeedIngredients()
        .then(setRows)
        .catch(() => setError('Failed to load ingredients data.'))
        .finally(() => setLoading(false));
    }
  }, []);

  const updateField = useCallback((origIdx, key, value) => {
    setRows(prev => {
      const updated = prev.map((row, i) =>
        i === origIdx ? { ...row, [key]: value } : row
      );
      saveIngredients(updated);
      return updated;
    });
  }, []);

  const addRow = useCallback(() => {
    setRows(prev => {
      const empty = {};
      for (const f of INGREDIENT_FIELDS) empty[f.key] = '';
      const updated = [...prev, empty];
      saveIngredients(updated);
      return updated;
    });
  }, []);

  const removeRow = useCallback((origIdx) => {
    setRows(prev => {
      const updated = prev.filter((_, i) => i !== origIdx);
      saveIngredients(updated);
      return updated;
    });
  }, []);

  function handleSort(key) {
    if (sortKey === key) {
      setSortAsc(prev => !prev);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function getColWidth(key) {
    return colWidths[key] || DEFAULT_WIDTHS[key] || 60;
  }

  function handleResizeStart(e, key) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = getColWidth(key);
    resizing.current = { key, startX, startW };

    function onMove(ev) {
      if (!resizing.current) return;
      const diff = ev.clientX - resizing.current.startX;
      const newW = Math.max(40, resizing.current.startW + diff);
      setColWidths(prev => ({ ...prev, [resizing.current.key]: newW }));
    }
    function onUp() {
      resizing.current = null;
      setColWidths(prev => {
        localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(prev));
        return prev;
      });
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Index rows first so we can track original position through filter/sort
  const indexed = rows.map((row, i) => ({ row, origIdx: i }));

  const filtered = search
    ? indexed.filter(({ row }) =>
        (row.ingredient || '').toLowerCase().includes(search.toLowerCase())
      )
    : indexed;

  const sorted = sortKey !== null
    ? [...filtered].sort((a, b) => {
        const aVal = (a.row[sortKey] || '').trim();
        const bVal = (b.row[sortKey] || '').trim();
        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortAsc ? aNum - bNum : bNum - aNum;
        }
        return sortAsc
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      })
    : filtered;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>
          &larr; Back
        </button>
        <h2 className={styles.title}>Ingredients Database</h2>
        <span className={styles.count}>{sorted.length} ingredients</span>
      </div>

      <input
        className={styles.search}
        type="text"
        placeholder="Search ingredients..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {loading && <p className={styles.loading}>Loading ingredients...</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {DISPLAY_KEYS.map(key => {
                  const field = FIELD_MAP[key];
                  return (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      className={sortKey === key ? styles.sortedTh : ''}
                      style={{ width: getColWidth(key), minWidth: getColWidth(key) }}
                    >
                      {field.label}
                      {sortKey === key && (
                        <span className={styles.sortArrow}>
                          {sortAsc ? ' \u25B2' : ' \u25BC'}
                        </span>
                      )}
                      <span
                        className={styles.resizeHandle}
                        onMouseDown={e => handleResizeStart(e, key)}
                      />
                    </th>
                  );
                })}
                <th className={styles.actionTh} />
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ row, origIdx }) => (
                <tr key={origIdx}>
                  {DISPLAY_KEYS.map(key => (
                    <td key={key} style={{ width: getColWidth(key), minWidth: getColWidth(key) }}>
                      <input
                        className={styles.cellInput}
                        style={{ maxWidth: 'none' }}
                        value={row[key] || ''}
                        onChange={e => updateField(origIdx, key, e.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeRow(origIdx)}
                      title="Remove ingredient"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && (
        <button className={styles.addBtn} onClick={addRow}>
          + Add ingredient
        </button>
      )}
    </div>
  );
}
