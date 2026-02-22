import { useState, useMemo } from 'react';
import { DEFAULT_KEY_INGREDIENTS, displayName } from '../utils/keyIngredients';
import styles from './OnboardingPage.module.css';

const INGREDIENT_EMOJI = {
  almonds: '\u{1F330}',
  avocado: '\u{1F951}',
  beets: '\u{1FAD1}',
  bell_pepper: '\u{1FAD1}',
  black_beans: '\u{1FAD8}',
  blueberries: '\u{1FAD0}',
  broccoli: '\u{1F966}',
  brown_rice: '\u{1F35A}',
  brussels_sprouts: '\u{1F966}',
  carrots_baby: '\u{1F955}',
  cauliflower: '\u{1F966}',
  chicken_breast: '\u{1F357}',
  chickpeas: '\u{1FAD8}',
  cottage_cheese: '\u{1F9C0}',
  edamame: '\u{1FAD8}',
  eggs: '\u{1F95A}',
  garlic: '\u{1F9C4}',
  ginger: '\u{1FAD0}',
  greek_yogurt: '\u{1F95B}',
  green_beans: '\u{1FAD8}',
  kale: '\u{1F96C}',
  lentils: '\u{1FAD8}',
  mushrooms: '\u{1F344}',
  oats: '\u{1F33E}',
  onion: '\u{1F9C5}',
  peanut_butter: '\u{1F95C}',
  peas: '\u{1FAD1}',
  potatoes: '\u{1F954}',
  quinoa: '\u{1F33E}',
  salmon: '\u{1F41F}',
  sardines: '\u{1F41F}',
  shrimp: '\u{1F990}',
  spinach: '\u{1F96C}',
  strawberries: '\u{1F353}',
  sweet_potato: '\u{1F360}',
  tempeh: '\u{1F96A}',
  tofu: '\u{1F96A}',
  tomatoes: '\u{1F345}',
  tuna: '\u{1F41F}',
  turkey_breast: '\u{1F983}',
  walnuts: '\u{1F330}',
  whole_wheat_pasta: '\u{1F35D}',
  zucchini: '\u{1F952}',
};

function getEmoji(key) {
  return INGREDIENT_EMOJI[key] || '\u{1F372}';
}

export function OnboardingPage({ onComplete }) {
  const [selected, setSelected] = useState(() => new Set());
  const [customIngredients, setCustomIngredients] = useState([]);
  const [customInput, setCustomInput] = useState('');

  const allIngredients = useMemo(
    () => [...DEFAULT_KEY_INGREDIENTS, ...customIngredients],
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
    if (allIngredients.includes(key)) return;
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
    const result = allIngredients.filter(k => selected.has(k));
    onComplete(result);
  }

  const isCustom = key => customIngredients.includes(key);

  // Split ingredients into 3 columns
  const columns = useMemo(() => {
    const cols = [[], [], []];
    allIngredients.forEach((key, i) => cols[i % 3].push(key));
    return cols;
  }, [allIngredients]);

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

        <div className={styles.grid}>
          {columns.map((col, ci) => (
            <div key={ci} className={styles.column}>
              {col.map(key => renderItem(key))}
            </div>
          ))}
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

        <p className={styles.counter}>{selected.size} ingredients selected</p>

        <button
          className={styles.startBtn}
          onClick={handleSubmit}
          disabled={selected.size === 0}
        >
          Get Started
        </button>
      </div>
    </div>
  );
}
