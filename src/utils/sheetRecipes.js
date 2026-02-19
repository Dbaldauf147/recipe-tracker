const RECIPE_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRg2H-pU53B_n0WCG3f_vz3ye-8IicvsqvTM2xohwVaEitNIZr6PbrgRn8-5qlTn-cSwnt2m3FjXIae/pub?gid=1359764191&single=true&output=csv';

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Fetch and parse all recipes from the Google Sheet.
 * Returns an array of { title, description, servings, stars, ingredients: [{quantity, measurement, ingredient}] }
 */
export async function fetchRecipesFromSheet() {
  const res = await fetch(RECIPE_CSV_URL);
  if (!res.ok) throw new Error('Failed to fetch recipe sheet');
  const text = await res.text();
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));

  const recipes = [];
  let i = 0;

  while (i < lines.length) {
    const cols = parseCSVLine(lines[i]);

    // Look for "Shopping List,,Ingredient" rows that mark the start of ingredient data
    if (cols[1] === 'Shopping List' && cols[3] === 'Ingredient') {
      const recipeName = cols[0].trim();
      if (!recipeName || recipeName === 'Other') {
        i++;
        continue;
      }

      // Look back for metadata rows
      let description = '';
      let servings = '';
      let stars = 0;
      for (let b = Math.max(0, i - 4); b < i; b++) {
        const prev = parseCSVLine(lines[b]);
        // Tags/description row: "<name>,<name>Changes,<tags>,-"
        if (prev[1] && prev[1].endsWith('Changes')) {
          description = (prev[2] || '').trim();
        }
        // Stars row: "<name>,<name>Stars,<stars>"
        if (prev[1] && prev[1].endsWith('Stars')) {
          stars = parseInt(prev[2]) || 0;
        }
        // Servings row: "<url>,<name>,<servings>"
        if (prev[1] === recipeName && prev[2] && /^\d+$/.test(prev[2].trim())) {
          servings = prev[2].trim();
        }
      }

      // Skip the column header row (Quantity, Measurement, ...)
      i++;
      if (i < lines.length) i++; // skip "!F10:H42,Quantity,Measurement,..." row

      // Read ingredient rows
      const ingredients = [];
      while (i < lines.length) {
        const row = parseCSVLine(lines[i]);
        // Stop if we hit the next recipe separator or a different recipe name
        if (row[0] !== recipeName) break;

        const qty = (row[1] || '').trim();
        const meas = (row[2] || '').trim();
        const ing = (row[3] || '').trim();

        // Only add rows that have an actual ingredient name
        if (ing && qty !== '0' && qty !== '0.00') {
          ingredients.push({
            quantity: qty,
            measurement: meas,
            ingredient: ing,
          });
        }
        i++;
      }

      if (ingredients.length > 0) {
        recipes.push({
          title: recipeName,
          description,
          servings,
          stars,
          ingredients,
        });
      }
    } else {
      i++;
    }
  }

  // Deduplicate by title, keeping the first occurrence
  const seen = new Set();
  return recipes.filter(r => {
    if (seen.has(r.title)) return false;
    seen.add(r.title);
    return true;
  });
}

/**
 * Fetch the "Always" grocery staples from the sheet.
 * Returns an array of { quantity, measurement, ingredient }
 */
export async function fetchStaplesFromSheet() {
  const res = await fetch(RECIPE_CSV_URL);
  if (!res.ok) throw new Error('Failed to fetch recipe sheet');
  const text = await res.text();
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));

  const staples = [];
  for (const line of lines) {
    const cols = parseCSVLine(line);
    if (cols[0] !== 'Always') continue;

    const qty = (cols[1] || '').trim();
    const meas = (cols[2] || '').trim();
    const ing = (cols[3] || '').trim();

    if (ing && ing !== '-') {
      staples.push({ quantity: qty, measurement: meas, ingredient: ing });
    }
  }

  return staples;
}
