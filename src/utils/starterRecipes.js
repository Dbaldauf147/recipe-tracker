import { loadUserData } from './firestoreSync';

const ADMIN_UID = import.meta.env.VITE_ADMIN_UID;

/**
 * Load starter recipes from the admin's Firestore data.
 * Returns recipes where starterRecipe === true and frequency !== 'retired'.
 */
export async function loadStarterRecipes() {
  const data = await loadUserData(ADMIN_UID);
  const recipes = data?.recipes || [];
  return recipes.filter(
    r => r.starterRecipe === true && (r.frequency || 'common') !== 'retired'
  );
}
