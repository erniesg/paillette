import { describe, expect, it } from 'vitest';

import {
  createAuthorizationRequest,
  getSafeReturnTo,
  getWorkOSRuntimeConfig,
  isAccessTokenExpiringSoon,
} from '../workos-auth.server';

const env = {
  WORKOS_CLIENT_ID: 'client_test',
  WORKOS_API_KEY: 'sk_test_secret',
  WORKOS_REDIRECT_URI: 'https://paillette.test/callback',
  WORKOS_COOKIE_PASSWORD: 'a'.repeat(32),
};

describe('WorkOS server authentication', () => {
  it('keeps same-origin return paths and rejects external redirects', () => {
    expect(getSafeReturnTo('/ngs/search?q=blue')).toBe('/ngs/search?q=blue');
    expect(getSafeReturnTo('https://evil.example/steal')).toBe('/');
    expect(getSafeReturnTo('//evil.example/steal')).toBe('/');
    expect(getSafeReturnTo('javascript:alert(1)')).toBe('/');
  });

  it('fails closed when a required binding is absent', () => {
    expect(
      getWorkOSRuntimeConfig({
        cloudflare: { env: { ...env, WORKOS_API_KEY: undefined } },
      })
    ).toBeNull();
  });

  it('binds the WorkOS authorization request to a random state and PKCE challenge', async () => {
    const request = await createAuthorizationRequest(
      { cloudflare: { env } },
      'sign-up',
      '/ngs/search'
    );

    expect(request).not.toBeNull();
    expect(request?.authorizationUrl).toMatch(/^https:\/\/api\.workos\.com\/user_management\/authorize/);
    const url = new URL(request!.authorizationUrl);
    expect(url.searchParams.get('screen_hint')).toBe('sign-up');
    expect(url.searchParams.get('state')).toBe(request?.state);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(request?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('recognizes a near-expiry JWT whose payload is base64url encoded', () => {
    const payload = btoa(
      JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + 60,
        pad: 'ÿÿ',
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(payload).toMatch(/[-_]/);
    expect(isAccessTokenExpiringSoon(`header.${payload}.signature`)).toBe(true);
  });
});
