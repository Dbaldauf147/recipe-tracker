import { useState, useEffect } from 'react';
import { useRecipes } from './hooks/useRecipes';
import { RecipeList } from './components/RecipeList';
import { RecipeDetail } from './components/RecipeDetail';
import { RecipeForm } from './components/RecipeForm';
import { GroceryStaples } from './components/GroceryStaples';
import { ShoppingList } from './components/ShoppingList';
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

  useEffect(() => {
    localStorage.setItem(WEEKLY_KEY, JSON.stringify(weeklyPlan));
  }, [weeklyPlan]);

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
    setWeeklyPlan(prev => prev.filter(wid => wid !== id));
    setView('list');
  }

  function handleAddToWeek(id) {
    setWeeklyPlan(prev => prev.includes(id) ? prev : [...prev, id]);
  }

  function handleRemoveFromWeek(id) {
    setWeeklyPlan(prev => prev.filter(wid => wid !== id));
  }

  function handleClearWeek() {
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
      </header>

      <main className={styles.main}>
        <div className={styles.homeLayout}>
          <aside className={styles.sidebar}>
            <ShoppingList
              weeklyRecipes={weeklyPlan.map(id => getRecipe(id)).filter(Boolean)}
            />
            <GroceryStaples />
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
      </main>
    </div>
  );
}

export default App;
