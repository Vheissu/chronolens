import { route } from '@aurelia/router';
import { IAuth } from './services/auth-service';
import { resolve } from 'aurelia';

@route({
  routes: [
    { path: ['', 'home'], component: () => import('./routes/home-page'), title: 'Home' },
    { path: 'login', component: () => import('./routes/login-page'), title: 'Login' },
    { path: ['dashboard','generate'], component: () => import('./routes/dashboard-page'), title: 'Generate' },
    { path: 'scene/:id', component: () => import('./routes/scene-page'), title: 'Scene' },
    { path: 'p/:id', component: () => import('./routes/public-page'), title: 'Share' },
    { path: 'scenes', component: () => import('./routes/scenes-page'), title: 'Scenes' },
    { path: 'about', component: () => import('./about-page'), title: 'About' },
  ],
  fallback: () => import('./missing-page'),
})
export class MyApp {
  public auth = resolve(IAuth);

  attaching() {
    // Initialize theme (persisted)
    try {
      const saved = (localStorage.getItem('theme') || '').toLowerCase();
      const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
      const dark = saved ? saved === 'dark' : prefersDark;
      this.applyTheme(dark);
    } catch { /* no-op */ }
  }

  toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-mdui-theme') === 'dark';
    const next = !isDark;
    this.applyTheme(next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
  }

  private applyTheme(dark: boolean) {
    if (dark) {
      document.documentElement.setAttribute('data-mdui-theme', 'dark');
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.removeAttribute('data-mdui-theme');
      document.documentElement.classList.remove('dark');
    }
  }
}
