import { useState, useEffect, useMemo, useRef } from 'react';
import { fetchNutritionForRecipe, NUTRIENTS } from '../utils/nutrition';
import styles from './NutritionPanel.module.css';

const GOALS_KEY = 'sunday-nutrition-goals';

const MACROS = ['calories', 'protein', 'carbs', 'fat', 'saturatedFat'];
const SUGARS_FIBER = ['sugar', 'addedSugar', 'fiber'];
const MINERALS = ['sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'zinc'];
const VITAMINS_AMINOS = ['vitaminB12', 'vitaminC', 'leucine'];
const OTHER = ['vegServings', 'fruitServings'];

function NutrientRow({ nutrient, total, perServing, showPerServing }) {
  return (
    <div className={styles.nutrientRow}>
      <span className={styles.nutrientLabel}>{nutrient.label}</span>
      <span className={styles.nutrientValue}>
        {showPerServing ? perServing : total}{nutrient.unit}
      </span>
    </div>
  );
}

function divideNutrients(totals, servings) {
  const result = {};
  for (const key in totals) {
    const val = totals[key];
    result[key] = typeof val === 'number'
      ? Math.round(val / servings)
      : val;
  }
  return result;
}

export function PlateChart({ protein, carbs, fat }) {
  const total = protein + carbs + fat;
  if (total === 0) return null;

  const pPct = protein / total;
  const cPct = carbs / total;
  const fPct = fat / total;

  // Warm earth-tone palette matching the site
  const cx = 120, cy = 120, r = 85;
  const slices = [
    { pct: pPct, color: '#C96442', colorDark: '#A85035', label: 'Protein', grams: protein },
    { pct: cPct, color: '#D4A574', colorDark: '#BF8F5E', label: 'Carbs', grams: carbs },
    { pct: fPct, color: '#8B9A6B', colorDark: '#738159', label: 'Fat', grams: fat },
  ];

  let cumulative = 0;
  const paths = slices.map((slice, i) => {
    if (slice.pct === 0) return null;
    const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
    cumulative += slice.pct;
    const endAngle = cumulative * 2 * Math.PI - Math.PI / 2;
    const largeArc = slice.pct > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    if (slice.pct >= 0.999) {
      return (
        <circle key={i} cx={cx} cy={cy} r={r} fill={`url(#food${i})`} />
      );
    }
    return (
      <path
        key={i}
        d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`}
        fill={`url(#food${i})`}
      />
    );
  });

  // Divider lines between slices
  let cum3 = 0;
  const dividers = slices.map((slice, i) => {
    if (slice.pct === 0 || slice.pct >= 0.999) { cum3 += slice.pct; return null; }
    const angle = cum3 * 2 * Math.PI - Math.PI / 2;
    cum3 += slice.pct;
    const x1 = cx;
    const y1 = cy;
    const x2 = cx + r * Math.cos(angle);
    const y2 = cy + r * Math.sin(angle);
    return <line key={`d${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#F5F1EC" strokeWidth="2" />;
  });

  // Label positions at midpoint of each arc
  let cum2 = 0;
  const labels = slices.map((slice, i) => {
    if (slice.pct < 0.05) { cum2 += slice.pct; return null; }
    const midAngle = (cum2 + slice.pct / 2) * 2 * Math.PI - Math.PI / 2;
    cum2 += slice.pct;
    const lr = r * 0.6;
    const lx = cx + lr * Math.cos(midAngle);
    const ly = cy + lr * Math.sin(midAngle);
    return (
      <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize="12" fontWeight="700"
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>
        {Math.round(slice.pct * 100)}%
      </text>
    );
  });

  return (
    <div className={styles.plateWrap}>
      <svg viewBox="0 0 240 240" className={styles.plateSvg}>
        <defs>
          {/* Gradients for food-like texture on each slice */}
          {slices.map((s, i) => (
            <radialGradient key={i} id={`food${i}`} cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor={s.color} stopOpacity="1" />
              <stop offset="100%" stopColor={s.colorDark} stopOpacity="1" />
            </radialGradient>
          ))}
          {/* Plate rim gradient */}
          <radialGradient id="plateRim" cx="45%" cy="40%" r="55%">
            <stop offset="0%" stopColor="#F5F1EC" />
            <stop offset="100%" stopColor="#E8E0D8" />
          </radialGradient>
          {/* Plate shadow */}
          <filter id="plateShadow" x="-10%" y="-5%" width="120%" height="125%">
            <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#2C2520" floodOpacity="0.12" />
          </filter>
          {/* Inner highlight for plate sheen */}
          <radialGradient id="plateSheen" cx="40%" cy="35%" r="50%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Plate outer rim with shadow */}
        <circle cx={cx} cy={cy} r={r + 18} fill="url(#plateRim)" filter="url(#plateShadow)" />
        {/* Rim inner edge */}
        <circle cx={cx} cy={cy} r={r + 10} fill="none" stroke="#E8E0D8" strokeWidth="1" />
        {/* Lip highlight */}
        <circle cx={cx} cy={cy} r={r + 14} fill="none" stroke="#fff" strokeWidth="1" opacity="0.5" />

        {/* Food area */}
        <clipPath id="plateClip">
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
        <g clipPath="url(#plateClip)">
          {paths}
          {dividers}
          {/* Subtle highlight overlay for food sheen */}
          <circle cx={cx} cy={cy} r={r} fill="url(#plateSheen)" />
        </g>

        {/* Plate inner edge ring */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E8E0D8" strokeWidth="1.5" />

        {labels}
      </svg>
      <div className={styles.plateLegend}>
        {slices.map(s => (
          <div key={s.label} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: s.color }} />
            <span className={styles.legendLabel}>{s.label}</span>
            <span className={styles.legendValue}>{s.grams}g ({Math.round(s.pct * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Nutrients where being under the goal is desirable
const UNDER_IS_GOOD_SET = new Set(['calories', 'carbs', 'fat', 'saturatedFat', 'sugar', 'addedSugar', 'sodium']);

export function MealScore({ totals, servings = 1 }) {
  const goals = useMemo(() => {
    try {
      const raw = localStorage.getItem(GOALS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, []);

  if (!totals || !goals) return null;

  const perServing = {};
  for (const key in totals) {
    const val = totals[key];
    perServing[key] = typeof val === 'number' ? Math.round(val / servings) : val;
  }

  // Score each nutrient that has a goal set
  const scores = [];
  for (const n of NUTRIENTS) {
    if (!goals[n.key] || goals[n.key] <= 0) continue;
    const mealGoal = goals[n.key] / 3;
    const actual = perServing[n.key] || 0;
    const ratio = actual / mealGoal;

    let score;
    if (UNDER_IS_GOOD_SET.has(n.key)) {
      // Under = perfect (100), over = penalize proportionally
      score = ratio <= 1 ? 1 : Math.max(0, 2 - ratio);
    } else {
      // Over = perfect (100), under = proportional
      score = ratio >= 1 ? 1 : ratio;
    }
    scores.push(score);
  }

  if (scores.length === 0) return null;

  const avg = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100);

  // Color based on score
  let color, label;
  if (avg >= 85) { color = 'var(--color-success, #16a34a)'; label = 'Great'; }
  else if (avg >= 65) { color = 'var(--color-accent, #C96442)'; label = 'Good'; }
  else if (avg >= 45) { color = '#D4A574'; label = 'Fair'; }
  else { color = 'var(--color-danger, #dc2626)'; label = 'Poor'; }

  // SVG ring (compact for inline header)
  const size = 40, stroke = 4, r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - avg / 100);

  return (
    <div className={styles.mealScore} title={`Meal Score: ${avg} — ${label}`}>
      <svg width={size} height={size} className={styles.scoreRing}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border-light, #F0EBE4)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
          fill={color} fontSize="13" fontWeight="700">
          {avg}
        </text>
      </svg>
      <span className={styles.scoreLabel}>{label}</span>
    </div>
  );
}

function NutrientGroup({ title, keys, totals, perServing, showPerServing }) {
  return (
    <div className={styles.group}>
      <h4 className={styles.groupTitle}>{title}</h4>
      {keys.map(key => {
        const n = NUTRIENTS.find(x => x.key === key);
        return (
          <NutrientRow
            key={key}
            nutrient={n}
            total={totals[key]}
            perServing={perServing[key]}
            showPerServing={showPerServing}
          />
        );
      })}
    </div>
  );
}

const NUTRITION_CACHE_KEY = 'sunday-nutrition-cache';
const CACHE_VERSION_KEY = 'sunday-nutrition-cache-version';
const CACHE_VERSION = 7; // bump to invalidate all cached nutrition

// One-time cache bust when version changes
try {
  if (Number(localStorage.getItem(CACHE_VERSION_KEY)) !== CACHE_VERSION) {
    localStorage.removeItem(NUTRITION_CACHE_KEY);
    localStorage.setItem(CACHE_VERSION_KEY, String(CACHE_VERSION));
  }
} catch { /* ignore */ }

function loadCachedNutrition(recipeId) {
  try {
    const cache = JSON.parse(localStorage.getItem(NUTRITION_CACHE_KEY) || '{}');
    return cache[recipeId] || null;
  } catch {
    return null;
  }
}

function saveCachedNutrition(recipeId, data, fingerprint) {
  try {
    const cache = JSON.parse(localStorage.getItem(NUTRITION_CACHE_KEY) || '{}');
    cache[recipeId] = { data, fingerprint };
    localStorage.setItem(NUTRITION_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage full
  }
}

const BREAKDOWN_STORAGE_KEY = 'sunday-breakdown-columns';
const DEFAULT_BREAKDOWN_COLS = ['calories', 'protein', 'carbs', 'fat', 'fiber'];

function IngredientBreakdown({ items, totals }) {
  const [selectedCols, setSelectedCols] = useState(() => {
    try {
      const saved = localStorage.getItem(BREAKDOWN_STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_BREAKDOWN_COLS;
    } catch { return DEFAULT_BREAKDOWN_COLS; }
  });
  const [showPicker, setShowPicker] = useState(false);

  function toggleCol(key) {
    setSelectedCols(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      localStorage.setItem(BREAKDOWN_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const visibleNutrients = NUTRIENTS.filter(n => selectedCols.includes(n.key));

  return (
    <details className={styles.details}>
      <summary>Per-ingredient breakdown</summary>
      <div className={styles.breakdownControls}>
        <button className={styles.colPickerBtn} onClick={() => setShowPicker(p => !p)}>
          {showPicker ? 'Done' : 'Choose columns'}
        </button>
        {showPicker && (
          <div className={styles.colPickerGrid}>
            {NUTRIENTS.map(n => (
              <label key={n.key} className={styles.colPickerLabel}>
                <input type="checkbox" checked={selectedCols.includes(n.key)} onChange={() => toggleCol(n.key)} />
                {n.label}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Ingredient</th>
              {visibleNutrients.map(n => (
                <th key={n.key}>{n.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td className={styles.ingredientCell}>
                  <span>{item.matchedTo}</span>
                  <span className={styles.matchNote}>
                    {item.name.toLowerCase()} ({item.grams}g)
                  </span>
                </td>
                {visibleNutrients.map(n => (
                  <td key={n.key}>
                    {item.nutrients[n.key]}{n.unit}
                  </td>
                ))}
              </tr>
            ))}
            <tr className={styles.totalRow}>
              <td><strong>Total</strong></td>
              {visibleNutrients.map(n => (
                <td key={n.key}>
                  <strong>{totals[n.key]}{n.unit}</strong>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function NutritionPanel({ recipeId, ingredients, servings = 1, portionLabel, onViewSources, onNutritionData, weighPortionContent }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showPerServing, setShowPerServing] = useState(true);
  const debounceRef = useRef(null);
  const mountedRef = useRef(false);

  const ingredientFingerprint = useMemo(() => {
    if (!ingredients || ingredients.length === 0) return '';
    return ingredients
      .filter(row => (row.ingredient || '').trim())
      .map(row => `${row.quantity}|${row.measurement}|${row.ingredient}`)
      .join(';;');
  }, [ingredients]);

  async function calculate() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchNutritionForRecipe(ingredients);
      setData(result);
      if (recipeId) saveCachedNutrition(recipeId, result, ingredientFingerprint);
    } catch (err) {
      setError('Failed to fetch nutrition data. Try again later.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (data && onNutritionData) onNutritionData(data);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const goals = useMemo(() => {
    try {
      const raw = localStorage.getItem(GOALS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, []);

  useEffect(() => {
    if (!ingredientFingerprint) return;

    // On first mount, try cache
    if (!mountedRef.current) {
      mountedRef.current = true;
      const cached = recipeId ? loadCachedNutrition(recipeId) : null;
      if (cached && cached.fingerprint === ingredientFingerprint) {
        setData(cached.data);
        return;
      }
      calculate();
      return;
    }

    // On subsequent changes, debounce recalculation
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      calculate();
    }, 800);

    return () => clearTimeout(debounceRef.current);
  }, [ingredientFingerprint]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || loading) {
    return (
      <div className={styles.container}>
        <h3>Nutrition</h3>
        {loading && <p className={styles.loading}>Looking up ingredients...</p>}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  const { items, totals: rawTotals } = data;

  // Separate main vs per-meal (topping) ingredient nutrients
  // Per-meal ingredients are applied per serving, not divided
  const mainTotals = {};
  const toppingTotals = {};
  for (const n of NUTRIENTS) {
    mainTotals[n.key] = 0;
    toppingTotals[n.key] = 0;
  }
  const filteredIngredients = (ingredients || []).filter(row => (row.ingredient || '').trim());
  items.forEach((item, i) => {
    const isTopping = filteredIngredients[i]?.topping;
    for (const n of NUTRIENTS) {
      if (isTopping) {
        toppingTotals[n.key] += item.nutrients[n.key] || 0;
      } else {
        mainTotals[n.key] += item.nutrients[n.key] || 0;
      }
    }
  });

  // Total recipe = main ingredients + (topping × servings)
  const totals = {};
  for (const n of NUTRIENTS) {
    totals[n.key] = Math.round((mainTotals[n.key] + toppingTotals[n.key] * servings) * 100) / 100;
  }

  // Per serving = (main / servings) + topping
  const perServing = {};
  for (const n of NUTRIENTS) {
    const val = (servings > 0 ? mainTotals[n.key] / servings : mainTotals[n.key]) + toppingTotals[n.key];
    perServing[n.key] = Math.round(val);
  }

  return (
    <div className={styles.container}>
      <div className={styles.nutritionHeader}>
        <h3>Nutrition <span className={styles.estimate}>(estimate)</span></h3>
        <MealScore totals={totals} servings={servings} />
      </div>

      {(servings > 1 || portionLabel) && (
        <div className={styles.servingsToggle}>
          <button
            className={`${styles.toggleBtn} ${showPerServing ? styles.toggleActive : ''}`}
            onClick={() => setShowPerServing(true)}
          >
            {portionLabel || 'Per serving'}
          </button>
          <button
            className={`${styles.toggleBtn} ${!showPerServing ? styles.toggleActive : ''}`}
            onClick={() => setShowPerServing(false)}
          >
            Total recipe
          </button>
        </div>
      )}

      <div className={styles.groups}>
        <NutrientGroup title="Macros" keys={MACROS} totals={totals} perServing={perServing} showPerServing={showPerServing && (servings > 1 || !!portionLabel)} />
        <NutrientGroup title="Sugars & Fiber" keys={SUGARS_FIBER} totals={totals} perServing={perServing} showPerServing={showPerServing && (servings > 1 || !!portionLabel)} />
        <NutrientGroup title="Minerals" keys={MINERALS} totals={totals} perServing={perServing} showPerServing={showPerServing && (servings > 1 || !!portionLabel)} />
        <NutrientGroup title="Vitamins & Aminos" keys={VITAMINS_AMINOS} totals={totals} perServing={perServing} showPerServing={showPerServing && (servings > 1 || !!portionLabel)} />
        <NutrientGroup title="Other" keys={OTHER} totals={totals} perServing={perServing} showPerServing={showPerServing && (servings > 1 || !!portionLabel)} />
      </div>

      {weighPortionContent}

      {goals && (() => {
        const SHOW_CONTRIBUTORS = ['calories', 'carbs', 'fat', 'sugar', 'addedSugar', 'saturatedFat', 'sodium'];
        // Nutrients where UNDER goal is good (green), OVER is bad (red)
        const UNDER_IS_GOOD = new Set(['calories', 'carbs', 'fat', 'saturatedFat', 'sugar', 'addedSugar', 'fiber', 'sodium', 'potassium']);
        // Everything else: OVER goal is good (green), UNDER is bad (red)
        const usePerServing = showPerServing && (servings > 1 || !!portionLabel);
        // Build lookup: ingredient name → quantity + measurement
        const ingLookup = {};
        if (ingredients) {
          for (const ing of ingredients) {
            const key = (ing.ingredient || '').trim().toLowerCase();
            if (key) ingLookup[key] = { qty: ing.quantity || '', meas: ing.measurement || '' };
          }
        }
        const overItems = [];
        const goalRows = NUTRIENTS.filter(n => goals[n.key] > 0).map(n => {
          const mealGoal = goals[n.key] / 3;
          const actual = usePerServing ? perServing[n.key] : totals[n.key];
          const pct = Math.round((actual / mealGoal) * 100);
          if (pct > 100 && SHOW_CONTRIBUTORS.includes(n.key) && items.length > 0) {
            const sorted = [...items]
              .map((it, idx) => {
                const isTopping = filteredIngredients[idx]?.topping;
                const raw = it.nutrients[n.key] || 0;
                // Per-meal (topping) items are already per-serving, main items get divided
                const val = usePerServing ? (isTopping ? raw : raw / servings) : (isTopping ? raw * servings : raw);
                const look = ingLookup[(it.matchedTo || '').trim().toLowerCase()] || {};
                return { name: it.matchedTo, val, qty: look.qty, meas: look.meas, unit: n.unit };
              })
              .filter(x => x.val > 0)
              .sort((a, b) => b.val - a.val)
              .slice(0, 3);
            overItems.push({ label: n.label, pct, contributors: sorted });
          }
          return { ...n, mealGoal, actual, pct };
        });
        return (
          <details className={styles.details}>
            <summary>Meal %</summary>
            <div className={styles.goalLayout}>
              <div className={styles.goalTable}>
                {goalRows.map(n => {
                  let barColor;
                  if (UNDER_IS_GOOD.has(n.key)) {
                    // Under = green, over = red
                    barColor = n.pct <= 100 ? styles.progressGreen : n.pct <= 130 ? styles.progressYellow : styles.progressRed;
                  } else {
                    // Over = green, under = red
                    barColor = n.pct >= 100 ? styles.progressGreen : n.pct >= 70 ? styles.progressYellow : styles.progressRed;
                  }
                  return (
                    <div key={n.key} className={styles.goalRow}>
                      <span className={styles.goalLabel}>{n.label}</span>
                      <div className={styles.goalBar}>
                        <div
                          className={`${styles.goalFill} ${barColor}`}
                          style={{ width: `${Math.min(n.pct, 100)}%` }}
                        />
                      </div>
                      <span className={styles.goalPct}>{n.pct}%</span>
                      <span className={styles.goalValues}>
                        {n.actual}{n.unit} / {Math.round(n.mealGoal * 10) / 10}{n.unit}
                      </span>
                    </div>
                  );
                })}
              </div>
              {overItems.length > 0 && (
                <div className={styles.contribPanel}>
                  <h4 className={styles.contribTitle}>Over 100%</h4>
                  {overItems.map(item => (
                    <div key={item.label} className={styles.contribSection}>
                      <span className={styles.contribNutrient}>{item.label} ({item.pct}%)</span>
                      <table className={styles.contribTable}>
                        <thead>
                          <tr>
                            <th>Ingredient</th>
                            <th>Amount</th>
                            <th>{item.contributors[0]?.unit || ''}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.contributors.map(c => (
                            <tr key={c.name}>
                              <td>{c.name}</td>
                              <td>{c.qty}{c.meas ? ` ${c.meas}` : ''}</td>
                              <td>{Math.round(c.val)}{c.unit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        );
      })()}

      <IngredientBreakdown items={items} totals={totals} />

      <p className={styles.disclaimer}>
        Nutrition data from USDA FoodData Central, Open Food Facts, and Canadian Nutrient File. Values are estimates based on approximate unit conversions.
        {onViewSources && (
          <>
            {' '}
            <button className={styles.sourcesLink} onClick={onViewSources}>View all sources</button>
          </>
        )}
      </p>
    </div>
  );
}
