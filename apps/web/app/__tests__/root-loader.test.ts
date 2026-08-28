import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { withWorkOSSessionMock, getApiBaseUrlMock, getServerEnvMock, getWorkOSRuntimeConfigMock } =
  vi.hoisted(() => ({
    withWorkOSSessionMock: vi.fn(),
    getApiBaseUrlMock: vi.fn(),
    getServerEnvMock: vi.fn(),
    getWorkOSRuntimeConfigMock: vi.fn(),
  }));

vi.mock('~/lib/workos-auth.server', () => ({
  getWorkOSRuntimeConfig: getWorkOSRuntimeConfigMock,
  withWorkOSSession: withWorkOSSessionMock,
}));

vi.mock('~/lib/public-search.server', () => ({
  getApiBaseUrl: getApiBaseUrlMock,
  getServerEnv: getServerEnvMock,
}));

import { loader } from '../root';

const loaderArgs = (accept: string) =>
  ({
    context: { cloudflare: { env: {} } },
    request: new Request('https://paillette.test/ngs/search', {
      headers: { Accept: accept },
    }),
  }) as any;

describe('root loader session response', () => {
  beforeEach(() => {
    getServerEnvMock.mockReturnValue({});
    getApiBaseUrlMock.mockReturnValue('https://api.paillette.test');
    getWorkOSRuntimeConfigMock.mockReturnValue({ clientId: 'client_test' });
    withWorkOSSessionMock.mockImplementation(
      async (_args: unknown, handler: (session: unknown) => unknown) =>
        handler({
          accessToken: null,
          user: { id: 'user_123', email: 'user@example.test' },
        })
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not cache the session-bearing HTML document loader response', async () => {
    const response = await loader(loaderArgs('text/html'));

    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({
      sessionUser: { id: 'user_123' },
    });
  });

  it('does not cache the session-bearing Remix data loader response', async () => {
    const response = await loader(
      loaderArgs('application/json, text/plain, */*')
    );

    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({
      sessionUser: { id: 'user_123' },
    });
  });
});
