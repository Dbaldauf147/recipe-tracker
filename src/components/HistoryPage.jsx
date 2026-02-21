import { useState } from 'react';
import styles from './HistoryPage.module.css';

const HISTORY_KEY = 'sunday-plan-history';

function loadHistory() {
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {}
}

export function HistoryPage({ getRecipe, onClose }) {
  const [entries, setEntries] = useState(loadHistory);

  function handleDelete(timestamp) {
    const next = entries.filter(e => e.timestamp !== timestamp);
    saveHistory(next);
    setEntries(next);
  }

  // Reverse chronological order
  const sorted = [...entries].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose}>
          &larr; Back
        </button>
        <h2 className={styles.title}>History</h2>
      </div>

      {sorted.length === 0 ? (
        <p className={styles.empty}>
          No saved plans yet. Use "Save to History" in This Week's Menu to archive a plan.
        </p>
      ) : (
        <div className={styles.list}>
          {sorted.map(entry => {
            const recipes = entry.recipeIds
              .map(id => getRecipe(id))
              .filter(Boolean);

            return (
              <div key={entry.timestamp} className={styles.entry}>
                <div className={styles.entryHeader}>
                  <span className={styles.entryDate}>{entry.date}</span>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => handleDelete(entry.timestamp)}
                    title="Delete this entry"
                  >
                    &times;
                  </button>
                </div>
                {recipes.length === 0 ? (
                  <p className={styles.noRecipes}>Recipes no longer available</p>
                ) : (
                  <ul className={styles.recipeList}>
                    {recipes.map(r => (
                      <li key={r.id} className={styles.recipeName}>{r.title}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
