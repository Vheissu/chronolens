import { route } from '@aurelia/router';
import { IAuth } from './services/auth-service';
import { DI } from '@aurelia/kernel';

@route({
  routes: [
    { path: ['', 'home'], component: () => import('./routes/home-page'), title: 'Home' },
    { path: 'login', component: () => import('./routes/login-page'), title: 'Login' },
    { path: 'dashboard', component: () => import('./routes/dashboard-page'), title: 'Dashboard' },
    { path: 'about', component: () => import('./about-page'), title: 'About' },
  ],
  fallback: () => import('./missing-page'),
})
export class MyApp {
  static inject = [IAuth as unknown as DI.InterfaceSymbol<IAuth>];
  constructor(public auth: IAuth) {}
}
