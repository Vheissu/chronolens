import { IAuth } from '../services/auth-service';
import { DI } from '@aurelia/kernel';
import { IRouter } from '@aurelia/router';

export class DashboardPage {
  static inject = [IAuth as unknown as DI.InterfaceSymbol<IAuth>, IRouter];
  constructor(private auth: IAuth, private router: IRouter) {}

  async canLoad(): Promise<boolean> {
    if (!this.auth.isLoggedIn) {
      await this.router.load('login');
      return false;
    }
    return true;
  }
}

