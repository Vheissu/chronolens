import { route } from '@aurelia/router';
import { IAuth } from './services/auth-service';
import { resolve } from 'aurelia';

@route({
  routes: [
    { path: ['', 'home'], component: () => import('./routes/home-page'), title: 'Home' },
    { path: 'login', component: () => import('./routes/login-page'), title: 'Login' },
    { path: 'dashboard', component: () => import('./routes/dashboard-page'), title: 'Generate' },
    { path: 'history', component: () => import('./routes/history-page'), title: 'History' },
    { path: 'about', component: () => import('./about-page'), title: 'About' },
  ],
  fallback: () => import('./missing-page'),
})
export class MyApp {
  public auth = resolve(IAuth);
}
