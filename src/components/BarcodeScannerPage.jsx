import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { lookupBarcodeFullNutrition } from '../utils/openFoodFacts';
import {
  INGREDIENT_FIELDS,
  loadIngredients,
  loadIngredientsFromFirestore,
  saveIngredientsToFirestore,
} from '../utils/ingredientsStore';
import styles from './BarcodeScannerPage.module.css';

const READER_ID = 'ingredient-barcode-reader';

const SECTIONS = [
  {
    label: 'Basic Info',
    fields: ['ingredient', 'grams', 'measurement'],
  },
  {
    label: 'Macronutrients',
    fields: ['calories', 'protein', 'carbs', 'fat', 'saturatedFat', 'fiber'],
  },
  {
    label: 'Sugars',
    fields: ['sugar', 'addedSugar'],
  },
  {
    label: 'Minerals',
    fields: ['sodium', 'potassium', 'calcium', 'magnesium', 'iron', 'zinc'],
  },
  {
    label: 'Vitamins',
    fields: ['vitaminB12', 'vitaminC'],
  },
  {
    label: 'Other Nutrients',
    fields: ['leucine', 'omega3', 'proteinPerCal', 'fiberPerCal'],
  },
  {
    label: 'Details',
    fields: ['processed', 'notes', 'link', 'lastBought', 'storage', 'minShelf', 'maxShelf'],
  },
];

const FIELD_MAP = Object.fromEntries(INGREDIENT_FIELDS.map(f => [f.key, f]));

export function BarcodeScannerPage({ onClose, user }) {
  const [mode, setMode] = useState('barcode'); // barcode | photo
  const [phase, setPhase] = useState('scanning'); // scanning | loading | photo | editor | success
  const [status, setStatus] = useState('Point camera at a barcode');
  const [error, setError] = useState(null);
  const [ingredient, setIngredient] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [existingNames, setExistingNames] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoBase64, setPhotoBase64] = useState(null);
  const scannerRef = useRef(null);
  const processingRef = useRef(false);
  const nameInputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load existing ingredient names for autocomplete
  useEffect(() => {
    async function load() {
      const data = await loadIngredientsFromFirestore() || loadIngredients() || [];
      setExistingNames(data.map(r => r.ingredient || '').filter(Boolean));
    }
    load();
  }, []);

  const startScanner = useCallback(async () => {
    setError(null);
    setStatus('Starting camera...');
    processingRef.current = false;

    try {
      const scanner = new Html5Qrcode(READER_ID);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        handleScan,
        () => {}
      );
      setStatus('Point camera at a barcode');
    } catch {
      setError('Camera access denied. Please allow camera permission and try again.');
      setStatus('');
    }
  }, []);

  async function handleScan(decodedText) {
    if (processingRef.current) return;
    processingRef.current = true;
    setPhase('loading');
    setStatus('Looking up product...');
    setError(null);

    try {
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop();
      }
    } catch { /* already stopped */ }

    try {
      const result = await lookupBarcodeFullNutrition(decodedText);
      if (result) {
        setIngredient(result);
        setPhase('editor');
      } else {
        setError(`Product not found for barcode: ${decodedText}`);
        setPhase('scanning');
      }
    } catch {
      setError('Network error. Check your connection and try again.');
      setPhase('scanning');
    }
  }

  async function handleRetry() {
    setError(null);
    setPhase('scanning');
    await startScanner();
  }

  useEffect(() => {
    if (phase === 'scanning' && mode === 'barcode') {
      startScanner();
    }
    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, [phase, mode, startScanner]);

  function updateField(key, value) {
    setIngredient(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!ingredient?.ingredient?.trim()) return;
    setSaving(true);
    setSaveError(null);

    try {
      const existing = await loadIngredientsFromFirestore() || loadIngredients() || [];

      // Duplicate check
      const newName = ingredient.ingredient.trim().toLowerCase();
      const duplicate = existing.find(
        r => (r.ingredient || '').trim().toLowerCase() === newName
      );
      if (duplicate) {
        setSaveError(`An ingredient named "${ingredient.ingredient}" already exists.`);
        setSaving(false);
        return;
      }

      // Build clean row with all fields
      const row = {};
      for (const f of INGREDIENT_FIELDS) {
        row[f.key] = ingredient[f.key] || '';
      }

      const updated = [...existing, row];
      await saveIngredientsToFirestore(updated);
      setPhase('success');
    } catch (err) {
      setSaveError('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleScanAnother() {
    setIngredient(null);
    setSaveError(null);
    setError(null);
    setPhotoPreview(null);
    setPhotoBase64(null);
    if (mode === 'barcode') {
      setPhase('scanning');
    } else {
      setPhase('photo');
    }
  }

  function switchMode(newMode) {
    // Stop barcode scanner if switching away
    if (scannerRef.current?.isScanning) {
      scannerRef.current.stop().catch(() => {});
    }
    setMode(newMode);
    setError(null);
    setIngredient(null);
    setSaveError(null);
    setPhotoPreview(null);
    setPhotoBase64(null);
    setPhase(newMode === 'barcode' ? 'scanning' : 'photo');
  }

  function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    // Resize image to stay under Vercel's 4.5 MB body limit
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const MAX_DIM = 1200;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const scale = MAX_DIM / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      setPhotoPreview(dataUrl);
      setPhotoBase64(dataUrl);
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  }

  async function handleExtractNutrition() {
    if (!photoBase64) return;
    setPhase('loading');
    setStatus('Reading nutrition label...');
    setError(null);

    try {
      const res = await fetch('/api/parse-nutrition-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: photoBase64 }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error: ${res.status}`);
      }

      const data = await res.json();
      setIngredient(data);
      setPhase('editor');
    } catch (err) {
      setError(err.message || 'Failed to read nutrition label');
      setPhase('photo');
    }
  }

  // Autocomplete filtering
  const query = ingredient?.ingredient?.trim().toLowerCase() || '';
  const suggestions = query
    ? existingNames.filter(n => n.toLowerCase().includes(query)).slice(0, 8)
    : [];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>&larr; Back</button>
        <h2 className={styles.title}>Scan Ingredient</h2>
      </div>

      {/* MODE TOGGLE */}
      {(phase === 'scanning' || phase === 'photo' || phase === 'loading') && (
        <div className={styles.tabToggle}>
          <button
            className={`${styles.tabBtn} ${mode === 'barcode' ? styles.tabBtnActive : ''}`}
            onClick={() => switchMode('barcode')}
          >
            Scan Barcode
          </button>
          <button
            className={`${styles.tabBtn} ${mode === 'photo' ? styles.tabBtnActive : ''}`}
            onClick={() => switchMode('photo')}
          >
            Upload Photo
          </button>
        </div>
      )}

      {/* PHOTO UPLOAD PHASE */}
      {phase === 'photo' && (
        <div className={styles.photoSection}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className={styles.fileInput}
            onChange={handlePhotoSelect}
          />
          <button
            className={styles.photoSelectBtn}
            onClick={() => fileInputRef.current?.click()}
          >
            {photoPreview ? 'Change Photo' : 'Take Photo / Choose File'}
          </button>

          {photoPreview && (
            <img src={photoPreview} alt="Nutrition label preview" className={styles.photoPreview} />
          )}

          {error && <span className={styles.error}>{error}</span>}

          {photoPreview && (
            <button className={styles.extractBtn} onClick={handleExtractNutrition}>
              Extract Nutrition
            </button>
          )}
        </div>
      )}

      {/* LOADING (photo mode) */}
      {phase === 'loading' && mode === 'photo' && (
        <div className={styles.photoSection}>
          <span className={styles.status}>Reading nutrition label...</span>
        </div>
      )}

      {/* SCANNING PHASE (barcode mode) */}
      {(phase === 'scanning' || (phase === 'loading' && mode === 'barcode')) && (
        <div className={styles.scannerSection}>
          <div id={READER_ID} className={styles.reader} />
          <div className={styles.scannerFooter}>
            {phase === 'loading' && (
              <span className={styles.status}>Looking up product...</span>
            )}
            {phase === 'scanning' && status && !error && (
              <span className={styles.status}>{status}</span>
            )}
            {error && (
              <>
                <span className={styles.error}>{error}</span>
                <button className={styles.retryBtn} onClick={handleRetry}>Retry</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* EDITOR PHASE */}
      {phase === 'editor' && ingredient && (
        <div className={styles.editorSection}>
          {SECTIONS.map(section => (
            <fieldset key={section.label} className={styles.fieldset}>
              <legend className={styles.legend}>{section.label}</legend>
              {section.fields.map(key => {
                const field = FIELD_MAP[key];
                if (!field) return null;

                if (key === 'ingredient') {
                  return (
                    <div key={key} className={styles.fieldRow}>
                      <label className={styles.fieldLabel}>{field.label}</label>
                      <div className={styles.autocompleteWrap}>
                        <input
                          ref={nameInputRef}
                          className={styles.fieldInput}
                          value={ingredient[key] || ''}
                          onChange={e => {
                            updateField(key, e.target.value);
                            setShowSuggestions(true);
                          }}
                          onFocus={() => setShowSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                        />
                        {showSuggestions && suggestions.length > 0 && (
                          <ul className={styles.suggestions}>
                            {suggestions.map(name => (
                              <li
                                key={name}
                                className={styles.suggestionItem}
                                onMouseDown={() => {
                                  updateField(key, name);
                                  setShowSuggestions(false);
                                }}
                              >
                                {name}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  );
                }

                const isEmpty = !(ingredient[key] || '').trim();
                return (
                  <div key={key} className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>{field.label}</label>
                    <input
                      className={isEmpty ? styles.fieldInputEmpty : styles.fieldInput}
                      value={ingredient[key] || ''}
                      placeholder={isEmpty ? 'Missing' : ''}
                      onChange={e => updateField(key, e.target.value)}
                      inputMode={
                        ['grams','protein','carbs','fat','sugar','sodium','potassium',
                         'vitaminB12','vitaminC','magnesium','fiber','zinc','iron',
                         'calcium','calories','addedSugar','saturatedFat','leucine',
                         'omega3','proteinPerCal','fiberPerCal','minShelf','maxShelf'
                        ].includes(key) ? 'decimal' : undefined
                      }
                    />
                  </div>
                );
              })}
            </fieldset>
          ))}

          {saveError && <p className={styles.saveError}>{saveError}</p>}

          <div className={styles.editorActions}>
            <button className={styles.cancelBtn} onClick={handleScanAnother}>Cancel</button>
            <button
              className={styles.saveBtn}
              onClick={handleSave}
              disabled={saving || !ingredient.ingredient?.trim()}
            >
              {saving ? 'Saving...' : 'Save Ingredient'}
            </button>
          </div>
        </div>
      )}

      {/* SUCCESS PHASE */}
      {phase === 'success' && (
        <div className={styles.successSection}>
          <div className={styles.successIcon}>&#10003;</div>
          <h3>Saved!</h3>
          <p>Ingredient added to your database.</p>
          <button className={styles.scanAnotherBtn} onClick={handleScanAnother}>
            Scan Another
          </button>
        </div>
      )}
    </div>
  );
}
