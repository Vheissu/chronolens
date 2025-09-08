import { describe, it, expect } from 'vitest';
import { MyApp } from '../src/my-app';
import { createFixture } from '@aurelia/testing';

describe('my-app', () => {
  it('renders the top app bar and routes', async () => {
    const { appHost } = await createFixture('<my-app></my-app>', {}, [MyApp]).started;
    expect(appHost.textContent?.includes('Chronolens')).toBe(true);
    // Check that router viewport exists
    expect(appHost.querySelector('au-viewport')).toBeTruthy();
  });
});
