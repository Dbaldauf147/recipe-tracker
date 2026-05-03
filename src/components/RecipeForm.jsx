import { useState, useEffect } from 'react';
import { BarcodeScanner } from './BarcodeScanner';
import { loadIngredients, loadIngredientsFromFirestore } from '../utils/ingredientsStore';
import { classifyMealType } from '../utils/classifyMealType';
import { parseIngredientLine } from '../utils/parseRecipeText';
import styles from './RecipeForm.module.css';

const emptyRow = { quantity: '', measurement: '', ingredient: '' };
const fields = ['quantity', 'measurement', 'ingredient'];

const HEADER_KEYWORDS = {
  quantity: ['quantity', 'qty', 'amount'],
  measurement: ['measurement', 'unit', 'units'],
  ingredient: ['ingredient', 'ingredients', 'name', 'item'],
};

function splitPasteToCells(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.split('\t'));
}

function detectColumnMap(text) {
  const lines = splitPasteToCells(text);
  if (lines.length === 0) return { ncols: 0, hasHeader: false, map: {} };
  const ncols = Math.max(...lines.map(l => l.length));
  const map = {};
  for (let i = 0; i < ncols; i++) map[i] = 'ignore';
  if (ncols < 2) return { ncols, hasHeader: false, map };

  const firstLine = (lines[0] || []).map(c => c.trim().toLowerCase());
  const matchHeader = c => {
    if (HEADER_KEYWORDS.quantity.includes(c)) return 'quantity';
    if (HEADER_KEYWORDS.measurement.includes(c)) return 'measurement';
    if (HEADER_KEYWORDS.ingredient.includes(c)) return 'ingredient';
    return null;
  };
  const hasHeader = firstLine.some(c => matchHeader(c) !== null);

  if (hasHeader) {
    firstLine.forEach((c, i) => {
      const m = matchHeader(c);
      if (m) map[i] = m;
    });
  } else if (ncols >= 3) {
    map[ncols - 3] = 'quantity';
    map[ncols - 2] = 'measurement';
    map[ncols - 1] = 'ingredient';
  } else if (ncols === 2) {
    map[0] = 'measurement';
    map[1] = 'ingredient';
  }
  return { ncols, hasHeader, map };
}

function cleanQuantity(q) {
  const t = (q || '').trim();
  if (/^-?\d+\.\d+$/.test(t)) {
    const n = parseFloat(t);
    if (!Number.isNaN(n)) return String(n);
  }
  return t;
}

function applyColumnMap(text, map, hasHeader) {
  const lines = splitPasteToCells(text);
  if (lines.length === 0) return [];
  const ncols = Math.max(...lines.map(l => l.length));
  const isTabular = ncols >= 2;
  const dataStart = isTabular && hasHeader ? 1 : 0;

  const rows = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cells = lines[i];
    if (isTabular) {
      const r = { quantity: '', measurement: '', ingredient: '' };
      for (const [colIdxStr, target] of Object.entries(map)) {
        if (target === 'ignore' || !target) continue;
        const val = (cells[Number(colIdxStr)] || '').trim();
        if (target === 'quantity') r.quantity = cleanQuantity(val);
        else if (target === 'measurement') r.measurement = val;
        else if (target === 'ingredient') r.ingredient = val;
      }
      if (!r.ingredient && !r.quantity) continue;
      rows.push(r);
    } else {
      const line = (cells[0] || '').trim();
      if (!line) continue;
      const parsed = parseIngredientLine(line);
      if (parsed) {
        rows.push({
          quantity: parsed.quantity || '',
          measurement: parsed.measurement || '',
          ingredient: parsed.ingredient || '',
        });
      }
    }
  }
  return rows;
}

export function RecipeForm({ recipe, onSave, onCancel, saveLabel, cancelLabel, headerAction, titleOverride }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('lunch-dinner');
  const [frequency, setFrequency] = useState('common');
  const [mealType, setMealType] = useState('');
  const [customMealType, setCustomMealType] = useState('');
  const [servings, setServings] = useState('1');
  const [prepTime, setPrepTime] = useState('');
  const [cookTime, setCookTime] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [ingredients, setIngredients] = useState([{ ...emptyRow }]);
  const [instructions, setInstructions] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [ingredientNames, setIngredientNames] = useState([]);
  const [activeAutoIdx, setActiveAutoIdx] = useState(-1);
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [columnMap, setColumnMap] = useState({});
  const [hasHeader, setHasHeader] = useState(false);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [imageError, setImageError] = useState('');

  useEffect(() => {
    async function loadNames() {
      const data = await loadIngredientsFromFirestore() || loadIngredients() || [];
      setIngredientNames(data.map(r => r.ingredient || '').filter(Boolean));
    }
    loadNames();
  }, []);

  useEffect(() => {
    if (recipe) {
      setTitle(recipe.title);
      setCategory(recipe.category || 'lunch-dinner');
      setFrequency(recipe.frequency || 'common');
      const type = recipe.mealType || '';
      const presets = ['meat', 'pescatarian', 'vegan', 'vegetarian', 'keto', ''];
      if (presets.includes(type)) {
        setMealType(type);
        setCustomMealType('');
      } else {
        setMealType('custom');
        setCustomMealType(type);
      }
      setServings(recipe.servings || '1');
      setPrepTime(recipe.prepTime || '');
      setCookTime(recipe.cookTime || '');
      setSourceUrl(recipe.sourceUrl || '');
      const validIngs = (recipe.ingredients || []).filter(ing => {
        const name = (ing.ingredient || '').trim();
        if (!name && !(ing.quantity || '').trim()) return false;
        // Filter out entries that are just symbols, hashtags, emojis, or non-food text
        if (/^[#@▪️▸►•*\-–—=~_|\\\/]+$/.test(name)) return false;
        if (/^#\w/.test(name)) return false; // hashtags like #healthy
        if (/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]+$/u.test(name)) return false; // emoji-only
        if (/^[^a-zA-Z0-9]*$/.test(name)) return false; // no letters or numbers at all
        return true;
      }).map(ing => ({
        ...ing,
        // Clean ingredient names: strip leading symbols/hashtags
        ingredient: (ing.ingredient || '').replace(/^[#▪️▸►•*\-–—]+\s*/, '').replace(/#\w+/g, '').trim(),
      }));
      setIngredients(
        validIngs.length > 0
          ? validIngs
          : [{ ...emptyRow }]
      );
      // Clean instructions: strip emoji numbered steps, hashtags, and trailing promo text
      const cleanedInstructions = (recipe.instructions || '')
        .split('\n')
        .map(line => line
          .replace(/^[1-9]\uFE0F?\u20E3\s*/, '') // emoji numbers like 1️⃣
          .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '') // all emojis
          .replace(/#\w+/g, '') // hashtags
          .trim()
        )
        .filter(line => line && !/^(For all recipes|Subscribe|Link in|Follow|DM me|Save this)/i.test(line))
        .filter(line => !/\b(comment\s+["'"].+["'"]|i['']ll\s+dm\s+you|dm\s+(me|you)|link\s+in\s+(bio|my\s+bio|profile)|follow\s+(me|for\s+more|@)|cookbook\s+with\s+\d+|save\s+this\s+(post|recipe|reel|video)|tag\s+(a\s+friend|someone)|check\s+out\s+my|grab\s+(my|the|your)\s+(free|ebook|guide|cookbook)|sign\s+up|free\s+(ebook|guide|download|pdf)|recipes?\s+just\s+like\s+this)\b/i.test(line))
        .join('\n');
      setInstructions(cleanedInstructions);
    }
  }, [recipe]);

  function updateIngredient(index, field, value) {
    setIngredients(prev =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  function addRow() {
    setIngredients(prev => [...prev, { ...emptyRow }]);
  }

  function removeRow(index) {
    setIngredients(prev => prev.filter((_, i) => i !== index));
  }

  function handleBarcodeScan(result) {
    setShowScanner(false);
    setIngredients(prev => [...prev, {
      quantity: result.quantity,
      measurement: result.measurement,
      ingredient: result.ingredient,
    }]);
  }

  function setPasteSource(text) {
    setPasteText(text);
    const detected = detectColumnMap(text);
    setColumnMap(detected.map);
    setHasHeader(detected.hasHeader);
    setImageError('');
  }

  async function processImage(blob) {
    if (!blob) return;
    setImageError('');
    setImageProcessing(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      const res = await fetch('/api/parse-recipe-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }
      const recipe = await res.json();
      const ingLines = (recipe.ingredients || []).map(s => String(s).trim()).filter(Boolean);
      if (ingLines.length === 0) {
        throw new Error("Couldn't read any ingredients from that image.");
      }
      setPasteSource(ingLines.join('\n'));
    } catch (err) {
      setImageError(err.message || 'Failed to read image');
    } finally {
      setImageProcessing(false);
    }
  }

  function handleIngredientsPaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find(it => it.type?.startsWith('image/'));
    if (imageItem) {
      const blob = imageItem.getAsFile();
      if (blob) {
        e.preventDefault();
        setPasteText('');
        setColumnMap({});
        setHasHeader(false);
        setShowPasteBox(true);
        processImage(blob);
        return;
      }
    }
    const text = e.clipboardData?.getData('text') || '';
    const isMultiRow = text.includes('\t') || text.split('\n').filter(l => l.trim()).length >= 2;
    if (!isMultiRow) return;
    e.preventDefault();
    setPasteSource(text);
    setShowPasteBox(true);
  }

  function applyPaste(mode) {
    const parsed = applyColumnMap(pasteText, columnMap, hasHeader);
    if (parsed.length === 0) {
      window.alert('No ingredient rows found. Check that at least one column is mapped to "Ingredient".');
      return;
    }
    setIngredients(prev => {
      if (mode === 'replace') return parsed;
      const existing = prev.filter(r => (r.ingredient || '').trim() !== '' || (r.quantity || '').trim() !== '');
      return [...existing, ...parsed];
    });
    setPasteText('');
    setColumnMap({});
    setHasHeader(false);
    setShowPasteBox(false);
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSave({
      title: title.trim(),
      category,
      frequency,
      mealType: (() => {
        const manual = mealType === 'custom' ? customMealType.trim() : mealType;
        if (manual) return manual;
        const ings = ingredients.filter(row => row.ingredient.trim() !== '');
        return classifyMealType(ings);
      })(),
      servings: servings.trim() || '1',
      prepTime: prepTime.trim(),
      cookTime: cookTime.trim(),
      sourceUrl: sourceUrl.trim(),
      ingredients: ingredients.filter(row => row.ingredient.trim() !== ''),
      instructions: instructions.trim(),
      ...(recipe?.source ? { source: recipe.source } : {}),
    });
  }

  const isEditing = Boolean(recipe);

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{titleOverride || (isEditing ? 'Edit Recipe' : 'Add Recipe')}</h2>
        {headerAction && headerAction}
      </div>

      <label className={styles.label}>
        Title
        <input
          className={styles.input}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          required
        />
      </label>

      <label className={styles.label}>
        Category
        <select
          className={styles.select}
          value={category}
          onChange={e => setCategory(e.target.value)}
        >
          <option value="breakfast">Breakfast</option>
          <option value="lunch-dinner">Lunch & Dinner</option>
          <option value="snacks">Snacks</option>
          <option value="desserts">Desserts</option>
          <option value="drinks">Drinks</option>
        </select>
      </label>

      <label className={styles.label}>
        Frequency
        <select
          className={styles.select}
          value={frequency}
          onChange={e => setFrequency(e.target.value)}
        >
          <option value="common">Common</option>
          <option value="rare">Rare</option>
          <option value="retired">Retired</option>
        </select>
      </label>

      <label className={styles.label}>
        Meal Type
        <select
          className={styles.select}
          value={mealType}
          onChange={e => { setMealType(e.target.value); if (e.target.value !== 'custom') setCustomMealType(''); }}
        >
          <option value="">— None —</option>
          <option value="meat">Meat</option>
          <option value="pescatarian">Pescatarian</option>
          <option value="vegan">Vegan</option>
          <option value="vegetarian">Vegetarian</option>
          <option value="keto">Keto</option>
          <option value="custom">Custom...</option>
        </select>
      </label>

      {mealType === 'custom' && (
        <label className={styles.label}>
          Custom Meal Type
          <input
            className={styles.input}
            type="text"
            value={customMealType}
            onChange={e => setCustomMealType(e.target.value)}
            placeholder="e.g. Keto, Paleo"
          />
        </label>
      )}

      <label className={styles.label}>
        Servings
        <input
          className={styles.input}
          type="number"
          min="1"
          value={servings}
          onChange={e => setServings(e.target.value)}
          placeholder="1"
        />
      </label>

      <label className={styles.label}>
        Prep Time
        <input
          className={styles.input}
          type="text"
          value={prepTime}
          onChange={e => setPrepTime(e.target.value)}
          placeholder="e.g. 15 min"
        />
      </label>

      <label className={styles.label}>
        Cook Time
        <input
          className={styles.input}
          type="text"
          value={cookTime}
          onChange={e => setCookTime(e.target.value)}
          placeholder="e.g. 30 min"
        />
      </label>

      <label className={styles.label}>
        Source URL
        <input
          className={styles.input}
          type="url"
          value={sourceUrl}
          onChange={e => setSourceUrl(e.target.value)}
          placeholder="Instagram video or recipe website link"
        />
      </label>

      <fieldset className={styles.fieldset} onPaste={handleIngredientsPaste}>
        <legend className={styles.legend}>Ingredients</legend>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Quantity</th>
              <th>Measurement</th>
              <th>Ingredient</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((row, i) => {
              const suggestions = activeAutoIdx === i
                ? ingredientNames.filter(n => n.toLowerCase().includes(row.ingredient.trim().toLowerCase())).slice(0, 8)
                : [];
              return (
              <tr key={i}>
                {fields.map((field, colIdx) => (
                  <td key={field}>
                    {field === 'ingredient' ? (
                      <div className={styles.autocompleteWrap}>
                        <input
                          className={styles.tableInput}
                          type="text"
                          value={row[field]}
                          onChange={e => {
                            updateIngredient(i, field, e.target.value);
                            setActiveAutoIdx(i);
                          }}
                          onFocus={() => setActiveAutoIdx(i)}
                          onBlur={() => setTimeout(() => setActiveAutoIdx(-1), 150)}
                          placeholder="flour"
                        />
                        {suggestions.length > 0 && row.ingredient.trim() && (
                          <ul className={styles.suggestions}>
                            {suggestions.map(name => (
                              <li
                                key={name}
                                className={styles.suggestionItem}
                                onMouseDown={() => {
                                  updateIngredient(i, 'ingredient', name);
                                  setActiveAutoIdx(-1);
                                }}
                              >
                                {name}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : (
                      <input
                        className={styles.tableInput}
                        type="text"
                        value={row[field]}
                        onChange={e => updateIngredient(i, field, e.target.value)}
                        placeholder={field === 'quantity' ? '1' : 'cup'}
                      />
                    )}
                  </td>
                ))}
                <td>
                  {ingredients.length > 1 && (
                    <button
                      className={styles.removeBtn}
                      type="button"
                      onClick={() => removeRow(i)}
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
        <div className={styles.ingredientBtns}>
          <button className={styles.addRowBtn} type="button" onClick={addRow}>
            + Add ingredient
          </button>
          <button className={styles.scanBtn} type="button" onClick={() => setShowScanner(true)}>
            Scan barcode
          </button>
          <button
            className={styles.scanBtn}
            type="button"
            onClick={() => setShowPasteBox(true)}
          >
            Paste / import
          </button>
        </div>
      </fieldset>

      {showPasteBox && (() => {
        const close = () => {
          setPasteText('');
          setColumnMap({});
          setHasHeader(false);
          setImageError('');
          setShowPasteBox(false);
        };
        const cells = splitPasteToCells(pasteText);
        const ncols = cells.length === 0 ? 0 : Math.max(...cells.map(l => l.length));
        const isTabular = ncols >= 2;
        const sampleRow = isTabular && hasHeader ? (cells[1] || []) : (cells[0] || []);
        const preview = applyColumnMap(pasteText, columnMap, hasHeader);
        const PREVIEW_LIMIT = 15;

        const targetOptions = [
          { value: 'ignore', label: 'Ignore' },
          { value: 'quantity', label: 'Quantity' },
          { value: 'measurement', label: 'Measurement' },
          { value: 'ingredient', label: 'Ingredient' },
        ];

        const formatLabel = imageProcessing
          ? 'Reading image…'
          : isTabular
            ? `Tabular · ${ncols} columns`
            : (pasteText.trim() ? `Free text · ${cells.filter(c => c.join('').trim()).length} lines` : null);

        return (
          <div className={styles.pasteOverlay} onClick={close}>
            <div className={styles.pasteModal} onClick={e => e.stopPropagation()}>
              <div className={styles.pasteHeader}>
                <h3 className={styles.pasteTitle}>Import ingredients</h3>
                {formatLabel && <span className={styles.pasteFormatBadge}>{formatLabel}</span>}
                <button type="button" className={styles.pasteCloseBtn} onClick={close} aria-label="Close">×</button>
              </div>
              <div className={styles.pasteBody}>
                <div className={styles.pasteHint}>
                  Paste a spreadsheet, free text (one ingredient per line), or a screenshot. Tabular pastes show a column-mapping panel; free text and images are parsed line by line.
                </div>
                <textarea
                  className={styles.pasteArea}
                  value={pasteText}
                  onChange={e => setPasteSource(e.target.value)}
                  onPaste={e => {
                    const items = Array.from(e.clipboardData?.items || []);
                    const imageItem = items.find(it => it.type?.startsWith('image/'));
                    if (imageItem) {
                      const blob = imageItem.getAsFile();
                      if (blob) {
                        e.preventDefault();
                        processImage(blob);
                      }
                    }
                  }}
                  placeholder={'Paste here:\n• Tab-separated rows from Excel/Sheets\n• One ingredient per line ("1 cup flour")\n• A screenshot (Cmd/Ctrl-V an image)'}
                  rows={6}
                  autoFocus
                  disabled={imageProcessing}
                />
                {imageProcessing && (
                  <div className={styles.pasteStatus}>Reading image…</div>
                )}
                {imageError && (
                  <div className={styles.pasteError}>{imageError}</div>
                )}

                {isTabular && (
                  <div className={styles.colMapWrap}>
                    <div className={styles.colMapTitle}>Column mapping</div>
                    <div className={styles.colMapList}>
                      {Array.from({ length: ncols }, (_, i) => (
                        <div key={i} className={styles.colMapRow}>
                          <div className={styles.colMapMeta}>
                            <span className={styles.colMapNum}>Col {i + 1}</span>
                            <span className={styles.colMapSample} title={(sampleRow[i] || '').trim()}>
                              {(sampleRow[i] || '').trim() || <em className={styles.colMapEmpty}>(empty)</em>}
                            </span>
                          </div>
                          <select
                            className={styles.colMapSelect}
                            value={columnMap[i] || 'ignore'}
                            onChange={e => setColumnMap(m => ({ ...m, [i]: e.target.value }))}
                          >
                            {targetOptions.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                    <label className={styles.colMapHeaderToggle}>
                      <input
                        type="checkbox"
                        checked={hasHeader}
                        onChange={e => setHasHeader(e.target.checked)}
                      />
                      First row is a header (skip it)
                    </label>
                  </div>
                )}

                <div className={styles.pasteCount}>
                  {preview.length === 0
                    ? (pasteText.trim()
                        ? (isTabular ? 'No rows yet — map at least one column to "Ingredient".' : 'No ingredient lines parsed.')
                        : 'Paste data above to preview.')
                    : `${preview.length} row${preview.length === 1 ? '' : 's'} ready`}
                </div>
                <div className={styles.previewWrap}>
                  <table className={styles.previewTable}>
                    <thead>
                      <tr>
                        <th>Quantity</th>
                        <th>Measurement</th>
                        <th>Ingredient</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.length === 0 ? (
                        <tr><td colSpan={3} className={styles.previewEmpty}>—</td></tr>
                      ) : (
                        <>
                          {preview.slice(0, PREVIEW_LIMIT).map((r, i) => (
                            <tr key={i}>
                              <td>{r.quantity}</td>
                              <td>{r.measurement}</td>
                              <td>{r.ingredient}</td>
                            </tr>
                          ))}
                          {preview.length > PREVIEW_LIMIT && (
                            <tr><td colSpan={3} className={styles.previewMore}>+ {preview.length - PREVIEW_LIMIT} more</td></tr>
                          )}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className={styles.pasteFooter}>
                <button
                  className={styles.pasteAppendBtn}
                  type="button"
                  onClick={() => applyPaste('append')}
                  disabled={preview.length === 0 || imageProcessing}
                >
                  Append rows
                </button>
                <button
                  className={styles.pasteReplaceBtn}
                  type="button"
                  onClick={() => applyPaste('replace')}
                  disabled={preview.length === 0 || imageProcessing}
                >
                  Replace existing
                </button>
                <button
                  className={styles.pasteCancelBtn}
                  type="button"
                  onClick={close}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.5rem' }}>Instructions</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {(() => {
            const steps = instructions.split('\n').filter(s => s.trim());
            if (steps.length === 0) steps.push('');
            return steps.map((step, i) => {
              const cleaned = step.replace(/^[\d]+[.)]\s*/, '').replace(/^[1-9]\uFE0F?\u20E3\s*/, '').trim();
              return (
                <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', borderLeft: '3px solid var(--color-accent)', borderRadius: '8px', background: 'var(--color-surface-alt)', padding: '0.5rem 0.75rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-accent)', minWidth: '22px', flexShrink: 0, paddingTop: '0.15rem' }}>{i + 1}</span>
                  <textarea
                    value={cleaned}
                    onChange={e => {
                      const newSteps = instructions.split('\n').filter(s => s.trim());
                      while (newSteps.length <= i) newSteps.push('');
                      newSteps[i] = e.target.value;
                      setInstructions(newSteps.join('\n'));
                    }}
                    rows={Math.max(1, Math.ceil((cleaned.length || 1) / 60))}
                    placeholder={i === 0 ? 'First step...' : 'Next step...'}
                    style={{ flex: 1, border: 'none', background: 'transparent', fontSize: '0.88rem', lineHeight: 1.55, color: 'var(--color-text)', fontFamily: 'inherit', resize: 'vertical', padding: '0.15rem 0', outline: 'none', minHeight: '24px' }}
                  />
                  {steps.length > 1 && (
                    <button type="button" onClick={() => {
                      const newSteps = instructions.split('\n').filter(s => s.trim());
                      newSteps.splice(i, 1);
                      setInstructions(newSteps.join('\n'));
                    }} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.9rem', padding: '0', flexShrink: 0, lineHeight: 1 }}>×</button>
                  )}
                </div>
              );
            });
          })()}
          <button type="button" onClick={() => setInstructions(prev => prev + '\n')} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: '0.25rem 0' }}>
            + Add step
          </button>
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.saveBtn} type="submit">
          {saveLabel || (isEditing ? 'Save Changes' : 'Add Recipe')}
        </button>
        <button className={styles.cancelBtn} type="button" onClick={onCancel}>
          {cancelLabel || 'Cancel'}
        </button>
      </div>

      {showScanner && (
        <BarcodeScanner
          onResult={handleBarcodeScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </form>
  );
}
