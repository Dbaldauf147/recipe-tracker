import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
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
  'sunday-user-goals',
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
          // Notify about new signup (fire-and-forget)
          fetch('/api/notify-signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: firebaseUser.email,
              name: firebaseUser.displayName,
            }),
          }).catch(() => {});
        }

        // Determine onboarding step
        const hasKeyIngredients = userData?.keyIngredients?.length > 0;
        const hasGoals = userData?.userGoals != null;
        if (hasKeyIngredients) {
          setOnboardingStep(null);
        } else if (hasGoals) {
          setOnboardingStep('ingredients');
        } else {
          setOnboardingStep('goals');
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

  async function completeGoals(goals) {
    localStorage.setItem('sunday-user-goals', JSON.stringify(goals));
    if (user) {
      await saveField(user.uid, 'userGoals', goals);
    }
    setOnboardingStep('ingredients');
  }

  function goBackToGoals() {
    setOnboardingStep('goals');
  }

  async function completeOnboarding(ingredients) {
    localStorage.setItem('sunday-key-ingredients', JSON.stringify(ingredients));
    if (user) {
      const userData = await loadUserData(user.uid);
      if (!userData) {
        await migrateToFirestore(user.uid);
      }
      await saveField(user.uid, 'keyIngredients', ingredients);
    }

    setJustOnboarded(true);
    setOnboardingStep(null);
  }

  async function signUpWithEmail(email, password, name) {
    try {
      setAuthError(null);
      const { user: newUser } = await createUserWithEmailAndPassword(auth, email, password);
      if (name) {
        await updateProfile(newUser, { displayName: name });
      }
      // onAuthStateChanged will handle migration, notify, and onboarding
    } catch (err) {
      console.error('Sign-up error:', err);
      setAuthError(err.message || 'Sign-up failed');
    }
  }

  async function signInWithEmail(email, password) {
    try {
      setAuthError(null);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error('Sign-in error:', err);
      setAuthError(err.message || 'Sign-in failed');
    }
  }

  async function logOut() {
    clearAppStorage();
    await signOut(auth);
  }

  const value = {
    user, loading, dataReady, onboardingStep, justOnboarded, authError,
    signInWithGoogle, signUpWithEmail, signInWithEmail, logOut, completeGoals, goBackToGoals, completeOnboarding,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
