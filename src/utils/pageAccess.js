/**
 * Owner-controlled per-page visibility.
 *
 * The owner account (see OWNER_EMAIL) gets a toggle pill on every page listed
 * in TOGGLEABLE_PAGES. Switching a page off hides it from EVERYONE ELSE: the
 * nav/settings entry disappears and a direct #hash link lands on a "not
 * available" panel instead of the page. The owner always sees every page —
 * the switch only ever affects other accounts.
 *
 * The map lives on the admin account's users/{adminUid}/data/appDefaults doc
 * under `pageAccess`. That doc already exists as "the small shared defaults
 * every client reads": firestore.rules lets any signed-in user read it and
 * only its owner write it, which is exactly the shape this needs — so no rules
 * change was required.
 *
 * Shape: { [viewKey]: boolean }. A key that isn't in the map falls back to the
 * page's `defaultShared` in the registry below — true unless stated otherwise.
 * So a page added later is on by default, an unreadable/absent doc degrades to
 * the registry defaults, and a page marked `defaultShared: false` stays hidden
 * until the owner switches it on.
 */

export const OWNER_EMAIL = 'baldaufdan@gmail.com';

// Mirrors the shared-defaults key written by saveAppDefault().
export const PAGE_ACCESS_KEY = 'pageAccess';

const CACHE_KEY = 'sunday-page-access';

/**
 * The pages the owner can switch off, keyed by the `view` (or `modalView`)
 * string App.jsx routes on.
 *
 * Deliberately NOT toggleable: 'list' (the recipe list every blocked page
 * falls back to), the recipe detail/add/import flow, 'setup' (onboarding),
 * 'profile', 'account-settings' and 'admin' — switching any of those off would
 * leave an account with no way back.
 */
export const TOGGLEABLE_PAGES = [
  { key: 'week-plan', label: 'Week Plan' },
  { key: 'shopping', label: 'Shopping List' },
  { key: 'eating-out', label: 'Eating Out' },
  { key: 'air-fryer', label: 'Air Fryer' },
  { key: 'workout', label: 'Workout' },
  { key: 'habits', label: 'Habits' },
  { key: 'nutrition-goals', label: 'Nutrition Goals' },
  { key: 'design-meal', label: 'Design a Meal' },
  { key: 'weight-tracker', label: 'Weight' },
  { key: 'key-ingredients', label: 'Healthy Foods' },
  { key: 'daily-tracker', label: 'Track Meals' },
  { key: 'barcode-scanner', label: 'Barcode Scanner' },
  // Off for other accounts until the owner switches it on: Meal History is a
  // full read-out of what you logged, so it opts IN rather than out.
  { key: 'history', label: 'Meal History', defaultShared: false },
  { key: 'whoop', label: 'Whoop' },
  { key: 'seasonal-guide', label: 'Seasonal Guide' },
  { key: 'sources', label: 'Sources' },
  { key: 'features', label: 'Features' },
  { key: 'ingredients', label: 'Ingredients' },
  { key: 'friends', label: 'Friends' },
];

const LABELS = Object.fromEntries(TOGGLEABLE_PAGES.map(p => [p.key, p.label]));
const DEFAULTS = Object.fromEntries(
  TOGGLEABLE_PAGES.map(p => [p.key, p.defaultShared !== false]),
);

export function isPageToggleable(key) {
  return !!key && Object.prototype.hasOwnProperty.call(LABELS, key);
}

export function pageLabel(key) {
  return LABELS[key] || 'This page';
}

/**
 * Is this page shared with other accounts? An explicit entry in the map wins;
 * otherwise the registry's default for that page applies.
 */
export function isPageVisible(access, key) {
  if (!isPageToggleable(key)) return true;
  const stored = access?.[key];
  return typeof stored === 'boolean' ? stored : DEFAULTS[key];
}

/**
 * Can THIS user open `key`? The owner ignores the map entirely; everyone else
 * is bound by it.
 */
export function canViewPage(access, key, user) {
  if (user?.email === OWNER_EMAIL) return true;
  return isPageVisible(access, key);
}

/**
 * Last-known map, so the sidebar renders the right entries on the first paint
 * instead of flashing pages that are switched off.
 */
export function readCachedPageAccess() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function cachePageAccess(access) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(access || {}));
  } catch { /* quota / private mode — the Firestore read still works */ }
}
