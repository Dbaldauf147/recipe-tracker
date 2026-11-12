/* What a List → By category row says beyond the name: how long since you were
   last there, and the ratings — yours beside everyone else's.

   The date follows the Recent tab's rule (utils/recentPlaces.js): the later of
   the spot's `lastVisit` and the newest visit logged for it. Only for your own
   spots — a friend's shared spot carries THEIR lastVisit, which says nothing
   about when you went.

   Pure: the page passes in the visit stats and the spot's rating docs. */

import { daysSinceVisit } from './healthyPlaces.js';

const dayOf = iso => (iso ? String(iso).slice(0, 10) : '');

/** Whole days since your last visit, or null when there's no date to go by. */
export function lastVisitDays(spot, { stats, isMine = true, now = new Date() } = {}) {
  if (!spot || !isMine) return null;
  const own = dayOf(spot.lastVisit);
  const logged = stats?.last || '';
  const date = own > logged ? own : logged;
  return date ? daysSinceVisit(`${date}T12:00:00`, now) : null;
}

/** "Today", "12d ago", "3mo ago", "1.5y ago" — short enough for a slim row. */
export function shortAgo(days) {
  if (days == null) return '';
  if (days === 0) return 'Today';
  if (days < 60) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30.4)}mo ago`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y ago`;
}

/** Mean of a rating doc's 1–5 category scores (same rule as the spot popup). */
export function overallOfScores(scores) {
  const vals = Object.values(scores || {}).filter(v => typeof v === 'number' && v >= 1 && v <= 5);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/**
 * { mine, others: [{ uid, name, overall }] } for one spot.
 * `mine` falls back to the spot's old single star rating (`legacyRating`) when
 * you haven't scored it in the ratings table — pass that only for your own
 * spots, since on a friend's spot it's theirs. Others are sorted by name, like
 * the popup's columns, so the row doesn't reshuffle as docs stream in.
 */
export function rowRatings(docs, userUid, legacyRating = null) {
  let mine = null;
  const others = [];
  for (const d of docs || []) {
    const overall = overallOfScores(d?.scores);
    if (overall == null) continue;
    if (userUid && d.authorUid === userUid) mine = overall;
    else others.push({ uid: d.authorUid, name: d.authorUsername || '', overall });
  }
  if (mine == null && typeof legacyRating === 'number' && legacyRating >= 1 && legacyRating <= 5) {
    mine = legacyRating;
  }
  others.sort((a, b) => a.name.localeCompare(b.name));
  return { mine, others };
}
