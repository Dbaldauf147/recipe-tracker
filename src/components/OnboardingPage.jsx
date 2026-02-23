import { useState, useMemo } from 'react';
import { INGREDIENT_CATEGORIES, displayName } from '../utils/keyIngredients';
import styles from './OnboardingPage.module.css';

const INGREDIENT_EMOJI = {
  // Protein
  black_beans: '\u{1FAD8}',
  chicken_breast: '\u{1F357}',
  chickpeas: '\u{1FAD8}',
  edamame: '\u{1FAD8}',
  eggs: '\u{1F95A}',
  greek_yogurt: '\u{1F95B}',
  kefir: '\u{1F95B}',
  lentils: '\u{1FAD8}',
  salmon: '\u{1F41F}',
  sardines: '\u{1F41F}',
  soy_milk: '\u{1F95B}',
  tempeh: '\u{1F96A}',
  tofu: '\u{1F96A}',
  trout: '\u{1F41F}',
  turkey_breast: '\u{1F983}',
  // Carbs
  apples: '\u{1F34E}',
  barley: '\u{1F33E}',
  brown_rice: '\u{1F35A}',
  kiwi: '\u{1F95D}',
  oats: '\u{1F33E}',
  oranges: '\u{1F34A}',
  potatoes: '\u{1F954}',
  quinoa: '\u{1F33E}',
  sweet_potatoes: '\u{1F360}',
  whole_wheat_pasta: '\u{1F35D}',
  // Fiber
  asparagus: '\u{1F96C}',
  bell_peppers: '\u{1FAD1}',
  blueberries: '\u{1FAD0}',
  broccoli: '\u{1F966}',
  brussels_sprouts: '\u{1F966}',
  cabbage: '\u{1F96C}',
  carrots: '\u{1F955}',
  cauliflower: '\u{1F966}',
  kale: '\u{1F96C}',
  mushrooms: '\u{1F344}',
  raspberries: '\u{1FAD0}',
  spinach: '\u{1F96C}',
  strawberries: '\u{1F353}',
  tomatoes: '\u{1F345}',
  // Fats
  almonds: '\u{1F330}',
  avocado: '\u{1F951}',
  chia_seeds: '\u{1F331}',
  extra_virgin_olive_oil: '\u{1FAD2}',
  ground_flaxseed: '\u{1F331}',
  parmesan_cheese: '\u{1F9C0}',
  pumpkin_seeds: '\u{1F383}',
  walnuts: '\u{1F330}',
};

function getEmoji(key) {
  return INGREDIENT_EMOJI[key] || '\u{1F372}';
}

const CATEGORY_ORDER = ['Protein', 'Carbs', 'Fiber', 'Fats'];

export function OnboardingPage({ onComplete, initialIngredients, onCancel, onSkip }) {
  const knownKeys = new Set(Object.values(INGREDIENT_CATEGORIES).flat());
  const [selected, setSelected] = useState(() =>
    initialIngredients ? new Set(initialIngredients) : new Set()
  );
  const [customIngredients, setCustomIngredients] = useState(() =>
    initialIngredients ? initialIngredients.filter(k => !knownKeys.has(k)) : []
  );
  const [customInput, setCustomInput] = useState('');

  const allIngredientKeys = useMemo(
    () => [
      ...Object.values(INGREDIENT_CATEGORIES).flat(),
      ...customIngredients,
    ],
    [customIngredients]
  );

  function toggle(key) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleAddCustom() {
    const raw = customInput.trim();
    if (!raw) return;
    const key = raw.toLowerCase().replace(/\s+/g, '_');
    if (allIngredientKeys.includes(key)) return;
    setCustomIngredients(prev => [...prev, key]);
    setSelected(prev => new Set(prev).add(key));
    setCustomInput('');
  }

  function handleRemoveCustom(key) {
    setCustomIngredients(prev => prev.filter(k => k !== key));
    setSelected(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function handleSubmit() {
    const result = allIngredientKeys.filter(k => selected.has(k));
    onComplete(result);
  }

  const isCustom = key => customIngredients.includes(key);

  function renderItem(key) {
    return (
      <div
        key={key}
        className={`${styles.item} ${selected.has(key) ? styles.itemSelected : ''}`}
        onClick={() => toggle(key)}
      >
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={selected.has(key)}
          onChange={() => toggle(key)}
          onClick={e => e.stopPropagation()}
        />
        <span className={styles.emoji}>{getEmoji(key)}</span>
        <span className={styles.name}>
          {displayName(key)}
        </span>
        {isCustom(key) && (
          <button
            className={styles.removeBtn}
            onClick={e => { e.stopPropagation(); handleRemoveCustom(key); }}
            title="Remove custom ingredient"
          >
            &times;
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <img className={styles.logo} src="/sunday-logo.png" alt="Sunday" />
        <h2 className={styles.title}>What kinds of food would you like to eat on a regular basis?</h2>
        <p className={styles.subtitle}>(Don't worry, you can update this later)</p>

        <div className={styles.topRow}>
          <div className={styles.actions}>
            <button
              className={styles.actionBtn}
              onClick={() => setSelected(new Set(allIngredientKeys))}
            >
              Select All
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => setSelected(new Set())}
            >
              Deselect All
            </button>
          </div>
          <div className={styles.addRow}>
            <input
              className={styles.addInput}
              type="text"
              placeholder="Add custom ingredient"
              value={customInput}
              onChange={e => setCustomInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddCustom(); }}
            />
            <button
              className={styles.addBtn}
              onClick={handleAddCustom}
              disabled={!customInput.trim()}
            >
              Add
            </button>
          </div>
        </div>

        <div className={styles.grid}>
          {CATEGORY_ORDER.map(cat => (
            <div key={cat} className={styles.column}>
              <h3 className={styles.categoryHeading}>{cat}</h3>
              {INGREDIENT_CATEGORIES[cat].map(key => renderItem(key))}
            </div>
          ))}
        </div>

        {customIngredients.length > 0 && (
          <div className={styles.customSection}>
            <h3 className={styles.categoryHeading}>Custom</h3>
            <div className={styles.customList}>
              {customIngredients.map(key => renderItem(key))}
            </div>
          </div>
        )}

        <div className={styles.bottomActions}>
          {onCancel && (
            <button className={styles.cancelBtn} onClick={onCancel}>
              &larr; Back
            </button>
          )}
          <button
            className={styles.startBtn}
            onClick={handleSubmit}
            disabled={selected.size === 0}
          >
            {initialIngredients ? 'Save Changes' : 'Get Started'}
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
