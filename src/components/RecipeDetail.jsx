import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NutritionPanel, PlateChart, MealScore } from './NutritionPanel';
import { BarcodeScanner } from './BarcodeScanner';
import { loadFriends, shareRecipe, getUsername, createShareLink } from '../utils/firestoreSync';
import { loadIngredients } from '../utils/ingredientsStore';
import { VOLUME_TO_ML, WEIGHT_TO_G, SIZE_GRAMS, getSizeGrams } from '../utils/units';
import { classifyMealType } from '../utils/classifyMealType';
import { uploadMealImage, deleteMealImage, getCachedMealImage, generateMealImage } from '../utils/generateMealImage';
import { getIngredientTags, getTagInfo } from '../utils/ingredientTags';
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

const SIZE_UNITS = ['small', 'medium', 'large', 'extra large', 'xl', 'regular'];

function classifyUnit(measurement) {
  if (!measurement) return null;
  const unit = normalizeUnit(measurement);
  if (!unit) return null;
  if (VOLUME_TO_ML[unit]) return 'volume';
  if (WEIGHT_TO_G[unit]) return 'weight';
  if (SIZE_UNITS.includes(unit)) return 'size';
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

const CUISINE_OPTIONS = [
  'American', 'Brazilian', 'Caribbean', 'Chinese', 'Ethiopian', 'Filipino',
  'French', 'German', 'Greek', 'Indian', 'Indonesian', 'Irish',
  'Israeli', 'Italian', 'Jamaican', 'Japanese', 'Korean', 'Lebanese',
  'Malaysian', 'Mediterranean', 'Mexican', 'Moroccan', 'Peruvian', 'Polish',
  'Spanish', 'Swedish', 'Thai', 'Turkish', 'Vietnamese', 'Other',
];

function renderFormattedText(text) {
  if (!text) return text;
  // Render stored HTML or plain text
  if (text.includes('<')) {
    return <span dangerouslySetInnerHTML={{ __html: text }} />;
  }
  // Legacy markdown support
  let html = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<u>$1</u>');
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function applyFormat(command) {
  document.execCommand(command, false, null);
}

function initFields(recipe) {
  const type = recipe.mealType || '';
  const presets = ['meat', 'pescatarian', 'vegan', 'vegetarian', 'keto', ''];
  const cuisineVal = recipe.cuisine || '';
  const isPresetCuisine = CUISINE_OPTIONS.map(c => c.toLowerCase()).includes(cuisineVal.toLowerCase());
  return {
    title: recipe.title || '',
    category: recipe.category || 'lunch-dinner',
    frequency: recipe.frequency || 'common',
    cuisine: isPresetCuisine ? cuisineVal : (cuisineVal ? 'other' : ''),
    customCuisine: (!isPresetCuisine && cuisineVal) ? cuisineVal : '',
    mealType: presets.includes(type) ? type : 'custom',
    customMealType: presets.includes(type) ? '' : type,
    servings: recipe.servings || '1',
    prepTime: recipe.prepTime || '',
    cookTime: recipe.cookTime || '',
    sourceUrl: recipe.sourceUrl || '',
    totalWeight: recipe.totalWeight || '',
    containerWeight: recipe.containerWeight || '',
    containers: recipe.containers || [{ label: '', weight: '' }],
    starterRecipe: recipe.starterRecipe || false,
    notes: recipe.notes || '',
    ingredients: (recipe.ingredients && recipe.ingredients.length > 0)
      ? recipe.ingredients.map(r => ({ ...r }))
      : [{ ...emptyRow }],
    steps: (() => {
      // Prefer stepsArray (preserves line breaks within steps) over instructions string
      if (recipe.stepsArray && recipe.stepsArray.length > 0) {
        return recipe.stepsArray;
      }
      const parsed = (recipe.instructions || '')
        .split('\n')
        .map(s => s.replace(/^\d+[\.\)]\s*/, '').trim())
        .filter(Boolean);
      return parsed.length > 0 ? parsed : [''];
    })(),
    stepIngredients: recipe.stepIngredients || {},
    stepSections: recipe.stepSections || {},
  };
}

export function RecipeDetail({ recipe, onSave, onDelete, onBack, onAddToWeek, weeklyPlan, user, ingredientsVersion, onViewSources }) {
  const [fields, setFields] = useState(() => recipe ? initFields(recipe) : null);
  const [showShareDropdown, setShowShareDropdown] = useState(false);
  const [friendsList, setFriendsList] = useState(null);
  const [shareMsg, setShareMsg] = useState(null);
  const [nutritionTotals, setNutritionTotals] = useState(null);
  const shareRef = useRef(null);
  const isInWeek = recipe ? (weeklyPlan || []).includes(recipe.id) : false;
  const [adjustedServings, setAdjustedServings] = useState(null);
  const [servingWeight, setServingWeight] = useState('');
  const [editing, setEditing] = useState(true);
  const autoSaveRef = useRef(null);
  const [cookMode, setCookMode] = useState(() => {
    try { return localStorage.getItem('sunday-cook-mode') === 'true'; } catch { return false; }
  });
  const editingIngredients = editing;
  const [showSaved, setShowSaved] = useState(0);
  const [mealImage, setMealImage] = useState(() => recipe ? getCachedMealImage(recipe.id) : null);
  const [imageError, setImageError] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const imageInputRef = useRef(null);

  async function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    setImageError(null);
    try {
      const dataUrl = await uploadMealImage(recipe.id, file, user?.uid);
      setMealImage(dataUrl);
    } catch (err) {
      setImageError('Failed to process image');
    }
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleImageFile(file);
    e.target.value = '';
  }

  const [dragOver, setDragOver] = useState(false);

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  async function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    await handleImageFile(file);
  }

  useEffect(() => {
    function handlePaste(e) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          handleImageFile(item.getAsFile());
          return;
        }
      }
    }
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [recipe?.id, user?.uid]);

  async function handleGenerateImage() {
    setImageLoading(true);
    setImageError(null);
    try {
      const dataUrl = await generateMealImage(recipe.id, fields.title, fields.ingredients, user?.uid);
      setMealImage(dataUrl);
    } catch (err) {
      console.error('Image generation error:', err);
      setImageError('Failed to generate image. Try again.');
    } finally {
      setImageLoading(false);
    }
  }

  function handleDeleteImage() {
    deleteMealImage(recipe.id, user?.uid);
    setMealImage(null);
  }
  const [showScanner, setShowScanner] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef(null);
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
  const { dbNotesMap, dbGramsMap, dbMeasurementMap, dbLinksMap, dbNamesSet, dbNamesList, dbRowsByName } = useMemo(() => {
    const notes = new Map();
    const grams = new Map();
    const measurements = new Map();
    const links = new Map();
    const names = new Set();
    const namesList = [];
    const rowsByName = new Map(); // ingredient name → array of all DB rows
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
        // Group all rows by base ingredient name (strip size suffixes for matching)
        if (!rowsByName.has(key)) rowsByName.set(key, []);
        rowsByName.get(key).push(item);
      }
    }
    namesList.sort((a, b) => a.localeCompare(b));
    return { dbNotesMap: notes, dbGramsMap: grams, dbMeasurementMap: measurements, dbLinksMap: links, dbNamesSet: names, dbNamesList: namesList, dbRowsByName: rowsByName };
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

  // Find all DB rows matching an ingredient name (for size options)
  function getDbSizeRows(ingredientName) {
    if (!ingredientName) return [];
    const search = ingredientName.trim().toLowerCase();
    // Collect all rows whose ingredient name matches (exact, starts-with, or contains)
    const results = [];
    for (const [name, rows] of dbRowsByName) {
      if (name === search || name.startsWith(search) || search.startsWith(name) || name.includes(search) || search.includes(name)) {
        for (const row of rows) {
          const meas = (row.measurement || '').trim();
          const g = parseFloat(row.grams) || 0;
          if (meas && g > 0) {
            results.push({ measurement: meas, grams: g, ingredient: (row.ingredient || '').trim() });
          }
        }
      }
    }
    return results;
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
  const containerWeightNum = (fields?.containers || []).reduce((sum, c) => sum + (parseFloat(c.weight) || 0), 0) || parseFloat(fields?.containerWeight) || 0;
  const foodWeight = Math.max(0, totalWeightNum - containerWeightNum);
  const defaultServingWeight = (foodWeight > 0 && baseServings > 0)
    ? String(Math.round(foodWeight / baseServings))
    : '';
  const servingWeightNum = parseFloat(servingWeight || defaultServingWeight) || 0;
  const weightBasedServings = (foodWeight > 0 && servingWeightNum > 0)
    ? (servingWeightNum / foodWeight) * baseServings
    : null;
  const rawCurrentServings = weightBasedServings ?? adjustedServings ?? baseServings;
  const currentServings = typeof rawCurrentServings === 'number' ? parseFloat(rawCurrentServings.toFixed(2)) : rawCurrentServings;
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
    setFields(prev => {
      const newSteps = [...prev.steps, ''];
      // Ensure the new step index has no ingredients
      const newMap = { ...prev.stepIngredients };
      delete newMap[newSteps.length - 1];
      return { ...prev, steps: newSteps, stepIngredients: newMap };
    });
  }

  function removeStep(index) {
    setFields(prev => {
      const newSteps = prev.steps.filter((_, i) => i !== index);
      // Rebuild stepIngredients and stepSections with shifted indices
      const oldMap = prev.stepIngredients || {};
      const oldSections = prev.stepSections || {};
      const newMap = {};
      const newSections = {};
      for (const [key, val] of Object.entries(oldMap)) {
        const k = parseInt(key);
        if (k < index) newMap[k] = val;
        else if (k > index) newMap[k - 1] = val;
      }
      for (const [key, val] of Object.entries(oldSections)) {
        const k = parseInt(key);
        if (k < index) newSections[k] = val;
        else if (k > index) newSections[k - 1] = val;
      }
      return { ...prev, steps: newSteps, stepIngredients: newMap, stepSections: newSections };
    });
  }

  const [stepVersion, setStepVersion] = useState(0);

  function moveStep(from, to) {
    if (to < 0 || to >= fields.steps.length) return;
    setFields(prev => {
      // Build an array of [step, ingredients] pairs in original order
      const oldMap = prev.stepIngredients || {};
      const oldSections = prev.stepSections || {};
      const pairs = prev.steps.map((step, i) => ({ step, ings: oldMap[i] || [], section: oldSections[i] || '' }));
      // Move the pair
      const [moved] = pairs.splice(from, 1);
      pairs.splice(to, 0, moved);
      // Rebuild steps, stepIngredients, and stepSections from the reordered pairs
      const newSteps = pairs.map(p => p.step);
      const newMap = {};
      const newSections = {};
      pairs.forEach((p, i) => {
        if (p.ings.length > 0) newMap[i] = p.ings;
        if (p.section) newSections[i] = p.section;
      });
      return { ...prev, steps: newSteps, stepIngredients: newMap, stepSections: newSections };
    });
    setStepVersion(v => v + 1);
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
    // Use moveStep logic to keep ingredients with their steps
    setFields(prev => {
      const oldMap = prev.stepIngredients || {};
      const pairs = prev.steps.map((step, i) => ({ step, ings: oldMap[i] || [] }));
      const [moved] = pairs.splice(stepDragIdx, 1);
      pairs.splice(index, 0, moved);
      const newSteps = pairs.map(p => p.step);
      const newMap = {};
      pairs.forEach((p, i) => { if (p.ings.length > 0) newMap[i] = p.ings; });
      return { ...prev, steps: newSteps, stepIngredients: newMap };
    });
    setStepVersion(v => v + 1);
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
      cuisine: fields.cuisine === 'other' ? (fields.customCuisine.trim() || '') : fields.cuisine,
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
      containers: (fields.containers || []).filter(c => c.weight),
      starterRecipe: fields.starterRecipe,
      ingredients: fields.ingredients.filter(row => row.ingredient.trim() !== ''),
      notes: fields.notes || '',
      instructions: fields.steps.filter(s => s.trim()).map(s => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')).join('\n'),
      stepsArray: fields.steps,
      stepIngredients: fields.stepIngredients || {},
      stepSections: fields.stepSections || {},
    });
  }

  function handleCancel() {
    setFields(initFields(recipe));
    onBack();
  }

  // Save on unmount to prevent losing changes when modal closes
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  useEffect(() => {
    return () => { handleSaveRef.current(); };
  }, []);

  // Auto-save after 2 seconds of inactivity
  const initialRef = useRef(true);
  useEffect(() => {
    if (!fields || initialRef.current) {
      initialRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      handleSave();
      setShowSaved(k => k + 1);
    }, 2000);
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

  // Close add menu on outside click
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

  function handleAddToWeekClick() {
    if (!isInWeek && onAddToWeek) {
      onAddToWeek(recipe.id);
    }
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

      // Send email notification (fire-and-forget)
      if (friend.email) {
        fetch('/api/notify-friend-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'shared-recipe',
            toEmail: friend.email,
            toName: friend.displayName || friend.username || '',
            fromUsername: myUsername || user.displayName || '',
            recipeName: recipe.title || 'Untitled',
          }),
        }).catch(() => {});
      }

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
      <div className={styles.headerRow}>
        <button className={styles.backBtn} onClick={onBack}>
          &larr; Back to recipes
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className={styles.headerPrintBtn} onClick={() => window.print()}>
            Print
          </button>
          {user && (
            <>
              <div className={styles.shareWrapper} ref={shareRef}>
                <button className={styles.headerShareBtn} onClick={handleShareClick}>
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
                        {f.username ? `@${f.username}` : f.displayName || f.uid}
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
              <button
                className={`${styles.headerShareBtn} ${isInWeek ? styles.boostBtnActive : ''}`}
                onClick={handleAddToWeekClick}
                disabled={isInWeek}
              >
                {isInWeek ? '✓ Added' : '+ This Week'}
              </button>
            </>
          )}
          {showSaved > 0 && <span key={showSaved} className={styles.savedToast}>Saved!</span>}
        </div>
      </div>

      <div className={styles.topRow}>
        <div className={styles.topRowLeft}>
          <div className={styles.titleRow}>
            {editing ? (
              <input
                className={`${styles.inlineInput} ${styles.titleInput}`}
                type="text"
                value={fields.title}
                onChange={e => setField('title', e.target.value)}
              />
            ) : (
              <h1 className={styles.titleDisplay}>{fields.title}</h1>
            )}
            <span className={styles.lastPrepBadge}>
              {daysSinceLastPrepped === 0
                ? 'Prepped today'
                : daysSinceLastPrepped != null
                  ? `${daysSinceLastPrepped}d since last prepped`
                  : 'Never prepped'}
            </span>
          </div>

          {editing ? (
            <>
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
                  Prep Time
                  <input
                    className={`${styles.inlineInput} ${styles.metaInput}`}
                    type="text"
                    value={fields.prepTime}
                    onChange={e => setField('prepTime', e.target.value)}
                    placeholder="-"
                  />
                </label>
                <label className={styles.metaLabel}>
                  Cook Time
                  <input
                    className={`${styles.inlineInput} ${styles.metaInput}`}
                    type="text"
                    value={fields.cookTime}
                    onChange={e => setField('cookTime', e.target.value)}
                    placeholder="-"
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
                <label className={styles.metaLabel}>
                  Cuisine
                  <select
                    className={styles.inlineSelect}
                    value={fields.cuisine}
                    onChange={e => {
                      setField('cuisine', e.target.value);
                      if (e.target.value !== 'other') setField('customCuisine', '');
                    }}
                  >
                    <option value="">— None —</option>
                    {CUISINE_OPTIONS.map(c => (
                      <option key={c} value={c.toLowerCase()}>{c}</option>
                    ))}
                  </select>
                </label>
                {fields.cuisine === 'other' && (
                  <input
                    className={`${styles.inlineInput} ${styles.metaInput}`}
                    type="text"
                    value={fields.customCuisine}
                    onChange={e => setField('customCuisine', e.target.value)}
                    placeholder="e.g. Cajun, Peruvian"
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

            </>
          ) : (
            <>
              <div className={styles.metaRow}>
                <span className={styles.metaValue}>Serves {fields.servings || '-'}</span>
                <span className={styles.metaDot}>&middot;</span>
                <span className={styles.metaValue}>Prep Time {fields.prepTime || '-'}</span>
                <span className={styles.metaDot}>&middot;</span>
                <span className={styles.metaValue}>Cook Time {fields.cookTime || '-'}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaValue} style={{ textTransform: 'capitalize' }}>{(fields.category || '').replace('-', ' & ')}</span>
                <span className={styles.metaDot}>&middot;</span>
                <span className={styles.metaValue} style={{ textTransform: 'capitalize' }}>{fields.frequency || 'common'}</span>
                {(fields.mealType && fields.mealType !== 'custom') && (
                  <>
                    <span className={styles.metaDot}>&middot;</span>
                    <span className={styles.metaValue} style={{ textTransform: 'capitalize' }}>{fields.mealType}</span>
                  </>
                )}
                {fields.mealType === 'custom' && fields.customMealType && (
                  <>
                    <span className={styles.metaDot}>&middot;</span>
                    <span className={styles.metaValue}>{fields.customMealType}</span>
                  </>
                )}
                <span className={styles.metaDot}>&middot;</span>
                <span className={styles.metaValue} style={{ textTransform: 'capitalize' }}>{recipe.cuisine || 'No cuisine'}</span>
              </div>
              <div className={styles.metaRow}>
                {fields.sourceUrl.trim() ? (
                  <a
                    href={fields.sourceUrl.trim().startsWith('http') ? fields.sourceUrl.trim() : `https://${fields.sourceUrl.trim()}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.sourceLink}
                  >
                    View source recipe
                  </a>
                ) : (
                  <span className={styles.metaValue}>No source URL</span>
                )}
              </div>
            </>
          )}

        </div>
          <div
            className={`${styles.mealImageSection} ${dragOver ? styles.mealImageDragOver : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {mealImage ? (
              <div className={styles.mealImageWrap}>
                <img src={mealImage} alt={fields.title} className={styles.mealImage} />
                {editing && (
                  <div className={styles.imageActions}>
                    <button className={styles.regenBtn} onClick={() => imageInputRef.current?.click()}>Upload</button>
                    <button className={styles.regenBtn} onClick={handleGenerateImage} disabled={imageLoading}>{imageLoading ? 'Generating...' : 'Generate'}</button>
                    <button className={styles.regenBtn} onClick={handleDeleteImage}>Remove</button>
                  </div>
                )}
                {dragOver && <div className={styles.dropOverlay}>Drop image here</div>}
              </div>
            ) : editing ? (
              <div className={styles.imagePlaceholder}>
                {imageLoading ? (
                  <span className={styles.placeholderText}>Generating...</span>
                ) : dragOver ? (
                  <span className={styles.placeholderText}>Drop image here</span>
                ) : (
                  <>
                    <span className={styles.placeholderIcon}>&#128247;</span>
                    <span className={styles.placeholderText}>Drag & drop or paste an image</span>
                    <div className={styles.imageActions}>
                      <button className={styles.regenBtn} onClick={() => imageInputRef.current?.click()}>Upload</button>
                      <button className={styles.regenBtn} onClick={handleGenerateImage}>Generate</button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            {imageError && <p className={styles.imageError}>{imageError}</p>}
          </div>
          {user?.uid === ADMIN_UID && (
            <label style={{ position: 'absolute', right: '-180px', top: '0', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={fields.starterRecipe} onChange={e => setField('starterRecipe', e.target.checked)} />
              Starter recipe
            </label>
          )}
      </div>


      <NutritionPanel
        recipeId={recipe.id}
        ingredients={fields.ingredients}
        servings={(foodWeight > 0 && servingWeightNum > 0) ? foodWeight / servingWeightNum : (adjustedServings ?? baseServings)}
        portionLabel={servingWeightNum > 0 && foodWeight > 0 ? `My portion (${servingWeight}g)` : null}
        onViewSources={onViewSources}
        onNutritionData={(d) => setNutritionTotals(d?.totals || null)}
        weighPortionContent={
          <details className={styles.weightDetails}>
            <summary>Weigh portion size</summary>
            <div className={styles.weightAdjuster}>
              <table className={styles.weighTable}>
                <thead>
                  <tr>
                    <th></th>
                    <th>All Food + Containers</th>
                    <th>Container</th>
                    <th>Total Weight of Containers</th>
                    <th>Food Weight</th>
                    <th>My Serving</th>
                    <th>Servings</th>
                  </tr>
                </thead>
                <tbody>
                  {(fields.containers || [{ weight: '' }]).map((c, ci) => (
                    <tr key={ci}>
                      <td className={styles.weighRowNum}>
                        {ci + 1}
                        {(fields.containers || []).length > 1 && (
                          <button className={styles.weighRowRemove} onClick={() => {
                            setFields(prev => ({ ...prev, containers: (prev.containers || []).filter((_, i) => i !== ci) }));
                          }}>&times;</button>
                        )}
                      </td>
                      <td>
                        {ci === 0 ? (
                          <input
                            className={styles.weighInput}
                            type="number"
                            min="0"
                            placeholder="g"
                            value={fields.totalWeight}
                            onChange={e => setField('totalWeight', e.target.value)}
                          />
                        ) : null}
                      </td>
                      <td>
                        <input
                          className={styles.weighInput}
                          type="number"
                          min="0"
                          placeholder="g"
                          value={c.weight || ''}
                          onChange={e => {
                            setFields(prev => {
                              const next = [...(prev.containers || [{ weight: '' }])];
                              next[ci] = { ...next[ci], weight: e.target.value };
                              return { ...prev, containers: next };
                            });
                          }}
                        />
                      </td>
                      <td className={styles.weighCalc}>
                        {ci === 0 && containerWeightNum > 0 ? `${containerWeightNum}g` : ''}
                      </td>
                      <td className={styles.weighCalc}>
                        {ci === 0 && totalWeightNum > 0 ? `${foodWeight}g` : ''}
                      </td>
                      <td>
                        {ci === 0 && foodWeight > 0 ? (
                          <input
                            className={styles.weighInput}
                            type="number"
                            min="0"
                            placeholder="g"
                            value={servingWeight || defaultServingWeight}
                            onChange={e => setServingWeight(e.target.value)}
                          />
                        ) : null}
                      </td>
                      <td className={styles.weighCalc}>
                        {ci === 0 && weightBasedServings !== null
                          ? `${parseFloat(weightBasedServings.toFixed(2))}`
                          : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.weighActions}>
                <button className={styles.containerAddBtn} onClick={() => {
                  setFields(prev => ({
                    ...prev,
                    containers: [...(prev.containers || [{ label: '', weight: '' }]), { label: '', weight: '' }],
                  }));
                }}>+ Add Container</button>
                {foodWeight > 0 && servingWeight && servingWeight !== defaultServingWeight && (
                  <button className={styles.weighResetBtn} onClick={() => setServingWeight('')}>
                    Reset to 1 serving
                  </button>
                )}
              </div>
            </div>
          </details>
        }
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
          </div>
        </div>


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
                              {unitType === 'size' ? (
                                <>
                                <button
                                  className={styles.typeBtn}
                                  type="button"
                                  disabled={!parseFloat(row.quantity)}
                                  title={!parseFloat(row.quantity) ? 'Quantity is 0' : 'Convert to grams'}
                                  onClick={() => {
                                    const ingName = (row.ingredient || '').trim();
                                    const qty = parseFloat(row.quantity) || 1;
                                    const currentMeas = normalizeUnit(row.measurement || '');
                                    // Build size options from ingredient database
                                    const dbRows = getDbSizeRows(ingName);
                                    const sizeOptions = [];
                                    const seen = new Set();
                                    for (const dbRow of dbRows) {
                                      const meas = dbRow.measurement.toLowerCase().replace(/\(s\)/g, '').replace(/_.*$/, '').replace(/s$/, '').trim();
                                      if (seen.has(meas)) continue;
                                      seen.add(meas);
                                      const totalGrams = Math.round(qty * dbRow.grams);
                                      sizeOptions.push({
                                        size: dbRow.measurement,
                                        grams: totalGrams,
                                        perUnit: dbRow.grams,
                                        label: `${dbRow.measurement} (${dbRow.grams}g each)${qty !== 1 ? ` → ${totalGrams}g` : ''}`,
                                      });
                                    }
                                    // Fallback to hardcoded SIZE_GRAMS if no DB entries
                                    if (sizeOptions.length === 0) {
                                      for (const size of ['small', 'regular', 'medium', 'large', 'extra large']) {
                                        const grams = getSizeGrams(ingName, size);
                                        if (grams) {
                                          const totalGrams = Math.round(qty * grams);
                                          sizeOptions.push({ size, grams: totalGrams, perUnit: grams, label: `${size} (${grams}g each)${qty !== 1 ? ` → ${totalGrams}g` : ''}` });
                                        }
                                      }
                                    }
                                    // Add gram conversion option using current size
                                    const currentGrams = dbRows.find(r => {
                                      const m = r.measurement.toLowerCase().replace(/\(s\)/g, '').replace(/_.*$/, '').replace(/s$/, '').trim();
                                      return m === currentMeas;
                                    })?.grams || getSizeGrams(ingName, currentMeas);
                                    if (currentGrams) {
                                      const totalGrams = Math.round(qty * currentGrams);
                                      sizeOptions.push({ size: '_grams', grams: totalGrams, label: `Convert to ${totalGrams}g` });
                                    }
                                    if (sizeOptions.length > 0) {
                                      setConvertPopup({ rowIdx: i, sizeOptions, volumeOptions: [], weightOptions: [] });
                                    }
                                  }}
                                >
                                  Size
                                </button>
                                {convertPopup && convertPopup.rowIdx === i && convertPopup.sizeOptions && (
                                  <div className={styles.convertPopup} ref={convertPopupRef}>
                                    <div className={styles.convertPopupColumns}>
                                      <div className={styles.convertPopupCol}>
                                        <div className={styles.convertPopupTitle}>Size → Grams</div>
                                        {convertPopup.sizeOptions.map((opt, oi) => (
                                          <button
                                            key={oi}
                                            className={styles.convertPopupOption}
                                            onClick={() => {
                                              if (opt.size === '_grams') {
                                                updateIngredient(i, 'quantity', String(opt.grams));
                                                updateIngredient(i, 'measurement', 'g');
                                              } else {
                                                updateIngredient(i, 'measurement', opt.size);
                                              }
                                              setConvertPopup(null);
                                            }}
                                          >
                                            {opt.label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )}
                                </>
                              ) : unitType ? (
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
                                {convertPopup && convertPopup.rowIdx === i && !convertPopup.sizeOptions && (
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
                    <td className={styles.tagCell}>
                      {getIngredientTags(row.ingredient).filter(t => !['vegan', 'gluten-free', 'dairy-free', 'high-carb', 'high-protein'].includes(t)).slice(0, 3).map(tagKey => {
                        const info = getTagInfo(tagKey);
                        return <span key={tagKey} className={styles.ingTag} style={{ color: info.color, borderColor: info.color }}>{info.label}</span>;
                      })}
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
              <div style={{ position: 'relative', display: 'inline-block' }} ref={addMenuRef}>
                <button className={styles.addRowBtn} type="button" onClick={() => setShowAddMenu(v => !v)}>
                  + Add ingredient ▾
                </button>
                {showAddMenu && (
                  <div className={styles.addIngredientMenu}>
                    <button className={styles.addMenuOption} onClick={() => { addRow(); setShowAddMenu(false); }}>
                      Add manually
                    </button>
                    <button className={styles.addMenuOption} onClick={() => { setShowScanner(true); setShowAddMenu(false); }}>
                      Scan barcode
                    </button>
                    <button className={styles.addMenuOption} onClick={() => { addToppingRow(); setShowAddMenu(false); }}>
                      Add per meal topping
                    </button>
                  </div>
                )}
              </div>
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
                  const dbLink = row.link || getDbLink(row.ingredient);
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
                      <td className={styles.tagCell}>
                        {getIngredientTags(row.ingredient).slice(0, 3).map(tagKey => {
                          const info = getTagInfo(tagKey);
                          return <span key={tagKey} className={styles.ingTag} style={{ color: info.color, borderColor: info.color }}>{info.label}</span>;
                        })}
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
        <h3>Notes</h3>
        <div
          className={styles.notesInput}
          contentEditable
          suppressContentEditableWarning
          ref={el => { if (el && !el.dataset.init) { el.innerHTML = fields.notes || ''; el.dataset.init = '1'; } }}
          onInput={e => {
            if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
            const target = e.currentTarget;
            if (!target) return;
            const html = target.innerHTML;
            autoSaveRef.current = setTimeout(() => {
              setFields(prev => ({ ...prev, notes: html }));
            }, 2000);
          }}
          onBlur={e => {
            if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
            const target = e.currentTarget;
            if (!target) return;
            setFields(prev => ({ ...prev, notes: target.innerHTML }));
          }}
          onKeyDown={e => {
            if (e.key === 'b' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyFormat('bold'); }
            if (e.key === 'i' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyFormat('italic'); }
            if (e.key === 'u' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyFormat('underline'); }
          }}
          data-placeholder="Add notes, changes to try next time, or things to remember..."
        />
      </div>

      <div className={styles.section}>
        <div className={styles.instructionHeader}>
          <h3>Instructions</h3>
          <button className={cookMode ? styles.cookModeBtnActive : styles.cookModeBtn} onClick={() => setCookMode(prev => { const next = !prev; localStorage.setItem('sunday-cook-mode', String(next)); return next; })}>
            {cookMode ? 'Standard View' : 'Cook Mode'}
          </button>
        </div>

        {cookMode ? (
          <div className={styles.cookModeView}>
                {(editing ? fields.steps : fields.steps.filter(s => s.trim())).map((step, si) => {
                  const assignedIndices = fields.stepIngredients[si] || [];
                  const assignedIngs = assignedIndices.map(idx => fields.ingredients[idx]).filter(Boolean);
                  const unassigned = fields.ingredients.filter((ing, idx) =>
                    ing.ingredient.trim() && !Object.values(fields.stepIngredients).flat().includes(idx)
                  );
                  return (
                    <div
                      key={si}
                      className={`${styles.cookModeStepGroup} ${stepDragIdx === si ? styles.draggingRow : ''} ${stepDragOverIdx === si ? styles.dragOverRow : ''}`}
                      onDragOver={e => { if (editing) { e.preventDefault(); handleStepDragOver(e, si); } }}
                      onDrop={e => editing && handleStepDrop(e, si)}
                      onDragEnd={() => { setStepDragIdx(null); setStepDragOverIdx(null); }}
                    >
                    {(fields.stepSections || {})[si] && (
                      <div className={styles.cookModeSectionTitle}>{fields.stepSections[si]}</div>
                    )}
                    <table className={styles.cookModeTable}>
                    <colgroup><col/><col/><col/><col/></colgroup>
                    <tbody>
                      <tr className={styles.cookModeRow}>
                        <td className={styles.cookModeStep} rowSpan={Math.max(1, assignedIngs.length)}>
                          <div className={styles.cookModeStepHeader}>
                            {editing && <span className={styles.cookModeDragHandle} draggable onDragStart={e => handleStepDragStart(e, si)} title="Drag to reorder">&#x2630;</span>}
                            <span className={styles.cookModeStepNum}>Step {si + 1}</span>
                            {editing && fields.steps.filter(s => s.trim()).length > 1 && (
                              <button className={styles.cookModeStepDelete} onClick={() => {
                                const realIdx = fields.steps.indexOf(step);
                                if (realIdx >= 0) removeStep(realIdx);
                              }} title="Delete step">&times;</button>
                            )}
                          </div>
                          {editing ? (
                            <div
                              key={`cm-${si}-v${stepVersion}`}
                              className={styles.cookModeStepInput}
                              contentEditable
                              suppressContentEditableWarning
                              ref={el => { if (el && !el.dataset.init) { el.innerHTML = step || ''; el.dataset.init = '1'; } }}
                              onInput={e => {
                                if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
                                const target = e.currentTarget;
                                if (!target) return;
                                const html = target.innerHTML;
                                const idx = fields.steps.indexOf(step) >= 0 ? fields.steps.indexOf(step) : si;
                                autoSaveRef.current = setTimeout(() => {
                                  updateStep(idx, html);
                                }, 2000);
                              }}
                              onBlur={e => {
                                if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
                                const target = e.currentTarget;
                                if (!target) return;
                                const idx = fields.steps.indexOf(step) >= 0 ? fields.steps.indexOf(step) : si;
                                updateStep(idx, target.innerHTML);
                              }}
                              onKeyDown={e => {
                                if (e.key === 'b' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyFormat('bold'); }
                                if (e.key === 'i' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyFormat('italic'); }
                                if (e.key === 'u' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyFormat('underline'); }
                              }}
                            />
                          ) : (
                            <span className={styles.cookModeStepText}>{renderFormattedText(step)}</span>
                          )}
                        </td>
                        {assignedIngs.length > 0 ? (
                          <>
                            <td className={styles.cookModeQty}>{assignedIngs[0].quantity}</td>
                            <td className={styles.cookModeMeas} style={{ position: 'relative', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }} onClick={() => {
                              const ing = assignedIngs[0];
                              const dbGrams = getDbGrams(ing.ingredient);
                              const dbMeas = getDbMeasurement(ing.ingredient);
                              const convs = getConversions(ing.quantity, ing.measurement, dbGrams);
                              const cross = getCrossConversion(ing.quantity, ing.measurement, dbGrams, dbMeas);
                              const volumeOptions = [];
                              if (cross.volume) { const p = cross.volume.match(/^([\d.]+)\s+(.+)$/); if (p) volumeOptions.push({ qty: p[1], unit: p[2], label: `${p[1]} ${p[2]}` }); }
                              for (const c of convs) { if (VOLUME_TO_ML[c.unit] && !volumeOptions.some(o => o.unit === c.unit)) volumeOptions.push({ qty: String(c.qty), unit: c.unit, label: `${c.qty} ${c.unit}` }); }
                              const weightOptions = [];
                              if (cross.weight) { const p = cross.weight.match(/^([\d.]+)\s*(.+)$/); if (p) weightOptions.push({ qty: p[1], unit: p[2], label: `${p[1]} ${p[2]}` }); }
                              for (const c of convs) { if (WEIGHT_TO_G[c.unit] && !weightOptions.some(o => o.unit === c.unit)) weightOptions.push({ qty: String(c.qty), unit: c.unit, label: `${c.qty} ${c.unit}` }); }
                              if (volumeOptions.length > 0 || weightOptions.length > 0) setConvertPopup({ cookIdx: `${si}-0`, volumeOptions, weightOptions, origIdx: assignedIndices[0] });
                            }}>
                              {assignedIngs[0].measurement}
                              {convertPopup?.cookIdx === `${si}-0` && (
                                <div className={styles.convertPopup} ref={convertPopupRef}>
                                  <div className={styles.convertPopupColumns}>
                                    {convertPopup.volumeOptions?.length > 0 && (
                                      <div className={styles.convertPopupCol}>
                                        <div className={styles.convertPopupTitle}>Volume</div>
                                        {convertPopup.volumeOptions.map((opt, oi) => (
                                          <button key={`v${oi}`} className={styles.convertPopupOption} onClick={e => { e.stopPropagation(); updateIngredient(convertPopup.origIdx, 'quantity', opt.qty); updateIngredient(convertPopup.origIdx, 'measurement', opt.unit); setConvertPopup(null); }}>{opt.label}</button>
                                        ))}
                                      </div>
                                    )}
                                    {convertPopup.weightOptions?.length > 0 && (
                                      <div className={styles.convertPopupCol}>
                                        <div className={styles.convertPopupTitle}>Weight</div>
                                        {convertPopup.weightOptions.map((opt, oi) => (
                                          <button key={`w${oi}`} className={styles.convertPopupOption} onClick={e => { e.stopPropagation(); updateIngredient(convertPopup.origIdx, 'quantity', opt.qty); updateIngredient(convertPopup.origIdx, 'measurement', opt.unit); setConvertPopup(null); }}>{opt.label}</button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className={styles.cookModeIng}>
                              <div className={styles.cookModeIngRow}>
                                <span>{assignedIngs[0].ingredient}</span>
                                {editing && <button className={styles.cookModeRemove} onClick={() => {
                                  setFields(prev => {
                                    const map = { ...prev.stepIngredients };
                                    map[si] = (map[si] || []).filter(idx => idx !== assignedIndices[0]);
                                    return { ...prev, stepIngredients: map };
                                  });
                                }}>&times;</button>}
                                {editing && assignedIngs.length === 1 && (
                                  <select className={styles.cookModeAddInline} value="" onChange={e => {
                                    const idx = parseInt(e.target.value);
                                    if (isNaN(idx)) return;
                                    setFields(prev => {
                                      const map = { ...prev.stepIngredients };
                                      map[si] = [...(map[si] || []), idx];
                                      return { ...prev, stepIngredients: map };
                                    });
                                  }}>
                                    <option value="">+ Add</option>
                                    {fields.ingredients.map((ig, idx) => ig.ingredient.trim() ? (
                                      <option key={idx} value={idx}>{ig.quantity} {ig.measurement} {ig.ingredient}</option>
                                    ) : null)}
                                  </select>
                                )}
                              </div>
                            </td>
                          </>
                        ) : (
                          <td colSpan={3} className={styles.cookModeEmpty}>
                            {editing && (
                              <select className={styles.cookModeSelect} value="" onChange={e => {
                                const idx = parseInt(e.target.value);
                                if (isNaN(idx)) return;
                                setFields(prev => {
                                  const map = { ...prev.stepIngredients };
                                  map[si] = [...(map[si] || []), idx];
                                  return { ...prev, stepIngredients: map };
                                });
                              }}>
                                <option value="">+ Assign ingredient...</option>
                                {fields.ingredients.map((ing, idx) => ing.ingredient.trim() ? (
                                  <option key={idx} value={idx}>{ing.quantity} {ing.measurement} {ing.ingredient}</option>
                                ) : null)}
                              </select>
                            )}
                          </td>
                        )}
                      </tr>
                      {assignedIngs.slice(1).map((ing, ii) => (
                        <tr key={`${si}-${ii + 1}`}>
                          <td className={styles.cookModeQty}>{ing.quantity}</td>
                          <td className={styles.cookModeMeas} style={{ position: 'relative', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }} onClick={() => {
                            const dbGrams = getDbGrams(ing.ingredient);
                            const dbMeas = getDbMeasurement(ing.ingredient);
                            const convs = getConversions(ing.quantity, ing.measurement, dbGrams);
                            const cross = getCrossConversion(ing.quantity, ing.measurement, dbGrams, dbMeas);
                            const volumeOptions = [];
                            if (cross.volume) { const p = cross.volume.match(/^([\d.]+)\s+(.+)$/); if (p) volumeOptions.push({ qty: p[1], unit: p[2], label: `${p[1]} ${p[2]}` }); }
                            for (const c of convs) { if (VOLUME_TO_ML[c.unit] && !volumeOptions.some(o => o.unit === c.unit)) volumeOptions.push({ qty: String(c.qty), unit: c.unit, label: `${c.qty} ${c.unit}` }); }
                            const weightOptions = [];
                            if (cross.weight) { const p = cross.weight.match(/^([\d.]+)\s*(.+)$/); if (p) weightOptions.push({ qty: p[1], unit: p[2], label: `${p[1]} ${p[2]}` }); }
                            for (const c of convs) { if (WEIGHT_TO_G[c.unit] && !weightOptions.some(o => o.unit === c.unit)) weightOptions.push({ qty: String(c.qty), unit: c.unit, label: `${c.qty} ${c.unit}` }); }
                            if (volumeOptions.length > 0 || weightOptions.length > 0) setConvertPopup({ cookIdx: `${si}-${ii+1}`, volumeOptions, weightOptions, origIdx: assignedIndices[ii+1] });
                          }}>
                            {ing.measurement}
                            {convertPopup?.cookIdx === `${si}-${ii+1}` && (
                              <div className={styles.convertPopup} ref={convertPopupRef}>
                                <div className={styles.convertPopupColumns}>
                                  {convertPopup.volumeOptions?.length > 0 && (
                                    <div className={styles.convertPopupCol}>
                                      <div className={styles.convertPopupTitle}>Volume</div>
                                      {convertPopup.volumeOptions.map((opt, oi) => (
                                        <button key={`v${oi}`} className={styles.convertPopupOption} onClick={e => { e.stopPropagation(); updateIngredient(convertPopup.origIdx, 'quantity', opt.qty); updateIngredient(convertPopup.origIdx, 'measurement', opt.unit); setConvertPopup(null); }}>{opt.label}</button>
                                      ))}
                                    </div>
                                  )}
                                  {convertPopup.weightOptions?.length > 0 && (
                                    <div className={styles.convertPopupCol}>
                                      <div className={styles.convertPopupTitle}>Weight</div>
                                      {convertPopup.weightOptions.map((opt, oi) => (
                                        <button key={`w${oi}`} className={styles.convertPopupOption} onClick={e => { e.stopPropagation(); updateIngredient(convertPopup.origIdx, 'quantity', opt.qty); updateIngredient(convertPopup.origIdx, 'measurement', opt.unit); setConvertPopup(null); }}>{opt.label}</button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className={styles.cookModeIng}>
                            <div className={styles.cookModeIngRow}>
                              <span>{ing.ingredient}</span>
                              {editing && <button className={styles.cookModeRemove} onClick={() => {
                                setFields(prev => {
                                  const map = { ...prev.stepIngredients };
                                  map[si] = (map[si] || []).filter(idx => idx !== assignedIndices[ii + 1]);
                                  return { ...prev, stepIngredients: map };
                                });
                              }}>&times;</button>}
                              {editing && ii === assignedIngs.length - 2 && (
                                <select className={styles.cookModeAddInline} value="" onChange={e => {
                                  const idx = parseInt(e.target.value);
                                  if (isNaN(idx)) return;
                                  setFields(prev => {
                                    const map = { ...prev.stepIngredients };
                                    map[si] = [...(map[si] || []), idx];
                                    return { ...prev, stepIngredients: map };
                                  });
                                }}>
                                  <option value="">+ Add</option>
                                  {fields.ingredients.map((ig, idx) => ig.ingredient.trim() ? (
                                    <option key={idx} value={idx}>{ig.quantity} {ig.measurement} {ig.ingredient}</option>
                                  ) : null)}
                                </select>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody></table>
                    </div>
                  );
                })}
            {editing && (
              <button className={styles.addRowBtn} type="button" onClick={addStep}>
                + Add step
              </button>
            )}
          </div>
        ) : (
        <>
        {editing ? (
          <>
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
                  {(fields.stepSections || {})[i] !== undefined && (
                    <div className={styles.stepSectionRow}>
                      <input
                        className={styles.stepSectionInput}
                        type="text"
                        value={(fields.stepSections || {})[i] || ''}
                        onChange={e => {
                          const val = e.target.value;
                          setFields(prev => ({ ...prev, stepSections: { ...prev.stepSections, [i]: val } }));
                        }}
                        placeholder="Section title (e.g. Sauce, Rice, Assembly...)"
                      />
                      <button
                        className={styles.stepSectionRemove}
                        type="button"
                        title="Remove section title"
                        onClick={() => {
                          setFields(prev => {
                            const next = { ...prev.stepSections };
                            delete next[i];
                            return { ...prev, stepSections: next };
                          });
                        }}
                      >&times;</button>
                    </div>
                  )}
                  <div className={styles.stepHeader}>
                    <span className={styles.dragHandle} title="Drag to reorder">≡</span>
                    <span className={styles.stepLabel}>Step {i + 1}</span>
                    {(fields.stepSections || {})[i] === undefined && (
                      <button
                        className={styles.stepSectionAddBtn}
                        type="button"
                        title="Add section title above this step"
                        onClick={() => {
                          setFields(prev => ({ ...prev, stepSections: { ...prev.stepSections, [i]: '' } }));
                        }}
                      >+ Section</button>
                    )}
                  </div>
                  <div className={styles.stepInputWrap}>
                    <div
                      key={`std-${i}-v${stepVersion}`}
                      className={styles.stepInput}
                      contentEditable
                      suppressContentEditableWarning
                      ref={el => { if (el && !el.dataset.init) { el.innerHTML = step || ''; el.dataset.init = '1'; } }}
                      onInput={e => {
                        if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
                        const target = e.currentTarget;
                        if (!target) return;
                        const html = target.innerHTML;
                        const idx = i;
                        autoSaveRef.current = setTimeout(() => {
                          updateStep(idx, html);
                        }, 2000);
                      }}
                      onBlur={e => {
                        if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
                        const target = e.currentTarget;
                        if (!target) return;
                        updateStep(i, target.innerHTML);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'b' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyFormat('bold'); }
                        if (e.key === 'i' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyFormat('italic'); }
                        if (e.key === 'u' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyFormat('underline'); }
                      }}
                      data-placeholder={`Step ${i + 1}...`}
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
          </>
        ) : (
          <ol className={styles.stepsListReadonly}>
            {fields.steps.map((step, origIdx) => ({ step, origIdx })).filter(({ step }) => step.trim()).map(({ step, origIdx }, i) => (
              <React.Fragment key={i}>
                {(fields.stepSections || {})[origIdx] && (
                  <li className={styles.stepSectionTitle}>{fields.stepSections[origIdx]}</li>
                )}
                <li className={styles.stepReadonly}>{renderFormattedText(step)}</li>
              </React.Fragment>
            ))}
            {fields.steps.filter(s => s.trim()).length === 0 && (
              <p className={styles.emptyText}>No instructions yet</p>
            )}
          </ol>
        )}
        </>
        )}
      </div>

      {editing && (
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
      )}

      {showScanner && (
        <BarcodeScanner
          onResult={handleBarcodeScan}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
