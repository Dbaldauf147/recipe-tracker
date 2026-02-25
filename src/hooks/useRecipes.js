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

  async function importInstructions() {
    const INSTRUCTIONS_CSV_URL =
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vRg2H-pU53B_n0WCG3f_vz3ye-8IicvsqvTM2xohwVaEitNIZr6PbrgRn8-5qlTn-cSwnt2m3FjXIae/pub?gid=1736368634&single=true&output=csv';

    const resp = await fetch(INSTRUCTIONS_CSV_URL);
    const csv = await resp.text();
    const lines = csv.split('\n');

    // Parse CSV into recipe name -> instruction steps
    const parsed = new Map();
    let currentRecipe = null;
    let inSteps = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === ',' || trimmed === '') { currentRecipe = null; inSteps = false; continue; }
      if (trimmed.startsWith('http')) continue;
      const idx = trimmed.indexOf(',');
      if (idx === -1) continue;
      const name = trimmed.substring(0, idx).trim();
      let instruction = trimmed.substring(idx + 1).trim();
      if (instruction.startsWith('"') && instruction.endsWith('"')) {
        instruction = instruction.slice(1, -1).replace(/""/g, '"');
      }
      if (name.startsWith('!') || instruction === 'Instructions' || instruction === 'Steps') { inSteps = true; continue; }
      if (!inSteps) { if (name && !currentRecipe) currentRecipe = name; continue; }
      if (!instruction) continue;
      const recipeName = currentRecipe || name;
      if (!recipeName) continue;
      if (!parsed.has(recipeName)) parsed.set(recipeName, []);
      parsed.get(recipeName).push(instruction);
    }

    // Build case-insensitive lookup
    const lookup = new Map();
    for (const [name, steps] of parsed) {
      lookup.set(name.toLowerCase().trim(), steps);
    }

    // Match and update recipes
    let updated = 0;
    setRecipes(prev => {
      const next = prev.map(r => {
        const steps = lookup.get((r.title || '').toLowerCase().trim());
        if (steps && steps.length > 0) {
          updated++;
          return { ...r, instructions: steps.join('\n') };
        }
        return r;
      });
      save(next);
      return next;
    });

    return { total: parsed.size, updated };
  }

  return { recipes, addRecipe, updateRecipe, deleteRecipe, getRecipe, importRecipes, importInstructions };
}
