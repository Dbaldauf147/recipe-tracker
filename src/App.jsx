import { useState, useEffect, useRef } from 'react';
import { useRecipes } from './hooks/useRecipes';
import { useAuth } from './contexts/AuthContext';
import { saveField } from './utils/firestoreSync';
import { RecipeList } from './components/RecipeList';
import { RecipeDetail } from './components/RecipeDetail';
import { RecipeForm } from './components/RecipeForm';
import { IngredientsPage } from './components/IngredientsPage';
import { ShoppingListPage } from './components/ShoppingListPage';
import { HistoryPage } from './components/HistoryPage';
import { KeyIngredientsPage } from './components/KeyIngredientsPage';
import { ImportRecipePage } from './components/ImportRecipePage';
import { LoginPage } from './components/LoginPage';
import { OnboardingPage } from './components/OnboardingPage';
import { GoalsPage } from './components/GoalsPage';
import styles from './App.module.css';

const WEEKLY_KEY = 'sunday-weekly-plan';

function loadWeeklyPlan() {
  try {
    const data = localStorage.getItem(WEEKLY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Authenticated app content — rendered with key={user.uid} so it
 * remounts when the user changes, re-initializing all useState from localStorage.
 */
function AppContent({ user, logOut, isNewUser }) {
  const { recipes, addRecipe, updateRecipe, deleteRecipe, getRecipe, importRecipes } =
    useRecipes();

  const [view, setView] = useState('list');
  const [selectedId, setSelectedId] = useState(null);
  const [viewHistory, setViewHistory] = useState([]);
  const [weeklyPlan, setWeeklyPlan] = useState(loadWeeklyPlan);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);

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

  const NAV_ITEMS = [
    { label: 'Shopping List', action: 'shopping' },
    { label: "This Week's Menu", id: 'weekly-menu' },
    { label: 'History', action: 'history' },
    { label: 'Key Ingredients', action: 'key-ingredients' },
    { label: 'Import Recipe', action: 'import' },
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
  }

  function handleClearWeek() {
    saveWeek([]);
    setWeeklyPlan([]);
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
        <img
          className={styles.logo}
          src="/sunday-logo.png"
          alt="Sunday"
          onClick={() => { setView('list'); setSelectedId(null); setViewHistory([]); }}
        />
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
          <span className={styles.userName}>{user.displayName}</span>
          <button
            className={styles.settingsBtn}
            onClick={() => setSettingsOpen(prev => !prev)}
            aria-label="Settings"
          >
            ⚙
          </button>
          {settingsOpen && (
            <div className={styles.settingsDropdown}>
              <div className={styles.settingsUserRow}>
                {user.photoURL && (
                  <img
                    className={styles.avatar}
                    src={user.photoURL}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                )}
                <span>{user.displayName}</span>
              </div>
              <button
                className={styles.settingsMenuItem}
                onClick={() => { navigateTo('ingredients'); setSettingsOpen(false); }}
              >
                Ingredients
              </button>
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
        {view === 'import' ? (
          <ImportRecipePage
            onSave={handleAdd}
            onCancel={goBack}
          />
        ) : view === 'shopping' ? (
          <ShoppingListPage
            weeklyRecipes={weeklyPlan.map(id => getRecipe(id)).filter(Boolean)}
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
          <IngredientsPage onClose={goBack} />
        ) : view === 'detail' && selectedId ? (
          <RecipeDetail
            recipe={getRecipe(selectedId)}
            onSave={handleUpdate}
            onDelete={handleDelete}
            onBack={goBack}
          />
        ) : view === 'add' ? (
          <RecipeForm onSave={handleAdd} onCancel={goBack} />
        ) : (
          <div className={styles.homeLayout}>
            <RecipeList
              recipes={recipes}
              onSelect={handleSelect}
              onAdd={() => navigateTo('add')}
              onImport={importRecipes}
              weeklyPlan={weeklyPlan}
              onAddToWeek={handleAddToWeek}
              onRemoveFromWeek={handleRemoveFromWeek}
              onClearWeek={handleClearWeek}
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
  const { user, loading, dataReady, onboardingStep, justOnboarded, logOut, completeGoals, completeOnboarding } = useAuth();

  if (loading || (user && !dataReady)) {
    return (
      <div className={styles.app}>
        <div className={styles.loadingScreen}>Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  if (onboardingStep === 'goals') {
    return <GoalsPage onComplete={completeGoals} />;
  }

  if (onboardingStep === 'ingredients') {
    return <OnboardingPage onComplete={completeOnboarding} />;
  }

  // key={user.uid} forces full remount when the user changes,
  // so all useState initializers re-read from freshly-hydrated localStorage
  return <AppContent key={user.uid} user={user} logOut={logOut} isNewUser={justOnboarded} />;
}

export default App;
