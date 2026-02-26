import { useState, useEffect, useCallback, useRef } from 'react';
import { NUTRIENTS, fetchNutritionForRecipe } from '../utils/nutrition';
import styles from './NutritionGoalsPage.module.css';

function MealCombobox({ index, value, recipes, onSelect, loading }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selectedRecipe = value ? recipes.find(r => r.id === value) : null;

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

  function handlePick(id) {
    onSelect(index, id);
    setQuery('');
    setOpen(false);
  }

  function handleClear() {
    onSelect(index, '');
    setQuery('');
    setOpen(false);
  }

  return (
    <div className={styles.comboWrap} ref={wrapRef}>
      <input
        className={styles.mealInput}
        type="text"
        placeholder="Type to search..."
        value={open ? query : (selectedRecipe?.title || '')}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {selectedRecipe && !open && (
        <button className={styles.comboClear} onClick={handleClear} aria-label="Clear">&times;</button>
      )}
      {open && (
        <div className={styles.comboDropdown}>
          {filtered.length === 0 ? (
            <div className={styles.comboEmpty}>No matches</div>
          ) : (
            filtered.map(r => (
              <div
                key={r.id}
                className={`${styles.comboOption} ${r.id === value ? styles.comboOptionActive : ''}`}
                onMouseDown={() => handlePick(r.id)}
              >
                {r.title}
              </div>
            ))
          )}
        </div>
      )}
      {loading && <span className={styles.loadingText}>Loading…</span>}
    </div>
  );
}

const MACROS = ['calories', 'protein', 'carbs', 'fat', 'saturatedFat'];
const SUGARS_FIBER = ['sugar', 'addedSugar', 'fiber'];
const MINERALS = ['sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'zinc'];
const VITAMINS_AMINOS = ['vitaminB12', 'vitaminC', 'leucine', 'omega3'];

// Custom goals not in the USDA NUTRIENTS list
const CUSTOM_GOALS = [
  { key: 'fermentedFoods', label: 'Fermented Foods', unit: 'servings', decimals: 0 },
];

const GROUPS = [
  { title: 'Macros', keys: MACROS },
  { title: 'Sugars & Fiber', keys: SUGARS_FIBER },
  { title: 'Minerals', keys: MINERALS },
  { title: 'Vitamins & Aminos', keys: VITAMINS_AMINOS },
];

const DEFAULT_TARGETS = {
  calories: 2000,
  protein: 50,
  carbs: 275,
  fat: 78,
  saturatedFat: 20,
  sugar: 50,
  addedSugar: 25,
  fiber: 28,
  sodium: 2300,
  potassium: 4700,
  calcium: 1000,
  iron: 18,
  magnesium: 420,
  zinc: 11,
  vitaminB12: 2.4,
  vitaminC: 90,
  leucine: 2.5,
  omega3: 1.6,
  fermentedFoods: 2,
};

const DEFAULT_SELECTED = new Set(['calories', 'protein', 'carbs', 'fat']);

function computeTargets(gender, heightFt, heightIn, weight, age) {
  const kg = weight / 2.205;
  const cm = (heightFt * 12 + heightIn) * 2.54;

  // Mifflin-St Jeor BMR
  let bmr;
  if (gender === 'male') {
    bmr = (10 * kg) + (6.25 * cm) - (5 * age) + 5;
  } else {
    bmr = (10 * kg) + (6.25 * cm) - (5 * age) - 161;
  }

  const tdee = bmr * 1.55;

  return {
    calories: Math.round(tdee),
    protein: Math.round(weight * 0.8),
    carbs: Math.round((tdee * 0.50) / 4),
    fat: Math.round((tdee * 0.30) / 9),
    saturatedFat: Math.round((tdee * 0.10) / 9),
    sugar: Math.round(tdee * 0.025),
    addedSugar: 25,
    fiber: Math.round(tdee / 1000 * 14),
    sodium: 2300,
    potassium: 4700,
    calcium: 1000,
    iron: gender === 'male' ? 8 : 18,
    magnesium: gender === 'male' ? 420 : 320,
    zinc: gender === 'male' ? 11 : 8,
    vitaminB12: 2.4,
    vitaminC: 90,
    leucine: 2.5,
    omega3: gender === 'male' ? 1.6 : 1.1,
    fermentedFoods: 2,
  };
}

export function NutritionGoalsPage({ onComplete, onBack, onSkip, initialSelected, initialTargets, initialStats, recipes = [] }) {
  const isSettings = !!initialTargets;
  const [selected, setSelected] = useState(() =>
    initialSelected ? new Set(initialSelected) : new Set(DEFAULT_SELECTED)
  );
  const [targets, setTargets] = useState(() =>
    initialTargets ? { ...DEFAULT_TARGETS, ...initialTargets } : { ...DEFAULT_TARGETS }
  );

  const [gender, setGender] = useState(() => initialStats?.gender || '');
  const [heightFt, setHeightFt] = useState(() => initialStats?.heightFt ?? '');
  const [heightIn, setHeightIn] = useState(() => initialStats?.heightIn ?? '');
  const [weight, setWeight] = useState(() => initialStats?.weight ?? '');
  const [age, setAge] = useState(() => initialStats?.age ?? '');

  // Recalculate targets when all stats are filled
  useEffect(() => {
    const ft = Number(heightFt);
    const inch = Number(heightIn);
    const w = Number(weight);
    const a = Number(age);
    if (gender && ft > 0 && inch >= 0 && w > 0 && a > 0) {
      const computed = computeTargets(gender, ft, inch, w, a);
      setTargets(prev => ({ ...prev, ...computed }));
    }
  }, [gender, heightFt, heightIn, weight, age]);

  function toggle(key) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setTarget(key, value) {
    setTargets(prev => ({ ...prev, [key]: value }));
  }

  // --- Meal comparison state ---
  const [selectedMeals, setSelectedMeals] = useState([null, null, null]);
  const [mealNutrition, setMealNutrition] = useState({});
  const [loadingMeals, setLoadingMeals] = useState(new Set());

  const sortedRecipes = [...recipes]
    .filter(r => (r.frequency || 'common') !== 'retired')
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));

  const loadNutrition = useCallback(async (recipeId) => {
    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) return;

    // Check cache first
    try {
      const cache = JSON.parse(localStorage.getItem('sunday-nutrition-cache') || '{}');
      if (cache[recipeId]) {
        const servings = recipe.servings || 1;
        const perServing = {};
        for (const n of NUTRIENTS) {
          perServing[n.key] = (cache[recipeId].totals[n.key] || 0) / servings;
        }
        setMealNutrition(prev => ({ ...prev, [recipeId]: perServing }));
        return;
      }
    } catch {}

    // Fetch and cache
    setLoadingMeals(prev => new Set([...prev, recipeId]));
    try {
      const result = await fetchNutritionForRecipe(recipe.ingredients || []);
      // Cache the result
      try {
        const cache = JSON.parse(localStorage.getItem('sunday-nutrition-cache') || '{}');
        cache[recipeId] = result;
        localStorage.setItem('sunday-nutrition-cache', JSON.stringify(cache));
      } catch {}

      const servings = recipe.servings || 1;
      const perServing = {};
      for (const n of NUTRIENTS) {
        perServing[n.key] = (result.totals[n.key] || 0) / servings;
      }
      setMealNutrition(prev => ({ ...prev, [recipeId]: perServing }));
    } catch {} finally {
      setLoadingMeals(prev => {
        const next = new Set(prev);
        next.delete(recipeId);
        return next;
      });
    }
  }, [recipes]);

  function handleMealSelect(slotIndex, recipeId) {
    const id = recipeId || null;
    setSelectedMeals(prev => {
      const next = [...prev];
      next[slotIndex] = id;
      return next;
    });
    if (id && !mealNutrition[id]) {
      loadNutrition(id);
    }
  }

  const [compareMode, setCompareMode] = useState('daily'); // 'daily' or 'perMeal'

  // Compute combined nutrition from selected meals
  const combinedNutrition = {};
  const hasAnyMeal = selectedMeals.some(Boolean);
  if (hasAnyMeal) {
    for (const n of NUTRIENTS) {
      combinedNutrition[n.key] = 0;
    }
    for (const id of selectedMeals) {
      if (id && mealNutrition[id]) {
        for (const n of NUTRIENTS) {
          combinedNutrition[n.key] += mealNutrition[id][n.key] || 0;
        }
      }
    }
  }

  const anyLoading = selectedMeals.some(id => id && loadingMeals.has(id));

  function handleContinue() {
    const result = {};
    for (const key of selected) {
      result[key] = targets[key];
    }
    const stats = {};
    if (gender) stats.gender = gender;
    if (heightFt !== '') stats.heightFt = Number(heightFt);
    if (heightIn !== '') stats.heightIn = Number(heightIn);
    if (weight !== '') stats.weight = Number(weight);
    if (age !== '') stats.age = Number(age);
    onComplete(result, Object.keys(stats).length > 0 ? stats : null);
  }

  return (
    <div className={styles.page}>
      <div className={styles.twoCol}>
        <div className={styles.card}>
          <img className={styles.logo} src="/sunday-logo.png" alt="Sunday" />
          <h2 className={styles.title}>Set your daily nutrition targets</h2>
          <p className={styles.subtitle}>Enter your info to get personalized targets, or set them manually below.</p>

          <div className={styles.statsSection}>
            <h4 className={styles.groupTitle}>Your Info</h4>
            <div className={styles.statsGrid}>
              <div className={styles.statsField}>
                <span className={styles.statsLabel}>Gender</span>
                <div className={styles.genderBtns}>
                  <button
                    type="button"
                    className={gender === 'male' ? styles.genderBtnActive : styles.genderBtn}
                    onClick={() => setGender('male')}
                  >Male</button>
                  <button
                    type="button"
                    className={gender === 'female' ? styles.genderBtnActive : styles.genderBtn}
                    onClick={() => setGender('female')}
                  >Female</button>
                </div>
              </div>
              <div className={styles.statsField}>
                <span className={styles.statsLabel}>Age</span>
                <input
                  type="number"
                  className={styles.statsInput}
                  value={age}
                  onChange={e => setAge(e.target.value)}
                  placeholder="yrs"
                  min={1}
                  max={120}
                />
              </div>
              <div className={styles.statsField}>
                <span className={styles.statsLabel}>Height</span>
                <div className={styles.heightInputs}>
                  <input
                    type="number"
                    className={styles.statsInput}
                    value={heightFt}
                    onChange={e => setHeightFt(e.target.value)}
                    placeholder="ft"
                    min={1}
                    max={8}
                  />
                  <input
                    type="number"
                    className={styles.statsInput}
                    value={heightIn}
                    onChange={e => setHeightIn(e.target.value)}
                    placeholder="in"
                    min={0}
                    max={11}
                  />
                </div>
              </div>
              <div className={styles.statsField}>
                <span className={styles.statsLabel}>Weight</span>
                <input
                  type="number"
                  className={styles.statsInput}
                  value={weight}
                  onChange={e => setWeight(e.target.value)}
                  placeholder="lbs"
                  min={1}
                />
              </div>
            </div>
          </div>

          {GROUPS.map(group => (
            <div key={group.title} className={styles.group}>
              <h4 className={styles.groupTitle}>{group.title}</h4>
              {group.keys.map(key => {
                const n = NUTRIENTS.find(x => x.key === key);
                if (!n) return null;
                const checked = selected.has(key);
                return (
                  <div key={key} className={styles.nutrientRow}>
                    <input
                      type="checkbox"
                      className={styles.nutrientCheck}
                      checked={checked}
                      onChange={() => toggle(key)}
                    />
                    <label className={styles.nutrientLabel} onClick={() => toggle(key)}>
                      {n.label}
                    </label>
                    {checked && (
                      <>
                        <input
                          type="number"
                          className={styles.nutrientInput}
                          value={targets[key]}
                          onChange={e => setTarget(key, parseFloat(e.target.value) || 0)}
                          min={0}
                          step={n.decimals > 0 ? Math.pow(10, -n.decimals) : 1}
                        />
                        <span className={styles.nutrientUnit}>{n.unit || 'cal'}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          <div className={styles.group}>
            <h4 className={styles.groupTitle}>Other Goals</h4>
            {CUSTOM_GOALS.map(g => {
              const checked = selected.has(g.key);
              return (
                <div key={g.key} className={styles.nutrientRow}>
                  <input
                    type="checkbox"
                    className={styles.nutrientCheck}
                    checked={checked}
                    onChange={() => toggle(g.key)}
                  />
                  <label className={styles.nutrientLabel} onClick={() => toggle(g.key)}>
                    {g.label}
                  </label>
                  {checked && (
                    <>
                      <input
                        type="number"
                        className={styles.nutrientInput}
                        value={targets[g.key]}
                        onChange={e => setTarget(g.key, parseFloat(e.target.value) || 0)}
                        min={0}
                        step={g.decimals > 0 ? Math.pow(10, -g.decimals) : 1}
                      />
                      <span className={styles.nutrientUnit}>{g.unit}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className={styles.bottomActions}>
            {onBack && (
              <button className={styles.backBtn} onClick={onBack}>
                &larr; Back
              </button>
            )}
            <button
              className={styles.continueBtn}
              onClick={handleContinue}
              disabled={selected.size === 0}
            >
              {isSettings ? 'Save Changes' : 'Continue'}
            </button>
          </div>
          {onSkip && (
            <button className={styles.skipBtn} onClick={onSkip}>
              Skip for now
            </button>
          )}
        </div>

        {recipes.length > 0 && (
          <div className={styles.mealCard}>
            <h4 className={styles.groupTitle}>Test Your Meals</h4>
            <p className={styles.mealSubtitle}>Pick up to 3 recipes to see how they compare to your targets.</p>
            <div className={styles.mealGrid}>
              {[0, 1, 2].map(i => (
                <div key={i} className={styles.mealField}>
                  <span className={styles.statsLabel}>Meal {i + 1}</span>
                  <MealCombobox
                    index={i}
                    value={selectedMeals[i]}
                    recipes={sortedRecipes}
                    onSelect={handleMealSelect}
                    loading={selectedMeals[i] && loadingMeals.has(selectedMeals[i])}
                  />
                </div>
              ))}
            </div>

            {hasAnyMeal && !anyLoading && (
              <>
                <div className={styles.compareToggle}>
                  <button
                    type="button"
                    className={compareMode === 'daily' ? styles.compareToggleActive : styles.compareToggleBtn}
                    onClick={() => setCompareMode('daily')}
                  >Daily Target</button>
                  <button
                    type="button"
                    className={compareMode === 'perMeal' ? styles.compareToggleActive : styles.compareToggleBtn}
                    onClick={() => setCompareMode('perMeal')}
                  >Per Meal (1/3)</button>
                </div>
                <div className={styles.comparisonTable}>
                  {NUTRIENTS.filter(n => selected.has(n.key)).map(n => {
                    const actual = combinedNutrition[n.key] || 0;
                    const target = compareMode === 'perMeal'
                      ? (targets[n.key] || 0) / 3
                      : (targets[n.key] || 0);
                    const pct = target > 0 ? (actual / target) * 100 : 0;
                    let colorClass = styles.progressYellow;
                    if (pct >= 90 && pct <= 120) colorClass = styles.progressGreen;
                    else if (pct < 50 || pct > 120) colorClass = styles.progressRed;
                    return (
                      <div key={n.key} className={styles.comparisonRow}>
                        <span className={styles.comparisonLabel}>{n.label}</span>
                        <div className={styles.progressBar}>
                          <div
                            className={`${styles.progressFill} ${colorClass}`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <span className={styles.comparisonPct}>{Math.round(pct)}%</span>
                        <span className={styles.comparisonValues}>
                          {Math.round(actual)}{n.unit} / {Math.round(target)}{n.unit}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
