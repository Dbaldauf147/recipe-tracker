import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NUTRIENTS, fetchNutritionForIngredient, fetchNutritionForRecipe } from '../utils/nutrition';
import { loadIngredients } from '../utils/ingredientsStore';
import { saveField } from '../utils/firestoreSync';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend, CartesianGrid, Area, ComposedChart } from 'recharts';
import { RecipeDetail } from './RecipeDetail';
import styles from './DailyTrackerPage.module.css';

const DAILY_LOG_KEY = 'sunday-daily-log';
const GOALS_KEY = 'sunday-nutrition-goals';
const NUTRITION_CACHE_KEY = 'sunday-nutrition-cache';

const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };

const UNDER_IS_GOOD = new Set(['calories', 'carbs', 'fat', 'saturatedFat', 'sugar', 'addedSugar', 'fiber', 'sodium', 'potassium']);

const MEASUREMENT_OPTIONS = ['g', 'oz', 'cup', 'tbsp', 'tsp', 'ml', 'piece', 'slice', 'can'];

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
      {payload.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '1px 0' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          <span style={{ color: '#6b7280' }}>{p.name}:</span>
          <span style={{ fontWeight: 600, color: '#111827' }}>{p.value}%</span>
        </div>
      ))}
    </div>
  );
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

function saveDailyLog(log, user) {
  try {
    localStorage.setItem(DAILY_LOG_KEY, JSON.stringify(log));
  } catch {}
  if (user) {
    // Prevent the real-time listener from overwriting our local edit
    window.__dailyLogLocalEdit = true;
    saveField(user.uid, 'dailyLog', log).finally(() => {
      setTimeout(() => { window.__dailyLogLocalEdit = false; }, 2000);
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

function scaleNutrition(nutrition, factor) {
  const scaled = {};
  for (const n of NUTRIENTS) {
    scaled[n.key] = Math.round((nutrition[n.key] || 0) * factor * 10) / 10;
  }
  return scaled;
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
  if (category === 'snacks' || category === 'desserts' || category === 'drinks') return 'snack';
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

      for (const ing of mealIngredients) {
        const result = await fetchNutritionForIngredient({
          ingredient: ing.ingredient,
          quantity: ing.quantity,
          measurement: ing.measurement,
        });
        if (result?.nutrients) {
          for (const n of NUTRIENTS) {
            totalNutrition[n.key] += result.nutrients[n.key] || 0;
          }
        }
      }

      onAdd({
        id: uuid(),
        type: 'custom_meal',
        recipeName: mealName.trim(),
        ingredients: mealIngredients.map(i => `${i.quantity} ${i.measurement} ${i.ingredient}`),
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
    if (!recipe) return;
    setRecipeLoading(true);
    setRecipeError('');
    try {
      const cache = loadNutritionCache();
      let totalNutrition;
      if (cache[recipeId]) {
        totalNutrition = cache[recipeId].totals;
      } else {
        const result = await fetchNutritionForRecipe(recipe.ingredients || []);
        totalNutrition = result.totals;
        try {
          cache[recipeId] = result;
          localStorage.setItem(NUTRITION_CACHE_KEY, JSON.stringify(cache));
        } catch {}
      }

      const recipeServings = recipe.servings || 1;
      const perServing = {};
      for (const n of NUTRIENTS) {
        perServing[n.key] = (totalNutrition[n.key] || 0) / recipeServings;
      }

      let factor;
      const cw = parseFloat(customWeight);
      if (cw > 0) {
        const totalGrams = (recipe.ingredients || []).reduce((sum, ing) => {
          const qty = parseFloat(ing.quantity) || 1;
          const unit = (ing.measurement || '').trim().toLowerCase();
          const MEASUREMENT_TO_GRAMS = { g: 1, oz: 28.35, cup: 140, tbsp: 15, tsp: 5, ml: 1, lb: 453.6, kg: 1000 };
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
        if (cache[rid]) {
          totalNutrition = cache[rid].totals;
        } else {
          const result = await fetchNutritionForRecipe(recipe.ingredients || []);
          totalNutrition = result.totals;
          try {
            cache[rid] = result;
            localStorage.setItem(NUTRITION_CACHE_KEY, JSON.stringify(cache));
          } catch {}
        }
        const recipeServings = recipe.servings || 1;
        const perServing = {};
        for (const n of NUTRIENTS) {
          perServing[n.key] = (totalNutrition[n.key] || 0) / recipeServings;
        }
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
      for (const ing of mealIngredients) {
        const result = await fetchNutritionForIngredient({ ingredient: ing.ingredient, quantity: ing.quantity, measurement: ing.measurement });
        if (result?.nutrients) { for (const n of NUTRIENTS) totalNutrition[n.key] += result.nutrients[n.key] || 0; }
      }
      onAdd({ id: uuid(), type: 'custom_meal', recipeName: mealName.trim(), ingredients: mealIngredients.map(i => `${i.quantity} ${i.measurement} ${i.ingredient}`), mealSlot: mealSlotChoice, timestamp: new Date().toISOString(), nutrition: totalNutrition });
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleAddItem() {
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
          <input className={styles.formInput} type="text" list="snack-unit-opts" value={measurement} onChange={e => setMeasurement(e.target.value)} placeholder="g" />
          <datalist id="snack-unit-opts">
            {MEASUREMENT_OPTIONS.map(m => <option key={m} value={m} />)}
          </datalist>
        </div>
        <button className={styles.mealIngAddBtn} onClick={handleAddItem} disabled={loading || !ingredientName.trim()}>
          {loading ? '...' : '+'}
        </button>
      </div>
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
      mealSlot: 'lunch',
      timestamp: new Date().toISOString(),
      nutrition,
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
          <div className={styles.formRow}>
            <button className={styles.addBtn} onClick={handleAdd}>Add to Meal Log</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Add Recipe Quick (1 serving) ── */
function AddRecipeQuick({ recipes, getRecipe, onAdd, onBack, weeklyPlan, inline, targetSlot, externalRecipeId }) {
  const [recipeId, setRecipeId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showWeight, setShowWeight] = useState(false);
  const [mealWeight, setMealWeight] = useState('');

  // Sync with externally selected recipe (from quick picks)
  useEffect(() => {
    if (externalRecipeId) setRecipeId(externalRecipeId);
  }, [externalRecipeId]);

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
    if (!recipe) return;

    // If using weight mode, validate
    if (useWeight) {
      const totalWeightNum = parseFloat(recipe.totalWeight) || 0;
      const containerWeightNum = (recipe.containers || []).reduce((sum, c) => sum + (parseFloat(c.weight) || 0), 0) || parseFloat(recipe.containerWeight) || 0;
      const foodWeight = Math.max(0, totalWeightNum - containerWeightNum);
      if (foodWeight <= 0) {
        setError('Weigh meal first — go to the recipe and enter the total weight in "Weigh portion size".');
        return;
      }
      const mw = parseFloat(mealWeight);
      if (!mw || mw <= 0) {
        setError('Enter your meal weight in grams.');
        return;
      }
    }

    setLoading(true);
    setError('');
    try {
      const cache = loadNutritionCache();
      let totalNutrition;
      if (cache[recipeId]) {
        totalNutrition = cache[recipeId].totals;
      } else {
        const result = await fetchNutritionForRecipe(recipe.ingredients || []);
        totalNutrition = result.totals;
        try { cache[recipeId] = result; localStorage.setItem(NUTRITION_CACHE_KEY, JSON.stringify(cache)); } catch {}
      }
      const recipeServings = recipe.servings || 1;
      const perServing = {};
      for (const n of NUTRIENTS) perServing[n.key] = (totalNutrition[n.key] || 0) / recipeServings;

      let factor = 1;
      if (useWeight) {
        const totalWeightNum = parseFloat(recipe.totalWeight) || 0;
        const containerWeightNum = (recipe.containers || []).reduce((sum, c) => sum + (parseFloat(c.weight) || 0), 0) || parseFloat(recipe.containerWeight) || 0;
        const foodWeight = Math.max(0, totalWeightNum - containerWeightNum);
        const mw = parseFloat(mealWeight);
        // factor = (mealWeight / foodWeight) * recipeServings
        factor = foodWeight > 0 ? (mw / foodWeight) * recipeServings : 1;
      }

      const nutrition = scaleNutrition(perServing, factor);
      const mealSlot = inline ? undefined : categoryToSlot(recipe.category);
      const cw = useWeight ? parseFloat(mealWeight) : null;
      onAdd({ id: uuid(), type: 'recipe', recipeId, recipeName: recipe.title, servings: useWeight ? parseFloat((factor).toFixed(2)) : 1, customWeight: cw, ...(mealSlot ? { mealSlot } : {}), timestamp: new Date().toISOString(), nutrition });
    } catch {
      setError('Failed to look up nutrition. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {!inline && onBack && <button className={styles.trackMenuBack} onClick={onBack}>&larr; Back</button>}
      {!inline && <h4 className={styles.trackMenuSubtitle}>Add Recipe (1 serving)</h4>}
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
      {showWeight && (
        <div className={styles.formRow}>
          <div className={styles.formField}>
            <span className={styles.formLabel}>My portion weight (g)</span>
            <input
              className={styles.formInput}
              type="number"
              min="0"
              placeholder="grams"
              value={mealWeight}
              onChange={e => setMealWeight(e.target.value)}
            />
          </div>
        </div>
      )}
      {showWeight && recipeId && mealWeight && (() => {
        const recipe = getRecipe(recipeId);
        if (!recipe) return null;
        const totalWeightNum = parseFloat(recipe.totalWeight) || 0;
        const containerWeightNum = (recipe.containers || []).reduce((sum, c) => sum + (parseFloat(c.weight) || 0), 0) || parseFloat(recipe.containerWeight) || 0;
        const foodWeight = Math.max(0, totalWeightNum - containerWeightNum);
        if (foodWeight <= 0) return <p className={styles.weightPreviewError}>No total weight set on this recipe. Go to the recipe's "Weigh portion size" section first.</p>;
        const mw = parseFloat(mealWeight);
        if (!mw || mw <= 0) return null;
        const recipeServings = parseInt(recipe.servings) || 1;
        const factor = (mw / foodWeight) * recipeServings;
        const servingsDisplay = parseFloat(factor.toFixed(2));
        const cache = loadNutritionCache();
        const cached = cache[recipeId];
        if (!cached?.totals) return (
          <div className={styles.weightPreview}>
            <span className={styles.weightPreviewServings}>{servingsDisplay} {servingsDisplay === 1 ? 'serving' : 'servings'}</span>
            <span className={styles.weightPreviewNote}>({mw}g of {foodWeight}g total)</span>
          </div>
        );
        const perServing = {};
        for (const n of NUTRIENTS) perServing[n.key] = (cached.totals[n.key] || 0) / recipeServings;
        const scaled = scaleNutrition(perServing, factor);
        return (
          <div className={styles.weightPreview}>
            <span className={styles.weightPreviewServings}>{servingsDisplay} {servingsDisplay === 1 ? 'serving' : 'servings'}</span>
            <span className={styles.weightPreviewNote}>({mw}g of {foodWeight}g total)</span>
            <div className={styles.weightPreviewMacros}>
              <span>{Math.round(scaled.calories || 0)} cal</span>
              <span>{Math.round(scaled.protein || 0)}g protein</span>
              <span>{Math.round(scaled.carbs || 0)}g carbs</span>
              <span>{Math.round(scaled.fat || 0)}g fat</span>
            </div>
          </div>
        );
      })()}
      <div className={styles.formRow} style={{ gap: '0.5rem' }}>
        <button className={styles.addBtn} onClick={() => handleAdd(showWeight && mealWeight)} disabled={loading || !recipeId}>{loading ? 'Adding...' : 'Add Meal'}</button>
        <button
          className={showWeight ? styles.addBtnSecondaryActive : styles.addBtnSecondary}
          onClick={() => setShowWeight(prev => !prev)}
          disabled={loading || !recipeId}
          type="button"
        >
          {showWeight ? 'Hide Weight' : 'Meal Weight'}
        </button>
      </div>
      {error && <p className={styles.addError}>{error}</p>}
    </div>
  );
}

/* ── Add Recipe Adjust (custom servings/weight) ── */
function AddRecipeAdjust({ recipes, getRecipe, onAdd, onBack, weeklyPlan }) {
  const [recipeId, setRecipeId] = useState('');
  const [servings, setServings] = useState('1');
  const [customWeight, setCustomWeight] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sortedRecipes = useMemo(() =>
    [...recipes]
      .filter(r => (r.frequency || 'common') !== 'retired')
      .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [recipes]
  );

  async function handleAdd() {
    if (!recipeId) return;
    const recipe = getRecipe(recipeId);
    if (!recipe) return;
    setLoading(true);
    setError('');
    try {
      const cache = loadNutritionCache();
      let totalNutrition;
      if (cache[recipeId]) {
        totalNutrition = cache[recipeId].totals;
      } else {
        const result = await fetchNutritionForRecipe(recipe.ingredients || []);
        totalNutrition = result.totals;
        try { cache[recipeId] = result; localStorage.setItem(NUTRITION_CACHE_KEY, JSON.stringify(cache)); } catch {}
      }
      const recipeServings = recipe.servings || 1;
      const perServing = {};
      for (const n of NUTRIENTS) perServing[n.key] = (totalNutrition[n.key] || 0) / recipeServings;

      let factor;
      const cw = parseFloat(customWeight);
      if (cw > 0) {
        const totalGrams = (recipe.ingredients || []).reduce((sum, ing) => {
          const qty = parseFloat(ing.quantity) || 1;
          const unit = (ing.measurement || '').trim().toLowerCase();
          const MEASUREMENT_TO_GRAMS = { g: 1, oz: 28.35, cup: 140, tbsp: 15, tsp: 5, ml: 1, lb: 453.6, kg: 1000 };
          const fac = MEASUREMENT_TO_GRAMS[unit] || 100;
          return sum + qty * fac;
        }, 0);
        factor = totalGrams > 0 ? cw / (totalGrams / recipeServings) : parseFloat(servings) || 1;
      } else {
        factor = parseFloat(servings) || 1;
      }

      const nutrition = scaleNutrition(perServing, factor);
      const mealSlot = categoryToSlot(recipe.category);
      onAdd({ id: uuid(), type: 'recipe', recipeId, recipeName: recipe.title, servings: parseFloat(servings) || 1, customWeight: cw > 0 ? cw : null, mealSlot, timestamp: new Date().toISOString(), nutrition });
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
          <span className={styles.formLabel}>Weight (g)</span>
          <input className={styles.formInput} type="number" value={customWeight} onChange={e => setCustomWeight(e.target.value)} placeholder="optional" min="1" />
        </div>
      </div>
      <div className={styles.formRow}>
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
  else if (score >= 65) color = 'var(--color-accent, #C96442)';
  else if (score >= 45) color = '#D4A574';
  else color = 'var(--color-danger, #dc2626)';

  return (
    <span className={styles.mealScoreBadge} style={{ color, borderColor: color }}>
      {score}
    </span>
  );
}

function EntryRow({ entry, onDelete, goalKeys }) {
  const name = entry.type === 'custom_meal' ? entry.recipeName : entry.type === 'recipe' ? entry.recipeName : entry.ingredientName;
  const portion = entry.type === 'recipe'
    ? (entry.customWeight ? `${entry.customWeight}g` : `${entry.servings} serving${entry.servings !== 1 ? 's' : ''}`)
    : entry.type === 'custom_meal'
    ? `${(entry.ingredients || []).length} ingredients`
    : `${entry.quantity} ${entry.measurement}`;
  const n = entry.nutrition || {};
  const keys = goalKeys && goalKeys.length > 0 ? goalKeys : DEFAULT_ENTRY_KEYS;

  return (
    <div className={styles.entryRow}>
      <MealScoreBadge nutrition={n} />
      <span className={styles.entryName}>{name}</span>
      <span className={styles.entryPortion}>{portion}</span>
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
  );
}

/* ── Meal Log ── */
function MealLog({ entries, onDelete, goalKeys, skippedMeals, daySkipped }) {
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
                <EntryRow key={entry.id} entry={entry} onDelete={onDelete} goalKeys={goalKeys} />
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
        const row = { date: `${parseInt(m)}/${parseInt(d)}` };
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
      const row = { date: `${parseInt(m)}/${parseInt(d)}` };
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
          {[7, 14, 30].map(r => (
            <button
              key={r}
              className={range === r ? styles.rangeBtnActive : styles.rangeBtn}
              onClick={() => setRange(r)}
            >
              {r}d
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
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.78rem', paddingTop: '0.5rem', textAlign: 'left' }} align="left" />
              <ReferenceLine y={100} stroke="#d1d5db" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: '100%', position: 'right', fontSize: 10, fill: '#9ca3af' }} />
              {selectedNutrients.filter(k => goals[k] > 0).map((key, i) => (
                <Area key={`area-${key}`} type="monotone" dataKey={key} fill={`url(#grad-${key})`} stroke="none" name={NUTRIENTS.find(n => n.key === key)?.label || key} legendType="none" />
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
      const row = { date: `${parseInt(m)}/${parseInt(d)}` };

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
          {[7, 14, 30].map(r => (
            <button
              key={r}
              className={range === r ? styles.rangeBtnActive : styles.rangeBtn}
              onClick={() => setRange(r)}
            >
              {r}d
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
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.78rem', paddingTop: '0.5rem', textAlign: 'left' }} align="left" />
              <ReferenceLine y={vegTarget} stroke="#22c55e" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `Veg ${vegTarget}`, position: 'right', fontSize: 10, fill: '#22c55e' }} />
              <ReferenceLine y={fruitTarget} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1.5} label={{ value: `Fruit ${fruitTarget}`, position: 'right', fontSize: 10, fill: '#f59e0b' }} />
              <Area type="monotone" dataKey="veg" fill="url(#grad-veg)" stroke="none" name="Vegetables" legendType="none" />
              <Area type="monotone" dataKey="fruit" fill="url(#grad-fruit)" stroke="none" name="Fruit" legendType="none" />
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
      {payload.map(p => (
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
function WeeklyView({ dailyLog, date, recipes, onDayClick, onMoveEntry, onAddToSlot, onViewRecipe, onRemoveLastEntry }) {
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
      bySlot[slot].push({ id: entry.id, entryIndex: ei, name: name || 'Unknown', sourceDate: dateStr, recipeId: entry.recipeId || null, type: entry.type });
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
                          <span
                            key={item.id}
                            className={`${styles.weeklyColMeal} ${item.recipeId ? styles.weeklyColMealClickable : ''}`}
                            draggable
                            onDragStart={e => {
                              e.dataTransfer.setData('text/plain', JSON.stringify({ sourceDate: item.sourceDate, entryId: item.id }));
                              e.stopPropagation();
                            }}
                            onClick={e => {
                              if (item.recipeId && onViewRecipe) {
                                e.stopPropagation();
                                onViewRecipe(item.recipeId);
                              }
                            }}
                          >{item.name}</span>
                        )) : day.isPast ? (
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
        if (!cached?.totals) continue;
        const recipeServings = recipe.servings || 1;
        const perServing = (cached.totals[key] || 0) / recipeServings;
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
        if (!cached?.totals) continue;
        const recipeServings = recipe.servings || 1;
        const perServing = (cached.totals[servingKey] || 0) / recipeServings;
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
      <p className={styles.kpiSubtitle}>Based on the food log from {dateRangeLabel}</p>
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
          <WeeklyView dailyLog={dailyLog} date={date} recipes={recipes} onDayClick={(d) => setDate(d)} onMoveEntry={moveEntry} onAddToSlot={handleAddToSlot} onViewRecipe={(id) => setViewRecipeId(id)} onRemoveLastEntry={removeLastEntry} />
        </div>
        <div className={styles.weeklyWithCalRight}>
          <MiniCalendar date={date} setDate={setDate} dailyLog={dailyLog} />
          <button className={styles.todayBtn} onClick={() => setDate(todayStr())} disabled={date === todayStr()}>Today</button>
        </div>
      </div>
      <div className={styles.twoColRow}>
        <HistoryChart dailyLog={dailyLog} />
        <ServingsChart dailyLog={dailyLog} />
      </div>
      <KpiAlerts dailyLog={dailyLog} recipes={recipes} onImportRecipe={onImportRecipe} cacheVersion={cacheVersion} onViewRecipe={(id) => setViewRecipeId(id)} selectedDate={date} user={user} />
      {addModal && (
        <div className={styles.modalOverlay} onClick={() => setAddModal(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
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
              <SnackTrackerInline
                onAdd={(entry) => { addEntry(entry, addModal.targetDate, addModal.targetSlot); }}
                onClose={() => setAddModal(null)}
              />
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
                <button className={styles.trackMenuBtn} onClick={() => setAddModal(prev => ({ ...prev, mode: 'adjust' }))}>
                  <div className={styles.trackMenuBtnInfo}>
                    <span className={styles.trackMenuBtnLabel}>Adjust Servings</span>
                    <span className={styles.trackMenuBtnDesc}>Customize servings or weight</span>
                  </div>
                  <span className={styles.trackMenuBtnArrow}>&rsaquo;</span>
                </button>
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
