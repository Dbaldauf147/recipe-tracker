import { useState, useEffect, useRef } from 'react';
import { useRecipes } from './hooks/useRecipes';
import { RecipeList } from './components/RecipeList';
import { RecipeDetail } from './components/RecipeDetail';
import { RecipeForm } from './components/RecipeForm';
import { IngredientsPage } from './components/IngredientsPage';
import { ShoppingListPage } from './components/ShoppingListPage';
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

// Views: "list" | "detail" | "add" | "edit"
function App() {
  const { recipes, addRecipe, updateRecipe, deleteRecipe, getRecipe, importRecipes } =
    useRecipes();

  const [view, setView] = useState('list');
  const [selectedId, setSelectedId] = useState(null);
  const [weeklyPlan, setWeeklyPlan] = useState(loadWeeklyPlan);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  function saveWeek(plan) {
    try { localStorage.setItem(WEEKLY_KEY, JSON.stringify(plan)); } catch {}
  }

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const NAV_ITEMS = [
    { label: 'Ingredients', action: 'ingredients' },
    { label: 'Shopping List', action: 'shopping' },
    { label: "This Week's Menu", id: 'weekly-menu' },
    { label: 'Breakfast', id: 'cat-breakfast' },
    { label: 'Lunch & Dinner', id: 'cat-lunch-dinner' },
    { label: 'Snacks', id: 'cat-snacks' },
    { label: 'Desserts', id: 'cat-desserts' },
    { label: 'Drinks', id: 'cat-drinks' },
  ];

  function handleNavClick(item) {
    setMenuOpen(false);
    if (item.action === 'ingredients') {
      setView('ingredients');
    } else if (item.action === 'shopping') {
      setView('shopping');
    } else if (item.id) {
      const el = document.getElementById(item.id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.logo} onClick={() => setView('list')}>
          Sunday
        </h1>
        <span className={styles.tagline}>meal planning, simplified</span>
        <div className={styles.navMenu} ref={menuRef}>
          <button
            className={styles.menuBtn}
            onClick={() => setMenuOpen(prev => !prev)}
            aria-expanded={menuOpen}
          >
            <span className={styles.hamburger}>
              <span /><span /><span />
            </span>
          </button>
          {menuOpen && (
            <ul className={styles.dropdown}>
              {NAV_ITEMS.map(item => (
                <li key={item.action || item.id}>
                  <button
                    className={styles.dropdownItem}
                    onClick={() => handleNavClick(item)}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <main className={styles.main}>
        {view === 'shopping' ? (
          <ShoppingListPage
            weeklyRecipes={weeklyPlan.map(id => getRecipe(id)).filter(Boolean)}
            onClose={() => setView('list')}
          />
        ) : view === 'ingredients' ? (
          <IngredientsPage onClose={() => setView('list')} />
        ) : view === 'detail' && selectedId ? (
          <RecipeDetail
            recipe={getRecipe(selectedId)}
            onEdit={() => setView('edit')}
            onDelete={handleDelete}
            onBack={() => setView('list')}
          />
        ) : view === 'add' ? (
          <RecipeForm onSave={handleAdd} onCancel={() => setView('list')} />
        ) : view === 'edit' && selectedId ? (
          <RecipeForm
            recipe={getRecipe(selectedId)}
            onSave={handleUpdate}
            onCancel={() => setView('detail')}
          />
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
            />
          </div>
        )}


      </main>
    </div>
  );
}

export default App;
