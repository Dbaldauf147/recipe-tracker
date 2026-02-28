import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { auth, googleProvider, facebookProvider, appleProvider } from '../firebase';
import { loadUserData, migrateToFirestore, hydrateLocalStorage, saveField, recordLogin } from '../utils/firestoreSync';

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
  'sunday-nutrition-goals',
  'sunday-body-stats',
];

function clearAppStorage() {
  for (const key of APP_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}

/**
 * Build the remaining onboarding steps based on selected goals.
 * Always ends with 'recipe-setup'.
 */
function buildStepsFromGoals(goals) {
  const steps = [];
  if (goals.includes('daily_nutrition_goals')) steps.push('nutrition-goals');
  if (goals.includes('ingredient_variety')) steps.push('key-ingredients');
  steps.push('recipe-setup');
  return steps;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dataReady, setDataReady] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const isGuestRef = useRef(false);
  const [onboardingSteps, setOnboardingSteps] = useState([]);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [justOnboarded, setJustOnboarded] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);

  const currentOnboardingStep = onboardingSteps[0] || null;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Clear stale data from any previous user before loading
        clearAppStorage();
        setDataReady(false);

        // User signed in — load or migrate data
        const userData = await loadUserData(firebaseUser.uid);
        // Ensure email + displayName are saved to Firestore for search
        if (firebaseUser.email) {
          saveField(firebaseUser.uid, 'email', firebaseUser.email.toLowerCase());
        }
        if (firebaseUser.displayName) {
          saveField(firebaseUser.uid, 'displayName', firebaseUser.displayName);
        }
        recordLogin(firebaseUser.uid);
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

        // Determine onboarding state
        const hasOnboardingComplete = userData?.onboardingComplete === true;
        const hasKeyIngredients = userData?.keyIngredients?.length > 0;
        const hasGoals = userData?.userGoals != null;

        if (hasOnboardingComplete || hasKeyIngredients) {
          // Backwards compat: already completed onboarding
          setHasCompletedOnboarding(true);
          setOnboardingSteps([]);
          setCompletedSteps([]);
        } else if (hasGoals) {
          // Has goals but didn't finish — rebuild remaining steps
          const goals = userData.userGoals;
          const remaining = buildStepsFromGoals(goals);
          // Remove steps that are already done
          const hasNutritionGoals = userData?.nutritionGoals != null;
          const filtered = remaining.filter(s => {
            if (s === 'nutrition-goals' && hasNutritionGoals) return false;
            return true;
          });
          setOnboardingSteps(filtered);
          setCompletedSteps(['goals']);
        } else {
          setOnboardingSteps(['goals']);
          setCompletedSteps([]);
        }

        setUser(firebaseUser);
        setDataReady(true);
      } else if (!isGuestRef.current) {
        setUser(null);
        setDataReady(false);
        setOnboardingSteps([]);
        setCompletedSteps([]);
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

  async function signInWithFacebook() {
    try {
      setAuthError(null);
      await signInWithPopup(auth, facebookProvider);
    } catch (err) {
      console.error('Sign-in error:', err);
      setAuthError(err.message || 'Sign-in failed');
    }
  }

  async function signInWithApple() {
    try {
      setAuthError(null);
      await signInWithPopup(auth, appleProvider);
    } catch (err) {
      console.error('Sign-in error:', err);
      setAuthError(err.message || 'Sign-in failed');
    }
  }

  function advanceOnboarding() {
    setOnboardingSteps(prev => {
      const [current, ...rest] = prev;
      if (current) {
        setCompletedSteps(c => [...c, current]);
      }
      return rest;
    });
  }

  function goBackOnboarding() {
    setCompletedSteps(prev => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = next.pop();
      setOnboardingSteps(s => [last, ...s]);
      return next;
    });
  }

  async function completeGoals(goals) {
    localStorage.setItem('sunday-user-goals', JSON.stringify(goals));
    if (user) {
      await saveField(user.uid, 'userGoals', goals);
    }

    // Build the remaining step queue based on selected goals
    const remaining = buildStepsFromGoals(goals);

    // Replace the queue: remove 'goals' from front, set remaining
    setOnboardingSteps(remaining);
    setCompletedSteps(prev => [...prev, 'goals']);
  }

  function skipGoals() {
    // No goals selected — go straight to recipe-setup
    setOnboardingSteps(['recipe-setup']);
    setCompletedSteps(prev => [...prev, 'goals']);
  }

  async function completeNutritionGoals(targets, stats) {
    localStorage.setItem('sunday-nutrition-goals', JSON.stringify(targets));
    if (stats) localStorage.setItem('sunday-body-stats', JSON.stringify(stats));
    if (user) {
      await saveField(user.uid, 'nutritionGoals', targets);
      if (stats) await saveField(user.uid, 'bodyStats', stats);
    }
    advanceOnboarding();
  }

  async function completeKeyIngredients(ingredients) {
    localStorage.setItem('sunday-key-ingredients', JSON.stringify(ingredients));
    if (user) {
      const userData = await loadUserData(user.uid);
      if (!userData) {
        await migrateToFirestore(user.uid);
      }
      await saveField(user.uid, 'keyIngredients', ingredients);
    }
    advanceOnboarding();
  }

  async function completeRecipeSetup() {
    if (user) {
      await saveField(user.uid, 'onboardingComplete', true);
    }
    setHasCompletedOnboarding(true);
    setJustOnboarded(true);
    setOnboardingSteps([]);
    setCompletedSteps([]);
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

  function continueAsGuest() {
    isGuestRef.current = true;
    setIsGuest(true);
    setDataReady(true);
    setLoading(false);
    setHasCompletedOnboarding(false);
    setOnboardingSteps(['recipe-setup']);
    setCompletedSteps([]);
  }

  async function logOut() {
    clearAppStorage();
    if (isGuestRef.current) {
      isGuestRef.current = false;
      setIsGuest(false);
      setUser(null);
      setDataReady(false);
      setHasCompletedOnboarding(false);
      setOnboardingSteps([]);
      setCompletedSteps([]);
    } else {
      await signOut(auth);
    }
  }

  function restartOnboarding() {
    setOnboardingSteps(['goals']);
    setCompletedSteps([]);
    setJustOnboarded(false);
  }

  function cancelOnboarding() {
    setOnboardingSteps([]);
    setCompletedSteps([]);
  }

  const value = {
    user, loading, dataReady, isGuest, currentOnboardingStep, justOnboarded, hasCompletedOnboarding, authError,
    signInWithGoogle, signInWithFacebook, signInWithApple, signUpWithEmail, signInWithEmail, continueAsGuest, logOut,
    completeGoals, skipGoals, goBackOnboarding, advanceOnboarding,
    completeNutritionGoals, completeKeyIngredients, completeRecipeSetup,
    restartOnboarding, cancelOnboarding,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
