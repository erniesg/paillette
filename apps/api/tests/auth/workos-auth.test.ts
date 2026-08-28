import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  PAILLETTE_EMAIL_CLAIM,
  PAILLETTE_EMAIL_VERIFIED_CLAIM,
  verifyIdentityToken,
} from '../../src/auth/identity-token';

const issuer = 'https://api.workos.com';
const clientId = 'client_paillette';
let privateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  const publicJwk = (await exportJWK(pair.publicKey)) as JWK;
  publicJwk.kid = 'test-key';
  publicJwk.alg = 'RS256';
  jwks = createLocalJWKSet({ keys: [publicJwk] });
});

const signToken = async (
  claims: Record<string, unknown> = {},
  options: {
    tokenIssuer?: string;
    expiresIn?: string;
    issuedAt?: number;
    omitIssuedAt?: boolean;
    omitExpiration?: boolean;
  } = {}
) => {
  const jwt = new SignJWT({
    client_id: clientId,
    sid: 'session_ernie',
    jti: 'token_ernie',
    [PAILLETTE_EMAIL_CLAIM]: 'hello@ernie.sg',
    [PAILLETTE_EMAIL_VERIFIED_CLAIM]: true,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(options.tokenIssuer ?? issuer)
    .setSubject('user_ernie');
  if (!options.omitIssuedAt && !Object.hasOwn(claims, 'iat')) {
    jwt.setIssuedAt(options.issuedAt);
  }
  if (!options.omitExpiration && !Object.hasOwn(claims, 'exp')) {
    jwt.setExpirationTime(options.expiresIn ?? '5m');
  }
  return jwt.sign(privateKey);
};

describe('verifyIdentityToken', () => {
  it('returns a normalized WorkOS external identity', async () => {
    const token = await signToken({ name: 'Ernie' });

    await expect(
      verifyIdentityToken(token, { issuer, clientId }, jwks)
    ).resolves.toEqual({
      provider: 'workos',
      issuer,
      subject: 'user_ernie',
      email: 'hello@ernie.sg',
      emailVerified: true,
      name: 'Ernie',
    });
  });

  it('rejects the wrong issuer', async () => {
    const token = await signToken({}, { tokenIssuer: 'https://evil.test' });
    await expect(
      verifyIdentityToken(token, { issuer, clientId }, jwks)
    ).rejects.toThrow('Invalid authentication token');
  });

  it('does not normalize an issuer trailing slash during verification', async () => {
    const token = await signToken();
    await expect(
      verifyIdentityToken(token, { issuer: `${issuer}/`, clientId }, jwks)
    ).rejects.toThrow('Invalid authentication token');
  });

  it('rejects a token issued for a different WorkOS application', async () => {
    const token = await signToken({ client_id: 'client_other' });
    await expect(
      verifyIdentityToken(token, { issuer, clientId }, jwks)
    ).rejects.toThrow('Invalid authentication token');
  });

  it('rejects expired tokens', async () => {
    const token = await signToken({}, { expiresIn: '-1s' });
    await expect(
      verifyIdentityToken(token, { issuer, clientId }, jwks)
    ).rejects.toThrow('Invalid authentication token');
  });

  it.each([
    ['sid', { sid: undefined }],
    ['jti', { jti: undefined }],
    ['iat', {} as Record<string, unknown>, { omitIssuedAt: true }],
    ['exp', {} as Record<string, unknown>, { omitExpiration: true }],
  ])('rejects a token without required %s claim', async (_claim, claims, options = {}) => {
    const token = await signToken(claims, options);
    await expect(
      verifyIdentityToken(token, { issuer, clientId }, jwks)
    ).rejects.toThrow('Invalid authentication token');
  });

  it.each([
    ['sid', { sid: 42 }],
    ['jti', { jti: 42 }],
    ['iat', { iat: 'now' }],
    ['exp', { exp: 'later' }],
  ])('rejects a token with malformed %s claim', async (_claim, claims) => {
    const token = await signToken(claims);
    await expect(
      verifyIdentityToken(token, { issuer, clientId }, jwks)
    ).rejects.toThrow('Invalid authentication token');
  });

  it('rejects a token with a future issued-at timestamp', async () => {
    const token = await signToken({}, { issuedAt: Math.floor(Date.now() / 1000) + 120 });
    await expect(
      verifyIdentityToken(token, { issuer, clientId }, jwks)
    ).rejects.toThrow('Invalid authentication token');
  });

  it('accepts a default AuthKit token without optional email claims', async () => {
    const token = await signToken({
      [PAILLETTE_EMAIL_CLAIM]: undefined,
      [PAILLETTE_EMAIL_VERIFIED_CLAIM]: undefined,
    });
    await expect(
      verifyIdentityToken(token, { issuer, clientId }, jwks)
    ).resolves.toMatchObject({
      provider: 'workos',
      issuer,
      subject: 'user_ernie',
      email: expect.stringMatching(
        /^workos-[A-Za-z0-9_-]+@identity\.paillette\.invalid$/
      ),
      emailVerified: false,
    });
  });

  it('does not trust an unverified optional email claim', async () => {
    const token = await signToken({
      [PAILLETTE_EMAIL_VERIFIED_CLAIM]: false,
    });
    await expect(
      verifyIdentityToken(token, { issuer, clientId }, jwks)
    ).resolves.toMatchObject({
      email: expect.stringMatching(
        /^workos-[A-Za-z0-9_-]+@identity\.paillette\.invalid$/
      ),
      emailVerified: false,
    });
  });

  it('does not trust a verified malformed optional email claim', async () => {
    const token = await signToken({
      [PAILLETTE_EMAIL_CLAIM]: 'not-an-email',
    });
    await expect(
      verifyIdentityToken(token, { issuer, clientId }, jwks)
    ).resolves.toMatchObject({
      email: expect.stringMatching(
        /^workos-[A-Za-z0-9_-]+@identity\.paillette\.invalid$/
      ),
      emailVerified: false,
    });
  });

  it('rejects a token signed by an unknown key', async () => {
    const otherPair = await generateKeyPair('RS256');
    const token = await new SignJWT({
      client_id: clientId,
      [PAILLETTE_EMAIL_CLAIM]: 'hello@ernie.sg',
      [PAILLETTE_EMAIL_VERIFIED_CLAIM]: true,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'other-key' })
      .setIssuer(issuer)
      .setSubject('user_ernie')
      .setExpirationTime('5m')
      .sign(otherPair.privateKey);

    await expect(
      verifyIdentityToken(token, { issuer, clientId }, jwks)
    ).rejects.toThrow('Invalid authentication token');
  });

  it('rejects a non-RS256 token even when its key is otherwise trusted', async () => {
    const pssPair = await generateKeyPair('PS256', { extractable: true });
    const publicJwk = (await exportJWK(pssPair.publicKey)) as JWK;
    publicJwk.kid = 'pss-key';
    publicJwk.alg = 'PS256';
    const pssJwks = createLocalJWKSet({ keys: [publicJwk] });
    const token = await new SignJWT({
      client_id: clientId,
      sid: 'session_ernie',
      jti: 'token_ernie',
    })
      .setProtectedHeader({ alg: 'PS256', kid: 'pss-key' })
      .setIssuer(issuer)
      .setSubject('user_ernie')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(pssPair.privateKey);

    await expect(
      verifyIdentityToken(token, { issuer, clientId }, pssJwks)
    ).rejects.toThrow('Invalid authentication token');
  });
});
