export type LogtoRuntimeEnv = {
  endpoint: string;
  appId: string;
  apiResource: string;
};

export const getLogtoRedirectUri = () => {
  const { hostname, origin } = window.location;

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${origin}/callback`;
  }

  return `${origin}/api/logto/callback`;
};

export const getLogtoPostSignInUri = (returnTo?: string) => {
  if (!returnTo) return `${window.location.origin}/galleries`;

  try {
    const url = new URL(returnTo, window.location.origin);
    if (url.origin === window.location.origin) {
      return url.toString();
    }
  } catch {
    // Fall back below.
  }

  return `${window.location.origin}/galleries`;
};

export const getLogtoPostSignOutUri = () => `${window.location.origin}/`;
