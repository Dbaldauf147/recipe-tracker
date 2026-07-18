import { doc, getDoc, setDoc, addDoc, deleteDoc, updateDoc, collection, query, where, getDocs, arrayUnion, arrayRemove, increment, onSnapshot, writeBatch } from 'firebase/firestore';
import { db, auth } from '../firebase';

// ── Data-safety layer (mirrors the mobile app) ──────────────────────────────
// Every full-document overwrite of a big "blob" doc (dailyLog, recipes) goes
// through safeOverwriteDoc, which (1) refuses to erase a non-empty doc with an
// empty write and (2) snapshots the current good state to
// users/{uid}/dataSnapshots before any write that would shrink it.
const SNAPSHOT_KEEP = 20;

function countDailyLogEntries(log) {
  if (!log || typeof log !== 'object') return 0;
  let n = 0;
  for (const d of Object.keys(log)) n += Array.isArray(log[d]?.entries) ? log[d].entries.length : 0;
  return n;
}

async function writeSnapshot(uid, type, data, count) {
  try {
    const col = collection(db, 'users', uid, 'dataSnapshots');
    await addDoc(col, { type, count, savedAt: new Date().toISOString(), data });
    const snap = await getDocs(query(col, where('type', '==', type)));
    const docs = snap.docs.sort((a, b) => (b.data().savedAt || '').localeCompare(a.data().savedAt || ''));
    for (let i = SNAPSHOT_KEEP; i < docs.length; i++) await deleteDoc(docs[i].ref);
  } catch (err) {
    console.warn('[dataSnapshot] failed', type, err);
  }
}

// Fire-and-forget owner alert when a guard blocks a destructive write.
function alertGuardBlock(field, prevCount) {
  try {
    fetch('/api/alert-data-guard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, prevCount, platform: 'web', uid: auth.currentUser?.uid || '' }),
    }).catch(() => {});
  } catch { /* ignore */ }
}

async function safeOverwriteDoc({ uid, type, ref, field, value, count, extract }) {
  const newCount = count(value);
  let prevVal = null;
  let prevCount = 0;
  try {
    const prev = await getDoc(ref);
    if (prev.exists()) { prevVal = extract(prev.data()); prevCount = count(prevVal); }
  } catch { /* unreadable → fall through to normal write */ }

  if (prevCount > 0 && newCount === 0) {
    const msg = `[${type}] blocked overwrite: would erase ${prevCount} items with an empty write`;
    console.error(msg);
    alertGuardBlock(type, prevCount);
    throw new Error(msg);
  }
  if (prevVal != null && prevCount > 0 && newCount < prevCount) {
    await writeSnapshot(uid, type, prevVal, prevCount);
  }
  await setDoc(ref, { [field]: value }, { merge: false });
}

// Important user-doc array/object fields that get the snapshot-on-shrink guard.
const GUARDED_FIELDS = new Set([
  'weightLog', 'weeklyPlan', 'weeklyServings', 'planHistory', 'habits',
  // Habit tracking: habitLog is the irreplaceable daily ✓/✕ history and
  // habitAutomations are user-authored rules — both snapshot on shrink.
  'habitLog', 'habitAutomations',
  'groceryCategories', 'groceryItemSections', 'shopLinks', 'restaurants',
  'eatingOutVotes', 'eatingOutOrder', 'customGridWidgets', 'keyIngredients',
  'ingredientsDb', 'catLayout', 'hiddenCategories', 'friends',
  'weekMealPlan', 'weekWorkoutPlan',
]);
// Fields where going from many → 0 in one write is always a bug (block it).
// (weeklyPlan is intentionally NOT here — "clear week" legitimately empties it.)
// habitLog: there's no "clear all marks" feature, so many → 0 is always a bug.
const NEVER_EMPTY_FIELDS = new Set(['weightLog', 'habits', 'ingredientsDb', 'habitLog']);

function itemCount(v) {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return v == null ? 0 : 1;
}

// Guarded setter for a single user-doc field: snapshots before any shrink and
// blocks emptying the never-empty fields. Non-container or unguarded fields
// write straight through.
async function guardUserField(uid, field, value) {
  const ref = doc(db, 'users', uid);
  const isContainer = Array.isArray(value) || (value && typeof value === 'object');
  if (!GUARDED_FIELDS.has(field) || !isContainer) {
    await setDoc(ref, { [field]: value }, { merge: true });
    return;
  }
  const newCount = itemCount(value);
  let prev;
  let prevCount = 0;
  try { const s = await getDoc(ref); if (s.exists()) { prev = s.data()[field]; prevCount = itemCount(prev); } } catch { /* unreadable */ }
  if (prevCount > 0 && newCount === 0 && NEVER_EMPTY_FIELDS.has(field)) {
    const msg = `[${field}] blocked overwrite: would erase ${prevCount} items with an empty write`;
    console.error(msg);
    alertGuardBlock(field, prevCount);
    throw new Error(msg);
  }
  if (prev != null && prevCount > 0 && newCount < prevCount) await writeSnapshot(uid, field, prev, prevCount);
  await setDoc(ref, { [field]: value }, { merge: true });
}

/**
 * Save a single field to the user's Firestore document.
 * Merges so other fields are not overwritten.
 */
/**
 * Save daily log to a separate Firestore document to avoid 1MB user doc limit.
 */
export async function saveDailyLogToFirestore(uid, log) {
  try {
    const ref = doc(db, 'users', uid, 'data', 'dailyLog');
    await safeOverwriteDoc({
      uid, type: 'dailyLog', ref, field: 'log', value: log,
      count: countDailyLogEntries,
      extract: (data) => data?.log || {},
    });
  } catch (err) {
    console.error('saveDailyLogToFirestore:', err);
    throw err;
  }
}

/**
 * Load daily log from the separate Firestore document.
 */
export async function loadDailyLogFromFirestore(uid) {
  try {
    const ref = doc(db, 'users', uid, 'data', 'dailyLog');
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data().log || {};
    // Fallback: check main user doc for legacy data
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists() && userSnap.data().dailyLog) {
      const legacyLog = userSnap.data().dailyLog;
      // Migrate: save to new location and remove from user doc
      await setDoc(ref, { log: legacyLog });
      await setDoc(userRef, { dailyLog: null }, { merge: true });
      return legacyLog;
    }
    return {};
  } catch (err) {
    console.error('loadDailyLogFromFirestore:', err);
    return {};
  }
}

// ── Daily-log recovery (merge restore) ───────────────────────────────────────
// The plain "Restore from file" overwrites the whole dailyLog. That's wrong
// when you've logged new meals SINCE a partial loss — those would be wiped.
// These helpers merge a recovery point into the live log, adding ONLY the
// days that are currently missing or empty. A day that already has entries is
// never touched, so anything logged after the loss is preserved.

function dayEntryCount(day) {
  return Array.isArray(day?.entries) ? day.entries.length : 0;
}

/** List dailyLog recovery points (daily server backups + app snapshots), newest first. */
export async function listDailyLogRecoveryPoints(uid) {
  const out = [];
  try {
    const snaps = await getDocs(query(collection(db, 'users', uid, 'backups'), where('type', '==', 'dailyLog')));
    snaps.forEach(d => {
      const x = d.data();
      out.push({ id: d.id, source: 'backup', count: x.count || 0, savedAt: x.savedAt || x.date || '', date: x.date || (x.savedAt || '').slice(0, 10) });
    });
  } catch { /* none */ }
  try {
    const snaps = await getDocs(query(collection(db, 'users', uid, 'dataSnapshots'), where('type', '==', 'dailyLog')));
    snaps.forEach(d => {
      const x = d.data();
      out.push({ id: d.id, source: 'snapshot', count: x.count || 0, savedAt: x.savedAt || '', date: (x.savedAt || '').slice(0, 10) });
    });
  } catch { /* none */ }
  return out.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
}

async function readRecoveryLog(uid, point) {
  const ref = doc(db, 'users', uid, point.source === 'snapshot' ? 'dataSnapshots' : 'backups', point.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Recovery point not found');
  const data = snap.data().data;
  if (!data || typeof data !== 'object') throw new Error('Recovery point has no daily-log data');
  return data;
}

// Normalize whatever JSON shape a backup file/source has into a flat
// { 'YYYY-MM-DD': { entries: [...] } } log map.
export function normalizeDailyLog(raw) {
  let log = raw;
  if (raw && typeof raw === 'object') {
    if (raw.data?.dailyLog) log = raw.data.dailyLog;
    else if (raw.dailyLog) log = raw.dailyLog;
    else if (raw.log) log = raw.log;
    else if (raw.data && Object.keys(raw.data).some(k => /^\d{4}-\d{2}-\d{2}$/.test(k))) log = raw.data;
  }
  if (!log || typeof log !== 'object') return {};
  const out = {};
  for (const k of Object.keys(log)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) out[k] = log[k];
  }
  return out;
}

/**
 * Non-destructive preview of merging a backup log map into the live log.
 * Returns which dates would be ADDED (have entries in the backup, but are
 * missing/empty in the live log). The live log is never modified.
 */
export async function previewDailyLogMergeMap(uid, backupLog) {
  const currentLog = (await loadDailyLogFromFirestore(uid)) || {};
  const addedDates = [];
  for (const date of Object.keys(backupLog || {})) {
    if (dayEntryCount(backupLog[date]) === 0) continue;   // nothing to restore from this day
    if (dayEntryCount(currentLog[date]) > 0) continue;    // live day already has meals — leave it
    addedDates.push(date);
  }
  addedDates.sort();
  const addedEntries = addedDates.reduce((n, d) => n + dayEntryCount(backupLog[d]), 0);
  return {
    addedDates,
    addedEntries,
    currentDays: Object.keys(currentLog).filter(d => dayEntryCount(currentLog[d]) > 0).length,
    backupDays: Object.keys(backupLog || {}).filter(d => dayEntryCount(backupLog[d]) > 0).length,
  };
}

/**
 * Merge a backup log map into the live daily log: fills in only the days that
 * are currently missing or empty. Days that already have entries are kept as-is
 * (so meals logged after a loss survive). Returns how much was added.
 */
export async function mergeRestoreDailyLogMap(uid, backupLog) {
  const currentLog = (await loadDailyLogFromFirestore(uid)) || {};
  const merged = { ...currentLog };
  let addedDays = 0;
  let addedEntries = 0;
  for (const date of Object.keys(backupLog || {})) {
    if (dayEntryCount(backupLog[date]) === 0) continue;
    if (dayEntryCount(currentLog[date]) > 0) continue;
    merged[date] = backupLog[date];
    addedDays++;
    addedEntries += dayEntryCount(backupLog[date]);
  }
  if (addedDays > 0) await saveDailyLogToFirestore(uid, merged);
  return { addedDays, addedEntries, totalDays: Object.keys(merged).length };
}

/** Preview a merge from a stored Firestore recovery point (backup/snapshot). */
export async function previewDailyLogMerge(uid, point) {
  const backupLog = await readRecoveryLog(uid, point);
  return previewDailyLogMergeMap(uid, backupLog);
}

/** Merge a stored Firestore recovery point into the live log. */
export async function mergeRestoreDailyLog(uid, point) {
  const backupLog = await readRecoveryLog(uid, point);
  return mergeRestoreDailyLogMap(uid, backupLog);
}

export async function saveField(uid, field, value) {
  // Large fields go to separate subcollection docs to avoid the 1 MB user
  // doc limit. New ones added here as we hit the cap.
  if (field === 'recipes') {
    return saveRecipesToFirestore(uid, value);
  }
  if (field === 'workoutLog') {
    // v2: route to per-workout subcollection. Diff-aware: only upserts
    // workouts whose payload changed, only deletes ones that disappeared.
    return saveWorkoutLogToFirestore(uid, value);
  }
  return guardUserField(uid, field, value);
}

// Per-cell auto-tracking status ("why a habit was / wasn't auto-recorded"),
// written by the run-habit-automations cron to users/{uid}/data/habitAutoStatus.
// Shape: { [periodKey]: { [habitId]: { reason, source, trigger, day, at } } }.
export async function loadHabitAutoStatus(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'data', 'habitAutoStatus'));
    return snap.exists() ? (snap.data().status || {}) : {};
  } catch {
    return {};
  }
}

// Read a single top-level field off the user doc. Returns undefined when the
// doc or field is missing. Used for small synced prefs (e.g. weekly goals).
export async function loadField(uid, field) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? snap.data()?.[field] : undefined;
  } catch {
    return undefined;
  }
}

// ── Workout v2: per-day subcollection ───────────────────────────────────
// Storage: users/{uid}/workouts/{id} → one doc per workout. Mirrors the
// mobile app's schema in PrepDay/src/services/firestoreSync.ts so the same
// per-user collection is the source of truth on both clients.
//
// Schema flag at users/{uid}/data/workoutSchema.version === 'v2' marks the
// per-day migration as done; until then, loadWorkoutLogFromFirestore reads
// from legacy v1 (users/{uid}/data/workoutLog.workouts[]) or v0
// (users/{uid}.workoutLog[]) and fans out into the subcollection.

/** Generate a stable workout id. crypto.randomUUID where available;
 *  entropy-from-Math.random fallback otherwise. */
export function newWorkoutId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function getWorkoutSchemaVersion(uid) {
  try {
    const ref = doc(db, 'users', uid, 'data', 'workoutSchema');
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data().version || null) : null;
  } catch {
    return null;
  }
}

async function setWorkoutSchemaVersion(uid, version) {
  const ref = doc(db, 'users', uid, 'data', 'workoutSchema');
  await setDoc(ref, { version, migratedAt: new Date().toISOString() }, { merge: true });
}

/** Upsert one workout doc. workout.id required (call newWorkoutId() when
 *  minting). Re-saving with the same id replaces that workout in place. */
export async function saveWorkoutDay(uid, workout) {
  if (!workout?.id) throw new Error('saveWorkoutDay: workout.id required');
  const ref = doc(db, 'users', uid, 'workouts', workout.id);
  await setDoc(ref, workout, { merge: false });
}

export async function deleteWorkoutDay(uid, id) {
  if (!id) return;
  const ref = doc(db, 'users', uid, 'workouts', id);
  await deleteDoc(ref);
}

/** Batched per-workout writer. Firestore writeBatch caps at 500 ops; chunk
 *  at 450 for headroom. */
export async function batchSaveWorkoutDays(uid, workouts) {
  if (!Array.isArray(workouts) || workouts.length === 0) return;
  for (let i = 0; i < workouts.length; i += 450) {
    const chunk = workouts.slice(i, i + 450);
    const batch = writeBatch(db);
    for (const w of chunk) {
      if (!w?.id) continue;
      const ref = doc(db, 'users', uid, 'workouts', w.id);
      batch.set(ref, w);
    }
    await batch.commit();
  }
}

async function batchDeleteWorkoutDays(uid, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  for (let i = 0; i < ids.length; i += 450) {
    const chunk = ids.slice(i, i + 450);
    const batch = writeBatch(db);
    for (const id of chunk) {
      if (!id) continue;
      const ref = doc(db, 'users', uid, 'workouts', id);
      batch.delete(ref);
    }
    await batch.commit();
  }
}

async function loadAllWorkoutsFromSubcollection(uid) {
  const colRef = collection(db, 'users', uid, 'workouts');
  const snap = await getDocs(colRef);
  const out = [];
  snap.forEach(d => out.push(d.data()));
  return out.sort((a, b) =>
    (b.date || '').localeCompare(a.date || '') ||
    (a.savedAt || '').localeCompare(b.savedAt || '')
  );
}

/** Compare prev vs next workout arrays (by id) and apply only the deltas
 *  to Firestore. Skips workouts whose JSON payload is unchanged — typical
 *  saves touch one row in one entry, so this collapses to ~1 write. */
async function syncWorkoutsDiffToFirestore(uid, prev, next) {
  const prevById = new Map((prev || []).filter(w => w?.id).map(w => [w.id, w]));
  const nextById = new Map((next || []).filter(w => w?.id).map(w => [w.id, w]));
  const upserts = [];
  for (const [id, w] of nextById) {
    const before = prevById.get(id);
    if (!before) { upserts.push(w); continue; }
    if (JSON.stringify(before) !== JSON.stringify(w)) upserts.push(w);
  }
  const deletes = [];
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) deletes.push(id);
  }
  if (upserts.length > 0) await batchSaveWorkoutDays(uid, upserts);
  if (deletes.length > 0) await batchDeleteWorkoutDays(uid, deletes);
}

/** In-memory snapshot of the last workouts array we synced to Firestore
 *  for each uid. Lets saveWorkoutLogToFirestore compute a diff without the
 *  caller threading prev through every commit site. */
const _lastSyncedWorkouts = new Map();

/** v2 single-doc-shaped writer kept for back-compat with callers that pass
 *  the full array. Computes the diff against the last in-memory snapshot
 *  and writes only the deltas to the per-workout subcollection. */
export async function saveWorkoutLogToFirestore(uid, workouts) {
  if (!Array.isArray(workouts) || workouts.length === 0) {
    // Safety: refuse to nuke a healthy remote with an empty payload —
    // same data-loss kill path the legacy writer guarded against on
    // 2026-05-04 (stray hydrate-with-[] from a transient empty load).
    try {
      const colRef = collection(db, 'users', uid, 'workouts');
      const snap = await getDocs(colRef);
      if (snap.size > 0) {
        console.warn(
          `[saveWorkoutLogToFirestore] About to write ${Array.isArray(workouts) ? workouts.length : 'non-array'} workouts; remote subcollection has ${snap.size}. Refusing to overwrite. uid=${uid}`,
        );
        return;
      }
    } catch (err) {
      console.error('[saveWorkoutLogToFirestore] safety pre-read failed:', err);
      return;
    }
    _lastSyncedWorkouts.set(uid, []);
    return;
  }
  // Mint ids for any rows that don't have one yet (legacy data being
  // saved for the first time via the new code path).
  const withIds = workouts.map(w => (w?.id ? w : { ...w, id: newWorkoutId() }));
  const prev = _lastSyncedWorkouts.get(uid) || [];
  await syncWorkoutsDiffToFirestore(uid, prev, withIds);
  _lastSyncedWorkouts.set(uid, withIds);
}

/** Load the workout log. v2-aware: checks the schema flag and either reads
 *  the per-workout subcollection directly or runs the one-time migration
 *  first.
 *
 *  Migration sources (priority order):
 *    1. users/{uid}/data/workoutLog (legacy v1 — single doc)
 *    2. users/{uid}.workoutLog       (legacy v0 — field on main user doc)
 *
 *  Legacy workouts get UUIDs minted before the fan-out to subcollection
 *  docs. Idempotent: re-running the migration finds the schema flag and
 *  just reads from the subcollection.
 *
 *  Returns the workouts array, or null on hard error. */
export async function loadWorkoutLogFromFirestore(uid) {
  try {
    const schemaVersion = await getWorkoutSchemaVersion(uid);
    if (schemaVersion === 'v2') {
      const next = await loadAllWorkoutsFromSubcollection(uid);
      _lastSyncedWorkouts.set(uid, next);
      return next.length > 0 ? next : null;
    }

    let legacy = [];
    try {
      const legacyDocRef = doc(db, 'users', uid, 'data', 'workoutLog');
      const snap = await getDoc(legacyDocRef);
      if (snap.exists() && Array.isArray(snap.data().workouts)) {
        legacy = snap.data().workouts;
      }
    } catch {}
    if (legacy.length === 0) {
      try {
        const userRef = doc(db, 'users', uid);
        const snap = await getDoc(userRef);
        if (snap.exists() && Array.isArray(snap.data().workoutLog)) {
          legacy = snap.data().workoutLog;
        }
      } catch {}
    }

    const withIds = legacy.map(w => (w?.id ? w : { ...w, id: newWorkoutId() }));
    if (withIds.length > 0) {
      await batchSaveWorkoutDays(uid, withIds);
    }
    await setWorkoutSchemaVersion(uid, 'v2');
    // Drop the legacy data so the storage-banner stops counting it. Best
    // effort: a partial cleanup still leaves the subcollection as truth.
    try {
      await setDoc(doc(db, 'users', uid, 'data', 'workoutLog'), { workouts: [] }, { merge: false });
    } catch (err) {
      console.warn('[loadWorkoutLogFromFirestore] could not clear legacy v1 doc:', err);
    }
    try {
      await updateDoc(doc(db, 'users', uid), { workoutLog: null });
    } catch (err) {
      // Field may not exist on doc — ignore.
    }
    const fresh = await loadAllWorkoutsFromSubcollection(uid);
    _lastSyncedWorkouts.set(uid, fresh);
    return fresh.length > 0 ? fresh : null;
  } catch (err) {
    console.error('loadWorkoutLogFromFirestore:', err);
    return null;
  }
}

// ── Workout draft (in-progress, unsaved) — synced web → mobile ──────────

/** Save the current in-progress workout so other devices can see it live. */
export async function saveWorkoutDraft(uid, draft) {
  const ref = doc(db, 'users', uid, 'data', 'workoutDraft');
  await setDoc(ref, {
    ...draft,
    updatedAt: new Date().toISOString(),
  }, { merge: false });
}

/** Clear the draft (called when the workout is saved or the user resets). */
export async function clearWorkoutDraft(uid) {
  const ref = doc(db, 'users', uid, 'data', 'workoutDraft');
  try {
    await setDoc(ref, { cleared: true, updatedAt: new Date().toISOString() }, { merge: false });
  } catch {
    // Non-critical if it fails.
  }
}

/** One-shot read of the current draft. */
export async function loadWorkoutDraft(uid) {
  try {
    const ref = doc(db, 'users', uid, 'data', 'workoutDraft');
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data?.cleared) return null;
    return data;
  } catch {
    return null;
  }
}

/** Subscribe to the draft for real-time updates from other devices. */
export function subscribeToWorkoutDraft(uid, onChange) {
  const ref = doc(db, 'users', uid, 'data', 'workoutDraft');
  return onSnapshot(ref, snap => {
    if (!snap.exists()) { onChange(null); return; }
    const data = snap.data();
    if (data?.cleared) { onChange(null); return; }
    onChange(data || null);
  });
}

/**
 * Save recipes to a separate Firestore document to avoid 1MB user doc limit.
 */
export async function saveRecipesToFirestore(uid, recipes) {
  const ref = doc(db, 'users', uid, 'data', 'recipes');
  await safeOverwriteDoc({
    uid, type: 'recipes', ref, field: 'recipes', value: Array.isArray(recipes) ? recipes : [],
    count: (v) => (Array.isArray(v) ? v.length : 0),
    extract: (data) => data?.recipes || [],
  });
}

/**
 * Save a timestamped backup of recipes to Firestore.
 * Keeps one backup per day (overwrites same-day backups).
 */
export async function backupRecipes(uid, recipes) {
  if (!recipes || recipes.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const ref = doc(db, 'users', uid, 'backups', `recipes-${today}`);
  await setDoc(ref, {
    recipes,
    date: today,
    count: recipes.length,
    timestamp: new Date().toISOString(),
  }, { merge: false });
}

// Prefixes that identify app-owned data in localStorage. Any key starting
// with one of these is automatically captured by backups — no list to
// maintain. New features that follow the naming convention are protected
// for free. Update this array (rather than per-feature lists elsewhere)
// only if you adopt a new prefix.
export const APP_STORAGE_PREFIXES = ['sunday-', 'recipe-tracker-', 'prep-day-'];

// Internal localStorage keys that don't represent user-owned data and
// shouldn't be in backups (mostly sync markers / one-shot migration flags).
const BACKUP_EXCLUDE = new Set([
  'sunday-current-uid',
  'sunday-post-onboarding',
  'sunday-pending-shared-recipe',
  'sunday-recipe-source-seen',
  'sunday-weight-cleanup-v2',
  'sunday-weight-cleanup-v3',
  'sunday-weight-setup-done',
  'migration-key-ingredients-v1',
  'migration-size-variants-v2',
]);

// Local-only computed CACHES. These are rebuilt on demand and are NEVER
// written to any Firestore doc, so they must not (a) count against the
// per-document storage estimate that drives the storage banner, nor (b) bloat
// backups. `sunday-nutrition-cache` in particular can reach hundreds of KB and
// was falsely tripping the "main profile at 76%" warning even though it never
// leaves the browser. Exact keys + prefixes (exercise-demo caches are keyed by
// exercise name, e.g. `sunday-exercise-demo-v1:seated cable row`).
const LOCAL_ONLY_CACHE_KEYS = new Set([
  'sunday-nutrition-cache',
  'sunday-nutrition-cache-version',
]);
const LOCAL_ONLY_CACHE_PREFIXES = ['sunday-exercise-demo-v1:'];
function isLocalOnlyCache(key) {
  return LOCAL_ONLY_CACHE_KEYS.has(key)
    || LOCAL_ONLY_CACHE_PREFIXES.some(p => key.startsWith(p));
}

function snapshotAllAppLocalStorage() {
  const data = {};
  if (typeof localStorage === 'undefined') return data;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (BACKUP_EXCLUDE.has(key)) continue;
    if (key.startsWith('sunday-backup-full-')) continue; // throttle markers
    if (!APP_STORAGE_PREFIXES.some(p => key.startsWith(p))) continue;
    if (isLocalOnlyCache(key)) continue; // derived caches rebuild on demand
    const raw = localStorage.getItem(key);
    if (raw == null) continue;
    try {
      data[key] = JSON.parse(raw);
    } catch {
      data[key] = raw;
    }
  }
  return data;
}

// Maps a localStorage key to the Firestore doc it ends up in. Anything not
// listed lives inline on the main user doc and is bound by its 1 MB limit.
const KEY_TO_DOC = {
  'recipe-tracker-recipes': 'recipes',
  'sunday-daily-log': 'dailyLog',
  'sunday-workout-draft': 'workoutDraft',
  // 'sunday-workout-log' intentionally excluded: workouts are stored as
  // one Firestore doc per workout (users/{uid}/workouts/{id}), so the
  // localStorage array doesn't correspond to any single Firestore doc and
  // counting it against the 1 MB per-doc cap would mislead the banner.
};

/**
 * Estimate how many bytes each Firestore doc would weigh based on what we have
 * in localStorage. Used to drive the storage warning banner.
 * Returns { docs: { user, recipes, dailyLog, workoutDraft }, total }.
 * Sizes are upper bounds — actual Firestore serialization may be smaller, but
 * the figures are accurate enough for a soft per-doc cap warning.
 */
export function computeStorageBreakdown() {
  const docs = { user: 0, recipes: 0, dailyLog: 0, workoutDraft: 0 };
  if (typeof localStorage === 'undefined') return { docs, total: 0 };
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (BACKUP_EXCLUDE.has(key)) continue;
    if (key.startsWith('sunday-backup-full-')) continue;
    if (!APP_STORAGE_PREFIXES.some(p => key.startsWith(p))) continue;
    // workoutLog lives in a subcollection now — skip rather than fold its
    // size into the main user doc (would falsely trip the per-doc warning).
    if (key === 'sunday-workout-log') continue;
    // Local-only recompute caches never reach any Firestore doc — counting
    // them here falsely inflates the per-document usage warning.
    if (isLocalOnlyCache(key)) continue;
    const raw = localStorage.getItem(key) || '';
    const docName = KEY_TO_DOC[key] || 'user';
    docs[docName] += raw.length;
  }
  const total = Object.values(docs).reduce((a, b) => a + b, 0);
  return { docs, total };
}

/**
 * Persist the latest storage estimate on the user doc so other sessions /
 * devices see consistent data and we don't recompute on every render.
 */
export async function saveStorageEstimate(uid) {
  if (!uid) return null;
  const breakdown = computeStorageBreakdown();
  try {
    await updateDoc(doc(db, 'users', uid), {
      storageEstimate: { ...breakdown, asOf: new Date().toISOString() },
    });
  } catch (err) {
    console.warn('saveStorageEstimate failed:', err);
  }
  return breakdown;
}

// Pack { key: value } pairs into chunks whose serialized JSON stays under the
// Firestore 1 MB per-doc limit. Target 700 KB per chunk to leave headroom for
// metadata fields, base64 escaping, and Firestore wire overhead.
function packIntoChunks(snapshot, targetBytes = 700 * 1024) {
  const chunks = [];
  let current = {};
  let currentSize = 2; // for "{}"
  for (const key of Object.keys(snapshot)) {
    const piece = JSON.stringify({ [key]: snapshot[key] });
    const pieceSize = piece.length;
    if (currentSize + pieceSize > targetBytes && Object.keys(current).length > 0) {
      chunks.push(current);
      current = {};
      currentSize = 2;
    }
    current[key] = snapshot[key];
    currentSize += pieceSize;
  }
  if (Object.keys(current).length > 0) chunks.push(current);
  return chunks;
}

/**
 * Save a daily snapshot of *all* app-owned data — every localStorage key
 * matching APP_STORAGE_PREFIXES.
 *
 * Layout (v3): manifest at `users/{uid}/backups/full-YYYY-MM-DD` with
 *   { date, timestamp, keyCount, chunkCount, chunkIds, version: 3 }
 * and N chunk docs at `users/{uid}/backups/full-YYYY-MM-DD-c{N}` each holding
 *   { data: { key: value, ... }, parentId, chunkIndex }
 * This sidesteps Firestore's 1 MB per-doc limit which silently killed v2 once
 * users accumulated enough recipes/history.
 *
 * Backward compatible: v2 manifests (single inline `data` field) still read.
 */
export async function backupAllUserData(uid) {
  if (!uid) return;
  const today = new Date().toISOString().slice(0, 10);
  const snapshot = snapshotAllAppLocalStorage();
  const manifestRef = doc(db, 'users', uid, 'backups', `full-${today}`);
  try {
    // Clean up any chunks from an earlier same-day backup so we don't leak
    // orphans when the new snapshot needs fewer chunks than the previous one.
    try {
      const existing = await getDoc(manifestRef);
      if (existing.exists()) {
        const ids = existing.data().chunkIds;
        if (Array.isArray(ids)) {
          await Promise.all(ids.map(id =>
            deleteDoc(doc(db, 'users', uid, 'backups', id)).catch(() => {})
          ));
        }
      }
    } catch { /* best-effort cleanup */ }

    const chunks = packIntoChunks(snapshot);
    const chunkIds = chunks.map((_, i) => `full-${today}-c${i}`);

    await Promise.all(chunks.map((chunk, i) =>
      setDoc(doc(db, 'users', uid, 'backups', chunkIds[i]), {
        data: chunk,
        parentId: `full-${today}`,
        chunkIndex: i,
      }, { merge: false })
    ));

    await setDoc(manifestRef, {
      date: today,
      timestamp: new Date().toISOString(),
      keyCount: Object.keys(snapshot).length,
      chunkCount: chunks.length,
      chunkIds,
      version: 3,
    }, { merge: false });

    // Refresh the per-user storage estimate so the warning banner reflects
    // current data size. Best-effort — failure here shouldn't fail the backup.
    saveStorageEstimate(uid).catch(() => {});
  } catch (err) {
    // Don't break the app if the backup write fails — user-facing operations
    // shouldn't error because of a background safety mechanism.
    console.error('backupAllUserData write failed:', err);
  }
}

/**
 * List every full-snapshot backup we have for this user, with key counts so
 * the user can pick which one to restore from. Returns newest-first.
 *
 * Two kinds of backups can live here:
 *   - full-YYYY-MM-DD  → client-side snapshot of localStorage (key/value map)
 *   - full-server-YYYY-MM-DD → Cloud Function snapshot of users/{uid} doc
 */
export async function listFullBackups(uid) {
  const colRef = collection(db, 'users', uid, 'backups');
  const snap = await getDocs(colRef);
  const out = [];
  snap.forEach(d => {
    const id = d.id;
    if (!id.startsWith('full-')) return; // skip 'recipes-*' and others
    if (/^full-.*-c\d+$/.test(id)) return; // skip v3 chunk docs
    const data = d.data();
    // v3 manifests don't carry inline data — counts unknown without chunk fetch
    if (data.version === 3) {
      out.push({
        id,
        date: data.date || id.replace(/^full-/, ''),
        source: 'client',
        chunkCount: data.chunkCount || 0,
        keyCount: data.keyCount || 0,
      });
      return;
    }
    const inner = data.data || data;
    const planHistory = inner['sunday-plan-history'] || inner.planHistory;
    const weightLog = inner['sunday-weight-log'] || inner.weightLog;
    out.push({
      id,
      date: data.date || id.replace(/^full-(server-)?/, ''),
      source: data.source || (id.startsWith('full-server-') ? 'scheduled-fn' : 'client'),
      planHistoryCount: Array.isArray(planHistory) ? planHistory.length : 0,
      weightLogCount: Array.isArray(weightLog) ? weightLog.length : 0,
    });
  });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Restore a single field from a full-snapshot backup. Writes back to both
 * Firestore (main user doc) and localStorage so the UI picks it up on next
 * render. Returns the restored array.
 */
export async function restoreFieldFromBackup(uid, backupId, field) {
  const ref = doc(db, 'users', uid, 'backups', backupId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Backup not found');
  const data = snap.data();
  // Map our field name → both possible storage keys.
  const FIELD_KEYS = {
    planHistory: ['sunday-plan-history', 'planHistory'],
    weightLog: ['sunday-weight-log', 'weightLog'],
    weeklyPlan: ['sunday-weekly-plan', 'weeklyPlan'],
    weeklyServings: ['sunday-weekly-servings', 'weeklyServings'],
    weekMealPlan: ['sunday-week-meal-plan', 'weekMealPlan'],
    weekWorkoutPlan: ['sunday-week-workout-plan', 'weekWorkoutPlan'],
    workoutLog: ['sunday-workout-log', 'workoutLog'],
    groceryStaples: ['sunday-grocery-staples', 'groceryStaples'],
    pantrySpices: ['sunday-pantry-spices', 'pantrySpices'],
    pantrySauces: ['sunday-pantry-sauces', 'pantrySauces'],
    pantrySnacks: ['sunday-pantry-snacks', 'pantrySnacks'],
    pantryFruit: ['sunday-pantry-fruit', 'pantryFruit'],
  };
  const keys = FIELD_KEYS[field] || [field];
  let value = null;

  // v3 manifest: scan chunk docs
  if (data.version === 3 && Array.isArray(data.chunkIds)) {
    for (const chunkId of data.chunkIds) {
      const chunkSnap = await getDoc(doc(db, 'users', uid, 'backups', chunkId));
      if (!chunkSnap.exists()) continue;
      const inner = chunkSnap.data().data || {};
      for (const k of keys) {
        if (inner[k] != null) { value = inner[k]; break; }
      }
      if (value != null) break;
    }
  } else {
    // v2 inline backup or legacy server-side doc
    const inner = data.data || data;
    for (const k of keys) {
      if (inner[k] != null) { value = inner[k]; break; }
    }
  }

  if (value == null) throw new Error(`Backup has no ${field}`);
  // Persist back. saveField writes to Firestore main doc; localStorage
  // makes the change immediately visible to the current page.
  await saveField(uid, field, value);
  const localKey = keys.find(k => k.startsWith('sunday-')) || `sunday-${field}`;
  localStorage.setItem(localKey, JSON.stringify(value));
  return Array.isArray(value) ? value.length : 1;
}

/**
 * List available recipe backups (returns array of { date, count, timestamp }).
 */
export async function listRecipeBackups(uid) {
  const colRef = collection(db, 'users', uid, 'backups');
  const snap = await getDocs(colRef);
  const backups = [];
  snap.forEach(d => {
    const data = d.data();
    if (d.id.startsWith('recipes-')) {
      backups.push({ id: d.id, date: data.date, count: data.count, timestamp: data.timestamp });
    }
  });
  return backups.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Restore recipes from a specific backup.
 */
export async function restoreRecipeBackup(uid, backupId) {
  const ref = doc(db, 'users', uid, 'backups', backupId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Backup not found');
  return snap.data().recipes || [];
}

/**
 * Load recipes from the separate subcollection doc, with fallback to main user doc.
 */
export async function loadRecipesFromFirestore(uid) {
  try {
    const ref = doc(db, 'users', uid, 'data', 'recipes');
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data().recipes || [];
    return null; // not migrated yet — caller should check main user doc
  } catch (err) {
    console.error('loadRecipesFromFirestore:', err);
    return null;
  }
}

/**
 * Load the entire user document from Firestore.
 * Recipes are loaded from subcollection if available, with migration from main doc.
 */
export async function loadUserData(uid) {
  try {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();

    // Load recipes from subcollection (or migrate from main doc)
    const subRecipes = await loadRecipesFromFirestore(uid);
    if (subRecipes !== null) {
      data.recipes = subRecipes;
    } else if (data.recipes && data.recipes.length > 0) {
      // Migrate: move recipes to subcollection and remove from main doc
      try {
        await saveRecipesToFirestore(uid, data.recipes);
        await setDoc(ref, { recipes: [] }, { merge: true });
      } catch (migErr) {
        console.error('Recipe migration error:', migErr);
      }
    }

    // Load workoutLog from the v2 per-workout subcollection. The loader
    // handles legacy v1 (data/workoutLog) and legacy v0 (workoutLog field
    // on the user doc) migrations internally, gated on the workoutSchema
    // flag, so we don't need a fallback path here. data.workoutLog from
    // the snapshot above could be stale legacy data — overwrite either
    // way to keep callers reading the canonical subcollection result.
    const subWorkouts = await loadWorkoutLogFromFirestore(uid);
    data.workoutLog = subWorkouts || [];

    return data;
  } catch (err) {
    console.error('Firestore loadUserData:', err);
    return null;
  }
}

/**
 * Migrate current localStorage data up to Firestore (first-time sign-in).
 */
export async function migrateToFirestore(uid) {
  const data = {};

  // Save recipes to subcollection instead of main doc
  try {
    const recipes = localStorage.getItem('recipe-tracker-recipes');
    if (recipes) {
      await saveRecipesToFirestore(uid, JSON.parse(recipes));
    }
  } catch {}

  try {
    const plan = localStorage.getItem('sunday-weekly-plan');
    if (plan) data.weeklyPlan = JSON.parse(plan);
  } catch {}

  try {
    const history = localStorage.getItem('sunday-plan-history');
    if (history) data.planHistory = JSON.parse(history);
  } catch {}

  try {
    const staples = localStorage.getItem('sunday-grocery-staples');
    if (staples) data.groceryStaples = JSON.parse(staples);
  } catch {}

  try {
    const spices = localStorage.getItem('sunday-pantry-spices');
    if (spices) data.pantrySpices = JSON.parse(spices);
  } catch {}

  try {
    const sauces = localStorage.getItem('sunday-pantry-sauces');
    if (sauces) data.pantrySauces = JSON.parse(sauces);
  } catch {}

  try {
    const snacks = localStorage.getItem('sunday-pantry-snacks');
    if (snacks) data.pantrySnacks = JSON.parse(snacks);
  } catch {}

  try {
    const fruit = localStorage.getItem('sunday-pantry-fruit');
    if (fruit) data.pantryFruit = JSON.parse(fruit);
  } catch {}

  try {
    const extras = localStorage.getItem('sunday-shop-extras');
    if (extras) data.shopExtras = JSON.parse(extras);
  } catch {}

  try {
    const storeLists = localStorage.getItem('sunday-store-lists');
    if (storeLists) data.storeLists = JSON.parse(storeLists);
  } catch {}

  try {
    const selection = localStorage.getItem('sunday-shopping-selection');
    if (selection) data.shoppingSelection = JSON.parse(selection);
  } catch {}

  try {
    const weeklyServings = localStorage.getItem('sunday-weekly-servings');
    if (weeklyServings) data.weeklyServings = JSON.parse(weeklyServings);
  } catch {}

  try {
    const weekMealPlan = localStorage.getItem('sunday-week-meal-plan');
    if (weekMealPlan) data.weekMealPlan = JSON.parse(weekMealPlan);
  } catch {}

  try {
    const weekWorkoutPlan = localStorage.getItem('sunday-week-workout-plan');
    if (weekWorkoutPlan) data.weekWorkoutPlan = JSON.parse(weekWorkoutPlan);
  } catch {}

  try {
    const keyIngs = localStorage.getItem('sunday-key-ingredients');
    if (keyIngs) data.keyIngredients = JSON.parse(keyIngs);
  } catch {}

  try {
    const nutritionGoals = localStorage.getItem('sunday-nutrition-goals');
    if (nutritionGoals) data.nutritionGoals = JSON.parse(nutritionGoals);
  } catch {}

  try {
    const mealChartColors = localStorage.getItem('sunday-meal-chart-colors');
    if (mealChartColors) data.mealChartColors = JSON.parse(mealChartColors);
  } catch {}

  try {
    const bodyStats = localStorage.getItem('sunday-body-stats');
    if (bodyStats) data.bodyStats = JSON.parse(bodyStats);
  } catch {}

  try {
    const dailyLog = localStorage.getItem('sunday-daily-log');
    if (dailyLog) data.dailyLog = JSON.parse(dailyLog);
  } catch {}

  try {
    const weightLog = localStorage.getItem('sunday-weight-log');
    if (weightLog) data.weightLog = JSON.parse(weightLog);
  } catch {}

  try {
    const workoutLog = localStorage.getItem('sunday-workout-log');
    if (workoutLog) data.workoutLog = JSON.parse(workoutLog);
  } catch {}

  try {
    const exerciseLibrary = localStorage.getItem('sunday-exercise-library');
    if (exerciseLibrary) data.exerciseLibrary = JSON.parse(exerciseLibrary);
  } catch {}

  try {
    const gyms = localStorage.getItem('sunday-workout-gyms');
    if (gyms) data.gyms = JSON.parse(gyms);
  } catch {}

  try {
    const wu = localStorage.getItem('sunday-workout-weight-unit');
    if (wu === 'lb' || wu === 'kg') data.workoutWeightUnit = wu;
  } catch {}

  try {
    const reminderSettings = localStorage.getItem('sunday-reminder-settings');
    if (reminderSettings) data.reminderSettings = JSON.parse(reminderSettings);
  } catch {}

  try {
    const shoppingChecked = localStorage.getItem('sunday-shopping-checked');
    if (shoppingChecked) data.shoppingChecked = JSON.parse(shoppingChecked);
    const staplesChecked = localStorage.getItem('sunday-staples-checked');
    if (staplesChecked) data.staplesChecked = JSON.parse(staplesChecked);
  } catch {}

  try {
    const catLayout = localStorage.getItem('sunday-cat-layout');
    if (catLayout) data.catLayout = JSON.parse(catLayout);
  } catch {}

  try {
    const customGridWidgets = localStorage.getItem(`sunday-custom-grid-widgets-${uid}`) || localStorage.getItem('sunday-custom-grid-widgets');
    if (customGridWidgets) data.customGridWidgets = JSON.parse(customGridWidgets);
  } catch {}

  // mealImages are stored in their own collection, not in the user doc

  if (Object.keys(data).length === 0) return;

  try {
    const ref = doc(db, 'users', uid);
    await setDoc(ref, data, { merge: true });
  } catch (err) {
    console.error('Firestore migrateToFirestore:', err);
  }
}

/**
 * Load Firestore data into localStorage so the app can read it normally.
 * Always writes every key (using empty defaults) so stale data is overwritten.
 */
/**
 * Merge two recipe arrays by ID. For each recipe, keep the version
 * with the newer updatedAt timestamp. Recipes that exist in only
 * one array are included as-is.
 */
function mergeRecipeArrays(localRecipes, remoteRecipes) {
  const localMap = new Map();
  for (const r of localRecipes) if (r.id) localMap.set(r.id, r);

  const remoteMap = new Map();
  for (const r of remoteRecipes) if (r.id) remoteMap.set(r.id, r);

  const merged = new Map();

  // Process all remote recipes
  for (const [id, remote] of remoteMap) {
    const local = localMap.get(id);
    if (!local) {
      // Remote-only: only include if we haven't recently edited locally
      // (otherwise it's a recipe we just deleted)
      if (!window.__recipesLocalEdit) {
        merged.set(id, remote);
      }
    } else {
      // Exists on both — keep the newer one
      const localTime = local.updatedAt || local.createdAt || '';
      const remoteTime = remote.updatedAt || remote.createdAt || '';
      merged.set(id, localTime > remoteTime ? local : remote);
    }
  }

  // Add recipes that only exist locally (newly added on this device)
  for (const [id, local] of localMap) {
    if (!merged.has(id)) {
      merged.set(id, local);
    }
  }

  // Deduplicate by title — if two recipes have the same title but different IDs,
  // keep the one with more data (ingredients/instructions) or newer updatedAt
  const byTitle = new Map();
  for (const r of merged.values()) {
    const key = (r.title || '').toLowerCase().trim();
    if (!key) continue;
    if (byTitle.has(key)) {
      const existing = byTitle.get(key);
      const existingScore = (existing.ingredients || []).length + (existing.instructions ? 1 : 0);
      const newScore = (r.ingredients || []).length + (r.instructions ? 1 : 0);
      if (newScore > existingScore || (newScore === existingScore && (r.updatedAt || '') > (existing.updatedAt || ''))) {
        merged.delete(existing.id);
        byTitle.set(key, r);
      } else {
        merged.delete(r.id);
      }
    } else {
      byTitle.set(key, r);
    }
  }

  return Array.from(merged.values());
}

export function hydrateLocalStorage(userData, uid) {
  if (!userData) return;

  // Merge recipes by ID instead of overwriting, so edits on different
  // devices to different recipes don't clobber each other.
  if (!window.__recipesLocalEdit) {
    const remoteRecipes = userData.recipes || [];
    try {
      const localRecipes = JSON.parse(localStorage.getItem('recipe-tracker-recipes') || '[]');
      const merged = mergeRecipeArrays(localRecipes, remoteRecipes);
      localStorage.setItem('recipe-tracker-recipes', JSON.stringify(merged));

      // If merge result differs from remote, push merged version back
      if (merged.length !== remoteRecipes.length || merged.some((r, i) => r.id !== remoteRecipes[i]?.id || r.updatedAt !== remoteRecipes[i]?.updatedAt)) {
        const user = auth.currentUser;
        if (user) {
          saveRecipesToFirestore(user.uid, merged).catch(() => {});
        }
      }
    } catch {
      localStorage.setItem('recipe-tracker-recipes', JSON.stringify(remoteRecipes));
    }
  }
  // Don't let a remote-empty value wipe a populated local one. Same
  // defense as the workoutLog guard further down — if the remote is
  // empty/missing and we already have local data, keep local.
  function hydrateArrayWithDefense(localKey, remoteVal, label) {
    const remoteIsEmpty = remoteVal == null || (Array.isArray(remoteVal) && remoteVal.length === 0);
    if (remoteIsEmpty) {
      try {
        const existingRaw = localStorage.getItem(localKey);
        const existingArr = existingRaw ? JSON.parse(existingRaw) : null;
        if (Array.isArray(existingArr) && existingArr.length > 0) {
          console.warn(`[loadUserData] Remote ${label} empty; preserving ${existingArr.length} local entries.`);
          return; // skip overwrite
        }
      } catch { /* fall through */ }
    }
    localStorage.setItem(localKey, JSON.stringify(remoteVal || []));
  }
  function hydrateObjectWithDefense(localKey, remoteVal, label) {
    const remoteIsEmpty = remoteVal == null || (typeof remoteVal === 'object' && Object.keys(remoteVal).length === 0);
    if (remoteIsEmpty) {
      try {
        const existingRaw = localStorage.getItem(localKey);
        const existingObj = existingRaw ? JSON.parse(existingRaw) : null;
        if (existingObj && typeof existingObj === 'object' && Object.keys(existingObj).length > 0) {
          console.warn(`[loadUserData] Remote ${label} empty; preserving local.`);
          return;
        }
      } catch { /* fall through */ }
    }
    localStorage.setItem(localKey, JSON.stringify(remoteVal || {}));
  }

  hydrateArrayWithDefense('sunday-weekly-plan', userData.weeklyPlan, 'weeklyPlan');
  hydrateArrayWithDefense('sunday-plan-history', userData.planHistory, 'planHistory');
  hydrateArrayWithDefense('recipe-tracker-deleted', userData.deletedRecipes, 'deletedRecipes');
  hydrateArrayWithDefense('sunday-grocery-staples', userData.groceryStaples, 'groceryStaples');
  hydrateArrayWithDefense('sunday-pantry-spices', userData.pantrySpices, 'pantrySpices');
  hydrateArrayWithDefense('sunday-pantry-sauces', userData.pantrySauces, 'pantrySauces');
  hydrateArrayWithDefense('sunday-pantry-snacks', userData.pantrySnacks, 'pantrySnacks');
  hydrateArrayWithDefense('sunday-pantry-fruit', userData.pantryFruit, 'pantryFruit');
  localStorage.setItem('sunday-shop-extras', JSON.stringify(userData.shopExtras || []));
  localStorage.setItem('sunday-shop-links', JSON.stringify(userData.shopLinks || {}));
  localStorage.setItem('sunday-shopping-selection', JSON.stringify(userData.shoppingSelection || []));
  hydrateArrayWithDefense('sunday-shopping-lists', userData.shoppingLists, 'shoppingLists');
  hydrateArrayWithDefense('sunday-store-lists', userData.storeLists, 'storeLists');
  hydrateObjectWithDefense('sunday-weekly-servings', userData.weeklyServings, 'weeklyServings');
  hydrateObjectWithDefense('sunday-week-meal-plan', userData.weekMealPlan, 'weekMealPlan');
  hydrateObjectWithDefense('sunday-week-workout-plan', userData.weekWorkoutPlan, 'weekWorkoutPlan');

  if (userData.keyIngredients) {
    localStorage.setItem('sunday-key-ingredients', JSON.stringify(userData.keyIngredients));
  }

  if (userData.nutritionGoals) {
    localStorage.setItem('sunday-nutrition-goals', JSON.stringify(userData.nutritionGoals));
  }

  if (userData.mealChartColors) {
    localStorage.setItem('sunday-meal-chart-colors', JSON.stringify(userData.mealChartColors));
  }

  if (userData.bodyStats) {
    localStorage.setItem('sunday-body-stats', JSON.stringify(userData.bodyStats));
  }

  // Whoop: per-day rollup (calories/strain/recovery/sleep) written by the
  // server's /api/whoop/data fetch, plus the calorie-budget opt-in flag.
  if (userData.whoopDaily) {
    localStorage.setItem('sunday-whoop-daily', JSON.stringify(userData.whoopDaily));
  }
  if (userData.whoopAddCaloriesToBudget !== undefined) {
    localStorage.setItem('sunday-whoop-budget', JSON.stringify(!!userData.whoopAddCaloriesToBudget));
  }

  // Daily log is now in a separate subcollection doc — do NOT hydrate from main user doc.
  // Load from subcollection instead (handled by loadDailyLogFromFirestore).

  if (userData.userGoals) {
    localStorage.setItem('sunday-user-goals', JSON.stringify(userData.userGoals));
  }

  if (userData.userDiet) {
    localStorage.setItem('sunday-user-diet', JSON.stringify(userData.userDiet));
  }

  if (userData.userLocation) {
    localStorage.setItem('sunday-user-location', userData.userLocation);
  }

  if (userData.weightLog !== undefined) {
    hydrateArrayWithDefense('sunday-weight-log', userData.weightLog, 'weightLog');
  }

  if (userData.workoutLog) {
    // Don't let a remote-empty wipe a populated local log. If localStorage
    // already has workouts and the remote is empty, keep local — same
    // defense as the mobile workoutStore.hydrate guard.
    let nextLog = userData.workoutLog;
    if (Array.isArray(nextLog) && nextLog.length === 0) {
      try {
        const existingRaw = localStorage.getItem('sunday-workout-log');
        const existingArr = existingRaw ? JSON.parse(existingRaw) : null;
        if (Array.isArray(existingArr) && existingArr.length > 0) {
          console.warn(
            `[loadUserData] Remote workoutLog empty; preserving ${existingArr.length} local workouts.`,
          );
          nextLog = null;
        }
      } catch { /* fall through */ }
    }
    if (nextLog) {
      localStorage.setItem('sunday-workout-log', JSON.stringify(nextLog));
    }
  }

  if (userData.exerciseLibrary) {
    localStorage.setItem('sunday-exercise-library', JSON.stringify(userData.exerciseLibrary));
  }

  if (Array.isArray(userData.workoutTypes) && userData.workoutTypes.length > 0) {
    localStorage.setItem('sunday-workout-types', JSON.stringify(userData.workoutTypes));
  }

  if (userData.workoutTypeSkipDates && typeof userData.workoutTypeSkipDates === 'object') {
    localStorage.setItem('sunday-workout-type-skip-dates', JSON.stringify(userData.workoutTypeSkipDates));
  }

  if (userData.workoutTypeCategories && typeof userData.workoutTypeCategories === 'object') {
    localStorage.setItem('sunday-workout-type-categories', JSON.stringify(userData.workoutTypeCategories));
  }

  // Workout tab gating: anyone with this flag set on their user doc sees
  // the Workout nav entry. baldaufdan@gmail.com always sees it.
  if (userData.workoutEnabled) {
    localStorage.setItem('sunday-workout-enabled', 'true');
  } else {
    localStorage.removeItem('sunday-workout-enabled');
  }

  if (userData.workoutWeightUnit === 'lb' || userData.workoutWeightUnit === 'kg') {
    localStorage.setItem('sunday-workout-weight-unit', userData.workoutWeightUnit);
  }
  if (Array.isArray(userData.gyms)) {
    localStorage.setItem('sunday-workout-gyms', JSON.stringify(userData.gyms));
  }

  if (userData.reminderSettings) {
    localStorage.setItem('sunday-reminder-settings', JSON.stringify(userData.reminderSettings));
  }

  if (userData.shoppingChecked) {
    localStorage.setItem('sunday-shopping-checked', JSON.stringify(userData.shoppingChecked));
  }

  if (userData.staplesChecked) {
    localStorage.setItem('sunday-staples-checked', JSON.stringify(userData.staplesChecked));
  }

  if (userData.catLayout) {
    localStorage.setItem('sunday-cat-layout', JSON.stringify(userData.catLayout));
  }

  if (userData.hiddenCategories) {
    localStorage.setItem('sunday-hidden-categories', JSON.stringify(userData.hiddenCategories));
  }

  if (userData.customGridWidgets) {
    const cwKey = uid ? `sunday-custom-grid-widgets-${uid}` : 'sunday-custom-grid-widgets';
    localStorage.setItem(cwKey, JSON.stringify(userData.customGridWidgets));
  }

  // mealImages are stored in separate Firestore docs (mealImages/{uid}/images/{recipeId})
  // and synced via syncMealImages() — not part of the user document anymore.
}

/**
 * Subscribe to real-time updates on the user document.
 * Calls onChange(data) whenever the document changes on the server.
 * Returns an unsubscribe function.
 */
export function subscribeToUserData(uid, onChange) {
  const userRef = doc(db, 'users', uid);
  const recipesRef = doc(db, 'users', uid, 'data', 'recipes');

  // Track latest data from both docs
  let userData = null;
  let subRecipes = null;
  let hasSubRecipes = false;

  function emit() {
    if (!userData) return;
    const merged = { ...userData };
    if (hasSubRecipes) merged.recipes = subRecipes || [];
    onChange(merged);
  }

  const unsub1 = onSnapshot(userRef, (snap) => {
    if (snap.exists() && !snap.metadata.hasPendingWrites) {
      userData = snap.data();
      emit();
    }
  }, (err) => { console.error('Firestore user subscription error:', err); });

  const unsub2 = onSnapshot(recipesRef, (snap) => {
    if (!snap.metadata.hasPendingWrites) {
      if (snap.exists()) {
        subRecipes = snap.data().recipes || [];
        hasSubRecipes = true;
      }
      emit();
    }
  }, (err) => { console.error('Firestore recipes subscription error:', err); });

  return () => { unsub1(); unsub2(); };
}

/* ── Friend-related functions ── */

/**
 * Claim a unique username. Writes to both users/{uid} and usernames/{username}.
 * Throws if the username is already taken.
 */
export async function setUsername(uid, username) {
  const lower = username.toLowerCase();
  const usernameRef = doc(db, 'usernames', lower);
  const snap = await getDoc(usernameRef);
  if (snap.exists()) throw new Error('Username already taken');
  await setDoc(usernameRef, { uid });
  await setDoc(doc(db, 'users', uid), { username: lower }, { merge: true });
}

/**
 * Swap a user from `oldUsername` to `newUsername` atomically. Frees the old
 * `usernames/{oldLower}` doc, claims the new one, and updates the user record.
 * Throws if the new name is already taken by someone else.
 */
export async function changeUsername(uid, oldUsername, newUsername) {
  const newLower = newUsername.toLowerCase();
  const oldLower = (oldUsername || '').toLowerCase();
  if (newLower === oldLower) return; // no-op
  const newRef = doc(db, 'usernames', newLower);
  const existing = await getDoc(newRef);
  if (existing.exists() && existing.data().uid !== uid) {
    throw new Error('Username already taken');
  }
  const batch = writeBatch(db);
  if (oldLower) batch.delete(doc(db, 'usernames', oldLower));
  batch.set(newRef, { uid });
  batch.set(doc(db, 'users', uid), { username: newLower }, { merge: true });
  await batch.commit();
}

/**
 * Look up a user by exact username. Returns { uid, username } or null.
 */
export async function searchByUsername(username) {
  const lower = username.toLowerCase();
  const snap = await getDoc(doc(db, 'usernames', lower));
  if (!snap.exists()) return null;
  const foundUid = snap.data().uid;
  // Also fetch email for notifications
  let email = null;
  try {
    const userSnap = await getDoc(doc(db, 'users', foundUid));
    if (userSnap.exists()) email = userSnap.data().email || null;
  } catch {}
  let displayName = null;
  try {
    const userSnap2 = await getDoc(doc(db, 'users', foundUid));
    if (userSnap2.exists()) displayName = userSnap2.data().displayName || null;
  } catch {}
  return { uid: foundUid, username: lower, email, displayName };
}

/**
 * Look up a user by email address. Returns { uid, username, email, displayName } or null.
 */
export async function searchByEmail(email) {
  const lower = email.toLowerCase();
  const q = query(collection(db, 'users'), where('email', '==', lower));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  // A single email can map to multiple user docs (re-signups / duplicate
  // accounts). Returning docs[0] could address a friend request to a stale
  // uid the person no longer logs into — so the request would never appear
  // for them. Prefer the doc most likely to be the active account: one with
  // a username, then the most recent lastLogin.
  const docs = snap.docs.map(d => ({ uid: d.id, data: d.data() || {} }));
  docs.sort((a, b) => {
    const au = a.data.username ? 1 : 0;
    const bu = b.data.username ? 1 : 0;
    if (au !== bu) return bu - au;
    return String(b.data.lastLogin || '').localeCompare(String(a.data.lastLogin || ''));
  });
  const best = docs[0];
  return { uid: best.uid, username: best.data.username || '', email: lower, displayName: best.data.displayName || '' };
}

/**
 * Search for a user by display name (case-insensitive, partial match).
 * Returns first match or null.
 */
export async function searchByName(name) {
  const lower = name.toLowerCase().trim();
  const snap = await getDocs(collection(db, 'users'));
  for (const d of snap.docs) {
    const data = d.data();
    const displayName = (data.displayName || '').toLowerCase();
    if (displayName && displayName.includes(lower)) {
      return { uid: d.id, username: data.username || '', email: data.email || '', displayName: data.displayName || '' };
    }
  }
  return null;
}

/**
 * Send a friend request from one user to another.
 *
 * Guards enforced here at the data layer (not just in the UI) so no entry
 * point or stale deploy can create anonymous/duplicate requests:
 *  - requires a non-empty fromUsername, so the recipient never sees "@A user"
 *  - dedupes: if a pending request from→to already exists, it's a no-op
 *
 * Returns true when a new request was created, false when an identical
 * pending request already existed (so callers can skip the email).
 */
export async function sendFriendRequest(fromUid, toUid, fromUsername, message) {
  const username = (fromUsername || '').trim();
  if (!username) {
    throw new Error('Set a username before sending friend requests so your friend knows who it is from.');
  }

  // Don't pile up duplicate pending requests to the same person.
  const existing = await getDocs(query(
    collection(db, 'friendRequests'),
    where('from', '==', fromUid),
    where('to', '==', toUid),
    where('status', '==', 'pending'),
  ));
  if (!existing.empty) return false;

  const data = {
    from: fromUid,
    to: toUid,
    fromUsername: username,
    status: 'pending',
  };
  if (message) data.message = message;
  await addDoc(collection(db, 'friendRequests'), data);
  return true;
}

/**
 * Get all pending friend requests addressed to a user.
 */
export async function getPendingRequests(uid) {
  const q = query(
    collection(db, 'friendRequests'),
    where('to', '==', uid),
    where('status', '==', 'pending'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Get all pending friend requests sent by a user (outgoing).
 */
export async function getSentRequests(uid) {
  const q = query(
    collection(db, 'friendRequests'),
    where('from', '==', uid),
    where('status', '==', 'pending'),
  );
  const snap = await getDocs(q);
  const results = [];
  for (const d of snap.docs) {
    const data = d.data();
    let toUsername = null;
    let toDisplayName = null;
    try {
      const userSnap = await getDoc(doc(db, 'users', data.to));
      if (userSnap.exists()) {
        toUsername = userSnap.data().username || null;
        toDisplayName = userSnap.data().displayName || null;
      }
    } catch {}
    results.push({ id: d.id, ...data, toUsername, toDisplayName });
  }
  return results;
}

/**
 * Cancel a sent friend request by deleting it.
 */
export async function cancelFriendRequest(requestId) {
  await deleteDoc(doc(db, 'friendRequests', requestId));
}

/**
 * Accept a friend request: delete the request doc and add each uid to the other's friends array.
 */
export async function acceptFriendRequest(requestId, fromUid, toUid) {
  await deleteDoc(doc(db, 'friendRequests', requestId));
  await updateDoc(doc(db, 'users', fromUid), { friends: arrayUnion(toUid) });
  await updateDoc(doc(db, 'users', toUid), { friends: arrayUnion(fromUid) });
}

/**
 * Decline a friend request by deleting it.
 */
export async function declineFriendRequest(requestId) {
  await deleteDoc(doc(db, 'friendRequests', requestId));
}

/**
 * Remove a friend from both users' friends arrays.
 */
export async function removeFriend(uid, friendUid) {
  await updateDoc(doc(db, 'users', uid), { friends: arrayRemove(friendUid) });
  await updateDoc(doc(db, 'users', friendUid), { friends: arrayRemove(uid) });
}

/**
 * Load a user's friends list with username + displayName for each.
 */
export async function loadFriends(uid) {
  const userSnap = await getDoc(doc(db, 'users', uid));
  if (!userSnap.exists()) return [];
  const userData = userSnap.data();
  const friendUids = userData.friends || [];
  const mySharedAccess = userData.sharedAccess || [];
  const mySharedShopping = userData.sharedShoppingWith || [];
  const mySharedEatingOut = userData.sharedEatingOutWith || [];
  const friends = [];
  for (const fid of friendUids) {
    const fSnap = await getDoc(doc(db, 'users', fid));
    if (fSnap.exists()) {
      const data = fSnap.data();
      friends.push({
        uid: fid,
        username: data.username || '',
        displayName: data.displayName || '',
        email: data.email || '',
        hasGrantedAccess: (data.sharedAccess || []).includes(uid), // they shared with me
        iGrantedAccess: mySharedAccess.includes(fid), // I shared with them
        hasSharedShoppingWithMe: (data.sharedShoppingWith || []).includes(uid),
        iSharedShopping: mySharedShopping.includes(fid),
        hasSharedEatingOutWithMe: (data.sharedEatingOutWith || []).includes(uid),
        iSharedEatingOut: mySharedEatingOut.includes(fid),
        // How this friend has ranked MY restaurants — per-category top-3.
        // Shape: { [category]: [r1, r2, r3] }. Legacy `[r1, r2, r3]` is
        // bucketed under `__all` for backward compat.
        votesOnMyEatingOutByCategory: (() => {
          // Unified: a friend's ranking is a full ordered list per category in
          // `eatingOutVotes` (legacy `eatingOutOrder` merged for back-compat).
          // We surface the top 3 for the medal chips on my cards.
          const merged = {};
          const addFrom = (raw) => {
            if (Array.isArray(raw)) {
              const ids = raw.filter(x => typeof x === 'string');
              if (ids.length && !merged.__all) merged.__all = ids;
            } else if (raw && typeof raw === 'object') {
              for (const [cat, arr] of Object.entries(raw)) {
                if (Array.isArray(arr) && !merged[cat]) {
                  const ids = arr.filter(x => typeof x === 'string');
                  if (ids.length) merged[cat] = ids;
                }
              }
            }
          };
          addFrom(data.eatingOutVotes?.[uid]); // votes win
          addFrom(data.eatingOutOrder?.[uid]); // legacy order fills gaps
          const out = {};
          for (const [cat, ids] of Object.entries(merged)) {
            const t = ids.slice(0, 3);
            while (t.length < 3) t.push(null);
            if (t.some(x => x != null)) out[cat] = t;
          }
          return out;
        })(),
      });
    }
  }
  return friends;
}

// Legacy votes were stored as `{ [ownerUid]: [r1,r2,r3] }`. New shape is
// `{ [ownerUid]: { [category]: [r1,r2,r3] } }`. Reading auto-migrates the
// old shape under a synthetic `__all` category so prior picks aren't lost.
export const LEGACY_VOTE_CATEGORY = '__all';

// Unified ranking model: each (ownerUid, category) holds a FULL dense ordered
// list of restaurant ids — the table ▲▼ controls the whole order and the
// 🥇🥈🥉 medals are simply its top 3. Legacy top-3 arrays (which used null
// slots) collapse cleanly to a dense ordered list here.
function normalizeVotesMap(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [ownerUid, v] of Object.entries(raw)) {
    if (Array.isArray(v)) {
      const ids = v.filter(x => typeof x === 'string'); // drop null slots, keep order
      if (ids.length) out[ownerUid] = { [LEGACY_VOTE_CATEGORY]: ids };
    } else if (v && typeof v === 'object') {
      const byCat = {};
      for (const [cat, arr] of Object.entries(v)) {
        if (!Array.isArray(arr)) continue;
        const ids = arr.filter(x => typeof x === 'string');
        if (ids.length) byCat[cat] = ids;
      }
      if (Object.keys(byCat).length > 0) out[ownerUid] = byCat;
    }
  }
  return out;
}

// Fold the legacy separate `eatingOutOrder` field into a votes map (votes win
// per key) so rankings made in the Table view before unification still show.
function mergeOrderInto(votes, orderMap) {
  for (const [owner, byKey] of Object.entries(orderMap || {})) {
    votes[owner] = { ...byKey, ...(votes[owner] || {}) };
  }
  return votes;
}

/**
 * Read my own eating-out votes — `{ [ownerUid]: { [category]: [r1,r2,r3] } }`.
 * Used to populate the rank picker on shared lists and to drive the Next
 * Spots dashboard. Auto-migrates legacy `{ ownerUid: [...] }` shape.
 */
export async function loadMyEatingOutVotes(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return {};
    const data = snap.data();
    return mergeOrderInto(normalizeVotesMap(data.eatingOutVotes), normalizeOrderMap(data.eatingOutOrder));
  } catch {
    return {};
  }
}

/**
 * Set my medal rank (1, 2, 3, or null to clear) for a restaurant within a
 * (ownerUid, category) bucket — the medals are the top 3 of the unified full
 * order. "Set rank N" moves the spot to position N (others shift down); null
 * removes it from the ranking. Operates on the same dense ordered list the
 * Table view ▲▼ arrows reorder, so the two stay in lockstep.
 */
export async function setEatingOutVote(uid, ownerUid, category, restaurantId, rank) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const allVotes = mergeOrderInto(normalizeVotesMap(data.eatingOutVotes), normalizeOrderMap(data.eatingOutOrder));
  const byCat = { ...(allVotes[ownerUid] || {}) };
  let list = Array.isArray(byCat[category]) ? byCat[category].filter(id => id !== restaurantId) : [];
  if (rank === 1 || rank === 2 || rank === 3) {
    const idx = Math.min(rank - 1, list.length);
    list = [...list.slice(0, idx), restaurantId, ...list.slice(idx)];
  }
  if (list.length === 0) delete byCat[category];
  else byCat[category] = list;
  if (Object.keys(byCat).length === 0) delete allVotes[ownerUid];
  else allVotes[ownerUid] = byCat;
  await updateDoc(ref, { eatingOutVotes: allVotes });
}

// ── Eating-out manual ORDER (Table view ▲▼ ranking) ─────────────────────────
// The full ranking now lives in the unified `eatingOutVotes` field (the medals
// are its top 3). `normalizeOrderMap` still reads the legacy `eatingOutOrder`
// field for one-time migration of rankings made before unification.
function normalizeOrderMap(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [owner, byKey] of Object.entries(raw)) {
    if (!byKey || typeof byKey !== 'object') continue;
    const m = {};
    for (const [k, arr] of Object.entries(byKey)) {
      if (Array.isArray(arr)) {
        const ids = arr.filter(x => typeof x === 'string');
        if (ids.length) m[k] = ids;
      }
    }
    if (Object.keys(m).length) out[owner] = m;
  }
  return out;
}

/**
 * Persist the full ordered id list for one (ownerUid, dimensionKey) bucket —
 * the Table view ▲▼ reorder. Writes the unified `eatingOutVotes` field so the
 * List/mobile medals (top 3) reflect the same order.
 */
export async function saveEatingOutOrder(uid, ownerUid, key, ids) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const all = mergeOrderInto(normalizeVotesMap(data.eatingOutVotes), normalizeOrderMap(data.eatingOutOrder));
  const byKey = { ...(all[ownerUid] || {}) };
  const clean = (Array.isArray(ids) ? ids : []).filter(x => typeof x === 'string');
  if (clean.length > 0) byKey[key] = clean;
  else delete byKey[key];
  if (Object.keys(byKey).length === 0) delete all[ownerUid];
  else all[ownerUid] = byKey;
  await updateDoc(ref, { eatingOutVotes: all });
}

/**
 * Write a `restaurants` array onto any user's doc — used for the shared
 * Eating Out list where viewers (anyone in `sharedEatingOutWith`) can also
 * edit. Firestore rules must allow this; otherwise the write will reject.
 */
export async function saveOwnerRestaurants(ownerUid, restaurants) {
  if (!ownerUid) throw new Error('saveOwnerRestaurants: ownerUid required');
  const ref = doc(db, 'users', ownerUid);
  await setDoc(ref, { restaurants }, { merge: true });
}

/* ── Shared per-spot comments ────────────────────────────────────────────────
 * A top-level `eatingOutComments` collection both the spot's owner and anyone
 * they've shared their Eating Out list with can read AND write — so friends can
 * discuss a place regardless of who added it. A spot `id` is only unique within
 * one owner's list, so every comment is keyed by the (ownerUid, spotId) PAIR.
 *
 * Requires Firestore rules that allow authenticated users to read/write
 * `eatingOutComments` docs (see the rules block shared with the app owner).
 * Each doc: { ownerUid, spotId, authorUid, authorUsername, text, createdAt }.
 */
export function subscribeSpotComments(ownerUid, spotId, cb) {
  if (!ownerUid || !spotId) { cb([]); return () => {}; }
  const q = query(
    collection(db, 'eatingOutComments'),
    where('ownerUid', '==', ownerUid),
    where('spotId', '==', spotId),
  );
  return onSnapshot(
    q,
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Oldest first (chat order). createdAt is an ISO string.
      list.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
      cb(list);
    },
    () => cb([]), // rules not yet in place / offline — fail soft to empty
  );
}

export async function addSpotComment(ownerUid, spotId, { authorUid, authorUsername, text }) {
  const clean = (text || '').trim();
  if (!ownerUid || !spotId || !authorUid || !clean) return;
  await addDoc(collection(db, 'eatingOutComments'), {
    ownerUid,
    spotId,
    authorUid,
    authorUsername: authorUsername || '',
    text: clean.slice(0, 2000),
    createdAt: new Date().toISOString(),
  });
}

export async function deleteSpotComment(commentId) {
  if (!commentId) return;
  await deleteDoc(doc(db, 'eatingOutComments', commentId));
}

/**
 * Save the Eating Out master vocabulary lists (the curated Cuisines and
 * Categories a user manages from the ⚙ Settings panel). These seed the
 * autocomplete + sidebar; free-text tags on individual spots still work, so
 * this is a soft source of truth, not an enforced allow-list.
 */
export async function saveOwnerEatingOutLists(ownerUid, { cuisines, categories }) {
  if (!ownerUid) throw new Error('saveOwnerEatingOutLists: ownerUid required');
  const ref = doc(db, 'users', ownerUid);
  await setDoc(
    ref,
    {
      eatingOutCuisines: Array.isArray(cuisines) ? cuisines : [],
      eatingOutCategories: Array.isArray(categories) ? categories : [],
    },
    { merge: true },
  );
}

/**
 * Toggle sharing all recipes with a friend.
 * When enabled, the friend can browse all your recipes.
 */
export async function toggleRecipeAccess(uid, friendUid, grant) {
  const ref = doc(db, 'users', uid);
  if (grant) {
    await updateDoc(ref, { sharedAccess: arrayUnion(friendUid) });
  } else {
    await updateDoc(ref, { sharedAccess: arrayRemove(friendUid) });
  }
}

/**
 * Toggle sharing the current weekly shopping list (planned meals) with a friend.
 * When enabled, the friend can see your weeklyPlan recipes on their Shopping List page.
 */
export async function toggleShoppingShare(uid, friendUid, grant) {
  const ref = doc(db, 'users', uid);
  if (grant) {
    await updateDoc(ref, { sharedShoppingWith: arrayUnion(friendUid) });
  } else {
    await updateDoc(ref, { sharedShoppingWith: arrayRemove(friendUid) });
  }
}

/**
 * Toggle sharing your Eating Out list (restaurants) with a friend.
 * When enabled, the friend can see your restaurants read-only on their
 * Eating Out page.
 */
export async function toggleEatingOutShare(uid, friendUid, grant) {
  const ref = doc(db, 'users', uid);
  if (grant) {
    await updateDoc(ref, { sharedEatingOutWith: arrayUnion(friendUid) });
  } else {
    await updateDoc(ref, { sharedEatingOutWith: arrayRemove(friendUid) });
  }
}

/**
 * Read a friend's Eating Out (restaurants) list. Returns {} when the
 * friend hasn't shared with us — Firestore rules will block the read.
 */
export async function loadFriendEatingOut(friendUid) {
  try {
    const snap = await getDoc(doc(db, 'users', friendUid));
    if (!snap.exists()) return { restaurants: [], username: '' };
    const data = snap.data();
    return {
      restaurants: Array.isArray(data.restaurants) ? data.restaurants : [],
      username: data.username || data.displayName || '',
    };
  } catch {
    return { restaurants: [], username: '' };
  }
}

/**
 * Load a friend's weekly meal plan as a list of { id, title, servings } so the
 * recipient can render the shared shopping list. Best-effort recipe-title join:
 * if the friend hasn't also shared their recipes, titles fall back to a placeholder.
 */
export async function loadFriendShoppingList(friendUid) {
  const snap = await getDoc(doc(db, 'users', friendUid));
  if (!snap.exists()) return { meals: [], username: '' };
  const data = snap.data();
  const weeklyPlan = Array.isArray(data.weeklyPlan) ? data.weeklyPlan : [];
  const weeklyServings = data.weeklyServings || {};
  let recipes = [];
  try {
    const r = await loadFriendRecipes(friendUid);
    recipes = r.recipes || [];
  } catch { /* recipe titles unavailable; fall back below */ }
  const recipeById = new Map(recipes.map(r => [r.id, r]));
  const meals = weeklyPlan.map(id => {
    const r = recipeById.get(id);
    if (!r) {
      return { id, title: '(recipe unavailable)', servings: weeklyServings[id] ?? 1, category: '', ingredients: [] };
    }
    return {
      ...r,
      id,
      servings: weeklyServings[id] ?? r.servings ?? 1,
    };
  });
  return {
    username: data.username || data.displayName || '',
    meals,
    weeklyServings,
  };
}

/**
 * Look up a single recipe by id from a friend who has granted access.
 * Returns null if the recipe is gone or the read isn't permitted.
 */
export async function loadFriendRecipeById(friendUid, recipeId) {
  try {
    const r = await loadFriendRecipes(friendUid);
    return (r.recipes || []).find(x => x.id === recipeId) || null;
  } catch {
    return null;
  }
}

/**
 * Load recipes from a friend who has granted access.
 * Reads from the recipes subcollection (where active recipes live after migration),
 * falling back to the legacy main-doc field for un-migrated users.
 */
export async function loadFriendRecipes(friendUid) {
  const snap = await getDoc(doc(db, 'users', friendUid));
  if (!snap.exists()) return { recipes: [], username: '' };
  const data = snap.data();
  const subRecipes = await loadRecipesFromFirestore(friendUid);
  const recipes = subRecipes !== null ? subRecipes : (data.recipes || []);
  return {
    recipes,
    username: data.username || data.displayName || '',
  };
}

/**
 * Get the username for a given uid.
 */
export async function getUsername(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  return snap.data().username || null;
}

/* ── Recipe sharing functions ── */

// Mirror of mobile's RECIPE_MEASUREMENT_TO_GRAMS table — keep in sync.
const SHARE_MEAS_TO_GRAMS = {
  g: 1, grams: 1, gram: 1, gm: 1,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  cup: 140, cups: 140,
  tbsp: 15, tablespoon: 15, tablespoons: 15,
  tsp: 5, teaspoon: 5, teaspoons: 5,
  ml: 1, milliliter: 1, milliliters: 1, millilitre: 1,
  lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  piece: 100, pieces: 100, whole: 100, medium: 150, large: 200, small: 80,
  clove: 5, cloves: 5, slice: 30, slices: 30, can: 400, bunch: 50,
  pinch: 0.5, dash: 0.5, handful: 30,
};

const SHARE_NUTRIENT_FIELDS = [
  'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar',
  'saturatedFat', 'addedSugar', 'sodium', 'potassium',
  'calcium', 'iron', 'magnesium', 'zinc', 'vitaminB12', 'vitaminC',
  'leucine', 'omega3',
];

function computeShareIngredientNutrition(row, qty, measurement) {
  const gPer100 = parseFloat(row?.grams) || 100;
  const measGrams = SHARE_MEAS_TO_GRAMS[(measurement || '').toLowerCase()] || gPer100;
  const totalGrams = qty * measGrams;
  const scale = totalGrams / 100;
  const result = {};
  for (const f of SHARE_NUTRIENT_FIELDS) {
    const val = parseFloat(row?.[f]);
    if (!isNaN(val)) result[f] = val * scale;
  }
  return result;
}

/**
 * Embed per-ingredient nutrition + a per-serving macros snapshot, computed
 * against the sender's ingredient DB. Self-contains the recipe so a
 * recipient with an empty / mismatched ingredient DB still sees correct
 * macros when logging the meal.
 */
function enrichRecipeForShare(recipe, ingredientsDB) {
  const cleanRecipe = JSON.parse(JSON.stringify(recipe));
  const recipeServings = parseFloat(cleanRecipe?.servings) || 1;
  const totals = {};
  const enrichedIngredients = [];
  let any = false;
  for (const ing of cleanRecipe?.ingredients || []) {
    const dbRow = (ingredientsDB || []).find(
      i => (i.ingredient || '').toLowerCase().trim() === (ing.ingredient || '').toLowerCase().trim(),
    );
    if (dbRow) {
      const qty = parseFloat(ing.quantity) || 1;
      const ingNutrition = computeShareIngredientNutrition(dbRow, qty, ing.measurement || 'g');
      enrichedIngredients.push({ ...ing, nutrition: ingNutrition });
      for (const [k, v] of Object.entries(ingNutrition)) {
        if (typeof v === 'number') totals[k] = (totals[k] || 0) + v;
      }
      any = true;
    } else {
      enrichedIngredients.push(ing);
    }
  }
  if (any) {
    cleanRecipe.ingredients = enrichedIngredients;
    const macrosPerServing = {};
    for (const [k, v] of Object.entries(totals)) {
      macrosPerServing[k] = v / recipeServings;
    }
    cleanRecipe.macrosPerServing = macrosPerServing;
  }
  return cleanRecipe;
}

/**
 * Share a recipe with a friend. Creates a doc in sharedRecipes collection.
 * Recipe is enriched with per-ingredient nutrition and a per-serving macros
 * snapshot so it stays accurate for recipients regardless of their own
 * ingredient DB state.
 */
export async function shareRecipe(fromUid, toUid, fromUsername, recipe) {
  let ingredientsDB = [];
  try {
    // Lazy import to avoid bundler tangling at module-init time.
    const { loadIngredients } = await import('./ingredientsStore.js');
    ingredientsDB = loadIngredients() || [];
  } catch {}
  const enriched = enrichRecipeForShare(recipe, ingredientsDB);
  await addDoc(collection(db, 'sharedRecipes'), {
    from: fromUid,
    to: toUid,
    fromUsername,
    recipe: enriched,
    sharedAt: new Date().toISOString(),
  });
}

/**
 * Get all pending shared recipes addressed to a user.
 */
export async function getPendingSharedRecipes(uid) {
  const q = query(collection(db, 'sharedRecipes'), where('to', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Accept a shared recipe by deleting the share doc.
 */
export async function acceptSharedRecipe(docId) {
  await deleteDoc(doc(db, 'sharedRecipes', docId));
}

/**
 * Decline a shared recipe by deleting the share doc.
 */
export async function declineSharedRecipe(docId) {
  await deleteDoc(doc(db, 'sharedRecipes', docId));
}

/* ── Share a logged meal with a friend ── */

// Map current hour-of-day to a meal slot. Mirrors DailyTrackerPage's
// categoryToSlot for the "no category hint" case so an accepted share
// lands in a sensible slot for the recipient's local time.
function slotForCurrentHour() {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

// Strip the original entry of fields that only make sense for the sender
// (sender's id, sender's mealSlot/timestamp) and keep the nutrition
// snapshot so recipients see correct macros even if their ingredient DB
// differs. The recipient gets a fresh id, timestamp, and slot at accept
// time.
function snapshotMealForShare(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const {
    id: _id,
    timestamp: _ts,
    mealSlot: _ms,
    ...rest
  } = entry;
  return JSON.parse(JSON.stringify(rest));
}

/**
 * Share a logged meal entry with a friend. Writes to sharedMeals/{docId}.
 * Works for any entry type (recipe / custom_meal / ingredient) — on accept
 * the recipient gets it as a custom_meal copy with the nutrition snapshot
 * baked in.
 */
export async function shareMeal(fromUid, toUid, fromUsername, mealEntry) {
  const snapshot = snapshotMealForShare(mealEntry);
  if (!snapshot) throw new Error('shareMeal: no meal entry provided');
  await addDoc(collection(db, 'sharedMeals'), {
    from: fromUid,
    to: toUid,
    fromUsername,
    meal: snapshot,
    sharedAt: new Date().toISOString(),
  });
}

/**
 * Get all pending shared meals addressed to a user.
 */
export async function getPendingSharedMeals(uid) {
  const q = query(collection(db, 'sharedMeals'), where('to', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Accept a shared meal: append a custom_meal entry to the recipient's
 * dailyLog for today (in their local tz), then delete the share doc.
 * Returns the dateKey (YYYY-MM-DD) it was added to.
 */
export async function acceptSharedMeal(docId, meal, recipientUid) {
  const today = (() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  })();
  const entry = {
    ...meal,
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type: 'custom_meal',
    mealSlot: slotForCurrentHour(),
    timestamp: new Date().toISOString(),
  };
  const log = (await loadDailyLogFromFirestore(recipientUid)) || {};
  const day = log[today] || { entries: [] };
  const nextDay = { ...day, entries: [...(day.entries || []), entry] };
  const nextLog = { ...log, [today]: nextDay };
  await saveDailyLogToFirestore(recipientUid, nextLog);
  await deleteDoc(doc(db, 'sharedMeals', docId));
  return today;
}

/**
 * Decline a shared meal by deleting the share doc.
 */
export async function declineSharedMeal(docId) {
  await deleteDoc(doc(db, 'sharedMeals', docId));
}

/* ── Share-via-link functions ── */

/**
 * Create a shareable link for a recipe. Writes to sharedLinks/{token}.
 * Returns the random 10-char token.
 */
export async function createShareLink(uid, recipe) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 10; i++) token += chars[Math.floor(Math.random() * chars.length)];
  const cleanRecipe = JSON.parse(JSON.stringify(recipe));
  await setDoc(doc(db, 'sharedLinks', token), {
    recipe: cleanRecipe,
    createdBy: uid,
    createdAt: new Date().toISOString(),
  });
  return token;
}

/**
 * Load a shared recipe by token. Returns the recipe object or null.
 *
 * Tries the public /api/shared-recipe endpoint first so unauthenticated
 * external users can open a shared link. Falls back to a direct Firestore
 * read for signed-in users (or if the API call fails).
 */
export async function loadSharedRecipe(token) {
  try {
    const res = await fetch(`/api/shared-recipe?token=${encodeURIComponent(token)}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.recipe) return data.recipe;
    } else if (res.status === 404) {
      return null;
    }
    // Other errors (500, network): fall through to direct read
  } catch {
    // Network/etc. — fall through to direct read
  }
  try {
    const snap = await getDoc(doc(db, 'sharedLinks', token));
    if (!snap.exists()) return null;
    return snap.data().recipe;
  } catch {
    return null;
  }
}

/* ── Login tracking ── */

/**
 * Record a login event: increment loginCount, set lastLogin timestamp.
 */
export async function recordLogin(uid) {
  try {
    const ref = doc(db, 'users', uid);
    await setDoc(ref, {
      loginCount: increment(1),
      lastLogin: new Date().toISOString(),
    }, { merge: true });
  } catch (err) {
    console.error('recordLogin:', err);
  }
}

/* ── Admin: load all users ── */

/**
 * Load all user documents from Firestore (admin only).
 */
export async function loadAllUsers() {
  const snap = await getDocs(collection(db, 'users'));
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  // Recipes live in the users/{uid}/data/recipes subcollection now, so the main
  // doc's `recipes` field is empty ([]) for every migrated user — which made the
  // admin dashboard report 0 recipes. Backfill each user's recipes from the
  // subcollection (parallel; falls back to any legacy inline array) so counts,
  // source breakdowns and cleanup logic are accurate again.
  await Promise.all(users.map(async (u) => {
    try {
      const rSnap = await getDoc(doc(db, 'users', u.uid, 'data', 'recipes'));
      const sub = rSnap.exists() ? (rSnap.data().recipes || []) : null;
      if (Array.isArray(sub) && sub.length > 0) u.recipes = sub;
    } catch { /* keep any inline recipes */ }
  }));
  return users;
}

/**
 * Delete a user document from Firestore (admin cleanup).
 */
export async function deleteUserDoc(uid) {
  await deleteDoc(doc(db, 'users', uid));
}

/**
 * Save recipes for a new user setup (admin flow).
 * Stores recipes under pendingSetups/{normalizedEmail}.
 */
export async function savePendingSetup(email, recipes) {
  const key = email.toLowerCase().trim();
  const ref = doc(db, 'pendingSetups', key);
  await setDoc(ref, { recipes, createdAt: new Date().toISOString() });
}

/**
 * Load and consume pending setup for a user by email.
 * Returns recipes array or null. Deletes the doc after loading.
 */
export async function loadPendingSetup(email) {
  const key = email.toLowerCase().trim();
  const ref = doc(db, 'pendingSetups', key);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  await deleteDoc(ref);
  return data.recipes || [];
}
