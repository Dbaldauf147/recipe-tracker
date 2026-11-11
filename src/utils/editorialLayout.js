// The optional "Editorial" layout: a slim icon rail that expands into a grouped
// menu, plus a Home dashboard. It is OFF unless this browser has opted in, and
// everything here is additive — the classic sidebar and every page are untouched
// when it's off.
//
// The choice lives in localStorage on purpose (not the synced user doc): it's a
// per-device display preference, and keeping it out of Firestore means trying
// the layout on a laptop can't change what a phone or another account sees.

export const LAYOUT_KEY = 'prepday-layout';
export const EDITORIAL = 'editorial';

/** The Home dashboard's view key. Only reachable while the layout is on. */
export const HOME_VIEW = 'home';

export function isEditorialEnabled(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(LAYOUT_KEY) === EDITORIAL;
  } catch {
    return false; // storage blocked — fall back to the classic layout
  }
}

export function setEditorialEnabled(on, storage = globalThis.localStorage) {
  try {
    if (on) storage?.setItem(LAYOUT_KEY, EDITORIAL);
    else storage?.removeItem(LAYOUT_KEY);
  } catch { /* storage blocked — the in-memory state still applies this session */ }
}

/**
 * Which view to open for a given URL hash. Identical to the classic rule
 * (empty → 'list') except that the editorial layout lands on Home, and a
 * leftover #home link falls back to Recipes once the layout is switched off.
 */
export function initialView(hash, editorial) {
  const [v] = String(hash || '').replace('#', '').split('/');
  if (!v) return editorial ? HOME_VIEW : 'list';
  if (v === HOME_VIEW && !editorial) return 'list';
  return v;
}

// Icons for entries that sit inside the classic sidebar's "Nutrition" submenu,
// where they are text-only.
const SUB_ICONS = {
  'nutrition-goals': 'flag',
  'design-meal': 'skillet',
  'weight-tracker': 'monitor_weight',
  'key-ingredients': 'nutrition',
  'daily-tracker': 'edit_note',
};

const GROUPS = [
  { key: 'eat', label: 'Eat', members: ['weekly-menu', 'design-meal', 'key-ingredients', 'air-fryer'] },
  { key: 'plan', label: 'Plan', members: ['week-plan', 'shopping', 'eating-out'] },
  { key: 'track', label: 'Track', members: ['nutrition-goals', 'weight-tracker', 'daily-tracker', 'workout', 'habits'] },
];

const navKey = item => item.action || item.id;

/**
 * Regroup the classic sidebar's entries into Eat / Plan / Track.
 *
 * Takes the ALREADY-FILTERED list the classic sidebar renders, so anything the
 * owner has switched off, or a goal has hidden, stays hidden here too — this
 * only rearranges, it never adds an entry. Anything it doesn't recognise lands
 * in a trailing "More" group rather than being dropped, so a nav item added
 * later still shows up in this layout without anyone remembering to list it.
 */
export function groupNavItems(navItems) {
  const flat = [];
  for (const item of navItems || []) {
    if (item.submenu) {
      for (const sub of item.submenu) {
        flat.push({ ...sub, icon: sub.icon || SUB_ICONS[sub.action] || item.icon });
      }
    } else {
      flat.push(item);
    }
  }
  const groups = GROUPS.map(g => ({
    key: g.key,
    label: g.label,
    // In the group's own order, not the sidebar's.
    items: g.members.map(m => flat.find(i => navKey(i) === m)).filter(Boolean),
  }));
  const known = new Set(GROUPS.flatMap(g => g.members));
  const rest = flat.filter(i => !known.has(navKey(i)));
  if (rest.length) groups.push({ key: 'more', label: 'More', items: rest });
  return groups.filter(g => g.items.length > 0);
}

/** Monday..Sunday date keys ('YYYY-MM-DD', local) for the week containing `now`. */
export function weekDays(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const pad = v => String(v).padStart(2, '0');
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return {
      key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      date: d,
    };
  });
}
