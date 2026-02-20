const STORAGE_KEY = 'sunday-ingredients-db';

const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRg2H-pU53B_n0WCG3f_vz3ye-8IicvsqvTM2xohwVaEitNIZr6PbrgRn8-5qlTn-cSwnt2m3FjXIae/pub?gid=960892864&single=true&output=csv';

// Maps CSV column indices to named object keys.
export const INGREDIENT_FIELDS = [
  { key: 'ingredient',    csvIdx: 7,  label: 'Ingredient' },
  { key: 'grams',         csvIdx: 8,  label: 'Grams' },
  { key: 'measurement',   csvIdx: 9,  label: 'Measurement' },
  { key: 'protein',       csvIdx: 10, label: 'Protein (g)' },
  { key: 'carbs',         csvIdx: 11, label: 'Carbs (g)' },
  { key: 'fat',           csvIdx: 12, label: 'Fat (g)' },
  { key: 'sugar',         csvIdx: 13, label: 'Sugar (g)' },
  { key: 'sodium',        csvIdx: 14, label: 'Salt (mg)' },
  { key: 'potassium',     csvIdx: 15, label: 'Potassium (mg)' },
  { key: 'vitaminB12',    csvIdx: 16, label: 'B12 (µg)' },
  { key: 'vitaminC',      csvIdx: 17, label: 'Vit C (mg)' },
  { key: 'magnesium',     csvIdx: 18, label: 'Magnesium (mg)' },
  { key: 'fiber',         csvIdx: 19, label: 'Fiber (g)' },
  { key: 'zinc',          csvIdx: 20, label: 'Zinc (mg)' },
  { key: 'iron',          csvIdx: 21, label: 'Iron (mg)' },
  { key: 'calcium',       csvIdx: 22, label: 'Calcium (mg)' },
  { key: 'calories',      csvIdx: 23, label: 'Calories' },
  { key: 'addedSugar',    csvIdx: 24, label: 'Added Sugar' },
  { key: 'saturatedFat',  csvIdx: 25, label: 'Sat Fat' },
  { key: 'leucine',       csvIdx: 26, label: 'Leucine (g)' },
  { key: 'notes',         csvIdx: 27, label: 'Notes' },
  { key: 'link',          csvIdx: 31, label: 'Link' },
  { key: 'processed',     csvIdx: 32, label: 'Processed?' },
  { key: 'omega3',        csvIdx: 35, label: 'Omega 3' },
  { key: 'proteinPerCal', csvIdx: 37, label: 'Protein/Cal' },
  { key: 'fiberPerCal',   csvIdx: 38, label: 'Fiber/Cal' },
  { key: 'lastBought',    csvIdx: 39, label: 'Last Bought' },
  { key: 'storage',       csvIdx: 40, label: 'Storage' },
  { key: 'minShelf',      csvIdx: 41, label: 'Min Shelf (days)' },
  { key: 'maxShelf',      csvIdx: 42, label: 'Max Shelf (days)' },
];

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

export function loadIngredients() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function saveIngredients(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export async function fetchAndSeedIngredients() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error('Failed to fetch ingredients sheet');
  const text = await res.text();
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));

  const data = [];
  for (let i = 3; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const ingredient = (cols[7] || '').trim();
    if (!ingredient) continue;
    const obj = {};
    for (const field of INGREDIENT_FIELDS) {
      obj[field.key] = (cols[field.csvIdx] || '').trim();
    }
    data.push(obj);
  }

  saveIngredients(data);
  return data;
}
