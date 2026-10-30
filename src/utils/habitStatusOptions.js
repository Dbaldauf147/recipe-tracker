// The status options offered in the Habits status menus, editable from the
// menu itself ("Edit options…"). Stored on the user doc as
// `habitStatusOptions`: an array of status names in display order.
//
// The BUILT-IN statuses drive behaviour all over the page (Automatically hides
// a habit from the routines, Current/Refreshing/Must Track fill the Current
// tab, …), so they can be reordered or hidden from the menu but never renamed
// — a rename would silently switch that behaviour off. Statuses you add
// yourself carry no behaviour, so those can be renamed and removed freely.
//
// Pure: no React / Firebase, so node --test can load it.

/** Clean a stored list: strings only, trimmed, no blanks, no duplicates (case-insensitive). */
export function sanitizeStatusOptions(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const s = raw.trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

/** The options the menus show: the saved list, or the built-ins until one is saved. */
export function effectiveStatusOptions(saved, builtIns) {
  const clean = sanitizeStatusOptions(saved);
  return clean.length ? clean : builtIns.slice();
}

/** True when `name` is already in `options` (case-insensitive), ignoring `except`. */
export function statusNameTaken(options, name, except = null) {
  const n = String(name || '').trim().toLowerCase();
  return !!n && options.some(o => o !== except && o.toLowerCase() === n);
}

/**
 * Habits grouped by their status, for the counts and hover lists in the menu.
 * Bad habits are left out, the same as the status counts elsewhere on the page.
 * Returns { [status]: habit[] }, each list A→Z by name.
 */
export function habitsByStatus(habits) {
  const map = {};
  for (const h of habits || []) {
    if (!h || h.habitType === 'bad') continue;
    const s = String(h.status || '').trim();
    if (!s) continue;
    (map[s] = map[s] || []).push(h);
  }
  for (const list of Object.values(map)) {
    list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }
  return map;
}

/** Every habit on status `from` moved to `to` — what renaming a custom status does. */
export function renameStatusOnHabits(habits, from, to) {
  let changed = false;
  const next = (habits || []).map(h => {
    if (h && String(h.status || '').trim() === from) {
      changed = true;
      return { ...h, status: to };
    }
    return h;
  });
  return changed ? next : habits;
}
