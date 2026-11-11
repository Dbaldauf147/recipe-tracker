import { useEffect, useMemo, useState } from 'react';
import { getCachedMealImage } from '../utils/generateMealImage';
import { dayTotals } from '../utils/dailyTotals';
import { todayKey } from '../utils/localDate';
import { weekDays } from '../utils/editorialLayout';
import styles from './EditorialHome.module.css';

const SLOTS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
];
const MACROS = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
];

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) ?? fallback : fallback;
  } catch {
    return fallback;
  }
}

function greeting(now) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** A recipe's photo if one is cached, otherwise a typographic tile. */
function Thumb({ recipe, className }) {
  const src = recipe ? getCachedMealImage(recipe.id) : null;
  if (src) return <img className={className} src={src} alt="" loading="lazy" />;
  return (
    <span className={`${className} ${styles.thumbFallback}`} aria-hidden="true">
      {(recipe?.title || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

function CalorieRing({ value, goal }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  return (
    <svg className={styles.ring} viewBox="0 0 128 128" role="img"
      aria-label={goal > 0 ? `${Math.round(value)} of ${Math.round(goal)} calories today` : `${Math.round(value)} calories today`}>
      <circle cx="64" cy="64" r={r} className={styles.ringTrack} />
      <circle cx="64" cy="64" r={r} className={styles.ringValue}
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 64 64)" />
      <text x="64" y="62" textAnchor="middle" className={styles.ringNumber}>{Math.round(value).toLocaleString()}</text>
      <text x="64" y="82" textAnchor="middle" className={styles.ringUnit}>
        {goal > 0 ? `of ${Math.round(goal).toLocaleString()} kcal` : 'kcal today'}
      </text>
    </svg>
  );
}

/**
 * Home for the optional Editorial layout — a read-only overview built from
 * data the app already has (this week's recipes, the day-by-day meal plan,
 * today's food log and goals). It writes nothing; every card just opens the
 * existing page that owns that data.
 */
export function EditorialHome({ user, getRecipe, weeklyPlan = [], weekMealPlan = {}, showNutrition, canView, onOpen, onOpenRecipe, onOpenGoals }) {
  // Meal photos arrive in pages after sign-in; repaint as they land.
  const [, setImageTick] = useState(0);
  useEffect(() => {
    const bump = () => setImageTick(t => t + 1);
    window.addEventListener('meal-images-synced', bump);
    return () => window.removeEventListener('meal-images-synced', bump);
  }, []);

  const now = new Date();
  const today = todayKey();
  const days = useMemo(() => weekDays(new Date()), [today]); // eslint-disable-line react-hooks/exhaustive-deps

  const weekRecipes = useMemo(
    () => weeklyPlan.map(id => getRecipe(id)).filter(Boolean),
    [weeklyPlan, getRecipe],
  );

  const recipesOn = key => {
    const day = weekMealPlan[key] || {};
    const ids = SLOTS.flatMap(s => day[s.key] || []);
    return [...new Set(ids)].map(id => getRecipe(id)).filter(Boolean);
  };

  const todayPlan = weekMealPlan[today] || {};
  const todaySlots = SLOTS.map(s => ({
    ...s,
    recipes: (todayPlan[s.key] || []).map(id => getRecipe(id)).filter(Boolean),
  }));

  // Feature what's actually next: tonight's dinner, else today's other meals,
  // else the first recipe on this week's list.
  const featuredSlot = [...todaySlots].reverse().find(s => s.recipes.length > 0);
  const featured = featuredSlot?.recipes[0] || weekRecipes[0] || null;
  const featuredImage = featured ? getCachedMealImage(featured.id) : null;
  const featuredEyebrow = featuredSlot ? `Today · ${featuredSlot.label}` : 'On this week’s menu';

  const goals = showNutrition ? readJson('sunday-nutrition-goals', null) : null;
  const totals = showNutrition ? dayTotals(readJson('sunday-daily-log', {})[today]).totals : null;
  const calGoal = Number(goals?.calories) || 0;

  const firstName = (user?.displayName || '').trim().split(/\s+/)[0];
  const plannedDays = days.filter(d => recipesOn(d.key).length > 0).length;

  return (
    <div className={styles.home}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>
          {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className={styles.title}>This week’s prep</h1>
        <p className={styles.sub}>
          {greeting(now)}{firstName ? `, ${firstName}` : ''}.{' '}
          {weekRecipes.length > 0
            ? `${weekRecipes.length} ${weekRecipes.length === 1 ? 'recipe' : 'recipes'} on the list, ${plannedDays} of 7 days planned.`
            : 'Nothing on the list yet — pick a few recipes to get started.'}
        </p>
      </header>

      {canView('week-plan') && (
        <section className={styles.week} aria-label="This week">
          {days.map(d => {
            const dayRecipes = recipesOn(d.key);
            const isToday = d.key === today;
            return (
              <button
                type="button"
                key={d.key}
                className={`${styles.day}${isToday ? ` ${styles.dayToday}` : ''}`}
                onClick={() => onOpen('week-plan')}
                aria-label={`${d.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}: ${dayRecipes.length ? dayRecipes.map(r => r.title).join(', ') : 'nothing planned'}`}
              >
                <span className={styles.dayName}>{d.date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                <span className={styles.dayNum}>{d.date.getDate()}</span>
                <span className={styles.dayThumbs}>
                  {dayRecipes.length === 0 && <span className={styles.dayEmpty}>Open</span>}
                  {dayRecipes.slice(0, 3).map(r => <Thumb key={r.id} recipe={r} className={styles.dayThumb} />)}
                  {dayRecipes.length > 3 && <span className={styles.dayMore}>+{dayRecipes.length - 3}</span>}
                </span>
              </button>
            );
          })}
        </section>
      )}

      <section className={styles.bento}>
        {/* Hero */}
        {featured ? (
          <button type="button" className={`${styles.card} ${styles.hero}`} onClick={() => onOpenRecipe(featured.id)}>
            {featuredImage
              ? <img className={styles.heroImage} src={featuredImage} alt="" />
              : <span className={styles.heroInitial} aria-hidden="true">{featured.title.trim().charAt(0).toUpperCase()}</span>}
            <span className={styles.heroShade} aria-hidden="true" />
            <span className={styles.heroBody}>
              <span className={styles.heroEyebrow}>{featuredEyebrow}</span>
              <span className={styles.heroTitle}>{featured.title}</span>
              <span className={styles.heroCta}>
                Open recipe
                <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
              </span>
            </span>
          </button>
        ) : (
          <div className={`${styles.card} ${styles.hero} ${styles.heroEmpty}`}>
            <span className={styles.heroEyebrow}>On this week’s menu</span>
            <span className={styles.heroTitle}>Nothing chosen yet</span>
            <button type="button" className={styles.primaryBtn} onClick={() => onOpen('list')}>Browse recipes</button>
          </div>
        )}

        {/* Today's meals */}
        {canView('week-plan') && (
          <div className={`${styles.card} ${styles.today}`}>
            <h2 className={styles.cardTitle}>Today</h2>
            <ul className={styles.slotList}>
              {todaySlots.map(s => (
                <li key={s.key} className={styles.slot}>
                  <span className={styles.slotLabel}>{s.label}</span>
                  {s.recipes.length === 0
                    ? <span className={styles.slotEmpty}>Not planned</span>
                    : s.recipes.map(r => (
                      <button type="button" key={r.id} className={styles.slotRecipe} onClick={() => onOpenRecipe(r.id)}>{r.title}</button>
                    ))}
                </li>
              ))}
            </ul>
            <button type="button" className={styles.link} onClick={() => onOpen('week-plan')}>
              Open week plan <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
            </button>
          </div>
        )}

        {/* Nutrition */}
        {showNutrition && (
          <div className={`${styles.card} ${styles.nutrition}`}>
            <h2 className={styles.cardTitle}>Nutrition today</h2>
            <div className={styles.nutritionBody}>
              <CalorieRing value={totals.calories || 0} goal={calGoal} />
              <ul className={styles.macros}>
                {MACROS.map(m => {
                  const v = totals[m.key] || 0;
                  const g = Number(goals?.[m.key]) || 0;
                  return (
                    <li key={m.key} className={styles.macro}>
                      <span className={styles.macroTop}>
                        <span>{m.label}</span>
                        <span className={styles.macroNum}>{Math.round(v)}{g > 0 ? ` / ${Math.round(g)}` : ''} g</span>
                      </span>
                      <span className={styles.bar} aria-hidden="true">
                        <span className={styles.barFill} style={{ width: `${g > 0 ? Math.min(100, (v / g) * 100) : 0}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            {canView('nutrition-goals') && (
              <button type="button" className={styles.link} onClick={onOpenGoals}>
                {calGoal > 0 ? 'Adjust goals' : 'Set your goals'} <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
              </button>
            )}
          </div>
        )}

        {/* Shopping */}
        {canView('shopping') && (
          <button type="button" className={`${styles.card} ${styles.shopping}`} onClick={() => onOpen('shopping')}>
            <span className={`material-symbols-outlined ${styles.shoppingIcon}`} aria-hidden="true">shopping_cart</span>
            <span className={styles.bigNumber}>{weekRecipes.length}</span>
            <span className={styles.bigLabel}>{weekRecipes.length === 1 ? 'recipe' : 'recipes'} on your shopping list</span>
            <span className={styles.link}>
              Open shopping list <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
            </span>
          </button>
        )}

        {/* This week's recipes */}
        {weekRecipes.length > 0 && (
          <div className={`${styles.card} ${styles.lineup}`}>
            <h2 className={styles.cardTitle}>This week’s recipes</h2>
            <ul className={styles.lineupList}>
              {weekRecipes.slice(0, 8).map(r => (
                <li key={r.id}>
                  <button type="button" className={styles.lineupItem} onClick={() => onOpenRecipe(r.id)}>
                    <Thumb recipe={r} className={styles.lineupThumb} />
                    <span className={styles.lineupTitle}>{r.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            {weekRecipes.length > 8 && (
              <button type="button" className={styles.link} onClick={() => onOpen('list')}>
                All {weekRecipes.length} recipes <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
