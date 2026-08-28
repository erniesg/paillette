import {
  createCookie,
  redirect,
  type LoaderFunctionArgs,
} from '@remix-run/cloudflare';
import { WorkOS } from '@workos-inc/node';

type RuntimeEnvironment = Record<string, string | undefined>;

type WorkerContext = { cloudflare?: { env?: RuntimeEnvironment } };

export type WorkOSRuntimeConfig = {
  clientId: string;
  apiKey: string;
  redirectUri: string;
  cookiePassword: string;
  cookieName: string;
};

export type WorkOSUser = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profilePictureUrl?: string | null;
};

export type WorkOSSession = {
  accessToken: string | null;
  user: WorkOSUser | null;
};

type AuthTransaction = {
  state: string;
  codeVerifier: string;
  returnTo: string;
};

const getProcessEnv = (): RuntimeEnvironment => {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: RuntimeEnvironment };
  };
  return runtime.process?.env ?? {};
};

const getRuntimeEnv = (context: unknown): RuntimeEnvironment => ({
  ...getProcessEnv(),
  ...((context as WorkerContext)?.cloudflare?.env ?? {}),
});

export const getWorkOSRuntimeConfig = (
  context: unknown
): WorkOSRuntimeConfig | null => {
  const env = getRuntimeEnv(context);
  const clientId = env.WORKOS_CLIENT_ID?.trim();
  const apiKey = env.WORKOS_API_KEY?.trim();
  const redirectUri = env.WORKOS_REDIRECT_URI?.trim();
  const cookiePassword = env.WORKOS_COOKIE_PASSWORD?.trim();

  if (
    !clientId ||
    !apiKey ||
    !redirectUri ||
    !cookiePassword ||
    cookiePassword.length < 32
  ) {
    return null;
  }

  return {
    clientId,
    apiKey,
    redirectUri,
    cookiePassword,
    cookieName: 'paillette-session',
  };
};

export const getSafeReturnTo = (value: string | null | undefined) => {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';

  try {
    const parsed = new URL(value, 'https://paillette.local');
    return parsed.origin === 'https://paillette.local'
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : '/';
  } catch {
    return '/';
  }
};

const getWorkOS = (config: WorkOSRuntimeConfig) =>
  new WorkOS({ apiKey: config.apiKey, clientId: config.clientId });

const getCookies = (config: WorkOSRuntimeConfig) => ({
  session: createCookie(config.cookieName, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: true,
    secrets: [config.cookiePassword],
    maxAge: 60 * 60 * 24 * 30,
  }),
  transaction: createCookie('paillette-auth-transaction', {
    httpOnly: true,
    path: '/callback',
    sameSite: 'lax',
    secure: true,
    secrets: [config.cookiePassword],
    maxAge: 60 * 10,
  }),
});

export const createAuthorizationRequest = async (
  context: unknown,
  screenHint: 'sign-in' | 'sign-up',
  returnTo?: string | null
) => {
  const config = getWorkOSRuntimeConfig(context);
  if (!config) return null;

  const result = await getWorkOS(config).userManagement.getAuthorizationUrlWithPKCE({
    clientId: config.clientId,
    provider: 'authkit',
    redirectUri: config.redirectUri,
    screenHint,
  });

  return {
    authorizationUrl: result.url,
    state: result.state,
    codeVerifier: result.codeVerifier,
    returnTo: getSafeReturnTo(returnTo),
  };
};

export const startWorkOSAuthorization = async (
  args: LoaderFunctionArgs,
  screenHint: 'sign-in' | 'sign-up',
  returnTo?: string | null
) => {
  const config = getWorkOSRuntimeConfig(args.context);
  if (!config) {
    throw new Response('Authentication is not configured', { status: 503 });
  }

  const authorization = await createAuthorizationRequest(
    args.context,
    screenHint,
    returnTo
  );
  if (!authorization) {
    throw new Response('Authentication is not configured', { status: 503 });
  }

  const { transaction } = getCookies(config);
  return redirect(authorization.authorizationUrl, {
    headers: {
      'Set-Cookie': await transaction.serialize({
        state: authorization.state,
        codeVerifier: authorization.codeVerifier,
        returnTo: authorization.returnTo,
      } satisfies AuthTransaction),
    },
  });
};

const sameState = (expected: string, actual: string | null) =>
  actual !== null &&
  expected.length === actual.length &&
  [...expected].every((character, index) => character === actual[index]);

const toSession = (authentication: {
  accessToken: string;
  user: WorkOSUser;
}): WorkOSSession => ({
  accessToken: authentication.accessToken,
  user: authentication.user,
});

export const handleWorkOSCallback = async (args: LoaderFunctionArgs) => {
  const config = getWorkOSRuntimeConfig(args.context);
  if (!config) return new Response('Authentication is not configured', { status: 503 });

  const { session, transaction } = getCookies(config);
  const transactionValue = (await transaction.parse(
    args.request.headers.get('Cookie')
  )) as AuthTransaction | null;
  const url = new URL(args.request.url);
  const code = url.searchParams.get('code');

  if (!transactionValue || !code || !sameState(transactionValue.state, url.searchParams.get('state'))) {
    return new Response('Invalid authentication callback', {
      status: 400,
      headers: { 'Set-Cookie': await transaction.serialize('', { maxAge: 0 }) },
    });
  }

  try {
    const authentication = await getWorkOS(config).userManagement.authenticateWithCode({
      clientId: config.clientId,
      code,
      codeVerifier: transactionValue.codeVerifier,
      session: { cookiePassword: config.cookiePassword, sealSession: true },
    });
    if (!authentication.sealedSession) {
      throw new Error('WorkOS did not return a sealed session.');
    }

    return redirect(getSafeReturnTo(transactionValue.returnTo), {
      headers: [
        ['Set-Cookie', await session.serialize(authentication.sealedSession)],
        ['Set-Cookie', await transaction.serialize('', { maxAge: 0 })],
      ],
    });
  } catch {
    return new Response('Authentication could not be completed', {
      status: 502,
      headers: { 'Set-Cookie': await transaction.serialize('', { maxAge: 0 }) },
    });
  }
};

export const isAccessTokenExpiringSoon = (accessToken: string) => {
  try {
    const encodedPayload = accessToken.split('.')[1] ?? '';
    const base64 = encodedPayload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=');
    const payload = JSON.parse(atob(base64)) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp * 1000 - Date.now() < 5 * 60 * 1000;
  } catch {
    return false;
  }
};

export const withWorkOSSession = async <T>(
  args: LoaderFunctionArgs,
  handler: (session: WorkOSSession) => T | Promise<T>
) => {
  const config = getWorkOSRuntimeConfig(args.context);
  if (!config) return handler({ accessToken: null, user: null });

  const { session: sessionCookie } = getCookies(config);
  const sessionData = await sessionCookie.parse(args.request.headers.get('Cookie'));
  if (typeof sessionData !== 'string' || !sessionData) {
    return handler({ accessToken: null, user: null });
  }

  const workos = getWorkOS(config);
  try {
    const authenticated = await workos.userManagement.authenticateWithSessionCookie({
      sessionData,
      cookiePassword: config.cookiePassword,
    });
    if (!authenticated.authenticated) {
      return handler({ accessToken: null, user: null });
    }

    const current = toSession(authenticated);
    if (!isAccessTokenExpiringSoon(authenticated.accessToken)) return handler(current);

    try {
      const sealed = await workos.userManagement.getSessionFromCookie({
        sessionData,
        cookiePassword: config.cookiePassword,
      });
      if (!sealed?.refreshToken) return handler(current);
      const refreshed = await workos.userManagement.authenticateWithRefreshToken({
        clientId: config.clientId,
        refreshToken: sealed.refreshToken,
        session: { cookiePassword: config.cookiePassword, sealSession: true },
      });
      if (!refreshed.sealedSession) return handler(current);
      const response = await handler(toSession(refreshed));
      return appendSessionCookie(response, await sessionCookie.serialize(refreshed.sealedSession));
    } catch {
      // A temporary WorkOS outage must not discard an otherwise verified session.
      return handler(current);
    }
  } catch {
    return handler({ accessToken: null, user: null });
  }
};

const appendSessionCookie = <T>(result: T, cookie: string): T => {
  if (!(result instanceof Response)) return result;
  const headers = new Headers(result.headers);
  headers.append('Set-Cookie', cookie);
  return new Response(result.body, { status: result.status, statusText: result.statusText, headers }) as T;
};

const isSameOriginFormPost = (request: Request) => {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin) return origin === expectedOrigin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
};

const getConfiguredApplicationUrl = (config: WorkOSRuntimeConfig) => {
  const redirectUri = new URL(config.redirectUri);
  return `${redirectUri.origin}/`;
};

export const handleWorkOSSignOut = async (args: LoaderFunctionArgs) => {
  if (!isSameOriginFormPost(args.request)) {
    return new Response('Invalid logout request', { status: 403 });
  }
  const config = getWorkOSRuntimeConfig(args.context);
  if (!config) return redirect('/');
  const { session } = getCookies(config);
  const clearSession = await session.serialize('', { maxAge: 0 });
  const sessionData = await session.parse(args.request.headers.get('Cookie'));

  if (typeof sessionData !== 'string' || !sessionData) {
    return redirect('/', { headers: { 'Set-Cookie': clearSession } });
  }

  try {
    const sealedSession = getWorkOS(config).userManagement.loadSealedSession({
      sessionData,
      cookiePassword: config.cookiePassword,
    });
    const logoutUrl = await sealedSession.getLogoutUrl({
      returnTo: getConfiguredApplicationUrl(config),
    });
    return redirect(logoutUrl, { headers: { 'Set-Cookie': clearSession } });
  } catch {
    // Never retain the local session if WorkOS is temporarily unavailable.
    return redirect('/', { headers: { 'Set-Cookie': clearSession } });
  }
};
