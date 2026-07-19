import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, sendPasswordResetEmail } from 'firebase/auth';
import { auth, googleProvider, facebookProvider, appleProvider } from '../firebase';
import { loadUserData, migrateToFirestore, hydrateLocalStorage, saveField, recordLogin, subscribeToUserData, loadPendingSetup, backupAllUserData } from '../utils/firestoreSync';
import { syncMealImages, clearImageCache } from '../utils/generateMealImage';
import { syncExerciseImages, clearExerciseImageCache } from '../utils/exerciseImages';

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
  'sunday-user-diet',
  'sunday-nutrition-goals',
  'sunday-body-stats',
  'sunday-weekly-servings',
  'sunday-daily-log',
  'sunday-weight-log',
  'sunday-weight-setup-done',
  'sunday-weight-cleanup-v2',
  'sunday-weight-cleanup-v3',
  'sunday-reminder-settings',
  'sunday-shopping-checked',
  'sunday-cat-layout',
  'sunday-hidden-categories',
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
  // weight-setup is inserted dynamically after nutrition-goals if user selected weight goal
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
  const firestoreUnsubRef = useRef(null);
  const [syncVersion, setSyncVersion] = useState(0);
  // ISO string from userData.deletedAtClient when soft-delete is pending; null otherwise.
  // Populated on initial load + kept fresh via the realtime subscription.
  const [deletionPendingAt, setDeletionPendingAt] = useState(null);

  const currentOnboardingStep = onboardingSteps[0] || null;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clean up previous Firestore listener
      if (firestoreUnsubRef.current) {
        firestoreUnsubRef.current();
        firestoreUnsubRef.current = null;
      }

      if (firebaseUser) {
        // Only clear storage when switching to a different user, not on token refresh
        const prevUid = localStorage.getItem('sunday-current-uid');
        if (prevUid && prevUid !== firebaseUser.uid) {
          clearAppStorage();
          clearImageCache();
          clearExerciseImageCache();
        }
        localStorage.setItem('sunday-current-uid', firebaseUser.uid);
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
        // Import any pending shared recipe before hydrating
        const PENDING_SHARE_KEY = 'sunday-pending-shared-recipe';
        let pendingRecipe = null;
        try {
          const raw = localStorage.getItem(PENDING_SHARE_KEY);
          if (raw) {
            pendingRecipe = JSON.parse(raw);
            localStorage.removeItem(PENDING_SHARE_KEY);
          }
        } catch {}

        // Always save email and display name to Firestore for friend request notifications
        if (firebaseUser.email) {
          saveField(firebaseUser.uid, 'email', firebaseUser.email).catch(() => {});
        }
        if (firebaseUser.displayName) {
          saveField(firebaseUser.uid, 'displayName', firebaseUser.displayName).catch(() => {});
        }

        if (userData) {
          // Existing Firestore data → hydrate localStorage
          hydrateLocalStorage(userData, firebaseUser.uid);
        } else {
          // First sign-in → push localStorage up to Firestore
          await migrateToFirestore(firebaseUser.uid);

          // Check for admin-prepared recipes for this email
          if (firebaseUser.email) {
            try {
              const pendingRecipes = await loadPendingSetup(firebaseUser.email);
              if (pendingRecipes && pendingRecipes.length > 0) {
                // Add IDs and save to user's account
                const withIds = pendingRecipes.map(r => ({
                  ...r,
                  id: r.id || crypto.randomUUID(),
                  createdAt: r.createdAt || new Date().toISOString(),
                }));
                localStorage.setItem('recipe-tracker-recipes', JSON.stringify(withIds));
                saveField(firebaseUser.uid, 'recipes', withIds);
              }
            } catch {}
          }

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

        // Sync meal images between Firestore and localStorage
        await syncMealImages(firebaseUser.uid).catch(() => {});
        // Sync user-uploaded custom exercise photos into the memory cache
        syncExerciseImages(firebaseUser.uid).catch(() => {});

        // Add pending shared recipe to user's recipes after hydration
        if (pendingRecipe) {
          try {
            const newRecipe = {
              ...pendingRecipe,
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
            };
            const existing = JSON.parse(localStorage.getItem('recipe-tracker-recipes') || '[]');
            const next = [newRecipe, ...existing];
            localStorage.setItem('recipe-tracker-recipes', JSON.stringify(next));
            saveField(firebaseUser.uid, 'recipes', next);
          } catch {}
        }

        // Determine onboarding state. An established user is anyone with the
        // explicit flag, with key ingredients chosen, OR with existing recipes
        // / weight history / body stats — those are unambiguous signals they
        // already finished setup once. Without the broader checks, a missing
        // `keyIngredients` field (which can happen if it gets cleared or
        // never written) drops returning users back into onboarding even
        // though they've used the app for months.
        const hasOnboardingComplete = userData?.onboardingComplete === true;
        const hasKeyIngredients = userData?.keyIngredients?.length > 0;
        const hasRecipes = Array.isArray(userData?.recipes) && userData.recipes.length > 0;
        const hasWeightLog = Array.isArray(userData?.weightLog) && userData.weightLog.length > 0;
        const hasBodyStats = userData?.bodyStats && Object.keys(userData.bodyStats).length > 0;
        const looksEstablished =
          hasOnboardingComplete || hasKeyIngredients || hasRecipes || hasWeightLog || hasBodyStats;
        const hasGoals = userData?.userGoals != null;

        if (looksEstablished) {
          // Already an active user — skip onboarding regardless of which
          // marker flag(s) survived.
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

        // Track soft-delete pending state — see the recovery banner in App.jsx.
        setDeletionPendingAt(userData?.deletedAtClient || null);

        // Start real-time sync — re-hydrate localStorage when another device writes
        firestoreUnsubRef.current = subscribeToUserData(firebaseUser.uid, (data) => {
          hydrateLocalStorage(data, firebaseUser.uid);
          // Keep deletion-pending state fresh too so cancel/re-mark from
          // another tab or device propagates without a reload.
          setDeletionPendingAt(data?.deletedAtClient || null);
          setSyncVersion(v => v + 1);
          // Notify hooks that localStorage was updated from remote
          window.dispatchEvent(new Event('firestore-sync'));
        });

        setUser(firebaseUser);
        setDataReady(true);

        // Daily safety snapshot of all user-doc fields. Throttled so it only
        // writes once per day per UID. Recipes are already snapshotted by
        // backupRecipes() in useRecipes; this fills the gap for everything
        // else (weightLog, bodyStats, nutritionGoals, keyIngredients, etc.)
        // so a future doc-level deletion can't take this stuff down again.
        try {
          const today = new Date().toISOString().slice(0, 10);
          const markerKey = `sunday-backup-full-${firebaseUser.uid}`;
          if (localStorage.getItem(markerKey) !== today) {
            // Defer slightly so initial sync has populated localStorage.
            setTimeout(() => {
              backupAllUserData(firebaseUser.uid).then(() => {
                localStorage.setItem(markerKey, today);
              });
            }, 5000);
          }
        } catch {}
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
      // Save diet preference if set
      try {
        const diet = JSON.parse(localStorage.getItem('sunday-user-diet'));
        if (diet?.length) await saveField(user.uid, 'userDiet', diet);
      } catch {}
      // Save location if set
      const loc = localStorage.getItem('sunday-user-location');
      if (loc) await saveField(user.uid, 'userLocation', loc);
      // Save focus if set
      try {
        const focus = localStorage.getItem('sunday-user-focus');
        if (focus) await saveField(user.uid, 'userFocus', JSON.parse(focus));
      } catch {}
    }

    // Build remaining onboarding steps based on selected goals
    const nextSteps = buildStepsFromGoals(goals);
    if (nextSteps.length > 0) {
      setOnboardingSteps(nextSteps);
      setCompletedSteps(prev => [...prev, 'goals']);
    } else {
      // No additional steps — complete onboarding
      if (user) {
        await saveField(user.uid, 'onboardingComplete', true);
      }
      setHasCompletedOnboarding(true);
      setOnboardingSteps([]);
      setCompletedSteps(prev => [...prev, 'goals']);
      setJustOnboarded(true);
    }
  }

  function skipGoals() {
    completeGoals([]);
  }

  async function completeNutritionGoals(targets, stats) {
    localStorage.setItem('sunday-nutrition-goals', JSON.stringify(targets));
    if (stats) {
      // Merge with existing body stats (don't overwrite goalWeight, weight log data)
      const existing = JSON.parse(localStorage.getItem('sunday-body-stats') || '{}');
      const merged = { ...existing, ...stats };
      localStorage.setItem('sunday-body-stats', JSON.stringify(merged));
      if (user) await saveField(user.uid, 'bodyStats', merged);
    }
    if (user) {
      await saveField(user.uid, 'nutritionGoals', targets);
    }
    // Skip weight-setup — weight is captured in Your Info, go straight to next step
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

  async function signUpWithEmail(email, password, name, username) {
    try {
      setAuthError(null);
      const { user: newUser } = await createUserWithEmailAndPassword(auth, email, password);
      if (name) {
        await updateProfile(newUser, { displayName: name });
      }
      // Save username if provided
      if (username && username.trim()) {
        try {
          const { setUsername } = await import('../utils/firestoreSync');
          await setUsername(newUser.uid, username.trim().toLowerCase());
        } catch {}
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

  async function resetPassword(email) {
    try {
      setAuthError(null);
      await sendPasswordResetEmail(auth, email);
      return true;
    } catch (err) {
      console.error('Password reset error:', err);
      setAuthError(err.message || 'Failed to send reset email');
      return false;
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
    clearImageCache();
    clearExerciseImageCache();
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

  /**
   * Soft delete: mark the account for deletion in 30 days but don't actually
   * delete anything. The user can sign back in within the window to cancel.
   * A scheduled Cloud Function (processSoftDeletes) does the real deletion
   * after the grace period.
   *
   * Behavior change history: previously this function performed an immediate
   * hard delete (deleteDoc + firebaseDeleteUser), which was irrecoverable.
   * The 2026-05-06 incident was traced to this exact path running silently
   * — the symptoms are auth record gone, main user doc gone, but
   * subcollections orphaned. 12 user accounts in this project showed that
   * pattern. Soft delete adds a 30-day undo window for any future case.
   */
  async function deleteAccount() {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    try {
      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      await setDoc(
        doc(db, 'users', currentUser.uid),
        {
          deletedAt: serverTimestamp(),
          deletedAtClient: new Date().toISOString(),
        },
        { merge: true },
      );
      // Sign the user out (this also clears localStorage via the existing
      // logOut path). Their data stays intact in Firestore.
      await signOut(auth);
    } catch (err) {
      console.error('Soft-delete error:', err);
      throw err;
    }
  }

  /**
   * Cancel a pending soft-delete by clearing the deletedAt fields on the
   * user doc. Called from the recovery banner when the user signs back in
   * within the 30-day window and wants to keep their account.
   */
  async function cancelDeletion() {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const { doc, updateDoc, deleteField } = await import('firebase/firestore');
    const { db } = await import('../firebase');
    await updateDoc(doc(db, 'users', currentUser.uid), {
      deletedAt: deleteField(),
      deletedAtClient: deleteField(),
    });
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
    user, loading, dataReady, syncVersion, isGuest, currentOnboardingStep, justOnboarded, hasCompletedOnboarding, authError, deletionPendingAt,
    signInWithGoogle, signInWithFacebook, signInWithApple, signUpWithEmail, signInWithEmail, resetPassword, continueAsGuest, logOut, deleteAccount, cancelDeletion,
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
