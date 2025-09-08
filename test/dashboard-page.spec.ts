import { describe, it, expect } from 'vitest';
import { createFixture } from '@aurelia/testing';
import { DashboardPage } from '../src/routes/dashboard-page';
import { Registration, type IContainer } from 'aurelia';
import { IRouter } from '@aurelia/router';
import { IScenes, type Variant } from '../src/services/scene-service';
import { IAuth } from '../src/services/auth-service';

class AuthStub {
  isLoggedIn = true;
  setLoggedIn() {}
  setLoggedOut() {}
  get currentUser() { return null; }
}

class ScenesStub {
  async createScene() { return 'scene1'; }
  async uploadOriginal() { return { path: 'scenes/scene1/original.jpg', width: 100, height: 100, contentType: 'image/jpeg' }; }
  async setOriginalMeta() {}
  async renderEra(): Promise<{ url: string; record: { variant: Variant; gsUri: string; width?: number; height?: number; sha256?: string } }>{
    return { url: 'about:blank', record: { variant: 'balanced', gsUri: 'gs://bucket/scenes/scene1/renders/1920/balanced.jpg' } };
  }
}

function withStubs(container: IContainer) {
  container.register(Registration.instance(IAuth, new AuthStub() as unknown as import('../src/services/auth-service').Auth));
  container.register(Registration.instance(IScenes, new ScenesStub() as unknown as import('../src/services/scene-service').SceneService));
  const routerStub: Pick<import('@aurelia/router').IRouter, 'load'> = { load: async () => {} };
  container.register(Registration.instance(IRouter, routerStub as unknown as import('@aurelia/router').IRouter));
}

describe('dashboard-page', () => {
  it('shows upload and era controls', async () => {
    const { appHost } = await createFixture('<dashboard-page></dashboard-page>', {}, [DashboardPage], withStubs).started;
    const text = appHost.textContent || '';
    expect(text.includes('Upload photo')).toBe(true);
    expect(text.includes('Era')).toBe(true);
    // Ensure no legacy overlays label remains
    expect(text.includes('Design overlays')).toBe(false);
  });
});
