import React, { useState, useEffect, useMemo } from 'react';
import { auth } from '../firebase';
import { saveField, listFullBackups, restoreFieldFromBackup } from '../utils/firestoreSync';
import { importSheetHistory } from '../utils/importHistory';
import { NUTRIENTS } from '../utils/nutrition';
import { dayTotals, dayHasContent, countedSupplements, activeEntries, formatNutrient, resolveSupplements } from '../utils/dailyTotals';
import { RecipeStageHistory } from './RecipeStageHistory';
import { OWNER_EMAIL } from '../utils/pageAccess';
import styles from './HistoryPage.module.css';

const HISTORY_KEY = 'sunday-plan-history';
// Written by the Daily Tracker; read here so the Daily tab reports exactly
// what was logged, without a second copy of the data.
const DAILY_LOG_KEY = 'sunday-daily-log';
const GOALS_KEY = 'sunday-nutrition-goals';

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

function loadDailyLog() {
  try {
    const raw = localStorage.getItem(DAILY_LOG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadGoals() {
  try {
    const raw = localStorage.getItem(GOALS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// "Sat, Sep 12" — short enough to sit in a row, unambiguous across years.
function formatDayLabel(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  const thisYear = new Date().getFullYear();
  return date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(y === thisYear ? {} : { year: 'numeric' }),
  });
}

function entryLabel(entry, getRecipe) {
  return entry?.recipeName
    || entry?.ingredientName
    || (entry?.recipeId ? getRecipe?.(entry.recipeId)?.title : null)
    || 'Logged item';
}

const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];
const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat'];
const DAYS_PER_PAGE = 30;

/**
 * One day of the food log, expandable. Collapsed it's the headline macros;
 * open it lists what was eaten, the supplements taken, and every nutrient the
 * day came to — meals and supplements together, matching the tracker's card.
 */
function DailyRow({ date, day, goals, getRecipe, supplements = [], suppCarried = false }) {
  const [open, setOpen] = useState(false);
  // The day as it counts: its own meals, plus the supplements it either
  // recorded or inherits from the standing list.
  const dayWithSupps = useMemo(() => ({ ...day, supplements }), [day, supplements]);
  const { totals, fromSupplements, mealCount, skipped } = useMemo(() => dayTotals(dayWithSupps), [dayWithSupps]);
  const countedIds = useMemo(
    () => new Set(countedSupplements(supplements).map(c => c.supplement.id)),
    [supplements]
  );

  const nutrientRows = NUTRIENTS.filter(n => (totals[n.key] || 0) > 0 || (goals?.[n.key] || 0) > 0);
  const meals = activeEntries(day);
  const bySlot = SLOT_ORDER
    .map(slot => ({ slot, items: meals.filter(e => (e.mealSlot || (e.type === 'custom' ? 'snack' : 'snack')) === slot) }))
    .filter(g => g.items.length > 0);

  return (
    <div className={styles.dailyCard}>
      <button className={styles.dailyHead} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={styles.dailyDate}>{formatDayLabel(date)}</span>
        {skipped ? (
          <span className={styles.dailySkipped}>Day skipped</span>
        ) : mealCount === 0 ? (
          // A day with supplements but no meals: a row of zeroed macros would
          // read as "you ate nothing measurable", which isn't what happened.
          <span className={styles.dailySkipped}>Supplements only</span>
        ) : (
          <span className={styles.dailyMacros}>
            {MACRO_KEYS.map(key => {
              const n = NUTRIENTS.find(x => x.key === key);
              return (
                <span key={key} className={styles.dailyMacro}>
                  <strong>{formatNutrient(totals[key], n)}</strong>
                  <span className={styles.dailyMacroLabel}>{key === 'calories' ? 'cal' : `g ${n.label.toLowerCase()}`}</span>
                </span>
              );
            })}
          </span>
        )}
        <span className={styles.dailyMeta}>
          {mealCount > 0 && <span>{mealCount} item{mealCount === 1 ? '' : 's'}</span>}
          {supplements.length > 0 && (
            <span className={styles.dailySupPill}>
              {supplements.length} supplement{supplements.length === 1 ? '' : 's'}
            </span>
          )}
          <span className={styles.dailyChevron}>{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {open && (
        <div className={styles.dailyBody}>
          <div className={styles.dailyCol}>
            <h4 className={styles.dailyColTitle}>Eaten</h4>
            {bySlot.length === 0 ? (
              <p className={styles.dailyNone}>Nothing logged.</p>
            ) : bySlot.map(g => (
              <div key={g.slot} className={styles.dailySlot}>
                <span className={styles.dailySlotName}>{g.slot}</span>
                <ul className={styles.dailyList}>
                  {g.items.map((e, i) => (
                    <li key={e.id || i}>
                      {entryLabel(e, getRecipe)}
                      {e.servings ? <span className={styles.dailyDim}> × {e.servings}</span> : null}
                      {e.nutrition?.calories ? <span className={styles.dailyDim}> · {Math.round(e.nutrition.calories)} cal</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {day?.skippedMeals?.length > 0 && (
              <p className={styles.dailyNote}>Skipped: {day.skippedMeals.join(', ')}</p>
            )}

            <h4 className={styles.dailyColTitle}>
              Supplements
              {suppCarried && <span className={styles.dailyCarried} title="This day didn't record its own list, so it uses your standing daily supplements."> · carried forward</span>}
            </h4>
            {supplements.length === 0 ? (
              <p className={styles.dailyNone}>None logged.</p>
            ) : (
              <ul className={styles.dailyList}>
                {supplements.map((s, i) => (
                  <li key={s.id || i}>
                    {s.name || s.nutrientKey || 'Supplement'}
                    {s.amount ? <span className={styles.dailyDim}> · {s.amount}{s.unit ? ` ${s.unit}` : ''}</span> : null}
                    {!countedIds.has(s.id) && (
                      <span className={styles.dailyDim} title="No nutrient amount to add — it's on the record, but not in the totals."> · not counted</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.dailyCol}>
            <h4 className={styles.dailyColTitle}>Nutrients{skipped ? ' (day skipped)' : ''}</h4>
            {nutrientRows.length === 0 ? (
              <p className={styles.dailyNone}>Nothing to total.</p>
            ) : (
              <table className={styles.dailyTable}>
                <tbody>
                  {nutrientRows.map(n => {
                    const goal = goals?.[n.key] || 0;
                    const pct = goal > 0 ? Math.round((totals[n.key] / goal) * 100) : null;
                    const fromSup = fromSupplements?.[n.key] || 0;
                    return (
                      <tr key={n.key}>
                        <td className={styles.dailyNutLabel}>{n.label}</td>
                        <td className={styles.dailyNutValue}>
                          {formatNutrient(totals[n.key], n)}{n.unit ? ` ${n.unit}` : ''}
                          {fromSup > 0 && (
                            <span className={styles.dailyDim} title="Included above, from the day's supplements">
                              {' '}(incl. {formatNutrient(fromSup, n)} supp.)
                            </span>
                          )}
                        </td>
                        <td className={styles.dailyNutGoal}>
                          {pct == null ? '' : `${pct}% of ${formatNutrient(goal, n)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The Daily tab: one row per logged day, newest first. */
function DailyNutritionHistory({ getRecipe }) {
  const [log, setLog] = useState(loadDailyLog);
  const [goals, setGoals] = useState(loadGoals);
  const [limit, setLimit] = useState(DAYS_PER_PAGE);

  // The tracker fires `firestore-sync` after every save, and `storage` covers
  // another tab; without these the tab would show whatever was cached when
  // Meal History opened.
  useEffect(() => {
    const refresh = () => { setLog(loadDailyLog()); setGoals(loadGoals()); };
    window.addEventListener('firestore-sync', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('goals-updated', refresh);
    return () => {
      window.removeEventListener('firestore-sync', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('goals-updated', refresh);
    };
  }, []);

  const dates = useMemo(
    () => Object.keys(log).filter(d => dayHasContent(log[d])).sort().reverse(),
    [log]
  );

  // The standing supplement list, resolved per day (see resolveSupplements).
  const suppByDate = useMemo(() => resolveSupplements(log), [log]);

  // A week's averages read as the summary of recent eating; a single day is
  // noise. Days with no meals logged — skipped, or supplements only — would
  // drag every average towards zero, so they're out.
  const recentAvg = useMemo(() => {
    const days = dates.filter(d => (log[d]?.entries || []).length > 0 && !log[d]?.daySkipped).slice(0, 7);
    if (days.length === 0) return null;
    const sum = {};
    for (const key of MACRO_KEYS) sum[key] = 0;
    for (const d of days) {
      const { totals } = dayTotals({ ...log[d], supplements: suppByDate[d]?.supplements || [] });
      for (const key of MACRO_KEYS) sum[key] += totals[key] || 0;
    }
    return { days: days.length, avg: Object.fromEntries(MACRO_KEYS.map(k => [k, sum[k] / days.length])) };
  }, [dates, log, suppByDate]);

  if (dates.length === 0) {
    return (
      <p className={styles.empty}>
        No days logged yet. Meals you track on the Daily Tracker show up here, with the day's supplements.
      </p>
    );
  }

  return (
    <div>
      {recentAvg && (
        <div className={styles.dailyAvg}>
          <span className={styles.dailyAvgLabel}>
            Last {recentAvg.days} logged day{recentAvg.days === 1 ? '' : 's'}, average
          </span>
          {MACRO_KEYS.map(key => {
            const n = NUTRIENTS.find(x => x.key === key);
            return (
              <span key={key} className={styles.dailyMacro}>
                <strong>{formatNutrient(recentAvg.avg[key], n)}</strong>
                <span className={styles.dailyMacroLabel}>{key === 'calories' ? 'cal' : `g ${n.label.toLowerCase()}`}</span>
              </span>
            );
          })}
        </div>
      )}

      {dates.slice(0, limit).map(date => (
        <DailyRow
          key={date}
          date={date}
          day={log[date]}
          goals={goals}
          getRecipe={getRecipe}
          supplements={suppByDate[date]?.supplements || []}
          suppCarried={suppByDate[date]?.carried || false}
        />
      ))}

      {dates.length > limit && (
        <button className={styles.dailyMoreBtn} onClick={() => setLimit(l => l + DAYS_PER_PAGE)}>
          Show {Math.min(DAYS_PER_PAGE, dates.length - limit)} more day{dates.length - limit === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

export function HistoryPage({ getRecipe, recipes, deletedRecipes = [], onRestoreDeleted, onPurgeDeleted, onClose }) {
  const [entries, setEntries] = useState(loadHistory);
  // 'weeks'  = saved weekly menus (what this page has always been),
  // 'daily'  = per-day nutrients from the food log,
  // 'stages' = the weekly count of recipes at each development stage.
  const [tab, setTab] = useState('weeks');
  // `devStage` is owner-only (same gate as the chip that sets it and the pill
  // on the cards), so a tab that only ever charts zeroes stays hidden.
  const showStages = (auth.currentUser?.email || '').toLowerCase() === OWNER_EMAIL;
  const [editingDate, setEditingDate] = useState(null);
  const [editingCell, setEditingCell] = useState(null); // { timestamp, index }
  const [importStatus, setImportStatus] = useState(null); // null | 'done' | { imported, skipped, unmatched }
  const [showRestore, setShowRestore] = useState(false);
  const [backups, setBackups] = useState(null);
  const [restoreStatus, setRestoreStatus] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedStatus, setDeletedStatus] = useState(null);

  function handleRestoreDeleted(deletionId, title) {
    onRestoreDeleted?.(deletionId);
    setDeletedStatus(`Restored "${title}" to your recipes.`);
  }

  function handlePurgeDeleted(deletionId, title) {
    if (!window.confirm(`Permanently remove "${title}" from the deleted list? This can't be undone.`)) return;
    onPurgeDeleted?.(deletionId);
    setDeletedStatus(null);
  }

  const sortedDeleted = [...deletedRecipes].sort(
    (a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0)
  );

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
          <button className={styles.importBtn} onClick={() => { setShowDeleted(true); setDeletedStatus(null); }} style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' }}>
            Deleted Recipes{deletedRecipes.length > 0 ? ` (${deletedRecipes.length})` : ''}
          </button>
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

      {showDeleted && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }} onClick={() => setShowDeleted(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-surface, #fff)', borderRadius: 12, padding: '1.5rem', width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Deleted Recipes</h3>
              <button onClick={() => setShowDeleted(false)} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#666' }}>×</button>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#666', marginTop: 0 }}>
              Recipes you've deleted are kept here so you can bring them back. Only deletions from now on are tracked.
            </p>
            {deletedStatus && (
              <p style={{ fontSize: '0.9rem', padding: '0.5rem 0.75rem', background: '#dcfce7', color: '#166534', borderRadius: 6 }}>{deletedStatus}</p>
            )}
            {sortedDeleted.length === 0 ? (
              <p style={{ color: '#666', fontSize: '0.9rem' }}>No deleted recipes yet. When you delete a recipe, it'll show up here.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Recipe</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}>Deleted</th>
                    <th style={{ padding: '0.4rem 0.5rem' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDeleted.map(d => (
                    <tr key={d.deletionId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600 }}>{d.title || '(untitled)'}</td>
                      <td style={{ padding: '0.4rem 0.5rem', color: '#666', fontSize: '0.8rem' }}>
                        {d.deletedAt ? `${formatDate(d.deletedAt.slice(0, 10))}, ${getYear(d.deletedAt.slice(0, 10))}` : '—'}
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => handleRestoreDeleted(d.deletionId, d.title)}
                          style={{ padding: '0.3rem 0.7rem', borderRadius: 6, border: '1px solid #16a34a', background: '#16a34a', color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', marginRight: '0.4rem' }}
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => handlePurgeDeleted(d.deletionId, d.title)}
                          title="Remove permanently"
                          style={{ padding: '0.3rem 0.55rem', borderRadius: 6, border: '1px solid #e5e7eb', background: 'none', color: '#991b1b', fontSize: '0.9rem', cursor: 'pointer' }}
                        >
                          ×
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

      <div className={styles.subtabBar} role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'weeks'}
          className={`${styles.subtab} ${tab === 'weeks' ? styles.subtabActive : ''}`}
          onClick={() => setTab('weeks')}
        >
          Weekly Menus
        </button>
        <button
          role="tab"
          aria-selected={tab === 'daily'}
          className={`${styles.subtab} ${tab === 'daily' ? styles.subtabActive : ''}`}
          onClick={() => setTab('daily')}
        >
          Daily
        </button>
        {showStages && (
          <button
            role="tab"
            aria-selected={tab === 'stages'}
            className={`${styles.subtab} ${tab === 'stages' ? styles.subtabActive : ''}`}
            onClick={() => setTab('stages')}
          >
            Stages
          </button>
        )}
      </div>

      {tab === 'stages' && showStages ? (
        <RecipeStageHistory recipes={recipes} />
      ) : tab === 'daily' ? (
        <DailyNutritionHistory getRecipe={getRecipe} />
      ) : sorted.length === 0 ? (
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
