import { useState, useEffect } from 'react';
import { loadAllUsers } from '../utils/firestoreSync';
import styles from './AdminDashboard.module.css';

export function AdminDashboard({ onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState('lastLogin');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    loadAllUsers()
      .then(setUsers)
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

  const arrow = (field) => sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onClose}>
        &larr; Back
      </button>
      <h2 className={styles.heading}>Admin Dashboard</h2>

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
