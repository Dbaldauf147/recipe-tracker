import { useState } from 'react';
import { useRecipes } from './hooks/useRecipes';
import { RecipeList } from './components/RecipeList';
import { RecipeDetail } from './components/RecipeDetail';
import { RecipeForm } from './components/RecipeForm';
import { GroceryStaples } from './components/GroceryStaples';
import styles from './App.module.css';

// Views: "list" | "detail" | "add" | "edit"
function App() {
  const { recipes, addRecipe, updateRecipe, deleteRecipe, getRecipe, importRecipes } =
    useRecipes();

  const [view, setView] = useState('list');
  const [selectedId, setSelectedId] = useState(null);

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
    setView('list');
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.logo} onClick={() => setView('list')}>
          Recipe Tracker
        </h1>
      </header>

      <main className={styles.main}>
        {view === 'list' && (
          <div className={styles.homeLayout}>
            <aside className={styles.sidebar}>
              <GroceryStaples />
            </aside>
            <div className={styles.content}>
              <RecipeList
                recipes={recipes}
                onSelect={handleSelect}
                onAdd={() => setView('add')}
                onImport={importRecipes}
              />
            </div>
          </div>
        )}

        {view === 'detail' && selectedId && (
          <RecipeDetail
            recipe={getRecipe(selectedId)}
            onEdit={() => setView('edit')}
            onDelete={handleDelete}
            onBack={() => setView('list')}
          />
        )}

        {view === 'add' && (
          <RecipeForm onSave={handleAdd} onCancel={() => setView('list')} />
        )}

        {view === 'edit' && selectedId && (
          <RecipeForm
            recipe={getRecipe(selectedId)}
            onSave={handleUpdate}
            onCancel={() => setView('detail')}
          />
        )}
      </main>
    </div>
  );
}

export default App;
