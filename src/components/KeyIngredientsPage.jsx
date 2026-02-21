import { useMemo } from 'react';
import styles from './KeyIngredientsPage.module.css';

const KEY_INGREDIENTS = [
  'almonds',
  'avocado',
  'beets',
  'bell_pepper',
  'black_beans',
  'blueberries',
  'broccoli',
  'brown_rice',
  'brussels_sprouts',
  'carrots_baby',
  'cauliflower',
  'chicken_breast',
  'chickpeas',
  'cottage_cheese',
  'edamame',
  'eggs',
  'garlic',
  'ginger',
  'greek_yogurt',
  'green_beans',
  'kale',
  'lentils',
  'mushrooms',
  'oats',
  'onion',
  'peanut_butter',
  'peas',
  'potatoes',
  'quinoa',
  'salmon',
  'sardines',
  'shrimp',
  'spinach',
  'strawberries',
  'sweet_potato',
  'tempeh',
  'tofu',
  'tomatoes',
  'tuna',
  'turkey_breast',
  'walnuts',
  'whole_wheat_pasta',
  'zucchini',
];

const HISTORY_KEY = 'sunday-plan-history';

/** Normalize a string for fuzzy matching */
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\(.*?\)/g, '')
    .trim();
}

/** Format an ingredient key for display */
function displayName(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
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

/** Check if a recipe contains a key ingredient */
function recipeHasIngredient(recipe, normKey) {
  if (!recipe || !recipe.ingredients) return false;
  return recipe.ingredients.some(ing => {
    const normIng = normalize(ing.ingredient || '');
    return normIng && (normIng.includes(normKey) || normKey.includes(normIng));
  });
}

export function KeyIngredientsPage({ recipes, getRecipe, onClose }) {
  const { sorted, lastEatenMap, mealsMap, neverCount } = useMemo(() => {
    const history = loadHistory();
    const byRecent = [...history].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    const dateMap = {};
    const meals = {};
    for (const keyIng of KEY_INGREDIENTS) {
      const normKey = normalize(keyIng);
      dateMap[keyIng] = null;

      // Find last-eaten date from history
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

      // Find all recipes that contain this ingredient
      meals[keyIng] = recipes
        .filter(r => recipeHasIngredient(r, normKey))
        .map(r => r.title);
    }

    const sortedKeys = KEY_INGREDIENTS.slice().sort((a, b) => {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>
          &larr; Back
        </button>
        <h2 className={styles.title}>Key Ingredients</h2>
        <span className={styles.count}>
          {neverCount} of {KEY_INGREDIENTS.length} never eaten
        </span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Last Eaten</th>
              <th>Days Since</th>
              <th>Meals</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(key => {
              const date = lastEatenMap[key];
              const days = date ? daysSince(date) : null;
              const meals = mealsMap[key] || [];
              return (
                <tr key={key}>
                  <td className={styles.ingredientName}>{displayName(key)}</td>
                  <td>
                    {date ? (
                      <span className={styles.date}>{date}</span>
                    ) : (
                      <span className={styles.never}>Never</span>
                    )}
                  </td>
                  <td>
                    {days !== null ? (
                      <span className={styles.days}>{days}</span>
                    ) : (
                      <span className={styles.never}>&mdash;</span>
                    )}
                  </td>
                  <td>
                    {meals.length > 0 ? (
                      <ul className={styles.mealsList}>
                        {meals.map(title => (
                          <li key={title}>{title}</li>
                        ))}
                      </ul>
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
    </div>
  );
}
