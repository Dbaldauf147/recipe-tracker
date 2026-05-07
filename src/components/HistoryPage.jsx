import React, { useState } from 'react';
import { auth } from '../firebase';
import { saveField, listFullBackups, restoreFieldFromBackup } from '../utils/firestoreSync';
import { importSheetHistory } from '../utils/importHistory';
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
  const user = auth.currentUser;
  if (user) saveField(user.uid, 'planHistory', entries);
  // Notify other views (Recipe List suggestions, etc.) that plan history
  // has changed so their localStorage-backed memos can refresh.
  try { window.dispatchEvent(new Event('firestore-sync')); } catch {}
}

function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const monthName = date.toLocaleString('en-US', { month: 'long' });
  const d = date.getDate();
  const suffix = d === 1 || d === 21 || d === 31 ? 'st'
    : d === 2 || d === 22 ? 'nd'
    : d === 3 || d === 23 ? 'rd' : 'th';
  return `${monthName} ${d}${suffix}`;
}

function getYear(dateStr) {
  return dateStr.split('-')[0];
}

export function HistoryPage({ getRecipe, recipes, onClose }) {
  const [entries, setEntries] = useState(loadHistory);
  const [editingDate, setEditingDate] = useState(null);
  const [editingCell, setEditingCell] = useState(null); // { timestamp, index }
  const [importStatus, setImportStatus] = useState(null); // null | 'done' | { imported, skipped, unmatched }
  const [showRestore, setShowRestore] = useState(false);
  const [backups, setBackups] = useState(null);
  const [restoreStatus, setRestoreStatus] = useState(null);
  const [restoring, setRestoring] = useState(false);

  async function openRestore() {
    setShowRestore(true);
    setRestoreStatus(null);
    if (!auth.currentUser?.uid) return;
    try {
      const list = await listFullBackups(auth.currentUser.uid);
      setBackups(list);
    } catch (err) {
      setRestoreStatus(`Failed to list backups: ${err?.message || err}`);
    }
  }

  async function restoreFrom(backupId) {
    if (!auth.currentUser?.uid) return;
    setRestoring(true);
    setRestoreStatus(null);
    try {
      const count = await restoreFieldFromBackup(auth.currentUser.uid, backupId, 'planHistory');
      setEntries(loadHistory());
      setRestoreStatus(`Restored ${count} entries from ${backupId}.`);
    } catch (err) {
      setRestoreStatus(`Restore failed: ${err?.message || err}`);
    } finally {
      setRestoring(false);
    }
  }

  function handleImport() {
    const result = importSheetHistory(recipes);
    setImportStatus(result);
    setEntries(loadHistory());
    try { window.dispatchEvent(new Event('firestore-sync')); } catch {}
  }

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
        <h2 className={styles.title}>Meal History</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className={styles.importBtn} onClick={openRestore} style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fbbf24' }}>
            Restore from backup…
          </button>
          {importStatus === null ? (
            <button className={styles.importBtn} onClick={handleImport}>
              Import History
            </button>
          ) : (
            <span className={styles.importResult}>
              Imported {importStatus.imported} weeks
              {importStatus.skipped > 0 && `, ${importStatus.skipped} skipped`}
              {importStatus.unmatched > 0 && `, ${importStatus.unmatched} unmatched recipes`}
            </span>
          )}
        </div>
      </div>

      {showRestore && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }} onClick={() => setShowRestore(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface, #fff)', borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Restore Meal History from backup</h3>
              <button onClick={() => setShowRestore(false)} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#666' }}>×</button>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#666', marginTop: 0 }}>
              Showing daily snapshots stored under your account. Pick the most recent one with a non-zero entry count.
            </p>
            {restoreStatus && (
              <p style={{ fontSize: '0.9rem', padding: '0.5rem 0.75rem', background: restoreStatus.startsWith('Restored') ? '#dcfce7' : '#fee2e2', color: restoreStatus.startsWith('Restored') ? '#166534' : '#991b1b', borderRadius: 6 }}>{restoreStatus}</p>
            )}
            {backups == null ? (
              <p style={{ color: '#666', fontSize: '0.9rem' }}>Loading…</p>
            ) : backups.length === 0 ? (
              <p style={{ color: '#666', fontSize: '0.9rem' }}>No backups found for this account yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Date</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Source</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>History</th>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Weights</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map(b => (
                    <tr key={b.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '0.4rem 0.5rem' }}>{b.date}</td>
                      <td style={{ padding: '0.4rem 0.5rem', color: '#666', fontSize: '0.8rem' }}>{b.source}</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: b.planHistoryCount > 0 ? 700 : 400, color: b.planHistoryCount > 0 ? '#166534' : '#9ca3af' }}>{b.planHistoryCount}</td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: '#666' }}>{b.weightLogCount}</td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>
                        <button
                          disabled={restoring || b.planHistoryCount === 0}
                          onClick={() => restoreFrom(b.id)}
                          style={{ padding: '0.3rem 0.7rem', borderRadius: 6, border: '1px solid #16a34a', background: b.planHistoryCount > 0 ? '#16a34a' : '#9ca3af', color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: b.planHistoryCount > 0 ? 'pointer' : 'not-allowed', opacity: restoring ? 0.5 : 1 }}
                        >
                          {restoring ? 'Restoring…' : 'Restore'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className={styles.empty}>
          No history yet — save a weekly menu to start tracking your meal history
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
              {sorted.map((entry, idx) => {
                const year = getYear(entry.date);
                const prevYear = idx > 0 ? getYear(sorted[idx - 1].date) : null;
                const showYear = year !== prevYear;
                const isAddingNew = editingCell &&
                  editingCell.timestamp === entry.timestamp &&
                  editingCell.index === 'new';

                return (
                  <React.Fragment key={entry.timestamp}>
                  {showYear && (
                    <tr className={styles.yearRow}>
                      <td colSpan={3} className={styles.yearCell}>{year}</td>
                    </tr>
                  )}
                  <tr>
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
                          {formatDate(entry.date)}
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
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
