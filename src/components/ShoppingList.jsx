import { useState, useMemo } from 'react';
import styles from './ShoppingList.module.css';

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
  const whole = Math.floor(n);
  const frac = n - whole;
  const fracs = { 0.25: '1/4', 0.333: '1/3', 0.5: '1/2', 0.667: '2/3', 0.75: '3/4' };
  for (const [dec, str] of Object.entries(fracs)) {
    if (Math.abs(frac - parseFloat(dec)) < 0.05) {
      return whole > 0 ? `${whole} ${str}` : str;
    }
  }
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function buildShoppingList(recipes) {
  const map = new Map();
  for (const recipe of recipes) {
    for (const ing of recipe.ingredients) {
      const name = ing.ingredient.toLowerCase().trim();
      if (!name) continue;
      const meas = (ing.measurement || '').toLowerCase().trim();
      const key = `${name}|||${meas}`;
      if (map.has(key)) {
        map.get(key).quantity += parseFraction(ing.quantity);
      } else {
        map.set(key, {
          ingredient: ing.ingredient.trim(),
          measurement: ing.measurement || '',
          quantity: parseFraction(ing.quantity),
        });
      }
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.ingredient.localeCompare(b.ingredient)
  );
}

export function ShoppingList({ weeklyRecipes }) {
  const items = useMemo(
    () => buildShoppingList(weeklyRecipes),
    [weeklyRecipes]
  );

  const [checked, setChecked] = useState(new Set());

  function toggleItem(key) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  if (items.length === 0) return null;

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Shopping List</h2>
      <p className={styles.subtext}>
        {weeklyRecipes.length} recipe{weeklyRecipes.length !== 1 ? 's' : ''} this week
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th></th>
            <th>Qty</th>
            <th>Measurement</th>
            <th>Ingredient</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const key = `${item.ingredient}|||${item.measurement}`;
            const done = checked.has(key);
            return (
              <tr
                key={i}
                className={done ? styles.checkedRow : ''}
                onClick={() => toggleItem(key)}
              >
                <td className={styles.checkCell}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={done}
                    onChange={() => toggleItem(key)}
                    onClick={e => e.stopPropagation()}
                  />
                </td>
                <td className={styles.qtyCell}>{formatQuantity(item.quantity)}</td>
                <td>{item.measurement}</td>
                <td>{item.ingredient}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
