import { useState } from 'react';
import { auth } from '../firebase';
import { saveField } from '../utils/firestoreSync';

const STORAGE_KEY = 'recipe-tracker-recipes';

function loadRecipes() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const recipes = data ? JSON.parse(data) : [];

    // One-time migration: mark recipes with "special" in description as rare
    const MIGRATION_KEY = 'recipe-tracker-migrated-special-rare';
    if (recipes.length > 0 && !localStorage.getItem(MIGRATION_KEY)) {
      let changed = false;
      for (const r of recipes) {
        if (r.description && r.description.toLowerCase().includes('special') && r.frequency !== 'rare') {
          r.frequency = 'rare';
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
      }
      localStorage.setItem(MIGRATION_KEY, '1');
    }

    // One-time migration: mark recipes with "regular" in description as common
    const MIGRATION_KEY_2 = 'recipe-tracker-migrated-regular-common';
    if (recipes.length > 0 && !localStorage.getItem(MIGRATION_KEY_2)) {
      let changed = false;
      for (const r of recipes) {
        if (r.description && r.description.toLowerCase().includes('regular') && r.frequency !== 'common') {
          r.frequency = 'common';
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
      }
      localStorage.setItem(MIGRATION_KEY_2, '1');
    }

    // One-time migration: tag recipes containing meat as mealType "meat"
    const MIGRATION_KEY_3 = 'recipe-tracker-migrated-meat-type-v2';
    if (recipes.length > 0 && !localStorage.getItem(MIGRATION_KEY_3)) {
      const MEAT_WORDS = [
        'chicken', 'beef', 'pork', 'lamb', 'turkey', 'steak', 'bacon',
        'sausage', 'ham', 'salami', 'pepperoni', 'prosciutto', 'pancetta',
        'ground beef', 'ground turkey', 'ground pork', 'ground chicken',
        'meatball', 'brisket', 'ribs', 'roast', 'veal', 'duck',
        'chorizo', 'hot dog', 'bratwurst', 'kielbasa',
      ];
      const meatPattern = new RegExp('\\b(' + MEAT_WORDS.join('|') + ')\\b', 'i');
      let changed = false;
      for (const r of recipes) {
        if (r.mealType) continue; // don't overwrite existing
        const ingredientText = (r.ingredients || []).map(ing => {
          if (typeof ing === 'string') return ing;
          return [ing.ingredient, ing.quantity, ing.measurement].filter(Boolean).join(' ');
        }).join(' ');
        const allText = [r.title || '', ingredientText].join(' ');
        if (meatPattern.test(allText)) {
          r.mealType = 'meat';
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
      }
      localStorage.setItem(MIGRATION_KEY_3, '1');
    }

    return recipes;
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
  const user = auth.currentUser;
  if (user) saveField(user.uid, 'recipes', recipes);
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
