import React, { useMemo, useState } from 'react';
import { NUTRIENTS, NUTRIENT_BY_KEY } from '../utils/nutrients.js';
import { loadIngredients } from '../utils/ingredientsStore.js';
import { BASES, recipeVector, ingredientVector, rankItems } from '../utils/nutrientRank.js';
import styles from './NutrientSearchPage.module.css';

// Gear menu → Nutrient Search: which meals / ingredients have the most (or
// least) of a nutrient, per serving, per 100 calories or per 100 g.

const PAGE = 50;
// The derived "servings" counters aren't nutrients you'd rank by density.
const SKIP = new Set(['fermentedServings', 'omega3Servings']);

function fmt(value, key, basis) {
  const n = NUTRIENT_BY_KEY[key];
  // Ratios are small numbers — keep a decimal more than the plain value.
  const decimals = Math.min(3, (n?.decimals ?? 1) + (basis === 'serving' ? 0 : 1));
  const s = Number(value).toLocaleString(undefined, { maximumFractionDigits: decimals });
  return n?.unit ? `${s} ${n.unit}` : s;
}

const cal = v => (v?.calories != null ? Math.round(v.calories) : '—');
const grams = (v, k) => (v?.[k] != null ? `${Math.round(v[k] * 10) / 10} g` : '—');

export function NutrientSearchPage({ recipes, onViewRecipe, onClose }) {
  const [kind, setKind] = useState('meals');
  const [nutrient, setNutrient] = useState('protein');
  const [basis, setBasis] = useState('serving');
  const [order, setOrder] = useState('desc');
  const [query, setQuery] = useState('');
  const [minCalories, setMinCalories] = useState('');
  const [shown, setShown] = useState(PAGE);

  const meals = useMemo(() => (recipes || []).map(r => ({
    id: r.id, name: r.title || 'Untitled', vec: recipeVector(r),
  })), [recipes]);
  const ingredients = useMemo(() => (loadIngredients() || [])
    .filter(row => String(row?.ingredient || '').trim())
    .map((row, i) => ({
      id: `${row.ingredient}-${i}`,
      name: row.ingredient,
      unit: [row.measurement ? `1 ${row.measurement}` : '', row.grams ? `${row.grams} g` : ''].filter(Boolean).join(' · '),
      vec: ingredientVector(row),
    })), []);

  const items = kind === 'meals' ? meals : ingredients;
  const missing = items.filter(it => !it.vec).length;
  const ranked = useMemo(
    () => rankItems(items, { nutrient, basis, order, query, minCalories }),
    [items, nutrient, basis, order, query, minCalories],
  );
  const withData = items.length - missing;
  const unranked = withData - ranked.length;

  const reset = fn => v => { fn(v); setShown(PAGE); };
  const label = NUTRIENT_BY_KEY[nutrient]?.label || nutrient;
  const nutrientOptions = NUTRIENTS.filter(n => !SKIP.has(n.key) && !(basis === 'per100cal' && n.key === 'calories'));

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>&larr; Back</button>
        <h2 className={styles.title}>Nutrient Search</h2>
      </div>
      <p className={styles.intro}>
        Find the meals and ingredients with the most of a nutrient — per serving, or per 100 calories to see which give you the most for the calories.
      </p>

      <div className={styles.tabs} role="tablist">
        {[['meals', 'Meals'], ['ingredients', 'Ingredients']].map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            className={`${styles.tab} ${kind === k ? styles.tabActive : ''}`}
            onClick={() => reset(setKind)(k)}
          >{l}</button>
        ))}
      </div>

      <div className={styles.controls}>
        <label className={styles.field}>
          <span>Nutrient</span>
          <select value={nutrient} onChange={e => reset(setNutrient)(e.target.value)}>
            {nutrientOptions.map(n => <option key={n.key} value={n.key}>{n.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>Measure</span>
          <select
            value={basis}
            onChange={e => {
              const b = e.target.value;
              if (b === 'per100cal' && nutrient === 'calories') setNutrient('protein');
              reset(setBasis)(b);
            }}
          >
            {Object.entries(BASES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>Show</span>
          <select value={order} onChange={e => reset(setOrder)(e.target.value)}>
            <option value="desc">Highest first</option>
            <option value="asc">Lowest first</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Min calories</span>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            placeholder="0"
            value={minCalories}
            onChange={e => reset(setMinCalories)(e.target.value)}
            className={styles.minCal}
          />
        </label>
        <label className={`${styles.field} ${styles.searchField}`}>
          <span>Search</span>
          <input
            type="search"
            placeholder={kind === 'meals' ? 'Filter meals by name' : 'Filter ingredients by name'}
            value={query}
            onChange={e => reset(setQuery)(e.target.value)}
          />
        </label>
      </div>

      <p className={styles.summary}>
        {ranked.length} {kind === 'meals' ? 'meals' : 'ingredients'} ranked by {label.toLowerCase()} {BASES[basis]}
        {basis === 'per100cal' && !Number(minCalories) && ' — tip: set Min calories to hide near-zero-calorie items like spices'}
      </p>

      {ranked.length === 0 ? (
        <p className={styles.empty}>Nothing to rank with these settings.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.rank}>#</th>
                <th>{kind === 'meals' ? 'Meal' : 'Ingredient'}</th>
                <th className={styles.num}>{label} <span className={styles.basis}>{BASES[basis]}</span></th>
                <th className={styles.num}>Cal</th>
                <th className={`${styles.num} ${styles.ctx}`}>Protein</th>
                <th className={`${styles.num} ${styles.ctx}`}>Fiber</th>
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, shown).map((it, i) => (
                <tr key={it.id}>
                  <td className={styles.rank}>{i + 1}</td>
                  <td>
                    {kind === 'meals' && onViewRecipe ? (
                      <button className={styles.nameBtn} onClick={() => onViewRecipe(it.id)}>{it.name}</button>
                    ) : (
                      <span className={styles.name}>{it.name}</span>
                    )}
                    {it.unit && <span className={styles.unit}>per {it.unit}</span>}
                  </td>
                  <td className={`${styles.num} ${styles.value}`}>{fmt(it.value, nutrient, basis)}</td>
                  <td className={styles.num}>{cal(it.vec)}</td>
                  <td className={`${styles.num} ${styles.ctx}`}>{grams(it.vec, 'protein')}</td>
                  <td className={`${styles.num} ${styles.ctx}`}>{grams(it.vec, 'fiber')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ranked.length > shown && (
        <button className={styles.moreBtn} onClick={() => setShown(s => s + PAGE)}>
          Show more ({ranked.length - shown} left)
        </button>
      )}

      <p className={styles.footnote}>
        {kind === 'meals'
          ? 'Meals show nutrition per serving, as saved on the recipe.'
          : 'Ingredients show nutrition for one unit, as listed on the Ingredients page.'}
        {missing > 0 && (kind === 'meals'
          ? ` ${missing} ${missing === 1 ? 'meal has' : 'meals have'} no nutrition saved yet, so ${missing === 1 ? 'it isn’t' : 'they aren’t'} listed — opening a recipe works it out.`
          : ` ${missing} ${missing === 1 ? 'ingredient has' : 'ingredients have'} no calories filled in, so ${missing === 1 ? 'it isn’t' : 'they aren’t'} listed.`)}
        {unranked > 0 && !query.trim() && !Number(minCalories) && ` ${unranked} more ${unranked === 1 ? 'has' : 'have'} no ${basis === 'per100g' ? 'weight' : `${label.toLowerCase()} value`} to rank by.`}
      </p>
    </div>
  );
}
