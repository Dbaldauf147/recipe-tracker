import React, { useState } from 'react';
import { INGREDIENT_FIELDS } from '../utils/ingredientsStore.js';
import { searchUSDA, usdaNutrients, fmtVal } from '../utils/usda.js';
import styles from './IngredientsPage.module.css';

const MANUAL_FIELDS = [
  { key: 'ingredient', label: 'Ingredient Name', type: 'text', required: true },
  { key: 'brand', label: 'Brand (optional)', type: 'text', placeholder: 'e.g. Siggi\'s, Chobani' },
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

/**
 * Manual ingredient entry form in a modal. `onAdd` receives a full
 * INGREDIENT_FIELDS row (every key present, derived per-cal ratios filled in).
 *
 * With `showUSDALookup`, a search bar sits above the form: picking a result
 * fills the nutrition fields with USDA per-100g values but keeps whatever name
 * the caller prefilled, so the row still matches the recipe's ingredient.
 */
export function ManualIngredientModal({ onAdd, onClose, initialValues, title, hint, showUSDALookup = false, submitLabel }) {
  const [values, setValues] = useState(initialValues || {});
  const [usdaQuery, setUsdaQuery] = useState((initialValues?.ingredient || '').trim());
  const [usdaResults, setUsdaResults] = useState([]);
  const [usdaLoading, setUsdaLoading] = useState(false);
  const [usdaError, setUsdaError] = useState(null);

  function handleChange(key, val) {
    setValues(prev => ({ ...prev, [key]: val }));
  }

  async function handleUSDASearch() {
    if (!usdaQuery.trim()) return;
    setUsdaLoading(true);
    setUsdaError(null);
    setUsdaResults([]);
    try {
      const foods = await searchUSDA(usdaQuery.trim());
      if (foods.length === 0) setUsdaError('No results found. Try a different search term.');
      else setUsdaResults(foods);
    } catch (err) {
      setUsdaError(err.message || 'USDA search failed.');
    }
    setUsdaLoading(false);
  }

  // Fill nutrition from a USDA hit. The name stays as-is — it is the key the
  // recipe row matches on — and grams/measurement only fill when still blank.
  function handleUSDAPick(food) {
    const nutrients = usdaNutrients(food);
    setValues(prev => ({
      ...prev,
      ...nutrients,
      grams: prev.grams || '100',
      measurement: prev.measurement || 'g',
      notes: prev.notes || `USDA: ${food.description}`,
    }));
    setUsdaResults([]);
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
          <h3>{title || 'Manual Entry'}</h3>
          <button className={styles.modalCloseBtn} onClick={onClose}>&times;</button>
        </div>
        <form className={styles.manualForm} onSubmit={handleSubmit}>
          {/* Everything you act on — the lookup that fills the form and the
              button that commits it — is pinned in a bar under the header, and
              only the field grid scrolls. Submit used to be at the very bottom,
              twenty fields below the USDA hit that had just filled them in. */}
          <div className={styles.manualTopBar}>
          {hint && <p className={styles.modalHint}>{hint}</p>}
          {showUSDALookup && (
            <>
              <div className={styles.usdaSearchRow}>
                <input
                  className={styles.usdaSearchInput}
                  type="text"
                  placeholder="Look up nutrition in USDA..."
                  value={usdaQuery}
                  onChange={e => setUsdaQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleUSDASearch(); } }}
                />
                <button
                  className={styles.usdaSearchBtn}
                  type="button"
                  onClick={handleUSDASearch}
                  disabled={usdaLoading || !usdaQuery.trim()}
                >
                  {usdaLoading ? 'Searching...' : 'Search'}
                </button>
              </div>
              {usdaError && <p className={styles.modalError}>{usdaError}</p>}
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
            </>
          )}
            <button className={styles.photoSubmitBtn} type="submit" disabled={!values.ingredient?.trim()}>
              {submitLabel || 'Add Ingredient'}
            </button>
          </div>

          <div className={styles.manualScroll}>
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
          </div>
        </form>
      </div>
    </div>
  );
}
