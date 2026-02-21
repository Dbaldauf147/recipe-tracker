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

export function HistoryPage({ getRecipe, recipes, onClose }) {
  const [entries, setEntries] = useState(loadHistory);
  const [editingDate, setEditingDate] = useState(null);
  const [editingCell, setEditingCell] = useState(null); // { timestamp, index }

  function persist(next) {
    saveHistory(next);
    setEntries(next);
  }

  function handleDelete(timestamp) {
    persist(entries.filter(e => e.timestamp !== timestamp));
  }

  function handleDateChange(timestamp, newDate) {
    persist(entries.map(e =>
      e.timestamp === timestamp ? { ...e, date: newDate } : e
    ));
    setEditingDate(null);
  }

  function handleRecipeChange(timestamp, index, newRecipeId) {
    persist(entries.map(e => {
      if (e.timestamp !== timestamp) return e;
      const ids = [...e.recipeIds];
      ids[index] = newRecipeId;
      return { ...e, recipeIds: ids };
    }));
    setEditingCell(null);
  }

  function handleRemoveRecipe(timestamp, index) {
    persist(entries.map(e => {
      if (e.timestamp !== timestamp) return e;
      const ids = e.recipeIds.filter((_, i) => i !== index);
      return { ...e, recipeIds: ids };
    }));
  }

  function handleAddRecipe(timestamp) {
    // Add a placeholder — user will pick via dropdown
    setEditingCell({ timestamp, index: 'new' });
  }

  function handleAddRecipeSelect(timestamp, recipeId) {
    persist(entries.map(e => {
      if (e.timestamp !== timestamp) return e;
      return { ...e, recipeIds: [...e.recipeIds, recipeId] };
    }));
    setEditingCell(null);
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
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Meals</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(entry => {
                const isAddingNew = editingCell &&
                  editingCell.timestamp === entry.timestamp &&
                  editingCell.index === 'new';

                return (
                  <tr key={entry.timestamp}>
                    <td className={styles.dateCell}>
                      {editingDate === entry.timestamp ? (
                        <input
                          type="date"
                          className={styles.dateInput}
                          defaultValue={entry.date}
                          autoFocus
                          onBlur={e => handleDateChange(entry.timestamp, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleDateChange(entry.timestamp, e.target.value);
                            if (e.key === 'Escape') setEditingDate(null);
                          }}
                        />
                      ) : (
                        <button
                          className={styles.dateBtn}
                          onClick={() => setEditingDate(entry.timestamp)}
                          title="Click to edit date"
                        >
                          {entry.date}
                        </button>
                      )}
                    </td>
                    <td className={styles.mealsCell}>
                      {entry.recipeIds.map((id, i) => {
                        const recipe = getRecipe(id);
                        const isEditing = editingCell &&
                          editingCell.timestamp === entry.timestamp &&
                          editingCell.index === i;

                        if (isEditing) {
                          return (
                            <span key={i} className={styles.mealEditWrap}>
                              <select
                                className={styles.mealSelect}
                                defaultValue={id}
                                autoFocus
                                onChange={e => handleRecipeChange(entry.timestamp, i, e.target.value)}
                                onBlur={() => setEditingCell(null)}
                              >
                                {recipe && <option value={id}>{recipe.title}</option>}
                                {recipes
                                  .filter(r => r.id !== id)
                                  .sort((a, b) => a.title.localeCompare(b.title))
                                  .map(r => (
                                    <option key={r.id} value={r.id}>{r.title}</option>
                                  ))
                                }
                              </select>
                            </span>
                          );
                        }

                        return (
                          <span key={i} className={styles.mealChip}>
                            <button
                              className={styles.mealName}
                              onClick={() => setEditingCell({ timestamp: entry.timestamp, index: i })}
                              title="Click to change"
                            >
                              {recipe ? recipe.title : '(deleted)'}
                            </button>
                            <button
                              className={styles.mealRemoveBtn}
                              onClick={() => handleRemoveRecipe(entry.timestamp, i)}
                              title="Remove"
                            >
                              &times;
                            </button>
                          </span>
                        );
                      })}
                      {isAddingNew ? (
                        <span className={styles.mealEditWrap}>
                          <select
                            className={styles.mealSelect}
                            defaultValue=""
                            autoFocus
                            onChange={e => {
                              if (e.target.value) handleAddRecipeSelect(entry.timestamp, e.target.value);
                            }}
                            onBlur={() => setEditingCell(null)}
                          >
                            <option value="" disabled>Pick a recipe...</option>
                            {recipes
                              .sort((a, b) => a.title.localeCompare(b.title))
                              .map(r => (
                                <option key={r.id} value={r.id}>{r.title}</option>
                              ))
                            }
                          </select>
                        </span>
                      ) : (
                        <button
                          className={styles.addMealBtn}
                          onClick={() => handleAddRecipe(entry.timestamp)}
                          title="Add a meal"
                        >
                          +
                        </button>
                      )}
                    </td>
                    <td className={styles.actionCell}>
                      <button
                        className={styles.deleteBtn}
                        onClick={() => handleDelete(entry.timestamp)}
                        title="Delete this entry"
                      >
                        &times;
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
