import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NutritionPanel } from './NutritionPanel';
import { BarcodeScanner } from './BarcodeScanner';
import { loadFriends, shareRecipe, getUsername, createShareLink } from '../utils/firestoreSync';
import { loadIngredients } from '../utils/ingredientsStore';
import styles from './RecipeDetail.module.css';

const STOP_WORDS = new Set([
  'the','a','an','and','or','with','in','on','of','for','my','our','easy',
  'best','quick','simple','classic','homemade','style','recipe',
]);

function buildImageUrl(recipe) {
  const words = recipe.title.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  const keywords = words.slice(0, 2).join(',');
  let hash = 0;
  for (const ch of recipe.id) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return `https://loremflickr.com/800/400/food,${keywords}?lock=${Math.abs(hash)}`;
}

const emptyRow = { quantity: '', measurement: '', ingredient: '', notes: '' };
const ingredientFields = ['quantity', 'measurement', 'ingredient', 'notes'];

// All measurements in ml (volume) or grams (weight) for conversion
const VOLUME_TO_ML = {
  tsp: 4.929, teaspoon: 4.929, teaspoons: 4.929,
  tbsp: 14.787, tablespoon: 14.787, tablespoons: 14.787,
  'fl oz': 29.574,
  cup: 236.588, cups: 236.588,
  pint: 473.176, pints: 473.176,
  quart: 946.353, quarts: 946.353,
  gallon: 3785.41, gallons: 3785.41,
  liter: 1000, liters: 1000, l: 1000,
  ml: 1,
  pinch: 0.31, dash: 0.62, smidgen: 0.16,
  can: 400, cans: 400,
  handful: 50, handfuls: 50,
  bunch: 200, bunches: 200,
};

const WEIGHT_TO_G = {
  g: 1, gram: 1, grams: 1,
  kg: 1000,
  oz: 28.3495, ounce: 28.3495, ounces: 28.3495,
  lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
  clove: 5, cloves: 5,
  slice: 30, slices: 30,
  stick: 113.4, sticks: 113.4,
  piece: 50, pieces: 50,
  head: 500, heads: 500,
  stalk: 50, stalks: 50,
  sprig: 2, sprigs: 2,
  whole: 100, each: 100,
  large: 150, medium: 100, small: 75,
};

const VOLUME_UNITS = ['tsp', 'tbsp', 'cup', 'ml', 'fl oz', 'pint', 'quart', 'liter', 'gallon', 'pinch', 'dash', 'can', 'handful', 'bunch'];
const WEIGHT_UNITS = ['g', 'oz', 'lb', 'kg', 'clove', 'slice', 'stick', 'piece', 'head', 'stalk', 'sprig', 'whole', 'each', 'large', 'medium', 'small'];

function normalizeUnit(unit) {
  return unit.trim().toLowerCase().replace(/\(s\)$/i, '');
}

function classifyUnit(measurement) {
  if (!measurement) return null;
  const unit = normalizeUnit(measurement);
  if (!unit) return null;
  if (VOLUME_TO_ML[unit]) return 'volume';
  if (WEIGHT_TO_G[unit]) return 'weight';
  return null;
}

function getConversions(qty, measurement, dbGrams) {
  if (!measurement || !qty) return [];
  const num = parseFloat(qty);
  if (isNaN(num) || num === 0) return [];
  const unit = normalizeUnit(measurement);
  const results = [];

  if (VOLUME_TO_ML[unit]) {
    const ml = num * VOLUME_TO_ML[unit];
    for (const target of VOLUME_UNITS) {
      if (target === unit) continue;
      const converted = ml / VOLUME_TO_ML[target];
      if (converted >= 0.01 && converted <= 10000) {
        results.push({ qty: parseFloat(converted.toFixed(2)), unit: target });
      }
    }
    // Volume to weight using dbGrams (grams per serving)
    if (dbGrams > 0) {
      const grams = num * dbGrams;
      for (const target of WEIGHT_UNITS) {
        const converted = grams / WEIGHT_TO_G[target];
        if (converted >= 0.01 && converted <= 10000) {
          results.push({ qty: parseFloat(converted.toFixed(2)), unit: target });
        }
      }
    }
  } else if (WEIGHT_TO_G[unit]) {
    const g = num * WEIGHT_TO_G[unit];
    for (const target of WEIGHT_UNITS) {
      if (target === unit) continue;
      const converted = g / WEIGHT_TO_G[target];
      if (converted >= 0.01 && converted <= 10000) {
        results.push({ qty: parseFloat(converted.toFixed(2)), unit: target });
      }
    }
  }
  return results;
}

/**
 * Get the best cross-conversion for display in weight/volume columns.
 * dbGrams = grams per 1 unit of dbMeasurement (from ingredient database).
 * Returns { weight, volume } strings or empty strings.
 */
function getCrossConversion(qty, measurement, dbGrams, dbMeasurement) {
  if (!measurement || !qty) return { weight: '', volume: '' };
  const num = parseFloat(qty);
  if (isNaN(num) || num === 0) return { weight: '', volume: '' };
  const unit = normalizeUnit(measurement);
  const dbUnit = normalizeUnit(dbMeasurement || '');

  if (!dbGrams || dbGrams <= 0 || !dbUnit) return { weight: '', volume: '' };

  // Need to know the ml-per-dbUnit or g-per-dbUnit to convert
  const dbIsVolume = !!VOLUME_TO_ML[dbUnit];
  const dbIsWeight = !!WEIGHT_TO_G[dbUnit];
  if (!dbIsVolume && !dbIsWeight) return { weight: '', volume: '' };

  // gramsPerMl: how many grams per 1 ml of this ingredient
  // We know: 1 dbUnit = dbGrams grams
  // If dbUnit is volume: gramsPerMl = dbGrams / VOLUME_TO_ML[dbUnit]
  if (dbIsVolume) {
    const gramsPerMl = dbGrams / VOLUME_TO_ML[dbUnit];

    if (VOLUME_TO_ML[unit]) {
      // Input is volume → compute weight
      const ml = num * VOLUME_TO_ML[unit];
      const grams = ml * gramsPerMl;
      const rounded = parseFloat(grams.toFixed(1));
      return { weight: `${rounded} ${rounded === 1 ? 'gram' : 'grams'}`, volume: '' };
    } else if (WEIGHT_TO_G[unit]) {
      // Input is weight → compute volume
      const g = num * WEIGHT_TO_G[unit];
      const ml = g / gramsPerMl;
      // Pick a friendly volume unit
      const cups = ml / VOLUME_TO_ML['cup'];
      if (cups >= 0.25) {
        return { weight: '', volume: `${parseFloat(cups.toFixed(2))} cup` };
      }
      const tbsp = ml / VOLUME_TO_ML['tbsp'];
      return { weight: '', volume: `${parseFloat(tbsp.toFixed(1))} tbsp` };
    }
  }

  return { weight: '', volume: '' };
}

function initFields(recipe) {
  const type = recipe.mealType || '';
  const presets = ['meat', 'pescatarian', 'vegan', 'vegetarian', ''];
  return {
    title: recipe.title || '',
    description: recipe.description || '',
    category: recipe.category || 'lunch-dinner',
    frequency: recipe.frequency || 'common',
    mealType: presets.includes(type) ? type : 'custom',
    customMealType: presets.includes(type) ? '' : type,
    servings: recipe.servings || '1',
    prepTime: recipe.prepTime || '',
    cookTime: recipe.cookTime || '',
    sourceUrl: recipe.sourceUrl || '',
    ingredients: (recipe.ingredients && recipe.ingredients.length > 0)
      ? recipe.ingredients.map(r => ({ ...r }))
      : [{ ...emptyRow }],
    steps: (() => {
      const parsed = (recipe.instructions || '')
        .split('\n')
        .map(s => s.replace(/^\d+[\.\)]\s*/, '').trim())
        .filter(Boolean);
      return parsed.length > 0 ? parsed : [''];
    })(),
  };
}

export function RecipeDetail({ recipe, onSave, onDelete, onBack, user }) {
  const [imgError, setImgError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [panning, setPanning] = useState(false);
  const [imgPos, setImgPos] = useState(() => recipe?.imagePosition || { x: 50, y: 50 });
  const [fields, setFields] = useState(() => recipe ? initFields(recipe) : null);
  const [showShareDropdown, setShowShareDropdown] = useState(false);
  const [friendsList, setFriendsList] = useState(null);
  const [shareMsg, setShareMsg] = useState(null);
  const shareRef = useRef(null);
  const dragCounter = useRef(0);
  const panStart = useRef(null);
  const heroImgRef = useRef(null);
  const fileInputRef = useRef(null);
  const [adjustedServings, setAdjustedServings] = useState(null);
  const [editingIngredients, setEditingIngredients] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Build lookup maps from ingredient database
  const { dbNotesMap, dbGramsMap, dbMeasurementMap } = useMemo(() => {
    const notes = new Map();
    const grams = new Map();
    const measurements = new Map();
    const data = loadIngredients();
    if (data) {
      for (const item of data) {
        const key = (item.ingredient || '').trim().toLowerCase();
        if (!key) continue;
        if (item.notes) notes.set(key, item.notes);
        if (item.grams) grams.set(key, parseFloat(item.grams) || 0);
        if (item.measurement) measurements.set(key, item.measurement.trim());
      }
    }
    return { dbNotesMap: notes, dbGramsMap: grams, dbMeasurementMap: measurements };
  }, []);

  function getDbNotes(ingredientName) {
    if (!ingredientName) return null;
    const search = ingredientName.trim().toLowerCase();
    if (dbNotesMap.has(search)) return dbNotesMap.get(search);
    for (const [name, notes] of dbNotesMap) {
      if (name.startsWith(search) || search.startsWith(name)) return notes;
    }
    return null;
  }

  function getDbGrams(ingredientName) {
    if (!ingredientName) return 0;
    const search = ingredientName.trim().toLowerCase();
    if (dbGramsMap.has(search)) return dbGramsMap.get(search);
    for (const [name, grams] of dbGramsMap) {
      if (name.startsWith(search) || search.startsWith(name)) return grams;
    }
    return 0;
  }

  function getDbMeasurement(ingredientName) {
    if (!ingredientName) return '';
    const search = ingredientName.trim().toLowerCase();
    if (dbMeasurementMap.has(search)) return dbMeasurementMap.get(search);
    for (const [name, m] of dbMeasurementMap) {
      if (name.startsWith(search) || search.startsWith(name)) return m;
    }
    return '';
  }

  const baseServings = parseInt(fields?.servings) || 1;
  const currentServings = adjustedServings ?? baseServings;
  const scaleFactor = baseServings > 0 ? currentServings / baseServings : 1;

  function scaleQuantity(qty) {
    const num = parseFloat(qty);
    if (isNaN(num)) return qty;
    const scaled = num * scaleFactor;
    // Show clean numbers: round to 2 decimals, strip trailing zeros
    return parseFloat(scaled.toFixed(2)).toString();
  }

  function setField(key, value) {
    setFields(prev => ({ ...prev, [key]: value }));
  }

  function updateIngredient(index, field, value) {
    setFields(prev => ({
      ...prev,
      ingredients: prev.ingredients.map((row, i) =>
        i === index ? { ...row, [field]: value } : row
      ),
    }));
  }

  function addRow() {
    setFields(prev => ({
      ...prev,
      ingredients: [...prev.ingredients, { ...emptyRow }],
    }));
  }

  function handleBarcodeScan(ingredient) {
    setShowScanner(false);
    setFields(prev => ({
      ...prev,
      ingredients: [...prev.ingredients, { ...emptyRow, ...ingredient }],
    }));
  }

  function removeRow(index) {
    setFields(prev => ({
      ...prev,
      ingredients: prev.ingredients.filter((_, i) => i !== index),
    }));
  }

  function handlePaste(e, rowIndex, colIndex) {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();

    const pastedRows = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trimEnd()
      .split('\n')
      .map(line => line.split('\t'));

    setFields(prev => {
      const updated = prev.ingredients.map(row => ({ ...row }));
      const neededRows = rowIndex + pastedRows.length;
      while (updated.length < neededRows) updated.push({ ...emptyRow });

      for (let r = 0; r < pastedRows.length; r++) {
        const cells = pastedRows[r];
        for (let c = 0; c < cells.length; c++) {
          const targetCol = colIndex + c;
          if (targetCol < ingredientFields.length) {
            updated[rowIndex + r][ingredientFields[targetCol]] = cells[c].trim();
          }
        }
      }
      return { ...prev, ingredients: updated };
    });
  }

  function updateStep(index, value) {
    setFields(prev => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === index ? value : s)),
    }));
  }

  function addStep() {
    setFields(prev => ({ ...prev, steps: [...prev.steps, ''] }));
  }

  function removeStep(index) {
    setFields(prev => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== index),
    }));
  }

  function handleSave() {
    onSave({
      title: fields.title.trim(),
      description: fields.description.trim(),
      category: fields.category,
      frequency: fields.frequency,
      mealType: fields.mealType === 'custom' ? fields.customMealType.trim() : fields.mealType,
      servings: fields.servings.trim() || '1',
      prepTime: fields.prepTime.trim(),
      cookTime: fields.cookTime.trim(),
      sourceUrl: fields.sourceUrl.trim(),
      ingredients: fields.ingredients.filter(row => row.ingredient.trim() !== ''),
      instructions: fields.steps.filter(s => s.trim()).join('\n'),
    });
  }

  function handleCancel() {
    setFields(initFields(recipe));
    onBack();
  }

  // Auto-save after 500ms of inactivity
  const initialRef = useRef(true);
  useEffect(() => {
    if (!fields || initialRef.current) {
      initialRef.current = false;
      return;
    }
    const timer = setTimeout(() => handleSave(), 500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  // Close share dropdown on outside click
  useEffect(() => {
    if (!showShareDropdown) return;
    function handleClickOutside(e) {
      if (shareRef.current && !shareRef.current.contains(e.target)) {
        setShowShareDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showShareDropdown]);

  async function handleShareClick() {
    if (showShareDropdown) {
      setShowShareDropdown(false);
      return;
    }
    if (!user) return;
    if (!friendsList) {
      const frs = await loadFriends(user.uid);
      setFriendsList(frs);
    }
    setShareMsg(null);
    setShowShareDropdown(true);
  }

  async function handleShareWith(friend) {
    try {
      const myUsername = await getUsername(user.uid);
      // Strip undefined values — Firestore rejects them
      const cleanRecipe = JSON.parse(JSON.stringify(recipe));
      await shareRecipe(user.uid, friend.uid, myUsername || user.displayName, cleanRecipe);
      setShowShareDropdown(false);
      setShareMsg(`Shared with @${friend.username}!`);
      setTimeout(() => setShareMsg(null), 3000);
    } catch (err) {
      console.error('Share error:', err);
      setShareMsg('Failed to share.');
      setTimeout(() => setShareMsg(null), 3000);
    }
  }

  function processImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(true);
    const img = new Image();
    img.onload = () => {
      const MAX_W = 800;
      const scale = img.width > MAX_W ? MAX_W / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      onSave({ imageUrl: dataUrl });
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    img.onerror = () => {
      alert('Failed to read image');
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    img.src = URL.createObjectURL(file);
  }

  function handleImageUpload(e) {
    processImageFile(e.target.files?.[0]);
  }

  function handleRemoveImage() {
    onSave({ imageUrl: '' });
  }

  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    dragCounter.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (file) processImageFile(file);
  }

  function handlePanStart(e) {
    if (!recipe.imageUrl) return;
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    panStart.current = { x: clientX, y: clientY, posX: imgPos.x, posY: imgPos.y };
    setPanning(true);
  }

  useEffect(() => {
    if (!panning) return;
    let lastPos = imgPos;
    function handlePanMove(e) {
      if (!panStart.current) return;
      e.preventDefault();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      // Move ~2% per pixel dragged for responsive feel
      const dx = (panStart.current.x - clientX) * 0.5;
      const dy = (panStart.current.y - clientY) * 0.5;
      const newX = Math.max(0, Math.min(100, panStart.current.posX + dx));
      const newY = Math.max(0, Math.min(100, panStart.current.posY + dy));
      lastPos = { x: Math.round(newX), y: Math.round(newY) };
      setImgPos(lastPos);
    }
    function handlePanEnd() {
      setPanning(false);
      panStart.current = null;
      onSave({ imagePosition: lastPos });
    }
    window.addEventListener('mousemove', handlePanMove);
    window.addEventListener('mouseup', handlePanEnd);
    window.addEventListener('touchmove', handlePanMove, { passive: false });
    window.addEventListener('touchend', handlePanEnd);
    return () => {
      window.removeEventListener('mousemove', handlePanMove);
      window.removeEventListener('mouseup', handlePanEnd);
      window.removeEventListener('touchmove', handlePanMove);
      window.removeEventListener('touchend', handlePanEnd);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panning]);

  if (!recipe) {
    return (
      <div className={styles.container}>
        <button className={styles.backBtn} onClick={onBack}>
          &larr; Back to recipes
        </button>
        <p>Recipe not found.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onBack}>
        &larr; Back to recipes
      </button>

      <div className={styles.topRow}>
        <div className={styles.topLeft}>
          <input
            className={`${styles.inlineInput} ${styles.titleInput}`}
            type="text"
            value={fields.title}
            onChange={e => setField('title', e.target.value)}
          />

          <textarea
            className={styles.inlineTextarea}
            value={fields.description}
            onChange={e => setField('description', e.target.value)}
            placeholder="Short description"
            rows={2}
          />

          <div className={styles.metaRow}>
            <label className={styles.metaLabel}>
              Serves
              <input
                className={`${styles.inlineInput} ${styles.metaInput}`}
                type="number"
                min="1"
                value={fields.servings}
                onChange={e => setField('servings', e.target.value)}
              />
            </label>
            <label className={styles.metaLabel}>
              Prep
              <input
                className={`${styles.inlineInput} ${styles.metaInput}`}
                type="text"
                value={fields.prepTime}
                onChange={e => setField('prepTime', e.target.value)}
                placeholder="15 min"
              />
            </label>
            <label className={styles.metaLabel}>
              Cook
              <input
                className={`${styles.inlineInput} ${styles.metaInput}`}
                type="text"
                value={fields.cookTime}
                onChange={e => setField('cookTime', e.target.value)}
                placeholder="30 min"
              />
            </label>
          </div>

          <div className={styles.metaRow}>
            <label className={styles.metaLabel}>
              Category
              <select
                className={styles.inlineSelect}
                value={fields.category}
                onChange={e => setField('category', e.target.value)}
              >
                <option value="breakfast">Breakfast</option>
                <option value="lunch-dinner">Lunch & Dinner</option>
                <option value="snacks">Snacks</option>
                <option value="desserts">Desserts</option>
                <option value="drinks">Drinks</option>
              </select>
            </label>
            <label className={styles.metaLabel}>
              Frequency
              <select
                className={styles.inlineSelect}
                value={fields.frequency}
                onChange={e => setField('frequency', e.target.value)}
              >
                <option value="common">Common</option>
                <option value="rare">Rare</option>
                <option value="retired">Retired</option>
              </select>
            </label>
            <label className={styles.metaLabel}>
              Meal Type
              <select
                className={styles.inlineSelect}
                value={fields.mealType}
                onChange={e => {
                  setField('mealType', e.target.value);
                  if (e.target.value !== 'custom') setField('customMealType', '');
                }}
              >
                <option value="">— None —</option>
                <option value="meat">Meat</option>
                <option value="pescatarian">Pescatarian</option>
                <option value="vegan">Vegan</option>
                <option value="vegetarian">Vegetarian</option>
                <option value="custom">Custom...</option>
              </select>
            </label>
            {fields.mealType === 'custom' && (
              <input
                className={`${styles.inlineInput} ${styles.metaInput}`}
                type="text"
                value={fields.customMealType}
                onChange={e => setField('customMealType', e.target.value)}
                placeholder="e.g. Keto, Paleo"
              />
            )}
          </div>

          <div className={styles.metaRow}>
            <label className={styles.metaLabel} style={{ flex: 1 }}>
              Source URL
              <input
                className={styles.inlineInput}
                type="text"
                value={fields.sourceUrl}
                onChange={e => setField('sourceUrl', e.target.value)}
                placeholder="Recipe link"
              />
            </label>
          </div>
        </div>

        <div
          className={`${styles.heroWrap}${dragging ? ` ${styles.heroDragging}` : ''}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {dragging && (
            <div className={styles.dropOverlay}>
              Drop image here
            </div>
          )}
          {recipe.imageUrl ? (
            <img
              ref={heroImgRef}
              className={`${styles.heroImgUser}${panning ? ` ${styles.heroImgPanning}` : ''}`}
              src={recipe.imageUrl}
              alt={recipe.title}
              style={{ objectPosition: `${imgPos.x}% ${imgPos.y}%` }}
              onMouseDown={handlePanStart}
              onTouchStart={handlePanStart}
              draggable={false}
            />
          ) : !imgError ? (
            <img
              className={styles.heroImg}
              src={buildImageUrl(recipe)}
              alt={recipe.title}
              onError={() => setImgError(true)}
            />
          ) : null}
          {user && (
            <div className={styles.imageOverlay}>
              <button
                className={styles.uploadBtn}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Uploading...' : recipe.imageUrl ? 'Change Photo' : 'Upload Photo'}
              </button>
              {recipe.imageUrl && (
                <button className={styles.removeImgBtn} onClick={handleRemoveImage}>
                  Remove
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleImageUpload}
              />
            </div>
          )}
        </div>
      </div>

      {user && (
        <div className={styles.shareRow}>
          <div className={styles.shareWrapper} ref={shareRef}>
            <button className={styles.shareBtn} onClick={handleShareClick}>
              Share
            </button>
            {showShareDropdown && (
              <div className={styles.shareDropdown}>
                {friendsList && friendsList.length === 0 && (
                  <span className={styles.noFriends}>No friends yet</span>
                )}
                {friendsList && friendsList.map(f => (
                  <button
                    key={f.uid}
                    className={styles.friendOption}
                    onClick={() => handleShareWith(f)}
                  >
                    @{f.username}
                  </button>
                ))}
                <div className={styles.shareDivider} />
                <button
                  className={styles.shareLinkBtn}
                  onClick={async () => {
                    try {
                      const cleanRecipe = JSON.parse(JSON.stringify(recipe));
                      const token = await createShareLink(user.uid, cleanRecipe);
                      const slug = recipe.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                      const url = window.location.origin + '?share=' + token + '&recipe=' + slug;
                      await navigator.clipboard.writeText(url);
                      setShowShareDropdown(false);
                      setShareMsg('Link copied!');
                      setTimeout(() => setShareMsg(null), 3000);
                    } catch (err) {
                      console.error('Create link error:', err);
                      setShareMsg('Failed to create link.');
                      setTimeout(() => setShareMsg(null), 3000);
                    }
                  }}
                >
                  Create Link
                </button>
              </div>
            )}
          </div>
          {shareMsg && <span className={styles.shareMsg}>{shareMsg}</span>}
        </div>
      )}

      <NutritionPanel recipeId={recipe.id} ingredients={recipe.ingredients} servings={parseInt(recipe.servings) || 1} />

      <div className={styles.ingredientsCol}>
        <div className={styles.ingredientsHeader}>
          <h3>Ingredients</h3>
          <div className={styles.ingredientsActions}>
            <div className={styles.servingAdjuster}>
              <button
                className={styles.servingBtn}
                type="button"
                onClick={() => setAdjustedServings(Math.max(1, currentServings - 1))}
              >
                &minus;
              </button>
              <span className={styles.servingDisplay}>
                {currentServings} {currentServings === 1 ? 'serving' : 'servings'}
              </span>
              <button
                className={styles.servingBtn}
                type="button"
                onClick={() => setAdjustedServings(currentServings + 1)}
              >
                +
              </button>
              {adjustedServings !== null && adjustedServings !== baseServings && (
                <button
                  className={styles.servingReset}
                  type="button"
                  onClick={() => setAdjustedServings(null)}
                >
                  Reset
                </button>
              )}
            </div>
            <button
              className={styles.editToggleBtn}
              type="button"
              onClick={() => setEditingIngredients(prev => !prev)}
            >
              {editingIngredients ? 'Done' : 'Edit'}
            </button>
          </div>
        </div>

        {editingIngredients ? (
          <>
            <table className={styles.ingredientTable}>
              <thead>
                <tr>
                  <th>Quantity</th>
                  <th>Measurement</th>
                  <th>Type</th>
                  <th>Converted</th>
                  <th>Ingredient</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {fields.ingredients.map((row, i) => {
                  const dbGrams = getDbGrams(row.ingredient);
                  const dbMeasurement = getDbMeasurement(row.ingredient);
                  const dbNotes = getDbNotes(row.ingredient);
                  const unitType = classifyUnit(row.measurement);
                  // Compute the conversion to the opposite type
                  const crossConv = getCrossConversion(row.quantity, row.measurement, dbGrams, dbMeasurement);
                  let convertedText = '';
                  if (unitType === 'weight' && crossConv.volume) convertedText = crossConv.volume;
                  else if (unitType === 'volume' && crossConv.weight) convertedText = crossConv.weight;
                  // Also compute same-type conversions for toggling
                  const conversions = getConversions(row.quantity, row.measurement, dbGrams);
                  // Find best opposite-type conversion from the full list
                  if (!convertedText && conversions.length > 0) {
                    if (unitType === 'weight') {
                      const vol = conversions.find(c => VOLUME_TO_ML[c.unit]);
                      if (vol) convertedText = `${vol.qty} ${vol.unit}`;
                    } else if (unitType === 'volume') {
                      const wt = conversions.find(c => WEIGHT_TO_G[c.unit]);
                      if (wt) convertedText = `${wt.qty} ${wt.unit}`;
                    }
                  }
                  return (
                  <tr key={i}>
                    {ingredientFields.map((field, colIdx) => (
                      <React.Fragment key={field}>
                        <td>
                          <input
                            className={styles.cellInput}
                            type="text"
                            value={row[field] || ''}
                            onChange={e => updateIngredient(i, field, e.target.value)}
                            onPaste={e => handlePaste(e, i, colIdx)}
                            placeholder={
                              field === 'quantity' ? '1' :
                              field === 'measurement' ? 'cup' :
                              field === 'ingredient' ? 'flour' :
                              field === 'notes' ? (dbNotes || '') : ''
                            }
                          />
                        </td>
                        {field === 'measurement' && (
                          <>
                            <td>
                              {unitType ? (
                                <button
                                  className={styles.typeBtn}
                                  type="button"
                                  title={unitType === 'weight' ? 'Convert to volume' : 'Convert to weight'}
                                  onClick={() => {
                                    // Find the best conversion to the opposite type and apply it
                                    if (unitType === 'weight') {
                                      // Try cross-conversion first
                                      if (crossConv.volume) {
                                        const parts = crossConv.volume.match(/^([\d.]+)\s+(.+)$/);
                                        if (parts) {
                                          updateIngredient(i, 'quantity', parts[1]);
                                          updateIngredient(i, 'measurement', parts[2]);
                                          return;
                                        }
                                      }
                                      const vol = conversions.find(c => VOLUME_TO_ML[c.unit]);
                                      if (vol) {
                                        updateIngredient(i, 'quantity', String(vol.qty));
                                        updateIngredient(i, 'measurement', vol.unit);
                                      }
                                    } else {
                                      if (crossConv.weight) {
                                        const parts = crossConv.weight.match(/^([\d.]+)\s*(.+)$/);
                                        if (parts) {
                                          updateIngredient(i, 'quantity', parts[1]);
                                          updateIngredient(i, 'measurement', parts[2]);
                                          return;
                                        }
                                      }
                                      const wt = conversions.find(c => WEIGHT_TO_G[c.unit]);
                                      if (wt) {
                                        updateIngredient(i, 'quantity', String(wt.qty));
                                        updateIngredient(i, 'measurement', wt.unit);
                                      }
                                    }
                                  }}
                                >
                                  {unitType === 'weight' ? 'Weight' : 'Volume'}
                                </button>
                              ) : (
                                <span className={styles.typeLabel}>
                                  {(row.measurement || '').trim() ? 'Other' : ''}
                                </span>
                              )}
                            </td>
                            <td className={styles.convertedCell}>
                              {convertedText}
                            </td>
                          </>
                        )}
                      </React.Fragment>
                    ))}
                    <td>
                      {fields.ingredients.length > 1 && (
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
            </div>
          </>
        ) : (
          <table className={styles.viewTable}>
            <thead>
              <tr>
                <th>Quantity</th>
                <th>Measurement</th>
                <th>Ingredient</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {fields.ingredients.filter(row => (row.ingredient || '').trim()).map((row, i) => {
                const dbNotes = getDbNotes(row.ingredient);
                const displayQty = scaleFactor !== 1 ? scaleQuantity(row.quantity) : (row.quantity || '');
                return (
                  <tr key={i}>
                    <td className={scaleFactor !== 1 ? styles.scaledQty : ''}>
                      {displayQty}
                    </td>
                    <td>{row.measurement}</td>
                    <td>{row.ingredient}</td>
                    <td className={styles.notesCell}>
                      {row.notes || dbNotes || ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.section}>
        <h3>Instructions</h3>
        <ol className={styles.stepsList}>
          {fields.steps.map((step, i) => (
            <li key={i} className={styles.stepRow}>
              <span className={styles.stepLabel}>Step {i + 1}</span>
              <div className={styles.stepInputWrap}>
                <textarea
                  className={styles.stepInput}
                  value={step}
                  rows={2}
                  onChange={e => updateStep(i, e.target.value)}
                  placeholder={`Step ${i + 1}...`}
                />
                {fields.steps.length > 1 && (
                  <button
                    className={styles.removeBtn}
                    type="button"
                    onClick={() => removeStep(i)}
                  >
                    &times;
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
        <button className={styles.addRowBtn} type="button" onClick={addStep}>
          + Add step
        </button>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.deleteBtn}
          onClick={() => {
            if (confirm('Delete this recipe?')) onDelete(recipe.id);
          }}
        >
          Delete
        </button>
      </div>

      {showScanner && (
        <BarcodeScanner
          onResult={handleBarcodeScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
