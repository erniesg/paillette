import { describe, expect, it } from 'vitest';

import {
  getSafeReturnTo,
  getWorkOSRuntimeConfig,
} from '../workos-auth.server';

describe('getSafeReturnTo', () => {
  it('keeps same-origin paths and rejects external or protocol-relative URLs', () => {
    expect(getSafeReturnTo('/ngs/search?q=blue')).toBe('/ngs/search?q=blue');
    expect(getSafeReturnTo('https://evil.example/steal')).toBe('/');
    expect(getSafeReturnTo('//evil.example/steal')).toBe('/');
    expect(getSafeReturnTo('javascript:alert(1)')).toBe('/');
  });
});

describe('getWorkOSRuntimeConfig', () => {
  it('reads a complete Cloudflare binding set without exposing secrets', () => {
    const config = getWorkOSRuntimeConfig({
      cloudflare: {
        env: {
          WORKOS_CLIENT_ID: 'client_prod',
          WORKOS_API_KEY: 'sk_prod_secret',
          WORKOS_REDIRECT_URI: 'https://paillette.berlayar.ai/callback',
          WORKOS_COOKIE_PASSWORD: 'a'.repeat(32),
        },
      },
    });

    expect(config).toEqual({
      clientId: 'client_prod',
      apiKey: 'sk_prod_secret',
      redirectUri: 'https://paillette.berlayar.ai/callback',
      cookiePassword: 'a'.repeat(32),
      cookieName: 'paillette-session',
    });
  });

  it('fails closed when any required binding is absent', () => {
    expect(
      getWorkOSRuntimeConfig({
        cloudflare: {
          env: {
            WORKOS_CLIENT_ID: 'client_prod',
            WORKOS_REDIRECT_URI: 'https://paillette.berlayar.ai/callback',
            WORKOS_COOKIE_PASSWORD: 'a'.repeat(32),
          },
        },
      })
    ).toBeNull();
  });
});
