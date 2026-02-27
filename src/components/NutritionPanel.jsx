import { useState, useEffect, useMemo } from 'react';
import { fetchNutritionForRecipe, NUTRIENTS } from '../utils/nutrition';
import styles from './NutritionPanel.module.css';

const GOALS_KEY = 'sunday-nutrition-goals';

const MACROS = ['calories', 'protein', 'carbs', 'fat', 'saturatedFat'];
const SUGARS_FIBER = ['sugar', 'addedSugar', 'fiber'];
const MINERALS = ['sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'zinc'];
const VITAMINS_AMINOS = ['vitaminB12', 'vitaminC', 'leucine'];

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
      ? Math.round((val / servings) * 10) / 10
      : val;
  }
  return result;
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
const CACHE_VERSION = 4; // bump to invalidate all cached nutrition

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

function saveCachedNutrition(recipeId, data) {
  try {
    const cache = JSON.parse(localStorage.getItem(NUTRITION_CACHE_KEY) || '{}');
    cache[recipeId] = data;
    localStorage.setItem(NUTRITION_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage full
  }
}

export function NutritionPanel({ recipeId, ingredients, servings = 1 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showPerServing, setShowPerServing] = useState(true);

  async function calculate() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchNutritionForRecipe(ingredients);
      setData(result);
      if (recipeId) saveCachedNutrition(recipeId, result);
    } catch (err) {
      setError('Failed to fetch nutrition data. Try again later.');
    } finally {
      setLoading(false);
    }
  }

  const goals = useMemo(() => {
    try {
      const raw = localStorage.getItem(GOALS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, []);

  useEffect(() => {
    if (!ingredients || ingredients.length === 0) return;
    const cached = recipeId ? loadCachedNutrition(recipeId) : null;
    if (cached) {
      setData(cached);
    } else {
      calculate();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || loading) {
    return (
      <div className={styles.container}>
        <h3>Nutrition</h3>
        {loading && <p className={styles.loading}>Looking up ingredients...</p>}
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  const { items, totals } = data;
  const perServing = divideNutrients(totals, servings);

  return (
    <div className={styles.container}>
      <h3>Nutrition <span className={styles.estimate}>(estimate)</span></h3>

      {servings > 1 && (
        <div className={styles.servingsToggle}>
          <button
            className={`${styles.toggleBtn} ${showPerServing ? styles.toggleActive : ''}`}
            onClick={() => setShowPerServing(true)}
          >
            Per serving ({servings} servings)
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
        <NutrientGroup title="Macros" keys={MACROS} totals={totals} perServing={perServing} showPerServing={showPerServing && servings > 1} />
        <NutrientGroup title="Sugars & Fiber" keys={SUGARS_FIBER} totals={totals} perServing={perServing} showPerServing={showPerServing && servings > 1} />
        <NutrientGroup title="Minerals" keys={MINERALS} totals={totals} perServing={perServing} showPerServing={showPerServing && servings > 1} />
        <NutrientGroup title="Vitamins & Aminos" keys={VITAMINS_AMINOS} totals={totals} perServing={perServing} showPerServing={showPerServing && servings > 1} />
      </div>

      {goals && (
        <details className={styles.details}>
          <summary>% of Meal Goal (1/3 daily)</summary>
          <div className={styles.goalTable}>
            {NUTRIENTS.filter(n => goals[n.key] > 0).map(n => {
              const mealGoal = goals[n.key] / 3;
              const actual = showPerServing && servings > 1 ? perServing[n.key] : totals[n.key];
              const pct = Math.round((actual / mealGoal) * 100);
              const barColor = pct <= 100 ? styles.progressGreen : pct <= 130 ? styles.progressYellow : styles.progressRed;
              return (
                <div key={n.key} className={styles.goalRow}>
                  <span className={styles.goalLabel}>{n.label}</span>
                  <div className={styles.goalBar}>
                    <div
                      className={`${styles.goalFill} ${barColor}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <span className={styles.goalPct}>{pct}%</span>
                  <span className={styles.goalValues}>
                    {actual}{n.unit} / {Math.round(mealGoal * 10) / 10}{n.unit}
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}

      <details className={styles.details}>
        <summary>Per-ingredient breakdown</summary>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ingredient</th>
                {NUTRIENTS.map(n => (
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
                  {NUTRIENTS.map(n => (
                    <td key={n.key}>
                      {item.nutrients[n.key]}{n.unit}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className={styles.totalRow}>
                <td><strong>Total</strong></td>
                {NUTRIENTS.map(n => (
                  <td key={n.key}>
                    <strong>{totals[n.key]}{n.unit}</strong>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <button className={styles.recalcBtn} onClick={calculate}>
        Recalculate
      </button>

      <p className={styles.disclaimer}>
        Nutrition data from USDA FoodData Central. Values are estimates based on approximate unit conversions.
      </p>
    </div>
  );
}
