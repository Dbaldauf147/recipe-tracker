import { useState, useEffect, useRef } from 'react';
import { loadAllUsers, deleteUserDoc, savePendingSetup, saveField } from '../utils/firestoreSync';
import { parseRecipeText } from '../utils/parseRecipeText';
import { classifyMealType } from '../utils/classifyMealType';
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

function getUserEngagement(u) {
  const logins = u.loginCount || 0;
  const recipes = (u.recipes || []).length;
  const daysSinceLast = u.lastLogin ? Math.floor((Date.now() - new Date(u.lastLogin).getTime()) / 86400000) : 999;

  if (logins >= 10 && daysSinceLast <= 14) return { label: 'Active', color: '#16a34a' };
  if (logins >= 5 && daysSinceLast <= 30) return { label: 'Regular', color: '#3B6B9C' };
  if (logins >= 2 && daysSinceLast <= 60) return { label: 'Returning', color: '#D4A574' };
  if (logins >= 2) return { label: 'Lapsed', color: '#e67e22' };
  if (logins === 1 && recipes > 0) return { label: 'Tried It', color: '#8b5cf6' };
  if (logins === 1) return { label: 'One-Time', color: '#c0392b' };
  return { label: 'New', color: 'var(--color-text-muted)' };
}

export function AdminDashboard({ onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cleanedCount, setCleanedCount] = useState(0);
  const [sortField, setSortField] = useState('lastLogin');
  const [sortDir, setSortDir] = useState('desc');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupRecipes, setSetupRecipes] = useState([]);
  const [setupSaving, setSetupSaving] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  const setupFileRef = useRef(null);

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

  async function handleSetupFiles(e) {
    const files = Array.from(e.target.files || []);
    const recipes = [];
    for (const file of files) {
      let text = '';
      let docTitle = '';
      const fileTitle = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').trim();
      if (file.name.toLowerCase().endsWith('.docx')) {
        const { default: JSZip } = await import('jszip');
        const zip = await JSZip.loadAsync(file);
        const xml = await zip.file('word/document.xml')?.async('string');
        // Try to extract title from heading styles
        if (xml) {
          const tm = xml.match(/<w:pStyle w:val="(?:Title|Heading1|Heading 1)"[^/]*\/>[^]*?<w:t[^>]*>([^<]+)<\/w:t>/i);
          if (tm) docTitle = tm[1].trim();
          if (!docTitle) {
            try {
              const coreXml = await zip.file('docProps/core.xml')?.async('string');
              const ct = coreXml?.match(/<dc:title>([^<]+)<\/dc:title>/);
              if (ct) docTitle = ct[1].trim();
            } catch {}
          }
        }
        text = xml ? xml.replace(/<w:br[^>]*\/>/gi, '\n').replace(/<w:p[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim() : '';
      } else {
        text = await file.text();
      }
      if (!text.trim()) continue;
      const sections = text.split(/(?:\n\s*[-=]{3,}\s*\n)|(?:\n{3,})/).filter(s => s.trim());
      for (const section of sections) {
        const parsed = parseRecipeText(section);
        if (parsed.title || parsed.ingredients.length > 0) {
          recipes.push({ ...parsed, title: parsed.title || docTitle || fileTitle, category: 'lunch-dinner', frequency: 'common', servings: '1', mealType: classifyMealType(parsed.ingredients), source: 'admin-setup' });
        }
      }
    }
    setSetupRecipes(prev => [...prev, ...recipes]);
    e.target.value = '';
  }

  async function handleSaveSetup() {
    if (!setupEmail.trim() || setupRecipes.length === 0) return;
    setSetupSaving(true);
    try {
      await savePendingSetup(setupEmail.trim(), setupRecipes);
      setSetupDone(true);
      setTimeout(() => setSetupDone(false), 5000);
      setSetupEmail('');
      setSetupRecipes([]);
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
    setSetupSaving(false);
  }

  // Engagement stats
  const engagementCounts = users.reduce((acc, u) => {
    const e = getUserEngagement(u);
    acc[e.label] = (acc[e.label] || 0) + 1;
    return acc;
  }, {});

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

      {/* Engagement breakdown */}
      {!loading && (
        <div className={styles.sourceSection}>
          <h3 className={styles.sourceHeading}>User Engagement</h3>
          <div className={styles.sourceGrid}>
            {['Active', 'Regular', 'Returning', 'Tried It', 'One-Time', 'Lapsed', 'New'].filter(l => engagementCounts[l]).map(label => {
              const count = engagementCounts[label];
              const pct = Math.round((count / users.length) * 100);
              const colors = { Active: '#16a34a', Regular: '#3B6B9C', Returning: '#D4A574', 'Tried It': '#8b5cf6', 'One-Time': '#c0392b', Lapsed: '#e67e22', New: '#999' };
              return (
                <div key={label} className={styles.sourceRow}>
                  <span className={styles.sourceLabel} style={{ color: colors[label] }}>{label}</span>
                  <div className={styles.sourceBarWrap}>
                    <div className={styles.sourceBar} style={{ width: `${pct}%`, background: colors[label] }} />
                  </div>
                  <span className={styles.sourceCount}>{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
            Active: 10+ logins, seen in 14d · Regular: 5+ logins, 30d · Returning: 2+ logins, 60d · Lapsed: 2+ logins, 60d+ · Tried It: 1 login with recipes · One-Time: 1 login, no recipes
          </p>
        </div>
      )}

      {/* New User Setup */}
      <div className={styles.sourceSection}>
        <h3 className={styles.sourceHeading}>Set Up New User</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
          Load recipes for a new user. When they sign up with this email, recipes will be added to their account automatically.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <input
            className={styles.setupInput}
            type="email"
            placeholder="New user's email"
            value={setupEmail}
            onChange={e => setSetupEmail(e.target.value)}
          />
          <input ref={setupFileRef} type="file" accept=".docx,.doc,.txt,.md" multiple style={{ display: 'none' }} onChange={handleSetupFiles} />
          <button className={styles.setupBtn} onClick={() => setupFileRef.current?.click()}>
            + Upload Recipes
          </button>
        </div>
        {setupRecipes.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{setupRecipes.length} recipe{setupRecipes.length !== 1 ? 's' : ''} loaded:</span>
            <ul style={{ margin: '0.35rem 0', paddingLeft: '1.2rem', fontSize: '0.82rem' }}>
              {setupRecipes.map((r, i) => (
                <li key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{r.title || 'Untitled'} ({r.ingredients.length} ingredients)</span>
                  <button style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: '1rem' }} onClick={() => setSetupRecipes(prev => prev.filter((_, j) => j !== i))}>&times;</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            className={styles.setupBtn}
            disabled={!setupEmail.trim() || setupRecipes.length === 0 || setupSaving}
            onClick={handleSaveSetup}
            style={{ opacity: (!setupEmail.trim() || setupRecipes.length === 0) ? 0.5 : 1 }}
          >
            {setupSaving ? 'Saving...' : 'Save & Send Login Info'}
          </button>
          {setupDone && <span style={{ color: 'var(--color-success)', fontWeight: 600, fontSize: '0.88rem' }}>Saved! User can now sign up with that email.</span>}
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
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(u => {
                const engagement = getUserEngagement(u);
                return (
                <tr key={u.uid}>
                  <td>{u.displayName || '—'}</td>
                  <td>{u.email || '—'}</td>
                  <td>{(u.recipes || []).length}</td>
                  <td>{u.loginCount || 0}</td>
                  <td title={formatDate(u.lastLogin)}>
                    {u.lastLogin ? timeAgo(u.lastLogin) : '—'}
                  </td>
                  <td><span style={{ fontSize: '0.75rem', fontWeight: 600, color: engagement.color, background: engagement.color + '15', padding: '0.15rem 0.45rem', borderRadius: '50px', whiteSpace: 'nowrap' }}>{engagement.label}</span></td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
