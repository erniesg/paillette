import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import {
  authLoader,
  authkitLoader,
  configure,
  getSignInUrl,
  getSignUpUrl,
  signOut,
} from '@workos-inc/authkit-remix';

type RuntimeEnvironment = Record<string, string | undefined>;

type WorkerContext = {
  cloudflare?: {
    env?: RuntimeEnvironment;
  };
};

export type WorkOSRuntimeConfig = {
  clientId: string;
  apiKey: string;
  redirectUri: string;
  cookiePassword: string;
  cookieName: string;
};

export type WorkOSSession = {
  accessToken: string | null;
  user: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    profilePictureUrl?: string | null;
  } | null;
};

const getProcessEnv = (): RuntimeEnvironment => {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: RuntimeEnvironment };
  };
  return runtime.process?.env ?? {};
};

const getRuntimeEnv = (context: unknown): RuntimeEnvironment => ({
  ...getProcessEnv(),
  ...(((context as WorkerContext)?.cloudflare?.env ??
    {}) as RuntimeEnvironment),
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

const configureForRequest = (context: unknown) => {
  const config = getWorkOSRuntimeConfig(context);
  if (!config) return null;

  // Disable process.env lookup after resolving the Worker bindings so a stale
  // build-machine variable cannot override the deployed environment.
  configure(config, () => undefined);
  return config;
};

export const getSafeReturnTo = (value: string | null | undefined) => {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';

  try {
    const parsed = new URL(value, 'https://paillette.local');
    if (parsed.origin !== 'https://paillette.local') return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
};

export const withWorkOSSession = async <T>(
  args: LoaderFunctionArgs,
  handler: (session: WorkOSSession) => T | Promise<T>
) => {
  if (!configureForRequest(args.context)) {
    return handler({ accessToken: null, user: null });
  }

  return (authkitLoader as any)(
    args,
    async ({
      auth,
      getAccessToken,
    }: {
      auth: { user: WorkOSSession['user'] };
      getAccessToken: () => string | null;
    }) =>
      handler({
        accessToken: auth.user ? getAccessToken() : null,
        user: auth.user,
      })
  );
};

const RESOURCE_RESPONSE_KEY = '__pailletteWorkOSResourceResponse';

const appendResponseHeaders = (
  target: Headers,
  source: HeadersInit | undefined
) => {
  if (!source) return;
  const headers = new Headers(source);
  headers.forEach((value, key) => target.append(key, value));
};

export const withWorkOSResourceSession = async (
  args: LoaderFunctionArgs,
  handler: (session: WorkOSSession) => Response | Promise<Response>
): Promise<Response> => {
  if (!configureForRequest(args.context)) {
    return handler({ accessToken: null, user: null });
  }

  const result = (await (authkitLoader as any)(
    args,
    async ({
      auth,
      getAccessToken,
    }: {
      auth: { user: WorkOSSession['user'] };
      getAccessToken: () => string | null;
    }) => ({
      [RESOURCE_RESPONSE_KEY]: await handler({
        accessToken: auth.user ? getAccessToken() : null,
        user: auth.user,
      }),
    })
  )) as {
    data?: Record<string, unknown>;
    init?: ResponseInit | null;
  };

  const response = result?.data?.[RESOURCE_RESPONSE_KEY];
  if (!(response instanceof Response)) {
    throw new Error('WorkOS resource response was not preserved');
  }

  const headers = new Headers(response.headers);
  appendResponseHeaders(headers, result.init?.headers);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const getConfiguredAuthorizationUrl = async (
  context: unknown,
  screenHint: 'sign-in' | 'sign-up',
  returnTo?: string | null
) => {
  if (!configureForRequest(context)) return null;
  const safeReturnTo = getSafeReturnTo(returnTo);
  return screenHint === 'sign-up'
    ? getSignUpUrl(safeReturnTo)
    : getSignInUrl(safeReturnTo);
};

export const handleWorkOSCallback = async (
  args: LoaderFunctionArgs
): Promise<any> => {
  if (!configureForRequest(args.context)) {
    return new Response('Authentication is not configured', { status: 503 });
  }

  return authLoader({ returnPathname: '/' })(args as any);
};

export const handleWorkOSSignOut = async (args: LoaderFunctionArgs) => {
  if (!configureForRequest(args.context)) {
    return new Response(null, { status: 302, headers: { Location: '/' } });
  }

  return signOut(args.request);
};
