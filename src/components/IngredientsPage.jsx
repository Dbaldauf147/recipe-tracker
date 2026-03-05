import { useState, useEffect, useCallback, useRef } from 'react';
import {
  INGREDIENT_FIELDS,
  loadIngredients,
  fetchAndSeedIngredients,
  loadIngredientsFromFirestore,
  saveIngredientsToFirestore,
  applyGramsData,
} from '../utils/ingredientsStore.js';
import { lookupBarcodeFullNutrition } from '../utils/openFoodFacts.js';
import { BarcodeScanner } from './BarcodeScanner.jsx';
import styles from './IngredientsPage.module.css';

const ADMIN_UID = import.meta.env.VITE_ADMIN_UID;

// Display order of columns (by field key)
const DISPLAY_KEYS = [
  'ingredient', 'grams', 'measurement', 'calories', 'protein', 'carbs', 'fat',
  'fiber', 'sugar', 'saturatedFat', 'addedSugar', 'sodium', 'potassium',
  'vitaminB12', 'vitaminC', 'magnesium', 'zinc', 'iron', 'calcium',
  'leucine', 'omega3', 'proteinPerCal', 'fiberPerCal', 'notes',
  'lastBought', 'storage', 'minShelf', 'maxShelf', 'processed', 'link',
];

const FIELD_MAP = Object.fromEntries(INGREDIENT_FIELDS.map(f => [f.key, f]));

const USDA_API_KEY = import.meta.env.VITE_USDA_API_KEY || 'DEMO_KEY';
const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

// Nutrient IDs for extracting per-100g values from USDA results
const USDA_NUTRIENT_IDS = {
  calories: 1008, protein: 1003, carbs: 1005, fat: 1004,
  saturatedFat: 1258, sugar: 2000, addedSugar: 1235, fiber: 1079,
  sodium: 1093, potassium: 1092, calcium: 1087, iron: 1089,
  magnesium: 1090, zinc: 1095, vitaminB12: 1178, vitaminC: 1162,
  leucine: 1213, omega3: 1404,
};

function fmtVal(val) {
  if (val == null || val === 0) return '';
  const s = String(Math.round(val * 100) / 100);
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

const COL_WIDTHS_KEY = 'sunday-ingredients-col-widths';
const DEFAULT_WIDTHS = { ingredient: 140, measurement: 70, notes: 100, link: 80, storage: 70 };

function loadColWidths() {
  try {
    const saved = localStorage.getItem(COL_WIDTHS_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch { return {}; }
}

const MANUAL_FIELDS = [
  { key: 'ingredient', label: 'Ingredient Name', type: 'text', required: true },
  { key: 'grams', label: 'Serving Size (g)', type: 'number' },
  { key: 'measurement', label: 'Measurement', type: 'text', placeholder: 'e.g. cup, oz, piece' },
  { key: 'calories', label: 'Calories', type: 'number' },
  { key: 'protein', label: 'Protein (g)', type: 'number' },
  { key: 'carbs', label: 'Carbs (g)', type: 'number' },
  { key: 'fat', label: 'Fat (g)', type: 'number' },
  { key: 'fiber', label: 'Fiber (g)', type: 'number' },
  { key: 'sugar', label: 'Sugar (g)', type: 'number' },
  { key: 'saturatedFat', label: 'Saturated Fat (g)', type: 'number' },
  { key: 'sodium', label: 'Sodium (mg)', type: 'number' },
  { key: 'potassium', label: 'Potassium (mg)', type: 'number' },
  { key: 'calcium', label: 'Calcium (mg)', type: 'number' },
  { key: 'iron', label: 'Iron (mg)', type: 'number' },
  { key: 'magnesium', label: 'Magnesium (mg)', type: 'number' },
  { key: 'zinc', label: 'Zinc (mg)', type: 'number' },
  { key: 'vitaminB12', label: 'Vitamin B12 (mcg)', type: 'number' },
  { key: 'vitaminC', label: 'Vitamin C (mg)', type: 'number' },
  { key: 'leucine', label: 'Leucine (g)', type: 'number' },
  { key: 'omega3', label: 'Omega-3 (g)', type: 'number' },
  { key: 'notes', label: 'Notes', type: 'text' },
];

function ManualAddModal({ onAdd, onClose }) {
  const [values, setValues] = useState({});

  function handleChange(key, val) {
    setValues(prev => ({ ...prev, [key]: val }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!values.ingredient?.trim()) return;
    const row = {};
    for (const f of INGREDIENT_FIELDS) row[f.key] = values[f.key] || '';
    // Compute derived fields
    const cal = parseFloat(row.calories) || 0;
    const prot = parseFloat(row.protein) || 0;
    const fib = parseFloat(row.fiber) || 0;
    if (cal > 0) {
      row.proteinPerCal = fmtVal(prot / cal);
      row.fiberPerCal = fmtVal(fib / cal);
    }
    onAdd(row);
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.addModal} onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className={styles.modalHeader}>
          <h3>Manual Entry</h3>
          <button className={styles.modalCloseBtn} onClick={onClose}>&times;</button>
        </div>
        <form className={styles.modalBody} onSubmit={handleSubmit}>
          <div className={styles.manualGrid}>
            {MANUAL_FIELDS.map(f => (
              <div key={f.key} className={f.key === 'ingredient' || f.key === 'notes' ? styles.manualFieldFull : styles.manualField}>
                <label className={styles.manualLabel}>{f.label}</label>
                <input
                  className={styles.manualInput}
                  type={f.type}
                  value={values[f.key] || ''}
                  onChange={e => handleChange(f.key, e.target.value)}
                  placeholder={f.placeholder || ''}
                  required={f.required}
                  step={f.type === 'number' ? 'any' : undefined}
                  min={f.type === 'number' ? '0' : undefined}
                  autoFocus={f.key === 'ingredient'}
                />
              </div>
            ))}
          </div>
          <button className={styles.photoSubmitBtn} type="submit" disabled={!values.ingredient?.trim()}>
            Add Ingredient
          </button>
        </form>
      </div>
    </div>
  );
}

export function IngredientsPage({ onClose, user }) {
  const isAdmin = user?.uid === ADMIN_UID;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [colWidths, setColWidths] = useState(loadColWidths);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const [showUSDASearch, setShowUSDASearch] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState(null);
  // Photo flow
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);
  const [photoBase64, setPhotoBase64] = useState(null);
  const photoInputRef = useRef(null);
  // USDA flow
  const [usdaQuery, setUsdaQuery] = useState('');
  const [usdaResults, setUsdaResults] = useState([]);
  const resizing = useRef(null);
  const addMenuRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      // 1. Show localStorage cache immediately
      const cached = loadIngredients();
      if (cached && cached.length > 0) {
        setRows(cached);
        setLoading(false);
      }

      // 2. Fetch latest from Firestore
      const firestoreData = await loadIngredientsFromFirestore();
      if (cancelled) return;

      let data = null;
      if (firestoreData && firestoreData.length > 0) {
        data = firestoreData;
      } else if (!cached || cached.length === 0) {
        // 3. If Firestore had nothing and no cache, seed from CSV
        try {
          data = await fetchAndSeedIngredients();
          if (cancelled) return;
        } catch {
          if (!cancelled) setError('Failed to load ingredients data.');
        }
      } else {
        data = cached;
      }

      if (data) {
        // Apply researched grams data for any empty grams fields
        const withGrams = applyGramsData(data);
        setRows(withGrams);
        if (isAdmin && withGrams !== data) {
          saveIngredientsToFirestore(withGrams);
        } else if (isAdmin && !firestoreData) {
          saveIngredientsToFirestore(data);
        }
      }

      if (!cancelled) setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, []);

  const updateField = useCallback((origIdx, key, value) => {
    setRows(prev => {
      const updated = prev.map((row, i) =>
        i === origIdx ? { ...row, [key]: value } : row
      );
      saveIngredientsToFirestore(updated);
      return updated;
    });
  }, []);

  const addRow = useCallback(() => {
    setRows(prev => {
      const empty = {};
      for (const f of INGREDIENT_FIELDS) empty[f.key] = '';
      const updated = [...prev, empty];
      saveIngredientsToFirestore(updated);
      return updated;
    });
  }, []);

  const removeRow = useCallback((origIdx) => {
    setRows(prev => {
      const updated = prev.filter((_, i) => i !== origIdx);
      saveIngredientsToFirestore(updated);
      return updated;
    });
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showAddMenu) return;
    function handleClickOutside(e) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) {
        setShowAddMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAddMenu]);

  // Helper: append a pre-filled row
  const addFilledRow = useCallback((data) => {
    setRows(prev => {
      const row = {};
      for (const f of INGREDIENT_FIELDS) row[f.key] = data[f.key] || '';
      const updated = [...prev, row];
      saveIngredientsToFirestore(updated);
      return updated;
    });
  }, []);

  // --- Barcode flow ---
  const handleBarcodeScan = useCallback(async (barcode) => {
    setShowBarcodeScanner(false);
    setModalLoading(true);
    setModalError(null);
    try {
      const result = await lookupBarcodeFullNutrition(barcode);
      if (result) {
        addFilledRow(result);
      } else {
        setModalError(`Product not found for barcode: ${barcode}`);
      }
    } catch {
      setModalError('Failed to look up barcode. Check your connection.');
    }
    setModalLoading(false);
  }, [addFilledRow]);

  // --- Photo flow ---
  function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const img = new Image();
    const reader = new FileReader();
    reader.onload = (ev) => {
      img.onload = () => {
        // Resize to max 1200px, JPEG 80%
        const maxDim = 1200;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const base64 = canvas.toDataURL('image/jpeg', 0.8);
        setPhotoPreviewUrl(base64);
        setPhotoBase64(base64);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function handlePhotoSubmit() {
    if (!photoBase64) return;
    setModalLoading(true);
    setModalError(null);
    try {
      const res = await fetch('/api/parse-nutrition-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: photoBase64 }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // Compute proteinPerCal / fiberPerCal if not provided
      const cal = parseFloat(data.calories) || 0;
      const prot = parseFloat(data.protein) || 0;
      const fib = parseFloat(data.fiber) || 0;
      if (!data.proteinPerCal && cal > 0) data.proteinPerCal = fmtVal(prot / cal);
      if (!data.fiberPerCal && cal > 0) data.fiberPerCal = fmtVal(fib / cal);
      addFilledRow(data);
      setShowPhotoUpload(false);
      setPhotoPreviewUrl(null);
      setPhotoBase64(null);
    } catch (err) {
      setModalError(err.message || 'Failed to parse nutrition label.');
    }
    setModalLoading(false);
  }

  // --- USDA flow ---
  async function handleUSDASearch(e) {
    e?.preventDefault();
    if (!usdaQuery.trim()) return;
    setModalLoading(true);
    setModalError(null);
    setUsdaResults([]);
    try {
      const url = `${USDA_SEARCH_URL}?api_key=${USDA_API_KEY}&query=${encodeURIComponent(usdaQuery)}&pageSize=5&dataType=Foundation,SR%20Legacy`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`USDA API error: ${res.status}`);
      const data = await res.json();
      if (!data.foods || data.foods.length === 0) {
        setModalError('No results found. Try a different search term.');
      } else {
        setUsdaResults(data.foods);
      }
    } catch (err) {
      setModalError(err.message || 'USDA search failed.');
    }
    setModalLoading(false);
  }

  function handleUSDAPick(food) {
    // Extract per-100g nutrients
    const row = {};
    for (const f of INGREDIENT_FIELDS) row[f.key] = '';
    row.ingredient = food.description;
    row.grams = '100';
    row.measurement = 'g';

    const nutrients = food.foodNutrients || [];
    for (const [key, nid] of Object.entries(USDA_NUTRIENT_IDS)) {
      const match = nutrients.find(fn => fn.nutrientId === nid);
      if (match) row[key] = fmtVal(match.value);
    }

    // Compute derived fields
    const cal = parseFloat(row.calories) || 0;
    const prot = parseFloat(row.protein) || 0;
    const fib = parseFloat(row.fiber) || 0;
    if (cal > 0) {
      row.proteinPerCal = fmtVal(prot / cal);
      row.fiberPerCal = fmtVal(fib / cal);
    }

    addFilledRow(row);
    setShowUSDASearch(false);
    setUsdaQuery('');
    setUsdaResults([]);
  }

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

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          type="text"
          placeholder="Search ingredients..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {!loading && !error && isAdmin && (
          <div className={styles.addMenuWrap} ref={addMenuRef}>
            <button className={styles.addBtn} onClick={() => setShowAddMenu(v => !v)}>
              + Add ingredient &#9662;
            </button>
            {showAddMenu && (
              <div className={styles.addMenu}>
                <button className={styles.addMenuItem} onClick={() => { setShowAddMenu(false); setShowBarcodeScanner(true); }}>
                  <span className={styles.addMenuIcon}>&#128247;</span> Scan barcode
                </button>
                <button className={styles.addMenuItem} onClick={() => { setShowAddMenu(false); setShowPhotoUpload(true); setModalError(null); }}>
                  <span className={styles.addMenuIcon}>&#128248;</span> Photo nutrition label
                </button>
                <button className={styles.addMenuItem} onClick={() => { setShowAddMenu(false); setShowUSDASearch(true); setModalError(null); setUsdaResults([]); setUsdaQuery(''); }}>
                  <span className={styles.addMenuIcon}>&#128269;</span> Search USDA
                </button>
                <button className={styles.addMenuItem} onClick={() => { setShowAddMenu(false); setShowManualAdd(true); setModalError(null); }}>
                  <span className={styles.addMenuIcon}>&#9998;</span> Manual entry
                </button>
                <button className={styles.addMenuItem} onClick={() => { setShowAddMenu(false); addRow(); }}>
                  <span className={styles.addMenuIcon}>&#43;</span> Blank row
                </button>
              </div>
            )}
          </div>
        )}
      </div>

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
                      {isAdmin ? (
                        <input
                          className={styles.cellInput}
                          style={{ maxWidth: 'none' }}
                          value={row[key] || ''}
                          onChange={e => updateField(origIdx, key, e.target.value)}
                          onBlur={key === 'grams' ? e => {
                            const num = parseFloat(e.target.value);
                            if (!isNaN(num)) updateField(origIdx, key, String(Math.round(num)));
                          } : (key === 'proteinPerCal' || key === 'fiberPerCal') ? e => {
                            const num = parseFloat(e.target.value);
                            if (!isNaN(num)) updateField(origIdx, key, String(parseFloat(num.toFixed(3))));
                          } : undefined}
                        />
                      ) : (
                        <span className={styles.cellText}>
                          {key === 'grams' && row[key] ? String(Math.round(parseFloat(row[key])) || row[key]) : (key === 'proteinPerCal' || key === 'fiberPerCal') && row[key] ? String(parseFloat(parseFloat(row[key]).toFixed(3)) || row[key]) : (row[key] || '')}
                        </span>
                      )}
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

      {/* Loading overlay for barcode lookup */}
      {modalLoading && !showPhotoUpload && !showUSDASearch && (
        <div className={styles.modalOverlay}>
          <div className={styles.addModal}>
            <div className={styles.modalBody}>
              <p className={styles.modalStatus}>Looking up nutrition data...</p>
            </div>
          </div>
        </div>
      )}

      {/* Inline error toast for barcode failures */}
      {modalError && !showPhotoUpload && !showUSDASearch && !showBarcodeScanner && (
        <div className={styles.modalOverlay} onClick={() => setModalError(null)}>
          <div className={styles.addModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Error</h3>
              <button className={styles.modalCloseBtn} onClick={() => setModalError(null)}>&times;</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.modalError}>{modalError}</p>
            </div>
          </div>
        </div>
      )}

      {/* Barcode scanner modal */}
      {showBarcodeScanner && (
        <BarcodeScanner
          onScan={handleBarcodeScan}
          onResult={() => {}}
          onClose={() => setShowBarcodeScanner(false)}
        />
      )}

      {/* Photo upload modal */}
      {showPhotoUpload && (
        <div className={styles.modalOverlay} onClick={() => { setShowPhotoUpload(false); setPhotoPreviewUrl(null); setPhotoBase64(null); setModalError(null); }}>
          <div className={styles.addModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Photo Nutrition Label</h3>
              <button className={styles.modalCloseBtn} onClick={() => { setShowPhotoUpload(false); setPhotoPreviewUrl(null); setPhotoBase64(null); setModalError(null); }}>&times;</button>
            </div>
            <div className={styles.modalBody}>
              {!photoPreviewUrl ? (
                <div className={styles.photoDropzone} onClick={() => photoInputRef.current?.click()}>
                  <p>Tap to take a photo or choose an image</p>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={handlePhotoSelect}
                  />
                </div>
              ) : (
                <>
                  <img src={photoPreviewUrl} alt="Label preview" className={styles.photoPreview} />
                  <button
                    className={styles.photoSubmitBtn}
                    onClick={handlePhotoSubmit}
                    disabled={modalLoading}
                  >
                    {modalLoading ? 'Analyzing...' : 'Parse Nutrition Label'}
                  </button>
                </>
              )}
              {modalError && <p className={styles.modalError}>{modalError}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Manual entry modal */}
      {showManualAdd && (
        <ManualAddModal
          onAdd={(data) => { addFilledRow(data); setShowManualAdd(false); }}
          onClose={() => setShowManualAdd(false)}
        />
      )}

      {/* USDA search modal */}
      {showUSDASearch && (
        <div className={styles.modalOverlay} onClick={() => { setShowUSDASearch(false); setUsdaQuery(''); setUsdaResults([]); setModalError(null); }}>
          <div className={styles.addModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Search USDA Database</h3>
              <button className={styles.modalCloseBtn} onClick={() => { setShowUSDASearch(false); setUsdaQuery(''); setUsdaResults([]); setModalError(null); }}>&times;</button>
            </div>
            <div className={styles.modalBody}>
              <form className={styles.usdaSearchRow} onSubmit={handleUSDASearch}>
                <input
                  className={styles.usdaSearchInput}
                  type="text"
                  placeholder="e.g. chicken breast, oats..."
                  value={usdaQuery}
                  onChange={e => setUsdaQuery(e.target.value)}
                  autoFocus
                />
                <button className={styles.usdaSearchBtn} type="submit" disabled={modalLoading || !usdaQuery.trim()}>
                  {modalLoading ? 'Searching...' : 'Search'}
                </button>
              </form>
              {modalError && <p className={styles.modalError}>{modalError}</p>}
              {usdaResults.length > 0 && (
                <ul className={styles.usdaResults}>
                  {usdaResults.map(food => {
                    const cal = food.foodNutrients?.find(n => n.nutrientId === 1008)?.value || 0;
                    const prot = food.foodNutrients?.find(n => n.nutrientId === 1003)?.value || 0;
                    return (
                      <li key={food.fdcId} className={styles.usdaResultItem} onClick={() => handleUSDAPick(food)}>
                        <span className={styles.usdaResultName}>{food.description}</span>
                        <span className={styles.usdaResultMeta}>
                          {food.dataType} &middot; {Math.round(cal)} cal &middot; {fmtVal(prot)}g protein (per 100g)
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
