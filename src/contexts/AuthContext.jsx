import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { loadUserData, migrateToFirestore, hydrateLocalStorage, saveField } from '../utils/firestoreSync';

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

const APP_STORAGE_KEYS = [
  'recipe-tracker-recipes',
  'sunday-weekly-plan',
  'sunday-plan-history',
  'sunday-grocery-staples',
  'sunday-pantry-spices',
  'sunday-pantry-sauces',
  'sunday-shop-extras',
  'sunday-shopping-selection',
  'sunday-nutrition-cache',
  'sunday-key-ingredients',
];

function clearAppStorage() {
  for (const key of APP_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dataReady, setDataReady] = useState(false);
  // null = done, 'ingredients' = step 1, 'recipes' = step 2
  const [onboardingStep, setOnboardingStep] = useState(null);
  const [justOnboarded, setJustOnboarded] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Clear stale data from any previous user before loading
        clearAppStorage();
        setDataReady(false);

        // User signed in — load or migrate data
        const userData = await loadUserData(firebaseUser.uid);
        if (userData) {
          // Existing Firestore data → hydrate localStorage
          hydrateLocalStorage(userData);
        } else {
          // First sign-in → push localStorage up to Firestore
          await migrateToFirestore(firebaseUser.uid);
        }

        // Determine onboarding step
        const hasKeyIngredients = userData?.keyIngredients?.length > 0;
        const hasRecipes = userData?.recipes?.length > 0;
        if (!hasKeyIngredients) {
          setOnboardingStep('ingredients');
        } else if (!hasRecipes) {
          setOnboardingStep('recipes');
        } else {
          setOnboardingStep(null);
        }

        setUser(firebaseUser);
        setDataReady(true);
      } else {
        setUser(null);
        setDataReady(false);
        setOnboardingStep(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const [authError, setAuthError] = useState(null);

  async function signInWithGoogle() {
    try {
      setAuthError(null);
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Sign-in error:', err);
      setAuthError(err.message || 'Sign-in failed');
    }
  }

  async function completeIngredientStep(ingredients) {
    localStorage.setItem('sunday-key-ingredients', JSON.stringify(ingredients));
    if (user) {
      // Ensure the user doc exists, then save keyIngredients
      const userData = await loadUserData(user.uid);
      if (!userData) {
        await migrateToFirestore(user.uid);
      }
      await saveField(user.uid, 'keyIngredients', ingredients);
    }
    setOnboardingStep('recipes');
  }

  async function completeRecipeStep(selectedRecipes) {
    if (selectedRecipes.length > 0) {
      // Give each recipe a new ID and timestamp for the user's collection
      const newRecipes = selectedRecipes.map(r => ({
        ...r,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      }));
      localStorage.setItem('recipe-tracker-recipes', JSON.stringify(newRecipes));
      if (user) {
        await saveField(user.uid, 'recipes', newRecipes);
      }
    }
    setJustOnboarded(true);
    setOnboardingStep(null);
  }

  async function logOut() {
    clearAppStorage();
    await signOut(auth);
  }

  const value = {
    user, loading, dataReady, onboardingStep, justOnboarded, authError,
    signInWithGoogle, logOut, completeIngredientStep, completeRecipeStep,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
