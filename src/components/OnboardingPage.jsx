import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { INGREDIENT_CATEGORIES, getDietFilteredCategories, displayName } from '../utils/keyIngredients';
import styles from './OnboardingPage.module.css';

const INGREDIENT_EMOJI = {
  // Protein
  chicken_breast: '🍗',
  chickpeas: '🧆',
  cottage_cheese: '🧈',
  edamame: '🌱',
  eggs: '🥚',
  greek_yogurt: '🥛',
  ground_turkey: '🍖',
  kefir: '🥤',
  lentils: '🍲',
  salmon: '🐟',
  sardines: '🐠',
  shrimp: '🦐',
  soy_milk: '🧋',
  tempeh: '🧱',
  tofu: '🍢',
  trout: '🎣',
  tuna: '🐡',
  turkey_breast: '🦃',
  whey_protein: '💪',
  cod: '🐋',
  bison: '🦬',
  // Carbs
  apples: '🍎',
  bananas: '🍌',
  barley: '🌾',
  beets: '🟣',
  black_beans: '🫘',
  brown_rice: '🍚',
  butternut_squash: '🧡',
  farro: '🌿',
  kidney_beans: '🫛',
  kiwi: '🥝',
  mangoes: '🥭',
  oats: '🥣',
  oranges: '🍊',
  pineapple: '🍍',
  plantains: '🍈',
  potatoes: '🥔',
  quinoa: '🫙',
  sweet_potatoes: '🍠',
  whole_wheat_bread: '🍞',
  whole_wheat_pasta: '🍝',
  // Fiber
  artichokes: '🌻',
  asparagus: '🌿',
  avocado: '🥑',
  bell_peppers: '🫑',
  blueberries: '🫐',
  broccoli: '🥦',
  brussels_sprouts: '🥬',
  cabbage: '🟢',
  carrots: '🥕',
  cauliflower: '☁️',
  celery: '🪴',
  cucumber: '🥒',
  green_beans: '🟩',
  kale: '🍃',
  mushrooms: '🍄',
  onions: '🧅',
  peas: '💚',
  raspberries: '🔴',
  spinach: '🥗',
  strawberries: '🍓',
  tomatoes: '🍅',
  zucchini: '🫛',
  // Fats
  almonds: '🌰',
  avocado_oil: '🫒',
  cashews: '🥜',
  chia_seeds: '⚫',
  coconut_oil: '🥥',
  dark_chocolate: '🍫',
  extra_virgin_olive_oil: '🫒',
  ground_flaxseed: '🟤',
  hemp_seeds: '🌿',
  macadamia_nuts: '🔵',
  parmesan_cheese: '🧀',
  pecans: '🤎',
  pistachios: '🟢',
  pumpkin_seeds: '🎃',
  sunflower_seeds: '🌻',
  tahini: '🫕',
  walnuts: '🧠',
  // Superfoods
  acai: '🟣',
  bee_pollen: '🐝',
  bone_broth: '🍵',
  cacao_nibs: '🍫',
  fermented_foods: '🫙',
  garlic: '🧄',
  ginger: '🫚',
  green_tea: '🍵',
  kimchi: '🥢',
  kombucha: '🧃',
  miso: '🥣',
  nutritional_yeast: '✨',
  sauerkraut: '🥗',
  seaweed: '🌊',
  spirulina: '💚',
  turmeric: '🟡',
};

function getEmoji(key) {
  return INGREDIENT_EMOJI[key] || '\u{1F372}';
}

const CATEGORY_ORDER = ['Protein', 'Carbs', 'Fiber', 'Fats', 'Superfoods'];

export function OnboardingPage({ onComplete, initialIngredients, onCancel, onSkip }) {
  const filteredCategories = getDietFilteredCategories();
  const knownKeys = new Set(Object.values(INGREDIENT_CATEGORIES).flat());
  const [selected, setSelected] = useState(() =>
    initialIngredients ? new Set(initialIngredients) : new Set()
  );
  const [customIngredients, setCustomIngredients] = useState(() =>
    initialIngredients ? initialIngredients.filter(k => !knownKeys.has(k)) : []
  );
  const [customInput, setCustomInput] = useState('');
  const [showSaved, setShowSaved] = useState(false);
  const autoSaveRef = useRef(null);
  const savedTimerRef = useRef(null);

  const allIngredientKeys = useMemo(
    () => [
      ...Object.values(filteredCategories).flat(),
      ...customIngredients,
    ],
    [customIngredients, filteredCategories]
  );

  const filteredCategoryOrder = CATEGORY_ORDER.filter(cat => filteredCategories[cat]?.length > 0);

  // Auto-save with debounce when editing existing ingredients
  const doAutoSave = useCallback(() => {
    if (!initialIngredients) return;
    const result = allIngredientKeys.filter(k => selected.has(k));
    onComplete(result);
    setShowSaved(true);
    clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setShowSaved(false), 2000);
  }, [allIngredientKeys, selected, initialIngredients, onComplete]);

  const hasMounted = useRef(false);
  useEffect(() => {
    if (!initialIngredients) return;
    if (!hasMounted.current) { hasMounted.current = true; return; }
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(doAutoSave, 1000);
    return () => clearTimeout(autoSaveRef.current);
  }, [selected, customIngredients]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <img className={styles.logo} src="/prep-day-logo.png" alt="Prep Day" />
        <h2 className={styles.title}>What kinds of food would you like to eat on a regular basis?</h2>
        <p className={styles.subtitle}>
          {(() => {
            try {
              const diets = JSON.parse(localStorage.getItem('sunday-user-diet'));
              if (diets?.length) return `Filtered for: ${diets.join(', ')}`;
            } catch {}
            return "(Don't worry, you can update this later)";
          })()}
        </p>

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
          {filteredCategoryOrder.map(cat => (
            <div key={cat} className={styles.column}>
              <h3 className={styles.categoryHeading}>{cat}</h3>
              {filteredCategories[cat].map(key => renderItem(key))}
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
          {!initialIngredients && (
            <button
              className={styles.startBtn}
              onClick={handleSubmit}
              disabled={selected.size === 0}
            >
              Get Started
            </button>
          )}
        </div>
        {showSaved && (
          <div className={styles.savedToast}>Saved!</div>
        )}
        {onSkip && (
          <button className={styles.skipBtn} onClick={onSkip}>
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
