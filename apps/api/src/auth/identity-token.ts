import {
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
} from 'jose';

import type { ExternalIdentity } from './search-access';

export const PAILLETTE_EMAIL_CLAIM =
  'https://paillette.berlayar.ai/claims/email';
export const PAILLETTE_EMAIL_VERIFIED_CLAIM =
  'https://paillette.berlayar.ai/claims/email_verified';

export type IdentityTokenConfig = {
  issuer: string;
  clientId: string;
};

export const verifyIdentityToken = async (
  token: string,
  config: IdentityTokenConfig,
  jwks: JWTVerifyGetKey,
  options: JWTVerifyOptions = {}
): Promise<ExternalIdentity> => {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      ...options,
      issuer: config.issuer,
    });
    const clientId = payload.client_id;
    const email = payload[PAILLETTE_EMAIL_CLAIM];
    const emailVerified = payload[PAILLETTE_EMAIL_VERIFIED_CLAIM];

    if (
      clientId !== config.clientId ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof email !== 'string' ||
      !email.trim() ||
      typeof emailVerified !== 'boolean'
    ) {
      throw new Error('Token claims are incomplete');
    }

    return {
      provider: 'workos',
      issuer: config.issuer.replace(/\/+$/, ''),
      subject: payload.sub,
      email: email.trim().toLowerCase(),
      emailVerified,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  } catch {
    throw new Error('Invalid authentication token');
  }
};
