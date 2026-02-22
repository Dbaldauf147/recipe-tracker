import * as XLSX from 'xlsx';

export function exportToExcel() {
  const wb = XLSX.utils.book_new();

  // --- Recipes ---
  const recipes = JSON.parse(localStorage.getItem('recipe-tracker-recipes') || '[]');
  const recipeRows = recipes.map(r => ({
    Title: r.title || '',
    Category: r.category || '',
    Frequency: r.frequency || '',
    'Meal Type': r.mealType || '',
    Servings: r.servings || '',
    'Prep Time': r.prepTime || '',
    'Cook Time': r.cookTime || '',
    Description: r.description || '',
    'Source URL': r.sourceUrl || '',
    Instructions: r.instructions || '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recipeRows.length ? recipeRows : [{}]), 'Recipes');

  // --- Recipe Ingredients ---
  const ingredientRows = [];
  for (const r of recipes) {
    for (const ing of r.ingredients || []) {
      ingredientRows.push({
        'Recipe Title': r.title || '',
        Quantity: ing.quantity || '',
        Measurement: ing.measurement || '',
        Ingredient: ing.ingredient || '',
      });
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ingredientRows.length ? ingredientRows : [{}]), 'Recipe Ingredients');

  // --- Key Ingredients ---
  const keyIngredients = JSON.parse(localStorage.getItem('sunday-key-ingredients') || '[]');
  const keyRows = keyIngredients.map(i => ({ Ingredient: i }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(keyRows.length ? keyRows : [{}]), 'Key Ingredients');

  // --- Weekly Plan ---
  const weeklyPlan = JSON.parse(localStorage.getItem('sunday-weekly-plan') || '[]');
  const recipeMap = new Map(recipes.map(r => [r.id, r.title]));
  const weekRows = weeklyPlan.map(id => ({ 'Recipe Title': recipeMap.get(id) || id }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(weekRows.length ? weekRows : [{}]), 'Weekly Plan');

  // --- Plan History ---
  const history = JSON.parse(localStorage.getItem('sunday-plan-history') || '[]');
  const historyRows = history.map(entry => ({
    Date: entry.date || '',
    'Recipe Titles': (entry.recipeIds || []).map(id => recipeMap.get(id) || id).join(', '),
    Timestamp: entry.timestamp || '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(historyRows.length ? historyRows : [{}]), 'Plan History');

  // --- Grocery Staples ---
  const staples = JSON.parse(localStorage.getItem('sunday-grocery-staples') || '[]');
  const stapleRows = staples.map(s => ({
    Quantity: s.quantity || '',
    Measurement: s.measurement || '',
    Ingredient: s.ingredient || '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stapleRows.length ? stapleRows : [{}]), 'Grocery Staples');

  // --- Pantry Spices ---
  const spices = JSON.parse(localStorage.getItem('sunday-pantry-spices') || '[]');
  const spiceRows = spices.map(s => ({ Ingredient: s }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(spiceRows.length ? spiceRows : [{}]), 'Pantry Spices');

  // --- Pantry Sauces ---
  const sauces = JSON.parse(localStorage.getItem('sunday-pantry-sauces') || '[]');
  const sauceRows = sauces.map(s => ({ Ingredient: s }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sauceRows.length ? sauceRows : [{}]), 'Pantry Sauces');

  // --- Download ---
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `sunday-backup-${today}.xlsx`);
}
