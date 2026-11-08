// Guys Night Out — which steakhouses the guys have done together.
// ⚠️ MIRRORED on mobile (PrepDay src/utils/guysNight.ts) — keep these rules identical.
//
// Two true-or-absent fields on a spot, like takenJoanne / joanneHoldOff:
//   • guysNightDone — been there for a guys night out
//   • guysNightSkip — not a guys-night place (marked "not for that")
// They are mutually exclusive; done wins if both ever end up set.
//
// Plus `guysNightDates` — the YYYY-MM-DD days you went, kept newest first.
// Web only for now: mobile carries the field through its editor but has no UI
// for it, and its mirror below has no date helpers.

import { spotCategories } from './spotCategories.js';

/** A spot is a steakhouse when any of its categories mentions "steak". */
export function isSteakhouse(r) {
  return spotCategories(r || {}).some(c => /steak/i.test(String(c || '')));
}

/** 'done' | 'skip' | 'todo' */
export function guysNightState(r) {
  if (r?.guysNightDone) return 'done';
  if (r?.guysNightSkip) return 'skip';
  return 'todo';
}

/**
 * The patch that moves a spot to `state`. Clearing writes `undefined`, which
 * the save paths drop, so a spot never carries a stale `false`.
 */
export function guysNightPatch(state) {
  return {
    guysNightDone: state === 'done' ? true : undefined,
    guysNightSkip: state === 'skip' ? true : undefined,
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The days a spot was done for guys night: valid YYYY-MM-DD, deduped, newest first. */
export function guysNightDates(r) {
  const list = Array.isArray(r?.guysNightDates) ? r.guysNightDates : [];
  return [...new Set(list.filter(d => typeof d === 'string' && DAY_RE.test(d)))].sort().reverse();
}

/** Patch adding a visit day. Going there means it's done, so it also marks it done. */
export function addGuysNightDatePatch(r, day) {
  if (!DAY_RE.test(String(day || ''))) return null;
  return { ...guysNightPatch('done'), guysNightDates: guysNightDates({ guysNightDates: [...guysNightDates(r), day] }) };
}

/** Patch removing a visit day. The done mark stays — untick it to undo that. */
export function removeGuysNightDatePatch(r, day) {
  const left = guysNightDates(r).filter(d => d !== day);
  return { guysNightDates: left.length ? left : undefined };
}

/** "Nov 7, 2026" for a YYYY-MM-DD, read as a calendar day (no timezone shift). */
export function formatGuysNightDate(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
const wantFirst = r => (r.status === 'want-to-try' && !r.lastVisit ? 0 : 1);

/**
 * Steakhouses split three ways for the Guys Night tab. A spot already marked
 * done or skipped stays listed even if its Steakhouse category is later
 * removed, so a mark is never lost from view.
 *   todo — not done and not ruled out: ★ Next first, then want-to-try spots
 *          you've never been to, then the rest, each A–Z
 *   done — most recent visit first; spots with no date after, A–Z
 *   skip — A–Z
 */
export function guysNightSections(items) {
  const todo = [], done = [], skip = [];
  const seen = new Set();
  for (const r of items || []) {
    if (!r) continue;
    const key = `${r._ownerUid || ''}:${r.id}`;
    if (seen.has(key)) continue;
    const state = guysNightState(r);
    if (state === 'todo' && !isSteakhouse(r)) continue;
    seen.add(key);
    (state === 'done' ? done : state === 'skip' ? skip : todo).push(r);
  }
  todo.sort((a, b) => (b.nextSpot ? 1 : 0) - (a.nextSpot ? 1 : 0) || wantFirst(a) - wantFirst(b) || byName(a, b));
  const latest = r => guysNightDates(r)[0] || '';
  done.sort((a, b) => latest(b).localeCompare(latest(a)) || byName(a, b));
  skip.sort(byName);
  return { todo, done, skip, total: todo.length + done.length + skip.length };
}
