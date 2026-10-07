/* Visits to eating-out spots, logged from outside Prep Day.

   Wealth Architect (the finance tracker) matches card charges to spots and
   sends each one here as a visit: a date, what was spent, and the merchant
   line from the statement. They're stored at users/{uid}/data/eatingOutVisits
   as `{ visits: { [externalId]: visit } }`, NOT inside the spot:

     • the spot list is one array that the edit form saves a whole spot at a
       time, so a field the form doesn't know about would be wiped by the next
       edit made from a copy loaded before the visit arrived;
     • the list is shared with friends, and what you spent is nobody's business.

   Keyed by the sender's id (the bank transaction id), so sending the same
   charge twice is one visit, and re-mapping a charge to another spot moves it.

   A visit also nudges the spot itself: its lastVisit moves forward, and a
   want-to-try spot becomes visited — that's the point of logging it.

   Pure: no Firebase. api/wealth-sync.js does the reading and writing. */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/** A visit from the wire, or `{ error }`. */
export function normalizeVisit(input = {}) {
  const externalId = clip(input.externalId, 200);
  const placeId = clip(input.placeId, 100);
  const date = clip(input.date, 10);
  const amount = Math.round(Math.abs(Number(input.amount)) * 100) / 100;
  if (!externalId) return { error: 'externalId is required' };
  if (!placeId) return { error: 'placeId is required' };
  if (!DATE.test(date)) return { error: 'date must be YYYY-MM-DD' };
  if (!Number.isFinite(amount)) return { error: 'amount must be a number' };
  return {
    externalId,
    visit: {
      placeId,
      date,
      amount,
      merchant: clip(input.merchant, 200),
      source: clip(input.source, 60) || 'wealth-architect',
    },
  };
}

// The edit form stores lastVisit as an ISO timestamp at local noon; match it
// so the date input and the card both read the day that was sent.
const noonIso = date => new Date(`${date}T12:00:00`).toISOString();
const dayOf = iso => (iso ? String(iso).slice(0, 10) : '');

/** The spot after a visit on `date`, or null when nothing about it changes. */
export function spotAfterVisit(spot, date) {
  const later = !spot.lastVisit || dayOf(spot.lastVisit) < date;
  const nowVisited = spot.status === 'want-to-try';
  if (!later && !nowVisited) return null;
  return {
    ...spot,
    ...(later ? { lastVisit: noonIso(date) } : {}),
    ...(nowVisited ? { status: 'visited' } : {}),
  };
}

/** The spot after the visit on `removedDate` is taken back, given the dates
 *  of the visits it still has. lastVisit only moves when it was that visit's
 *  day: back to the latest remaining one, or left alone when none remain —
 *  a date can't be told apart from one you set by hand. Status stays: having
 *  been there isn't undone by un-mapping a charge. */
export function spotAfterRemoval(spot, removedDate, remainingDates) {
  if (dayOf(spot.lastVisit) !== removedDate) return null;
  const latest = [...remainingDates].sort().pop();
  if (!latest || latest === removedDate) return null;
  return { ...spot, lastVisit: noonIso(latest) };
}

/**
 * Apply a batch of ops to the visits map and the spot list.
 * @param ops  [{ op: 'add', externalId, placeId, date, amount, merchant }
 *             | { op: 'remove', externalId }]
 * @returns { visits, restaurants, results: [{ externalId, ok, error? }], changed }
 */
export function applyVisitOps({ visits = {}, restaurants = [], ops = [] }) {
  const nextVisits = { ...visits };
  const spots = new Map(restaurants.map(r => [r?.id, r]));
  const touched = new Set();
  const results = [];

  const datesFor = placeId => Object.values(nextVisits).filter(v => v.placeId === placeId).map(v => v.date);
  const patch = (id, next) => { if (next) { spots.set(id, next); touched.add(id); } };
  const drop = (externalId) => {
    const old = nextVisits[externalId];
    if (!old) return;
    delete nextVisits[externalId];
    const spot = spots.get(old.placeId);
    if (spot) patch(old.placeId, spotAfterRemoval(spot, old.date, datesFor(old.placeId)));
  };

  for (const raw of ops) {
    if (raw?.op === 'remove') {
      const externalId = clip(raw.externalId, 200);
      if (!externalId) { results.push({ externalId, ok: false, error: 'externalId is required' }); continue; }
      drop(externalId);
      results.push({ externalId, ok: true });
      continue;
    }
    const n = normalizeVisit(raw);
    if (n.error) { results.push({ externalId: raw?.externalId, ok: false, error: n.error }); continue; }
    const spot = spots.get(n.visit.placeId);
    if (!spot) { results.push({ externalId: n.externalId, ok: false, error: 'No spot with that id' }); continue; }
    // Re-sending a charge replaces it — including moving it to another spot.
    drop(n.externalId);
    nextVisits[n.externalId] = { ...n.visit, loggedAt: raw.loggedAt || new Date().toISOString() };
    patch(n.visit.placeId, spotAfterVisit(spots.get(n.visit.placeId), n.visit.date));
    results.push({ externalId: n.externalId, ok: true });
  }

  return {
    visits: nextVisits,
    restaurants: restaurants.map(r => (touched.has(r?.id) ? spots.get(r.id) : r)),
    results,
    changed: touched.size > 0,
  };
}

/** Map<placeId, { count, total, last, visits (newest first) }> for the UI. */
export function visitStatsByPlace(visits = {}) {
  const out = new Map();
  for (const [externalId, v] of Object.entries(visits || {})) {
    if (!v?.placeId) continue;
    let s = out.get(v.placeId);
    if (!s) { s = { count: 0, total: 0, last: '', visits: [] }; out.set(v.placeId, s); }
    s.count += 1;
    s.total = Math.round((s.total + (Number(v.amount) || 0)) * 100) / 100;
    if (v.date > s.last) s.last = v.date;
    s.visits.push({ externalId, ...v });
  }
  for (const s of out.values()) s.visits.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}
