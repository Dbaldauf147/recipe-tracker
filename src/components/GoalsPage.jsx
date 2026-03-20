import { useState } from 'react';
import styles from './GoalsPage.module.css';

const GOALS = [
  {
    key: 'daily_nutrition_goals',
    title: 'Track nutrition',
    description: 'Get meal recommendations based on daily nutrition goals',
  },
  {
    key: 'follow_diet',
    title: 'Follow a specific diet',
    description: 'Get recommendations tailored to a specific diet',
  },
  {
    key: 'whats_in_season',
    title: "Eat what's in season",
    description: "Get recommendations for what's in season",
  },
  {
    key: 'ingredient_variety',
    title: 'Cycle healthy ingredients in my diet',
    description: 'Cycle healthy ingredients to ensure variety in your diet',
  },
  {
    key: 'import_meals',
    title: 'Import meals from social media or websites',
    description: 'Save recipes from Instagram, TikTok, blogs, and more',
  },
  {
    key: 'find_recipes',
    title: 'Find new recipes',
    description: 'Discover new meals based on your preferences and ingredients',
  },
];

const REGIONS = [
  { key: 'northeast', label: 'Northeast', states: 'ME, NH, VT, MA, RI, CT, NY, NJ, PA, MD, DE' },
  { key: 'southeast', label: 'Southeast', states: 'VA, NC, SC, GA, FL, AL, MS, TN, KY, LA, AR, WV' },
  { key: 'midwest', label: 'Midwest', states: 'OH, MI, IN, IL, WI, MN, IA, MO, ND, SD, NE, KS' },
  { key: 'southwest', label: 'Southwest', states: 'TX, OK, NM, AZ, NV, UT, CO' },
  { key: 'west_coast', label: 'West Coast', states: 'CA, HI' },
  { key: 'pacific_northwest', label: 'Pacific Northwest', states: 'OR, WA, ID, MT, WY, AK' },
];

const DIET_TYPES = [
  'Vegan',
  'Vegetarian',
  'Pescatarian',
  'Keto',
  'Paleo',
  'Carnivore',
  'Mediterranean',
  'Whole30',
  'Gluten-Free',
  'Dairy-Free',
  'Low-Carb',
  'High-Protein',
];

const FOCUS_OPTIONS = [
  {
    key: 'nutrition',
    title: 'Track Nutrition',
    description: 'Track nutrients, set daily targets, and see how your meals stack up',
  },
  {
    key: 'meal-planning',
    title: 'Plan my meals',
    description: 'Build weekly menus, generate shopping lists, and stay organized',
  },
];

export function GoalsPage({ onComplete, onSkip, onBack, asModal }) {
  const [focus, setFocus] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sunday-user-focus'));
      return saved && saved.length > 0 ? new Set(saved) : new Set();
    } catch { return new Set(); }
  });
  const [focusChosen, setFocusChosen] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sunday-user-focus'));
      return Array.isArray(saved) && saved.length > 0;
    } catch { return false; }
  });
  const [selected, setSelected] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sunday-user-goals'));
      return saved ? new Set(saved) : new Set();
    } catch {
      return new Set();
    }
  });
  const [location, setLocation] = useState(() => {
    try { return localStorage.getItem('sunday-user-location') || ''; }
    catch { return ''; }
  });
  const [selectedDiets, setSelectedDiets] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sunday-user-diet'));
      return saved ? new Set(saved) : new Set();
    } catch {
      return new Set();
    }
  });
  const [customDiet, setCustomDiet] = useState(() => {
    try { return localStorage.getItem('sunday-user-custom-diet') || ''; }
    catch { return ''; }
  });

  function toggle(key) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleDiet(diet) {
    setSelectedDiets(prev => {
      const next = new Set(prev);
      if (next.has(diet)) next.delete(diet);
      else next.add(diet);
      return next;
    });
  }

  // Always show the 2-option focus screen
  if (true) {
    return (
      <div className={asModal ? styles.overlay : styles.page}>
        <div className={styles.card}>
          <img className={styles.logo} src="/prep-day-logo.png" alt="Prep Day" />
          <h2 className={styles.title}>How would you like to use Prep Day?</h2>
          <p className={styles.subtitle}>Choose all that apply</p>

          <div className={styles.goalList}>
            {FOCUS_OPTIONS.map(opt => (
              <div
                key={opt.key}
                className={`${styles.goalCard} ${focus.has(opt.key) ? styles.goalSelected : ''}`}
                onClick={() => setFocus(prev => {
                  const next = new Set(prev);
                  if (next.has(opt.key)) next.delete(opt.key);
                  else next.add(opt.key);
                  return next;
                })}
              >
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={focus.has(opt.key)}
                  onChange={() => setFocus(prev => {
                    const next = new Set(prev);
                    if (next.has(opt.key)) next.delete(opt.key);
                    else next.add(opt.key);
                    return next;
                  })}
                  onClick={e => e.stopPropagation()}
                />
                <div className={styles.goalText}>
                  <span className={styles.goalTitle}>{opt.title}</span>
                  <span className={styles.goalDesc}>{opt.description}</span>
                </div>
              </div>
            ))}
          </div>

          <div className={styles.bottomActions}>
            {onBack && (
              <button className={styles.backBtn} onClick={onBack}>
                &larr; Back
              </button>
            )}
            <button
              className={styles.startBtn}
              disabled={focus.size === 0}
              onClick={() => {
                const focusArr = [...focus];
                localStorage.setItem('sunday-user-focus', JSON.stringify(focusArr));
                localStorage.setItem('sunday-post-onboarding', focus.has('nutrition') ? 'nutrition-goals' : '');
                onComplete([]);
              }}
            >
              Continue
            </button>
          </div>
          {onSkip && (
            <button className={styles.skipBtn} onClick={onSkip}>
              Skip for now
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={asModal ? styles.overlay : styles.page} onClick={asModal && onSkip ? (e) => { if (e.target === e.currentTarget) onSkip(); } : undefined}>
      <div className={styles.card}>
        <img className={styles.logo} src="/prep-day-logo.png" alt="Prep Day" />
        <h2 className={styles.title}>What would you like to do?</h2>

        <div className={styles.goalList}>
          {GOALS.map(goal => (
            <div key={goal.key}>
              <div
                className={`${styles.goalCard} ${selected.has(goal.key) ? styles.goalSelected : ''}`}
                onClick={() => toggle(goal.key)}
              >
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={selected.has(goal.key)}
                  onChange={() => toggle(goal.key)}
                  onClick={e => e.stopPropagation()}
                />
                <div className={styles.goalText}>
                  <span className={styles.goalTitle}>{goal.title}</span>
                  <span className={styles.goalDesc}>{goal.description}</span>
                </div>
              </div>
              {goal.key === 'follow_diet' && selected.has('follow_diet') && (
                <div className={styles.locationPrompt}>
                  <label className={styles.locationLabel}>Select your diet(s)</label>
                  <div className={styles.dietGrid}>
                    {DIET_TYPES.map(diet => (
                      <button
                        key={diet}
                        className={`${styles.dietChip} ${selectedDiets.has(diet) ? styles.dietChipSelected : ''}`}
                        onClick={e => { e.stopPropagation(); toggleDiet(diet); }}
                      >
                        {diet}
                      </button>
                    ))}
                  </div>
                  <input
                    className={styles.customDietInput}
                    type="text"
                    placeholder="Or type your own diet..."
                    value={customDiet}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setCustomDiet(e.target.value)}
                  />
                </div>
              )}
              {goal.key === 'whats_in_season' && selected.has('whats_in_season') && (
                <div className={styles.locationPrompt}>
                  <label className={styles.locationLabel}>What region are you in?</label>
                  <div className={styles.regionGrid}>
                    {REGIONS.map(r => (
                      <button
                        key={r.key}
                        className={`${styles.regionChip} ${location === r.key ? styles.regionChipSelected : ''}`}
                        onClick={e => { e.stopPropagation(); setLocation(r.key); }}
                      >
                        <span className={styles.regionName}>{r.label}</span>
                        <span className={styles.regionStates}>{r.states}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className={styles.bottomActions}>
          <button className={styles.backBtn} onClick={() => setFocusChosen(false)}>
            &larr; Back
          </button>
          <button className={styles.startBtn} onClick={() => {
            if (location.trim()) localStorage.setItem('sunday-user-location', location.trim());
            if (selectedDiets.size > 0) localStorage.setItem('sunday-user-diet', JSON.stringify([...selectedDiets]));
            if (customDiet.trim()) localStorage.setItem('sunday-user-custom-diet', customDiet.trim());
            onComplete([...selected]);
          }}>
            Continue
          </button>
        </div>
        {onSkip && (
          <button className={styles.skipBtn} onClick={onSkip}>
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
