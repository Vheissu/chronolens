import { lifecycleHooks, resolve } from 'aurelia';
import { IAuth } from '../services/auth-service';
import { authStateChanged } from './firebase';

@lifecycleHooks()
export class AuthHook {
  private auth: IAuth = resolve(IAuth);

  async canLoad(): Promise<boolean> {
    const user = await authStateChanged();
    if (user !== null) {
      this.auth.setLoggedIn();
    } else {
      this.auth.setLoggedOut();
    }
    return true; // allow navigation; components can redirect if needed
  }
}

