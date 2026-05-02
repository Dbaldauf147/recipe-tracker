function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        values.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  values.push(current);
  return values;
}

function parseCSVSections(text) {
  const lines = text.split('\n');
  const sections = {};
  let currentSection = null;
  let headers = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const sectionMatch = trimmed.match(/^=== (.+) ===$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      sections[currentSection] = [];
      headers = null;
      continue;
    }

    if (currentSection && !headers) {
      headers = parseCSVLine(trimmed);
      continue;
    }

    if (currentSection && headers) {
      const values = parseCSVLine(trimmed);
      const row = {};
      headers.forEach((h, i) => { row[h] = values[i] || ''; });
      sections[currentSection].push(row);
    }
  }

  return sections;
}

export function importFromCSV(fileContent) {
  const sections = parseCSVSections(fileContent);

  // Build recipe objects from Recipes + Recipe Ingredients
  const recipeRows = sections['Recipes'] || [];
  const ingredientRows = sections['Recipe Ingredients'] || [];

  const ingByTitle = {};
  for (const row of ingredientRows) {
    const title = row['Recipe Title'];
    if (!title) continue;
    if (!ingByTitle[title]) ingByTitle[title] = [];
    ingByTitle[title].push({
      quantity: row['Quantity'],
      measurement: row['Measurement'],
      ingredient: row['Ingredient'],
    });
  }

  const importedRecipes = recipeRows
    .filter(r => r['Title'])
    .map(r => ({
      title: r['Title'],
      category: r['Category'],
      frequency: r['Frequency'],
      mealType: r['Meal Type'],
      servings: r['Servings'],
      prepTime: r['Prep Time'],
      cookTime: r['Cook Time'],
      description: r['Description'],
      sourceUrl: r['Source URL'],
      instructions: r['Instructions'],
      ingredients: ingByTitle[r['Title']] || [],
    }));

  // Merge recipes (add new, skip existing by title)
  const existing = JSON.parse(localStorage.getItem('recipe-tracker-recipes') || '[]');
  const existingTitles = new Set(existing.map(r => r.title.toLowerCase()));
  const newRecipes = importedRecipes
    .filter(r => !existingTitles.has(r.title.toLowerCase()))
    .map(r => ({ ...r, id: crypto.randomUUID(), createdAt: new Date().toISOString() }));
  const allRecipes = [...newRecipes, ...existing];
  localStorage.setItem('recipe-tracker-recipes', JSON.stringify(allRecipes));

  // Build title→id map for resolving references
  const titleToId = new Map(allRecipes.map(r => [r.title, r.id]));

  // Key Ingredients
  const keyRows = (sections['Key Ingredients'] || []).map(r => r['Ingredient']).filter(Boolean);
  if (keyRows.length) localStorage.setItem('sunday-key-ingredients', JSON.stringify(keyRows));

  // Weekly Plan — resolve titles back to IDs
  const weekRows = (sections['Weekly Plan'] || []);
  const weekIds = weekRows.map(r => titleToId.get(r['Recipe Title'])).filter(Boolean);
  if (weekIds.length) localStorage.setItem('sunday-weekly-plan', JSON.stringify(weekIds));

  // Plan History — resolve titles back to IDs
  const historyRows = sections['Plan History'] || [];
  if (historyRows.length) {
    const history = historyRows.map(r => {
      const titles = (r['Recipe Titles'] || '').split('; ').filter(Boolean);
      const recipeIds = titles.map(t => titleToId.get(t)).filter(Boolean);
      return { date: r['Date'], recipeIds, timestamp: r['Timestamp'] };
    });
    localStorage.setItem('sunday-plan-history', JSON.stringify(history));
  }

  // Grocery Staples
  const staples = (sections['Grocery Staples'] || [])
    .filter(r => r['Ingredient'])
    .map(r => ({ quantity: r['Quantity'], measurement: r['Measurement'], ingredient: r['Ingredient'] }));
  if (staples.length) localStorage.setItem('sunday-grocery-staples', JSON.stringify(staples));

  // Pantry Spices
  const spices = (sections['Pantry Spices'] || []).map(r => r['Ingredient']).filter(Boolean);
  if (spices.length) localStorage.setItem('sunday-pantry-spices', JSON.stringify(spices));

  // Pantry Sauces
  const sauces = (sections['Pantry Sauces'] || []).map(r => r['Ingredient']).filter(Boolean);
  if (sauces.length) localStorage.setItem('sunday-pantry-sauces', JSON.stringify(sauces));

  return { newRecipes: newRecipes.length, totalRecipes: importedRecipes.length };
}

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

// Excel-friendly CSV export of the workout history. `rows` is a flat array
// of one-entry-per-exercise objects shaped like:
//   { date, workoutType, gym, group, exercise, notes, sets[], weight, perArm, time }
// Excel opens .csv natively. UTF-8 BOM prepended so Excel detects encoding
// correctly on Windows.
export function exportWorkoutHistoryToCSV(rows) {
  const headers = [
    'Date', 'Workout Type', 'Location', 'Group', 'Exercise', 'Notes',
    'Set 1', 'Set 2', 'Set 3', 'Set 4',
    'Weight', 'Per Arm/Leg', 'Total Weight', 'Time',
  ];
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) {
    const sets = Array.isArray(r.sets) ? r.sets : [];
    const wt = parseFloat(r.weight);
    const total = !isNaN(wt) ? (r.perArm ? wt * 2 : wt) : '';
    lines.push([
      r.date,
      r.workoutType || '',
      r.gym || '',
      r.group || '',
      r.exercise || '',
      r.notes || '',
      sets[0] ?? '',
      sets[1] ?? '',
      sets[2] ?? '',
      sets[3] ?? '',
      r.weight ?? '',
      r.perArm ? 'Yes' : 'No',
      total,
      r.time || '',
    ].map(csvEscape).join(','));
  }
  const csv = '﻿' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = `workout-history-${today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
