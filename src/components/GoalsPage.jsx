import { useState } from 'react';
import styles from './GoalsPage.module.css';

const GOALS = [
  {
    key: 'daily_nutrition_goals',
    title: 'Daily Nutrition Goals',
    description: 'Get meal recommendations based on daily nutrition goals',
  },
  {
    key: 'whats_in_season',
    title: "What's In Season",
    description: "Get recommendations for what's in season",
  },
  {
    key: 'ingredient_variety',
    title: 'Ingredient Variety',
    description: 'Cycle healthy ingredients to ensure variety in your diet',
  },
];

export function GoalsPage({ onComplete, onSkip, onBack }) {
  const [selected, setSelected] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sunday-user-goals'));
      return saved ? new Set(saved) : new Set();
    } catch {
      return new Set();
    }
  });

  function toggle(key) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <img className={styles.logo} src="/sunday-logo.png" alt="Sunday" />
        <h2 className={styles.title}>What are your goals?</h2>
        <p className={styles.subtitle}>Select any that apply — you can always change these later</p>

        <div className={styles.goalList}>
          {GOALS.map(goal => (
            <div
              key={goal.key}
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
          ))}
        </div>

        <div className={styles.bottomActions}>
          {onBack && (
            <button className={styles.backBtn} onClick={onBack}>
              &larr; Back
            </button>
          )}
          <button className={styles.startBtn} onClick={() => onComplete([...selected])}>
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
