// Offline cache + durable write queue for the Habits page.
//
// Mirrors the mobile app's habitAlertStore (PrepDay src/stores/habitAlertStore.ts):
// habits and marks are cached locally so the page opens and works with no
// connection, and every edit is recorded as an operation in a durable queue
// that is replayed when a connection returns.
//
// WHY NOT Firestore's own offline persistence: a mark is written with
// runTransaction (habitLogYears.saveMarkCells) so this tab and the hourly
// automation engine can't overwrite each other's cells — and a transaction
// ALWAYS needs the server, so the IndexedDB cache would not queue it. The
// page's writes were fire-and-forget (`.catch(() => {})`) as well, so before
// this an offline mark simply vanished, silently, with the UI showing it as
// logged until the next reload.
//
// CONFLICTS resolve the same way as on mobile: last-writer-wins at the
// granularity of the thing you touched. A queued mark writes exactly its own
// cell, and a queued `habits` write is merged per-habit against whatever the
// server holds at flush time, so an edit made on the phone meanwhile survives
// unless you changed that same habit.
//
// This file owns storage and the network only — every rule about what gets
// written lives in habitOfflineQueue.js, where it can be tested.

import { saveField, loadField } from './firestoreSync';
import { saveHabitLogCells, saveHabitLogAutoCells } from './habitLogYears';
import {
  withFieldOp, withMarkOps, withAttempt, dropOps as dropFromQueue,
  applyOps, applyCellsToLog, mergeHabits,
  pendingCountOf, failedCountOf, livingOps,
} from './habitOfflineQueue';

// The cached copy of server state. Listed in firestoreSync's
// LOCAL_ONLY_CACHE_KEYS: it's a mirror that rebuilds on demand, so it must not
// bloat the daily backup or count against the storage estimate.
const CACHE_KEY = 'sunday-habit-offline-cache';
// Unsynced edits. Deliberately NOT a local-only cache — this is the only copy
// of work the user has done.
const QUEUE_KEY = 'sunday-habit-offline-queue';
const SYNC_KEY = 'sunday-habit-offline-synced';

// How many times a group may fail while the browser believes it is ONLINE
// before we stop retrying it. Attempts are only counted when navigator.onLine
// isn't false, so a long trip with no signal doesn't burn through them.
const MAX_ONLINE_ATTEMPTS = 5;
const FLUSH_DEBOUNCE_MS = 600;

const listeners = new Set();
let flushing = false;
let flushTimer = null;
let opSeq = 0;

function emit() {
  for (const fn of [...listeners]) {
    try { fn(); } catch { /* a bad listener must not stop the others */ }
  }
}

/** Subscribe to queue/sync-state changes (for the page's sync strip). */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / quota */ }
}

function readQueue() {
  const q = readJSON(QUEUE_KEY, []);
  return Array.isArray(q) ? q : [];
}

function writeQueue(q) {
  writeJSON(QUEUE_KEY, q);
  emit();
}

function makeOpId() {
  opSeq += 1;
  return `${Date.now()}-${opSeq}`;
}

// ---- Cache -----------------------------------------------------------------

/** The cached page state, or null when nothing has been cached yet. */
export function readCache() {
  const c = readJSON(CACHE_KEY, null);
  return c && typeof c === 'object' ? c : null;
}

function patchCache(patch) {
  writeJSON(CACHE_KEY, { ...(readCache() || {}), ...patch });
}

/**
 * Record a fresh load from the server.
 *
 * `remoteHabits` is kept separately from `habits` as the BASELINE a queued
 * habits write merges against: "what the server had before I started editing".
 */
export function cacheRemote({ habits, habitLog, automations, habitLogAuto, habitNextLog }) {
  const patch = { savedAt: new Date().toISOString() };
  // A field missing from this snapshot means "not loaded", not "empty", so it
  // must not blank the cache. `habits` additionally never legitimately arrives
  // empty (it's a NEVER_EMPTY field), so an empty array is treated the same
  // way — this is the mobile store's applyRemote guard, for the same reason:
  // one bad read shouldn't leave the page blank next time it opens offline.
  if (Array.isArray(habits) && habits.length > 0) {
    patch.habits = habits;
    patch.remoteHabits = habits;
  }
  if (habitLog && typeof habitLog === 'object') patch.habitLog = habitLog;
  if (Array.isArray(automations)) patch.automations = automations;
  if (habitLogAuto && typeof habitLogAuto === 'object') patch.habitLogAuto = habitLogAuto;
  if (habitNextLog && typeof habitNextLog === 'object') patch.habitNextLog = habitNextLog;
  patchCache(patch);
}

// ---- Queue state for the UI ------------------------------------------------

export function pendingCount() { return pendingCountOf(readQueue()); }
export function failedCount() { return failedCountOf(readQueue()); }
export function isFlushing() { return flushing; }

export function lastSyncedAt() {
  try { return localStorage.getItem(SYNC_KEY); } catch { return null; }
}

/** Forget a queue that can never succeed (the UI offers this after a failure). */
export function discardFailed() {
  writeQueue(readQueue().filter(op => !op.failed));
}

// ---- Enqueueing ------------------------------------------------------------

/**
 * Queue a whole-value user-doc write (`habits`, `habitAutomations`,
 * `habitNextLog`) and update the cache to match.
 */
export function queueFieldWrite(uid, field, value) {
  patchCache({ [field === 'habitAutomations' ? 'automations' : field]: value });
  const cache = readCache() || {};
  writeQueue(withFieldOp(readQueue(), {
    id: makeOpId(),
    field,
    value,
    // Only `habits` is merged per-item; the others are small, web-only and
    // edited one at a time, so whole-value last-writer-wins is right for them.
    baseline: field === 'habits' ? (cache.remoteHabits || null) : null,
  }));
  scheduleFlush(uid);
}

/** Queue one habitLog cell. `kind` is 'manual' (a person's mark) or 'auto'. */
export function queueMark(uid, { key, habitId, mark, kind = 'manual' }) {
  queueMarks(uid, [{ key, habitId, mark }], kind);
}

/** Queue many cells at once — bulk edit mode and the paste-from-sheet import. */
export function queueMarks(uid, cells, kind = 'manual') {
  if (!Array.isArray(cells) || cells.length === 0) return;
  const cache = readCache() || {};
  const logKey = kind === 'auto' ? 'habitLogAuto' : 'habitLog';
  patchCache({ [logKey]: applyCellsToLog(cache[logKey], cells) });
  writeQueue(withMarkOps(readQueue(), cells, kind, makeOpId));
  scheduleFlush(uid);
}

/** Overlay everything still queued on a snapshot loaded from the server. */
export function replayQueue(loaded) {
  return applyOps(loaded, readQueue());
}

// ---- Flushing --------------------------------------------------------------

function bumpAttempts(ids) {
  // Only count a failure the browser thinks happened while online. Offline is
  // the expected state here, not a reason to give up on someone's edits.
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (!online) return;
  writeQueue(withAttempt(readQueue(), ids, MAX_ONLINE_ATTEMPTS));
}

function dropOps(ids) {
  writeQueue(dropFromQueue(readQueue(), ids));
}

/**
 * Push everything queued. Each GROUP is independent, so a write the server
 * keeps rejecting can't hold up the marks queued behind it.
 *
 * Ops are dropped only once their write resolves — every write here is
 * idempotent, so a timeout mid-flush just means the next flush repeats it.
 */
export async function flush(uid) {
  if (!uid || flushing) return;
  const queue = livingOps(readQueue());
  if (queue.length === 0) return;
  flushing = true;
  emit();
  let wrote = false;
  try {
    for (const op of queue.filter(o => o.t === 'field')) {
      try {
        let value = op.value;
        if (op.field === 'habits' && op.baseline) {
          // Merge against the server as it is NOW, not as it was when this was
          // queued — the phone may have edited a habit in the meantime.
          const remote = await loadField(uid, 'habits');
          value = mergeHabits(remote, op.baseline, op.value);
        }
        await saveField(uid, op.field, value);
        dropOps(new Set([op.id]));
        if (op.field === 'habits') patchCache({ habits: value, remoteHabits: value });
        wrote = true;
      } catch {
        bumpAttempts(new Set([op.id]));
      }
    }

    for (const kind of ['manual', 'auto']) {
      const marks = queue.filter(o => o.t === 'mark' && o.kind === kind);
      if (marks.length === 0) continue;
      const cells = marks.map(o => ({ key: o.key, habitId: o.habitId, mark: o.mark }));
      try {
        if (kind === 'auto') await saveHabitLogAutoCells(uid, cells);
        else await saveHabitLogCells(uid, cells);
        dropOps(new Set(marks.map(o => o.id)));
        wrote = true;
      } catch {
        bumpAttempts(new Set(marks.map(o => o.id)));
      }
    }

    if (wrote) {
      try { localStorage.setItem(SYNC_KEY, new Date().toISOString()); } catch { /* private mode */ }
    }
  } finally {
    flushing = false;
    emit();
  }
}

function scheduleFlush(uid) {
  // Coalesce a burst of taps into one flush, the way the mobile store debounces
  // its sync — clicking through a routine shouldn't be one round trip per click.
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = null; flush(uid); }, FLUSH_DEBOUNCE_MS);
}

/**
 * Retry whenever a connection is plausible again: the browser says it's back,
 * the tab is looked at again, or a slow minute has passed with work waiting.
 * Returns a cleanup function.
 */
export function startAutoFlush(uid) {
  if (!uid) return () => {};
  const run = () => flush(uid);
  const onVisible = () => { if (document.visibilityState === 'visible') run(); };
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVisible);
  const interval = setInterval(() => { if (pendingCount() > 0) run(); }, 60000);
  run();
  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(interval);
  };
}
