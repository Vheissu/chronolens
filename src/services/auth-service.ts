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

  constructor() {
    onAuthStateChanged(auth, (u) => {
      this.user = u;
      if (u) this.setLoggedIn(); else this.setLoggedOut();
      if (!u && !this.triedAnonymous) {
        // Seamless guest access for hackathon demo
        this.triedAnonymous = true;
        try { void signInAnonymously(auth); } catch { /* ignore */ }
      }
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
