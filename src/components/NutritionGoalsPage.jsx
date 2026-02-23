import { useState } from 'react';
import { NUTRIENTS } from '../utils/nutrition';
import styles from './NutritionGoalsPage.module.css';

const MACROS = ['calories', 'protein', 'carbs', 'fat', 'saturatedFat'];
const SUGARS_FIBER = ['sugar', 'addedSugar', 'fiber'];
const MINERALS = ['sodium', 'potassium', 'calcium', 'iron', 'magnesium', 'zinc'];
const VITAMINS_AMINOS = ['vitaminB12', 'vitaminC', 'leucine'];

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
};

const DEFAULT_SELECTED = new Set(['calories', 'protein', 'carbs', 'fat']);

export function NutritionGoalsPage({ onComplete, onBack, onSkip, initialSelected, initialTargets }) {
  const isSettings = !!initialTargets;
  const [selected, setSelected] = useState(() =>
    initialSelected ? new Set(initialSelected) : new Set(DEFAULT_SELECTED)
  );
  const [targets, setTargets] = useState(() =>
    initialTargets ? { ...DEFAULT_TARGETS, ...initialTargets } : { ...DEFAULT_TARGETS }
  );

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

  function handleContinue() {
    const result = {};
    for (const key of selected) {
      result[key] = targets[key];
    }
    onComplete(result);
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <img className={styles.logo} src="/sunday-logo.png" alt="Sunday" />
        <h2 className={styles.title}>Set your daily nutrition targets</h2>
        <p className={styles.subtitle}>Select which nutrients to track and set your daily goals. Don't worry, this can be changed and updated later on as well.</p>

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
    </div>
  );
}
