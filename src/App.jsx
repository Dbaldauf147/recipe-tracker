import { useState, useEffect, useRef } from 'react';
import { useRecipes } from './hooks/useRecipes';
import { useAuth } from './contexts/AuthContext';
import { saveField, getPendingRequests, getPendingSharedRecipes } from './utils/firestoreSync';
import { RecipeList } from './components/RecipeList';
import { RecipeDetail } from './components/RecipeDetail';
import { WeightTracker, checkWeighReminder } from './components/WeightTracker';
import { AccountSettings } from './components/AccountSettings';
import { RecipeForm } from './components/RecipeForm';
import { IngredientsPage } from './components/IngredientsPage';
import { loadIngredientsFromFirestore } from './utils/ingredientsStore';
import { FriendsPage } from './components/FriendsPage';
import { ShoppingListPage } from './components/ShoppingListPage';
import { HistoryPage } from './components/HistoryPage';
import { KeyIngredientsPage } from './components/KeyIngredientsPage';
import { ImportRecipePage } from './components/ImportRecipePage';
import { LoginPage } from './components/LoginPage';
import { OnboardingPage } from './components/OnboardingPage';
import { AdminDashboard } from './components/AdminDashboard';
import { SharedRecipePage } from './components/SharedRecipePage';
import { GoalsPage } from './components/GoalsPage';
import { SeasonalGuidePage } from './components/SeasonalGuidePage';
import { SourcesPage } from './components/SourcesPage';
import { NutritionGoalsPage } from './components/NutritionGoalsPage';
import { DailyTrackerPage } from './components/DailyTrackerPage';
import { BarcodeScannerPage } from './components/BarcodeScannerPage';
import { RecipeSetupPage } from './components/RecipeSetupPage';
import React from 'react';
import styles from './App.module.css';

function HelpBubble({ user, currentView }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function handleSubmit() {
    if (!message.trim()) return;
    setSending(true);
    try {
      await fetch('/api/notify-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'issue',
          message: message.trim(),
          page: currentView || 'unknown',
          userEmail: user?.email || '',
          userName: user?.displayName || '',
        }),
      });
      setSent(true);
      setMessage('');
      setTimeout(() => { setSent(false); setOpen(false); }, 2000);
    } catch {
      // silently fail
    } finally {
      setSending(false);
    }
  }

  return (
    <div ref={ref} className={styles.helpBubble}>
      {open && (
        <div className={styles.helpPanel}>
          {sent ? (
            <p className={styles.helpSent}>Thanks! We received your report.</p>
          ) : (
            <>
              <h4 className={styles.helpTitle}>Report an Issue</h4>
              <textarea
                className={styles.helpTextarea}
                rows={4}
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Describe the issue you're experiencing..."
                disabled={sending}
              />
              <button
                className={styles.helpSubmit}
                onClick={handleSubmit}
                disabled={!message.trim() || sending}
              >
                {sending ? 'Sending...' : 'Send Report'}
              </button>
            </>
          )}
        </div>
      )}
      <button
        className={styles.helpBtn}
        onClick={() => { setOpen(o => !o); setSent(false); }}
        aria-label="Report an issue"
      >
        <span className={styles.helpBtnText}>Report an Issue</span>
      </button>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', color: 'red' }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.message}{'\n'}{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ADMIN_UID = import.meta.env.VITE_ADMIN_UID;
function DeleteAccountButton({ onDeleted }) {
  const { deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete your account? This will permanently delete all your data and cannot be undone.')) return;
    if (!confirm('This is permanent. All recipes, meal logs, weight data, and settings will be lost. Continue?')) return;
    setDeleting(true);
    try {
      await deleteAccount();
      onDeleted();
    } catch (err) {
      alert(err.message || 'Failed to delete account. Try signing out and back in first.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button className={styles.deleteAccountBtn} onClick={handleDelete} disabled={deleting}>
      {deleting ? 'Deleting...' : 'Delete Account'}
    </button>
  );
}

const WEEKLY_KEY = 'sunday-weekly-plan';
const WEEKLY_SERVINGS_KEY = 'sunday-weekly-servings';

function loadWeeklyPlan() {
  try {
    const data = localStorage.getItem(WEEKLY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function loadWeeklyServings() {
  try {
    const data = localStorage.getItem(WEEKLY_SERVINGS_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

/**
 * Authenticated app content — rendered with key={user.uid} so it
 * remounts when the user changes, re-initializing all useState from localStorage.
 */
function AppContent({ user, logOut, isNewUser, restartOnboarding, showGoalsModal, onCloseGoalsModal, onCompleteGoals }) {
  const { recipes, addRecipe, updateRecipe, deleteRecipe, getRecipe, importRecipes } =
    useRecipes();

  const [view, setView] = useState(() => {
    const hash = window.location.hash.replace('#', '');
    if (!hash) return 'list';
    const [v] = hash.split('/');
    return v || 'list';
  });
  const [selectedId, setSelectedId] = useState(() => {
    const hash = window.location.hash.replace('#', '');
    if (!hash) return null;
    const parts = hash.split('/');
    return parts[1] || null;
  });
  const [viewHistory, setViewHistory] = useState([]);
  const [weeklyPlan, setWeeklyPlan] = useState(loadWeeklyPlan);
  const [weeklyServings, setWeeklyServings] = useState(loadWeeklyServings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [viewRecipeId, setViewRecipeId] = useState(null);
  const [weighBannerDismissed, setWeighBannerDismissed] = useState(false);
  const showWeighBanner = !weighBannerDismissed && checkWeighReminder();
  const [pendingCount, setPendingCount] = useState(0);
  const [ingredientsVersion, setIngredientsVersion] = useState(0);
  const settingsRef = useRef(null);

  // Post-onboarding redirect (e.g., to Nutrition Goals if user selected Track Nutrition)
  useEffect(() => {
    const postOnboarding = localStorage.getItem('sunday-post-onboarding');
    if (postOnboarding) {
      localStorage.removeItem('sunday-post-onboarding');
      setView(postOnboarding);
    }
  }, []);

  // Re-read localStorage when remote Firestore data is synced
  useEffect(() => {
    function handleSync() {
      setWeeklyPlan(loadWeeklyPlan());
      setWeeklyServings(loadWeeklyServings());
      setIngredientsVersion(v => v + 1);
    }
    window.addEventListener('firestore-sync', handleSync);
    return () => window.removeEventListener('firestore-sync', handleSync);
  }, []);

  // One-time migration: set key ingredients for admin user
  useEffect(() => {
    if (!user || user.uid !== ADMIN_UID) return;
    if (localStorage.getItem('migration-key-ingredients-v1')) return;
    const ingredients = [
      'eggplant','seaweed','beets_pickled','alfalfa sprouts','olive(s)_pitted black',
      'asparagus','oregano_dried','orange(s)','chickpeas/garbanzo beans','shiitake mushrooms',
      'zucchini','green peas','red cabbage','green beans','collard greens','thyme_dried',
      'cauliflower','carrots_baby','hemp seeds','tumeric','brussel sprouts','lime(s)',
      'lentils_green','broccoli','lemon juice','ginger root','banana(s)','apple(s)_honey crisp',
      'cacao','rasberries','sweet potato(s)','bell pepper(s)','spinach','black beans','kale',
      'avocado(s)','blackberry(s)','blueberries','garlic','chia seeds','flaxseed meal',
      'tomato','cinnamon'
    ];
    localStorage.setItem('sunday-key-ingredients', JSON.stringify(ingredients));
    saveField(user.uid, 'keyIngredients', ingredients);
    localStorage.setItem('migration-key-ingredients-v1', 'done');
  }, [user]);

  // One-time migration: expand size variants for ingredients
  useEffect(() => {
    if (!user || user.uid !== ADMIN_UID) return;
    if (localStorage.getItem('migration-size-variants-v2')) return;
    import('./utils/ingredientsStore').then(({ loadIngredients, expandSizeVariants, saveIngredientsToFirestore }) => {
      const db = loadIngredients();
      if (db && db.length > 0) {
        const expanded = expandSizeVariants(db);
        console.log(`Size variant migration: ${db.length} → ${expanded.length} ingredients (${expanded.length - db.length} added)`);
        if (expanded.length > db.length) {
          saveIngredientsToFirestore(expanded);
        }
      }
      localStorage.setItem('migration-size-variants-v2', 'done');
    });
  }, [user]);

  // Check for email reminder notifications on page load
  useEffect(() => {
    if (!user) return;
    try {
      const settings = JSON.parse(localStorage.getItem('sunday-reminder-settings') || '{}');
      if (!settings.foodLogReminder && !settings.weightReminder) return;
      if (!user.email) return;

      const now = new Date();
      const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // Use separate last-check keys for each reminder type so they trigger independently
      const messages = [];

      // Food log check
      if (settings.foodLogReminder && currentTime >= settings.foodLogTime) {
        const lastFoodCheck = localStorage.getItem('sunday-reminder-food-last');
        if (lastFoodCheck !== todayDate) {
          const dailyLog = JSON.parse(localStorage.getItem('sunday-daily-log') || '{}');
          const dayData = dailyLog[todayDate] || {};
          const entries = dayData.entries || [];
          const mainMeals = entries.filter(e => ['breakfast', 'lunch', 'dinner'].includes(e.mealSlot)).length;
          const skipped = (dayData.skippedMeals || []).length;
          if (mainMeals + skipped < 3 && !dayData.daySkipped) {
            const remaining = 3 - mainMeals - skipped;
            messages.push(`You have ${remaining} meal${remaining > 1 ? 's' : ''} left to log today.`);
            localStorage.setItem('sunday-reminder-food-last', todayDate);
          }
        }
      }

      // Weight check — only on scheduled weigh days
      if (settings.weightReminder && currentTime >= settings.weightTime) {
        const lastWeightCheck = localStorage.getItem('sunday-reminder-weight-last');
        if (lastWeightCheck !== todayDate) {
          try {
            const bodyStats = JSON.parse(localStorage.getItem('sunday-body-stats') || '{}');
            const goals = bodyStats.mealTrackingGoals || [];
            const shouldWeigh = goals.includes('weighDaily') ||
              (goals.includes('weighWeekly') && [0, 1].includes(now.getDay())) ||
              (goals.includes('weighMonthly') && now.getDate() === 1);

            if (shouldWeigh || bodyStats.weighRepeatUnit) {
              const weightLog = JSON.parse(localStorage.getItem('sunday-weight-log') || '[]');
              const hasToday = weightLog.some(e => e.date === todayDate);
              if (!hasToday) {
                messages.push("Don't forget to log your weight today!");
                localStorage.setItem('sunday-reminder-weight-last', todayDate);
              }
            }
          } catch {}
        }
      }

      if (messages.length > 0) {
        fetch('/api/notify-friend-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'sms-reminder',
            toEmail: user.email,
            smsBody: `Prep Day Reminder: ${messages.join(' ')} Log now at https://prep-day.com`,
          }),
        }).catch(() => {});
      }
    } catch {}
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function checkRequests() {
      try {
        const [reqs, shared] = await Promise.all([
          getPendingRequests(user.uid),
          getPendingSharedRecipes(user.uid),
        ]);
        if (!cancelled) setPendingCount(reqs.length + shared.length);
      } catch {}
    }
    checkRequests();
    const interval = setInterval(checkRequests, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user?.uid]);

  // Pre-load ingredient database from Firestore so localStorage cache is fresh
  useEffect(() => {
    loadIngredientsFromFirestore().then(() => setIngredientsVersion(v => v + 1));
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    function handleClickOutside(e) {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [settingsOpen]);

  function navigateTo(nextView, nextSelectedId) {
    setViewHistory(prev => [...prev.slice(-19), { view, selectedId }]);
    if (nextSelectedId !== undefined) setSelectedId(nextSelectedId);
    setView(nextView);
    const hash = nextSelectedId !== undefined ? `${nextView}/${nextSelectedId}` : nextView;
    window.history.pushState({ view: nextView, selectedId: nextSelectedId ?? null }, '', `#${hash}`);
    window.scrollTo(0, 0);
  }

  function goBack() {
    setViewHistory(prev => {
      if (prev.length === 0) {
        setView('list');
        setSelectedId(null);
        window.history.replaceState(null, '', '#list');
        return prev;
      }
      const next = [...prev];
      const last = next.pop();
      setView(last.view);
      setSelectedId(last.selectedId);
      const hash = last.selectedId ? `${last.view}/${last.selectedId}` : last.view;
      window.history.replaceState(null, '', `#${hash}`);
      return next;
    });
    window.scrollTo(0, 0);
  }

  useEffect(() => {
    function handlePopState() {
      goBack();
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  function saveWeek(plan) {
    try { localStorage.setItem(WEEKLY_KEY, JSON.stringify(plan)); } catch {}
    if (user) saveField(user.uid, 'weeklyPlan', plan);
  }

  function saveWeeklyServings(servings) {
    try { localStorage.setItem(WEEKLY_SERVINGS_KEY, JSON.stringify(servings)); } catch {}
    if (user) saveField(user.uid, 'weeklyServings', servings);
  }

  function handleUpdateWeeklyServings(recipeId, newServings) {
    setWeeklyServings(prev => {
      const next = { ...prev, [recipeId]: newServings };
      saveWeeklyServings(next);
      return next;
    });
  }

  const showWeightTab = (() => {
    try {
      const stats = JSON.parse(localStorage.getItem('sunday-body-stats') || '{}');
      const goals = stats.mealTrackingGoals || [];
      return goals.includes('weighDaily') || goals.includes('weighWeekly') || goals.includes('weighBiweekly') || goals.includes('weighMonthly');
    } catch { return false; }
  })();

  const NAV_ITEMS = [
    { label: 'Shopping List', action: 'shopping' },
    { label: 'Recipes', id: 'weekly-menu' },
    { label: 'Nutrition Tracking', submenu: [
      { label: 'Goals', action: 'nutrition-goals' },
      { label: 'Track Meals', action: 'daily-tracker' },
      ...(showWeightTab ? [{ label: 'Weight', action: 'weight-tracker' }] : []),
    ] },
  ];

  function handleNavClick(item) {
    if (item.action === 'shopping') {
      navigateTo('shopping');
    } else if (item.action === 'history') {
      navigateTo('history');
    } else if (item.action === 'key-ingredients') {
      navigateTo('key-ingredients');
    } else if (item.action === 'import') {
      navigateTo('import');
    } else if (item.action === 'nutrition-goals') {
      navigateTo('nutrition-goals');
    } else if (item.action === 'daily-tracker') {
      navigateTo('daily-tracker');
    } else if (item.action === 'weight-tracker') {
      navigateTo('weight-tracker');
    } else if (item.action === 'barcode-scanner') {
      navigateTo('barcode-scanner');
    } else if (item.id) {
      if (view !== 'list') navigateTo('list');
      setTimeout(() => {
        const el = document.getElementById(item.id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  }

  function handleSelect(id) {
    setViewRecipeId(id);
  }

  function handleAdd(data) {
    addRecipe(data);
    setView('list');
    setViewHistory([]);
  }

  function handleUpdate(data) {
    updateRecipe(selectedId, data);
    setView('detail');
  }

  function handleDelete(id) {
    deleteRecipe(id);
    setSelectedId(null);
    setWeeklyPlan(prev => {
      const next = prev.filter(wid => wid !== id);
      saveWeek(next);
      return next;
    });
    setWeeklyServings(prev => {
      const next = { ...prev };
      delete next[id];
      saveWeeklyServings(next);
      return next;
    });
    setView('list');
    setViewHistory([]);
  }

  function handleAddToWeek(id) {
    setWeeklyPlan(prev => {
      const next = prev.includes(id) ? prev : [...prev, id];
      saveWeek(next);
      return next;
    });
  }

  function handleRemoveFromWeek(id) {
    setWeeklyPlan(prev => {
      const next = prev.filter(wid => wid !== id);
      saveWeek(next);
      return next;
    });
    setWeeklyServings(prev => {
      const next = { ...prev };
      delete next[id];
      saveWeeklyServings(next);
      return next;
    });
  }

  function handleClearWeek() {
    saveWeek([]);
    setWeeklyPlan([]);
    saveWeeklyServings({});
    setWeeklyServings({});
  }

  function handleCategoryChange(id, newCategory) {
    updateRecipe(id, { category: newCategory });
  }

  function handleSaveToHistory() {
    if (weeklyPlan.length === 0) return;
    const entry = {
      date: new Date().toISOString().slice(0, 10),
      recipeIds: [...weeklyPlan],
      timestamp: new Date().toISOString(),
    };
    try {
      const existing = JSON.parse(localStorage.getItem('sunday-plan-history') || '[]');
      const next = [...existing, entry];
      localStorage.setItem('sunday-plan-history', JSON.stringify(next));
      if (user) saveField(user.uid, 'planHistory', next);
    } catch {}
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span
          className={styles.logo}
          onClick={() => { setView('list'); setSelectedId(null); setViewHistory([]); }}
        >
          Prep Day
        </span>
        <nav className={styles.nav}>
          {showWeighBanner && (
            <button
              className={styles.weighAlert}
              onClick={() => { navigateTo('weight-tracker'); setWeighBannerDismissed(true); }}
            >
              Log Weight
            </button>
          )}
          {NAV_ITEMS.map(item => {
            if (item.submenu) {
              const isActive = item.submenu.some(s => s.action === view);
              return (
                <div key={item.label} className={styles.navDropdownWrap}>
                  <button className={styles.navItem}>
                    {item.label} <span className={styles.navDropdownArrow}>▾</span>
                  </button>
                  <div className={styles.navDropdown}>
                    {item.submenu.map(sub => (
                      <button
                        key={sub.action}
                        className={`${styles.navDropdownItem}${view === sub.action ? ` ${styles.navDropdownItemActive}` : ''}`}
                        onClick={() => handleNavClick(sub)}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
            const isActive = item.action
              ? view === item.action
              : item.id && view === 'list';
            return (
              <button
                key={item.action || item.id}
                className={`${styles.navItem}${isActive ? ` ${styles.navItemActive}` : ''}`}
                onClick={() => handleNavClick(item)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className={styles.settingsWrapper} ref={settingsRef}>
          <span className={styles.userName}>{user?.displayName || 'Guest'}</span>
          <button
            className={styles.settingsBtn}
            onClick={() => setSettingsOpen(prev => !prev)}
            aria-label="Settings"
          >
            ⚙
            {pendingCount > 0 && (
              <span className={styles.badge}>{pendingCount}</span>
            )}
          </button>
          {settingsOpen && (
            <div className={styles.settingsDropdown}>
              <div className={styles.settingsUserRow}>
                {user?.photoURL && (
                  <img
                    className={styles.avatar}
                    src={user.photoURL}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                )}
                <span>{user?.displayName || 'Guest'}</span>
              </div>
              <button
                className={styles.settingsMenuItem}
                onClick={() => { navigateTo('account-settings'); setSettingsOpen(false); }}
              >
                Account Settings
              </button>
              <button
                className={styles.settingsMenuItem}
                onClick={() => { navigateTo('friends'); setSettingsOpen(false); }}
              >
                Friends
                {pendingCount > 0 && (
                  <span className={styles.menuBadge}>{pendingCount}</span>
                )}
              </button>
              <div className={styles.settingsDivider} />
              <button
                className={styles.settingsMenuItem}
                onClick={() => { navigateTo('key-ingredients'); setSettingsOpen(false); }}
              >
                Key Ingredients
              </button>
              {user?.uid === ADMIN_UID && (
                <>
                  <button
                    className={styles.settingsMenuItem}
                    onClick={() => { navigateTo('admin'); setSettingsOpen(false); }}
                  >
                    Admin Dashboard
                  </button>
                </>
              )}
              <div className={styles.settingsDivider} />
              <button
                className={styles.settingsMenuItem}
                onClick={() => { navigateTo('history'); setSettingsOpen(false); }}
              >
                Meal History
              </button>
              <button
                className={styles.settingsMenuItem}
                onClick={() => { navigateTo('seasonal-guide'); setSettingsOpen(false); }}
              >
                Seasonal Guide
              </button>
              <button
                className={styles.settingsMenuItem}
                onClick={() => { navigateTo('sources'); setSettingsOpen(false); }}
              >
                Sources
              </button>
              <div className={styles.settingsDivider} />
              <button
                className={styles.settingsMenuItem}
                onClick={() => { navigateTo('ingredients'); setSettingsOpen(false); }}
              >
                Ingredients
              </button>
              <button
                className={styles.settingsMenuItem}
                onClick={() => { restartOnboarding(); setSettingsOpen(false); }}
              >
                Setup
              </button>
              <div className={styles.settingsDivider} />
              <button
                className={styles.settingsMenuItem}
                onClick={() => { logOut(); setSettingsOpen(false); }}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className={styles.main}>
        {view === 'barcode-scanner' ? (
          <BarcodeScannerPage onClose={goBack} user={user} />
        ) : view === 'daily-tracker' ? (
          <DailyTrackerPage recipes={recipes} getRecipe={getRecipe} onClose={goBack} user={user} weeklyPlan={weeklyPlan} onViewRecipe={(id) => navigateTo('detail', id)} onImportRecipe={() => navigateTo('import')} />
        ) : view === 'account-settings' ? (
          <AccountSettings user={user} onClose={goBack} />
        ) : view === 'weight-tracker' ? (
          <WeightTracker onClose={goBack} user={user} />
        ) : view === 'nutrition-goals' ? (() => {
          let savedGoals = {};
          let savedSelected = null;
          let savedStats = null;
          try {
            const raw = localStorage.getItem('sunday-nutrition-goals');
            if (raw) {
              savedGoals = JSON.parse(raw);
              savedSelected = Object.keys(savedGoals);
            }
          } catch {}
          try {
            const rawStats = localStorage.getItem('sunday-body-stats');
            if (rawStats) savedStats = JSON.parse(rawStats);
          } catch {}
          return (
            <NutritionGoalsPage
              initialSelected={savedSelected}
              initialTargets={savedSelected ? savedGoals : undefined}
              initialStats={savedStats}
              recipes={recipes}
              onComplete={(goals, stats) => {
                localStorage.setItem('sunday-nutrition-goals', JSON.stringify(goals));
                if (stats) localStorage.setItem('sunday-body-stats', JSON.stringify(stats));
                if (user) {
                  saveField(user.uid, 'nutritionGoals', goals);
                  if (stats) saveField(user.uid, 'bodyStats', stats);
                }
                // After first-time setup, go to import recipes
                if (!savedSelected) {
                  setShowImportModal(true);
                  setView('list');
                }
              }}
              onBack={goBack}
            />
          );
        })() : view === 'admin' ? (
          <AdminDashboard onClose={goBack} />
        ) : view === 'import' ? (
          <ImportRecipePage
            onSave={handleAdd}
            onCancel={goBack}
          />
        ) : view === 'shopping' ? (
          <ShoppingListPage
            weeklyRecipes={weeklyPlan.map(id => getRecipe(id)).filter(Boolean)}
            weeklyServings={weeklyServings}
            onClose={goBack}
            onSaveToHistory={handleSaveToHistory}
          />
        ) : view === 'setup' ? (
          <OnboardingPage
            initialIngredients={JSON.parse(localStorage.getItem('sunday-key-ingredients') || '[]')}
            onComplete={(ingredients) => {
              localStorage.setItem('sunday-key-ingredients', JSON.stringify(ingredients));
              if (user) saveField(user.uid, 'keyIngredients', ingredients);
            }}
            onCancel={goBack}
          />
        ) : view === 'key-ingredients' ? (
          <KeyIngredientsPage
            recipes={recipes}
            getRecipe={getRecipe}
            onClose={goBack}
            onSetup={() => navigateTo('setup')}
          />
        ) : view === 'seasonal-guide' ? (
          <SeasonalGuidePage onClose={goBack} />
        ) : view === 'sources' ? (
          <SourcesPage onClose={goBack} />
        ) : view === 'history' ? (
          <HistoryPage
            getRecipe={getRecipe}
            recipes={recipes}
            onClose={goBack}
          />
        ) : view === 'ingredients' ? (
          <IngredientsPage onClose={goBack} user={user} />
        ) : view === 'friends' ? (
          <FriendsPage
            onClose={() => {
              goBack();
              if (user) {
                Promise.all([
                  getPendingRequests(user.uid),
                  getPendingSharedRecipes(user.uid),
                ]).then(([r, s]) => setPendingCount(r.length + s.length)).catch(() => {});
              }
            }}
            addRecipe={addRecipe}
          />
        ) : view === 'detail' && selectedId ? (
          <ErrorBoundary>
            <RecipeDetail
              recipe={getRecipe(selectedId)}
              onSave={handleUpdate}
              onDelete={handleDelete}
              onBack={goBack}
              onAddToWeek={handleAddToWeek}
              weeklyPlan={weeklyPlan}
              user={user}
              ingredientsVersion={ingredientsVersion}
              onViewSources={() => navigateTo('sources')}
            />
          </ErrorBoundary>
        ) : view === 'add' ? (
          <RecipeForm onSave={handleAdd} onCancel={goBack} />
        ) : (
          <div className={styles.homeLayout}>
            <RecipeList
              recipes={recipes}
              onSelect={handleSelect}
              onAdd={() => setShowImportModal(true)}
              onImport={importRecipes}
              weeklyPlan={weeklyPlan}
              weeklyServings={weeklyServings}
              onAddToWeek={handleAddToWeek}
              onRemoveFromWeek={handleRemoveFromWeek}
              onClearWeek={handleClearWeek}
              onUpdateWeeklyServings={handleUpdateWeeklyServings}
              onCategoryChange={handleCategoryChange}
              getRecipe={getRecipe}
              onSaveToHistory={handleSaveToHistory}
              onAddRecipe={addRecipe}
              onDelete={handleDelete}
              isNewUser={isNewUser}
            />
          </div>
        )}


      </main>

      {showImportModal && (
        <div className={styles.importModalOverlay} onClick={() => setShowImportModal(false)}>
          <div className={styles.importModalContent} onClick={e => e.stopPropagation()}>
            <button className={styles.importModalClose} onClick={() => setShowImportModal(false)}>&times;</button>
            <ImportRecipePage
              onSave={(data) => { addRecipe(data); setShowImportModal(false); }}
              onAddWithoutClose={(data) => { addRecipe(data); }}
              onCancel={() => setShowImportModal(false)}
            />
          </div>
        </div>
      )}

      {viewRecipeId && (() => {
        const recipe = getRecipe(viewRecipeId);
        if (!recipe) { setViewRecipeId(null); return null; }
        return (
          <div className={`${styles.importModalOverlay} ${styles.printableRecipe}`} onClick={() => setViewRecipeId(null)}>
            <div className={styles.importModalContent} onClick={e => e.stopPropagation()}>
              <button className={styles.importModalClose} onClick={() => setViewRecipeId(null)}>&times;</button>
              <RecipeDetail
                recipe={recipe}
                onBack={() => setViewRecipeId(null)}
                onSave={(data) => { updateRecipe(viewRecipeId, data); }}
                onDelete={() => { handleDelete(viewRecipeId); setViewRecipeId(null); }}
                onAddToWeek={() => handleAddToWeek(viewRecipeId)}
                weeklyPlan={weeklyPlan}
                user={user}
              />
            </div>
          </div>
        );
      })()}

      {showGoalsModal && (
        <GoalsPage
          asModal
          onComplete={(goals) => {
            onCompleteGoals(goals);
            onCloseGoalsModal();
          }}
          onSkip={onCloseGoalsModal}
          onBack={onCloseGoalsModal}
        />
      )}

      <HelpBubble user={user} currentView={view} />
    </div>
  );
}

// Views: "list" | "detail" | "add"
function App() {
  const {
    user, loading, dataReady, isGuest, currentOnboardingStep, justOnboarded, logOut,
    completeGoals, skipGoals, goBackOnboarding, advanceOnboarding,
    completeNutritionGoals, completeKeyIngredients, completeRecipeSetup,
    restartOnboarding, cancelOnboarding, hasCompletedOnboarding,
  } = useAuth();

  const shareToken = new URLSearchParams(window.location.search).get('share');
  if (shareToken) {
    return <SharedRecipePage token={shareToken} user={user} />;
  }

  if (loading || (user && !dataReady)) {
    return (
      <div className={styles.app}>
        <div className={styles.loadingScreen}>Loading...</div>
      </div>
    );
  }

  if (!user && !isGuest) {
    return <LoginPage />;
  }

  const onboardingBack = hasCompletedOnboarding ? cancelOnboarding : logOut;

  if (currentOnboardingStep === 'goals') {
    const goalsSkip = hasCompletedOnboarding ? cancelOnboarding : skipGoals;
    const goalsBack = hasCompletedOnboarding ? cancelOnboarding : logOut;
    return (
      <ErrorBoundary>
        <AppContent
          key={user?.uid || 'guest'}
          user={user}
          logOut={logOut}
          isNewUser={false}
          restartOnboarding={restartOnboarding}
          showGoalsModal={false}
          onCloseGoalsModal={cancelOnboarding}
          onCompleteGoals={completeGoals}
        />
        <GoalsPage asModal onComplete={completeGoals} onSkip={goalsSkip} onBack={goalsBack} />
      </ErrorBoundary>
    );
  }

  if (currentOnboardingStep === 'nutrition-goals') {
    return <NutritionGoalsPage onComplete={completeNutritionGoals} onBack={goBackOnboarding} onSkip={advanceOnboarding} recipes={[]} />;
  }

  if (currentOnboardingStep === 'key-ingredients') {
    return <OnboardingPage onComplete={completeKeyIngredients} onCancel={goBackOnboarding} onSkip={advanceOnboarding} />;
  }

  if (currentOnboardingStep === 'recipe-setup') {
    return <ImportRecipePage onSave={(data) => { addRecipe(data); completeRecipeSetup(); }} onAddWithoutClose={(data) => { addRecipe(data); }} onCancel={completeRecipeSetup} />;
  }

  // key={user?.uid} forces full remount when the user changes,
  // so all useState initializers re-read from freshly-hydrated localStorage
  return (
    <ErrorBoundary>
      <AppContent
        key={user?.uid || 'guest'}
        user={user}
        logOut={logOut}
        isNewUser={justOnboarded}
        restartOnboarding={restartOnboarding}
        showGoalsModal={hasCompletedOnboarding && currentOnboardingStep === 'goals'}
        onCloseGoalsModal={cancelOnboarding}
        onCompleteGoals={completeGoals}
      />
    </ErrorBoundary>
  );
}

export default App;
