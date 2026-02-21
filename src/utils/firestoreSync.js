import { doc, getDoc, setDoc } from 'firebase/firestore';
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
 */
export function hydrateLocalStorage(userData) {
  if (!userData) return;

  if (userData.recipes) {
    localStorage.setItem('recipe-tracker-recipes', JSON.stringify(userData.recipes));
  }
  if (userData.weeklyPlan) {
    localStorage.setItem('sunday-weekly-plan', JSON.stringify(userData.weeklyPlan));
  }
  if (userData.planHistory) {
    localStorage.setItem('sunday-plan-history', JSON.stringify(userData.planHistory));
  }
  if (userData.groceryStaples) {
    localStorage.setItem('sunday-grocery-staples', JSON.stringify(userData.groceryStaples));
  }
  if (userData.pantrySpices) {
    localStorage.setItem('sunday-pantry-spices', JSON.stringify(userData.pantrySpices));
  }
  if (userData.pantrySauces) {
    localStorage.setItem('sunday-pantry-sauces', JSON.stringify(userData.pantrySauces));
  }
}
