import { useState, useEffect, useRef, useMemo } from 'react';
import { useRecipes } from './hooks/useRecipes';
import { useAuth } from './contexts/AuthContext';
import { saveField, getPendingRequests, getPendingSharedRecipes, loadFriends, loadFriendShoppingList } from './utils/firestoreSync';
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
import { ProfilePage } from './components/ProfilePage';
import { WorkoutPage } from './components/WorkoutPage';
import { FeaturesPage } from './components/FeaturesPage';
import { UpdatePill } from './components/UpdatePill';
import { NutritionOnboarding } from './components/NutritionOnboarding';
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
  const { recipes, addRecipe, updateRecipe, deleteRecipe, getRecipe, importRecipes, refreshLinkedRecipes } =
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
  const [modalView, setModalView] = useState(null);
  // Holds a friend-shared recipe being viewed inline (without persisting it
  // to the user's own library). Cleared when the user navigates away.
  const [transientViewRecipe, setTransientViewRecipe] = useState(null);
  const [weeklyPlan, setWeeklyPlan] = useState(loadWeeklyPlan);
  const [weeklyServings, setWeeklyServings] = useState(loadWeeklyServings);
  // Friends who have toggled "Share my shopping list" on for this user.
  // Each entry: { uid, username, meals: [<full recipe objects>] }.
  // Loaded once per session here so both ShoppingList and RecipeList can use it.
  const [sharedFromFriends, setSharedFromFriends] = useState([]);
  useEffect(() => {
    if (!user?.uid) { setSharedFromFriends([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const friends = await loadFriends(user.uid);
        const sharers = friends.filter(f => f.hasSharedShoppingWithMe);
        const lists = await Promise.all(sharers.map(async f => {
          const data = await loadFriendShoppingList(f.uid);
          return {
            uid: f.uid,
            username: data.username || f.username || f.displayName || 'friend',
            meals: data.meals || [],
          };
        }));
        if (!cancelled) setSharedFromFriends(lists.filter(l => l.meals.length > 0));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [viewRecipeId, setViewRecipeId] = useState(null);
  const [weighNeedsLog, setWeighNeedsLog] = useState(() => checkWeighReminder());
  // Re-check when navigating back from weight tracker or when localStorage changes
  useEffect(() => {
    const recheck = () => setWeighNeedsLog(checkWeighReminder());
    window.addEventListener('storage', recheck);
    window.addEventListener('weight-logged', recheck);
    return () => { window.removeEventListener('storage', recheck); window.removeEventListener('weight-logged', recheck); };
  }, []);
  // Also recheck when view changes (e.g., navigating away from weight tracker)
  useEffect(() => { setWeighNeedsLog(checkWeighReminder()); }, [view]);
  const showWeighBanner = weighNeedsLog && (() => {
    try {
      const stats = JSON.parse(localStorage.getItem('sunday-body-stats') || '{}');
      return ['lose', 'maintain', 'gain'].some(k => (stats.weightGoals || []).includes(k));
    } catch { return false; }
  })();
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
    // When opening a recipe detail, force-refresh linked-recipe data so the
    // viewer always sees the owner's latest edits (instead of stale cache).
    if (nextView === 'detail') {
      refreshLinkedRecipes().catch(() => {});
    }
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
    if (user) saveField(user.uid, 'weeklyPlan', plan).catch(() => {});
  }

  function saveWeeklyServings(servings) {
    try { localStorage.setItem(WEEKLY_SERVINGS_KEY, JSON.stringify(servings)); } catch {}
    if (user) saveField(user.uid, 'weeklyServings', servings).catch(() => {});
  }

  function handleUpdateWeeklyServings(recipeId, newServings) {
    setWeeklyServings(prev => {
      const next = { ...prev, [recipeId]: newServings };
      saveWeeklyServings(next);
      return next;
    });
  }

  const [navVersion, setNavVersion] = useState(0);

  const { showNutrition, showTrackMeals, showWeightTab, showRotateHealthy } = useMemo(() => {
    try {
      const focus = JSON.parse(localStorage.getItem('sunday-user-focus') || '[]');
      const nutritionEnabled = !Array.isArray(focus) || focus.length === 0 || focus.includes('nutrition');
      const stats = JSON.parse(localStorage.getItem('sunday-body-stats') || '{}');
      const goals = stats.mealTrackingGoals || [];
      return {
        showNutrition: nutritionEnabled,
        showTrackMeals: goals.includes('trackDaily') || goals.includes('trackWeekly'),
        showWeightTab: goals.includes('weighDaily') || goals.includes('weighWeekly') || goals.includes('weighBiweekly') || goals.includes('weighMonthly') || goals.includes('weighYearly'),
        showRotateHealthy: goals.includes('rotateHealthy'),
      };
    } catch { return { showNutrition: true, showTrackMeals: false, showWeightTab: false, showRotateHealthy: false }; }
  }, [navVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsHealthyFoods = showNutrition && showRotateHealthy && JSON.parse(localStorage.getItem('sunday-key-ingredients') || '[]').length === 0;

  // Listen for goal changes to update nav immediately
  useEffect(() => {
    function handleStorage(e) {
      if (e.key === 'sunday-body-stats' || e.key === 'sunday-nutrition-goals' || e.key === 'sunday-user-focus') {
        setNavVersion(v => v + 1);
      }
    }
    window.addEventListener('storage', handleStorage);
    // Also listen for custom event from auto-save
    function handleGoalUpdate() { setNavVersion(v => v + 1); }
    window.addEventListener('goals-updated', handleGoalUpdate);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('goals-updated', handleGoalUpdate);
    };
  }, []);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const NAV_ITEMS = [
    { label: 'Recipes', id: 'weekly-menu', icon: 'restaurant_menu' },
    ...(showNutrition ? [{ label: 'Nutrition', icon: 'clinical_notes', submenu: [
      { label: 'Goals', action: 'nutrition-goals' },
      ...(showTrackMeals ? [{ label: 'Track Meals', action: 'daily-tracker' }] : []),
      ...(showWeightTab ? [{ label: 'Weight', action: 'weight-tracker' }] : []),
      ...(showRotateHealthy ? [{ label: 'Healthy Foods', action: 'key-ingredients' }] : []),
    ] }] : []),
    { label: 'Shopping List', action: 'shopping', icon: 'shopping_cart' },
    ...((user?.email === 'baldaufdan@gmail.com' || localStorage.getItem('sunday-workout-enabled') === 'true') ? [{ label: 'Workout', action: 'workout', icon: 'fitness_center' }] : []),
  ];

  function handleNavClick(item) {
    if (item.action === 'features') {
      navigateTo('features');
    } else if (item.action === 'workout') {
      navigateTo('workout');
    } else if (item.action === 'shopping') {
      navigateTo('shopping');
    } else if (item.action === 'history') {
      navigateTo('history');
    } else if (item.action === 'key-ingredients') {
      setModalView('setup');
    } else if (item.action === 'import') {
      setModalView('import');
    } else if (item.action === 'nutrition-goals') {
      setModalView('nutrition-goals');
    } else if (item.action === 'daily-tracker') {
      navigateTo('daily-tracker');
    } else if (item.action === 'weight-tracker') {
      setModalView('weight-tracker');
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
      {/* Mobile sidebar toggle */}
      <button className={styles.sidebarToggle} onClick={() => setSidebarOpen(p => !p)} aria-label="Toggle menu">
        <span className="material-symbols-outlined">{sidebarOpen ? 'close' : 'menu'}</span>
      </button>

      {/* Sidebar Navigation */}
      <aside className={`${styles.sidebar}${sidebarOpen ? ` ${styles.sidebarOpen}` : ''}`}>
        <div className={styles.sidebarLogo} onClick={() => { setView('list'); setSelectedId(null); setViewHistory([]); setSidebarOpen(false); }}>
          <div className={styles.sidebarLogoText}>Prep Day</div>
          <div className={styles.sidebarSubtext}>The Digital Epicurean</div>
        </div>

        <nav className={styles.sidebarNav}>
          {NAV_ITEMS.map(item => {
            if (item.submenu) {
              const isAnyActive = item.submenu.some(s => s.action === view);
              return (
                <div key={item.label}>
                  <button
                    className={`${styles.sidebarItem}${isAnyActive ? ` ${styles.sidebarItemActive}` : ''}`}
                    onClick={() => handleNavClick(item.submenu[0])}
                  >
                    <span className={`material-symbols-outlined ${styles.sidebarIcon}`}>{item.icon}</span>
                    {item.label}
                  </button>
                  <div className={styles.sidebarSubmenu}>
                    {item.submenu.map(sub => (
                      <button
                        key={sub.action}
                        className={`${styles.sidebarSubItem}${view === sub.action ? ` ${styles.sidebarSubItemActive}` : ''}`}
                        onClick={() => { handleNavClick(sub); setSidebarOpen(false); }}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
            const isActive = item.action ? view === item.action : item.id && view === 'list';
            return (
              <button
                key={item.action || item.id}
                className={`${styles.sidebarItem}${isActive ? ` ${styles.sidebarItemActive}` : ''}`}
                onClick={() => { handleNavClick(item); setSidebarOpen(false); }}
              >
                <span className={`material-symbols-outlined ${styles.sidebarIcon}`}>{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className={styles.sidebarBottom}>
          <div className={styles.settingsWrapper} ref={settingsRef}>
            <button
              className={styles.settingsBtn}
              onClick={() => setSettingsOpen(prev => !prev)}
              aria-label="Settings"
            >
              <span className={`material-symbols-outlined ${styles.sidebarIcon}`}>settings</span>
              Settings
              {pendingCount > 0 && (
                <span className={styles.badge}>{pendingCount}</span>
              )}
            </button>
            {settingsOpen && (
              <div className={styles.settingsDropdown}>
                <div className={styles.settingsUserRow}>
                  {user?.photoURL && (
                    <img className={styles.avatar} src={user.photoURL} alt="" referrerPolicy="no-referrer" />
                  )}
                  <span>{user?.displayName || 'Guest'}</span>
                </div>
                <button className={styles.settingsMenuItem} onClick={() => { navigateTo('profile'); setSettingsOpen(false); }}>My Profile</button>
                <button className={styles.settingsMenuItem} onClick={() => { navigateTo('account-settings'); setSettingsOpen(false); }}>Account Settings</button>
                <button className={styles.settingsMenuItem} onClick={() => { navigateTo('friends'); setSettingsOpen(false); }}>
                  Friends
                  {pendingCount > 0 && <span className={styles.menuBadge}>{pendingCount}</span>}
                </button>
                <div className={styles.settingsDivider} />
                {user?.uid === ADMIN_UID && (
                  <button className={styles.settingsMenuItem} onClick={() => { navigateTo('admin'); setSettingsOpen(false); }}>Admin Dashboard</button>
                )}
                <button className={styles.settingsMenuItem} onClick={() => { navigateTo('history'); setSettingsOpen(false); }}>Meal History</button>
                <button className={styles.settingsMenuItem} onClick={() => { navigateTo('seasonal-guide'); setSettingsOpen(false); }}>Seasonal Guide</button>
                <button className={styles.settingsMenuItem} onClick={() => { navigateTo('sources'); setSettingsOpen(false); }}>Sources</button>
                <button className={styles.settingsMenuItem} onClick={() => { navigateTo('features'); setSettingsOpen(false); }}>Features</button>
                <div className={styles.settingsDivider} />
                <button className={styles.settingsMenuItem} onClick={() => { navigateTo('ingredients'); setSettingsOpen(false); }}>Ingredients</button>
                <button className={styles.settingsMenuItem} onClick={() => { restartOnboarding(); setSettingsOpen(false); }}>Setup</button>
                <div className={styles.settingsDivider} />
                <button className={styles.settingsMenuItem} onClick={() => { logOut(); setSettingsOpen(false); }}>Sign Out</button>
              </div>
            )}
          </div>

          <div className={styles.sidebarUser}>
            {user?.photoURL ? (
              <img className={styles.sidebarAvatar} src={user.photoURL} alt="" referrerPolicy="no-referrer" />
            ) : (
              <div className={styles.sidebarAvatarPlaceholder}>{(user?.displayName || 'G')[0]}</div>
            )}
            <div className={styles.sidebarUserInfo}>
              <span className={styles.sidebarUserName}>{user?.displayName || 'Guest'}</span>
              <span className={styles.sidebarUserRole}>Home Chef</span>
            </div>
          </div>
        </div>
      </aside>

      <main className={styles.main}>
        {(() => {
          const items = [];
          if (showWeighBanner) items.push({ label: "Enter this week's weight", action: () => navigateTo('weight-tracker') });
          if (needsHealthyFoods) items.push({ label: 'Select Healthy Foods to Prioritize', action: () => navigateTo('setup') });
          if (items.length === 0) return null;
          return (
            <div className={styles.actionBanner}>
              <span className={styles.actionBannerTitle}>Action Required</span>
              <div className={styles.actionBannerItems}>
                {items.map((item, i) => (
                  <button key={i} className={styles.actionBannerItem} onClick={item.action}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
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
        })() : view === 'workout' ? (
          <WorkoutPage onBack={goBack} user={user} />
        ) : view === 'profile' ? (
          <ProfilePage
            recipes={recipes}
            dailyLog={JSON.parse(localStorage.getItem('sunday-daily-log') || '{}')}
            planHistory={JSON.parse(localStorage.getItem('sunday-plan-history') || '[]')}
            onBack={goBack}
          />
        ) : view === 'features' ? (
          <FeaturesPage onClose={goBack} />
        ) : view === 'admin' ? (
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
            getRecipe={getRecipe}
            sharedFromFriends={sharedFromFriends}
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
            importRecipes={importRecipes}
          />
        ) : view === 'detail' && (transientViewRecipe || selectedId) ? (
          <ErrorBoundary>
            <RecipeDetail
              recipe={transientViewRecipe || getRecipe(selectedId)}
              onSave={handleUpdate}
              onDelete={handleDelete}
              onBack={() => { setTransientViewRecipe(null); goBack(); }}
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
              onSelectShared={(meal, sharer) => {
                setTransientViewRecipe({
                  ...meal,
                  source: 'shared-link',
                  sharedFromUid: sharer.uid,
                  sharedFromRecipeId: meal.id,
                  sharedFrom: sharer.username,
                });
                navigateTo('detail');
              }}
              onAdd={() => setShowImportModal(true)}
              onImport={importRecipes}
              weeklyPlan={weeklyPlan}
              weeklyServings={weeklyServings}
              sharedFromFriends={sharedFromFriends}
              onAddToWeek={handleAddToWeek}
              onRemoveFromWeek={handleRemoveFromWeek}
              onClearWeek={handleClearWeek}
              onUpdateWeeklyServings={handleUpdateWeeklyServings}
              onCategoryChange={handleCategoryChange}
              getRecipe={getRecipe}
              onSaveToHistory={handleSaveToHistory}
              onAddRecipe={addRecipe}
              onDelete={handleDelete}
              onUpdateRecipe={updateRecipe}
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
              userRecipes={recipes}
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

      {modalView && (
        <div className={styles.importModalOverlay} onClick={() => setModalView(null)}>
          <div className={modalView === 'nutrition-goals' ? styles.importModalContentWide : styles.importModalContent} onClick={e => e.stopPropagation()}>
            <button className={styles.importModalClose} onClick={() => setModalView(null)}>&times;</button>
            {modalView === 'nutrition-goals' ? (() => {
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
                  }}
                  onBack={() => setModalView(null)}
                />
              );
            })() : modalView === 'weight-tracker' ? (
              <WeightTracker onClose={() => setModalView(null)} user={user} />
            ) : modalView === 'key-ingredients' ? (
              <KeyIngredientsPage
                recipes={recipes}
                getRecipe={getRecipe}
                onClose={() => setModalView(null)}
                onSetup={() => setModalView('setup')}
              />
            ) : modalView === 'setup' ? (
              <OnboardingPage
                initialIngredients={JSON.parse(localStorage.getItem('sunday-key-ingredients') || '[]')}
                onComplete={(ingredients) => {
                  localStorage.setItem('sunday-key-ingredients', JSON.stringify(ingredients));
                  if (user) saveField(user.uid, 'keyIngredients', ingredients);
                }}
                onCancel={() => setModalView(null)}
                onViewSinceEaten={() => setModalView('key-ingredients')}
              />
            ) : modalView === 'import' ? (
              <ImportRecipePage
                onSave={(data) => { addRecipe(data); setModalView(null); }}
                onAddWithoutClose={(data) => { addRecipe(data); }}
                onCancel={() => setModalView(null)}
                userRecipes={recipes}
              />
            ) : null}
          </div>
        </div>
      )}

      <HelpBubble user={user} currentView={view} />
      <UpdatePill />
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
        <div className={styles.loadingScreen}>
          <div className={styles.loadingAnimation}>
            <span className={styles.loadingKnife}>🔪</span>
            <span className={styles.loadingCarrot}>🥕</span>
          </div>
        </div>
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
    return <NutritionOnboarding onComplete={completeNutritionGoals} onBack={goBackOnboarding} />;
  }

  if (currentOnboardingStep === 'weight-setup') {
    return <WeightTracker onClose={advanceOnboarding} user={user} isOnboarding />;
  }

  if (currentOnboardingStep === 'key-ingredients') {
    return <OnboardingPage onComplete={completeKeyIngredients} onCancel={goBackOnboarding} onSkip={advanceOnboarding} />;
  }

  if (currentOnboardingStep === 'recipe-setup') {
    const onboardingAddRecipe = (data) => {
      const newRecipe = { ...data, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
      try {
        const existing = JSON.parse(localStorage.getItem('recipe-tracker-recipes') || '[]');
        const next = [newRecipe, ...existing];
        localStorage.setItem('recipe-tracker-recipes', JSON.stringify(next));
        if (user) saveField(user.uid, 'recipes', next);
      } catch {}
    };
    return <ImportRecipePage onSave={(data) => { onboardingAddRecipe(data); completeRecipeSetup(); }} onAddWithoutClose={(data) => { onboardingAddRecipe(data); }} onCancel={completeRecipeSetup} userRecipes={[]} isOnboarding />;
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
