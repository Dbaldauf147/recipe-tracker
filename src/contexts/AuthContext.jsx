import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { loadUserData, migrateToFirestore, hydrateLocalStorage } from '../utils/firestoreSync';

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
        setUser(firebaseUser);
        setDataReady(true);
      } else {
        setUser(null);
        setDataReady(false);
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

  async function logOut() {
    clearAppStorage();
    await signOut(auth);
  }

  const value = { user, loading, dataReady, authError, signInWithGoogle, logOut };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
