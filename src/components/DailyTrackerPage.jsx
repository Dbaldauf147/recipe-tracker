import { useState, useEffect, useRef, useMemo } from 'react';
import { NUTRIENTS, fetchNutritionForIngredient, fetchNutritionForRecipe } from '../utils/nutrition';
import { loadIngredients } from '../utils/ingredientsStore';
import { saveField } from '../utils/firestoreSync';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import styles from './DailyTrackerPage.module.css';

const DAILY_LOG_KEY = 'sunday-daily-log';
const GOALS_KEY = 'sunday-nutrition-goals';
const NUTRITION_CACHE_KEY = 'sunday-nutrition-cache';

const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };

const UNDER_IS_GOOD = new Set(['calories', 'carbs', 'fat', 'saturatedFat', 'sugar', 'addedSugar', 'fiber', 'sodium', 'potassium']);

const MEASUREMENT_OPTIONS = ['g', 'oz', 'cup', 'tbsp', 'tsp', 'ml', 'piece', 'slice', 'can'];

const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return date.toISOString().slice(0, 10);
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

/* ── Add Entry Section ── */
function AddEntrySection({ recipes, getRecipe, onAdd }) {
  const [tab, setTab] = useState('recipe');
  const [recipeId, setRecipeId] = useState('');
  const [servings, setServings] = useState('1');
  const [customWeight, setCustomWeight] = useState('');
  const [mealSlot, setMealSlot] = useState('lunch');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Custom tab state
  const [ingredientName, setIngredientName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [measurement, setMeasurement] = useState('g');

  const sortedRecipes = useMemo(() =>
    [...recipes]
      .filter(r => (r.frequency || 'common') !== 'retired')
      .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [recipes]
  );

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
        // Cache for future use
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
        // Weight-based: compute total recipe weight, then scale
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

      // Reset
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

  return (
    <div className={styles.addCard}>
      <h3>Add Entry</h3>
      <div className={styles.tabToggle}>
        <button className={tab === 'recipe' ? styles.tabBtnActive : styles.tabBtn} onClick={() => setTab('recipe')}>Recipe</button>
        <button className={tab === 'custom' ? styles.tabBtnActive : styles.tabBtn} onClick={() => setTab('custom')}>Custom Food</button>
      </div>

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
                    if (MEASUREMENT_OPTIONS.includes(m)) setMeasurement(m);
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
                {MEASUREMENT_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
        </>
      )}

      <div className={styles.formRow}>
        <div className={styles.mealSlotRow}>
          <span className={styles.mealSlotLabel}>Meal:</span>
          {MEAL_SLOTS.map(s => (
            <button
              key={s}
              className={mealSlot === s ? styles.mealSlotBtnActive : styles.mealSlotBtn}
              onClick={() => setMealSlot(s)}
            >
              {MEAL_LABELS[s]}
            </button>
          ))}
        </div>
        <button
          className={styles.addBtn}
          onClick={tab === 'recipe' ? handleAddRecipe : handleAddCustom}
          disabled={loading || (tab === 'recipe' ? !recipeId : !ingredientName.trim())}
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
function EntryRow({ entry, onDelete }) {
  const name = entry.type === 'recipe' ? entry.recipeName : entry.ingredientName;
  const portion = entry.type === 'recipe'
    ? (entry.customWeight ? `${entry.customWeight}g` : `${entry.servings} serving${entry.servings !== 1 ? 's' : ''}`)
    : `${entry.quantity} ${entry.measurement}`;
  const n = entry.nutrition || {};

  return (
    <div className={styles.entryRow}>
      <span className={styles.entryName}>{name}</span>
      <span className={styles.entryPortion}>{portion}</span>
      <div className={styles.entryMacros}>
        <span className={styles.entryMacro}><span className={styles.macroValue}>{Math.round(n.calories || 0)}</span><span className={styles.macroLabel}>cal</span></span>
        <span className={styles.entryMacro}><span className={styles.macroValue}>{Math.round((n.protein || 0) * 10) / 10}g</span><span className={styles.macroLabel}>pro</span></span>
        <span className={styles.entryMacro}><span className={styles.macroValue}>{Math.round((n.carbs || 0) * 10) / 10}g</span><span className={styles.macroLabel}>carb</span></span>
        <span className={styles.entryMacro}><span className={styles.macroValue}>{Math.round((n.fat || 0) * 10) / 10}g</span><span className={styles.macroLabel}>fat</span></span>
      </div>
      <button className={styles.deleteBtn} onClick={() => onDelete(entry.id)} aria-label="Delete">&times;</button>
    </div>
  );
}

/* ── Meal Log ── */
function MealLog({ entries, onDelete }) {
  if (entries.length === 0) {
    return <div className={styles.emptyLog}>No entries yet. Add a recipe or custom food above.</div>;
  }

  const grouped = {};
  for (const slot of MEAL_SLOTS) grouped[slot] = [];
  for (const entry of entries) {
    const slot = MEAL_SLOTS.includes(entry.mealSlot) ? entry.mealSlot : 'snack';
    grouped[slot].push(entry);
  }

  return (
    <>
      {MEAL_SLOTS.map(slot => {
        const items = grouped[slot];
        if (items.length === 0) return null;
        const subtotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
        for (const e of items) {
          subtotals.calories += e.nutrition?.calories || 0;
          subtotals.protein += e.nutrition?.protein || 0;
          subtotals.carbs += e.nutrition?.carbs || 0;
          subtotals.fat += e.nutrition?.fat || 0;
        }
        return (
          <div key={slot} className={styles.mealSection}>
            <h4 className={styles.mealHeader}>{MEAL_LABELS[slot]}</h4>
            {items.map(entry => (
              <EntryRow key={entry.id} entry={entry} onDelete={onDelete} />
            ))}
            <div className={styles.subtotalRow}>
              <span className={styles.subtotalLabel}>Subtotal</span>
              <div className={styles.entryMacros}>
                <span className={styles.entryMacro}><span className={styles.macroValue}>{Math.round(subtotals.calories)}</span><span className={styles.macroLabel}>cal</span></span>
                <span className={styles.entryMacro}><span className={styles.macroValue}>{Math.round(subtotals.protein * 10) / 10}g</span><span className={styles.macroLabel}>pro</span></span>
                <span className={styles.entryMacro}><span className={styles.macroValue}>{Math.round(subtotals.carbs * 10) / 10}g</span><span className={styles.macroLabel}>carb</span></span>
                <span className={styles.entryMacro}><span className={styles.macroValue}>{Math.round(subtotals.fat * 10) / 10}g</span><span className={styles.macroLabel}>fat</span></span>
              </div>
              <div style={{ width: 24 }} />
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ── Daily Totals Progress Bars ── */
function DailyTotalsBar({ entries }) {
  const goals = useMemo(loadGoals, []);

  if (!goals) return null;

  const totals = {};
  for (const n of NUTRIENTS) totals[n.key] = 0;
  for (const entry of entries) {
    for (const n of NUTRIENTS) {
      totals[n.key] += entry.nutrition?.[n.key] || 0;
    }
  }

  const goalRows = NUTRIENTS.filter(n => goals[n.key] > 0).map(n => {
    const target = goals[n.key];
    const actual = totals[n.key];
    const pct = Math.round((actual / target) * 100);
    let barColor;
    if (UNDER_IS_GOOD.has(n.key)) {
      barColor = pct <= 100 ? styles.progressGreen : pct <= 130 ? styles.progressYellow : styles.progressRed;
    } else {
      barColor = pct >= 100 ? styles.progressGreen : pct >= 70 ? styles.progressYellow : styles.progressRed;
    }
    return { ...n, target, actual, pct, barColor };
  });

  if (goalRows.length === 0) return null;

  return (
    <div className={styles.totalsCard}>
      <h3>Daily Totals vs Goals</h3>
      {goalRows.map(n => (
        <div key={n.key} className={styles.goalRow}>
          <span className={styles.goalLabel}>{n.label}</span>
          <div className={styles.goalBar}>
            <div className={`${styles.goalFill} ${n.barColor}`} style={{ width: `${Math.min(n.pct, 100)}%` }} />
          </div>
          <span className={styles.goalPct}>{n.pct}%</span>
          <span className={styles.goalValues}>
            {Math.round(n.actual * 10) / 10}{n.unit} / {n.target}{n.unit}
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
      const entries = dailyLog[dateStr]?.entries || [];
      const totals = {};
      for (const n of NUTRIENTS) totals[n.key] = 0;
      for (const entry of entries) {
        for (const n of NUTRIENTS) {
          totals[n.key] += entry.nutrition?.[n.key] || 0;
        }
      }
      const [, m, d] = dateStr.split('-');
      const row = { date: `${parseInt(m)}/${parseInt(d)}` };
      for (const n of NUTRIENTS) {
        const goal = goals[n.key];
        row[n.key] = goal > 0 ? Math.round((totals[n.key] / goal) * 100) : 0;
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
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(value) => `${value}%`} />
              <Legend />
              {selectedNutrients.filter(k => goals[k] > 0).map((key, i) => (
                <Bar key={key} dataKey={key} fill={CHART_COLORS[i % CHART_COLORS.length]} name={NUTRIENTS.find(n => n.key === key)?.label || key} />
              ))}
              <ReferenceLine y={100} stroke="#888" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: '100%', position: 'right', fontSize: 10, fill: '#888' }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* ── Main Page ── */
export function DailyTrackerPage({ recipes, getRecipe, onClose, user }) {
  const [date, setDate] = useState(todayStr);
  const [dailyLog, setDailyLog] = useState(loadDailyLog);

  const entries = dailyLog[date]?.entries || [];

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
      <AddEntrySection recipes={recipes} getRecipe={getRecipe} onAdd={addEntry} />
      <MealLog entries={entries} onDelete={deleteEntry} />
      <DailyTotalsBar entries={entries} />
      <HistoryChart dailyLog={dailyLog} />
    </div>
  );
}
