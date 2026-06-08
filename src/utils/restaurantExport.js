// CSV exporter for the Eating Out page. The column order is chosen so a
// re-import via Bulk import round-trips cleanly: `id` first so duplicate
// detection matches by ID instead of name, then user-editable fields, then
// the geocoded/scraped data the user shouldn't have to recreate.

const COLUMNS = [
  { key: 'id', header: 'id', get: r => r.id || '' },
  { key: 'name', header: 'name', get: r => r.name || '' },
  { key: 'status', header: 'status', get: r => r.status || '' },
  { key: 'rating', header: 'rating', get: r => (r.rating ?? '') },
  { key: 'ratingLabel', header: 'ratingLabel', get: r => r.ratingLabel || '' },
  { key: 'mealType', header: 'mealType', get: r => r.mealType || '' },
  { key: 'frequency', header: 'frequency', get: r => r.frequency || '' },
  { key: 'cuisines', header: 'cuisines', get: r => (r.cuisines || []).join(', ') },
  { key: 'locations', header: 'locations', get: r => (r.locations || []).join(', ') },
  { key: 'categories', header: 'categories', get: r => (r.categories || []).join(', ') },
  { key: 'dish', header: 'dish', get: r => r.dish || '' },
  { key: 'notes', header: 'notes', get: r => r.notes || '' },
  { key: 'address', header: 'address', get: r => r.address || '' },
  { key: 'lat', header: 'lat', get: r => (r.lat ?? '') },
  { key: 'lng', header: 'lng', get: r => (r.lng ?? '') },
  { key: 'url', header: 'url', get: r => r.url || '' },
  { key: 'imageUrl', header: 'imageUrl', get: r => r.imageUrl || '' },
  { key: 'description', header: 'description', get: r => r.description || '' },
  { key: 'lastVisit', header: 'lastVisit', get: r => r.lastVisit ? r.lastVisit.slice(0, 10) : '' },
  { key: 'takenJoanne', header: 'takenJoanne', get: r => r.takenJoanne ? 'true' : '' },
  { key: 'dietTags', header: 'dietTags', get: r => (r.dietTags || []).join(', ') },
  { key: 'meatTags', header: 'meatTags', get: r => (r.meatTags || []).join(', ') },
];

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function buildRestaurantsCsv(restaurants) {
  const headerLine = COLUMNS.map(c => c.header).join(',');
  const lines = [headerLine];
  for (const r of restaurants) {
    const row = COLUMNS.map(c => csvEscape(c.get(r)));
    lines.push(row.join(','));
  }
  // \r\n keeps Excel on Windows happy.
  return lines.join('\r\n');
}

export function downloadRestaurantsCsv(restaurants, filename) {
  const csv = buildRestaurantsCsv(restaurants);
  // BOM so Excel picks up UTF-8 (otherwise accented characters break).
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const today = new Date().toISOString().slice(0, 10);
  const name = filename || `restaurants-${today}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
}
