import { useState, useEffect } from 'react';
import { loadAllUsers, deleteUserDoc } from '../utils/firestoreSync';
import styles from './AdminDashboard.module.css';

/**
 * Auto-clean users: remove duplicates (same email, keep best) and empty users (no name, no recipes).
 * Returns the cleaned list.
 */
async function cleanupUsers(allUsers) {
  const toDelete = [];

  // 1. Find duplicates by email — keep the one with most recipes, then most logins
  const byEmail = {};
  for (const u of allUsers) {
    const email = (u.email || '').toLowerCase().trim();
    if (!email) continue;
    if (!byEmail[email]) byEmail[email] = [];
    byEmail[email].push(u);
  }
  for (const [, group] of Object.entries(byEmail)) {
    if (group.length <= 1) continue;
    // Sort: most recipes first, then most logins, then most recent login
    group.sort((a, b) => {
      const aRec = (a.recipes || []).length;
      const bRec = (b.recipes || []).length;
      if (aRec !== bRec) return bRec - aRec;
      const aLog = a.loginCount || 0;
      const bLog = b.loginCount || 0;
      if (aLog !== bLog) return bLog - aLog;
      return (b.lastLogin || '').localeCompare(a.lastLogin || '');
    });
    // Keep first, delete rest
    for (let i = 1; i < group.length; i++) {
      toDelete.push(group[i].uid);
    }
  }

  // 2. Remove users with no name AND no recipes AND no login history
  for (const u of allUsers) {
    if (toDelete.includes(u.uid)) continue;
    const hasName = (u.displayName || '').trim();
    const hasEmail = (u.email || '').trim();
    const hasRecipes = (u.recipes || []).length > 0;
    const hasLogins = (u.loginCount || 0) > 0;
    if (!hasName && !hasEmail && !hasRecipes && !hasLogins) {
      toDelete.push(u.uid);
    }
  }

  if (toDelete.length === 0) return allUsers;

  // Delete in parallel
  const deleteSet = new Set(toDelete);
  await Promise.all(toDelete.map(uid => deleteUserDoc(uid).catch(() => {})));
  return allUsers.filter(u => !deleteSet.has(u.uid));
}

export function AdminDashboard({ onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cleanedCount, setCleanedCount] = useState(0);
  const [sortField, setSortField] = useState('lastLogin');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    loadAllUsers()
      .then(async (allUsers) => {
        const before = allUsers.length;
        const cleaned = await cleanupUsers(allUsers);
        setCleanedCount(before - cleaned.length);
        setUsers(cleaned);
      })
      .catch(err => console.error('Failed to load users:', err))
      .finally(() => setLoading(false));
  }, []);

  function handleSort(field) {
    if (sortField === field) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  const sorted = [...users].sort((a, b) => {
    let aVal, bVal;
    if (sortField === 'recipeCount') {
      aVal = (a.recipes || []).length;
      bVal = (b.recipes || []).length;
    } else if (sortField === 'loginCount') {
      aVal = a.loginCount || 0;
      bVal = b.loginCount || 0;
    } else if (sortField === 'lastLogin') {
      aVal = a.lastLogin || '';
      bVal = b.lastLogin || '';
    } else if (sortField === 'displayName') {
      aVal = (a.displayName || '').toLowerCase();
      bVal = (b.displayName || '').toLowerCase();
    } else {
      aVal = a[sortField] || '';
      bVal = b[sortField] || '';
    }
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  const sourceCounts = users.reduce((acc, u) => {
    for (const r of (u.recipes || [])) {
      const src = r.source || 'unknown';
      acc[src] = (acc[src] || 0) + 1;
    }
    return acc;
  }, {});

  const sourceLabels = {
    url: 'URL',
    tiktok: 'TikTok',
    instagram: 'Instagram',
    paste: 'Paste Text',
    manual: 'Manual',
    starter: 'Starter Recipes',
    discover: 'Discover',
    shared: 'Shared',
    unknown: 'Unknown',
  };

  const sourceOrder = ['url', 'tiktok', 'instagram', 'paste', 'manual', 'starter', 'discover', 'shared', 'unknown'];
  const totalRecipesWithSource = Object.values(sourceCounts).reduce((a, b) => a + b, 0);

  const arrow = (field) => sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onClose}>
        &larr; Back
      </button>
      <h2 className={styles.heading}>Admin Dashboard</h2>
      {cleanedCount > 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0 0 0.75rem' }}>
          Cleaned {cleanedCount} duplicate/empty user{cleanedCount > 1 ? 's' : ''}
        </p>
      )}

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{users.length}</div>
          <div className={styles.statLabel}>Total Users</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>
            {users.reduce((sum, u) => sum + (u.recipes || []).length, 0)}
          </div>
          <div className={styles.statLabel}>Total Recipes</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>
            {users.filter(u => {
              if (!u.lastLogin) return false;
              return Date.now() - new Date(u.lastLogin).getTime() < 7 * 24 * 60 * 60 * 1000;
            }).length}
          </div>
          <div className={styles.statLabel}>Active (7d)</div>
        </div>
      </div>

      {!loading && totalRecipesWithSource > 0 && (
        <div className={styles.sourceSection}>
          <h3 className={styles.sourceHeading}>Recipe Import Methods</h3>
          <div className={styles.sourceGrid}>
            {sourceOrder
              .filter(src => sourceCounts[src] > 0)
              .map(src => {
                const count = sourceCounts[src];
                const pct = Math.round((count / totalRecipesWithSource) * 100);
                return (
                  <div key={src} className={styles.sourceRow}>
                    <span className={styles.sourceLabel}>{sourceLabels[src] || src}</span>
                    <div className={styles.sourceBarWrap}>
                      <div className={styles.sourceBar} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={styles.sourceCount}>{count} ({pct}%)</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {loading ? (
        <p className={styles.loading}>Loading users...</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => handleSort('displayName')} className={styles.sortable}>
                  Name{arrow('displayName')}
                </th>
                <th onClick={() => handleSort('email')} className={styles.sortable}>
                  Email{arrow('email')}
                </th>
                <th onClick={() => handleSort('recipeCount')} className={styles.sortable}>
                  Recipes{arrow('recipeCount')}
                </th>
                <th onClick={() => handleSort('loginCount')} className={styles.sortable}>
                  Logins{arrow('loginCount')}
                </th>
                <th onClick={() => handleSort('lastLogin')} className={styles.sortable}>
                  Last Login{arrow('lastLogin')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(u => (
                <tr key={u.uid}>
                  <td>{u.displayName || '—'}</td>
                  <td>{u.email || '—'}</td>
                  <td>{(u.recipes || []).length}</td>
                  <td>{u.loginCount || 0}</td>
                  <td title={formatDate(u.lastLogin)}>
                    {u.lastLogin ? timeAgo(u.lastLogin) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
