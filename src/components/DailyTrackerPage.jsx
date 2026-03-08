import { useState, useEffect, useRef, useMemo } from 'react';
import { NUTRIENTS, fetchNutritionForIngredient, fetchNutritionForRecipe } from '../utils/nutrition';
import { loadIngredients } from '../utils/ingredientsStore';
import { saveField } from '../utils/firestoreSync';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend, CartesianGrid, Area, ComposedChart } from 'recharts';
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
  leucine: 'leu', omega3: 'ω3', vegServings: 'veg',
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
  if (user) saveField(user.uid, 'dailyLog', log);
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

/* ── Date Navigator ── */
function DateNavigator({ date, setDate }) {
  const isToday = date === todayStr();
  return (
    <div className={styles.dateNav}>
      <button className={styles.dateArrow} onClick={() => setDate(shiftDate(date, -1))}>&larr;</button>
      <span className={styles.dateLabel}>{formatDate(date)}</span>
      <button className={styles.dateArrow} onClick={() => setDate(shiftDate(date, 1))}>&rarr;</button>
      <button className={styles.todayBtn} onClick={() => setDate(todayStr())} disabled={isToday}>Today</button>
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
  const [tab, setTab] = useState('recipe');
  const [recipeId, setRecipeId] = useState('');
  const [servings, setServings] = useState('1');
  const [customWeight, setCustomWeight] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedWeekly, setSelectedWeekly] = useState(new Set());
  const [showMealModal, setShowMealModal] = useState(false);

  // Custom tab state (single items)
  const [ingredientName, setIngredientName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [measurement, setMeasurement] = useState('g');

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
      setError('Failed to look up nutrition. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddCustom() {
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
      setError('Failed to look up nutrition. Try again.');
    } finally {
      setLoading(false);
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
    setLoading(true);
    setError('');
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
      setError('Failed to look up nutrition. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.addCard}>
      <h3>Add Entry</h3>
      <div className={styles.tabToggle}>
        <button className={tab === 'recipe' ? styles.tabBtnActive : styles.tabBtn} onClick={() => setTab('recipe')}>Recipes</button>
        <button className={tab === 'custom' ? styles.tabBtnActive : styles.tabBtn} onClick={() => setTab('custom')}>Single Items</button>
        <button className={styles.customMealBtn} onClick={() => setShowMealModal(true)}>+ Custom Meal</button>
      </div>

      {showMealModal && (
        <CustomMealModal onAdd={onAdd} onClose={() => setShowMealModal(false)} />
      )}

      {weeklyRecipes.length > 0 && (
        <div className={styles.weeklyChips}>
          <span className={styles.weeklyLabel}>This week</span>
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

      {tab === 'recipe' ? (
        <>
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
        </>
      ) : (
        <>
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
        </>
      )}

      <div className={styles.formRow}>
        <button
          className={styles.addBtn}
          onClick={async () => {
            if (selectedWeekly.size > 0) await handleAddWeeklySelected();
            if (tab === 'recipe' && recipeId) await handleAddRecipe();
            else if (tab === 'custom' && ingredientName.trim()) await handleAddCustom();
          }}
          disabled={loading || (selectedWeekly.size === 0 && (tab === 'recipe' ? !recipeId : !ingredientName.trim()))}
        >
          {loading ? 'Adding...' : 'Add'}
        </button>
      </div>
      {error && <p className={styles.addError}>{error}</p>}
      {loading && <p className={styles.addLoading}>Looking up nutrition...</p>}
    </div>
  );
}

/* ── Entry Row ── */
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
function MealLog({ entries, onDelete, goalKeys, skippedMeals, onToggleSkipMeal, daySkipped }) {
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
              <button
                className={isSkipped ? styles.skipBtnActive : styles.skipBtn}
                onClick={() => onToggleSkipMeal(slot)}
              >
                {isSkipped ? 'Skipped' : 'Skip'}
              </button>
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

  // Adjust goals proportionally for skipped meals
  const mealCount = MEAL_SLOTS.length;
  const skippedCount = skippedMeals ? skippedMeals.length : 0;
  const activeFraction = skippedCount < mealCount ? (mealCount - skippedCount) / mealCount : 1;

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
function HistoryChart({ dailyLog }) {
  const [range, setRange] = useState(7);
  const [selectedNutrients, setSelectedNutrients] = useState(['calories', 'protein']);
  const goals = useMemo(loadGoals, []);

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

      const activeFraction = skippedMeals.length < MEAL_SLOTS.length
        ? (MEAL_SLOTS.length - skippedMeals.length) / MEAL_SLOTS.length : 1;

      const totals = {};
      for (const n of NUTRIENTS) totals[n.key] = 0;
      for (const entry of activeEntries) {
        for (const n of NUTRIENTS) {
          totals[n.key] += entry.nutrition?.[n.key] || 0;
        }
      }
      const [, m, d] = dateStr.split('-');
      const row = { date: `${parseInt(m)}/${parseInt(d)}` };
      for (const n of NUTRIENTS) {
        const adjustedGoal = goals[n.key] * activeFraction;
        row[n.key] = adjustedGoal > 0 ? Math.round((totals[n.key] / adjustedGoal) * 100) : 0;
      }
      data.push(row);
    }
    return data;
  }, [dailyLog, range, goals]);

  const hasData = chartData.some(d => selectedNutrients.some(k => d[k] > 0));

  return (
    <div className={styles.chartCard}>
      <h3>History (% of Daily Target)</h3>
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
          {availableNutrients.map(n => (
            <label key={n.key} className={styles.nutrientCheck}>
              <input
                type="checkbox"
                checked={selectedNutrients.includes(n.key)}
                onChange={() => toggleNutrient(n.key)}
              />
              {n.label}
            </label>
          ))}
        </div>
      </div>

      {!goals ? (
        <div className={styles.noChartData}>Set nutrition goals to see % of daily target.</div>
      ) : !hasData ? (
        <div className={styles.noChartData}>No data in the selected range. Add entries to see trends.</div>
      ) : (
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 15, left: 20, bottom: 5 }}>
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
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} unit="%" axisLine={false} tickLine={false} label={{ value: '% of Daily Target', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9ca3af', textAnchor: 'middle' } }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.78rem', paddingTop: '0.5rem' }} />
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

/* ── Main Page ── */
export function DailyTrackerPage({ recipes, getRecipe, onClose, user, weeklyPlan }) {
  const [date, setDate] = useState(todayStr);
  const [dailyLog, setDailyLog] = useState(loadDailyLog);

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

  function toggleSkipMeal(slot) {
    setDailyLog(prev => {
      const next = { ...prev };
      if (!next[date]) next[date] = { entries: [] };
      const current = next[date].skippedMeals || [];
      const updated = current.includes(slot)
        ? current.filter(s => s !== slot)
        : [...current, slot];
      next[date] = { ...next[date], skippedMeals: updated };
      saveDailyLog(next, user);
      return next;
    });
  }

  function addEntry(entry) {
    setDailyLog(prev => {
      const next = { ...prev };
      if (!next[date]) next[date] = { entries: [] };
      next[date] = { ...next[date], entries: [...next[date].entries, entry] };
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

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onClose}>&larr; Back</button>
      <DateNavigator date={date} setDate={setDate} />
      <div className={styles.skipDayRow}>
        <button
          className={daySkipped ? styles.skipDayBtnActive : styles.skipDayBtn}
          onClick={toggleSkipDay}
        >
          {daySkipped ? 'Day Skipped' : 'Skip Day'}
        </button>
      </div>
      {!daySkipped && (
        <AddEntrySection recipes={recipes} getRecipe={getRecipe} onAdd={addEntry} weeklyPlan={weeklyPlan} />
      )}
      <MealLog entries={entries} onDelete={deleteEntry} goalKeys={goalKeys} skippedMeals={skippedMeals} onToggleSkipMeal={toggleSkipMeal} daySkipped={daySkipped} />
      <DailyTotalsBar entries={entries} daySkipped={daySkipped} skippedMeals={skippedMeals} />
      <HistoryChart dailyLog={dailyLog} />
    </div>
  );
}
