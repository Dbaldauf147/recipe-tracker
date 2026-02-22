import { useState, useMemo } from 'react';
import { DEFAULT_KEY_INGREDIENTS, displayName } from '../utils/keyIngredients';
import styles from './OnboardingPage.module.css';

export function OnboardingPage({ onComplete }) {
  const [selected, setSelected] = useState(() => new Set(DEFAULT_KEY_INGREDIENTS));
  const [customIngredients, setCustomIngredients] = useState([]);
  const [customInput, setCustomInput] = useState('');
  const [search, setSearch] = useState('');

  const allIngredients = useMemo(
    () => [...DEFAULT_KEY_INGREDIENTS, ...customIngredients],
    [customIngredients]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return allIngredients;
    const q = search.toLowerCase();
    return allIngredients.filter(key =>
      displayName(key).toLowerCase().includes(q)
    );
  }, [allIngredients, search]);

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

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <img className={styles.logo} src="/sunday-logo.png" alt="Sunday" />
        <p className={styles.subtitle}>Choose the ingredients you want to track</p>

        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search ingredients..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <div className={styles.chipGrid}>
          {filtered.map(key => (
            <button
              key={key}
              className={`${styles.chip} ${selected.has(key) ? styles.chipSelected : ''}`}
              onClick={() => isCustom(key) ? (selected.has(key) ? toggle(key) : toggle(key)) : toggle(key)}
            >
              {displayName(key)}
              {isCustom(key) && (
                <span
                  className={styles.chipRemove}
                  onClick={e => { e.stopPropagation(); handleRemoveCustom(key); }}
                >
                  &times;
                </span>
              )}
            </button>
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
