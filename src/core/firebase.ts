import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, type IdTokenResult } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Chronolens Firebase configuration (public client config)
const firebaseConfig = {
  apiKey: 'AIzaSyAgiXrgJw2t-IUIA6hMh1gakWhI3_75RDk',
  authDomain: 'chronolens-a4ab6.firebaseapp.com',
  projectId: 'chronolens-a4ab6',
  storageBucket: 'chronolens-a4ab6.firebasestorage.app',
  messagingSenderId: '632850262774',
  appId: '1:632850262774:web:b7e35942610fad3d13dad7',
  measurementId: 'G-4WSP2BKKNP',
} as const;

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Helper: await first auth state emission with a fresh token
export async function authStateChanged(): Promise<{ user: unknown; token: IdTokenResult | null } | null> {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        const token = (await auth.currentUser?.getIdTokenResult(true)) ?? null;
        try { unsub(); } catch { /* ignore */ }
        if (user) {
          resolve({ user, token });
        } else {
          resolve(null);
        }
      } catch {
        try { unsub(); } catch { /* ignore */ }
        resolve(null);
      }
    });
  });
}

