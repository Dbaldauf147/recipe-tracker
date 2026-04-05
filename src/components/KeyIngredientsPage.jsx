import { useMemo, useState, useEffect } from 'react';
import { getUserKeyIngredients, saveUserKeyIngredients, normalize, recipeHasIngredient, displayName } from '../utils/keyIngredients';
import { locationToRegion, getSeasonalIngredients } from '../utils/seasonal';
import SEASONAL_DATA from '../data/seasonalIngredients.js';
import { lookupSeasonalData } from '../utils/seasonalCache';
import styles from './KeyIngredientsPage.module.css';

const HISTORY_KEY = 'sunday-plan-history';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format an array of month numbers (1-12) into a readable range like "Jun – Sep" */
function formatMonthRange(months) {
  if (!months || months.length === 0) return null;
  const sorted = [...months].sort((a, b) => a - b);
  return `${MONTH_ABBR[sorted[0] - 1]} – ${MONTH_ABBR[sorted[sorted.length - 1] - 1]}`;
}

/** Calculate days between a date string (YYYY-MM-DD) and today */
function daysSince(dateStr) {
  const then = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((now - then) / (1000 * 60 * 60 * 24));
}

function loadHistory() {
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function KeyIngredientsPage({ recipes, getRecipe, onClose, onSetup }) {
  const [userIngredients, setUserIngredients] = useState(getUserKeyIngredients);
  const [addValue, setAddValue] = useState('');

  function handleRemove(key) {
    const next = userIngredients.filter(k => k !== key);
    saveUserKeyIngredients(next);
    setUserIngredients(next);
  }

  function handleAdd() {
    const raw = addValue.trim();
    if (!raw) return;
    const key = raw.toLowerCase().replace(/\s+/g, '_');
    if (userIngredients.some(k => normalize(k) === normalize(key))) {
      setAddValue('');
      return;
    }
    const next = [...userIngredients, key];
    saveUserKeyIngredients(next);
    setUserIngredients(next);
    setAddValue('');
  }

  // Get seasonal ingredients for user's region
  const seasonalSet = useMemo(() => {
    try {
      const location = localStorage.getItem('sunday-seasonal-location') || '';
      const region = locationToRegion(location);
      if (!region) return new Set();
      const month = new Date().getMonth() + 1;
      return getSeasonalIngredients(region, month);
    } catch {
      return new Set();
    }
  }, []);

  const { sorted, lastEatenMap, mealsMap, neverCount } = useMemo(() => {
    const history = loadHistory();
    const byRecent = [...history].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    // Also load daily tracker log
    let dailyLog = {};
    try {
      const raw = localStorage.getItem('sunday-daily-log');
      dailyLog = raw ? JSON.parse(raw) : {};
    } catch {}

    const dateMap = {};
    const meals = {};
    for (const keyIng of userIngredients) {
      const normKey = normalize(keyIng);
      dateMap[keyIng] = null;

      // Find last-eaten date from plan history
      for (const entry of byRecent) {
        if (dateMap[keyIng]) break;
        for (const recipeId of entry.recipeIds) {
          if (dateMap[keyIng]) break;
          const recipe = getRecipe(recipeId);
          if (recipeHasIngredient(recipe, normKey)) {
            dateMap[keyIng] = entry.date;
          }
        }
      }

      // Also check daily tracker entries for more recent dates
      for (const [dateStr, dayData] of Object.entries(dailyLog)) {
        for (const entry of (dayData.entries || [])) {
          if (entry.type === 'recipe' && entry.recipeId) {
            const recipe = getRecipe(entry.recipeId);
            if (recipe && recipeHasIngredient(recipe, normKey)) {
              if (!dateMap[keyIng] || dateStr > dateMap[keyIng]) {
                dateMap[keyIng] = dateStr;
              }
            }
          }
        }
      }

      // Find all recipes that contain this ingredient
      meals[keyIng] = recipes
        .filter(r => recipeHasIngredient(r, normKey))
        .map(r => r.title);
    }

    const sortedKeys = userIngredients.slice().sort((a, b) => {
      const dateA = dateMap[a];
      const dateB = dateMap[b];
      if (!dateA && !dateB) return a.localeCompare(b);
      if (!dateA) return -1;
      if (!dateB) return 1;
      return dateA.localeCompare(dateB);
    });

    return {
      sorted: sortedKeys,
      lastEatenMap: dateMap,
      mealsMap: meals,
      neverCount: sortedKeys.filter(k => !dateMap[k]).length,
    };
  }, [recipes, userIngredients]);

  // Get the user's region for seasonal lookups
  const userRegion = useMemo(() => {
    try {
      const location = localStorage.getItem('sunday-seasonal-location') || '';
      return locationToRegion(location);
    } catch {
      return null;
    }
  }, []);

  // Hybrid seasonal lookup: static data + cached AI lookups
  const [seasonalLookup, setSeasonalLookup] = useState({});

  useEffect(() => {
    if (!userRegion || userIngredients.length === 0) return;
    const names = userIngredients.map(k => k.replace(/_/g, ' '));
    lookupSeasonalData(names, userRegion).then(result => {
      setSeasonalLookup(result);
    });
  }, [userRegion, userIngredients]);

  function isInSeason(ingredientKey) {
    const currentMonth = new Date().getMonth() + 1;
    const norm = normalize(ingredientKey);
    // Check hybrid lookup first
    const months = seasonalLookup[norm];
    if (months && months.length > 0) return months.includes(currentMonth);
    // Fall back to static seasonalSet
    if (seasonalSet.size === 0) return false;
    for (const s of seasonalSet) {
      if (normalize(s) === norm || norm.includes(normalize(s)) || normalize(s).includes(norm)) {
        return true;
      }
    }
    return false;
  }

  /** Get the season month range string for an ingredient, or null */
  function getSeasonText(ingredientKey) {
    const norm = normalize(ingredientKey);
    // Check hybrid lookup first
    const months = seasonalLookup[norm];
    if (months && months.length > 0) return formatMonthRange(months);
    // Fall back to static data
    if (!userRegion) return null;
    const regionData = SEASONAL_DATA[userRegion];
    if (!regionData) return null;
    for (const [name, m] of Object.entries(regionData)) {
      const normName = normalize(name);
      if (normName === norm || norm.includes(normName) || normName.includes(norm)) {
        return formatMonthRange(m);
      }
    }
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>
          &larr; Back
        </button>
        <h2 className={styles.title}>Healthy Foods</h2>
        <span className={styles.count}>
          {neverCount} of {userIngredients.length} never eaten
        </span>
        <button className={styles.setupBtn} onClick={onSetup}>
          Edit Healthy Foods
        </button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.colRemove}></th>
              <th className={styles.colIngredient}>Ingredient</th>
              <th className={styles.colSeason}>Season</th>
              <th className={styles.colDays}>Days Since</th>
              <th className={styles.colMeals}>Meals</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(key => {
              const date = lastEatenMap[key];
              const days = date ? daysSince(date) : null;
              const meals = mealsMap[key] || [];
              const seasonal = isInSeason(key);
              const seasonText = getSeasonText(key);
              return (
                <tr key={key} className={seasonal ? styles.seasonalRow : undefined}>
                  <td className={styles.removeCell}>
                    <button
                      className={styles.removeBtn}
                      onClick={() => handleRemove(key)}
                      title="Remove ingredient"
                    >
                      &times;
                    </button>
                  </td>
                  <td className={styles.ingredientName}>
                    {displayName(key)}
                    {seasonal && <span className={styles.seasonalBadge} title="In season">In Season</span>}
                  </td>
                  <td className={seasonText ? styles.seasonText : styles.never}>
                    {seasonText || '\u2014'}
                  </td>
                  <td>
                    {days !== null ? (
                      <span className={`${styles.days} ${days >= 14 ? styles.daysOverdue : ''}`}>{days}</span>
                    ) : (
                      <span className={styles.never}>&mdash;</span>
                    )}
                  </td>
                  <td className={styles.meals}>
                    {meals.length > 0 ? (
                      meals.join(', ')
                    ) : (
                      <span className={styles.never}>None</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.addRow}>
        <input
          className={styles.addInput}
          type="text"
          placeholder="Add key ingredient…"
          value={addValue}
          onChange={e => setAddValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
        />
        <button className={styles.addBtn} onClick={handleAdd}>
          Add
        </button>
      </div>
    </div>
  );
}
