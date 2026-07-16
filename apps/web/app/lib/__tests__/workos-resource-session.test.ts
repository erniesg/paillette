import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authkitLoaderMock } = vi.hoisted(() => ({
  authkitLoaderMock: vi.fn(),
}));

vi.mock('@workos-inc/authkit-remix', () => ({
  authLoader: vi.fn(),
  authkitLoader: authkitLoaderMock,
  configure: vi.fn(),
  getSignInUrl: vi.fn(),
  getSignUpUrl: vi.fn(),
  signOut: vi.fn(),
}));

import { withWorkOSResourceSession } from '../workos-auth.server';

const args = {
  context: {
    cloudflare: {
      env: {
        WORKOS_CLIENT_ID: 'client_test',
        WORKOS_API_KEY: 'sk_test_secret',
        WORKOS_REDIRECT_URI: 'https://paillette.test/callback',
        WORKOS_COOKIE_PASSWORD: 'a'.repeat(32),
      },
    },
  },
  params: {},
  request: new Request('https://paillette.test/api/backend/orgs'),
} as any;

describe('withWorkOSResourceSession', () => {
  beforeEach(() => {
    authkitLoaderMock.mockImplementation(
      async (_args: unknown, loader: (input: unknown) => Promise<unknown>) => {
        const loaderData = (await loader({
          auth: { user: null },
          getAccessToken: () => null,
        })) as Record<string, unknown>;

        return {
          type: 'DataWithResponseInit',
          data: { ...loaderData, user: null, sessionId: null },
          init: { headers: { 'Set-Cookie': 'paillette-session=refreshed' } },
        };
      }
    );
  });

  it('preserves a resource response status, body, headers, and refresh cookie', async () => {
    const response = await withWorkOSResourceSession(args, async () =>
      Response.json(
        {
          success: false,
          error: { code: 'AUTHENTICATION_REQUIRED' },
        },
        {
          status: 401,
          headers: { 'X-Paillette-Search-Access': 'locked' },
        }
      )
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('X-Paillette-Search-Access')).toBe('locked');
    expect(response.headers.get('Set-Cookie')).toBe(
      'paillette-session=refreshed'
    );
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
  });
});
