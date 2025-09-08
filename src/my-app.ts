import { route } from '@aurelia/router';
import { IAuth } from './services/auth-service';
import { resolve } from 'aurelia';
import { setTheme } from 'mdui';

@route({
  routes: [
    { path: ['', 'home'], component: () => import('./routes/home-page'), title: 'Home' },
    { path: 'login', component: () => import('./routes/login-page'), title: 'Login' },
    { path: ['dashboard','generate'], component: () => import('./routes/dashboard-page'), title: 'Generate' },
    { path: 'gallery', component: () => import('./routes/gallery-page'), title: 'Gallery' },
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
    // Initialize theme (persisted). Default: light.
    try {
      const saved = (localStorage.getItem('theme') || '').toLowerCase();
      const dark = saved === 'dark';
      this.applyTheme(dark);
    } catch { /* no-op */ }
  }

  toggleTheme() {
    const isDark = document.documentElement.classList.contains('mdui-theme-dark');
    const next = !isDark;
    this.applyTheme(next);
    try { localStorage.setItem('theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
  }

  private applyTheme(dark: boolean) {
    // Apply to <html> using MDUI's API and also Tailwind's dark class
    setTheme(dark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', dark);
  }
}
