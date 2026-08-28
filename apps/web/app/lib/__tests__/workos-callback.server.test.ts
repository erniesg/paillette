import { beforeEach, describe, expect, it, vi } from 'vitest';

const workos = vi.hoisted(() => ({
  authenticateWithCode: vi.fn(),
  authenticateWithRefreshToken: vi.fn(),
  authenticateWithSessionCookie: vi.fn(),
  getSessionFromCookie: vi.fn(),
  getAuthorizationUrlWithPKCE: vi.fn(),
  loadSealedSession: vi.fn(),
}));

vi.mock('@workos-inc/node', () => ({
  WorkOS: class {
    userManagement = workos;
  },
}));

import {
  handleWorkOSCallback,
  handleWorkOSSignOut,
  startWorkOSAuthorization,
  withWorkOSSession,
} from '../workos-auth.server';

const context = {
  cloudflare: {
    env: {
      WORKOS_CLIENT_ID: 'client_test',
      WORKOS_API_KEY: 'sk_test_secret',
      WORKOS_REDIRECT_URI: 'https://paillette.test/callback',
      WORKOS_COOKIE_PASSWORD: 'a'.repeat(32),
    },
  },
};

const authArgs = (request: Request) => ({ context, params: {}, request }) as any;

describe('WorkOS callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workos.getAuthorizationUrlWithPKCE.mockResolvedValue({
      url: 'https://api.workos.com/user_management/authorize?state=expected-state',
      state: 'expected-state',
      codeVerifier: 'verifier'.repeat(8),
    });
    workos.authenticateWithCode.mockResolvedValue({
      accessToken: 'token',
      sealedSession: 'sealed-session',
      user: { id: 'user_01', email: 'ada@example.com' },
    });
    workos.loadSealedSession.mockReturnValue({
      getLogoutUrl: vi.fn().mockResolvedValue('https://api.workos.com/user_management/logout'),
    });
  });

  it('rejects a callback whose state is not bound to the signed transaction cookie', async () => {
    const started = await startWorkOSAuthorization(
      authArgs(new Request('https://paillette.test/auth/start?screen=sign-in')),
      'sign-in',
      '/ngs/search'
    );
    const callback = await handleWorkOSCallback(
      authArgs(
        new Request('https://paillette.test/callback?code=code&state=attacker-state', {
          headers: { Cookie: started.headers.get('Set-Cookie')! },
        })
      )
    );

    expect(callback.status).toBe(400);
    expect(workos.authenticateWithCode).not.toHaveBeenCalled();
  });

  it('clears the transaction when a callback is missing its code or state', async () => {
    const started = await startWorkOSAuthorization(
      authArgs(new Request('https://paillette.test/auth/start')),
      'sign-in'
    );
    const callback = await handleWorkOSCallback(
      authArgs(
        new Request('https://paillette.test/callback?state=expected-state', {
          headers: { Cookie: started.headers.get('Set-Cookie')! },
        })
      )
    );

    expect(callback.status).toBe(400);
    expect(callback.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('rejects a tampered transaction cookie before exchanging the authorization code', async () => {
    const started = await startWorkOSAuthorization(
      authArgs(new Request('https://paillette.test/auth/start')),
      'sign-in'
    );
    const cookie = started.headers.get('Set-Cookie')!.replace(
      /paillette-auth-transaction=([^;]+)/,
      (_match, value: string) =>
        `paillette-auth-transaction=${value.slice(0, -1)}${
          value.endsWith('a') ? 'b' : 'a'
        }`
    );
    const callback = await handleWorkOSCallback(
      authArgs(
        new Request('https://paillette.test/callback?code=code&state=expected-state', {
          headers: { Cookie: cookie },
        })
      )
    );

    expect(callback.status).toBe(400);
    expect(workos.authenticateWithCode).not.toHaveBeenCalled();
  });

  it('exchanges a matching callback code with the stored PKCE verifier and clears the transaction', async () => {
    const started = await startWorkOSAuthorization(
      authArgs(new Request('https://paillette.test/auth/start?screen=sign-up')),
      'sign-up',
      '/ngs/search'
    );
    const callback = await handleWorkOSCallback(
      authArgs(
        new Request('https://paillette.test/callback?code=code&state=expected-state', {
          headers: { Cookie: started.headers.get('Set-Cookie')! },
        })
      )
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get('Location')).toBe('/ngs/search');
    expect(workos.authenticateWithCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'code', codeVerifier: 'verifier'.repeat(8) })
    );
    expect(callback.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('rejects a replay after the successful callback consumes its transaction', async () => {
    const started = await startWorkOSAuthorization(
      authArgs(new Request('https://paillette.test/auth/start')),
      'sign-in'
    );
    const completed = await handleWorkOSCallback(
      authArgs(
        new Request('https://paillette.test/callback?code=code&state=expected-state', {
          headers: { Cookie: started.headers.get('Set-Cookie')! },
        })
      )
    );
    const replay = await handleWorkOSCallback(
      authArgs(
        new Request('https://paillette.test/callback?code=code&state=expected-state', {
          headers: { Cookie: completed.headers.get('Set-Cookie')! },
        })
      )
    );

    expect(replay.status).toBe(400);
    expect(workos.authenticateWithCode).toHaveBeenCalledTimes(1);
  });

  it('keeps a verified session usable when a proactive refresh has a transient failure', async () => {
    const started = await startWorkOSAuthorization(
      authArgs(new Request('https://paillette.test/auth/start')),
      'sign-in'
    );
    const callback = await handleWorkOSCallback(
      authArgs(
        new Request('https://paillette.test/callback?code=code&state=expected-state', {
          headers: { Cookie: started.headers.get('Set-Cookie')! },
        })
      )
    );
    const sessionCookie = callback.headers
      .get('Set-Cookie')!
      .match(/paillette-session=[^;]+/)![0];
    const expiringToken = `header.${btoa(
      JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })
    )}.signature`;

    workos.authenticateWithSessionCookie.mockResolvedValue({
      authenticated: true,
      accessToken: expiringToken,
      user: { id: 'user_01', email: 'ada@example.com' },
    });
    workos.getSessionFromCookie.mockResolvedValue({ refreshToken: 'refresh' });
    workos.authenticateWithRefreshToken.mockRejectedValue(new Error('timeout'));

    const response = await withWorkOSSession(
      authArgs(
        new Request('https://paillette.test/nga/search', {
          headers: { Cookie: sessionCookie },
        })
      ),
      (session) => Response.json(session)
    );

    expect(await response.json()).toEqual({
      accessToken: expiringToken,
      user: { id: 'user_01', email: 'ada@example.com' },
    });
  });

  it('rejects a cross-site logout POST', async () => {
    const response = await handleWorkOSSignOut(
      authArgs(
        new Request('https://paillette.test/auth/logout', {
          method: 'POST',
          headers: { Origin: 'https://evil.example' },
        })
      )
    );

    expect(response.status).toBe(403);
  });

  it('clears the fixed local session when WorkOS configuration is unavailable', async () => {
    const started = await startWorkOSAuthorization(
      authArgs(new Request('https://paillette.test/auth/start')),
      'sign-in'
    );
    const callback = await handleWorkOSCallback(
      authArgs(
        new Request('https://paillette.test/callback?code=code&state=expected-state', {
          headers: { Cookie: started.headers.get('Set-Cookie')! },
        })
      )
    );
    const sessionCookie = callback.headers
      .get('Set-Cookie')!
      .match(/paillette-session=[^;]+/)![0];
    const response = await handleWorkOSSignOut({
      context: { cloudflare: { env: {} } },
      params: {},
      request: new Request('https://paillette.test/auth/logout', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          Origin: 'https://paillette.test',
        },
      }),
    } as any);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/');
    expect(response.headers.get('Set-Cookie')).toEqual(
      expect.stringContaining('paillette-session=;')
    );
    expect(response.headers.get('Set-Cookie')).toEqual(expect.stringContaining('Max-Age=0'));
    expect(response.headers.get('Set-Cookie')).toEqual(expect.stringContaining('HttpOnly'));
    expect(response.headers.get('Set-Cookie')).toEqual(expect.stringContaining('Secure'));
    expect(response.headers.get('Set-Cookie')).toEqual(expect.stringContaining('SameSite=Lax'));
    expect(response.headers.get('Set-Cookie')).toEqual(expect.stringContaining('Path=/'));
    expect(workos.loadSealedSession).not.toHaveBeenCalled();

    const clearedCookie = response.headers.get('Set-Cookie')!.match(/paillette-session=[^;]*/)!;
    const restored = await withWorkOSSession(
      authArgs(
        new Request('https://paillette.test/nga/search', {
          headers: { Cookie: clearedCookie[0] },
        })
      ),
      (session) => Response.json(session)
    );

    expect(await restored.json()).toEqual({ accessToken: null, user: null });
    expect(workos.authenticateWithSessionCookie).not.toHaveBeenCalled();
  });

  it('terminates the WorkOS session before redirecting and clears the local session', async () => {
    const started = await startWorkOSAuthorization(
      authArgs(new Request('https://paillette.test/auth/start')),
      'sign-in'
    );
    const callback = await handleWorkOSCallback(
      authArgs(
        new Request('https://paillette.test/callback?code=code&state=expected-state', {
          headers: { Cookie: started.headers.get('Set-Cookie')! },
        })
      )
    );
    const sessionCookie = callback.headers
      .get('Set-Cookie')!
      .match(/paillette-session=[^;]+/)![0];

    const response = await handleWorkOSSignOut(
      authArgs(
        new Request('https://paillette.test/auth/logout', {
          method: 'POST',
          headers: {
            Cookie: sessionCookie,
            Origin: 'https://paillette.test',
          },
        })
      )
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(response.headers.get('Location')).toBe(
      'https://api.workos.com/user_management/logout'
    );
    expect(workos.loadSealedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cookiePassword: 'a'.repeat(32),
        sessionData: 'sealed-session',
      })
    );
    expect(workos.loadSealedSession.mock.results[0]?.value.getLogoutUrl).toHaveBeenCalledWith({
      returnTo: 'https://paillette.test/',
    });
  });

  it('clears the local session even when WorkOS logout generation fails', async () => {
    workos.loadSealedSession.mockImplementation(() => {
      throw new Error('WorkOS unavailable');
    });
    const started = await startWorkOSAuthorization(
      authArgs(new Request('https://paillette.test/auth/start')),
      'sign-in'
    );
    const callback = await handleWorkOSCallback(
      authArgs(
        new Request('https://paillette.test/callback?code=code&state=expected-state', {
          headers: { Cookie: started.headers.get('Set-Cookie')! },
        })
      )
    );
    const sessionCookie = callback.headers
      .get('Set-Cookie')!
      .match(/paillette-session=[^;]+/)![0];

    const response = await handleWorkOSSignOut(
      authArgs(
        new Request('https://paillette.test/auth/logout', {
          method: 'POST',
          headers: { Cookie: sessionCookie, Origin: 'https://paillette.test' },
        })
      )
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/');
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
});
