// Shared by HabitsPage (provider) and HabitStatusSelect (the status menus).
import { createContext } from 'react';

/**
 * Supplied once by HabitsPage:
 *   options      status names in menu order
 *   builtIns     the statuses the page's logic depends on (never renamable)
 *   byStatus     { [status]: habit[] } for counts and hover lists
 *   colorOf      status → colour or null
 *   onSave       (nextOptions, renames: [from, to][]) => void
 */
export const HabitStatusContext = createContext({
  options: [], builtIns: [], byStatus: {}, colorOf: () => null, onSave: () => {},
});
