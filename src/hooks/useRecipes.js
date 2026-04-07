import { useState, useEffect } from 'react';
import { auth } from '../firebase';
import { saveField } from '../utils/firestoreSync';
import { classifyMealType } from '../utils/classifyMealType';

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

    // One-time migration: auto-classify mealType for all recipes without one
    const MIGRATION_KEY_4 = 'recipe-tracker-migrated-auto-classify-mealtype';
    if (recipes.length > 0 && !localStorage.getItem(MIGRATION_KEY_4)) {
      let changed = false;
      for (const r of recipes) {
        if (r.mealType) continue;
        const classified = classifyMealType(r.ingredients || []);
        if (classified) {
          r.mealType = classified;
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
      }
      localStorage.setItem(MIGRATION_KEY_4, '1');
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
  if (!user) {
    window.__recipeSyncStatus = 'error';
    window.__recipeSyncError = 'Not signed in — changes saved locally only';
    window.dispatchEvent(new Event('recipe-sync-status'));
    return;
  }
  window.__recipesLocalEdit = true;
  window.__recipeSyncStatus = 'syncing';
  window.dispatchEvent(new Event('recipe-sync-status'));
  syncToFirestore(user.uid, recipes);
}

async function syncToFirestore(uid, recipes, retryCount = 0) {
  try {
    await saveField(uid, 'recipes', recipes);
    setTimeout(() => { window.__recipesLocalEdit = false; }, 2000);
    window.__recipeSyncStatus = 'synced';
    window.dispatchEvent(new Event('recipe-sync-status'));
  } catch (err) {
    if (retryCount < 3) {
      window.__recipeSyncStatus = 'retrying';
      window.dispatchEvent(new Event('recipe-sync-status'));
      setTimeout(() => syncToFirestore(uid, recipes, retryCount + 1), 1000 * Math.pow(2, retryCount));
    } else {
      window.__recipeSyncStatus = 'error';
      window.__recipeSyncError = err?.message || 'Sync failed';
      window.dispatchEvent(new Event('recipe-sync-status'));
      console.error('Recipe sync failed after 3 retries:', err);
    }
  }
}

export function useRecipes() {
  const [recipes, setRecipes] = useState(loadRecipes);

  // Re-read localStorage when remote Firestore data is synced
  useEffect(() => {
    function handleSync() {
      setRecipes(loadRecipes());
    }
    window.addEventListener('firestore-sync', handleSync);
    return () => window.removeEventListener('firestore-sync', handleSync);
  }, []);

  // Fetch latest recipes from Firestore on mount and when tab becomes visible again
  // (Safari on iPad suspends background tabs, killing the onSnapshot WebSocket)
  useEffect(() => {
    function fetchAndMerge() {
      const user = auth.currentUser;
      if (!user) return;
      import('../utils/firestoreSync').then(({ loadRecipesFromFirestore }) => {
        loadRecipesFromFirestore(user.uid).then(remoteRecipes => {
          if (!remoteRecipes || remoteRecipes.length === 0) return;
          if (window.__recipesLocalEdit) return; // don't clobber active edits
          const localRecipes = loadRecipes();
          const localMap = new Map(localRecipes.filter(r => r.id).map(r => [r.id, r]));
          const merged = new Map();
          for (const r of remoteRecipes) {
            if (!r.id) continue;
            const local = localMap.get(r.id);
            if (!local) { merged.set(r.id, r); continue; }
            const lt = local.updatedAt || local.createdAt || '';
            const rt = r.updatedAt || r.createdAt || '';
            merged.set(r.id, rt >= lt ? r : local);
          }
          for (const [id, local] of localMap) {
            if (!merged.has(id)) merged.set(id, local);
          }
          const result = Array.from(merged.values());
          localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
          setRecipes(result);
        }).catch(() => {});
      });
    }

    fetchAndMerge(); // on mount

    function handleVisibility() {
      if (document.visibilityState === 'visible') fetchAndMerge();
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  function addRecipe(recipe) {
    // Auto-assign ingredients to instruction steps based on name matching
    if (recipe.instructions && recipe.ingredients?.length > 0 && !recipe.stepIngredients) {
      const steps = (recipe.stepsArray && recipe.stepsArray.length > 0)
        ? recipe.stepsArray
        : recipe.instructions.replace(/\.\s+(\d+[.)]\s+)/g, '.\n$1').split('\n').map(s => s.replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean);

      if (steps.length > 0) {
        const stepIngredients = {};
        steps.forEach((stepText, si) => {
          const stepLower = (stepText || '').replace(/<[^>]*>/g, '').toLowerCase();
          const matched = [];
          recipe.ingredients.forEach((ing, ii) => {
            const name = (ing.ingredient || '').trim().toLowerCase()
              .replace(/_/g, ' ');
            if (!name) return;
            // Match full ingredient name or individual words (>3 chars)
            const words = name.split(/\s+/);
            if (stepLower.includes(name) || words.some(w => w.length > 3 && stepLower.includes(w))) {
              matched.push(ii);
            }
          });
          if (matched.length > 0) stepIngredients[si] = matched;
        });
        if (Object.keys(stepIngredients).length > 0) {
          recipe.stepIngredients = stepIngredients;
        }
      }
    }

    const now = new Date().toISOString();
    const newRecipe = {
      ...recipe,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    setRecipes(prev => {
      const next = [newRecipe, ...prev];
      save(next);
      return next;
    });
    return newRecipe;
  }

  function updateRecipe(id, updates) {
    setRecipes(prev => {
      const next = prev.map(r => (r.id === id ? { ...r, ...updates, updatedAt: new Date().toISOString() } : r));
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
      const now = new Date().toISOString();
      const toAdd = newRecipes
        .filter(r => !existingTitles.has(r.title.toLowerCase()))
        .map(r => ({
          ...r,
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
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

    // Count matches against current recipes
    const updated = recipes.filter(r =>
      lookup.has((r.title || '').toLowerCase().trim())
    ).length;

    // Apply updates
    setRecipes(prev => {
      const next = prev.map(r => {
        const steps = lookup.get((r.title || '').toLowerCase().trim());
        if (steps && steps.length > 0) {
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
