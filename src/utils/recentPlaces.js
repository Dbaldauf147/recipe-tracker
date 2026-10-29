/* The Eating Out page's Recent tab: places you've been, the most recent first.

   A spot's date is the later of its `lastVisit` (set in the edit form, and
   moved forward by Wealth Architect visits) and the newest visit logged for it
   in eatingOutVisits — the two normally agree, but a visit whose spot save was
   lost would otherwise go missing. Spots with no date at all are left out:
   there's nothing to put them in order by.

   Pure: the page passes in the visit stats (utils/spotVisits.js
   visitStatsByPlace) and which spots are yours. */

import { daysSinceVisit } from './healthyPlaces.js';

const dayOf = iso => (iso ? String(iso).slice(0, 10) : '');

/** [{ spot, date: 'YYYY-MM-DD', days, visits }] newest first. */
export function recentPlaces(spots, { statsFor = () => undefined, isMine = () => true, now = new Date() } = {}) {
  const rows = [];
  for (const spot of spots || []) {
    if (!spot || !isMine(spot)) continue;
    const stats = statsFor(spot);
    const own = dayOf(spot.lastVisit);
    const logged = stats?.last || '';
    const date = own > logged ? own : logged;
    if (!date) continue;
    rows.push({ spot, date, days: daysSinceVisit(`${date}T12:00:00`, now), visits: stats?.count || 0 });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(a.spot.name || '').localeCompare(String(b.spot.name || ''))));
  return rows;
}
