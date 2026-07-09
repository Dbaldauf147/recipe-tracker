import { useState, useEffect, useRef, Fragment } from 'react';
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
    // Count web OR mobile logins — a mobile-only user (loginCount 0 but
    // mobileLoginCount > 0) still has login history and must not be purged.
    const hasLogins = (u.loginCount || 0) > 0 || (u.mobileLoginCount || 0) > 0;
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
  // Engagement reflects overall activity across web AND mobile, so an
  // app-only user reads as Active rather than New.
  const logins = (u.loginCount || 0) + (u.mobileLoginCount || 0);
  const recipes = (u.recipes || []).length;
  const lastLoginIso = [u.lastLogin, u.mobileLastLogin]
    .filter(Boolean)
    .sort()
    .pop();
  const daysSinceLast = lastLoginIso ? Math.floor((Date.now() - new Date(lastLoginIso).getTime()) / 86400000) : 999;

  if (logins >= 10 && daysSinceLast <= 14) return { label: 'Active', color: '#16a34a' };
  if (logins >= 5 && daysSinceLast <= 30) return { label: 'Regular', color: '#3B6B9C' };
  if (logins >= 2 && daysSinceLast <= 60) return { label: 'Returning', color: '#D4A574' };
  if (logins >= 2) return { label: 'Lapsed', color: '#e67e22' };
  if (logins === 1 && recipes > 0) return { label: 'Tried It', color: '#8b5cf6' };
  if (logins === 1) return { label: 'One-Time', color: '#c0392b' };
  return { label: 'New', color: 'var(--color-text-muted)' };
}

// Which platform(s) a user actually signs in on, from their web vs app login
// counts. "Both" notes which side they were last seen on so a primarily-app
// user reads differently from a primarily-web one.
function getUserPlatform(u) {
  const web = u.loginCount || 0;
  const app = u.mobileLoginCount || 0;
  if (web > 0 && app > 0) {
    const lastWeb = u.lastLogin || '';
    const lastApp = u.mobileLastLogin || '';
    const recent = lastApp > lastWeb ? 'app' : 'web';
    return { key: 'both', label: 'Both', color: '#16a34a', recent };
  }
  if (app > 0) return { key: 'app', label: 'App', color: '#8b5cf6' };
  if (web > 0) return { key: 'web', label: 'Web', color: '#3B6B9C' };
  return { key: 'none', label: '—', color: 'var(--color-text-muted)' };
}

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

function Badge({ color, children, title }) {
  return (
    <span
      title={title}
      style={{ fontSize: '0.75rem', fontWeight: 600, color, background: color + '15', padding: '0.15rem 0.45rem', borderRadius: '50px', whiteSpace: 'nowrap' }}
    >
      {children}
    </span>
  );
}

// Registry for the users table. `sortKey` ties a column to the existing sort
// handlers; omit it for non-sortable columns. Widths/visibility are overridable
// per-admin via the column picker (persisted in localStorage).
const ADMIN_COLUMNS = [
  { key: 'displayName', label: 'Name', width: 150, defaultVisible: true, sortKey: 'displayName',
    render: u => u.displayName || '—' },
  { key: 'email', label: 'Email', width: 220, defaultVisible: true, sortKey: 'email',
    render: u => u.email || '—' },
  { key: 'recipeCount', label: 'Recipes', width: 90, defaultVisible: true, sortKey: 'recipeCount',
    render: u => (u.recipes || []).length },
  { key: 'loginCount', label: 'Web Logins', width: 110, defaultVisible: true, sortKey: 'loginCount',
    render: u => u.loginCount || 0 },
  { key: 'lastLogin', label: 'Last Web Login', width: 140, defaultVisible: true, sortKey: 'lastLogin',
    render: u => <span title={formatDate(u.lastLogin)}>{u.lastLogin ? timeAgo(u.lastLogin) : '—'}</span> },
  { key: 'mobileLoginCount', label: 'App Logins', width: 110, defaultVisible: true, sortKey: 'mobileLoginCount',
    render: u => u.mobileLoginCount || 0 },
  { key: 'mobileLastLogin', label: 'Last App Login', width: 140, defaultVisible: true, sortKey: 'mobileLastLogin',
    render: u => <span title={formatDate(u.mobileLastLogin)}>{u.mobileLastLogin ? timeAgo(u.mobileLastLogin) : '—'}</span> },
  { key: 'platform', label: 'Platform', width: 120, defaultVisible: true,
    render: u => {
      const p = getUserPlatform(u);
      if (p.key === 'none') return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
      return (
        <Badge color={p.color} title={p.key === 'both' ? `Uses both — last on ${p.recent === 'app' ? 'the app' : 'the web'}` : `${p.label}-only`}>
          {p.key === 'both' ? `Both · ${p.recent === 'app' ? '📱' : '🌐'}` : p.label}
        </Badge>
      );
    } },
  { key: 'status', label: 'Status', width: 110, defaultVisible: true,
    render: u => { const e = getUserEngagement(u); return <Badge color={e.color}>{e.label}</Badge>; } },
];

// Friendly labels for the usage table. Keys are the raw view/route ids written
// by trackPageView (web) and recordScreenView (app). Unknown keys fall back to
// a prettified version of the id.
const WEB_PAGE_LABELS = {
  list: 'Recipes', detail: 'Recipe Detail', shopping: 'Shopping List', 'eating-out': 'Eating Out',
  'next-spots': 'Next Spots', workout: 'Workouts', 'weight-tracker': 'Weight', 'daily-tracker': 'Log Meals',
  history: 'Meal History', whoop: 'Whoop', profile: 'Profile', 'account-settings': 'Account Settings',
  friends: 'Friends', admin: 'Admin', features: 'Features', 'design-meal': 'Design a Meal',
  'barcode-scanner': 'Barcode Scanner', 'seasonal-guide': 'Seasonal Guide', sources: 'Sources',
  'week-plan': 'Week Plan',
};
const APP_SCREEN_LABELS = {
  menu: 'Shopping List', recipes: 'Recipes', tracker: 'Log Meals', ingredients: 'Scan',
  workout: 'Workouts', 'eating-out': 'Eating Out', weight: 'Weight', agents: 'Agents', pantry: 'Pantry',
  home: 'Home',
};
function prettifyKey(k) {
  return String(k).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const ADMIN_COLS_KEY = 'sunday-admin-user-cols';
function loadColPrefs() {
  try { const p = JSON.parse(localStorage.getItem(ADMIN_COLS_KEY) || '{}'); return p && typeof p === 'object' ? p : {}; }
  catch { return {}; }
}
function saveColPrefs(p) { try { localStorage.setItem(ADMIN_COLS_KEY, JSON.stringify(p)); } catch { /* ignore */ } }

export function AdminDashboard({ onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cleanedCount, setCleanedCount] = useState(0);
  const [sortField, setSortField] = useState('lastLogin');
  const [sortDir, setSortDir] = useState('desc');
  // Per-admin column visibility + widths for the users table.
  const [colPrefs, setColPrefs] = useState(loadColPrefs);
  const [showCols, setShowCols] = useState(false);
  const resizingRef = useRef(null);
  const [expandedUsage, setExpandedUsage] = useState(null);
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
    } else if (sortField === 'mobileLoginCount') {
      aVal = a.mobileLoginCount || 0;
      bVal = b.mobileLoginCount || 0;
    } else if (sortField === 'mobileLastLogin') {
      aVal = a.mobileLastLogin || '';
      bVal = b.mobileLastLogin || '';
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

      await Promise.all([
        saveField(target.uid, 'exerciseLibrary', myLibrary),
        saveField(target.uid, 'workoutEnabled', true),
      ]);
      setUsers(prev => prev.map(u => u.uid === target.uid ? { ...u, exerciseLibrary: myLibrary, workoutEnabled: true } : u));
      setLibCopyMsg(`✓ Copied ${myLibrary.length} exercise${myLibrary.length === 1 ? '' : 's'} to ${targetName} and enabled their Workout tab.`);
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

  // Platform stats — how many users sign in on web, the app, or both.
  const platformCounts = users.reduce((acc, u) => {
    const p = getUserPlatform(u);
    acc[p.label] = (acc[p.label] || 0) + 1;
    return acc;
  }, {});

  // Page/screen usage, aggregated per page with a per-user breakdown for
  // drill-down. Web pages come from `pageViews`, app screens from
  // `appScreenViews` — both nested {key: count} maps on the user doc.
  const usageRows = (() => {
    const rows = [];
    const build = (platform, field, labels) => {
      const byKey = {};
      for (const u of users) {
        const map = u[field] || {};
        for (const [k, v] of Object.entries(map)) {
          const count = Number(v) || 0;
          if (count <= 0) continue;
          if (!byKey[k]) byKey[k] = { total: 0, users: [] };
          byKey[k].total += count;
          byKey[k].users.push({ name: u.displayName || u.email || u.uid, count });
        }
      }
      for (const [k, data] of Object.entries(byKey)) {
        data.users.sort((a, b) => b.count - a.count);
        rows.push({
          id: `${platform}:${k}`, platform, key: k,
          label: labels[k] || prettifyKey(k),
          total: data.total, userCount: data.users.length, users: data.users,
        });
      }
    };
    build('web', 'pageViews', WEB_PAGE_LABELS);
    build('app', 'appScreenViews', APP_SCREEN_LABELS);
    rows.sort((a, b) => b.total - a.total);
    return rows;
  })();

  const arrow = (field) => sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  // Merge saved prefs over the column defaults.
  const columns = ADMIN_COLUMNS.map(c => {
    const p = colPrefs[c.key] || {};
    return {
      ...c,
      visible: typeof p.visible === 'boolean' ? p.visible : c.defaultVisible,
      width: typeof p.width === 'number' && p.width >= 50 ? p.width : c.width,
    };
  });
  const visibleColumns = columns.filter(c => c.visible);
  const tableWidth = visibleColumns.reduce((sum, c) => sum + c.width, 0);

  function updateColPref(key, patch) {
    setColPrefs(prev => {
      const next = { ...prev, [key]: { ...(prev[key] || {}), ...patch } };
      saveColPrefs(next);
      return next;
    });
  }
  function resetCols() { setColPrefs({}); saveColPrefs({}); }

  // Drag a header's right edge to resize that column.
  function startResize(e, colKey, startWidth) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { colKey, startWidth, startX: e.clientX };
    function onMove(ev) {
      const r = resizingRef.current;
      if (!r) return;
      const next = Math.max(50, Math.round(r.startWidth + (ev.clientX - r.startX)));
      updateColPref(r.colKey, { width: next });
    }
    function onUp() {
      resizingRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';
    }
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

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
              // Active if last seen on web OR app within 7 days.
              const last = [u.lastLogin, u.mobileLastLogin].filter(Boolean).sort().pop();
              if (!last) return false;
              return Date.now() - new Date(last).getTime() < 7 * 24 * 60 * 60 * 1000;
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
            Logins below count web + app combined. Active: 10+ logins, seen in 14d · Regular: 5+ logins, 30d · Returning: 2+ logins, 60d · Lapsed: 2+ logins, 60d+ · Tried It: 1 login with recipes · One-Time: 1 login, no recipes
          </p>
        </div>
      )}

      {/* Platform breakdown — web vs app vs both */}
      {!loading && (
        <div className={styles.sourceSection}>
          <h3 className={styles.sourceHeading}>Platform (Web vs App)</h3>
          <div className={styles.sourceGrid}>
            {[
              { label: 'Web', color: '#3B6B9C' },
              { label: 'App', color: '#8b5cf6' },
              { label: 'Both', color: '#16a34a' },
              { label: '—', color: '#999' },
            ].filter(p => platformCounts[p.label]).map(({ label, color }) => {
              const count = platformCounts[label];
              const pct = Math.round((count / users.length) * 100);
              return (
                <div key={label} className={styles.sourceRow}>
                  <span className={styles.sourceLabel} style={{ color }}>
                    {label === '—' ? 'No logins yet' : label}
                  </span>
                  <div className={styles.sourceBarWrap}>
                    <div className={styles.sourceBar} style={{ width: `${pct}%`, background: color }} />
                  </div>
                  <span className={styles.sourceCount}>{count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
            Web = signs in on prep-day.com only · App = the mobile app only · Both = uses each at least once.
          </p>
        </div>
      )}

      {/* Page & screen usage — which pages get used, on web and app */}
      {!loading && (
        <div className={styles.sourceSection}>
          <h3 className={styles.sourceHeading}>Page &amp; Screen Usage</h3>
          {usageRows.length === 0 ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              No usage recorded yet. This starts collecting once the latest web deploy and app build are live —
              data accumulates from each page/screen users open.
            </p>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table} style={{ width: '100%' }}>
                  <colgroup>
                    <col style={{ width: '40%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '25%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Page / Screen</th>
                      <th>Platform</th>
                      <th>Total Visits</th>
                      <th>Users</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageRows.map(row => {
                      const open = expandedUsage === row.id;
                      const color = row.platform === 'web' ? '#3B6B9C' : '#8b5cf6';
                      return (
                        <Fragment key={row.id}>
                          <tr
                            onClick={() => setExpandedUsage(open ? null : row.id)}
                            style={{ cursor: 'pointer' }}
                          >
                            <td>{open ? '▾ ' : '▸ '}{row.label}</td>
                            <td><Badge color={color}>{row.platform === 'web' ? '🌐 Web' : '📱 App'}</Badge></td>
                            <td>{row.total.toLocaleString()}</td>
                            <td>{row.userCount}</td>
                          </tr>
                          {open && (
                            <tr>
                              <td colSpan={4} style={{ background: 'var(--color-surface-alt, #f9fafb)' }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem', padding: '0.25rem 0.5rem' }}>
                                  {row.users.map((usr, i) => (
                                    <span key={i} style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                                      {usr.name} <strong>{usr.count.toLocaleString()}</strong>
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                Counts every page/screen open. Click a row to see which users drive it.
              </p>
            </>
          )}
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
          Replaces the target user&apos;s <code>exerciseLibrary</code> with a copy of yours and enables their Workout tab
          (<code>workoutEnabled: true</code>). Their workout log is not touched. They&apos;ll need to refresh / sign back in
          to see the tab.
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
        <>
          <div className={styles.tableToolbar}>
            <button className={styles.colBtn} onClick={() => setShowCols(v => !v)}>
              ⚙ Columns ({visibleColumns.length}/{columns.length})
            </button>
            {showCols && (
              <div className={styles.colPopover}>
                <div className={styles.colPopoverHeader}>
                  <span>Show columns</span>
                  <button className={styles.colPopoverReset} onClick={resetCols}>Reset</button>
                </div>
                {columns.map(c => (
                  <label key={c.key} className={styles.colPopoverItem}>
                    <input
                      type="checkbox"
                      checked={c.visible}
                      onChange={() => updateColPref(c.key, { visible: !c.visible })}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table} style={{ width: tableWidth }}>
              <colgroup>
                {visibleColumns.map(c => <col key={c.key} style={{ width: c.width }} />)}
              </colgroup>
              <thead>
                <tr>
                  {visibleColumns.map(c => (
                    <th
                      key={c.key}
                      onClick={c.sortKey ? () => handleSort(c.sortKey) : undefined}
                      className={c.sortKey ? styles.sortable : undefined}
                    >
                      {c.label}{c.sortKey ? arrow(c.sortKey) : ''}
                      <span
                        className={styles.colResizer}
                        onPointerDown={e => startResize(e, c.key, c.width)}
                        onClick={e => e.stopPropagation()}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(u => (
                  <tr key={u.uid}>
                    {visibleColumns.map(c => <td key={c.key}>{c.render(u)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
