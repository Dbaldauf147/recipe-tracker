import { doc, getDoc, setDoc, addDoc, deleteDoc, updateDoc, collection, query, where, getDocs, arrayUnion, arrayRemove, increment, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Save a single field to the user's Firestore document.
 * Merges so other fields are not overwritten.
 */
export async function saveField(uid, field, value) {
  try {
    const ref = doc(db, 'users', uid);
    await setDoc(ref, { [field]: value }, { merge: true });
  } catch (err) {
    console.error(`Firestore saveField(${field}):`, err);
  }
}

/**
 * Load the entire user document from Firestore.
 * Returns null if the document doesn't exist.
 */
export async function loadUserData(uid) {
  try {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
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

  try {
    const recipes = localStorage.getItem('recipe-tracker-recipes');
    if (recipes) data.recipes = JSON.parse(recipes);
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
export function hydrateLocalStorage(userData) {
  if (!userData) return;

  localStorage.setItem('recipe-tracker-recipes', JSON.stringify(userData.recipes || []));
  localStorage.setItem('sunday-weekly-plan', JSON.stringify(userData.weeklyPlan || []));
  localStorage.setItem('sunday-plan-history', JSON.stringify(userData.planHistory || []));
  localStorage.setItem('sunday-grocery-staples', JSON.stringify(userData.groceryStaples || []));
  localStorage.setItem('sunday-pantry-spices', JSON.stringify(userData.pantrySpices || []));
  localStorage.setItem('sunday-pantry-sauces', JSON.stringify(userData.pantrySauces || []));
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

  // Only hydrate dailyLog if not currently being edited locally
  if (userData.dailyLog && !window.__dailyLogLocalEdit) {
    localStorage.setItem('sunday-daily-log', JSON.stringify(userData.dailyLog));
  }

  if (userData.userGoals) {
    localStorage.setItem('sunday-user-goals', JSON.stringify(userData.userGoals));
  }

  if (userData.userDiet) {
    localStorage.setItem('sunday-user-diet', JSON.stringify(userData.userDiet));
  }

  if (userData.userLocation) {
    localStorage.setItem('sunday-user-location', userData.userLocation);
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
  const ref = doc(db, 'users', uid);
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      // Only process server-originated changes
      if (!snap.metadata.hasPendingWrites) {
        onChange(snap.data());
      }
    }
  }, (err) => {
    console.error('Firestore subscription error:', err);
  });
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
  return { uid: foundUid, username: lower, email };
}

/**
 * Look up a user by email address. Returns { uid, username, email } or null.
 */
export async function searchByEmail(email) {
  const lower = email.toLowerCase();
  const q = query(collection(db, 'users'), where('email', '==', lower));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data();
  return { uid: d.id, username: data.username || '', email: lower };
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
 * Load recipes from a friend who has granted access.
 */
export async function loadFriendRecipes(friendUid) {
  const snap = await getDoc(doc(db, 'users', friendUid));
  if (!snap.exists()) return { recipes: [], username: '' };
  const data = snap.data();
  return {
    recipes: data.recipes || [],
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
 */
export async function loadSharedRecipe(token) {
  const snap = await getDoc(doc(db, 'sharedLinks', token));
  if (!snap.exists()) return null;
  return snap.data().recipe;
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
