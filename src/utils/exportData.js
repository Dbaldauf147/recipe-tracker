function csvEscape(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCSVSection(title, headers, rows) {
  const lines = [`=== ${title} ===`];
  lines.push(headers.map(csvEscape).join(','));
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  lines.push('');
  return lines.join('\n');
}

export function exportToCSV() {
  const recipes = JSON.parse(localStorage.getItem('recipe-tracker-recipes') || '[]');
  const recipeMap = new Map(recipes.map(r => [r.id, r.title]));
  const sections = [];

  // Recipes
  sections.push(toCSVSection('Recipes',
    ['Title', 'Category', 'Frequency', 'Meal Type', 'Servings', 'Prep Time', 'Cook Time', 'Description', 'Source URL', 'Instructions'],
    recipes.map(r => [r.title, r.category, r.frequency, r.mealType, r.servings, r.prepTime, r.cookTime, r.description, r.sourceUrl, r.instructions])
  ));

  // Recipe Ingredients
  const ingRows = [];
  for (const r of recipes) {
    for (const ing of r.ingredients || []) {
      ingRows.push([r.title, ing.quantity, ing.measurement, ing.ingredient]);
    }
  }
  sections.push(toCSVSection('Recipe Ingredients',
    ['Recipe Title', 'Quantity', 'Measurement', 'Ingredient'], ingRows));

  // Key Ingredients
  const keyIngredients = JSON.parse(localStorage.getItem('sunday-key-ingredients') || '[]');
  sections.push(toCSVSection('Key Ingredients', ['Ingredient'],
    keyIngredients.map(i => [i])));

  // Weekly Plan
  const weeklyPlan = JSON.parse(localStorage.getItem('sunday-weekly-plan') || '[]');
  sections.push(toCSVSection('Weekly Plan', ['Recipe Title'],
    weeklyPlan.map(id => [recipeMap.get(id) || id])));

  // Plan History
  const history = JSON.parse(localStorage.getItem('sunday-plan-history') || '[]');
  sections.push(toCSVSection('Plan History', ['Date', 'Recipe Titles', 'Timestamp'],
    history.map(e => [e.date, (e.recipeIds || []).map(id => recipeMap.get(id) || id).join('; '), e.timestamp])));

  // Grocery Staples
  const staples = JSON.parse(localStorage.getItem('sunday-grocery-staples') || '[]');
  sections.push(toCSVSection('Grocery Staples', ['Quantity', 'Measurement', 'Ingredient'],
    staples.map(s => [s.quantity, s.measurement, s.ingredient])));

  // Pantry Spices
  const spices = JSON.parse(localStorage.getItem('sunday-pantry-spices') || '[]');
  sections.push(toCSVSection('Pantry Spices', ['Ingredient'], spices.map(s => [s])));

  // Pantry Sauces
  const sauces = JSON.parse(localStorage.getItem('sunday-pantry-sauces') || '[]');
  sections.push(toCSVSection('Pantry Sauces', ['Ingredient'], sauces.map(s => [s])));

  // Download
  const csv = sections.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = `sunday-backup-${today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
