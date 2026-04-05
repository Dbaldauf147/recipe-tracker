import { useMemo } from 'react';
import { detectCuisine } from '../utils/detectCuisine';
import styles from './ProfilePage.module.css';

export function ProfilePage({ recipes, dailyLog, planHistory, onBack }) {
  const topCuisines = useMemo(() => {
    const counts = {};
    for (const r of recipes) {
      const c = r.cuisine || detectCuisine(r.title, r.ingredients);
      counts[c] = (counts[c] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [recipes]);

  const topRecipes = useMemo(() => {
    const counts = {};
    for (const date of Object.keys(dailyLog || {})) {
      for (const entry of dailyLog[date]?.entries || []) {
        if (entry.type === 'recipe' && entry.recipeName) {
          const key = entry.recipeId || entry.recipeName;
          if (!counts[key]) counts[key] = { name: entry.recipeName, count: 0 };
          counts[key].count++;
        }
      }
    }
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [dailyLog]);

  const topIngredients = useMemo(() => {
    const counts = {};
    for (const date of Object.keys(dailyLog || {})) {
      for (const entry of dailyLog[date]?.entries || []) {
        if (entry.type === 'recipe' && entry.recipeId) {
          const recipe = recipes.find(r => r.id === entry.recipeId);
          if (recipe) {
            for (const ing of recipe.ingredients || []) {
              const key = (ing.ingredient || '').toLowerCase();
              if (key) counts[key] = (counts[key] || 0) + 1;
            }
          }
        }
        if (entry.type === 'ingredient' && entry.ingredientName) {
          const key = entry.ingredientName.toLowerCase();
          counts[key] = (counts[key] || 0) + 1;
        }
      }
    }
    for (const plan of planHistory || []) {
      for (const recipeId of plan.recipeIds || []) {
        const recipe = recipes.find(r => r.id === recipeId);
        if (recipe) {
          for (const ing of recipe.ingredients || []) {
            const key = (ing.ingredient || '').toLowerCase();
            if (key) counts[key] = (counts[key] || 0) + 0.5;
          }
        }
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), count: Math.round(count) }));
  }, [dailyLog, recipes, planHistory]);

  const healthiestMeals = useMemo(() => {
    const best = new Map(); // key -> best scored entry
    for (const date of Object.keys(dailyLog || {})) {
      for (const entry of dailyLog[date]?.entries || []) {
        if (entry.type === 'recipe' && entry.recipeName && entry.nutrition?.calories) {
          const key = entry.recipeId || entry.recipeName;
          const n = entry.nutrition;
          const servings = entry.servings || 1;
          let score = 50;
          const cal = (n.calories || 0) / servings;
          const protein = (n.protein || 0) / servings;
          const fiber = (n.fiber || 0) / servings;
          const sugar = (n.sugar || 0) / servings;
          const fat = (n.fat || 0) / servings;
          if (cal > 0) score += Math.min(20, (protein / cal) * 200);
          score += Math.min(10, fiber * 2);
          score -= Math.min(15, sugar * 0.5);
          if (cal > 0 && fat / cal > 0.4) score -= 10;
          if (cal > 100 && cal < 600) score += 5;
          const finalScore = Math.round(Math.max(0, Math.min(100, score)));
          const existing = best.get(key);
          if (!existing || finalScore > existing.score) {
            best.set(key, { name: entry.recipeName, score: finalScore, calories: Math.round(cal), protein: Math.round(protein) });
          }
        }
      }
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 10);
  }, [dailyLog]);

  const totalLogged = Object.values(dailyLog || {}).reduce((s, d) => s + (d?.entries?.length || 0), 0);

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={onBack}>← Back</button>
      <h1 className={styles.title}>My Profile</h1>

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{recipes.length}</div>
          <div className={styles.statLabel}>Recipes</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{totalLogged}</div>
          <div className={styles.statLabel}>Meals Logged</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{Object.keys(dailyLog || {}).length}</div>
          <div className={styles.statLabel}>Days Tracked</div>
        </div>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Top Cuisines</h2>
        {topCuisines.length > 0 ? (
          <div className={styles.chipRow}>
            {topCuisines.map(([cuisine, count], i) => (
              <span key={cuisine} className={i === 0 ? styles.cuisineChipTop : styles.cuisineChip}>
                {i === 0 ? '🏆 ' : ''}{cuisine} <span className={styles.chipCount}>{count}</span>
              </span>
            ))}
          </div>
        ) : <p className={styles.empty}>Add recipes to see your cuisine preferences</p>}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Most Eaten Recipes</h2>
        {topRecipes.length > 0 ? (
          <div className={styles.list}>
            {topRecipes.map((item, i) => (
              <div key={i} className={styles.listItem}>
                <span className={styles.rank}>{i + 1}</span>
                <span className={styles.listName}>{item.name}</span>
                <span className={styles.listCount}>{item.count}x</span>
              </div>
            ))}
          </div>
        ) : <p className={styles.empty}>Log meals to see your favorites</p>}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Most Used Ingredients</h2>
        {topIngredients.length > 0 ? (
          <div className={styles.chipRow}>
            {topIngredients.map((item, i) => (
              <span key={i} className={styles.ingChip}>
                {item.name} {item.count > 1 && <span className={styles.chipCount}>{item.count}</span>}
              </span>
            ))}
          </div>
        ) : <p className={styles.empty}>Log meals to track ingredient usage</p>}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Healthiest Meals</h2>
        <p className={styles.sectionSub}>Based on protein density, fiber, and macro balance</p>
        {healthiestMeals.length > 0 ? (
          <div className={styles.list}>
            {healthiestMeals.map((item, i) => (
              <div key={i} className={styles.listItem}>
                <span className={styles.rank}>{i + 1}</span>
                <div className={styles.healthInfo}>
                  <span className={styles.listName}>{item.name}</span>
                  <span className={styles.healthMeta}>{item.calories} cal · {item.protein}g protein</span>
                </div>
                <span className={`${styles.scoreBadge} ${item.score >= 70 ? styles.scoreGreen : item.score >= 50 ? styles.scoreYellow : styles.scoreRed}`}>{item.score}</span>
              </div>
            ))}
          </div>
        ) : <p className={styles.empty}>Log meals with nutrition data to see health scores</p>}
      </section>
    </div>
  );
}
