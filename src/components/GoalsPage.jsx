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

export function GoalsPage({ onComplete, onSkip, onBack, asModal }) {
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
                  <label className={styles.locationLabel}>What's your location?</label>
                  <input
                    type="text"
                    className={styles.locationInput}
                    placeholder="e.g. California, New York, Texas"
                    value={location}
                    onChange={e => setLocation(e.target.value)}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className={styles.bottomActions}>
          {onBack && (
            <button className={styles.backBtn} onClick={onBack}>
              &larr; Back
            </button>
          )}
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
