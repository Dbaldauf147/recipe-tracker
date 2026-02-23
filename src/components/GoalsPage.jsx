import { useState } from 'react';
import styles from './GoalsPage.module.css';

const GOALS = [
  {
    key: 'track_nutrition',
    title: 'Track Nutrition',
    description: 'Track the nutritional content of your meals',
  },
  {
    key: 'rotate_recipes',
    title: 'Rotate Recipes',
    description: 'Have the app rotate your recipes week to week',
  },
  {
    key: 'ingredient_suggestions',
    title: 'Ingredient-Based Suggestions',
    description: "Get recipe suggestions based on how long it's been since you've had certain ingredients",
  },
];

export function GoalsPage({ onComplete }) {
  const [selected, setSelected] = useState(new Set());

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

        <button className={styles.startBtn} onClick={() => onComplete([...selected])}>
          Continue
        </button>
      </div>
    </div>
  );
}
