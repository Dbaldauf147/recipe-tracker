import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NutritionPanel } from './NutritionPanel';
import { BarcodeScanner } from './BarcodeScanner';
import { loadFriends, shareRecipe, getUsername, createShareLink } from '../utils/firestoreSync';
import { loadIngredients } from '../utils/ingredientsStore';
import { VOLUME_TO_ML, WEIGHT_TO_G } from '../utils/units';
import { classifyMealType } from '../utils/classifyMealType';
import styles from './RecipeDetail.module.css';

const ADMIN_UID = import.meta.env.VITE_ADMIN_UID;

function parseFraction(str) {
  if (!str) return 0;
  const s = str.trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}

function formatQuantity(n) {
  if (n === 0) return '';
  if (Number.isInteger(n)) return String(n);
  const whole = Math.floor(n);
  const frac = n - whole;
  const fracs = { 0.25: '1/4', 0.333: '1/3', 0.5: '1/2', 0.667: '2/3', 0.75: '3/4' };
  for (const [dec, str] of Object.entries(fracs)) {
    if (Math.abs(frac - parseFloat(dec)) < 0.05) {
      return whole > 0 ? `${whole} ${str}` : str;
    }
  }
  return n.toFixed(2).replace(/\.?0+$/, '');
}

const emptyRow = { quantity: '', measurement: '', ingredient: '', notes: '', topping: false };
const ingredientFields = ['quantity', 'measurement', 'ingredient'];


const VOLUME_UNITS = ['tsp', 'tbsp', 'fl oz', 'cup', 'pt', 'qt', 'gal', 'ml', 'cl', 'dl', 'l'];
const WEIGHT_UNITS = ['g', 'oz', 'lb', 'kg', 'mg'];

const LIQUIDS = new Set([
  'water', 'milk', 'cream', 'half and half', 'half-and-half', 'buttermilk',
  'broth', 'stock', 'chicken broth', 'beef broth', 'vegetable broth',
  'chicken stock', 'beef stock', 'vegetable stock', 'bone broth',
  'juice', 'orange juice', 'lemon juice', 'lime juice', 'apple juice',
  'oil', 'olive oil', 'vegetable oil', 'canola oil', 'coconut oil', 'sesame oil', 'avocado oil',
  'vinegar', 'apple cider vinegar', 'balsamic vinegar', 'red wine vinegar', 'white vinegar', 'rice vinegar',
  'wine', 'red wine', 'white wine', 'cooking wine', 'beer',
  'soy sauce', 'fish sauce', 'hot sauce', 'worcestershire sauce', 'teriyaki sauce',
  'maple syrup', 'honey', 'agave', 'corn syrup', 'molasses',
  'vanilla extract', 'extract', 'almond extract',
  'coffee', 'espresso', 'tea',
  'coconut milk', 'almond milk', 'oat milk', 'soy milk',
  'heavy cream', 'whipping cream', 'sour cream',
]);

function isLiquid(ingredientName) {
  if (!ingredientName) return false;
  const name = ingredientName.trim().toLowerCase();
  if (LIQUIDS.has(name)) return true;
  // Partial match: check if any liquid keyword is in the name
  for (const liquid of LIQUIDS) {
    if (name.includes(liquid) || liquid.includes(name)) return true;
  }
  return false;
}

const OZ_PATTERN = /^(oz|ounce|ounces)$/i;

const PLURAL_UNITS = {
  cup: 'cups', cups: 'cups',
  scoop: 'scoops', scoops: 'scoops',
  tablespoon: 'tablespoons', tablespoons: 'tablespoons',
  teaspoon: 'teaspoons', teaspoons: 'teaspoons',
  g: 'grams', gram: 'grams', grams: 'grams',
};

function displayMeasurement(measurement, ingredientName, qty) {
  if (!measurement) return '';
  const trimmed = measurement.trim();
  if (isLiquid(ingredientName) && OZ_PATTERN.test(trimmed)) {
    return 'fl oz';
  }
  const num = parseFloat(qty);
  const key = trimmed.toLowerCase().replace(/\(s\)$/i, '');
  if (key in PLURAL_UNITS) {
    if (!isNaN(num) && num > 1) {
      return PLURAL_UNITS[key];
    }
    // singular form: strip trailing 's' if present
    const singular = PLURAL_UNITS[key].replace(/s$/, '');
    return singular;
  }
  return measurement;
}

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
          const roundWhole = target === 'g' || target === 'oz' || target === 'mg';
          results.push({ qty: roundWhole ? Math.round(converted) : parseFloat(converted.toFixed(2)), unit: target });
        }
      }
    }
  } else if (WEIGHT_TO_G[unit]) {
    const g = num * WEIGHT_TO_G[unit];
    for (const target of WEIGHT_UNITS) {
      if (target === unit) continue;
      const converted = g / WEIGHT_TO_G[target];
      if (converted >= 0.01 && converted <= 10000) {
        const roundWhole = target === 'g' || target === 'oz' || target === 'mg';
        results.push({ qty: roundWhole ? Math.round(converted) : parseFloat(converted.toFixed(2)), unit: target });
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
      const rounded = Math.round(grams);
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
  const presets = ['meat', 'pescatarian', 'vegan', 'vegetarian', 'keto', ''];
  return {
    title: recipe.title || '',
    category: recipe.category || 'lunch-dinner',
    frequency: recipe.frequency || 'common',
    mealType: presets.includes(type) ? type : 'custom',
    customMealType: presets.includes(type) ? '' : type,
    servings: recipe.servings || '1',
    prepTime: recipe.prepTime || '',
    cookTime: recipe.cookTime || '',
    sourceUrl: recipe.sourceUrl || '',
    totalWeight: recipe.totalWeight || '',
    containerWeight: recipe.containerWeight || '',
    starterRecipe: recipe.starterRecipe || false,
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

export function RecipeDetail({ recipe, onSave, onDelete, onBack, user, ingredientsVersion }) {
  const [fields, setFields] = useState(() => recipe ? initFields(recipe) : null);
  const [showShareDropdown, setShowShareDropdown] = useState(false);
  const [friendsList, setFriendsList] = useState(null);
  const [shareMsg, setShareMsg] = useState(null);
  const shareRef = useRef(null);
  const [boosted, setBoosted] = useState(() => {
    try {
      const list = JSON.parse(localStorage.getItem('sunday-boosted-recipes') || '[]');
      return recipe ? list.includes(recipe.id) : false;
    } catch { return false; }
  });
  const [adjustedServings, setAdjustedServings] = useState(null);
  const [servingWeight, setServingWeight] = useState('');
  const [editingIngredients, setEditingIngredients] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [convertPopup, setConvertPopup] = useState(null); // { rowIdx, options: [{ qty, unit, label }] }
  const convertPopupRef = useRef(null);
  const [activeAutoIdx, setActiveAutoIdx] = useState(-1);

  // Compute days since this recipe was last prepared
  const daysSinceLastPrepped = useMemo(() => {
    if (!recipe) return null;
    let lastDate = null;
    // Check plan history
    try {
      const data = localStorage.getItem('sunday-plan-history');
      const history = data ? JSON.parse(data) : [];
      for (const entry of history) {
        if (entry.recipeIds?.includes(recipe.id)) {
          if (!lastDate || entry.date > lastDate) lastDate = entry.date;
        }
      }
    } catch {}
    // Check daily tracker
    try {
      const data = localStorage.getItem('sunday-daily-log');
      const log = data ? JSON.parse(data) : {};
      for (const [dateStr, dayData] of Object.entries(log)) {
        for (const entry of (dayData.entries || [])) {
          if (entry.type === 'recipe' && entry.recipeId === recipe.id) {
            if (!lastDate || dateStr > lastDate) lastDate = dateStr;
          }
        }
      }
    } catch {}
    if (!lastDate) return null;
    const then = new Date(lastDate + 'T00:00:00');
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((now - then) / (1000 * 60 * 60 * 24));
  }, [recipe]);

  // Build lookup maps from ingredient database
  const { dbNotesMap, dbGramsMap, dbMeasurementMap, dbLinksMap, dbNamesSet, dbNamesList } = useMemo(() => {
    const notes = new Map();
    const grams = new Map();
    const measurements = new Map();
    const links = new Map();
    const names = new Set();
    const namesList = [];
    const data = loadIngredients();
    if (data) {
      for (const item of data) {
        const key = (item.ingredient || '').trim().toLowerCase();
        if (!key) continue;
        names.add(key);
        namesList.push((item.ingredient || '').trim());
        if (item.notes) notes.set(key, item.notes);
        grams.set(key, parseFloat(item.grams) || 0);
        if (item.measurement) measurements.set(key, item.measurement.trim());
        if (item.link) links.set(key, item.link.trim());
      }
    }
    namesList.sort((a, b) => a.localeCompare(b));
    return { dbNotesMap: notes, dbGramsMap: grams, dbMeasurementMap: measurements, dbLinksMap: links, dbNamesSet: names, dbNamesList: namesList };
  }, [ingredientsVersion]);

  function getDbNotes(ingredientName) {
    if (!ingredientName) return null;
    const search = ingredientName.trim().toLowerCase();
    if (dbNotesMap.has(search)) return dbNotesMap.get(search);
    for (const [name, notes] of dbNotesMap) {
      if (name.startsWith(search) || search.startsWith(name)) return notes;
    }
    for (const [name, notes] of dbNotesMap) {
      if (name.includes(search) || search.includes(name)) return notes;
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
    // Fallback: check if any word in the search appears in a DB name or vice versa
    for (const [name, grams] of dbGramsMap) {
      if (name.includes(search) || search.includes(name)) return grams;
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
    for (const [name, m] of dbMeasurementMap) {
      if (name.includes(search) || search.includes(name)) return m;
    }
    return '';
  }

  function getDbLink(ingredientName) {
    if (!ingredientName) return '';
    const search = ingredientName.trim().toLowerCase();
    if (dbLinksMap.has(search)) return dbLinksMap.get(search);
    for (const [name, link] of dbLinksMap) {
      if (name.startsWith(search) || search.startsWith(name)) return link;
    }
    for (const [name, link] of dbLinksMap) {
      if (name.includes(search) || search.includes(name)) return link;
    }
    return '';
  }

  function isInDb(ingredientName) {
    if (!ingredientName) return true; // don't warn on empty rows
    const search = ingredientName.trim().toLowerCase();
    if (!search) return true;
    if (dbNamesSet.has(search)) return true;
    for (const name of dbNamesSet) {
      if (name.startsWith(search) || search.startsWith(name)) return true;
    }
    for (const name of dbNamesSet) {
      if (name.includes(search) || search.includes(name)) return true;
    }
    return false;
  }

  const baseServings = parseInt(fields?.servings) || 1;
  const totalWeightNum = parseFloat(fields?.totalWeight) || 0;
  const containerWeightNum = parseFloat(fields?.containerWeight) || 0;
  const foodWeight = Math.max(0, totalWeightNum - containerWeightNum);
  const defaultServingWeight = (foodWeight > 0 && baseServings > 0)
    ? String(Math.round(foodWeight / baseServings))
    : '';
  const servingWeightNum = parseFloat(servingWeight || defaultServingWeight) || 0;
  const weightBasedServings = (foodWeight > 0 && servingWeightNum > 0)
    ? (servingWeightNum / foodWeight) * baseServings
    : null;
  const currentServings = weightBasedServings ?? adjustedServings ?? baseServings;
  const scaleFactor = baseServings > 0 ? currentServings / baseServings : 1;

  function scaleQuantity(qty) {
    const num = parseFraction(qty);
    if (num === 0) return qty;
    const scaled = num * scaleFactor;
    return formatQuantity(scaled);
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

  function addToppingRow() {
    setFields(prev => ({
      ...prev,
      ingredients: [...prev.ingredients, { ...emptyRow, topping: true }],
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

  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  function handleIngredientDragStart(e, index) {
    setDragIdx(index);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleIngredientDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(index);
  }

  function handleIngredientDrop(e, index) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === index) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    setFields(prev => {
      const items = [...prev.ingredients];
      const [moved] = items.splice(dragIdx, 1);
      items.splice(index, 0, moved);
      return { ...prev, ingredients: items };
    });
    setDragIdx(null);
    setDragOverIdx(null);
  }

  function handleIngredientDragEnd() {
    setDragIdx(null);
    setDragOverIdx(null);
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

  function moveStep(from, to) {
    if (to < 0 || to >= fields.steps.length) return;
    setFields(prev => {
      const items = [...prev.steps];
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return { ...prev, steps: items };
    });
  }

  const [stepDragIdx, setStepDragIdx] = useState(null);
  const [stepDragOverIdx, setStepDragOverIdx] = useState(null);

  function handleStepDragStart(e, index) {
    setStepDragIdx(index);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleStepDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setStepDragOverIdx(index);
  }

  function handleStepDrop(e, index) {
    e.preventDefault();
    if (stepDragIdx === null || stepDragIdx === index) {
      setStepDragIdx(null);
      setStepDragOverIdx(null);
      return;
    }
    setFields(prev => {
      const items = [...prev.steps];
      const [moved] = items.splice(stepDragIdx, 1);
      items.splice(index, 0, moved);
      return { ...prev, steps: items };
    });
    setStepDragIdx(null);
    setStepDragOverIdx(null);
  }

  function handleStepDragEnd() {
    setStepDragIdx(null);
    setStepDragOverIdx(null);
  }

  function handleSave() {
    onSave({
      title: fields.title.trim(),
      category: fields.category,
      frequency: fields.frequency,
      mealType: (() => {
        const manual = fields.mealType === 'custom' ? fields.customMealType.trim() : fields.mealType;
        if (manual) return manual;
        const ings = fields.ingredients.filter(row => row.ingredient.trim() !== '');
        return classifyMealType(ings);
      })(),
      servings: fields.servings.trim() || '1',
      prepTime: fields.prepTime.trim(),
      cookTime: fields.cookTime.trim(),
      sourceUrl: fields.sourceUrl.trim(),
      totalWeight: fields.totalWeight.trim(),
      containerWeight: fields.containerWeight.trim(),
      starterRecipe: fields.starterRecipe,
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

  // Close convert popup on outside click
  useEffect(() => {
    if (!convertPopup) return;
    function handleClickOutside(e) {
      if (convertPopupRef.current && !convertPopupRef.current.contains(e.target)) {
        setConvertPopup(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [convertPopup]);

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

  function handleBoostToggle() {
    try {
      const list = JSON.parse(localStorage.getItem('sunday-boosted-recipes') || '[]');
      let next;
      if (list.includes(recipe.id)) {
        next = list.filter(id => id !== recipe.id);
        setBoosted(false);
      } else {
        next = [...list, recipe.id];
        setBoosted(true);
      }
      localStorage.setItem('sunday-boosted-recipes', JSON.stringify(next));
    } catch {}
  }

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
          <div className={styles.titleRow}>
            <input
              className={`${styles.inlineInput} ${styles.titleInput}`}
              type="text"
              value={fields.title}
              onChange={e => setField('title', e.target.value)}
            />
            <span className={styles.lastPrepBadge}>
              {daysSinceLastPrepped === 0
                ? 'Prepped today'
                : daysSinceLastPrepped != null
                  ? `${daysSinceLastPrepped}d since last prepped`
                  : 'Never prepped'}
            </span>
          </div>

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
                <option value="keto">Keto</option>
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
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  className={styles.inlineInput}
                  type="text"
                  value={fields.sourceUrl}
                  onChange={e => setField('sourceUrl', e.target.value)}
                  placeholder="Recipe link"
                  style={{ flex: 1 }}
                />
                {fields.sourceUrl.trim() && (
                  <a
                    href={fields.sourceUrl.trim().startsWith('http') ? fields.sourceUrl.trim() : `https://${fields.sourceUrl.trim()}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.sourceLink}
                  >
                    Open
                  </a>
                )}
              </div>
            </label>
          </div>

          {user?.uid === ADMIN_UID && (
            <div className={styles.metaRow}>
              <label className={styles.metaLabel} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={fields.starterRecipe}
                  onChange={e => setField('starterRecipe', e.target.checked)}
                />
                Include in starter recipes
              </label>
            </div>
          )}
      </div>

      {user && (
        <div className={styles.shareRow}>
          <div className={styles.shareWrapper} ref={shareRef}>
            <button className={styles.shareBtn} onClick={handleShareClick}>
              Share This Recipe
            </button>
            <button
              className={`${styles.shareBtn} ${boosted ? styles.boostBtnActive : ''}`}
              onClick={handleBoostToggle}
            >
              {boosted ? '★ Added to Next Week' : '☆ Add This to Next Week\'s Shopping List'}
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

      <NutritionPanel
        recipeId={recipe.id}
        ingredients={fields.ingredients}
        servings={(foodWeight > 0 && servingWeightNum > 0) ? foodWeight / servingWeightNum : (adjustedServings ?? baseServings)}
        portionLabel={servingWeightNum > 0 && foodWeight > 0 ? `My portion (${servingWeight}g)` : null}
      />

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
                <>
                  <button
                    className={styles.servingReset}
                    type="button"
                    onClick={() => setAdjustedServings(null)}
                  >
                    Reset
                  </button>
                  <button
                    className={styles.servingSave}
                    type="button"
                    onClick={() => {
                      const factor = baseServings > 0 ? adjustedServings / baseServings : 1;
                      setFields(prev => ({
                        ...prev,
                        servings: String(adjustedServings),
                        ingredients: prev.ingredients.map(row => {
                          const num = parseFraction(row.quantity);
                          if (num === 0) return row;
                          return { ...row, quantity: formatQuantity(num * factor) };
                        }),
                      }));
                      setAdjustedServings(null);
                    }}
                  >
                    Save
                  </button>
                </>
              )}
            </div>
            {editingIngredients ? (
              <>
                <button
                  className={styles.editToggleBtn}
                  type="button"
                  onClick={() => {
                    const restored = (recipe.ingredients && recipe.ingredients.length > 0)
                      ? recipe.ingredients.map(r => ({ ...r }))
                      : [{ ...emptyRow }];
                    setFields(prev => ({ ...prev, ingredients: restored }));
                    setEditingIngredients(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  className={styles.editToggleBtn}
                  type="button"
                  onClick={() => setEditingIngredients(false)}
                >
                  Save
                </button>
              </>
            ) : (
              <button
                className={styles.editToggleBtn}
                type="button"
                onClick={() => setEditingIngredients(true)}
              >
                Edit
              </button>
            )}
          </div>
        </div>

        <details className={styles.weightDetails}>
          <summary>Scale weight</summary>
          <div className={styles.weightAdjuster}>
            <label className={styles.weightLabel}>
              Total weight
              <input
                className={styles.weightInput}
                type="number"
                min="0"
                placeholder="g"
                value={fields.totalWeight}
                onChange={e => setField('totalWeight', e.target.value)}
              />
            </label>
            <label className={styles.weightLabel}>
              Container
              <input
                className={styles.weightInput}
                type="number"
                min="0"
                placeholder="g"
                value={fields.containerWeight}
                onChange={e => setField('containerWeight', e.target.value)}
              />
            </label>
            {totalWeightNum > 0 && (
              <span className={styles.weightCalc}>
                Food: {foodWeight}g
              </span>
            )}
            {foodWeight > 0 && (
              <>
                <label className={styles.weightLabel}>
                  My serving
                  <input
                    className={styles.weightInput}
                    type="number"
                    min="0"
                    placeholder="g"
                    value={servingWeight || defaultServingWeight}
                    onChange={e => setServingWeight(e.target.value)}
                  />
                </label>
                {weightBasedServings !== null && (
                  <span className={styles.weightResult}>
                    = {parseFloat(weightBasedServings.toFixed(2))} {weightBasedServings === 1 ? 'serving' : 'servings'}
                  </span>
                )}
              </>
            )}
          </div>
        </details>

        {editingIngredients ? (
          <>
            <table className={styles.ingredientTable}>
              <thead>
                <tr>
                  <th></th>
                  <th className={styles.colQty}>Qty</th>
                  <th className={styles.colMeasure}>Unit</th>
                  <th>Type</th>
                  <th>Ingredient</th>
                  <th className={styles.colGrams}>Grams</th>
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const mainIdxRows = fields.ingredients.map((row, i) => ({ row, idx: i })).filter(({ row }) => !row.topping);
                  const toppingIdxRows = fields.ingredients.map((row, i) => ({ row, idx: i })).filter(({ row }) => row.topping);
                  const renderRow = ({ row, idx: i }) => {
                  const dbGrams = getDbGrams(row.ingredient);
                  const dbMeasurement = getDbMeasurement(row.ingredient);
                  const dbNotes = getDbNotes(row.ingredient);
                  const unitType = classifyUnit(row.measurement);
                  const liquid = isLiquid(row.ingredient);
                  const conversions = getConversions(row.quantity, row.measurement, dbGrams);
                  const crossConv = getCrossConversion(row.quantity, row.measurement, dbGrams, dbMeasurement);
                  return (
                  <tr
                    key={i}
                    draggable
                    onDragStart={e => handleIngredientDragStart(e, i)}
                    onDragOver={e => handleIngredientDragOver(e, i)}
                    onDrop={e => handleIngredientDrop(e, i)}
                    onDragEnd={handleIngredientDragEnd}
                    className={`${dragIdx === i ? styles.draggingRow : ''} ${dragOverIdx === i && dragIdx !== i ? styles.dragOverRow : ''}`}
                  >
                    <td className={styles.dragHandle}>&#x2630;</td>
                    {ingredientFields.map((field, colIdx) => (
                      <React.Fragment key={field}>
                        <td className={field === 'quantity' ? styles.colQty : field === 'measurement' ? styles.colMeasure : undefined}>
                          <div className={field === 'ingredient' ? styles.ingredientInputWrap : undefined}>
                            {field === 'ingredient' ? (
                              <div className={styles.autoWrap}>
                                <input
                                  className={styles.cellInput}
                                  type="text"
                                  value={row[field] || ''}
                                  onChange={e => {
                                    updateIngredient(i, field, e.target.value);
                                    setActiveAutoIdx(i);
                                  }}
                                  onFocus={() => setActiveAutoIdx(i)}
                                  onBlur={() => setTimeout(() => setActiveAutoIdx(-1), 150)}
                                  onPaste={e => handlePaste(e, i, colIdx)}
                                  placeholder="flour"
                                />
                                {activeAutoIdx === i && (row.ingredient || '').trim() && (() => {
                                  const q = (row.ingredient || '').trim().toLowerCase();
                                  const matches = dbNamesList.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
                                  return matches.length > 0 ? (
                                    <ul className={styles.suggestions}>
                                      {matches.map(name => (
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
                                  ) : null;
                                })()}
                              </div>
                            ) : (
                              <input
                                className={styles.cellInput}
                                type="text"
                                value={row[field] || ''}
                                onChange={e => updateIngredient(i, field, e.target.value)}
                                onPaste={e => handlePaste(e, i, colIdx)}
                                placeholder={
                                  field === 'quantity' ? '1' :
                                  field === 'measurement' ? 'cup' : ''
                                }
                              />
                            )}
                            {field === 'ingredient' && (row.ingredient || '').trim() && !isInDb(row.ingredient) && (
                              <span className={styles.dbWarning} title="Not found in ingredient database">⚠</span>
                            )}
                            {field === 'ingredient' && (row.ingredient || '').trim() && isInDb(row.ingredient) && unitType === 'volume' && !dbGrams && (
                              <span className={styles.noWeightWarning} title="No weight conversion available — add grams to ingredient database">⚖</span>
                            )}
                          </div>
                        </td>
                        {field === 'measurement' && (
                          <>
                            <td style={{ position: 'relative' }}>
                              {unitType ? (
                                <>
                                <button
                                  className={styles.typeBtn}
                                  type="button"
                                  disabled={!parseFloat(row.quantity)}
                                  title={!parseFloat(row.quantity) ? 'Quantity is 0' : 'Convert unit'}
                                  onClick={() => {
                                    // Build volume options
                                    const volumeOptions = [];
                                    if (crossConv.volume) {
                                      const parts = crossConv.volume.match(/^([\d.]+)\s+(.+)$/);
                                      if (parts) volumeOptions.push({ qty: parts[1], unit: parts[2], label: `${parts[1]} ${parts[2]}` });
                                    }
                                    for (const c of conversions) {
                                      if (!VOLUME_TO_ML[c.unit]) continue;
                                      if (volumeOptions.some(o => o.unit === c.unit)) continue;
                                      volumeOptions.push({ qty: String(c.qty), unit: c.unit, label: `${c.qty} ${c.unit}` });
                                    }
                                    // Build weight options
                                    const weightOptions = [];
                                    if (crossConv.weight) {
                                      const parts = crossConv.weight.match(/^([\d.]+)\s*(.+)$/);
                                      if (parts) weightOptions.push({ qty: parts[1], unit: parts[2], label: `${parts[1]} ${parts[2]}` });
                                    }
                                    for (const c of conversions) {
                                      if (!WEIGHT_TO_G[c.unit]) continue;
                                      const displayUnit = c.unit === 'g' ? (c.qty === 1 ? 'gram' : 'grams') : c.unit;
                                      if (weightOptions.some(o => o.unit === displayUnit)) continue;
                                      weightOptions.push({ qty: String(c.qty), unit: displayUnit, label: `${c.qty} ${displayUnit}` });
                                    }
                                    if (volumeOptions.length > 0 || weightOptions.length > 0) {
                                      setConvertPopup({ rowIdx: i, volumeOptions, weightOptions });
                                    }
                                  }}
                                >
                                  {unitType === 'weight' ? 'Weight' : 'Volume'}
                                </button>
                                {convertPopup && convertPopup.rowIdx === i && (
                                  <div className={styles.convertPopup} ref={convertPopupRef}>
                                    <div className={styles.convertPopupColumns}>
                                      {convertPopup.volumeOptions.length > 0 && (
                                        <div className={styles.convertPopupCol}>
                                          <div className={styles.convertPopupTitle}>Volume</div>
                                          {convertPopup.volumeOptions.map((opt, oi) => (
                                            <button
                                              key={`v${oi}`}
                                              className={styles.convertPopupOption}
                                              onClick={() => {
                                                updateIngredient(i, 'quantity', opt.qty);
                                                updateIngredient(i, 'measurement', opt.unit);
                                                setConvertPopup(null);
                                              }}
                                            >
                                              {opt.label}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                      {convertPopup.weightOptions.length > 0 && (
                                        <div className={styles.convertPopupCol}>
                                          <div className={styles.convertPopupTitle}>Weight</div>
                                          {convertPopup.weightOptions.map((opt, oi) => (
                                            <button
                                              key={`w${oi}`}
                                              className={styles.convertPopupOption}
                                              onClick={() => {
                                                updateIngredient(i, 'quantity', opt.qty);
                                                updateIngredient(i, 'measurement', opt.unit);
                                                setConvertPopup(null);
                                              }}
                                            >
                                              {opt.label}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                                </>
                              ) : (
                                <span className={styles.typeLabel}>
                                  {(row.measurement || '').trim() ? 'Other' : ''}
                                </span>
                              )}
                            </td>
                          </>
                        )}
                      </React.Fragment>
                    ))}
                    <td className={styles.gramsCell}>
                      {dbGrams > 0 ? dbGrams : <span className={styles.gramsEmpty}>—</span>}
                    </td>
                    <td className={styles.linkCell}>
                      {(() => { const link = getDbLink(row.ingredient); return link ? (
                        <a href={link} target="_blank" rel="noopener noreferrer" className={styles.ingredientLink} title={link}>Link</a>
                      ) : null; })()}
                    </td>
                    <td>
                      <button
                        className={styles.toggleSectionBtn}
                        type="button"
                        onClick={() => updateIngredient(i, 'topping', !row.topping)}
                        title={row.topping ? 'Move to main ingredients' : 'Move to per meal'}
                      >
                        {row.topping ? '\u2191' : '\u2193'}
                      </button>
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
                  };
                  return (
                    <>
                      {mainIdxRows.map(renderRow)}
                      <tr className={styles.sectionDivider}><td colSpan={8}>Per Meal</td></tr>
                      {toppingIdxRows.map(renderRow)}
                    </>
                  );
                })()}
              </tbody>
            </table>
            <div className={styles.ingredientBtns}>
              <button className={styles.addRowBtn} type="button" onClick={addRow}>
                + Add ingredient
              </button>
              <button className={styles.addRowBtn} type="button" onClick={addToppingRow}>
                + Add per meal
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
                <th>Amount</th>
                <th>Ingredient</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const visibleRows = fields.ingredients
                  .map((row, i) => ({ row, origIdx: i }))
                  .filter(({ row }) => (row.ingredient || '').trim());
                const mainRows = visibleRows.filter(({ row }) => !row.topping);
                const toppingRows = visibleRows.filter(({ row }) => row.topping);
                const renderViewRow = ({ row, origIdx }) => {
                  const dbNotes = getDbNotes(row.ingredient);
                  const dbLink = getDbLink(row.ingredient);
                  const noWeight = isInDb(row.ingredient) && classifyUnit(row.measurement) === 'volume' && !getDbGrams(row.ingredient);
                  const rawQty = row.quantity || '';
                  const displayQty = rawQty ? scaleQuantity(rawQty) : '';
                  const amount = [displayQty, displayMeasurement(row.measurement, row.ingredient, displayQty)].filter(Boolean).join(' ');
                  return (
                    <tr key={origIdx}>
                      <td className={scaleFactor !== 1 ? styles.scaledQty : ''}>
                        {amount}
                      </td>
                      <td>
                        {row.ingredient}
                        {!isInDb(row.ingredient) && (
                          <span className={styles.dbWarning} title="Not found in ingredient database"> ⚠</span>
                        )}
                        {noWeight && (
                          <span className={styles.noWeightWarning} title="No weight conversion available — add grams to ingredient database"> ⚖</span>
                        )}
                      </td>
                      <td className={styles.linkCell}>
                        {dbLink && (
                          <a href={dbLink} target="_blank" rel="noopener noreferrer" className={styles.ingredientLink} title={dbLink}>
                            Link
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                };
                return (
                  <>
                    {mainRows.map(renderViewRow)}
                    {toppingRows.length > 0 && (
                      <>
                        <tr className={styles.sectionDivider}><td colSpan={3}>Per Meal</td></tr>
                        {toppingRows.map(renderViewRow)}
                      </>
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.section}>
        <h3>Instructions</h3>
        <ol className={styles.stepsList}>
          {fields.steps.map((step, i) => (
            <li
              key={i}
              className={`${styles.stepRow} ${stepDragIdx === i ? styles.draggingRow : ''} ${stepDragOverIdx === i ? styles.dragOverRow : ''}`}
              draggable
              onDragStart={e => handleStepDragStart(e, i)}
              onDragOver={e => handleStepDragOver(e, i)}
              onDrop={e => handleStepDrop(e, i)}
              onDragEnd={handleStepDragEnd}
            >
              <div className={styles.stepHeader}>
                <span className={styles.dragHandle} title="Drag to reorder">≡</span>
                <span className={styles.stepLabel}>Step {i + 1}</span>
                <div className={styles.stepArrows}>
                  {i > 0 && (
                    <button
                      className={styles.stepArrowBtn}
                      type="button"
                      onClick={() => moveStep(i, i - 1)}
                      title="Move up"
                    >
                      ↑
                    </button>
                  )}
                  {i < fields.steps.length - 1 && (
                    <button
                      className={styles.stepArrowBtn}
                      type="button"
                      onClick={() => moveStep(i, i + 1)}
                      title="Move down"
                    >
                      ↓
                    </button>
                  )}
                </div>
              </div>
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
