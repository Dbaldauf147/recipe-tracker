import { useState, useEffect, useRef } from 'react';
import { useRecipes } from './hooks/useRecipes';
import { useAuth } from './contexts/AuthContext';
import { saveField, getPendingRequests, getPendingSharedRecipes } from './utils/firestoreSync';
import { RecipeList } from './components/RecipeList';
import { RecipeDetail } from './components/RecipeDetail';
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
import { NutritionGoalsPage } from './components/NutritionGoalsPage';
import { DailyTrackerPage } from './components/DailyTrackerPage';
import { RecipeSetupPage } from './components/RecipeSetupPage';
import React from 'react';
import styles from './App.module.css';

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
function AppContent({ user, logOut, isNewUser, restartOnboarding }) {
  const { recipes, addRecipe, updateRecipe, deleteRecipe, getRecipe, importRecipes } =
    useRecipes();

  const [view, setView] = useState('list');
  const [selectedId, setSelectedId] = useState(null);
  const [viewHistory, setViewHistory] = useState([]);
  const [weeklyPlan, setWeeklyPlan] = useState(loadWeeklyPlan);
  const [weeklyServings, setWeeklyServings] = useState(loadWeeklyServings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [ingredientsVersion, setIngredientsVersion] = useState(0);
  const settingsRef = useRef(null);

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
  }

  function goBack() {
    setViewHistory(prev => {
      if (prev.length === 0) {
        setView('list');
        setSelectedId(null);
        return prev;
      }
      const next = [...prev];
      const last = next.pop();
      setView(last.view);
      setSelectedId(last.selectedId);
      return next;
    });
  }
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

  const NAV_ITEMS = [
    { label: 'Shopping List', action: 'shopping' },
    { label: "This Week's Menu", id: 'weekly-menu' },
    { label: 'Daily Tracker', action: 'daily-tracker' },
    { label: 'History', action: 'history' },
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
    } else if (item.id) {
      if (view !== 'list') navigateTo('list');
      setTimeout(() => {
        const el = document.getElementById(item.id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  }

  function handleSelect(id) {
    navigateTo('detail', id);
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
          {NAV_ITEMS.map(item => {
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
                onClick={() => { navigateTo('key-ingredients'); setSettingsOpen(false); }}
              >
                Key Ingredients
              </button>
              <button
                className={styles.settingsMenuItem}
                onClick={() => { navigateTo('import'); setSettingsOpen(false); }}
              >
                Import Recipe
              </button>
              <button
                className={styles.settingsMenuItem}
                onClick={() => { navigateTo('nutrition-goals'); setSettingsOpen(false); }}
              >
                Nutrition Goals
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
                onClick={() => { navigateTo('ingredients'); setSettingsOpen(false); }}
              >
                Ingredients
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
        {view === 'daily-tracker' ? (
          <DailyTrackerPage recipes={recipes} getRecipe={getRecipe} onClose={goBack} user={user} />
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
                goBack();
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
          />
        ) : view === 'setup' ? (
          <OnboardingPage
            initialIngredients={JSON.parse(localStorage.getItem('sunday-key-ingredients') || '[]')}
            onComplete={(ingredients) => {
              localStorage.setItem('sunday-key-ingredients', JSON.stringify(ingredients));
              if (user) saveField(user.uid, 'keyIngredients', ingredients);
              goBack();
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
              user={user}
              ingredientsVersion={ingredientsVersion}
            />
          </ErrorBoundary>
        ) : view === 'add' ? (
          <RecipeForm onSave={handleAdd} onCancel={goBack} />
        ) : (
          <div className={styles.homeLayout}>
            <RecipeList
              recipes={recipes}
              onSelect={handleSelect}
              onAdd={() => navigateTo('import')}
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
    return <GoalsPage onComplete={completeGoals} onSkip={hasCompletedOnboarding ? cancelOnboarding : skipGoals} onBack={onboardingBack} />;
  }

  if (currentOnboardingStep === 'nutrition-goals') {
    return <NutritionGoalsPage onComplete={completeNutritionGoals} onBack={goBackOnboarding} onSkip={advanceOnboarding} recipes={[]} />;
  }

  if (currentOnboardingStep === 'key-ingredients') {
    return <OnboardingPage onComplete={completeKeyIngredients} onCancel={goBackOnboarding} onSkip={advanceOnboarding} />;
  }

  if (currentOnboardingStep === 'recipe-setup') {
    return <RecipeSetupPage onComplete={completeRecipeSetup} onBack={goBackOnboarding} onSkip={completeRecipeSetup} />;
  }

  // key={user?.uid} forces full remount when the user changes,
  // so all useState initializers re-read from freshly-hydrated localStorage
  return (
    <ErrorBoundary>
      <AppContent key={user?.uid || 'guest'} user={user} logOut={logOut} isNewUser={justOnboarded} restartOnboarding={restartOnboarding} />
    </ErrorBoundary>
  );
}

export default App;
