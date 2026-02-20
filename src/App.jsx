import { useState, useEffect, useRef } from 'react';
import { useRecipes } from './hooks/useRecipes';
import { RecipeList } from './components/RecipeList';
import { RecipeDetail } from './components/RecipeDetail';
import { RecipeForm } from './components/RecipeForm';
import { GroceryStaples } from './components/GroceryStaples';
import { ShoppingList } from './components/ShoppingList';
import { IngredientsPage } from './components/IngredientsPage';
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
    { label: 'Grocery Staples', id: 'grocery-staples' },
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
        <div className={styles.homeLayout}>
          <aside className={styles.sidebar}>
            <div id="shopping-list">
              <ShoppingList
                weeklyRecipes={weeklyPlan.map(id => getRecipe(id)).filter(Boolean)}
              />
            </div>
            <div id="grocery-staples">
              <GroceryStaples />
            </div>
          </aside>
          <div className={styles.content}>
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
        </div>

        {view === 'detail' && selectedId && (
          <div className={styles.overlay} onClick={() => setView('list')}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
              <RecipeDetail
                recipe={getRecipe(selectedId)}
                onEdit={() => setView('edit')}
                onDelete={handleDelete}
                onBack={() => setView('list')}
              />
            </div>
          </div>
        )}

        {view === 'add' && (
          <div className={styles.overlay} onClick={() => setView('list')}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
              <RecipeForm onSave={handleAdd} onCancel={() => setView('list')} />
            </div>
          </div>
        )}

        {view === 'edit' && selectedId && (
          <div className={styles.overlay} onClick={() => setView('detail')}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
              <RecipeForm
                recipe={getRecipe(selectedId)}
                onSave={handleUpdate}
                onCancel={() => setView('detail')}
              />
            </div>
          </div>
        )}

        {view === 'ingredients' && (
          <div className={styles.overlay} onClick={() => setView('list')}>
            <div className={styles.modalWide} onClick={e => e.stopPropagation()}>
              <IngredientsPage onClose={() => setView('list')} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
