import { jwtVerify, type JWTVerifyGetKey, type JWTVerifyOptions } from 'jose';

import type { ExternalIdentity } from './search-access';

export const PAILLETTE_EMAIL_CLAIM =
  'https://paillette.berlayar.ai/claims/email';
export const PAILLETTE_EMAIL_VERIFIED_CLAIM =
  'https://paillette.berlayar.ai/claims/email_verified';

export type IdentityTokenConfig = {
  issuer: string;
  clientId: string;
};

const isVerifiedEmail = (email: unknown, verified: unknown): email is string =>
  typeof email === 'string' &&
  verified === true &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

const base64Url = (bytes: Uint8Array) => {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

// AuthKit's default access-token claims intentionally omit email. Keep such
// identities usable without treating profile data as an identity key. The
// IANA-reserved .invalid domain makes this subject-bound placeholder
// non-routable and prevents it from matching a real account email.
const subjectPlaceholderEmail = async (issuer: string, subject: string) => {
  const material = new TextEncoder().encode(`${issuer}\u0000${subject}`);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return `workos-${base64Url(new Uint8Array(digest))}@identity.paillette.invalid`;
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
      !payload.sub
    ) {
      throw new Error('Token claims are incomplete');
    }

    const hasVerifiedEmail = isVerifiedEmail(email, emailVerified);

    return {
      provider: 'workos',
      issuer: config.issuer,
      subject: payload.sub,
      email: hasVerifiedEmail
        ? email.trim().toLowerCase()
        : await subjectPlaceholderEmail(config.issuer, payload.sub),
      emailVerified: hasVerifiedEmail,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  } catch {
    throw new Error('Invalid authentication token');
  }
};
