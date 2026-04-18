import { useEffect, useState, useRef } from 'react';
import styles from './UpdatePill.module.css';

const ACTION_LABELS = {
  added: 'Recipe added',
  updated: 'Recipe updated',
  removed: 'Recipe removed',
  imported: 'Recipes imported',
};

export function UpdatePill() {
  const [pill, setPill] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    function onChange(e) {
      const { action, detail } = e.detail || {};
      const label = ACTION_LABELS[action] || 'Updated';
      const message = detail ? `${label}: ${detail}` : label;
      setPill({ message, id: Date.now() });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setPill(null), 2500);
    }
    window.addEventListener('recipe-changed', onChange);
    return () => {
      window.removeEventListener('recipe-changed', onChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!pill) return null;

  return (
    <div className={styles.pill} role="status" aria-live="polite" key={pill.id}>
      <span className={styles.dot} aria-hidden />
      {pill.message}
    </div>
  );
}
