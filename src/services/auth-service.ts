import { DI } from '@aurelia/kernel';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  type IdTokenResult,
  type User,
} from 'firebase/auth';
import { auth } from '../core/firebase';
import { HttpClient, json } from '@aurelia/fetch-client';

export const IAuth = DI.createInterface<Auth>('IAuth', x => x.singleton(Auth));
export type IAuth = Auth;

export class Auth {
  private http = new HttpClient().configure(c => c.withBaseUrl((() => {
    try {
      const env = (import.meta as unknown as { env?: Record<string, string> }).env;
      return env?.VITE_API_BASE || '/api';
    } catch { return '/api'; }
  })()));

  private user: User | null = null;
  private loggedIn = false;

  constructor() {
    onAuthStateChanged(auth, (u) => {
      this.user = u;
      if (u) this.setLoggedIn(); else this.setLoggedOut();
    });
  }

  setLoggedIn(): void {
    this.loggedIn = true;
    this.ensureBilling().catch(() => { /* best-effort */ });
  }

  setLoggedOut(): void { this.loggedIn = false; }

  get isLoggedIn(): boolean { return this.loggedIn; }
  get currentUser(): User | null { return auth.currentUser; }

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

  async ensureBilling(): Promise<void> {
    try {
      const token = await this.getToken();
      await this.http.fetch('/billing/ensure', {
        method: 'POST',
        headers: token?.token ? { 'Authorization': `Bearer ${token.token}` } : undefined,
        body: json({}),
      });
    } catch { /* ignore */ }
  }
}
