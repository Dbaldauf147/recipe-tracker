/* The Eating Out page's Healthy tab: places tagged Healthy, the one you've
   gone longest without eating at first.

   `lastVisit` is the date to go by — the edit form sets it, and visits logged
   from Wealth Architect move it forward (utils/spotVisits.js). Three groups:

     • dated   — been, with a last-visit date; oldest first
     • undated — marked visited but no date, so the gap is unknown
     • never   — not been yet; there's no "time since" to rank

   Pure: the page passes in which spots count as healthy. */

const DAY = 86400000;

/** Whole days from a last-visit ISO date to `now`, or null. */
export function daysSinceVisit(iso, now = new Date()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY));
}

export function healthyByLongestSince(spots, isHealthy, now = new Date()) {
  const dated = [];
  const undated = [];
  const never = [];
  for (const spot of spots || []) {
    if (!spot || !isHealthy(spot) || spot.status === 'hold-off') continue;
    const days = daysSinceVisit(spot.lastVisit, now);
    if (days != null) dated.push({ spot, days });
    else if (spot.status === 'visited') undated.push({ spot, days: null });
    else never.push({ spot, days: null });
  }
  const byName = (a, b) => String(a.spot.name || '').localeCompare(String(b.spot.name || ''));
  dated.sort((a, b) => b.days - a.days || byName(a, b));
  undated.sort(byName);
  never.sort(byName);
  return { dated, undated, never, total: dated.length + undated.length + never.length };
}
