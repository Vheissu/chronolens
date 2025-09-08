import { describe, it, expect } from 'vitest';
import { MyApp } from '../src/my-app';
import { createFixture } from '@aurelia/testing';
import { Registration, type IContainer } from 'aurelia';
import { IAuth } from '../src/services/auth-service';

describe('my-app', () => {
  it('renders the top app bar and routes', async () => {
    const { appHost } = await createFixture('<my-app></my-app>', {}, [MyApp]).started;
    expect(appHost.textContent?.includes('Chronolens')).toBe(true);
    // Check that router viewport exists
    expect(appHost.querySelector('au-viewport')).toBeTruthy();
  });

  it('hides Scenes link for anonymous users', async () => {
    class AuthAnonStub { isReady = true; isLoggedIn = true; isAnonymous = true; }
    const withAnon = (c: IContainer) => c.register(Registration.instance(IAuth, new AuthAnonStub() as unknown as import('../src/services/auth-service').Auth));
    const { appHost } = await createFixture('<my-app></my-app>', {}, [MyApp], withAnon).started;
    const text = appHost.textContent || '';
    expect(text.includes('Scenes')).toBe(false);
  });

  // Note: additional UI assertions for fully-authenticated state are covered in E2E.
});
