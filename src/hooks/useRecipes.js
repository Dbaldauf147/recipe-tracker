import { useState, useEffect } from 'react';

const STORAGE_KEY = 'recipe-tracker-recipes';

function loadRecipes() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function useRecipes() {
  const [recipes, setRecipes] = useState(loadRecipes);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
  }, [recipes]);

  function addRecipe(recipe) {
    const newRecipe = {
      ...recipe,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    setRecipes(prev => [newRecipe, ...prev]);
  }

  function updateRecipe(id, updates) {
    setRecipes(prev =>
      prev.map(r => (r.id === id ? { ...r, ...updates } : r))
    );
  }

  function deleteRecipe(id) {
    setRecipes(prev => prev.filter(r => r.id !== id));
  }

  function getRecipe(id) {
    return recipes.find(r => r.id === id) || null;
  }

  return { recipes, addRecipe, updateRecipe, deleteRecipe, getRecipe };
}
