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

export const getLogtoPostSignInUri = () => `${window.location.origin}/galleries`;

export const getLogtoPostSignOutUri = () => `${window.location.origin}/`;
