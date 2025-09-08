import { IAuth } from '../services/auth-service';
import { DI } from '@aurelia/kernel';

export class LoginPage {
  static inject = [IAuth as unknown as DI.InterfaceSymbol<IAuth>];
  constructor(public auth: IAuth) {}

  email = '';
  password = '';
  mode: 'sign-in' | 'register' = 'sign-in';
  busy = false;
  error: string | null = null;

  async submit(): Promise<void> {
    this.error = null;
    this.busy = true;
    try {
      if (this.mode === 'sign-in') {
        await this.auth.signInWithEmail(this.email, this.password);
      } else {
        await this.auth.registerWithEmail(this.email, this.password);
      }
    } catch (e) {
      this.error = (e as Error).message || 'Authentication failed';
    } finally {
      this.busy = false;
    }
  }
}

