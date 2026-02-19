import { useState } from 'react';
import { fetchNutritionForRecipe, NUTRIENTS } from '../utils/nutrition';
import styles from './NutritionPanel.module.css';

const MACROS = ['calories', 'protein', 'carbs', 'fat', 'saturatedFat'];
const SUGARS_FIBER = ['sugar', 'addedSugar', 'fiber'];
const MINERALS = ['sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'zinc'];
const VITAMINS_AMINOS = ['vitaminB12', 'vitaminC', 'leucine'];

function NutrientRow({ nutrient, value }) {
  return (
    <div className={styles.nutrientRow}>
      <span className={styles.nutrientLabel}>{nutrient.label}</span>
      <span className={styles.nutrientValue}>
        {value}{nutrient.unit}
      </span>
    </div>
  );
}

function NutrientGroup({ title, keys, totals }) {
  return (
    <div className={styles.group}>
      <h4 className={styles.groupTitle}>{title}</h4>
      {keys.map(key => {
        const n = NUTRIENTS.find(x => x.key === key);
        return <NutrientRow key={key} nutrient={n} value={totals[key]} />;
      })}
    </div>
  );
}

export function NutritionPanel({ ingredients }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function calculate() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchNutritionForRecipe(ingredients);
      setData(result);
    } catch (err) {
      setError('Failed to fetch nutrition data. Try again later.');
    } finally {
      setLoading(false);
    }
  }

  if (!data && !loading) {
    return (
      <div className={styles.container}>
        <h3>Nutrition</h3>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.calcBtn} onClick={calculate}>
          Calculate Nutrition
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.container}>
        <h3>Nutrition</h3>
        <p className={styles.loading}>Looking up ingredients...</p>
      </div>
    );
  }

  const { items, totals } = data;

  return (
    <div className={styles.container}>
      <h3>Nutrition <span className={styles.estimate}>(estimate)</span></h3>

      <div className={styles.groups}>
        <NutrientGroup title="Macros" keys={MACROS} totals={totals} />
        <NutrientGroup title="Sugars & Fiber" keys={SUGARS_FIBER} totals={totals} />
        <NutrientGroup title="Minerals" keys={MINERALS} totals={totals} />
        <NutrientGroup title="Vitamins & Aminos" keys={VITAMINS_AMINOS} totals={totals} />
      </div>

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
