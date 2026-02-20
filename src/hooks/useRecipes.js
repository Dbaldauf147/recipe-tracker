import { useState } from 'react';

const STORAGE_KEY = 'recipe-tracker-recipes';

function loadRecipes() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function save(recipes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
  } catch {
    // storage full or unavailable
  }
}

export function useRecipes() {
  const [recipes, setRecipes] = useState(loadRecipes);

  function addRecipe(recipe) {
    const newRecipe = {
      ...recipe,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    setRecipes(prev => {
      const next = [newRecipe, ...prev];
      save(next);
      return next;
    });
  }

  function updateRecipe(id, updates) {
    setRecipes(prev => {
      const next = prev.map(r => (r.id === id ? { ...r, ...updates } : r));
      save(next);
      return next;
    });
  }

  function deleteRecipe(id) {
    setRecipes(prev => {
      const next = prev.filter(r => r.id !== id);
      save(next);
      return next;
    });
  }

  function getRecipe(id) {
    return recipes.find(r => r.id === id) || null;
  }

  function importRecipes(newRecipes) {
    setRecipes(prev => {
      const existingTitles = new Set(prev.map(r => r.title.toLowerCase()));
      const toAdd = newRecipes
        .filter(r => !existingTitles.has(r.title.toLowerCase()))
        .map(r => ({
          ...r,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        }));
      const next = [...toAdd, ...prev];
      save(next);
      return next;
    });
  }

  return { recipes, addRecipe, updateRecipe, deleteRecipe, getRecipe, importRecipes };
}
