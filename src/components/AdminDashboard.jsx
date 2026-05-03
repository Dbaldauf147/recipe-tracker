import { useState, useEffect, useRef } from 'react';
import { loadAllUsers, deleteUserDoc, savePendingSetup, saveField, loadRecipesFromFirestore, saveRecipesToFirestore } from '../utils/firestoreSync';
import { parseRecipeText } from '../utils/parseRecipeText';
import { classifyMealType } from '../utils/classifyMealType';
import { fetchRecipesFromSheet } from '../utils/sheetRecipes';
import { PENDING_RECIPE_FIXES } from '../utils/pendingRecipeFixes';
import { auth } from '../firebase';
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

  const [libCopyEmail, setLibCopyEmail] = useState('');
  const [libCopySaving, setLibCopySaving] = useState(false);
  const [libCopyMsg, setLibCopyMsg] = useState('');

  const [fillLoading, setFillLoading] = useState(false);
  const [fillApplying, setFillApplying] = useState(false);
  const [fillPreview, setFillPreview] = useState(null);
  const [fillDone, setFillDone] = useState('');
  const [overrideApplying, setOverrideApplying] = useState(false);
  const [overrideMsg, setOverrideMsg] = useState('');
  const [fillError, setFillError] = useState('');

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

  async function handleCopyLibrary() {
    const targetEmail = libCopyEmail.trim().toLowerCase();
    if (!targetEmail) return;
    setLibCopySaving(true);
    setLibCopyMsg('');
    try {
      const myUid = auth.currentUser?.uid;
      if (!myUid) throw new Error('Not signed in.');
      const me = users.find(u => u.uid === myUid);
      const myLibrary = (me?.exerciseLibrary || []);
      if (myLibrary.length === 0) throw new Error('Your exerciseLibrary is empty — nothing to copy.');

      const target = users.find(u => (u.email || '').toLowerCase() === targetEmail);
      if (!target) {
        throw new Error(`No user found with email ${targetEmail}. Have they signed up yet?`);
      }
      if (target.uid === myUid) {
        throw new Error('That is your own account.');
      }

      const targetName = target.displayName || target.email || target.uid;
      const targetExisting = (target.exerciseLibrary || []).length;
      if (targetExisting > 0) {
        const ok = window.confirm(
          `${targetName} already has ${targetExisting} exercise${targetExisting === 1 ? '' : 's'} in their library. ` +
          `This will REPLACE them with your ${myLibrary.length} exercise${myLibrary.length === 1 ? '' : 's'}. Continue?`
        );
        if (!ok) {
          setLibCopySaving(false);
          return;
        }
      }

      await saveField(target.uid, 'exerciseLibrary', myLibrary);
      setUsers(prev => prev.map(u => u.uid === target.uid ? { ...u, exerciseLibrary: myLibrary } : u));
      setLibCopyMsg(`✓ Copied ${myLibrary.length} exercise${myLibrary.length === 1 ? '' : 's'} to ${targetName}.`);
      setLibCopyEmail('');
    } catch (err) {
      setLibCopyMsg(`✗ ${err.message || 'Failed to copy'}`);
    } finally {
      setLibCopySaving(false);
    }
  }

  async function handlePreviewFill() {
    setFillLoading(true);
    setFillPreview(null);
    setFillDone('');
    setFillError('');
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('Not logged in');
      const sheetRecipes = await fetchRecipesFromSheet();
      const existing = (await loadRecipesFromFirestore(uid)) || [];
      const byTitle = new Map(sheetRecipes.map(r => [r.title.toLowerCase().trim(), r]));
      const updates = [];
      const updatedRecipes = existing.map(r => {
        const sheet = byTitle.get((r.title || '').toLowerCase().trim());
        if (!sheet) return r;
        const fields = {};
        const stepCount = (r.instructions || '').split('\n').map(s => s.trim()).filter(Boolean).length;
        // Treat <=1 step as "effectively missing" so stub instructions get replaced
        // with the full list from the sheet.
        const instructionsLooksThin = stepCount <= 1;
        const sheetStepCount = (sheet.instructions || '').split('\n').map(s => s.trim()).filter(Boolean).length;
        const hasIngredients = Array.isArray(r.ingredients) && r.ingredients.length > 0;
        if (instructionsLooksThin && sheet.instructions && sheetStepCount > stepCount) {
          fields.instructions = sheet.instructions;
        }
        if (!hasIngredients && sheet.ingredients.length > 0) {
          fields.ingredients = sheet.ingredients;
        }
        if (Object.keys(fields).length === 0) return r;
        updates.push({ title: r.title, filledFields: Object.keys(fields) });
        return { ...r, ...fields, updatedAt: new Date().toISOString() };
      });
      const matchedTitles = new Set(
        existing.map(r => (r.title || '').toLowerCase().trim())
      );
      const unmatchedSheet = sheetRecipes.filter(
        r => !matchedTitles.has(r.title.toLowerCase().trim())
      );
      setFillPreview({ updates, updatedRecipes, sheetCount: sheetRecipes.length, existingCount: existing.length, unmatchedSheet });
    } catch (err) {
      setFillError(err.message || String(err));
    }
    setFillLoading(false);
  }

  async function handleApplyFill() {
    if (!fillPreview || fillPreview.updates.length === 0) return;
    setFillApplying(true);
    setFillError('');
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('Not logged in');
      await saveRecipesToFirestore(uid, fillPreview.updatedRecipes);
      // Push the new recipes into localStorage and notify the rest of the app
      // so the detail views refresh without a manual reload.
      try {
        localStorage.setItem('recipe-tracker-recipes', JSON.stringify(fillPreview.updatedRecipes));
        window.dispatchEvent(new Event('firestore-sync'));
      } catch {}
      setFillDone(`Updated ${fillPreview.updates.length} recipe${fillPreview.updates.length !== 1 ? 's' : ''}`);
      setFillPreview(null);
    } catch (err) {
      setFillError(err.message || String(err));
    }
    setFillApplying(false);
  }

  async function handleApplyRecipeFixes() {
    setOverrideApplying(true);
    setOverrideMsg('');
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('Not logged in');
      const existing = (await loadRecipesFromFirestore(uid)) || [];
      const fixByTitle = new Map(
        PENDING_RECIPE_FIXES.map(f => [f.title.toLowerCase().trim(), f])
      );
      const applied = [];
      const skipped = [];
      const updatedRecipes = existing.map(r => {
        const fix = fixByTitle.get((r.title || '').toLowerCase().trim());
        if (!fix) return r;
        const fields = {};
        if (fix.instructions !== undefined && fix.instructions !== r.instructions) {
          fields.instructions = fix.instructions;
        }
        if (fix.ingredients !== undefined) {
          fields.ingredients = fix.ingredients;
        }
        if (fix.stepsArray !== undefined) {
          fields.stepsArray = fix.stepsArray;
        }
        if (fix.stepIngredients !== undefined) {
          fields.stepIngredients = fix.stepIngredients;
        }
        if (Object.keys(fields).length === 0) {
          skipped.push(r.title);
          return r;
        }
        applied.push(r.title);
        return { ...r, ...fields, updatedAt: new Date().toISOString() };
      });
      const seenTitles = new Set(existing.map(r => (r.title || '').toLowerCase().trim()));
      const missing = PENDING_RECIPE_FIXES
        .filter(f => !seenTitles.has(f.title.toLowerCase().trim()))
        .map(f => f.title);
      if (applied.length > 0) {
        await saveRecipesToFirestore(uid, updatedRecipes);
        // Push into localStorage and notify useRecipes so the UI refreshes.
        try {
          localStorage.setItem('recipe-tracker-recipes', JSON.stringify(updatedRecipes));
          window.dispatchEvent(new Event('firestore-sync'));
        } catch {}
      }
      const parts = [];
      parts.push(`Applied ${applied.length}${applied.length ? `: ${applied.join(', ')}` : ''}`);
      if (skipped.length) parts.push(`unchanged: ${skipped.join(', ')}`);
      if (missing.length) parts.push(`not in account: ${missing.join(', ')}`);
      setOverrideMsg(parts.join(' · '));
    } catch (err) {
      setOverrideMsg(`Error: ${err.message || String(err)}`);
    }
    setOverrideApplying(false);
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

      {/* Copy Workout Library to Another User */}
      <div className={styles.sourceSection}>
        <h3 className={styles.sourceHeading}>Copy Workout Library to User</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
          Replaces the target user&apos;s <code>exerciseLibrary</code> with a copy of yours. Their workout log is not touched.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <input
            className={styles.setupInput}
            type="email"
            placeholder="Target user's email"
            value={libCopyEmail}
            onChange={e => setLibCopyEmail(e.target.value)}
          />
          <button
            className={styles.setupBtn}
            disabled={!libCopyEmail.trim() || libCopySaving}
            onClick={handleCopyLibrary}
            style={{ opacity: !libCopyEmail.trim() ? 0.5 : 1 }}
          >
            {libCopySaving ? 'Copying...' : 'Copy My Library →'}
          </button>
        </div>
        {libCopyMsg && (
          <div style={{
            fontSize: '0.85rem',
            fontWeight: 600,
            color: libCopyMsg.startsWith('✓') ? 'var(--color-success, #16a34a)' : 'var(--color-danger, #c0392b)',
          }}>
            {libCopyMsg}
          </div>
        )}
      </div>

      {/* Fill Recipe Gaps from Sheet */}
      <div className={styles.sourceSection}>
        <h3 className={styles.sourceHeading}>Fill Recipe Gaps from Sheet</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
          Scans your recipes and fills empty <code>ingredients</code> from the master Google Sheet, and replaces <code>instructions</code> when the recipe currently has 0 or 1 step (stub/imported placeholder). Matches by title. Runs against the currently logged-in account.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <button className={styles.setupBtn} onClick={handlePreviewFill} disabled={fillLoading || fillApplying}>
            {fillLoading ? 'Scanning...' : 'Preview Fill'}
          </button>
          {fillPreview && fillPreview.updates.length > 0 && (
            <button
              className={styles.setupBtn}
              onClick={handleApplyFill}
              disabled={fillApplying}
              style={{ background: 'var(--color-accent, #3B6B9C)', color: 'white' }}
            >
              {fillApplying ? 'Applying...' : `Apply Fill (${fillPreview.updates.length})`}
            </button>
          )}
        </div>
        {fillError && (
          <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{fillError}</p>
        )}
        {fillDone && (
          <p style={{ color: 'var(--color-success)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>{fillDone}</p>
        )}
        {fillPreview && (
          <div style={{ fontSize: '0.82rem' }}>
            <p style={{ marginBottom: '0.5rem' }}>
              Scanned {fillPreview.existingCount} of your recipes against {fillPreview.sheetCount} from the sheet.{' '}
              <strong>{fillPreview.updates.length}</strong> would be updated.
            </p>
            {fillPreview.updates.length > 0 ? (
              <ul style={{ margin: '0.35rem 0 0.75rem', paddingLeft: '1.2rem', maxHeight: '240px', overflowY: 'auto' }}>
                {fillPreview.updates.map((u, i) => (
                  <li key={i}>
                    <strong>{u.title}</strong> — filling: {u.filledFields.join(', ')}
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>Nothing to fill — all matched recipes already have ingredients and instructions.</p>
            )}
            {fillPreview.unmatchedSheet.length > 0 && (
              <details style={{ color: 'var(--color-text-muted)' }}>
                <summary style={{ cursor: 'pointer' }}>
                  {fillPreview.unmatchedSheet.length} sheet recipe{fillPreview.unmatchedSheet.length !== 1 ? 's' : ''} not in your account (not added, review only)
                </summary>
                <ul style={{ margin: '0.35rem 0', paddingLeft: '1.2rem' }}>
                  {fillPreview.unmatchedSheet.map((r, i) => <li key={i}>{r.title}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Apply one-shot pending recipe fixes (hard overrides) */}
      <div className={styles.sourceSection}>
        <h3 className={styles.sourceHeading}>Apply Pending Recipe Fixes</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
          Overwrites matching fields on the currently logged-in account's recipes with the {PENDING_RECIPE_FIXES.length} entr{PENDING_RECIPE_FIXES.length === 1 ? 'y' : 'ies'} in <code>src/utils/pendingRecipeFixes.js</code>. Unlike Fill Recipe Gaps, this <em>does</em> overwrite existing instructions/ingredients. Matches by title.
        </p>
        <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.2rem', fontSize: '0.82rem' }}>
          {PENDING_RECIPE_FIXES.map(f => (
            <li key={f.title}>
              {f.title} — {[
                f.instructions !== undefined && 'instructions',
                f.ingredients !== undefined && 'ingredients',
                f.stepsArray !== undefined && 'stepsArray',
                f.stepIngredients !== undefined && 'stepIngredients',
              ].filter(Boolean).join(', ') || 'no fields'}
            </li>
          ))}
        </ul>
        <button
          className={styles.setupBtn}
          onClick={handleApplyRecipeFixes}
          disabled={overrideApplying || PENDING_RECIPE_FIXES.length === 0}
          style={{ background: 'var(--color-accent, #3B6B9C)', color: 'white' }}
        >
          {overrideApplying ? 'Applying...' : 'Apply Recipe Fixes'}
        </button>
        {overrideMsg && (
          <p style={{
            fontSize: '0.85rem',
            marginTop: '0.5rem',
            color: overrideMsg.startsWith('Error') ? 'var(--color-danger)' : 'var(--color-text)',
          }}>{overrideMsg}</p>
        )}
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
