import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NUTRIENTS, fetchNutritionForIngredient, fetchNutritionForRecipe } from '../utils/nutrition';
import { loadIngredients } from '../utils/ingredientsStore';
import { saveField, saveDailyLogToFirestore, loadDailyLogFromFirestore } from '../utils/firestoreSync';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend, CartesianGrid, Area, ComposedChart } from 'recharts';
import { RecipeDetail } from './RecipeDetail';
import styles from './DailyTrackerPage.module.css';

const DAILY_LOG_KEY = 'sunday-daily-log';
const GOALS_KEY = 'sunday-nutrition-goals';
const NUTRITION_CACHE_KEY = 'sunday-nutrition-cache';

const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Desserts, Snacks & Drinks' };

const UNDER_IS_GOOD = new Set(['calories', 'carbs', 'fat', 'saturatedFat', 'sugar', 'addedSugar', 'fiber', 'sodium', 'potassium']);

const MEASUREMENT_OPTIONS = ['g', 'grams', 'oz', 'ounces', 'cup', 'cups', 'tbsp', 'tsp', 'ml', 'piece', 'pieces', 'slice', 'slices', 'can', 'cans', 'lb', 'lbs'];

const CHART_COLORS = ['#c96442', '#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4'];

// Short labels for inline nutrient chips on entry rows
const SHORT_LABELS = {
  calories: 'cal', protein: 'pro', carbs: 'carb', fat: 'fat',
  saturatedFat: 'sat', sugar: 'sugar', addedSugar: 'added', fiber: 'fiber',
  sodium: 'salt', potassium: 'K', calcium: 'Ca', iron: 'Fe',
  magnesium: 'Mg', zinc: 'Zn', vitaminB12: 'B12', vitaminC: 'vit C',
  leucine: 'leu', omega3: 'ω3', vegServings: 'veg', fruitServings: 'fruit',
};

const DEFAULT_ENTRY_KEYS = ['calories', 'protein', 'carbs', 'fat'];

function fmtNutrient(value, nutrientKey) {
  const v = value || 0;
  const n = NUTRIENTS.find(x => x.key === nutrientKey);
  if (!n) return String(Math.round(v));
  const rounded = Math.round(v * Math.pow(10, n.decimals)) / Math.pow(10, n.decimals);
  const suffix = n.unit ? n.unit : '';
  return `${rounded}${suffix}`;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  // Deduplicate: Area and Line both emit entries for the same dataKey
  const seen = new Set();
  const unique = payload.filter(p => {
    if (seen.has(p.dataKey)) return false;
    seen.add(p.dataKey);
    return true;
  });
  return (
    <div style={{
      background: 'rgba(255,255,255,0.95)',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      padding: '0.5rem 0.75rem',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      fontSize: '0.8rem',
    }}>
      <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: '#374151' }}>{label}</div>
      {unique.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '1px 0' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          <span style={{ color: '#6b7280' }}>{p.name}:</span>
          <span style={{ fontWeight: 600, color: '#111827' }}>{p.value}%</span>
        </div>
      ))}
    </div>
  );
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function chartDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DAY_ABBR[dt.getDay()]} ${m}/${d}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function uuid() {
  return crypto.randomUUID();
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function loadDailyLog() {
  try {
    const raw = localStorage.getItem(DAILY_LOG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function slimLogForFirestore(log, maxDays) {
  // Trim to recent N days and strip heavy fields to minimize doc size
  const keys = Object.keys(log).sort().slice(-maxDays);
  const slim = {};
  for (const k of keys) {
    const day = log[k];
    if (!day) continue;
    slim[k] = {
      ...day,
      entries: (day.entries || []).map(e => {
        // Keep essential fields only — strip full nutrition breakdown for Firestore
        const { nutritionPerIngredient, ...rest } = e;
        return rest;
      }),
    };
  }
  return slim;
}

function saveDailyLog(log, user) {
  // Always save full log to localStorage (no size limit concern)
  try {
    localStorage.setItem(DAILY_LOG_KEY, JSON.stringify(log));
  } catch {}
  if (user) {
    window.__dailyLogLocalEdit = true;
    // Save to a SEPARATE document (not the main user doc) to avoid 1MB limit
    const slim = slimLogForFirestore(log, 90);
    saveDailyLogToFirestore(user.uid, slim)
      .then(() => {
        setTimeout(() => { window.__dailyLogLocalEdit = false; }, 2000);
      })
      .catch((err) => {
        console.error('Failed to save daily log:', err);
        window.__dailyLogLocalEdit = false;
      });
  }
}

function loadGoals() {
  try {
    const raw = localStorage.getItem(GOALS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadNutritionCache() {
  try {
    return JSON.parse(localStorage.getItem(NUTRITION_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

// Get totals from cache entry, handling both formats:
// NutritionPanel format: { data: { items, totals }, fingerprint }
// DailyTracker format: { items, totals }
function getCachedTotals(cacheEntry) {
  if (!cacheEntry) return null;
  if (cacheEntry.totals) return cacheEntry.totals;
  if (cacheEntry.data?.totals) return cacheEntry.data.totals;
  return null;
}

// Get items array from cache entry (both formats)
function getCachedItems(cacheEntry) {
  if (!cacheEntry) return null;
  if (cacheEntry.items) return cacheEntry.items;
  if (cacheEntry.data?.items) return cacheEntry.data.items;
  return null;
}

/**
 * Compute nutrition for a portion weight, matching NutritionPanel exactly.
 * Splits main vs topping (per-meal) ingredients:
 *   portion nutrition = (mainTotals * weightFraction) + toppingTotals
 * This matches recipe page: perServing = (main / servings) + topping
 */
function computeWeightNutrition(cacheEntry, recipeIngredients, weightFraction) {
  const items = getCachedItems(cacheEntry);
  const totals = getCachedTotals(cacheEntry);
  if (!totals) return null;

  // If no items array, fall back to simple scaling
  if (!items || !recipeIngredients) {
    const result = {};
    for (const n of NUTRIENTS) result[n.key] = Math.round(((totals[n.key] || 0) * weightFraction) * 10) / 10;
    return result;
  }

  // Split main vs topping, matching NutritionPanel logic
  const mainTotals = {};
  const toppingTotals = {};
  for (const n of NUTRIENTS) { mainTotals[n.key] = 0; toppingTotals[n.key] = 0; }

  const filtered = recipeIngredients.filter(row => (row.ingredient || '').trim());
  items.forEach((item, i) => {
    const isTopping = filtered[i]?.topping;
    for (const n of NUTRIENTS) {
      if (isTopping) {
        toppingTotals[n.key] += item.nutrients?.[n.key] || 0;
      } else {
        mainTotals[n.key] += item.nutrients?.[n.key] || 0;
      }
    }
  });

  // portion = (main * weightFraction) + topping (full value per serving)
  const result = {};
  for (const n of NUTRIENTS) {
    result[n.key] = Math.round(((mainTotals[n.key] * weightFraction) + toppingTotals[n.key]) * 10) / 10;
  }
  return result;
}

function scaleNutrition(nutrition, factor) {
  const scaled = {};
  for (const n of NUTRIENTS) {
    scaled[n.key] = Math.round((nutrition[n.key] || 0) * factor * 10) / 10;
  }
  return scaled;
}

/**
 * Compute per-serving nutrition.
 * Main/batch ingredients: divide by recipeServings.
 * Topping/per-meal ingredients (ing.topping === true): keep as-is (already per serving).
 * Formula: perServing = (mainTotal / servings) + toppingTotal
 */
function computePerServing(cacheEntry, recipeIngredients, recipeServings) {
  const items = getCachedItems(cacheEntry);
  const totals = getCachedTotals(cacheEntry);
  if (!totals) return null;

  // If we have per-ingredient data, split main vs topping
  if (items && recipeIngredients && items.length === recipeIngredients.length) {
    const perServing = {};
    for (const n of NUTRIENTS) perServing[n.key] = 0;
    recipeIngredients.forEach((ing, idx) => {
      const ingNut = items[idx]?.nutrients || {};
      // Toppings are per-meal — don't divide. Main ingredients — divide by servings.
      const divisor = ing.topping ? 1 : (recipeServings || 1);
      for (const n of NUTRIENTS) perServing[n.key] += (ingNut[n.key] || 0) / divisor;
    });
    return perServing;
  }

  // Fallback: no per-ingredient data, just divide total by servings
  const perServing = {};
  for (const n of NUTRIENTS) perServing[n.key] = (totals[n.key] || 0) / (recipeServings || 1);
  return perServing;
}

/* ── Recipe Combobox ── */
function RecipeCombobox({ recipes, value, onSelect }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selected = value ? recipes.find(r => r.id === value) : null;

  const filtered = query
    ? recipes.filter(r => r.title.toLowerCase().includes(query.toLowerCase()))
    : recipes;

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className={styles.comboWrap} ref={wrapRef}>
      <input
        className={styles.comboInput}
        type="text"
        placeholder="Search recipes..."
        value={open ? query : (selected?.title || '')}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {selected && !open && (
        <button className={styles.comboClear} onClick={() => { onSelect(''); setQuery(''); }} aria-label="Clear">&times;</button>
      )}
      {open && (
        <div className={styles.comboDropdown}>
          {filtered.length === 0 ? (
            <div className={styles.comboEmpty}>No matches</div>
          ) : (
            filtered.map(r => (
              <div
                key={r.id}
                className={styles.comboOption}
                onMouseDown={() => { onSelect(r.id); setQuery(''); setOpen(false); }}
              >
                {r.title}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ── Ingredient Combobox ── */
function IngredientCombobox({ value, onChange, onSelect }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const ingredientsDb = useMemo(() => {
    const data = loadIngredients();
    if (!data) return [];
    return data
      .filter(item => (item.ingredient || '').trim())
      .sort((a, b) => (a.ingredient || '').localeCompare(b.ingredient || ''));
  }, []);

  const filtered = value
    ? ingredientsDb.filter(item =>
        item.ingredient.toLowerCase().includes(value.toLowerCase())
      ).slice(0, 50)
    : ingredientsDb.slice(0, 50);

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className={styles.comboWrap} ref={wrapRef}>
      <input
        className={styles.comboInput}
        type="text"
        placeholder="Search ingredients..."
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {value && !open && (
        <button className={styles.comboClear} onClick={() => { onChange(''); }} aria-label="Clear">&times;</button>
      )}
      {open && filtered.length > 0 && (
        <div className={styles.comboDropdown}>
          {filtered.map((item, i) => (
            <div
              key={i}
              className={styles.comboOption}
              onMouseDown={() => { onSelect(item); setOpen(false); }}
            >
              {item.ingredient}
              {item.measurement && <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem', marginLeft: '0.5rem' }}>({item.measurement})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Mini Month Calendar ── */
function MiniCalendar({ date, setDate, dailyLog }) {
  const today = todayStr();
  const [y, m, d] = date.split('-').map(Number);
  const [viewMonth, setViewMonth] = useState(m - 1);
  const [viewYear, setViewYear] = useState(y);

  // Update view month when date changes to a different month
  useEffect(() => {
    const [cy, cm] = date.split('-').map(Number);
    setViewMonth(cm - 1);
    setViewYear(cy);
  }, [date]);

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  // Days of week headers
  const dayHeaders = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1);
  const startDow = firstDay.getDay();
  const mondayStart = startDow === 0 ? 6 : startDow - 1; // Monday = 0
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells = [];

  function buildCell(year, month, day) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayData = dailyLog[dateStr];
    const entries = dayData?.entries || [];
    let mainMealCount = (dayData?.skippedMeals || []).length;
    for (const entry of entries) {
      const slot = entry.mealSlot && ['breakfast', 'lunch', 'dinner'].includes(entry.mealSlot) ? entry.mealSlot : null;
      if (slot) mainMealCount++;
    }
    return {
      dateStr,
      day,
      isSelected: dateStr === date,
      isToday: dateStr === today,
      hasEntries: entries.length > 0 || !!dayData?.daySkipped,
      fullDay: mainMealCount >= 3,
      isOtherMonth: month !== viewMonth || year !== viewYear,
    };
  }

  // Previous month trailing days
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
  const prevM = viewMonth === 0 ? 11 : viewMonth - 1;
  const prevY = viewMonth === 0 ? viewYear - 1 : viewYear;
  for (let i = mondayStart - 1; i >= 0; i--) {
    cells.push(buildCell(prevY, prevM, prevMonthDays - i));
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(buildCell(viewYear, viewMonth, d));
  }

  // Next month leading days (fill to complete last week)
  const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
  const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
  const remaining = cells.length % 7 === 0 ? 0 : 7 - (cells.length % 7);
  for (let d = 1; d <= remaining; d++) {
    cells.push(buildCell(nextY, nextM, d));
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(v => v - 1); }
    else setViewMonth(v => v - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(v => v + 1); }
    else setViewMonth(v => v + 1);
  }

  return (
    <div className={styles.miniCal}>
      <div className={styles.miniCalHeader}>
        <button className={styles.miniCalArrow} onClick={prevMonth}>&larr;</button>
        <span className={styles.miniCalMonth}>{monthLabel}</span>
        <button className={styles.miniCalArrow} onClick={nextMonth}>&rarr;</button>
      </div>
      <div className={styles.miniCalGrid}>
        {dayHeaders.map((h, i) => (
          <span key={i} className={styles.miniCalDowHeader}>{h}</span>
        ))}
        {cells.map((cell) => (
          <button
            key={cell.dateStr}
            className={`${styles.miniCalCell} ${cell.isSelected ? styles.miniCalSelected : ''} ${cell.isToday ? styles.miniCalToday : ''} ${cell.fullDay && !cell.isOtherMonth ? styles.miniCalFullDay : ''} ${cell.isOtherMonth ? styles.miniCalOtherMonth : ''}`}
            onClick={() => setDate(cell.dateStr)}
          >
            {cell.day}
            {cell.fullDay && !cell.isOtherMonth && <span className={styles.miniCalStar}>&#x2B50;</span>}
            {cell.hasEntries && !cell.fullDay && !cell.isOtherMonth && <span className={styles.miniCalDot} />}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Date Navigator ── */
function DateNavigator({ date, setDate }) {
  return (
    <div className={styles.dateNav}>
      <button className={styles.dateArrow} onClick={() => setDate(shiftDate(date, -1))}>&larr;</button>
      <span className={styles.dateLabel}>{formatDate(date)}</span>
      <button className={styles.dateArrow} onClick={() => setDate(shiftDate(date, 1))}>&rarr;</button>
    </div>
  );
}

function categoryToSlot(category) {
  if (category === 'breakfast') return 'breakfast';
  if (category === 'lunch-dinner') {
    return new Date().getHours() < 15 ? 'lunch' : 'dinner';
  }
  if (category === 'desserts' || category === 'dessert' || category === 'snacks' || category === 'drinks') return 'snack';
  const hour = new Date().getHours();
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

/* ── Custom Meal Modal ── */
function CustomMealModal({ onAdd, onClose }) {
  const [mealName, setMealName] = useState('');
  const [mealSlotChoice, setMealSlotChoice] = useState('lunch');
  const [mealIngredients, setMealIngredients] = useState([]);
  const [mealIngName, setMealIngName] = useState('');
  const [mealIngQty, setMealIngQty] = useState('');
  const [mealIngUnit, setMealIngUnit] = useState('g');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function addMealIngredient() {
    if (!mealIngName.trim()) return;
    setMealIngredients(prev => [...prev, {
      id: uuid(),
      ingredient: mealIngName.trim(),
      quantity: mealIngQty || '1',
      measurement: mealIngUnit,
    }]);
    setMealIngName('');
    setMealIngQty('');
    setMealIngUnit('g');
  }

  function removeMealIngredient(id) {
    setMealIngredients(prev => prev.filter(i => i.id !== id));
  }

  async function handleSubmit() {
    if (!mealName.trim() || mealIngredients.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const totalNutrition = {};
      for (const n of NUTRIENTS) totalNutrition[n.key] = 0;

      const ingredientNutrition = [];
      for (const ing of mealIngredients) {
        const result = await fetchNutritionForIngredient({
          ingredient: ing.ingredient,
          quantity: ing.quantity,
          measurement: ing.measurement,
        });
        const ingNutrients = {};
        if (result?.nutrients) {
          for (const n of NUTRIENTS) {
            totalNutrition[n.key] += result.nutrients[n.key] || 0;
            ingNutrients[n.key] = result.nutrients[n.key] || 0;
          }
        }
        ingredientNutrition.push({
          name: `${ing.quantity} ${ing.measurement} ${ing.ingredient}`.trim(),
          ingredient: ing.ingredient,
          quantity: ing.quantity,
          measurement: ing.measurement,
          nutrition: ingNutrients,
          source: result?.source || 'unknown',
        });
      }

      onAdd({
        id: uuid(),
        type: 'custom_meal',
        recipeName: mealName.trim(),
        ingredients: mealIngredients.map(i => `${i.quantity} ${i.measurement} ${i.ingredient}`),
        ingredientNutrition,
        mealSlot: mealSlotChoice,
        timestamp: new Date().toISOString(),
        nutrition: totalNutrition,
      });

      onClose();
    } catch (err) {
      setError('Failed to look up nutrition for one or more ingredients.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Custom Meal</h3>
          <button className={styles.modalClose} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formField}>
            <span className={styles.formLabel}>Meal Name</span>
            <input className={styles.formInput} type="text" placeholder="e.g. Chicken Stir Fry" value={mealName} onChange={e => setMealName(e.target.value)} />
          </div>
          <div className={styles.formFieldSmall}>
            <span className={styles.formLabel}>Meal</span>
            <select className={styles.formSelect} value={mealSlotChoice} onChange={e => setMealSlotChoice(e.target.value)}>
              {MEAL_SLOTS.map(s => <option key={s} value={s}>{MEAL_LABELS[s]}</option>)}
            </select>
          </div>
        </div>

        <div className={styles.mealIngSection}>
          <span className={styles.mealIngHeading}>Ingredients</span>
          {mealIngredients.length > 0 && (
            <div className={styles.mealIngList}>
              {mealIngredients.map(ing => (
                <div key={ing.id} className={styles.mealIngRow}>
                  <span className={styles.mealIngText}>{ing.quantity} {ing.measurement} {ing.ingredient}</span>
                  <button className={styles.mealIngRemove} onClick={() => removeMealIngredient(ing.id)}>&times;</button>
                </div>
              ))}
            </div>
          )}
          <div className={styles.formRow}>
            <div className={styles.formField}>
              <IngredientCombobox
                value={mealIngName}
                onChange={setMealIngName}
                onSelect={(item) => {
                  setMealIngName(item.ingredient);
                  if (item.measurement) {
                    const m = item.measurement.toLowerCase().replace(/\(s\)/g, '').replace(/_.*$/, '').trim();
                    setMealIngUnit(m || 'g');
                  }
                }}
              />
            </div>
            <div className={styles.formFieldSmall}>
              <input className={styles.formInput} type="number" placeholder="Qty" value={mealIngQty} onChange={e => setMealIngQty(e.target.value)} min="0.1" step="0.1" />
            </div>
            <div className={styles.formFieldSmall}>
              <input className={styles.formInput} type="text" list="meal-unit-options" placeholder="g" value={mealIngUnit} onChange={e => setMealIngUnit(e.target.value)} />
              <datalist id="meal-unit-options">
                {MEASUREMENT_OPTIONS.map(m => <option key={m} value={m} />)}
              </datalist>
            </div>
            <button className={styles.mealIngAddBtn} onClick={addMealIngredient} disabled={!mealIngName.trim()}>+</button>
          </div>
        </div>

        {error && <p className={styles.addError}>{error}</p>}
        {loading && <p className={styles.addLoading}>Looking up nutrition...</p>}

        <div className={styles.modalActions}>
          <button className={styles.modalCancelBtn} onClick={onClose}>Cancel</button>
          <button
            className={styles.addBtn}
            onClick={handleSubmit}
            disabled={loading || !mealName.trim() || mealIngredients.length === 0}
          >
            {loading ? 'Adding...' : 'Add Meal'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Add Entry Section ── */
function AddEntrySection({ recipes, getRecipe, onAdd, weeklyPlan }) {
  const [recipeId, setRecipeId] = useState('');
  const [servings, setServings] = useState('1');
  const [customWeight, setCustomWeight] = useState('');
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [recipeError, setRecipeError] = useState('');
  const [selectedWeekly, setSelectedWeekly] = useState(new Set());
  const [showMealModal, setShowMealModal] = useState(false);

  // Ingredient tracking state
  const [ingredientName, setIngredientName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [measurement, setMeasurement] = useState('g');
  const [ingLoading, setIngLoading] = useState(false);
  const [ingError, setIngError] = useState('');

  const sortedRecipes = useMemo(() =>
    [...recipes]
      .filter(r => (r.frequency || 'common') !== 'retired')
      .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [recipes]
  );

  const weeklyRecipes = useMemo(() => {
    if (!weeklyPlan || weeklyPlan.length === 0) return [];
    return weeklyPlan
      .map(id => recipes.find(r => r.id === id))
      .filter(Boolean);
  }, [weeklyPlan, recipes]);

  async function handleAddRecipe() {
    if (!recipeId) return;
    const recipe = getRecipe(recipeId);
    if (!recipe) {
      setRecipeError("That recipe isn't in your collection anymore. Pick another option.");
      setRecipeId('');
      return;
    }
    setRecipeLoading(true);
    setRecipeError('');
    try {
      const cache = loadNutritionCache();
      let totalNutrition;
      totalNutrition = getCachedTotals(cache[recipeId]);
      if (!totalNutrition) {
        const result = await fetchNutritionForRecipe(recipe.ingredients || []);
        totalNutrition = result.totals;
        try {
          cache[recipeId] = result;
          localStorage.setItem(NUTRITION_CACHE_KEY, JSON.stringify(cache));
        } catch {}
      }

      const recipeServings = recipe.servings || 1;
      const perServing = computePerServing(cache[recipeId], recipe.ingredients, recipeServings) || (() => {
        const ps = {};
        for (const n of NUTRIENTS) ps[n.key] = (totalNutrition[n.key] || 0) / recipeServings;
        return ps;
      })();

      let factor;
      const cw = parseFloat(customWeight);
      if (cw > 0) {
        const totalGrams = (recipe.ingredients || []).reduce((sum, ing) => {
          const qty = parseFloat(ing.quantity) || 1;
          const unit = (ing.measurement || '').trim().toLowerCase();
          const MEASUREMENT_TO_GRAMS = {
  g: 1, grams: 1, gram: 1, gm: 1,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  cup: 140, cups: 140,
  tbsp: 15, tablespoon: 15, tablespoons: 15,
  tsp: 5, teaspoon: 5, teaspoons: 5,
  ml: 1, milliliter: 1, milliliters: 1, millilitre: 1,
  lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  piece: 100, pieces: 100, whole: 100, medium: 150, large: 200, small: 80,
  clove: 5, cloves: 5, slice: 30, slices: 30, can: 400, bunch: 50,
  pinch: 0.5, dash: 0.5, handful: 30,
};
          const fac = MEASUREMENT_TO_GRAMS[unit] || 100;
          return sum + qty * fac;
        }, 0);
        factor = totalGrams > 0 ? cw / (totalGrams / recipeServings) : parseFloat(servings) || 1;
      } else {
        factor = parseFloat(servings) || 1;
      }

      const nutrition = scaleNutrition(perServing, factor);
      const mealSlot = categoryToSlot(recipe.category);

      onAdd({
        id: uuid(),
        type: 'recipe',
        recipeId,
        recipeName: recipe.title,
        servings: parseFloat(servings) || 1,
        customWeight: cw > 0 ? cw : null,
        mealSlot,
        timestamp: new Date().toISOString(),
        nutrition,
      });

      setRecipeId('');
      setServings('1');
      setCustomWeight('');
    } catch (err) {
      setRecipeError('Failed to look up nutrition. Try again.');
    } finally {
      setRecipeLoading(false);
    }
  }

  async function handleAddCustom() {
    if (!ingredientName.trim()) return;
    setIngLoading(true);
    setIngError('');
    try {
      const result = await fetchNutritionForIngredient({
        ingredient: ingredientName.trim(),
        quantity: quantity || '1',
        measurement,
      });
      if (!result) {
        setIngError('No nutrition data found for that ingredient.');
        return;
      }
      const mealSlot = 'snack';
      onAdd({
        id: uuid(),
        type: 'custom',
        ingredientName: ingredientName.trim(),
        quantity: parseFloat(quantity) || 1,
        measurement,
        mealSlot,
        timestamp: new Date().toISOString(),
        nutrition: result.nutrients,
      });
      setIngredientName('');
      setQuantity('');
      setMeasurement('g');
    } catch (err) {
      setIngError('Failed to look up nutrition. Try again.');
    } finally {
      setIngLoading(false);
    }
  }

  function toggleWeekly(id) {
    setSelectedWeekly(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAddWeeklySelected() {
    if (selectedWeekly.size === 0) return;
    setRecipeLoading(true);
    setRecipeError('');
    try {
      const cache = loadNutritionCache();
      for (const rid of selectedWeekly) {
        const recipe = getRecipe(rid);
        if (!recipe) continue;
        let totalNutrition;
        totalNutrition = getCachedTotals(cache[rid]);
        if (!totalNutrition) {
          const result = await fetchNutritionForRecipe(recipe.ingredients || []);
          totalNutrition = result.totals;
          try {
            cache[rid] = result;
            localStorage.setItem(NUTRITION_CACHE_KEY, JSON.stringify(cache));
          } catch {}
        }
        const recipeServings = recipe.servings || 1;
        const perServing = computePerServing(cache[rid], recipe.ingredients, recipeServings) || (() => {
          const ps = {};
          for (const n of NUTRIENTS) ps[n.key] = (totalNutrition[n.key] || 0) / recipeServings;
          return ps;
        })();
        const nutrition = scaleNutrition(perServing, 1);
        const mealSlot = categoryToSlot(recipe.category);
        onAdd({
          id: uuid(),
          type: 'recipe',
          recipeId: rid,
          recipeName: recipe.title,
          servings: 1,
          customWeight: null,
          mealSlot,
          timestamp: new Date().toISOString(),
          nutrition,
        });
      }
      setSelectedWeekly(new Set());
    } catch (err) {
      setRecipeError('Failed to look up nutrition. Try again.');
    } finally {
      setRecipeLoading(false);
    }
  }

  return (
    <>
      <div className={styles.addCard}>
        <h3>Track Meal</h3>

        {showMealModal && (
          <CustomMealModal onAdd={onAdd} onClose={() => setShowMealModal(false)} />
        )}

        {weeklyRecipes.length > 0 && (
          <div className={styles.weeklyChips}>
            <span className={styles.weeklyLabel}>This Week's Menu</span>
            {weeklyRecipes.map(r => (
              <button
                key={r.id}
                className={selectedWeekly.has(r.id) ? styles.weeklyChipActive : styles.weeklyChip}
                onClick={() => toggleWeekly(r.id)}
              >
                {r.title}
              </button>
            ))}
          </div>
        )}

        <div className={styles.formRow}>
          <div className={styles.formField}>
            <span className={styles.formLabel}>Recipe</span>
            <RecipeCombobox recipes={sortedRecipes} value={recipeId} onSelect={setRecipeId} />
          </div>
          <div className={styles.formFieldSmall}>
            <span className={styles.formLabel}>Servings</span>
            <input className={styles.formInput} type="number" value={servings} onChange={e => setServings(e.target.value)} min="0.25" step="0.25" />
          </div>
          <div className={styles.formFieldSmall}>
            <span className={styles.formLabel}>Weight (g)</span>
            <input className={styles.formInput} type="number" value={customWeight} onChange={e => setCustomWeight(e.target.value)} placeholder="optional" min="1" />
          </div>
        </div>

        <div className={styles.formRow}>
          <button
            className={styles.addBtn}
            onClick={async () => {
              if (selectedWeekly.size > 0) await handleAddWeeklySelected();
              if (recipeId) await handleAddRecipe();
            }}
            disabled={recipeLoading || (selectedWeekly.size === 0 && !recipeId)}
          >
            {recipeLoading ? 'Adding...' : 'Add Meal'}
          </button>
          <button className={styles.customMealBtn} onClick={() => setShowMealModal(true)}>+ Custom Meal</button>
        </div>
        {recipeError && <p className={styles.addError}>{recipeError}</p>}
      </div>

      <div className={styles.addCard}>
        <h3>Track Snack</h3>
        <div className={styles.formRow}>
          <div className={styles.formField}>
            <span className={styles.formLabel}>Ingredient</span>
            <IngredientCombobox
              value={ingredientName}
              onChange={setIngredientName}
              onSelect={(item) => {
                setIngredientName(item.ingredient);
                if (item.measurement) {
                  const m = item.measurement.toLowerCase().replace(/\(s\)/g, '').replace(/_.*$/, '').trim();
                  setMeasurement(m || 'g');
                }
              }}
            />
          </div>
          <div className={styles.formFieldSmall}>
            <span className={styles.formLabel}>Quantity</span>
            <input className={styles.formInput} type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="1" min="0.1" step="0.1" />
          </div>
          <div className={styles.formFieldSmall}>
            <span className={styles.formLabel}>Unit</span>
            <select className={styles.formSelect} value={measurement} onChange={e => setMeasurement(e.target.value)}>
              {(MEASUREMENT_OPTIONS.includes(measurement) ? MEASUREMENT_OPTIONS : [measurement, ...MEASUREMENT_OPTIONS]).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className={styles.formRow}>
          <button
            className={styles.addBtn}
            onClick={handleAddCustom}
            disabled={ingLoading || !ingredientName.trim()}
          >
            {ingLoading ? 'Adding...' : 'Add Snack'}
          </button>
        </div>
        {ingError && <p className={styles.addError}>{ingError}</p>}
        {ingLoading && <p className={styles.addLoading}>Looking up nutrition...</p>}
      </div>
    </>
  );
}

/* ── Custom Meal Inline (no overlay) ── */
function CustomMealInline({ onAdd, onBack }) {
  const [mealName, setMealName] = useState('');
  const [mealSlotChoice, setMealSlotChoice] = useState('lunch');
  const [mealIngredients, setMealIngredients] = useState([]);
  const [mealIngName, setMealIngName] = useState('');
  const [mealIngQty, setMealIngQty] = useState('');
  const [mealIngUnit, setMealIngUnit] = useState('g');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function addMealIngredient() {
    if (!mealIngName.trim()) return;
    setMealIngredients(prev => [...prev, { id: uuid(), ingredient: mealIngName.trim(), quantity: mealIngQty || '1', measurement: mealIngUnit }]);
    setMealIngName(''); setMealIngQty(''); setMealIngUnit('g');
  }

  function removeMealIngredient(id) { setMealIngredients(prev => prev.filter(i => i.id !== id)); }

  async function handleSubmit() {
    if (!mealName.trim() || mealIngredients.length === 0) return;
    setLoading(true); setError('');
    try {
      const totalNutrition = {};
      for (const n of NUTRIENTS) totalNutrition[n.key] = 0;
      const ingredientNutrition = [];
      const ingredientData = [];
      for (const ing of mealIngredients) {
        const result = await fetchNutritionForIngredient({ ingredient: ing.ingredient, quantity: ing.quantity, measurement: ing.measurement });
        const ingNutrients = {};
        if (result?.nutrients) {
          for (const n of NUTRIENTS) {
            totalNutrition[n.key] += result.nutrients[n.key] || 0;
            ingNutrients[n.key] = result.nutrients[n.key] || 0;
          }
        }
        ingredientNutrition.push({
          name: `${ing.quantity} ${ing.measurement} ${ing.ingredient}`,
          ingredient: ing.ingredient,
          quantity: ing.quantity,
          measurement: ing.measurement,
          nutrition: ingNutrients,
          source: result?.source || 'unknown',
        });
        ingredientData.push({
          quantity: ing.quantity,
          measurement: ing.measurement,
          ingredient: ing.ingredient,
          nutrition: ingNutrients,
        });
      }
      onAdd({ id: uuid(), type: 'custom_meal', recipeName: mealName.trim(), ingredients: mealIngredients.map(i => `${i.quantity} ${i.measurement} ${i.ingredient}`), ingredientData, ingredientNutrition, mealSlot: mealSlotChoice, timestamp: new Date().toISOString(), nutrition: totalNutrition });
    } catch { setError('Failed to look up nutrition for one or more ingredients.'); } finally { setLoading(false); }
  }

  return (
    <div>
      <button className={styles.trackMenuBack} onClick={onBack}>&larr; Back</button>
      <h4 className={styles.trackMenuSubtitle}>Add Custom Meal</h4>
      <div className={styles.formRow}>
        <div className={styles.formField}>
          <span className={styles.formLabel}>Meal Name</span>
          <input className={styles.formInput} type="text" placeholder="e.g. Chicken Stir Fry" value={mealName} onChange={e => setMealName(e.target.value)} />
        </div>
        <div className={styles.formFieldSmall}>
          <span className={styles.formLabel}>Meal</span>
          <select className={styles.formSelect} value={mealSlotChoice} onChange={e => setMealSlotChoice(e.target.value)}>
            {MEAL_SLOTS.map(s => <option key={s} value={s}>{MEAL_LABELS[s]}</option>)}
          </select>
        </div>
      </div>
      <div className={styles.mealIngSection}>
        <span className={styles.mealIngHeading}>Ingredients</span>
        {mealIngredients.length > 0 && (
          <div className={styles.mealIngList}>
            {mealIngredients.map(ing => (
              <div key={ing.id} className={styles.mealIngRow}>
                <span className={styles.mealIngText}>{ing.quantity} {ing.measurement} {ing.ingredient}</span>
                <button className={styles.mealIngRemove} onClick={() => removeMealIngredient(ing.id)}>&times;</button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.formRow}>
          <div className={styles.formField}>
            <IngredientCombobox value={mealIngName} onChange={setMealIngName} onSelect={(item) => { setMealIngName(item.ingredient); if (item.measurement) { const m = item.measurement.toLowerCase().replace(/\(s\)/g, '').replace(/_.*$/, '').trim(); setMealIngUnit(m || 'g'); } }} />
          </div>
          <div className={styles.formFieldSmall}>
            <input className={styles.formInput} type="number" placeholder="Qty" value={mealIngQty} onChange={e => setMealIngQty(e.target.value)} min="0.1" step="0.1" />
          </div>
          <div className={styles.formFieldSmall}>
            <input className={styles.formInput} type="text" list="meal-unit-options-inline" placeholder="g" value={mealIngUnit} onChange={e => setMealIngUnit(e.target.value)} />
            <datalist id="meal-unit-options-inline">
              {MEASUREMENT_OPTIONS.map(m => <option key={m} value={m} />)}
            </datalist>
          </div>
          <button className={styles.mealIngAddBtn} onClick={addMealIngredient} disabled={!mealIngName.trim()}>+</button>
        </div>
      </div>
      {error && <p className={styles.addError}>{error}</p>}
      {loading && <p className={styles.addLoading}>Looking up nutrition...</p>}
      <div className={styles.formRow}>
        <button className={styles.addBtn} onClick={handleSubmit} disabled={loading || !mealName.trim() || mealIngredients.length === 0}>{loading ? 'Adding...' : 'Add Meal'}</button>
      </div>
    </div>
  );
}

/* ── Multi Snack Tracker (direct search, add multiple) ── */
function SnackTrackerInline({ onAdd, onClose }) {
  const [items, setItems] = useState([]);
  const [ingredientName, setIngredientName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [measurement, setMeasurement] = useState('g');
  const [gramsMode, setGramsMode] = useState(false);
  const [gramsInput, setGramsInput] = useState('');
  const [selectedDbItem, setSelectedDbItem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Auto-match ingredient name to DB when typing (not just on select)
  useEffect(() => {
    if (!ingredientName.trim()) { setSelectedDbItem(null); return; }
    const db = loadIngredients() || [];
    const lower = ingredientName.trim().toLowerCase();
    const match = db.find(i => (i.ingredient || '').toLowerCase() === lower);
    if (match) setSelectedDbItem(match);
  }, [ingredientName]);

  async function handleAddItem() {
    if (!ingredientName.trim()) return;
    setLoading(true);
    setError('');
    try {
      // Grams mode: scale from ingredient database
      if (gramsMode && selectedDbItem && gramsInput) {
        const dbGrams = parseFloat(selectedDbItem.grams) || 100;
        const myGrams = parseFloat(gramsInput) || 0;
        if (myGrams <= 0) { setError('Enter a weight in grams.'); setLoading(false); return; }
        const factor = myGrams / dbGrams;
        const nutrition = {};
        for (const n of NUTRIENTS) {
          const val = parseFloat(selectedDbItem[n.key]) || 0;
          nutrition[n.key] = Math.round(val * factor * 10) / 10;
        }
        setItems(prev => [...prev, {
          id: uuid(),
          ingredientName: ingredientName.trim(),
          quantity: myGrams,
          measurement: 'g',
          nutrition,
        }]);
        setIngredientName('');
        setGramsInput('');
        setSelectedDbItem(null);
        setLoading(false);
        return;
      }

      const result = await fetchNutritionForIngredient({
        ingredient: ingredientName.trim(),
        quantity: quantity || '1',
        measurement,
      });
      if (!result) {
        setError('No nutrition data found.');
        return;
      }
      setItems(prev => [...prev, {
        id: uuid(),
        ingredientName: ingredientName.trim(),
        quantity: parseFloat(quantity) || 1,
        measurement,
        nutrition: result.nutrients,
      }]);
      setIngredientName('');
      setQuantity('');
      setMeasurement('g');
    } catch {
      setError('Failed to look up nutrition.');
    } finally {
      setLoading(false);
    }
  }

  function removeItem(id) {
    setItems(prev => prev.filter(i => i.id !== id));
  }

  function handleSubmitAll() {
    for (const item of items) {
      onAdd({
        id: uuid(),
        type: 'custom',
        ingredientName: item.ingredientName,
        quantity: item.quantity,
        measurement: item.measurement,
        mealSlot: 'snack',
        timestamp: new Date().toISOString(),
        nutrition: item.nutrition,
      });
    }
    if (onClose) onClose();
  }

  return (
    <div>
      <div className={styles.formRow}>
        <div className={styles.formField}>
          <span className={styles.formLabel}>Search ingredient</span>
          <IngredientCombobox
            value={ingredientName}
            onChange={setIngredientName}
            onSelect={(item) => {
              setIngredientName(item.ingredient);
              setSelectedDbItem(item);
              if (item.measurement) {
                const m = item.measurement.toLowerCase().replace(/\(s\)/g, '').replace(/_.*$/, '').trim();
                setMeasurement(m || 'g');
              }
            }}
          />
        </div>
        {!gramsMode && (
          <>
            <div className={styles.formFieldSmall}>
              <span className={styles.formLabel}>Qty</span>
              <input className={styles.formInput} type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="1" min="0.1" step="0.1" />
            </div>
            <div className={styles.formFieldSmall}>
              <span className={styles.formLabel}>Unit</span>
              <input className={styles.formInput} type="text" list="snack-unit-opts" value={measurement} onChange={e => setMeasurement(e.target.value)} placeholder="g" />
              <datalist id="snack-unit-opts">
                {MEASUREMENT_OPTIONS.map(m => <option key={m} value={m} />)}
              </datalist>
            </div>
          </>
        )}
        {!gramsMode && (
          <button className={styles.mealIngAddBtn} onClick={handleAddItem} disabled={loading || !ingredientName.trim()}>
            {loading ? '...' : '+'}
          </button>
        )}
      </div>

      {/* Standard macros for selected ingredient */}
      {selectedDbItem && (
        <div className={styles.ingredientStandardMacros}>
          <span className={styles.ingredientStandardLabel}>
            Per serving ({selectedDbItem.grams || 100}g{selectedDbItem.measurement && selectedDbItem.measurement !== 'g' ? `, ${selectedDbItem.measurement}` : ''}):
          </span>
          <div className={styles.ingredientMacroRow}>
            <span>{selectedDbItem.calories || 0} cal</span>
            <span>{selectedDbItem.protein || 0}g P</span>
            <span>{selectedDbItem.carbs || 0}g C</span>
            <span>{selectedDbItem.fat || 0}g F</span>
          </div>
        </div>
      )}

      {/* Grams input with scaled macros */}
      {selectedDbItem && (
        <div className={styles.gramsSection}>
          <div className={styles.gramsInputRow}>
            <span className={styles.formLabel}>My portion (grams)</span>
            <input className={styles.formInput} type="number" value={gramsInput} onChange={e => setGramsInput(e.target.value)} placeholder="g" min="1" step="1" style={{ width: '80px' }} />
            <button className={styles.mealIngAddBtn} onClick={() => { setGramsMode(true); handleAddItem(); }} disabled={loading || !gramsInput}>
              {loading ? '...' : '+'}
            </button>
          </div>
          {gramsInput && (() => {
            const dbGrams = parseFloat(selectedDbItem.grams) || 100;
            const myGrams = parseFloat(gramsInput) || 0;
            if (myGrams <= 0) return null;
            const factor = myGrams / dbGrams;
            const cal = Math.round((parseFloat(selectedDbItem.calories) || 0) * factor);
            const pro = Math.round((parseFloat(selectedDbItem.protein) || 0) * factor * 10) / 10;
            const carb = Math.round((parseFloat(selectedDbItem.carbs) || 0) * factor * 10) / 10;
            const fat = Math.round((parseFloat(selectedDbItem.fat) || 0) * factor * 10) / 10;
            return (
              <div className={styles.gramsScaledMacros}>
                <span className={styles.gramsScaledLabel}>For {myGrams}g:</span>
                <span className={styles.gramsScaledValue}>{cal} cal</span>
                <span className={styles.gramsScaledValue}>{pro}g P</span>
                <span className={styles.gramsScaledValue}>{carb}g C</span>
                <span className={styles.gramsScaledValue}>{fat}g F</span>
              </div>
            );
          })()}
        </div>
      )}
      {error && <p className={styles.addError}>{error}</p>}

      {items.length > 0 && (
        <div className={styles.snackList}>
          {items.map(item => (
            <div key={item.id} className={styles.snackItem}>
              <span>{item.quantity} {item.measurement} {item.ingredientName}</span>
              <span className={styles.snackItemCal}>{Math.round(item.nutrition?.calories || 0)} cal</span>
              <button className={styles.snackItemRemove} onClick={() => removeItem(item.id)}>&times;</button>
            </div>
          ))}
          <button className={styles.addBtn} onClick={handleSubmitAll}>
            Add {items.length} Snack{items.length > 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Track Single Ingredient ── */
function TrackIngredientInline({ onAdd, onBack }) {
  const [ingredientName, setIngredientName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [measurement, setMeasurement] = useState('g');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleAdd() {
    if (!ingredientName.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await fetchNutritionForIngredient({
        ingredient: ingredientName.trim(),
        quantity: quantity || '1',
        measurement,
      });
      if (!result) {
        setError('No nutrition data found for that ingredient.');
        return;
      }
      onAdd({
        id: uuid(),
        type: 'custom',
        ingredientName: ingredientName.trim(),
        quantity: parseFloat(quantity) || 1,
        measurement,
        mealSlot: 'snack',
        timestamp: new Date().toISOString(),
        nutrition: result.nutrients,
      });
    } catch {
      setError('Failed to look up nutrition. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button className={styles.trackMenuBack} onClick={onBack}>&larr; Back</button>
      <h4 className={styles.trackMenuSubtitle}>Track Ingredient</h4>
      <div className={styles.formRow}>
        <div className={styles.formField}>
          <span className={styles.formLabel}>Ingredient</span>
          <IngredientCombobox
            value={ingredientName}
            onChange={setIngredientName}
            onSelect={(item) => {
              setIngredientName(item.ingredient);
              if (item.measurement) {
                const m = item.measurement.toLowerCase().replace(/\(s\)/g, '').replace(/_.*$/, '').trim();
                setMeasurement(m || 'g');
              }
            }}
          />
        </div>
        <div className={styles.formFieldSmall}>
          <span className={styles.formLabel}>Qty</span>
          <input className={styles.formInput} type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="1" min="0.1" step="0.1" />
        </div>
        <div className={styles.formFieldSmall}>
          <span className={styles.formLabel}>Unit</span>
          <input className={styles.formInput} type="text" list="track-ing-units" value={measurement} onChange={e => setMeasurement(e.target.value)} placeholder="g" />
          <datalist id="track-ing-units">
            {MEASUREMENT_OPTIONS.map(m => <option key={m} value={m} />)}
          </datalist>
        </div>
      </div>
      <div className={styles.formRow}>
        <button className={styles.addBtn} onClick={handleAdd} disabled={loading || !ingredientName.trim()}>
          {loading ? 'Adding...' : 'Add Ingredient'}
        </button>
      </div>
      {error && <p className={styles.addError}>{error}</p>}
      {loading && <p className={styles.addLoading}>Looking up nutrition...</p>}
    </div>
  );
}

/* ── AI Estimate (restaurant meal) ── */
function AiEstimateInline({ onAdd, onBack }) {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleEstimate() {
    if (!description.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/generate-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Estimate the nutrition for this restaurant/takeout meal I ate: "${description.trim()}".
Give me a realistic estimate for a single serving as it would be served at a restaurant.
Return exactly 1 recipe object with estimated ingredients and realistic nutrition values.
Set the title to a clean name for the meal.
Set servings to 1.
Include macrosPerServing with calories, protein, carbs, and fat.
For each ingredient, include a "nutrition" object with estimated calories, protein, carbs, and fat for that ingredient's portion in the meal. Example ingredient: {"quantity": "1", "measurement": "cup", "ingredient": "white rice", "nutrition": {"calories": 205, "protein": 4, "carbs": 45, "fat": 0.4}}`,
          count: 1,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to estimate nutrition.');
      }
      const data = await res.json();
      const recipe = (data.recipes || [])[0];
      if (!recipe) throw new Error('No estimate returned.');
      setResult(recipe);
    } catch (err) {
      setError(err.message || 'Failed to estimate. Try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleAdd() {
    if (!result) return;
    const macros = result.macrosPerServing || {};
    const nutrition = {
      calories: macros.calories || 0,
      protein: macros.protein || 0,
      carbs: macros.carbs || 0,
      fat: macros.fat || 0,
    };
    onAdd({
      id: uuid(),
      type: 'custom_meal',
      recipeName: result.title || description.trim(),
      ingredients: (result.ingredients || []).map(i => `${i.quantity} ${i.measurement} ${i.ingredient}`),
      ingredientData: (result.ingredients || []).map(i => ({
        quantity: i.quantity || '',
        measurement: i.measurement || '',
        ingredient: i.ingredient || '',
        nutrition: i.nutrition || {},
      })),
      mealSlot: 'lunch',
      timestamp: new Date().toISOString(),
      nutrition,
      estimated: true,
    });
  }

  return (
    <div>
      <button className={styles.trackMenuBack} onClick={onBack}>&larr; Back</button>
      <h4 className={styles.trackMenuSubtitle}>AI Estimate</h4>
      <p className={styles.aiEstimateHint}>Describe what you ate and we'll estimate the nutrition.</p>
      <div className={styles.formRow}>
        <div className={styles.formField}>
          <textarea
            className={styles.aiEstimateInput}
            rows={3}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Chipotle chicken burrito bowl with white rice, black beans, fajita veggies, corn salsa, and cheese"
            disabled={loading}
          />
        </div>
      </div>
      <div className={styles.formRow}>
        <button className={styles.addBtn} onClick={handleEstimate} disabled={loading || !description.trim()}>
          {loading ? 'Estimating...' : 'Estimate Nutrition'}
        </button>
      </div>
      {error && <p className={styles.addError}>{error}</p>}
      {result && (
        <div className={styles.aiEstimateResult}>
          <h4 className={styles.aiEstimateTitle}>{result.title}</h4>
          <div className={styles.aiEstimateMacros}>
            <span><strong>{result.macrosPerServing?.calories || 0}</strong> cal</span>
            <span><strong>{result.macrosPerServing?.protein || 0}g</strong> protein</span>
            <span><strong>{result.macrosPerServing?.carbs || 0}g</strong> carbs</span>
            <span><strong>{result.macrosPerServing?.fat || 0}g</strong> fat</span>
          </div>
          {result.ingredients && result.ingredients.length > 0 && (
            <div className={styles.aiEstimateBreakdown}>
              <table className={styles.aiEstimateTable}>
                <thead>
                  <tr>
                    <th>Ingredient</th>
                    <th>Cal</th>
                    <th>Pro</th>
                    <th>Carbs</th>
                    <th>Fat</th>
                  </tr>
                </thead>
                <tbody>
                  {result.ingredients.map((ing, i) => (
                    <tr key={i}>
                      <td>{ing.quantity} {ing.measurement} {ing.ingredient}</td>
                      <td>{ing.nutrition?.calories || '—'}</td>
                      <td>{ing.nutrition?.protein || '—'}g</td>
                      <td>{ing.nutrition?.carbs || '—'}g</td>
                      <td>{ing.nutrition?.fat || '—'}g</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.aiEstimateHint}>Not right? Edit your description above and re-estimate.</p>
          <div className={styles.formRow} style={{ gap: '0.5rem' }}>
            <button className={styles.addBtn} onClick={handleAdd}>Add to Meal Log</button>
            <button className={styles.addBtnSecondary} onClick={handleEstimate} disabled={loading || !description.trim()}>
              {loading ? 'Estimating...' : 'Re-estimate'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Add Recipe Quick (1 serving) ── */
function AddRecipeQuick({ recipes, getRecipe, onAdd, onBack, weeklyPlan, inline, targetSlot, externalRecipeId }) {
  const [recipeId, setRecipeId] = useState('');
  const [servingAmount, setServingAmount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showWeight, setShowWeight] = useState(false);
  const [mealWeight, setMealWeight] = useState('');
  const [showIngWeights, setShowIngWeights] = useState(false);
  const [ingWeights, setIngWeights] = useState({});
  const [nutCacheVersion, setNutCacheVersion] = useState(0);
  const [previewTotal, setPreviewTotal] = useState(null); // the green Total row nutrition
  const [previewNutrition, setPreviewNutrition] = useState(null); // { perServing, recipeServings }
  const prevPreviewId = useRef('');

  // Sync with externally selected recipe (from quick picks)
  useEffect(() => {
    if (externalRecipeId) setRecipeId(externalRecipeId);
  }, [externalRecipeId]);

  // Reset per-ingredient weights when recipe changes, and pre-fetch nutrition
  useEffect(() => {
    setIngWeights({});
    setShowIngWeights(false);
    // Pre-fetch nutrition so the custom portions table has data
    if (recipeId) {
      const recipe = getRecipe(recipeId);
      if (recipe) {
        const cache = loadNutritionCache();
        if (!getCachedTotals(cache[recipeId])) {
          fetchNutritionForRecipe(recipe.ingredients || []).then(result => {
            try { const c = loadNutritionCache(); c[recipeId] = result; localStorage.setItem(NUTRITION_CACHE_KEY, JSON.stringify(c)); } catch {}
            setNutCacheVersion(v => v + 1); // trigger re-render
          }).catch(() => {});
        }
      }
    }
  }, [recipeId]);

  // Fetch nutrition for preview when recipe is selected
  useEffect(() => {
    if (!recipeId) { setPreviewNutrition(null); prevPreviewId.current = ''; return; }
    if (prevPreviewId.current === recipeId) return;
    prevPreviewId.current = recipeId;
    setPreviewNutrition(null);
    const recipe = getRecipe(recipeId);
    if (!recipe) return;
    const cache = loadNutritionCache();
    if (getCachedTotals(cache[recipeId])) {
      const recipeServings = parseInt(recipe.servings) || 1;
      const perServing = computePerServing(cache[recipeId], recipe.ingredients, recipeServings);
      if (perServing) { setPreviewNutrition({ perServing, recipeServings }); return; }
      const totals = getCachedTotals(cache[recipeId]);
      const ps = {};
      for (const n of NUTRIENTS) ps[n.key] = (totals[n.key] || 0) / recipeServings;
      setPreviewNutrition({ perServing: ps, recipeServings });
      return;
    }
    // Fetch if not cached
    fetchNutritionForRecipe(recipe.ingredients || []).then(result => {
      try { const c = loadNutritionCache(); c[recipeId] = result; localStorage.setItem(NUTRITION_CACHE_KEY, JSON.stringify(c)); } catch {}
      const recipeServings = parseInt(recipe.servings) || 1;
      const perServing = computePerServing({ items: result.items, totals: result.totals }, recipe.ingredients, recipeServings) || (() => {
        const ps = {};
        for (const n of NUTRIENTS) ps[n.key] = (result.totals[n.key] || 0) / recipeServings;
        return ps;
      })();
      setPreviewNutrition({ perServing, recipeServings });
    }).catch(() => {});
  }, [recipeId, getRecipe]);

  const sortedRecipes = useMemo(() => {
    const filtered = [...recipes].filter(r => (r.frequency || 'common') !== 'retired');
    if (targetSlot) {
      const slotCategory = targetSlot === 'breakfast' ? 'breakfast' : 'lunch-dinner';
      // Sort matching category first, then alphabetical
      return filtered.sort((a, b) => {
        const aMatch = (a.category || 'lunch-dinner') === slotCategory ? 0 : 1;
        const bMatch = (b.category || 'lunch-dinner') === slotCategory ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return (a.title || '').localeCompare(b.title || '');
      });
    }
    return filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }, [recipes, targetSlot]);

  const weeklyRecipes = useMemo(() => {
    if (!weeklyPlan || weeklyPlan.length === 0) return [];
    return weeklyPlan.map(id => recipes.find(r => r.id === id)).filter(Boolean);
  }, [weeklyPlan, recipes]);

  async function handleAdd(useWeight) {
    if (!recipeId) return;
    const recipe = getRecipe(recipeId);
    if (!recipe) {
      setError("That recipe isn't in your collection anymore. Pick another option.");
      setRecipeId('');
      return;
    }

    setLoading(true);
    setError('');
    try {
      let cache = loadNutritionCache();
      let totalNutrition;
      totalNutrition = getCachedTotals(cache[recipeId]);
      if (!totalNutrition) {
        const result = await fetchNutritionForRecipe(recipe.ingredients || []);
        totalNutrition = result.totals;
        try { cache[recipeId] = result; localStorage.setItem(NUTRITION_CACHE_KEY, JSON.stringify(cache)); } catch {}
      }
      // Reload cache to get per-ingredient data from the fetch
      cache = loadNutritionCache();
      const recipeServings = parseInt(recipe.servings) || 1;

      const mw = parseFloat(mealWeight) || 0;
      const hasIngWeights = Object.values(ingWeights).some(v => parseFloat(v) > 0);

      const factor = servingAmount || 1;
      if (useWeight && previewTotal) {
        // USE THE EXACT SAME VALUES shown in the preview table Total row, scaled by servingAmount
        const nutrition = {};
        for (const n of NUTRIENTS) nutrition[n.key] = Math.round(((previewTotal[n.key] || 0) * factor) * 10) / 10;
        const mealSlot = inline ? undefined : categoryToSlot(recipe.category);
        onAdd({ id: uuid(), type: 'recipe', recipeId, recipeName: recipe.title, servings: factor, customWeight: mw > 0 ? mw : null, ingredientWeights: hasIngWeights ? { ...ingWeights } : null, ...(mealSlot ? { mealSlot } : {}), timestamp: new Date().toISOString(), nutrition });
      } else {
        // Standard: scale by servingAmount
        const perServing = computePerServing(cache[recipeId], recipe.ingredients, recipeServings) || (() => {
          const ps = {};
          for (const n of NUTRIENTS) ps[n.key] = (totalNutrition[n.key] || 0) / recipeServings;
          return ps;
        })();
        const nutrition = scaleNutrition(perServing, factor);
        const mealSlot = inline ? undefined : categoryToSlot(recipe.category);

        // Build per-ingredient breakdown for the logged entry
        const cachedItems = getCachedItems(cache[recipeId]);
        const ings = recipe.ingredients || [];
        let ingredientNutrition = null;
        if (cachedItems && cachedItems.length === ings.length) {
          ingredientNutrition = ings.map((ing, idx) => {
            const ingNut = cachedItems[idx]?.nutrients || {};
            const divisor = ing.topping ? 1 : recipeServings;
            const scaled = {};
            for (const nt of NUTRIENTS) scaled[nt.key] = Math.round(((ingNut[nt.key] || 0) / divisor * factor) * 10) / 10;
            return {
              name: `${ing.quantity || ''} ${ing.measurement || ''} ${ing.ingredient || ''}`.trim(),
              ingredient: ing.ingredient || '',
              nutrition: scaled,
              topping: !!ing.topping,
            };
          });
        }

        onAdd({ id: uuid(), type: 'recipe', recipeId, recipeName: recipe.title, servings: factor, customWeight: null, ...(ingredientNutrition ? { ingredientNutrition } : {}), ...(mealSlot ? { mealSlot } : {}), timestamp: new Date().toISOString(), nutrition });
      }
    } catch {
      setError('Failed to look up nutrition. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {!inline && onBack && <button className={styles.trackMenuBack} onClick={onBack}>&larr; Back</button>}
      {!inline && <h4 className={styles.trackMenuSubtitle}>Add Recipe</h4>}
      {!inline && weeklyRecipes.length > 0 && (
        <div className={styles.weeklyChips}>
          <span className={styles.weeklyLabel}>This Week's Menu</span>
          {weeklyRecipes.map(r => (
            <button key={r.id} className={recipeId === r.id ? styles.weeklyChipActive : styles.weeklyChip} onClick={() => setRecipeId(r.id)}>{r.title}</button>
          ))}
        </div>
      )}
      <div className={styles.formRow}>
        <div className={styles.formField}>
          <span className={styles.formLabel}>Search your recipes</span>
          <RecipeCombobox recipes={sortedRecipes} value={recipeId} onSelect={setRecipeId} />
        </div>
      </div>
      {recipeId && (
        <div className={styles.formRow} style={{ alignItems: 'center', gap: '0.5rem' }}>
          <span className={styles.formLabel} style={{ margin: 0 }}>Servings</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <button
              className={styles.weekServingBtn}
              style={{ width: 28, height: 28, fontSize: '1rem', borderRadius: '50%', border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={() => setServingAmount(prev => Math.max(0.25, Math.round((prev - 0.25) * 100) / 100))}
            >&minus;</button>
            <input
              type="number"
              value={servingAmount}
              onChange={e => setServingAmount(Math.max(0, parseFloat(e.target.value) || 0))}
              min="0.25"
              step="0.25"
              style={{ width: 55, textAlign: 'center', padding: '0.3rem 0.25rem', border: '1px solid var(--color-border)', borderRadius: 6, fontSize: '0.9rem', fontFamily: 'inherit' }}
            />
            <button
              className={styles.weekServingBtn}
              style={{ width: 28, height: 28, fontSize: '1rem', borderRadius: '50%', border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={() => setServingAmount(prev => Math.round((prev + 0.25) * 100) / 100)}
            >+</button>
          </div>
          {previewNutrition && (
            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
              {Math.round((previewNutrition.perServing.calories || 0) * servingAmount)} cal
            </span>
          )}
        </div>
      )}
      {showWeight && recipeId && (() => {
        void nutCacheVersion; // ensure re-render when nutrition is fetched
        const recipe = getRecipe(recipeId);
        if (!recipe) return null;
        const perMealIngs = (recipe.ingredients || []).map((ing, idx) => ({ ing, idx })).filter(({ ing }) => ing.topping);
        const recipeServings = parseInt(recipe.servings) || 1;
        const cache = loadNutritionCache();
        const cached = cache[recipeId];
        const totalNutrition = getCachedTotals(cached);
        const hasIngWeightsNow = Object.values(ingWeights).some(v => parseFloat(v) > 0);
        const mw = parseFloat(mealWeight);
        const hasMealWeight = showWeight && mw > 0;

        // Compute base 1-serving nutrition (main/batch ingredients only)
        // Cache format: { items: [{ nutrients: { calories, protein, ... } }, ...], totals: { ... } }
        const perIngItems = cached?.items || null;
        const ings = recipe.ingredients || [];

        // Split nutrition: main ingredients vs per-meal toppings
        const mainNut = {};
        const toppingBaseNut = {};
        for (const n of NUTRIENTS) { mainNut[n.key] = 0; toppingBaseNut[n.key] = 0; }

        if (perIngItems && perIngItems.length === ings.length) {
          ings.forEach((ing, idx) => {
            const target = ing.topping ? toppingBaseNut : mainNut;
            const ingNut = perIngItems[idx]?.nutrients || {};
            // Main ingredients: divide by servings (they're part of the batch)
            // Topping ingredients: use as-is (they're per-meal, added fresh each time)
            const divisor = ing.topping ? 1 : recipeServings;
            for (const n of NUTRIENTS) target[n.key] += ((ingNut[n.key] || 0) / divisor);
          });
        } else if (totalNutrition) {
          // Can't split — estimate toppings as proportion of total grams
          const mainGrams = ings.filter(i => !i.topping).reduce((s, i) => s + estimateIngGrams(i), 0);
          const topGrams = ings.filter(i => i.topping).reduce((s, i) => s + estimateIngGrams(i), 0);
          const total = mainGrams + topGrams;
          for (const n of NUTRIENTS) {
            const perServ = (totalNutrition[n.key] || 0) / recipeServings;
            mainNut[n.key] = total > 0 ? perServ * (mainGrams / total) : perServ;
            toppingBaseNut[n.key] = total > 0 ? perServ * (topGrams / total) : 0;
          }
        }

        // Round
        for (const n of NUTRIENTS) { mainNut[n.key] = Math.round(mainNut[n.key] * 10) / 10; toppingBaseNut[n.key] = Math.round(toppingBaseNut[n.key] * 10) / 10; }

        // Compute adjusted topping nutrition from per-ingredient weights
        let toppingAdjNut = null;
        if (hasIngWeightsNow) {
          toppingAdjNut = {};
          for (const n of NUTRIENTS) toppingAdjNut[n.key] = 0;
          perMealIngs.forEach(({ ing, idx }) => {
            const origGrams = estimateIngGrams(ing);
            const rawV = ingWeights[idx];
            const customGrams = parseFloat(rawV);
            const entered = rawV !== undefined && rawV !== '' && !isNaN(customGrams);
            const ratio = entered ? (origGrams > 0 ? customGrams / origGrams : 0) : 1;
            for (const n of NUTRIENTS) toppingAdjNut[n.key] += (toppingBaseNut[n.key] / Math.max(perMealIngs.length, 1)) * ratio;
          });
          // If we have per-ingredient nutrition data, be more precise
          if (perIngItems && perIngItems.length === ings.length) {
            for (const n of NUTRIENTS) toppingAdjNut[n.key] = 0;
            perMealIngs.forEach(({ ing, idx }) => {
              const origGrams = estimateIngGrams(ing);
              const rawV = ingWeights[idx];
              const customGrams = parseFloat(rawV);
              const entered = rawV !== undefined && rawV !== '' && !isNaN(customGrams);
              const ratio = entered ? (origGrams > 0 ? customGrams / origGrams : 0) : 1;
              const ingNut = perIngItems[idx]?.nutrients || {};
              for (const n of NUTRIENTS) toppingAdjNut[n.key] += ((ingNut[n.key] || 0)) * ratio;
            });
          }
          for (const n of NUTRIENTS) toppingAdjNut[n.key] = Math.round(toppingAdjNut[n.key] * 10) / 10;
        }

        // Meal weight nutrition
        let mealWeightNut = null;
        let servingsDisplay = null;
        if (hasMealWeight) {
          const totalWeightNum = parseFloat(recipe.totalWeight) || 0;
          const containerWeightNum = (recipe.containers || []).reduce((sum, c) => sum + (parseFloat(c.weight) || 0), 0) || parseFloat(recipe.containerWeight) || 0;
          const foodWeight = Math.max(0, totalWeightNum - containerWeightNum);
          if (foodWeight > 0) {
            const wf = mw / foodWeight;
            servingsDisplay = parseFloat((wf * recipeServings).toFixed(2));
            mealWeightNut = computeWeightNutrition(cached, recipe.ingredients, wf)
              || (totalNutrition ? (() => { const r = {}; for (const n of NUTRIENTS) r[n.key] = Math.round(((totalNutrition[n.key] || 0) * wf) * 10) / 10; return r; })() : null);
          }
        }

        // Total = main portion + adjusted toppings (or base toppings)
        const totalNut = {};
        const usedToppingNut = toppingAdjNut || toppingBaseNut;
        for (const n of NUTRIENTS) totalNut[n.key] = Math.round(((mainNut[n.key] || 0) + (usedToppingNut[n.key] || 0)) * 10) / 10;

        const macroRow = (label, nut, labelStyle) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0.6rem', background: labelStyle?.bg || 'var(--color-surface)', borderRadius: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '0.78rem', color: labelStyle?.color || 'var(--color-text)', minWidth: '130px' }}>{label}</span>
            <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>{Math.round(nut.calories || 0)} cal</span>
            <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>{Math.round(nut.protein || 0)}g pro</span>
            <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>{Math.round(nut.carbs || 0)}g carb</span>
            <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>{Math.round(nut.fat || 0)}g fat</span>
          </div>
        );

        // Compute total weight for portion row
        const totalWeightNum = parseFloat(recipe.totalWeight) || 0;
        const containerWeightNum = (recipe.containers || []).reduce((sum, c) => sum + (parseFloat(c.weight) || 0), 0) || parseFloat(recipe.containerWeight) || 0;
        const foodWeight = Math.max(0, totalWeightNum - containerWeightNum);
        const portionStdGrams = foodWeight > 0 ? Math.round(foodWeight / recipeServings) : '';

        // Reasons the food weight can't be computed — surfaced inline so the
        // user knows what to fix on the recipe.
        const missingWeightReasons = [];
        if (!totalWeightNum) {
          missingWeightReasons.push('Total cooked weight (g) is not set on this recipe.');
        }
        if (totalWeightNum > 0 && containerWeightNum >= totalWeightNum) {
          missingWeightReasons.push('Container weight equals or exceeds total weight — food weight works out to 0.');
        }
        const hasContainers = Array.isArray(recipe.containers) && recipe.containers.length > 0;
        if (totalWeightNum > 0 && !hasContainers && !recipe.containerWeight) {
          missingWeightReasons.push('Container weight is not set (optional, but improves accuracy if your recipe includes containers).');
        }

        // Per-ingredient standard grams for each topping
        const toppingIngData = perMealIngs.map(({ ing, idx }) => {
          const origGrams = Math.round(estimateIngGrams(ing));
          const rawVal = ingWeights[idx];
          const customGrams = parseFloat(rawVal);
          const hasCustom = rawVal !== undefined && rawVal !== '' && !isNaN(customGrams);
          // Per-ingredient nutrition from cache
          // Topping ingredients are per-meal (not divided across recipe servings)
          // so we use the full cached nutrition as-is (it represents the quantity listed)
          const perIngItems = cached?.items || null;
          const ingNutBase = (perIngItems && perIngItems[idx]?.nutrients) || {};
          const ingNutPerServ = {};
          for (const n of NUTRIENTS) ingNutPerServ[n.key] = ingNutBase[n.key] || 0;
          const ratio = hasCustom ? (origGrams > 0 ? customGrams / origGrams : 0) : 1;
          const ingNutAdj = {};
          for (const n of NUTRIENTS) ingNutAdj[n.key] = Math.round((ingNutPerServ[n.key] || 0) * ratio * 10) / 10;
          return { ing, idx, origGrams, customGrams: hasCustom ? customGrams : null, ingNutPerServ, ingNutAdj };
        });

        // Portion nutrition
        const portionNutAdj = hasMealWeight && mealWeightNut ? mealWeightNut : mainNut;

        // Total = portion + all adjusted toppings
        const finalTotal = {};
        for (const n of NUTRIENTS) {
          let sum = portionNutAdj[n.key] || 0;
          for (const t of toppingIngData) sum += t.ingNutAdj[n.key] || 0;
          finalTotal[n.key] = Math.round(sum * 10) / 10;
        }
        // Store preview total so save button uses exact same values
        if (JSON.stringify(finalTotal) !== JSON.stringify(previewTotal)) {
          setTimeout(() => setPreviewTotal({ ...finalTotal, _mw: mw, _ingWeights: { ...ingWeights } }), 0);
        }

        const th = { fontWeight: 700, color: 'var(--color-text-muted)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em', padding: '0.4rem 0.4rem', textAlign: 'right', whiteSpace: 'nowrap' };
        const td = { fontSize: '0.82rem', padding: '0.4rem 0.4rem', textAlign: 'right', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border-light)' };
        const tdLabel = { fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text)', padding: '0.4rem 0.4rem', textAlign: 'left', borderBottom: '1px solid var(--color-border-light)', whiteSpace: 'nowrap' };
        const inputStyle = { padding: '0.3rem 0.35rem', border: '1px solid var(--color-border)', borderRadius: '5px', fontSize: '0.82rem', fontFamily: 'inherit', width: '65px', textAlign: 'center' };

        return (
          <div style={{ marginTop: '0.5rem', marginBottom: '0.5rem', background: 'var(--color-surface-alt)', borderRadius: '10px', overflow: 'hidden' }}>
            {foodWeight === 0 && missingWeightReasons.length > 0 && (
              <div style={{
                background: '#FEF3C7',
                borderBottom: '1px solid #FDE68A',
                padding: '0.6rem 0.75rem',
              }}>
                <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#92400E', marginBottom: '0.25rem' }}>
                  Top-down weighing isn't set up for this recipe
                </div>
                <div style={{ fontSize: '0.72rem', color: '#78350F', marginBottom: '0.4rem', lineHeight: 1.4 }}>
                  <strong>Top-down</strong> = weigh the full cooked meal with its container, then subtract the container weight. We need that data to compute % of meal.
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.1rem', color: '#78350F', fontSize: '0.78rem', lineHeight: 1.45 }}>
                  {missingWeightReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <div style={{ fontSize: '0.72rem', color: '#92400E', marginTop: '0.4rem', fontStyle: 'italic' }}>
                  Open the recipe and set <strong>total cooked weight</strong> (plus any container weights). Bottom-up weighing (summing each ingredient) is coming as a fallback.
                </div>
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-alt)' }}>
                    <th style={{ ...th, textAlign: 'left', minWidth: '120px' }}></th>
                    <th style={th}>Standard (g)</th>
                    <th style={th}>Adjusted (g)</th>
                    <th style={th}>Cal</th>
                    <th style={th}>Pro</th>
                    <th style={th}>Carb</th>
                    <th style={th}>Fat</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Custom Meal Portion Size */}
                  <tr style={{ background: hasMealWeight ? '#FEF3E6' : 'var(--color-surface)' }}>
                    <td style={tdLabel}>Custom Meal Portion Size</td>
                    <td style={td}>{portionStdGrams || '—'}</td>
                    <td style={{ ...td, padding: '0.25rem 0.4rem' }}>
                      <input
                        type="number"
                        value={mealWeight}
                        onChange={e => setMealWeight(e.target.value)}
                        placeholder={portionStdGrams ? `${portionStdGrams}` : '—'}
                        min="0"
                        style={inputStyle}
                      />
                    </td>
                    <td style={td}>{Math.round(portionNutAdj.calories || 0)}</td>
                    <td style={td}>{Math.round(portionNutAdj.protein || 0)}</td>
                    <td style={td}>{Math.round(portionNutAdj.carbs || 0)}</td>
                    <td style={td}>{Math.round(portionNutAdj.fat || 0)}</td>
                  </tr>
                  {/* Per-meal ingredients title row */}
                  {toppingIngData.length > 0 && (
                    <tr style={{ background: 'var(--color-surface-alt)' }}>
                      <td colSpan={7} style={{ ...tdLabel, fontWeight: 700, fontSize: '0.78rem', color: '#7C3AED', borderBottom: '2px solid #EDE9FE', padding: '0.5rem 0.4rem 0.25rem' }}>Per-Meal Ingredients</td>
                    </tr>
                  )}
                  {/* Per-meal ingredient rows */}
                  {toppingIngData.map(t => (
                    <tr key={t.idx} style={{ background: t.customGrams ? '#F5F3FF' : 'var(--color-surface)' }}>
                      <td style={{ ...tdLabel, paddingLeft: '1rem' }}>{t.ing.ingredient}</td>
                      <td style={td}>{t.origGrams}</td>
                      <td style={{ ...td, padding: '0.25rem 0.4rem' }}>
                        <input
                          type="number"
                          value={ingWeights[t.idx] || ''}
                          onChange={e => setIngWeights(prev => ({ ...prev, [t.idx]: e.target.value }))}
                          placeholder={`${t.origGrams}`}
                          min="0"
                          style={inputStyle}
                        />
                      </td>
                      <td style={td}>{Math.round(t.ingNutAdj.calories || 0)}</td>
                      <td style={td}>{Math.round(t.ingNutAdj.protein || 0)}</td>
                      <td style={td}>{Math.round(t.ingNutAdj.carbs || 0)}</td>
                      <td style={td}>{Math.round(t.ingNutAdj.fat || 0)}</td>
                    </tr>
                  ))}
                  {/* Total */}
                  <tr style={{ background: '#DCFCE7' }}>
                    <td style={{ ...tdLabel, fontWeight: 700, color: '#166534', borderBottom: 'none' }}>Total</td>
                    <td style={{ ...td, borderBottom: 'none' }}></td>
                    <td style={{ ...td, borderBottom: 'none' }}></td>
                    <td style={{ ...td, fontWeight: 700, color: '#166534', borderBottom: 'none' }}>{Math.round(finalTotal.calories || 0)}</td>
                    <td style={{ ...td, fontWeight: 700, color: '#166534', borderBottom: 'none' }}>{Math.round(finalTotal.protein || 0)}</td>
                    <td style={{ ...td, fontWeight: 700, color: '#166534', borderBottom: 'none' }}>{Math.round(finalTotal.carbs || 0)}</td>
                    <td style={{ ...td, fontWeight: 700, color: '#166534', borderBottom: 'none' }}>{Math.round(finalTotal.fat || 0)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
      <div className={styles.formRow} style={{ gap: '0.5rem' }}>
        <button className={styles.addBtn} onClick={() => {
          const hasAnyWeight = showWeight && (parseFloat(mealWeight) > 0 || Object.values(ingWeights).some(v => parseFloat(v) > 0));
          handleAdd(hasAnyWeight);
        }} disabled={loading || !recipeId}>{loading ? 'Adding...' : (showWeight && (parseFloat(mealWeight) > 0 || Object.values(ingWeights).some(v => parseFloat(v) > 0)) ? 'Add Meal (weighted)' : 'Add Meal')}</button>
        <button
          className={showWeight ? styles.addBtnSecondaryActive : styles.addBtnSecondary}
          onClick={() => setShowWeight(prev => !prev)}
          disabled={loading || !recipeId}
          type="button"
        >
          {showWeight ? 'Hide Custom Portions' : 'Custom Meal Portions'}
        </button>
      </div>
      {error && <p className={styles.addError}>{error}</p>}
    </div>
  );
}

/* ── Add Recipe Adjust (custom servings/weight) ── */
const MEASUREMENT_TO_GRAMS = {
  g: 1, grams: 1, gram: 1, gm: 1,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  cup: 140, cups: 140,
  tbsp: 15, tablespoon: 15, tablespoons: 15,
  tsp: 5, teaspoon: 5, teaspoons: 5,
  ml: 1, milliliter: 1, milliliters: 1, millilitre: 1,
  lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  piece: 100, pieces: 100, whole: 100, medium: 150, large: 200, small: 80,
  clove: 5, cloves: 5, slice: 30, slices: 30, can: 400, bunch: 50,
  pinch: 0.5, dash: 0.5, handful: 30,
};

function estimateIngGrams(ing) {
  const qty = parseFloat(ing.quantity) || 1;
  const unit = (ing.measurement || '').trim().toLowerCase();
  // If no measurement but quantity looks like grams (>10), treat as grams
  if (!unit && qty > 10) return qty;
  return qty * (MEASUREMENT_TO_GRAMS[unit] || (qty > 10 ? 1 : 100));
}

function AddRecipeAdjust({ recipes, getRecipe, onAdd, onBack, weeklyPlan }) {
  const [recipeId, setRecipeId] = useState('');
  const [servings, setServings] = useState('1');
  const [customWeight, setCustomWeight] = useState('');
  const [ingWeights, setIngWeights] = useState({});
  const [showIngredients, setShowIngredients] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sortedRecipes = useMemo(() =>
    [...recipes]
      .filter(r => (r.frequency || 'common') !== 'retired')
      .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [recipes]
  );

  const selectedRecipe = recipeId ? getRecipe(recipeId) : null;

  // Reset ingredient weights when recipe changes
  useEffect(() => {
    setIngWeights({});
    setShowIngredients(false);
  }, [recipeId]);

  function updateIngWeight(idx, value) {
    setIngWeights(prev => ({ ...prev, [idx]: value }));
  }

  async function handleAdd() {
    if (!recipeId) return;
    const recipe = getRecipe(recipeId);
    if (!recipe) {
      setError("That recipe isn't in your collection anymore. Pick another option.");
      setRecipeId('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const cache = loadNutritionCache();
      let totalNutrition;
      totalNutrition = getCachedTotals(cache[recipeId]);
      if (!totalNutrition) {
        const result = await fetchNutritionForRecipe(recipe.ingredients || []);
        totalNutrition = result.totals;
        try { cache[recipeId] = result; localStorage.setItem(NUTRITION_CACHE_KEY, JSON.stringify(cache)); } catch {}
      }
      const recipeServings = recipe.servings || 1;
      const perServing = computePerServing(cache[recipeId], recipe.ingredients, recipeServings) || (() => {
        const ps = {};
        for (const n of NUTRIENTS) ps[n.key] = (totalNutrition[n.key] || 0) / recipeServings;
        return ps;
      })();

      // Check if any per-ingredient weights were entered
      const hasIngWeights = Object.values(ingWeights).some(v => parseFloat(v) > 0);

      let factor;
      const cw = parseFloat(customWeight);

      if (hasIngWeights) {
        // Calculate factor based on ratio of custom ingredient weights to original
        const ings = recipe.ingredients || [];
        const originalTotal = ings.reduce((sum, ing) => sum + estimateIngGrams(ing), 0);
        const customTotal = ings.reduce((sum, ing, idx) => {
          const cVal = parseFloat(ingWeights[idx]);
          return sum + (cVal > 0 ? cVal : estimateIngGrams(ing));
        }, 0);
        factor = originalTotal > 0 ? (customTotal / originalTotal) * recipeServings : parseFloat(servings) || 1;
      } else if (cw > 0) {
        const totalGrams = (recipe.ingredients || []).reduce((sum, ing) => sum + estimateIngGrams(ing), 0);
        factor = totalGrams > 0 ? cw / (totalGrams / recipeServings) : parseFloat(servings) || 1;
      } else {
        factor = parseFloat(servings) || 1;
      }

      const nutrition = scaleNutrition(perServing, factor);
      const mealSlot = categoryToSlot(recipe.category);
      const totalCw = hasIngWeights
        ? (recipe.ingredients || []).reduce((sum, ing, idx) => { const v = parseFloat(ingWeights[idx]); return sum + (v > 0 ? v : estimateIngGrams(ing)); }, 0)
        : (cw > 0 ? cw : null);
      onAdd({ id: uuid(), type: 'recipe', recipeId, recipeName: recipe.title, servings: parseFloat(servings) || 1, customWeight: totalCw, ingredientWeights: hasIngWeights ? { ...ingWeights } : null, mealSlot, timestamp: new Date().toISOString(), nutrition });
    } catch {
      setError('Failed to look up nutrition. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button className={styles.trackMenuBack} onClick={onBack}>&larr; Back</button>
      <h4 className={styles.trackMenuSubtitle}>Adjust Existing Recipe</h4>
      <div className={styles.formRow}>
        <div className={styles.formField}>
          <span className={styles.formLabel}>Recipe</span>
          <RecipeCombobox recipes={sortedRecipes} value={recipeId} onSelect={setRecipeId} />
        </div>
        <div className={styles.formFieldSmall}>
          <span className={styles.formLabel}>Servings</span>
          <input className={styles.formInput} type="number" value={servings} onChange={e => setServings(e.target.value)} min="0.25" step="0.25" />
        </div>
        <div className={styles.formFieldSmall}>
          <span className={styles.formLabel}>Total Weight (g)</span>
          <input className={styles.formInput} type="number" value={customWeight} onChange={e => setCustomWeight(e.target.value)} placeholder="optional" min="1" />
        </div>
      </div>

      {selectedRecipe && (() => {
        const perMealIngs = (selectedRecipe.ingredients || []).map((ing, idx) => ({ ing, idx })).filter(({ ing }) => ing.topping);
        if (perMealIngs.length === 0) return null;
        return (
          <div style={{ marginTop: '0.5rem' }}>
            <button
              onClick={() => setShowIngredients(p => !p)}
              style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: '0.25rem 0' }}
            >
              {showIngredients ? '▾ Hide per-meal ingredients' : '▸ Adjust per-meal ingredients'}
            </button>
            {showIngredients && (
              <div style={{ background: 'var(--color-surface-alt)', borderRadius: '8px', marginTop: '0.35rem', maxHeight: '280px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 80px', gap: '0 0.75rem', padding: '0.5rem 0.75rem', background: 'var(--color-surface-alt)', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 1 }}>
                  <span style={{ fontWeight: 700, color: 'var(--color-text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Per-Meal Ingredient</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Recipe Amt</span>
                  <span style={{ fontWeight: 700, color: 'var(--color-text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Actual (g)</span>
                </div>
                <div style={{ overflowY: 'auto', flex: 1, padding: '0 0.75rem 0.5rem' }}>
                  {perMealIngs.map(({ ing, idx }) => {
                    const origGrams = Math.round(estimateIngGrams(ing));
                    return (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 80px', gap: '0 0.75rem', alignItems: 'center', padding: '0.35rem 0', borderBottom: '1px solid var(--color-border-light)' }}>
                        <span style={{ color: 'var(--color-text)', fontWeight: 500, fontSize: '0.85rem' }}>{ing.ingredient}</span>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>{ing.quantity} {ing.measurement} <span style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>({origGrams}g)</span></span>
                        <input
                          type="number"
                          value={ingWeights[idx] || ''}
                          onChange={e => updateIngWeight(idx, e.target.value)}
                          placeholder={`${origGrams}`}
                          min="0"
                          style={{ padding: '0.35rem 0.4rem', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.85rem', fontFamily: 'inherit', width: '100%', textAlign: 'center' }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}
      )}

      <div className={styles.formRow} style={{ marginTop: '0.75rem' }}>
        <button className={styles.addBtn} onClick={handleAdd} disabled={loading || !recipeId}>{loading ? 'Adding...' : 'Add Meal'}</button>
      </div>
      {error && <p className={styles.addError}>{error}</p>}
    </div>
  );
}

/* ── Entry Row ── */
function computeMealScore(nutrition) {
  const goals = loadGoals();
  if (!goals || !nutrition) return null;

  const scores = [];
  for (const n of NUTRIENTS) {
    if (!goals[n.key] || goals[n.key] <= 0) continue;
    const mealGoal = goals[n.key] / 3;
    const actual = nutrition[n.key] || 0;
    const ratio = actual / mealGoal;
    let score;
    if (UNDER_IS_GOOD.has(n.key)) {
      score = ratio <= 1 ? 1 : Math.max(0, 2 - ratio);
    } else {
      score = ratio >= 1 ? 1 : ratio;
    }
    scores.push(score);
  }
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100);
}

function MealScoreBadge({ nutrition }) {
  const score = useMemo(() => computeMealScore(nutrition), [nutrition]);
  if (score == null) return null;

  let color;
  if (score >= 85) color = 'var(--color-success, #16a34a)';
  else if (score >= 65) color = 'var(--color-accent, #3B6B9C)';
  else if (score >= 45) color = '#D4A574';
  else color = 'var(--color-danger, #dc2626)';

  return (
    <span className={styles.mealScoreBadge} style={{ color, borderColor: color }}>
      {score}
    </span>
  );
}

function EntryRow({ entry, onDelete, goalKeys, onEdit, onUpdateEntry, getRecipe }) {
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editQty, setEditQty] = useState(null); // null = not editing, { quantity, measurement } = editing
  const [saving, setSaving] = useState(false);
  const name = entry.type === 'custom_meal' ? entry.recipeName : entry.type === 'recipe' ? entry.recipeName : entry.ingredientName;
  const portion = entry.type === 'recipe'
    ? (entry.customWeight ? `${entry.customWeight}g` : `${entry.servings} serving${entry.servings !== 1 ? 's' : ''}`)
    : entry.type === 'custom_meal'
    ? `${(entry.ingredients || []).length} ingredients`
    : `${entry.quantity} ${entry.measurement}`;
  const n = entry.nutrition || {};
  const keys = goalKeys && goalKeys.length > 0 ? goalKeys : DEFAULT_ENTRY_KEYS;
  const isEditable = entry.type === 'custom_meal' || entry.type === 'recipe';
  const hasBreakdown = (entry.type === 'custom_meal' || entry.type === 'recipe') && entry.ingredientNutrition?.length > 0;
  const canRefresh = (entry.type === 'custom_meal' || entry.type === 'recipe') && !hasBreakdown && (entry.ingredients?.length > 0 || entry.recipeId);

  async function refreshNutrition() {
    if (!onUpdateEntry || refreshing) return;
    setRefreshing(true);
    try {
      const totalNutrition = {};
      for (const nutrient of NUTRIENTS) totalNutrition[nutrient.key] = 0;
      const ingredientNutrition = [];

      for (const ingStr of (entry.ingredients || [])) {
        // Parse "quantity measurement ingredient" from string
        const parts = ingStr.trim().match(/^([\d./]+)?\s*(\S+)?\s+(.+)$/);
        const quantity = parts?.[1] || '1';
        const measurement = parts?.[2] || '';
        const ingredient = parts?.[3] || ingStr;

        const result = await fetchNutritionForIngredient({ ingredient, quantity, measurement });
        const ingNutrients = {};
        if (result?.nutrients) {
          for (const nutrient of NUTRIENTS) {
            totalNutrition[nutrient.key] += result.nutrients[nutrient.key] || 0;
            ingNutrients[nutrient.key] = result.nutrients[nutrient.key] || 0;
          }
        }
        ingredientNutrition.push({
          name: ingStr,
          ingredient,
          quantity,
          measurement,
          nutrition: ingNutrients,
          source: result?.source || 'unknown',
        });
      }

      onUpdateEntry(entry.id, { nutrition: totalNutrition, ingredientNutrition });
      setExpanded(true);
    } catch {} finally {
      setRefreshing(false);
    }
  }

  return (
    <div>
      <div className={styles.entryRow}>
        <MealScoreBadge nutrition={n} />
        {isEditable ? (
          <button className={styles.entryNameBtn} onClick={() => onEdit && onEdit(entry)}>
            {name} <span className={styles.editHint}>edit</span>
          </button>
        ) : (
          <button className={styles.entryNameBtn} onClick={() => setExpanded(p => !p)}>
            {name} {(entry.customWeight || entry.ingredientWeights) && <span className={styles.editHint}>{entry.customWeight ? `${entry.customWeight}g` : 'custom'}</span>}
          </button>
        )}
        <span className={styles.entryPortion}>
          {hasBreakdown || canRefresh ? (
            <button className={styles.expandBtn} onClick={() => {
              if (canRefresh && !hasBreakdown) refreshNutrition();
              else setExpanded(p => !p);
            }}>
              {refreshing ? 'Loading...' : `${portion} ${expanded ? '▾' : '▸'}`}
            </button>
          ) : portion}
        </span>
        <div className={styles.entryMacros}>
          {keys.map(key => (
            <span key={key} className={styles.entryMacro}>
              <span className={styles.macroValue}>{fmtNutrient(n[key], key)}</span>
              <span className={styles.macroLabel}>{SHORT_LABELS[key] || key}</span>
            </span>
          ))}
        </div>
        <button className={styles.deleteBtn} onClick={() => onDelete(entry.id)} aria-label="Delete">&times;</button>
      </div>
      {expanded && hasBreakdown && (() => {
        // Enrich older entries that don't have topping flags by looking up the recipe
        let enriched = entry.ingredientNutrition;
        if (entry.recipeId && getRecipe && !enriched.some(ing => ing.topping)) {
          const recipe = getRecipe(entry.recipeId);
          if (recipe?.ingredients) {
            enriched = enriched.map((ing, idx) => ({
              ...ing,
              topping: recipe.ingredients[idx]?.topping || false,
            }));
          }
        }
        const perMeal = enriched.filter(ing => ing.topping);
        const batch = enriched.filter(ing => !ing.topping);
        return (
          <div className={styles.ingBreakdown}>
            {batch.length > 0 && (
              <>
                {perMeal.length > 0 && <div className={styles.ingBreakdownSection}>Batch (÷ servings)</div>}
                {batch.map((ing, i) => (
                  <div key={`b-${i}`} className={styles.ingBreakdownRow}>
                    <span className={styles.ingBreakdownName}>{ing.name}</span>
                    <div className={styles.ingBreakdownMacros}>
                      {keys.map(key => (
                        <span key={key} className={styles.ingBreakdownMacro}>
                          {fmtNutrient(ing.nutrition?.[key], key)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
            {perMeal.length > 0 && (
              <>
                <div className={styles.ingBreakdownSection}>Per Meal</div>
                {perMeal.map((ing, i) => (
                  <div key={`pm-${i}`} className={styles.ingBreakdownRow}>
                    <span className={styles.ingBreakdownName}>{ing.name}</span>
                    <div className={styles.ingBreakdownMacros}>
                      {keys.map(key => (
                        <span key={key} className={styles.ingBreakdownMacro}>
                          {fmtNutrient(ing.nutrition?.[key], key)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })()}
      {expanded && !hasBreakdown && (
        <div className={styles.ingBreakdown}>
          {entry.type === 'custom' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.25rem 0' }}>
              {/* Editable quantity/measurement */}
              {editQty ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1E293B' }}>{entry.ingredientName || name}</span>
                  <input
                    type="number"
                    value={editQty.quantity}
                    onChange={e => setEditQty(prev => ({ ...prev, quantity: e.target.value }))}
                    style={{ width: '60px', padding: '0.25rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '0.78rem', fontFamily: 'inherit' }}
                    step="any"
                    min="0"
                  />
                  <input
                    type="text"
                    value={editQty.measurement}
                    onChange={e => setEditQty(prev => ({ ...prev, measurement: e.target.value }))}
                    style={{ width: '70px', padding: '0.25rem 0.4rem', border: '1px solid #CBD5E1', borderRadius: '4px', fontSize: '0.78rem', fontFamily: 'inherit' }}
                    placeholder="unit"
                  />
                  <button
                    disabled={saving}
                    onClick={async () => {
                      if (!onUpdateEntry) return;
                      setSaving(true);
                      try {
                        const newQty = parseFloat(editQty.quantity) || entry.quantity;
                        const newMeas = editQty.measurement || entry.measurement;
                        const scale = entry.quantity > 0 ? newQty / entry.quantity : 1;
                        const newNutrition = {};
                        for (const nt of NUTRIENTS) newNutrition[nt.key] = Math.round(((n[nt.key] || 0) * scale) * 10) / 10;
                        onUpdateEntry(entry.id, { quantity: newQty, measurement: newMeas, nutrition: newNutrition });
                        setEditQty(null);
                      } finally { setSaving(false); }
                    }}
                    style={{ padding: '0.2rem 0.6rem', border: 'none', borderRadius: '4px', background: '#3B7DDD', color: '#fff', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                  >{saving ? '...' : 'Save'}</button>
                  <button
                    onClick={() => setEditQty(null)}
                    style={{ padding: '0.2rem 0.5rem', border: '1px solid #E2E8F0', borderRadius: '4px', background: '#fff', color: '#64748B', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit' }}
                  >Cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1E293B' }}>{entry.ingredientName || name}</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--color-accent)', fontWeight: 600 }}>{entry.quantity} {entry.measurement}</span>
                  <button
                    onClick={() => setEditQty({ quantity: entry.quantity, measurement: entry.measurement })}
                    style={{ padding: '0.15rem 0.5rem', border: '1px solid #CBD5E1', borderRadius: '4px', background: '#F8FAFC', color: '#3B7DDD', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                  >Adjust</button>
                  <button
                    onClick={() => onDelete(entry.id)}
                    style={{ padding: '0.15rem 0.5rem', border: '1px solid #FCA5A5', borderRadius: '4px', background: '#FEF2F2', color: '#DC2626', fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                  >Delete</button>
                </div>
              )}

              {/* Nutrition details */}
              {n && Object.keys(n).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', paddingTop: '0.15rem' }}>
                  {NUTRIENTS.filter(nt => n[nt.key] > 0).map(nt => (
                    <span key={nt.key} style={{ fontSize: '0.72rem', color: '#64748B' }}>
                      <span style={{ fontWeight: 600, color: '#1E293B' }}>{fmtNutrient(n[nt.key], nt.key)}</span> {nt.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {entry.customWeight && (
            <div className={styles.ingBreakdownRow}>
              <span className={styles.ingBreakdownName} style={{ fontWeight: 600 }}>Meal portion weight</span>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-accent)', fontWeight: 600 }}>{entry.customWeight}g</span>
            </div>
          )}
          {entry.ingredientWeights && Object.keys(entry.ingredientWeights).length > 0 && (() => {
            return Object.entries(entry.ingredientWeights).filter(([, v]) => parseFloat(v) > 0).map(([idx, grams]) => (
              <div key={idx} className={styles.ingBreakdownRow}>
                <span className={styles.ingBreakdownName}>Per-meal ingredient #{parseInt(idx) + 1}</span>
                <span style={{ fontSize: '0.78rem', color: '#7C3AED', fontWeight: 600 }}>{grams}g</span>
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}

/* ── Meal Log ── */
function MealLog({ entries, onDelete, onEdit, onUpdateEntry, goalKeys, skippedMeals, daySkipped, getRecipe }) {
  const grouped = {};
  for (const slot of MEAL_SLOTS) grouped[slot] = [];
  for (const entry of entries) {
    const slot = entry.type === 'custom' && !entry.mealSlot
      ? 'snack'
      : (MEAL_SLOTS.includes(entry.mealSlot) ? entry.mealSlot : 'snack');
    grouped[slot].push(entry);
  }

  if (daySkipped) {
    return <div className={styles.emptyLog}>Day skipped</div>;
  }

  const hasEntries = entries.length > 0;
  const hasSkips = skippedMeals && skippedMeals.length > 0;

  if (!hasEntries && !hasSkips) {
    return <div className={styles.emptyLog}>No entries yet. Add a recipe or single item above.</div>;
  }

  return (
    <>
      {MEAL_SLOTS.map(slot => {
        const items = grouped[slot];
        const isSkipped = skippedMeals && skippedMeals.includes(slot);
        if (items.length === 0 && !isSkipped) return null;
        return (
          <div key={slot} className={styles.mealSection}>
            <div className={styles.mealHeaderRow}>
              <h4 className={styles.mealHeader}>{MEAL_LABELS[slot]}</h4>
              {isSkipped && <span className={styles.skippedTag}>Skipped</span>}
            </div>
            {isSkipped ? (
              <div className={styles.skippedNote}>Meal skipped</div>
            ) : (
              items.map(entry => (
                <EntryRow key={entry.id} entry={entry} onDelete={onDelete} onEdit={onEdit} onUpdateEntry={onUpdateEntry} goalKeys={goalKeys} getRecipe={getRecipe} />
              ))
            )}
          </div>
        );
      })}
    </>
  );
}

/* ── Daily Totals Progress Bars ── */
function DailyTotalsBar({ entries, daySkipped, skippedMeals }) {
  const goals = useMemo(loadGoals, []);

  if (!goals) return null;

  if (daySkipped) {
    return (
      <div className={styles.totalsCard}>
        <h3>Daily Totals vs Goals</h3>
        <div className={styles.skippedDayBanner}>Day Skipped</div>
      </div>
    );
  }

  // Filter out entries in skipped meal slots
  const activeEntries = skippedMeals && skippedMeals.length > 0
    ? entries.filter(e => {
        const slot = e.type === 'custom' && !e.mealSlot ? 'snack' : (MEAL_SLOTS.includes(e.mealSlot) ? e.mealSlot : 'snack');
        return !skippedMeals.includes(slot);
      })
    : entries;

  const totals = {};
  for (const n of NUTRIENTS) totals[n.key] = 0;
  for (const entry of activeEntries) {
    for (const n of NUTRIENTS) {
      totals[n.key] += entry.nutrition?.[n.key] || 0;
    }
  }

  // Adjust goals: each skipped main meal = 33% of daily target
  const MAIN_MEALS = ['breakfast', 'lunch', 'dinner'];
  const skippedMainCount = skippedMeals ? skippedMeals.filter(s => MAIN_MEALS.includes(s)).length : 0;
  const activeFraction = Math.max(0, 1 - (skippedMainCount / 3));

  const goalRows = NUTRIENTS.filter(n => goals[n.key] > 0).map(n => {
    const adjustedTarget = goals[n.key] * activeFraction;
    const actual = totals[n.key];
    const pct = adjustedTarget > 0 ? Math.round((actual / adjustedTarget) * 100) : 0;
    let barColor;
    if (UNDER_IS_GOOD.has(n.key)) {
      barColor = pct <= 100 ? styles.progressGreen : pct <= 130 ? styles.progressYellow : styles.progressRed;
    } else {
      barColor = pct >= 100 ? styles.progressGreen : pct >= 70 ? styles.progressYellow : styles.progressRed;
    }
    return { ...n, target: goals[n.key], adjustedTarget, actual, pct, barColor };
  });

  if (goalRows.length === 0) return null;

  return (
    <div className={styles.totalsCard}>
      <h3>Daily Totals vs Goals{skippedCount > 0 ? ` (${skippedCount} meal${skippedCount > 1 ? 's' : ''} skipped)` : ''}</h3>
      {goalRows.map(n => (
        <div key={n.key} className={styles.goalRow}>
          <span className={styles.goalLabel}>{n.label}</span>
          <div className={styles.goalBar}>
            <div className={`${styles.goalFill} ${n.barColor}`} style={{ width: `${Math.min(n.pct, 100)}%` }} />
          </div>
          <span className={styles.goalPct}>{n.pct}%</span>
          <span className={styles.goalValues}>
            {Math.round(n.actual * 10) / 10}{n.unit} / {Math.round(n.adjustedTarget * 10) / 10}{n.unit}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── History Chart ── */
const CORE_NUTRIENTS = ['calories', 'protein', 'carbs', 'fat'];

function HistoryChart({ dailyLog }) {
  const [range, setRange] = useState(7);
  const [selectedNutrients, setSelectedNutrients] = useState(['calories', 'protein', 'carbs', 'fat']);
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef(null);
  const goals = useMemo(loadGoals, []);

  useEffect(() => {
    if (!showMore) return;
    function handleClick(e) {
      if (moreRef.current && !moreRef.current.contains(e.target)) setShowMore(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMore]);

  function toggleNutrient(key) {
    setSelectedNutrients(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }

  // Only show nutrients that have a goal set so % is meaningful
  const availableNutrients = useMemo(() =>
    NUTRIENTS.filter(n => goals && goals[n.key] > 0),
    [goals]
  );

  const coreNutrients = useMemo(() => availableNutrients.filter(n => CORE_NUTRIENTS.includes(n.key)), [availableNutrients]);
  const extraNutrients = useMemo(() => availableNutrients.filter(n => !CORE_NUTRIENTS.includes(n.key)), [availableNutrients]);

  const chartData = useMemo(() => {
    if (!goals) return [];
    const today = todayStr();
    const data = [];
    for (let i = range - 1; i >= 0; i--) {
      const dateStr = shiftDate(today, -i);
      const dayData = dailyLog[dateStr] || {};
      const entries = dayData.entries || [];
      const daySkipped = !!dayData.daySkipped;
      const skippedMeals = dayData.skippedMeals || [];

      // Skip this day in calculations if the whole day is skipped
      if (daySkipped) {
        const [, m, d] = dateStr.split('-');
        const row = { date: chartDateLabel(dateStr) };
        for (const n of NUTRIENTS) row[n.key] = null; // null = skipped
        data.push(row);
        continue;
      }

      // Filter out entries in skipped meal slots
      const activeEntries = skippedMeals.length > 0
        ? entries.filter(e => {
            const slot = e.type === 'custom' && !e.mealSlot ? 'snack' : (MEAL_SLOTS.includes(e.mealSlot) ? e.mealSlot : 'snack');
            return !skippedMeals.includes(slot);
          })
        : entries;

      const skippedMainMeals = skippedMeals.filter(s => ['breakfast', 'lunch', 'dinner'].includes(s)).length;
      const activeFraction = Math.max(0, 1 - (skippedMainMeals / 3));

      const totals = {};
      for (const n of NUTRIENTS) totals[n.key] = 0;
      for (const entry of activeEntries) {
        for (const n of NUTRIENTS) {
          totals[n.key] += entry.nutrition?.[n.key] || 0;
        }
      }
      const [, m, d] = dateStr.split('-');
      const row = { date: chartDateLabel(dateStr) };
      if (activeEntries.length === 0) {
        for (const n of NUTRIENTS) row[n.key] = null;
      } else {
        for (const n of NUTRIENTS) {
          const adjustedGoal = goals[n.key] * activeFraction;
          row[n.key] = adjustedGoal > 0 ? Math.round((totals[n.key] / adjustedGoal) * 100) : 0;
        }
      }
      data.push(row);
    }
    return data;
  }, [dailyLog, range, goals]);

  const hasData = chartData.some(d => selectedNutrients.some(k => d[k] > 0));

  return (
    <div className={styles.chartCard}>
      <h3>% of Daily Target</h3>
      <div className={styles.chartControls}>
        <div className={styles.rangeToggle}>
          {[{ days: 7, label: '7d' }, { days: 14, label: '14d' }, { days: 30, label: '30d' }, { days: 90, label: '3mo' }, { days: 365, label: '1yr' }].map(r => (
            <button
              key={r.days}
              className={range === r.days ? styles.rangeBtnActive : styles.rangeBtn}
              onClick={() => setRange(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className={styles.nutrientChecks}>
          {coreNutrients.map(n => (
            <label key={n.key} className={styles.nutrientCheck}>
              <input
                type="checkbox"
                checked={selectedNutrients.includes(n.key)}
                onChange={() => toggleNutrient(n.key)}
              />
              {n.label}
            </label>
          ))}
          {extraNutrients.length > 0 && (
            <div className={styles.moreNutrientsWrap} ref={moreRef}>
              <button className={styles.moreNutrientsBtn} onClick={() => setShowMore(prev => !prev)}>
                + More
              </button>
              {showMore && (
                <div className={styles.moreNutrientsDropdown}>
                  {extraNutrients.map(n => (
                    <label key={n.key} className={styles.moreNutrientsItem}>
                      <input
                        type="checkbox"
                        checked={selectedNutrients.includes(n.key)}
                        onChange={() => toggleNutrient(n.key)}
                      />
                      {n.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!goals ? (
        <div className={styles.noChartData}>Set nutrition goals to see % of daily target.</div>
      ) : !hasData ? (
        <div className={styles.noChartData}>No data in the selected range. Add entries to see trends.</div>
      ) : (
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 55, left: 20, bottom: 5 }}>
              <defs>
                {selectedNutrients.filter(k => goals[k] > 0).map((key, i) => (
                  <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} unit="%" axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.78rem', paddingTop: '0.5rem', textAlign: 'center' }} align="center" />
              <ReferenceLine y={100} stroke="#d1d5db" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: '100%', position: 'right', fontSize: 10, fill: '#9ca3af' }} />
              {selectedNutrients.filter(k => goals[k] > 0).map((key, i) => (
                <Area key={`area-${key}`} type="monotone" dataKey={key} fill={`url(#grad-${key})`} stroke="none" name={NUTRIENTS.find(n => n.key === key)?.label || key} legendType="none" tooltipType="none" />
              ))}
              {selectedNutrients.filter(k => goals[k] > 0).map((key, i) => (
                <Line key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2.5} dot={{ r: 3, fill: '#fff', stroke: CHART_COLORS[i % CHART_COLORS.length], strokeWidth: 2 }} activeDot={{ r: 5, fill: CHART_COLORS[i % CHART_COLORS.length], stroke: '#fff', strokeWidth: 2 }} name={NUTRIENTS.find(n => n.key === key)?.label || key} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* ── Fruit & Veg Servings Chart ── */
function ServingsChart({ dailyLog }) {
  const [range, setRange] = useState(7);
  const goals = useMemo(loadGoals, []);
  const vegTarget = goals?.vegServings || 5;
  const fruitTarget = goals?.fruitServings || 2;

  const chartData = useMemo(() => {
    const today = todayStr();
    const data = [];
    for (let i = range - 1; i >= 0; i--) {
      const dateStr = shiftDate(today, -i);
      const dayData = dailyLog[dateStr] || {};
      const entries = dayData.entries || [];
      const daySkipped = !!dayData.daySkipped;
      const skippedMeals = dayData.skippedMeals || [];

      const [, m, d] = dateStr.split('-');
      const row = { date: chartDateLabel(dateStr) };

      if (daySkipped) {
        row.veg = null;
        row.fruit = null;
        data.push(row);
        continue;
      }

      const activeEntries = skippedMeals.length > 0
        ? entries.filter(e => {
            const slot = e.type === 'custom' && !e.mealSlot ? 'snack' : (MEAL_SLOTS.includes(e.mealSlot) ? e.mealSlot : 'snack');
            return !skippedMeals.includes(slot);
          })
        : entries;

      if (activeEntries.length === 0) {
        row.veg = null;
        row.fruit = null;
      } else {
        let veg = 0;
        let fruit = 0;
        for (const entry of activeEntries) {
          veg += entry.nutrition?.vegServings || 0;
          fruit += entry.nutrition?.fruitServings || 0;
        }
        row.veg = Math.round(veg * 10) / 10;
        row.fruit = Math.round(fruit * 10) / 10;
      }
      data.push(row);
    }
    return data;
  }, [dailyLog, range]);

  const hasData = chartData.some(d => (d.veg != null && d.veg > 0) || (d.fruit != null && d.fruit > 0));

  return (
    <div className={styles.chartCard}>
      <h3>Fruit & Vegetable Servings Per Day</h3>
      <div className={styles.chartControls}>
        <div className={styles.rangeToggle}>
          {[{ days: 7, label: '7d' }, { days: 14, label: '14d' }, { days: 30, label: '30d' }, { days: 90, label: '3mo' }, { days: 365, label: '1yr' }].map(r => (
            <button
              key={r.days}
              className={range === r.days ? styles.rangeBtnActive : styles.rangeBtn}
              onClick={() => setRange(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className={styles.noChartData}>No fruit or vegetable servings tracked yet.</div>
      ) : (
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 55, left: 20, bottom: 5 }}>
              <defs>
                <linearGradient id="grad-veg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad-fruit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ServingsTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.78rem', paddingTop: '0.5rem', textAlign: 'center' }} align="center" />
              <ReferenceLine y={vegTarget} stroke="#22c55e" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `Veg ${vegTarget}`, position: 'right', fontSize: 10, fill: '#22c55e' }} />
              <ReferenceLine y={fruitTarget} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `Fruit ${fruitTarget}`, position: 'right', fontSize: 10, fill: '#f59e0b' }} />
              <Area type="monotone" dataKey="veg" fill="url(#grad-veg)" stroke="none" name="Vegetables" legendType="none" tooltipType="none" />
              <Area type="monotone" dataKey="fruit" fill="url(#grad-fruit)" stroke="none" name="Fruit" legendType="none" tooltipType="none" />
              <Line type="monotone" dataKey="veg" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 3, fill: '#fff', stroke: '#22c55e', strokeWidth: 2 }} activeDot={{ r: 5, fill: '#22c55e', stroke: '#fff', strokeWidth: 2 }} name="Vegetables" />
              <Line type="monotone" dataKey="fruit" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3, fill: '#fff', stroke: '#f59e0b', strokeWidth: 2 }} activeDot={{ r: 5, fill: '#f59e0b', stroke: '#fff', strokeWidth: 2 }} name="Fruit" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function ServingsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const seen = new Set();
  const unique = payload.filter(p => {
    if (seen.has(p.dataKey)) return false;
    seen.add(p.dataKey);
    return true;
  });
  return (
    <div style={{
      background: 'rgba(255,255,255,0.95)',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      padding: '0.5rem 0.75rem',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      fontSize: '0.8rem',
    }}>
      <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: '#374151' }}>{label}</div>
      {unique.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '1px 0' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          <span style={{ color: '#6b7280' }}>{p.name}:</span>
          <span style={{ fontWeight: 600, color: '#111827' }}>{p.value} servings</span>
        </div>
      ))}
    </div>
  );
}

/* ── Main Page ── */
/* ── Weekly View ── */
function WeeklyView({ dailyLog, date, recipes, onDayClick, onMoveEntry, onAddToSlot, onViewRecipe, onRemoveLastEntry, onEditEntry, onSelectDate }) {
  const goals = loadGoals();
  const macroKeys = ['calories', 'protein', 'carbs', 'fat'];
  const [dragOver, setDragOver] = useState(null); // { dateStr, slot }

  // Show 7 days ending with the selected date (rightmost)
  const [sy, sm, sd] = date.split('-').map(Number);
  const selectedDay = new Date(sy, sm - 1, sd);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(selectedDay);
    day.setDate(selectedDay.getDate() - i);
    const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const dayData = dailyLog[dateStr] || {};
    const entries = dayData.entries || [];
    const daySkipped = !!dayData.daySkipped;

    // Group entries by meal slot — store full entry data
    const bySlot = {};
    for (const slot of MEAL_SLOTS) bySlot[slot] = [];
    for (let ei = 0; ei < entries.length; ei++) {
      const entry = entries[ei];
      const slot = entry.mealSlot && MEAL_SLOTS.includes(entry.mealSlot) ? entry.mealSlot : 'snack';
      const name = entry.type === 'custom_meal' ? entry.recipeName : entry.type === 'recipe' ? entry.recipeName : entry.ingredientName;
      bySlot[slot].push({ id: entry.id, entryIndex: ei, name: name || 'Unknown', sourceDate: dateStr, recipeId: entry.recipeId || null, type: entry.type, editable: entry.type === 'custom_meal' || entry.type === 'recipe', clickable: true, nutrition: entry.nutrition || null, entry });
    }

    // Compute totals for macros
    const totals = {};
    for (const key of macroKeys) totals[key] = 0;
    if (!daySkipped) {
      for (const entry of entries) {
        if (entry.nutrition) {
          for (const key of macroKeys) totals[key] += entry.nutrition[key] || 0;
        }
      }
    }

    // Count main meal entries (breakfast, lunch, dinner) — 3+ entries = full day
    const skippedCount = (dayData.skippedMeals || []).length;
    const mainMealEntries = ['breakfast', 'lunch', 'dinner'].reduce((sum, slot) => sum + bySlot[slot].length, 0) + skippedCount;

    days.push({
      dateStr,
      label: day.toLocaleDateString('en-US', { weekday: 'short' }),
      dayNum: day.getDate(),
      daySkipped,
      skippedMeals: dayData.skippedMeals || [],
      bySlot,
      totals,
      hasEntries: entries.length > 0,
      fullDay: mainMealEntries >= 3,
      isPast: dateStr < todayStr(),
    });
  }

  // Compute current streak: consecutive days with 3+ meals tracked
  // Today doesn't break the streak if incomplete — start from yesterday, then add today if it qualifies
  const streak = useMemo(() => {
    const today = todayStr();

    function dayQualifies(dateStr) {
      const dayData = dailyLog[dateStr];
      if (!dayData) return false;
      if (dayData.daySkipped) return true;
      const entries = dayData.entries || [];
      let mainCount = (dayData.skippedMeals || []).length;
      for (const entry of entries) {
        if (entry.mealSlot && ['breakfast', 'lunch', 'dinner'].includes(entry.mealSlot)) mainCount++;
      }
      return mainCount >= 3;
    }

    // Count streak backwards from yesterday
    let count = 0;
    let checkDate = shiftDate(today, -1);
    while (true) {
      if (!dailyLog[checkDate]) break;
      if (dayQualifies(checkDate)) { count++; checkDate = shiftDate(checkDate, -1); }
      else break;
    }

    // Add today if it also qualifies
    if (dayQualifies(today)) count++;

    return count;
  }, [dailyLog]);

  // Compute longest streak ever from all daily log data
  const longestStreak = useMemo(() => {
    const dates = Object.keys(dailyLog).sort();
    if (dates.length === 0) return 0;

    function isFullDay(dateStr) {
      const dayData = dailyLog[dateStr];
      if (!dayData) return false;
      if (dayData.daySkipped) return true;
      const entries = dayData.entries || [];
      let mainCount = (dayData.skippedMeals || []).length;
      for (const entry of entries) {
        if (entry.mealSlot && ['breakfast', 'lunch', 'dinner'].includes(entry.mealSlot)) mainCount++;
      }
      return mainCount >= 3;
    }

    let best = 0;
    let current = 0;
    let prevDate = null;
    for (const d of dates) {
      if (isFullDay(d)) {
        if (prevDate && shiftDate(prevDate, 1) === d) {
          current++;
        } else {
          current = 1;
        }
        if (current > best) best = current;
        prevDate = d;
      } else {
        current = 0;
        prevDate = d;
      }
    }
    return best;
  }, [dailyLog]);

  return (
    <div className={styles.weeklyView}>
      <div className={styles.weeklyTitleRow}>
        <h3 className={styles.weeklyTitle}>Food Log</h3>
        <div className={styles.streakRow}>
          <span className={styles.streakBadge}>
            <span className={styles.streakFire}>&#x1F525;</span> {streak} day streak
          </span>
          <span className={styles.streakBest}>
            Best: {longestStreak} days
          </span>
        </div>
      </div>
      <div className={styles.weeklyColsWrap}>
        <div className={styles.weeklyCols}>
          {days.map(day => (
            <div key={day.dateStr} className={`${styles.weeklyCol} ${day.dateStr === date ? styles.weeklyColActive : ''}`} onClick={() => onDayClick(day.dateStr)} style={{ cursor: 'pointer' }}>
              <div className={styles.weeklyColHeader}>
                {day.fullDay && <span className={styles.weeklyColStar}>&#x2B50;</span>}
                <span className={styles.weeklyColDay}>{day.label}</span>
                <span className={styles.weeklyColNum}>{day.dayNum}<sup className={styles.weeklyColOrd}>{ordinal(day.dayNum)}</sup></span>
              </div>
              <div className={styles.weeklyColBody}>
                {day.daySkipped ? (
                  <span className={styles.weeklyColSkipped}>Not Tracked</span>
                ) : (
                  MEAL_SLOTS.map(slot => {
                    const isDragTarget = dragOver?.dateStr === day.dateStr && dragOver?.slot === slot;
                    return (
                      <div
                        key={slot}
                        className={`${styles.weeklyColSlot} ${isDragTarget ? styles.weeklySlotDragOver : ''}`}
                        onDragOver={e => { e.preventDefault(); setDragOver({ dateStr: day.dateStr, slot }); }}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={e => {
                          e.preventDefault();
                          setDragOver(null);
                          try {
                            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                            onMoveEntry(data.sourceDate, data.entryId, day.dateStr, slot);
                          } catch {}
                        }}
                      >
                        <div className={styles.weeklySlotHeader}>
                          <span className={styles.weeklyColSlotLabel}>{MEAL_LABELS[slot]}</span>
                          <div className={styles.weeklySlotBtns}>
                            <button
                              className={styles.weeklySlotRemoveBtn}
                              onClick={e => {
                                e.stopPropagation();
                                const slotItems = day.bySlot[slot];
                                if (slotItems.length > 0) {
                                  const lastItem = slotItems[slotItems.length - 1];
                                  onRemoveLastEntry(day.dateStr, slot, lastItem.id, lastItem.entryIndex);
                                }
                              }}
                              title={`Remove from ${MEAL_LABELS[slot]}`}
                            >&minus;</button>
                            <button
                              className={styles.weeklySlotAddBtn}
                              onClick={e => { e.stopPropagation(); onAddToSlot(day.dateStr, slot); }}
                              title={`Add to ${MEAL_LABELS[slot]}`}
                            >+</button>
                          </div>
                        </div>
                        {day.skippedMeals.includes(slot) ? (
                          <span className={styles.weeklyColSkippedMeal}>Skipped</span>
                        ) : day.bySlot[slot].length > 0 ? day.bySlot[slot].map((item) => (
                          <div
                            key={item.id}
                            className={`${styles.weeklyColMealWrap}`}
                            draggable
                            onDragStart={e => {
                              e.dataTransfer.setData('text/plain', JSON.stringify({ sourceDate: item.sourceDate, entryId: item.id }));
                              e.stopPropagation();
                            }}
                            onClick={e => {
                              e.stopPropagation();
                              if (item.editable && onEditEntry) {
                                onEditEntry(item.id, item.sourceDate);
                              } else if (item.recipeId && onViewRecipe) {
                                onViewRecipe(item.recipeId);
                              } else if (item.entry) {
                                // For single ingredients — navigate to daily view for that date
                                onSelectDate && onSelectDate(item.sourceDate);
                              }
                            }}
                          >
                            <span className={`${styles.weeklyColMeal} ${styles.weeklyColMealClickable}`}>{item.name}</span>
                            {item.nutrition && item.nutrition.calories > 0 && (
                              <span className={styles.weeklyColMealNutrition}>
                                {Math.round(item.nutrition.calories)} cal &middot; {Math.round(item.nutrition.protein || 0)}p &middot; {Math.round(item.nutrition.carbs || 0)}c &middot; {Math.round(item.nutrition.fat || 0)}f
                              </span>
                            )}
                          </div>
                        )) : (day.isPast && slot !== 'snack') ? (
                          <span className={styles.weeklyColNotTracked}>Not Tracked</span>
                        ) : (
                          <span className={styles.weeklyColEmpty}></span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {goals && (
        <div className={styles.weeklyColsWrap} style={{ marginTop: '0.75rem' }}>
          <div className={styles.weeklyCols}>
            {days.map(day => (
              <div key={day.dateStr} className={`${styles.weeklyMacroCol} ${day.dateStr === date ? styles.weeklyMacroColActive : ''}`}>
                <div className={styles.weeklyMacroBody}>
                  {macroKeys.map(key => {
                    const n = NUTRIENTS.find(x => x.key === key);
                    const label = key === 'calories' ? 'Cal' : (n?.label || key);
                    const unit = key === 'calories' ? '' : 'g';
                    const val = Math.round(day.totals[key]);
                    const goal = goals[key] || 0;
                    const pct = goal > 0 ? Math.round(val / goal * 100) : 0;
                    let color;
                    if (day.daySkipped || !day.hasEntries) {
                      color = 'var(--color-text-muted)';
                    } else if (key === 'protein') {
                      // Protein: under is bad (red), at/over is good (green)
                      color = pct >= 100 ? 'var(--color-success, #16a34a)' : 'var(--color-danger, #dc2626)';
                    } else {
                      // Calories, carbs, fat: over is bad (red), at/under is good (green)
                      color = pct <= 100 ? 'var(--color-success, #16a34a)' : 'var(--color-danger, #dc2626)';
                    }
                    return day.daySkipped || !day.hasEntries ? (
                      <React.Fragment key={key}>
                        <span className={styles.weeklyMacroRowLabel}>{label}</span>
                        <span className={styles.weeklyMacroRowDash}>—</span>
                      </React.Fragment>
                    ) : (
                      <React.Fragment key={key}>
                        <span className={styles.weeklyMacroRowLabel}>{label}</span>
                        <span className={styles.weeklyMacroVal}>{val}{unit}</span>
                        <span className={styles.weeklyMacroPct} style={{ color }}>{pct}%</span>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── KPI Alerts (merged with recommendations) ── */
const WEEKLY_PLAN_KEY = 'sunday-weekly-plan';

/* ── Edit Estimated Meal Modal ── */
function EditEstimateModal({ entry, onSave, onClose, getRecipe }) {
  const [items, setItems] = useState(() => {
    if (entry.ingredientData && entry.ingredientData.length > 0) {
      return entry.ingredientData.map(i => ({ ...i }));
    }
    // For recipe entries, load ingredients from the recipe store
    if (entry.type === 'recipe' && entry.recipeId && getRecipe) {
      const recipe = getRecipe(entry.recipeId);
      if (recipe && recipe.ingredients?.length > 0) {
        return recipe.ingredients.map(i => ({
          quantity: i.quantity || '1',
          measurement: i.measurement || '',
          ingredient: i.ingredient || '',
          notes: i.notes || '',
          topping: i.topping || false,
          nutrition: {},
        }));
      }
    }
    // Parse from string ingredients
    return (entry.ingredients || []).map(str => {
      const parts = str.match(/^([\d./]+)?\s*(\w+)?\s+(.+)$/);
      return parts
        ? { quantity: parts[1] || '1', measurement: parts[2] || '', ingredient: parts[3] || str, nutrition: {} }
        : { quantity: '1', measurement: '', ingredient: str, nutrition: {} };
    });
  });
  const [loading, setLoading] = useState(false);
  const [calcBreakdown, setCalcBreakdown] = useState(null);
  const [calcNutrition, setCalcNutrition] = useState(null);
  const [calculating, setCalculating] = useState(false);

  // Nutrition display keys
  const displayKeys = ['calories', 'protein', 'carbs', 'fat'];
  const existingNutrition = calcNutrition || entry.nutrition || {};
  const existingBreakdown = calcBreakdown || entry.ingredientNutrition || entry.ingredientData?.filter(d => d.nutrition && Object.keys(d.nutrition).length > 0) || [];
  const hasBreakdown = existingBreakdown.length > 0;
  const canCalculate = !hasBreakdown && items.length > 0;

  async function calculateBreakdown() {
    setCalculating(true);
    try {
      const result = await fetchNutritionForRecipe(items.filter(i => i.ingredient.trim()));
      const totalNutrition = {};
      for (const n of NUTRIENTS) totalNutrition[n.key] = result.totals[n.key] || 0;
      const breakdown = items.filter(i => i.ingredient.trim()).map((item, idx) => ({
        name: `${item.quantity} ${item.measurement} ${item.ingredient}`,
        ingredient: item.ingredient,
        quantity: item.quantity,
        measurement: item.measurement,
        nutrition: result.items[idx]?.nutrients || {},
        source: 'lookup',
      }));
      setCalcBreakdown(breakdown);
      setCalcNutrition(totalNutrition);
    } catch {} finally {
      setCalculating(false);
    }
  }

  function updateItem(index, field, value) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  function removeItem(index) {
    setItems(prev => prev.filter((_, i) => i !== index));
  }

  function addItem() {
    setItems(prev => [...prev, { quantity: '1', measurement: 'g', ingredient: '', nutrition: {} }]);
  }

  async function handleSave() {
    setLoading(true);
    try {
      // Re-fetch nutrition for updated ingredients
      const result = await fetchNutritionForRecipe(items.filter(i => i.ingredient.trim()));
      const totalNutrition = {};
      for (const n of NUTRIENTS) totalNutrition[n.key] = result.totals[n.key] || 0;
      const updatedIngredientData = items.filter(i => i.ingredient.trim()).map((item, idx) => ({
        ...item,
        nutrition: result.items[idx]?.nutrients || {},
      }));
      const ingredientNutrition = updatedIngredientData.map(item => ({
        name: `${item.quantity} ${item.measurement} ${item.ingredient}`,
        ingredient: item.ingredient,
        quantity: item.quantity,
        measurement: item.measurement,
        nutrition: item.nutrition,
        source: 'lookup',
      }));
      onSave({
        ingredients: updatedIngredientData.map(i => `${i.quantity} ${i.measurement} ${i.ingredient}`),
        ingredientData: updatedIngredientData,
        ingredientNutrition,
        nutrition: totalNutrition,
      });
    } catch {
      // Fallback: save without re-fetching
      onSave({
        ingredients: items.filter(i => i.ingredient.trim()).map(i => `${i.quantity} ${i.measurement} ${i.ingredient}`),
        ingredientData: items.filter(i => i.ingredient.trim()),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Edit: {entry.recipeName}</h3>
          <button className={styles.modalClose} onClick={onClose}>&times;</button>
        </div>

        {/* Nutrition totals summary */}
        {existingNutrition.calories > 0 && (
          <div className={styles.editNutritionSummary}>
            <span className={styles.editNutritionTitle}>Nutrition Totals</span>
            <div className={styles.editNutritionChips}>
              {displayKeys.map(key => {
                const n = NUTRIENTS.find(x => x.key === key);
                const val = existingNutrition[key] || 0;
                return (
                  <span key={key} className={styles.editNutritionChip}>
                    <span className={styles.editNutritionChipVal}>{fmtNutrient(val, key)}</span>
                    <span className={styles.editNutritionChipLabel}>{SHORT_LABELS[key] || key}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Calculate breakdown button for old entries */}
        {canCalculate && (
          <button className={styles.addEstimateRowBtn} onClick={calculateBreakdown} disabled={calculating} style={{ marginBottom: '0.5rem' }}>
            {calculating ? 'Calculating...' : 'Show Nutrition Breakdown'}
          </button>
        )}

        {/* Per-ingredient nutrition breakdown — grouped by batch vs per-meal */}
        {existingBreakdown.length > 0 && (() => {
          // Enrich with topping flags from the recipe if missing
          let enriched = existingBreakdown;
          if (entry.recipeId && getRecipe && !enriched.some(ing => ing.topping)) {
            const recipe = getRecipe(entry.recipeId);
            if (recipe?.ingredients) {
              enriched = enriched.map((ing, idx) => ({
                ...ing,
                topping: recipe.ingredients[idx]?.topping || false,
              }));
            }
          }
          const perMeal = enriched.filter(ing => ing.topping);
          const batch = enriched.filter(ing => !ing.topping);
          const hasGroups = perMeal.length > 0;

          function renderIngRow(ing, i, keyPrefix) {
            const ingName = ing.name || `${ing.quantity || ''} ${ing.measurement || ''} ${ing.ingredient || ''}`.trim();
            const ingN = ing.nutrition || {};
            return (
              <div key={`${keyPrefix}-${i}`} className={styles.editIngBreakdownRow}>
                <span className={styles.editIngBreakdownName}>{ingName}</span>
                <div className={styles.editIngBreakdownMacros}>
                  {displayKeys.map(key => (
                    <span key={key} className={styles.editIngBreakdownMacro}>
                      {fmtNutrient(ingN[key], key)}
                    </span>
                  ))}
                </div>
              </div>
            );
          }

          return (
            <div className={styles.editIngBreakdown}>
              <span className={styles.editIngBreakdownTitle}>Per Ingredient</span>
              <div className={styles.editIngBreakdownHeader}>
                <span style={{ flex: 1 }}></span>
                <div className={styles.editIngBreakdownMacros}>
                  {displayKeys.map(key => (
                    <span key={key} className={styles.editIngBreakdownHeaderLabel}>{SHORT_LABELS[key]}</span>
                  ))}
                </div>
              </div>
              {hasGroups && <div className={styles.ingBreakdownSection}>Batch (÷ servings)</div>}
              {batch.map((ing, i) => renderIngRow(ing, i, 'b'))}
              {hasGroups && (
                <>
                  <div className={styles.ingBreakdownSection}>Per Meal</div>
                  {perMeal.map((ing, i) => renderIngRow(ing, i, 'pm'))}
                </>
              )}
              <div className={styles.editIngBreakdownRow} style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.3rem', marginTop: '0.2rem' }}>
                <span className={styles.editIngBreakdownName} style={{ fontWeight: 600 }}>Total</span>
                <div className={styles.editIngBreakdownMacros}>
                  {displayKeys.map(key => (
                    <span key={key} className={styles.editIngBreakdownMacro} style={{ fontWeight: 700 }}>
                      {fmtNutrient(existingNutrition[key], key)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        <table className={styles.editEstimateTable}>
          <thead>
            <tr>
              <th>Qty</th>
              <th>Unit</th>
              <th>Ingredient</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td><input className={styles.editEstimateInput} type="text" value={item.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} style={{ width: '50px' }} /></td>
                <td><input className={styles.editEstimateInput} type="text" value={item.measurement} onChange={e => updateItem(i, 'measurement', e.target.value)} style={{ width: '60px' }} /></td>
                <td><input className={styles.editEstimateInput} type="text" value={item.ingredient} onChange={e => updateItem(i, 'ingredient', e.target.value)} style={{ width: '100%' }} /></td>
                <td><button className={styles.deleteBtn} onClick={() => removeItem(i)}>&times;</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className={styles.addEstimateRowBtn} onClick={addItem}>+ Add Ingredient</button>
        <div className={styles.editEstimateActions}>
          <button className={styles.addBtn} onClick={handleSave} disabled={loading}>{loading ? 'Recalculating...' : 'Save & Recalculate'}</button>
        </div>
      </div>
    </div>
  );
}

const ADMIN_UID = import.meta.env.VITE_ADMIN_UID;

function KpiAlerts({ dailyLog, recipes, onImportRecipe, cacheVersion, onViewRecipe, selectedDate, user }) {
  const goals = useMemo(loadGoals, []);
  const [, forceUpdate] = useState(0);
  const [confirmAdd, setConfirmAdd] = useState(null); // recipeId or null

  function addToWeeklyPlan(recipeId) {
    try {
      const plan = JSON.parse(localStorage.getItem(WEEKLY_PLAN_KEY) || '[]');
      if (!plan.includes(recipeId)) {
        plan.push(recipeId);
        localStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(plan));
        forceUpdate(v => v + 1);
      }
    } catch {}
  }

  const endDate = selectedDate || todayStr();
  const startDate = shiftDate(endDate, -6);

  function formatShort(dateStr) {
    const [, m, d] = dateStr.split('-');
    return `${parseInt(m)}/${parseInt(d)}`;
  }
  const dateRangeLabel = `${formatShort(startDate)} – ${formatShort(endDate)}`;

  const data = useMemo(() => {
    if (!goals) return [];
    const cache = loadNutritionCache();
    const results = [];

    // Compute 7-day averages for each nutrient with a goal
    const nutrientTotals = {};
    const nutrientDays = {};
    for (const n of NUTRIENTS) {
      if (!goals[n.key] || goals[n.key] <= 0) continue;
      nutrientTotals[n.key] = 0;
      nutrientDays[n.key] = 0;
    }

    for (let i = 0; i < 7; i++) {
      const dateStr = shiftDate(endDate, -i);
      const dayData = dailyLog[dateStr] || {};
      if (dayData.daySkipped) continue;
      const entries = dayData.entries || [];
      if (entries.length === 0) continue;

      const skippedMeals = dayData.skippedMeals || [];
      const activeEntries = skippedMeals.length > 0
        ? entries.filter(e => {
            const slot = e.mealSlot && MEAL_SLOTS.includes(e.mealSlot) ? e.mealSlot : 'snack';
            return !skippedMeals.includes(slot);
          })
        : entries;

      const skippedMainMeals = skippedMeals.filter(s => ['breakfast', 'lunch', 'dinner'].includes(s)).length;
      const activeFraction = Math.max(0, 1 - (skippedMainMeals / 3));

      for (const key of Object.keys(nutrientTotals)) {
        let total = 0;
        for (const entry of activeEntries) {
          total += entry.nutrition?.[key] || 0;
        }
        const adjustedGoal = goals[key] * activeFraction;
        if (adjustedGoal > 0) {
          nutrientTotals[key] += total / adjustedGoal;
          nutrientDays[key]++;
        }
      }
    }

    // Helper: find top recipes for a specific gap
    function findBestRecipes(key, needMore, count = 3) {
      if (!recipes || recipes.length === 0) return [];
      const scored = [];
      for (const recipe of recipes) {
        if ((recipe.frequency || 'common') === 'retired') continue;
        const cached = cache[recipe.id];
        if (!getCachedTotals(cached)) continue;
        const recipeServings = recipe.servings || 1;
        const perServing = (getCachedTotals(cached)[key] || 0) / recipeServings;
        const goal = goals[key] || 1;
        const pctOfGoal = Math.round((perServing / goal) * 100);
        const unit = key === 'calories' ? '' : 'g';
        if (needMore && pctOfGoal >= 15) {
          scored.push({ id: recipe.id, title: recipe.title, reason: `${Math.round(perServing)}${unit} per serving (${pctOfGoal}% of daily goal)`, score: pctOfGoal });
        } else if (!needMore && pctOfGoal <= 25) {
          scored.push({ id: recipe.id, title: recipe.title, reason: `Only ${Math.round(perServing)}${unit} per serving — a lighter option`, score: 30 - pctOfGoal });
        }
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, count);
    }

    function findBestServingRecipes(servingKey, count = 3) {
      if (!recipes || recipes.length === 0) return [];
      const scored = [];
      for (const recipe of recipes) {
        if ((recipe.frequency || 'common') === 'retired') continue;
        const cached = cache[recipe.id];
        if (!getCachedTotals(cached)) continue;
        const recipeServings = recipe.servings || 1;
        const perServing = (getCachedTotals(cached)[servingKey] || 0) / recipeServings;
        if (perServing > 0) {
          scored.push({ id: recipe.id, title: recipe.title, reason: `${Math.round(perServing * 10) / 10} servings per portion`, score: perServing });
        }
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, count);
    }

    // Check all nutrients with goals (exclude fruit/veg — handled separately below)
    const OVER_IS_BAD = new Set(['calories', 'carbs', 'fat', 'saturatedFat', 'sugar', 'addedSugar', 'sodium']);
    const SKIP_KEYS = new Set(['vegServings', 'fruitServings', 'fermentedFoods']);
    for (const key of Object.keys(nutrientTotals)) {
      if (nutrientDays[key] === 0) continue;
      if (SKIP_KEYS.has(key)) continue;
      const avgPct = Math.round((nutrientTotals[key] / nutrientDays[key]) * 100);
      const n = NUTRIENTS.find(x => x.key === key);
      const label = n?.label || key;

      if (OVER_IS_BAD.has(key)) {
        // These nutrients: being over 100% is bad
        if (avgPct > 100) {
          const recs = findBestRecipes(key, false);
          results.push({ label, pct: avgPct, headline: label, message: `${avgPct}% of ${label.toLowerCase()} goal this past week`, recs });
        }
      } else {
        // All other nutrients (protein, fiber, vitamins, minerals): being under 100% is bad
        if (avgPct < 100) {
          const recs = findBestRecipes(key, true);
          results.push({ label, pct: avgPct, headline: label, message: `Only ${avgPct}% of ${label.toLowerCase()} goal this past week`, recs });
        }
      }
    }

    // Check fruit & veg servings
    let vegTotal = 0, fruitTotal = 0, servingDays = 0;
    const vegTarget = goals.vegServings || 0;
    const fruitTarget = goals.fruitServings || 0;
    for (let i = 0; i < 7; i++) {
      const dateStr = shiftDate(endDate, -i);
      const dayData = dailyLog[dateStr] || {};
      if (dayData.daySkipped) continue;
      const entries = dayData.entries || [];
      if (entries.length === 0) continue;
      servingDays++;
      for (const entry of entries) {
        vegTotal += entry.nutrition?.vegServings || 0;
        fruitTotal += entry.nutrition?.fruitServings || 0;
      }
    }
    if (servingDays > 0) {
      const avgVeg = Math.round((vegTotal / servingDays) * 10) / 10;
      const avgFruit = Math.round((fruitTotal / servingDays) * 10) / 10;
      if (vegTarget > 0 && avgVeg < vegTarget) {
        const recs = findBestServingRecipes('vegServings');
        results.push({ label: 'Vegetables', pct: Math.round((avgVeg / vegTarget) * 100), headline: 'Vegetables', message: `Averaging ${avgVeg} veg servings/day (goal: ${vegTarget})`, recs });
      }
      if (fruitTarget > 0 && avgFruit < fruitTarget) {
        const recs = findBestServingRecipes('fruitServings');
        results.push({ label: 'Fruit', pct: Math.round((avgFruit / fruitTarget) * 100), headline: 'Fruit', message: `Averaging ${avgFruit} fruit servings/day (goal: ${fruitTarget})`, recs });
      }
    }

    results.sort((a, b) => a.pct - b.pct);
    return results;
  }, [dailyLog, goals, recipes, cacheVersion, endDate]);

  // Admin-only: tracking quality stats for past week
  const trackingStats = useMemo(() => {
    if (!user || user.uid !== ADMIN_UID) return null;
    let totalSlots = 0;
    let estimatedCount = 0;
    let untrackedCount = 0;
    for (let i = 0; i < 7; i++) {
      const dateStr = shiftDate(endDate, -i);
      const dayData = dailyLog[dateStr] || {};
      if (dayData.daySkipped) continue;
      const skippedMeals = dayData.skippedMeals || [];
      const activeSlots = ['breakfast', 'lunch', 'dinner'].filter(s => !skippedMeals.includes(s));
      totalSlots += activeSlots.length;
      const entries = dayData.entries || [];
      for (const slot of activeSlots) {
        const slotEntries = entries.filter(e => (e.mealSlot || 'snack') === slot);
        if (slotEntries.length === 0) {
          untrackedCount++;
        } else if (slotEntries.some(e => e.type === 'custom_meal' || e.type === 'custom')) {
          estimatedCount++;
        }
      }
    }
    if (totalSlots === 0) return null;
    return {
      estimatedPct: Math.round((estimatedCount / totalSlots) * 100),
      untrackedPct: Math.round((untrackedCount / totalSlots) * 100),
    };
  }, [dailyLog, user, endDate]);

  if (data.length === 0 && !trackingStats) return null;

  return (
    <div className={styles.kpiAlerts}>
      <h3 className={styles.kpiTitle}>Areas to Improve</h3>
      <p className={styles.kpiSubtitle}>Based on the food log from {dateRangeLabel}. Meals not tracked will not bring down your score — the tool assumes those meals hit 33% of your daily needs.</p>
      {trackingStats && (
        <div className={styles.trackingQuality}>
          <span className={styles.trackingStat}>
            <strong>{trackingStats.estimatedPct}%</strong> estimated meals
          </span>
          <span className={styles.trackingStatDivider}>&middot;</span>
          <span className={styles.trackingStat}>
            <strong>{trackingStats.untrackedPct}%</strong> not tracked
          </span>
        </div>
      )}
      <div className={styles.kpiList}>
        {data.map(a => (
          <div key={a.label} className={styles.kpiItem}>
            <div className={styles.kpiHeadline}>{a.headline}</div>
            <div className={styles.kpiCard}>
              <span className={styles.kpiPct}>{a.pct}%</span>
              <span className={styles.kpiMessage}>{a.message}</span>
            </div>
            {a.recs && a.recs.length > 0 ? (
              <div className={styles.kpiRecList}>
                <div className={styles.kpiRecHeader}>Consider These Meals to Close the Gap</div>
                {a.recs.map(rec => (
                  <div key={rec.id} className={styles.kpiRec}>
                    <div className={styles.kpiRecTop}>
                      <span className={styles.kpiRecNameLink} onClick={() => onViewRecipe && onViewRecipe(rec.id)}>{rec.title}</span>
                    </div>
                    <span className={styles.kpiRecReason}>{rec.reason}</span>
                    <div className={styles.kpiRecActions}>
                      {(() => {
                        try {
                          const plan = JSON.parse(localStorage.getItem(WEEKLY_PLAN_KEY) || '[]');
                          if (plan.includes(rec.id)) return <span className={styles.kpiRecInList}>In Shopping List</span>;
                        } catch {}
                        return confirmAdd === rec.id ? (
                          <div className={styles.kpiRecConfirm}>
                            <span className={styles.kpiRecConfirmText}>Add to shopping list?</span>
                            <button className={styles.kpiRecCheckBtn} onClick={() => { addToWeeklyPlan(rec.id); setConfirmAdd(null); }}>&#x2713;</button>
                            <button className={styles.kpiRecXBtn} onClick={() => setConfirmAdd(null)}>&times;</button>
                          </div>
                        ) : (
                          <button className={styles.kpiRecPlusBtn} onClick={() => setConfirmAdd(rec.id)}>+</button>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.kpiRecList}>
                <div className={styles.kpiRec}>
                  <span className={styles.kpiRecEmpty}>No recipes in your collection help here.</span>
                  <button className={styles.kpiRecAddBtn} onClick={onImportRecipe}>+ Add Recipes</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DailyTrackerPage({ recipes, getRecipe, onClose, user, weeklyPlan, onViewRecipe, onImportRecipe }) {
  const [date, setDate] = useState(todayStr);
  const [addModal, setAddModal] = useState(null); // { targetDate, targetSlot, mode } or null
  const [quickPickRecipeId, setQuickPickRecipeId] = useState('');
  const [viewRecipeId, setViewRecipeId] = useState(null);
  const [dailyLog, setDailyLog] = useState(loadDailyLog);
  const [cacheVersion, setCacheVersion] = useState(0);

  // On mount: load daily log from Firestore subcollection and merge with local
  useEffect(() => {
    if (!user) return;
    loadDailyLogFromFirestore(user.uid).then(remote => {
      if (!remote || Object.keys(remote).length === 0) return;
      setDailyLog(prev => {
        const merged = { ...remote };
        // Keep any local entries that are newer/more complete than remote
        for (const date of Object.keys(prev)) {
          const localEntries = prev[date]?.entries || [];
          const remoteEntries = merged[date]?.entries || [];
          if (localEntries.length > remoteEntries.length) {
            merged[date] = prev[date];
          }
        }
        try { localStorage.setItem(DAILY_LOG_KEY, JSON.stringify(merged)); } catch {}
        return merged;
      });
    }).catch(() => {});
  }, [user]);

  // Re-load daily log when Firestore syncs data from another device
  // (firestore-sync event is for main user doc — dailyLog is no longer there, so skip overwriting)
  useEffect(() => {
    function handleSync() {
      // Don't overwrite from main doc sync — dailyLog is in subcollection now
    }
    window.addEventListener('firestore-sync', handleSync);
    return () => window.removeEventListener('firestore-sync', handleSync);
  }, []);

  // Pre-compute nutrition for uncached recipes in the background
  useEffect(() => {
    if (!recipes || recipes.length === 0) return;
    const cache = loadNutritionCache();
    const uncached = recipes.filter(r => {
      if ((r.frequency || 'common') === 'retired') return false;
      if (cache[r.id]) return false;
      return (r.ingredients || []).length > 0;
    });
    if (uncached.length === 0) return;
    let cancelled = false;
    async function computeAll() {
      const currentCache = loadNutritionCache();
      let updated = false;
      for (const recipe of uncached.slice(0, 10)) {
        if (cancelled) return;
        if (currentCache[recipe.id]) continue;
        try {
          const result = await fetchNutritionForRecipe(recipe.ingredients || []);
          currentCache[recipe.id] = result;
          updated = true;
        } catch {}
      }
      if (updated && !cancelled) {
        try { localStorage.setItem(NUTRITION_CACHE_KEY, JSON.stringify(currentCache)); } catch {}
        setCacheVersion(v => v + 1);
      }
    }
    computeAll();
    return () => { cancelled = true; };
  }, [recipes]);
  // Derive ordered nutrient keys from user's goals (preserves NUTRIENTS ordering)
  const goalKeys = useMemo(() => {
    const goals = loadGoals();
    if (!goals) return DEFAULT_ENTRY_KEYS;
    const keys = NUTRIENTS.filter(n => goals[n.key] > 0).map(n => n.key);
    return keys.length > 0 ? keys : DEFAULT_ENTRY_KEYS;
  }, []);

  const entries = dailyLog[date]?.entries || [];
  const daySkipped = !!dailyLog[date]?.daySkipped;
  const skippedMeals = dailyLog[date]?.skippedMeals || [];

  function toggleSkipDay() {
    setDailyLog(prev => {
      const next = { ...prev };
      if (!next[date]) next[date] = { entries: [] };
      next[date] = { ...next[date], daySkipped: !next[date].daySkipped };
      saveDailyLog(next, user);
      return next;
    });
  }

  function toggleSkipMeal(slot, targetDate) {
    const d = targetDate || date;
    setDailyLog(prev => {
      const next = { ...prev };
      if (!next[d]) next[d] = { entries: [] };
      const current = next[d].skippedMeals || [];
      const updated = current.includes(slot)
        ? current.filter(s => s !== slot)
        : [...current, slot];
      next[d] = { ...next[d], skippedMeals: updated };
      saveDailyLog(next, user);
      return next;
    });
  }

  function addEntry(entry, targetDate, targetSlot) {
    const d = targetDate || date;
    // Single ingredients always go to snack slot; otherwise use targetSlot, then entry's mealSlot
    const slot = entry.type === 'custom' ? 'snack' : (targetSlot || entry.mealSlot || 'snack');
    const finalEntry = { ...entry, mealSlot: slot };
    setDailyLog(prev => {
      const next = { ...prev };
      if (!next[d]) next[d] = { entries: [] };
      next[d] = { ...next[d], entries: [...next[d].entries, finalEntry] };
      saveDailyLog(next, user);
      return next;
    });
  }

  const [editModal, setEditModal] = useState(null); // { entryId, dateStr } or null

  function updateEntry(entryId, dateStr, updatedEntry) {
    setDailyLog(prev => {
      const next = { ...prev };
      if (!next[dateStr]) return prev;
      next[dateStr] = {
        ...next[dateStr],
        entries: next[dateStr].entries.map(e => e.id === entryId ? { ...e, ...updatedEntry } : e),
      };
      saveDailyLog(next, user);
      return next;
    });
  }

  function deleteEntry(entryId) {
    setDailyLog(prev => {
      const next = { ...prev };
      if (!next[date]) return prev;
      next[date] = { ...next[date], entries: next[date].entries.filter(e => e.id !== entryId) };
      if (next[date].entries.length === 0) delete next[date];
      saveDailyLog(next, user);
      return next;
    });
  }

  function moveEntry(sourceDate, entryId, targetDate, targetSlot) {
    if (sourceDate === targetDate) {
      // Just change the slot
      setDailyLog(prev => {
        const next = { ...prev };
        if (!next[sourceDate]) return prev;
        next[sourceDate] = {
          ...next[sourceDate],
          entries: next[sourceDate].entries.map(e =>
            e.id === entryId ? { ...e, mealSlot: targetSlot } : e
          ),
        };
        saveDailyLog(next, user);
        return next;
      });
    } else {
      // Move between days
      setDailyLog(prev => {
        const next = { ...prev };
        if (!next[sourceDate]) return prev;
        const entry = next[sourceDate].entries.find(e => e.id === entryId);
        if (!entry) return prev;
        const movedEntry = { ...entry, mealSlot: targetSlot };
        next[sourceDate] = { ...next[sourceDate], entries: next[sourceDate].entries.filter(e => e.id !== entryId) };
        if (next[sourceDate].entries.length === 0 && !next[sourceDate].daySkipped) delete next[sourceDate];
        if (!next[targetDate]) next[targetDate] = { entries: [] };
        next[targetDate] = { ...next[targetDate], entries: [...next[targetDate].entries, movedEntry] };
        saveDailyLog(next, user);
        return next;
      });
    }
  }

  function removeLastEntry(targetDate, targetSlot, entryId, entryIndex) {
    setDailyLog(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      if (!next[targetDate]) return prev;
      const entries = next[targetDate].entries || [];
      // Remove by index (most reliable)
      if (typeof entryIndex === 'number' && entryIndex >= 0 && entryIndex < entries.length) {
        next[targetDate].entries = entries.filter((_, i) => i !== entryIndex);
      } else if (entryId) {
        // Fallback: remove by ID
        const filtered = entries.filter(e => e.id !== entryId);
        if (filtered.length === entries.length) return prev; // ID not found
        next[targetDate].entries = filtered;
      } else {
        return prev;
      }
      if (next[targetDate].entries.length === 0 && !next[targetDate].daySkipped) delete next[targetDate];
      saveDailyLog(next, user);
      return next;
    });
  }

  function handleAddToSlot(targetDate, targetSlot) {
    setQuickPickRecipeId('');
    setAddModal({ targetDate, targetSlot });
  }

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={onClose}>&larr; Back</button>
      </div>
      <div className={styles.weeklyWithCal}>
        <div className={styles.weeklyWithCalLeft}>
          <WeeklyView dailyLog={dailyLog} date={date} recipes={recipes} onDayClick={(d) => setDate(d)} onMoveEntry={moveEntry} onAddToSlot={handleAddToSlot} onViewRecipe={(id) => setViewRecipeId(id)} onRemoveLastEntry={removeLastEntry} onEditEntry={(entryId, dateStr) => setEditModal({ entryId, dateStr })} onSelectDate={(d) => setDate(d)} />
        </div>
        <div className={styles.weeklyWithCalRight}>
          <MiniCalendar date={date} setDate={setDate} dailyLog={dailyLog} />
          <button className={styles.todayBtn} onClick={() => setDate(todayStr())} disabled={date === todayStr()}>Today</button>
        </div>
      </div>
      <div className={styles.belowFoodLog}>
        <div className={styles.twoColRow}>
          <HistoryChart dailyLog={dailyLog} />
          <ServingsChart dailyLog={dailyLog} />
        </div>
        <KpiAlerts dailyLog={dailyLog} recipes={recipes} onImportRecipe={onImportRecipe} cacheVersion={cacheVersion} onViewRecipe={(id) => setViewRecipeId(id)} selectedDate={date} user={user} />
      </div>
      {editModal && (() => {
        const dayData = dailyLog[editModal.dateStr];
        const entry = dayData?.entries?.find(e => e.id === editModal.entryId);
        if (!entry) return null;
        return (
          <EditEstimateModal
            entry={entry}
            getRecipe={getRecipe}
            onSave={(updates) => {
              updateEntry(editModal.entryId, editModal.dateStr, updates);
              setEditModal(null);
            }}
            onClose={() => setEditModal(null)}
          />
        );
      })()}
      {addModal && (
        <div className={styles.modalOverlay} onClick={() => setAddModal(null)}>
          <div className={`${styles.modalContent}${addModal.mode === 'ai-estimate' ? ` ${styles.modalContentWide}` : ''}`} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                Track {MEAL_LABELS[addModal.targetSlot]} — {formatDate(addModal.targetDate)}
              </h3>
              <div className={styles.modalHeaderRight}>
                {!addModal.mode && addModal.targetSlot !== 'snack' && (() => {
                  const isSkipped = (dailyLog[addModal.targetDate]?.skippedMeals || []).includes(addModal.targetSlot);
                  return (
                    <button className={styles.skipMealHeaderBtn} onClick={() => { toggleSkipMeal(addModal.targetSlot, addModal.targetDate); setAddModal(null); }}>
                      {isSkipped ? 'Resume Tracking' : `I Didn't Eat ${MEAL_LABELS[addModal.targetSlot]}`}
                    </button>
                  );
                })()}
                <button className={styles.modalClose} onClick={() => setAddModal(null)}>&times;</button>
              </div>
            </div>
            {!addModal.mode && addModal.targetSlot === 'snack' ? (
              <>
                <SnackTrackerInline
                  onAdd={(entry) => { addEntry(entry, addModal.targetDate, addModal.targetSlot); }}
                  onClose={() => setAddModal(null)}
                />
                <div className={styles.trackMenuDivider}><span>or</span></div>
                <button className={styles.trackMenuBtn} onClick={() => setAddModal(prev => ({ ...prev, mode: 'ai-estimate' }))}>
                  <div className={styles.trackMenuBtnInfo}>
                    <span className={styles.trackMenuBtnLabel}>AI Estimate</span>
                    <span className={styles.trackMenuBtnDesc}>Describe a snack or drink and get a nutrition estimate</span>
                  </div>
                  <span className={styles.trackMenuBtnArrow}>&rsaquo;</span>
                </button>
              </>
            ) : !addModal.mode ? (
              <div className={styles.trackMenuOptions}>
                {(() => {
                  // Find recently tracked recipes for this slot type
                  const slot = addModal.targetSlot;
                  const seen = new Set();
                  const recent = [];
                  const dates = Object.keys(dailyLog).sort().reverse();
                  for (const d of dates) {
                    if (recent.length >= 5) break;
                    const entries = dailyLog[d]?.entries || [];
                    for (const entry of entries) {
                      if (recent.length >= 5) break;
                      if (entry.type !== 'recipe' || !entry.recipeId) continue;
                      if (seen.has(entry.recipeId)) continue;
                      // Skip entries whose recipe no longer exists — clicking them would
                      // silently fail since getRecipe() returns null.
                      if (!recipes.some(r => r.id === entry.recipeId)) continue;
                      const entrySlot = entry.mealSlot || 'snack';
                      if (slot === 'snack' && entrySlot !== 'snack') continue;
                      if (slot === 'breakfast' && entrySlot !== 'breakfast') continue;
                      if ((slot === 'lunch' || slot === 'dinner') && entrySlot !== 'lunch' && entrySlot !== 'dinner') continue;
                      seen.add(entry.recipeId);
                      recent.push(entry);
                    }
                  }

                  // Get this week's menu filtered by slot category
                  const slotCategory = slot === 'breakfast' ? 'breakfast' : 'lunch-dinner';
                  const weeklyFiltered = (weeklyPlan || [])
                    .map(id => recipes.find(r => r.id === id))
                    .filter(r => r && (r.category || 'lunch-dinner') === slotCategory);

                  return (
                    <div className={styles.quickPickRow}>
                      {recent.length > 0 && (
                        <div className={styles.quickPickBucket}>
                          <span className={styles.quickPickLabel}>Recently Tracked</span>
                          <div className={styles.quickPickList}>
                            {recent.map(entry => (
                              <button
                                key={entry.recipeId}
                                className={quickPickRecipeId === entry.recipeId ? styles.recentMealBtnActive : styles.recentMealBtn}
                                onClick={() => setQuickPickRecipeId(entry.recipeId)}
                              >
                                {entry.recipeName}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {weeklyFiltered.length > 0 && (
                        <div className={styles.quickPickBucket}>
                          <span className={styles.quickPickLabel}>This Week's Menu</span>
                          <div className={styles.quickPickList}>
                            {weeklyFiltered.map(r => (
                              <button
                                key={r.id}
                                className={quickPickRecipeId === r.id ? styles.recentMealBtnActive : styles.recentMealBtn}
                                onClick={() => setQuickPickRecipeId(r.id)}
                              >
                                {r.title}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <AddRecipeQuick
                  recipes={recipes}
                  getRecipe={getRecipe}
                  onAdd={(entry) => { addEntry(entry, addModal.targetDate, addModal.targetSlot); setAddModal(null); }}
                  weeklyPlan={weeklyPlan}
                  inline
                  targetSlot={addModal.targetSlot}
                  externalRecipeId={quickPickRecipeId}
                />
                <div className={styles.trackMenuDivider}><span>or</span></div>
                <button className={styles.trackMenuBtn} onClick={() => { setAddModal(null); if (onImportRecipe) onImportRecipe(); }}>
                  <div className={styles.trackMenuBtnInfo}>
                    <span className={styles.trackMenuBtnLabel}>Import New Recipe</span>
                    <span className={styles.trackMenuBtnDesc}>Import from URL, TikTok, or other sources</span>
                  </div>
                  <span className={styles.trackMenuBtnArrow}>&rsaquo;</span>
                </button>
                <button className={styles.trackMenuBtn} onClick={() => setAddModal(prev => ({ ...prev, mode: 'ai-estimate' }))}>
                  <div className={styles.trackMenuBtnInfo}>
                    <span className={styles.trackMenuBtnLabel}>AI Estimate</span>
                    <span className={styles.trackMenuBtnDesc}>Describe a meal you ate out and get a nutrition estimate</span>
                  </div>
                  <span className={styles.trackMenuBtnArrow}>&rsaquo;</span>
                </button>
                <button className={styles.trackMenuBtn} onClick={() => setAddModal(prev => ({ ...prev, mode: 'custom' }))}>
                  <div className={styles.trackMenuBtnInfo}>
                    <span className={styles.trackMenuBtnLabel}>Add Custom Meal</span>
                    <span className={styles.trackMenuBtnDesc}>Build a meal from individual ingredients</span>
                  </div>
                  <span className={styles.trackMenuBtnArrow}>&rsaquo;</span>
                </button>
              </div>
            ) : addModal.mode === 'adjust' ? (
              <AddRecipeAdjust
                recipes={recipes}
                getRecipe={getRecipe}
                onAdd={(entry) => { addEntry(entry, addModal.targetDate, addModal.targetSlot); setAddModal(null); }}
                onBack={() => setAddModal(prev => ({ ...prev, mode: null }))}
                weeklyPlan={weeklyPlan}
              />
            ) : addModal.mode === 'custom' ? (
              <CustomMealInline
                onAdd={(entry) => { addEntry(entry, addModal.targetDate, addModal.targetSlot); setAddModal(null); }}
                onBack={() => setAddModal(prev => ({ ...prev, mode: null }))}
              />
            ) : addModal.mode === 'ingredient' ? (
              <TrackIngredientInline
                onAdd={(entry) => { addEntry(entry, addModal.targetDate, addModal.targetSlot); setAddModal(null); }}
                onBack={() => setAddModal(prev => ({ ...prev, mode: null }))}
              />
            ) : addModal.mode === 'ai-estimate' ? (
              <AiEstimateInline
                onAdd={(entry) => { addEntry(entry, addModal.targetDate, addModal.targetSlot); setAddModal(null); }}
                onBack={() => setAddModal(prev => ({ ...prev, mode: null }))}
              />
            ) : null}
          </div>
        </div>
      )}
      {viewRecipeId && (() => {
        const recipe = getRecipe(viewRecipeId);
        if (!recipe) return null;
        return (
          <div className={styles.modalOverlay} onClick={() => setViewRecipeId(null)}>
            <div className={styles.recipeModalContent} onClick={e => e.stopPropagation()}>
              <button className={styles.modalClose} onClick={() => setViewRecipeId(null)}>&times;</button>
              <RecipeDetail
                recipe={recipe}
                onBack={() => setViewRecipeId(null)}
                onSave={() => {}}
                onDelete={() => {}}
                user={user}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
