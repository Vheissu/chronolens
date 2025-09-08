import { DI } from '@aurelia/kernel';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInAnonymously,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  type IdTokenResult,
  type User,
} from 'firebase/auth';
import { auth } from '../core/firebase';
// no-op

export const IAuth = DI.createInterface<Auth>('IAuth', x => x.singleton(Auth));
export type IAuth = Auth;

export class Auth {
  private user: User | null = null;
  private loggedIn = false;
  private triedAnonymous = false;
  // Exposed to views to avoid flicker until auth settles
  public isReady = false;

  constructor() {
    onAuthStateChanged(auth, async (u) => {
      this.user = u;
      if (u) {
        // We have a user (persisted or just created anonymously)
        this.setLoggedIn();
        this.isReady = true;
        return;
      }

      // No user yet: attempt seamless anonymous sign-in once.
      if (!this.triedAnonymous) {
        this.triedAnonymous = true;
        try {
          await signInAnonymously(auth);
          // Wait for the next onAuthStateChanged emission to set isReady.
          return;
        } catch {
          // If anonymous sign-in fails (e.g., offline / rules), consider auth settled.
          this.setLoggedOut();
          this.isReady = true;
          return;
        }
      }

      // Already tried anonymous and still no user: mark as settled to avoid indefinite loading.
      this.setLoggedOut();
      this.isReady = true;
    });
  }

  setLoggedIn(): void {
    this.loggedIn = true;
  }

  setLoggedOut(): void { this.loggedIn = false; }

  get isLoggedIn(): boolean { return this.loggedIn; }
  get currentUser(): User | null { return auth.currentUser; }
  get isAnonymous(): boolean { return !!auth.currentUser?.isAnonymous; }

  async getToken(): Promise<IdTokenResult | undefined> {
    return auth.currentUser?.getIdTokenResult(true);
  }

  async signOut(): Promise<void> { await auth.signOut(); this.setLoggedOut(); }

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch {
      await signInWithRedirect(auth, provider);
    }
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(auth, email, password);
  }

  async registerWithEmail(email: string, password: string): Promise<void> {
    await createUserWithEmailAndPassword(auth, email, password);
  }

  async sendPasswordReset(email: string): Promise<void> {
    await sendPasswordResetEmail(auth, email);
  }

}
