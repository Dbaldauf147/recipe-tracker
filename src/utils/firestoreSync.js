import { doc, getDoc, setDoc, addDoc, deleteDoc, updateDoc, collection, query, where, getDocs, arrayUnion, arrayRemove, increment, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';

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
    await setDoc(ref, { log }, { merge: false });
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

export async function saveField(uid, field, value) {
  // Large fields go to separate subcollection docs to avoid the 1 MB user
  // doc limit. New ones added here as we hit the cap.
  if (field === 'recipes') {
    return saveRecipesToFirestore(uid, value);
  }
  if (field === 'workoutLog') {
    return saveWorkoutLogToFirestore(uid, value);
  }
  const ref = doc(db, 'users', uid);
  await setDoc(ref, { [field]: value }, { merge: true });
}

/** Save workout log to a separate Firestore document (avoids 1 MB user doc limit). */
export async function saveWorkoutLogToFirestore(uid, workouts) {
  const ref = doc(db, 'users', uid, 'data', 'workoutLog');
  await setDoc(ref, { workouts: workouts || [] }, { merge: false });
}

/** Load workout log from the separate subcollection doc. Returns null when
 *  the subcollection doc doesn't exist (caller should check the main user
 *  doc for legacy data and migrate). */
export async function loadWorkoutLogFromFirestore(uid) {
  try {
    const ref = doc(db, 'users', uid, 'data', 'workoutLog');
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data().workouts || [];
    return null;
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
  await setDoc(ref, { recipes }, { merge: false });
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

    // Load workoutLog from subcollection (or migrate from main doc).
    // Uses the same pattern — separate doc avoids the 1 MB user-doc cap.
    const subWorkouts = await loadWorkoutLogFromFirestore(uid);
    if (subWorkouts !== null) {
      data.workoutLog = subWorkouts;
    } else if (Array.isArray(data.workoutLog) && data.workoutLog.length > 0) {
      try {
        await saveWorkoutLogToFirestore(uid, data.workoutLog);
        await setDoc(ref, { workoutLog: [] }, { merge: true });
      } catch (migErr) {
        console.error('Workout migration error:', migErr);
      }
    }

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
    const selection = localStorage.getItem('sunday-shopping-selection');
    if (selection) data.shoppingSelection = JSON.parse(selection);
  } catch {}

  try {
    const weeklyServings = localStorage.getItem('sunday-weekly-servings');
    if (weeklyServings) data.weeklyServings = JSON.parse(weeklyServings);
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
  localStorage.setItem('sunday-weekly-plan', JSON.stringify(userData.weeklyPlan || []));
  localStorage.setItem('sunday-plan-history', JSON.stringify(userData.planHistory || []));
  localStorage.setItem('sunday-grocery-staples', JSON.stringify(userData.groceryStaples || []));
  localStorage.setItem('sunday-pantry-spices', JSON.stringify(userData.pantrySpices || []));
  localStorage.setItem('sunday-pantry-sauces', JSON.stringify(userData.pantrySauces || []));
  localStorage.setItem('sunday-pantry-snacks', JSON.stringify(userData.pantrySnacks || []));
  localStorage.setItem('sunday-pantry-fruit', JSON.stringify(userData.pantryFruit || []));
  localStorage.setItem('sunday-shop-extras', JSON.stringify(userData.shopExtras || []));
  localStorage.setItem('sunday-shopping-selection', JSON.stringify(userData.shoppingSelection || []));
  localStorage.setItem('sunday-weekly-servings', JSON.stringify(userData.weeklyServings || {}));

  if (userData.keyIngredients) {
    localStorage.setItem('sunday-key-ingredients', JSON.stringify(userData.keyIngredients));
  }

  if (userData.nutritionGoals) {
    localStorage.setItem('sunday-nutrition-goals', JSON.stringify(userData.nutritionGoals));
  }

  if (userData.bodyStats) {
    localStorage.setItem('sunday-body-stats', JSON.stringify(userData.bodyStats));
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

  if (userData.weightLog) {
    localStorage.setItem('sunday-weight-log', JSON.stringify(userData.weightLog));
  }

  if (userData.workoutLog) {
    localStorage.setItem('sunday-workout-log', JSON.stringify(userData.workoutLog));
  }

  if (userData.exerciseLibrary) {
    localStorage.setItem('sunday-exercise-library', JSON.stringify(userData.exerciseLibrary));
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
  const d = snap.docs[0];
  const data = d.data();
  return { uid: d.id, username: data.username || '', email: lower, displayName: data.displayName || '' };
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
 */
export async function sendFriendRequest(fromUid, toUid, fromUsername, message) {
  const data = {
    from: fromUid,
    to: toUid,
    fromUsername,
    status: 'pending',
  };
  if (message) data.message = message;
  await addDoc(collection(db, 'friendRequests'), data);
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
      });
    }
  }
  return friends;
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

/**
 * Share a recipe with a friend. Creates a doc in sharedRecipes collection.
 */
export async function shareRecipe(fromUid, toUid, fromUsername, recipe) {
  await addDoc(collection(db, 'sharedRecipes'), {
    from: fromUid,
    to: toUid,
    fromUsername,
    recipe,
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
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
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
