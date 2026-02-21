import { useState } from 'react';
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

// Views: "list" | "detail" | "add"
function App() {
  const { user, loading, logOut } = useAuth();
  const { recipes, addRecipe, updateRecipe, deleteRecipe, getRecipe, importRecipes } =
    useRecipes();

  const [view, setView] = useState('list');
  const [selectedId, setSelectedId] = useState(null);
  const [weeklyPlan, setWeeklyPlan] = useState(loadWeeklyPlan);
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
    { label: 'Ingredients', action: 'ingredients' },
  ];

  function handleNavClick(item) {
    if (item.action === 'ingredients') {
      setView('ingredients');
    } else if (item.action === 'shopping') {
      setView('shopping');
    } else if (item.action === 'history') {
      setView('history');
    } else if (item.action === 'key-ingredients') {
      setView('key-ingredients');
    } else if (item.action === 'import') {
      setView('import');
    } else if (item.id) {
      if (view !== 'list') setView('list');
      setTimeout(() => {
        const el = document.getElementById(item.id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  }

  function handleSelect(id) {
    setSelectedId(id);
    setView('detail');
  }

  function handleAdd(data) {
    addRecipe(data);
    setView('list');
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

  if (loading) {
    return (
      <div className={styles.app}>
        <div className={styles.loadingScreen}>Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.logo} onClick={() => setView('list')}>
          Sunday
        </h1>
        <span className={styles.tagline}>meal planning, simplified</span>
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
        <div className={styles.userInfo}>
          {user.photoURL && (
            <img
              className={styles.avatar}
              src={user.photoURL}
              alt=""
              referrerPolicy="no-referrer"
            />
          )}
          <span className={styles.userName}>{user.displayName}</span>
          <button className={styles.signOutBtn} onClick={logOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className={styles.main}>
        {view === 'import' ? (
          <ImportRecipePage
            onSave={handleAdd}
            onCancel={() => setView('list')}
          />
        ) : view === 'shopping' ? (
          <ShoppingListPage
            weeklyRecipes={weeklyPlan.map(id => getRecipe(id)).filter(Boolean)}
            onClose={() => setView('list')}
          />
        ) : view === 'key-ingredients' ? (
          <KeyIngredientsPage
            recipes={recipes}
            getRecipe={getRecipe}
            onClose={() => setView('list')}
          />
        ) : view === 'history' ? (
          <HistoryPage
            getRecipe={getRecipe}
            recipes={recipes}
            onClose={() => setView('list')}
          />
        ) : view === 'ingredients' ? (
          <IngredientsPage onClose={() => setView('list')} />
        ) : view === 'detail' && selectedId ? (
          <RecipeDetail
            recipe={getRecipe(selectedId)}
            onSave={handleUpdate}
            onDelete={handleDelete}
            onBack={() => setView('list')}
          />
        ) : view === 'add' ? (
          <RecipeForm onSave={handleAdd} onCancel={() => setView('list')} />
        ) : (
          <div className={styles.homeLayout}>
            <RecipeList
              recipes={recipes}
              onSelect={handleSelect}
              onAdd={() => setView('add')}
              onImport={importRecipes}
              weeklyPlan={weeklyPlan}
              onAddToWeek={handleAddToWeek}
              onRemoveFromWeek={handleRemoveFromWeek}
              onClearWeek={handleClearWeek}
              onCategoryChange={handleCategoryChange}
              getRecipe={getRecipe}
              onSaveToHistory={handleSaveToHistory}
            />
          </div>
        )}


      </main>
    </div>
  );
}

export default App;
