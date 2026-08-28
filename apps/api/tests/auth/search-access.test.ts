import { describe, expect, it } from 'vitest';

import {
  parseSearchAccessMode,
  resolveSearchAccess,
  type ExternalIdentity,
  type SearchAccessRepository,
} from '../../src/auth/search-access';

const BOOTSTRAP_EMAIL = 'hello@ernie.sg';
const BOOTSTRAP_USER_ID = 'user-bootstrap-hello-ernie-sg';
const BOOTSTRAP_SUBJECT = 'user_ernie';

class MemorySearchAccessRepository implements SearchAccessRepository {
  identities = new Map<string, string>();
  usersByEmail = new Map<string, string>([
    [BOOTSTRAP_EMAIL, BOOTSTRAP_USER_ID],
  ]);
  approvals = new Set<string>([BOOTSTRAP_USER_ID]);
  nextUser = 1;
  emailLookupCount = 0;

  private key(identity: Pick<ExternalIdentity, 'issuer' | 'subject'>) {
    return `${identity.issuer}|${identity.subject}`;
  }

  async findIdentityUserId(
    identity: Pick<ExternalIdentity, 'issuer' | 'subject'>
  ) {
    return this.identities.get(this.key(identity)) ?? null;
  }

  async findUserIdByEmail(email: string) {
    this.emailLookupCount += 1;
    return this.usersByEmail.get(email) ?? null;
  }

  async bindIdentity(identity: ExternalIdentity, userId: string) {
    const key = this.key(identity);
    const existing = this.identities.get(key);
    if (existing) return existing === userId ? 'existing' : 'conflict';

    const existingForUser = [...this.identities.entries()].find(
      ([, boundUserId]) => boundUserId === userId
    );
    if (existingForUser && existingForUser[0] !== key) return 'conflict';

    this.identities.set(key, userId);
    return 'created';
  }

  async ensureIdentityUser(identity: ExternalIdentity) {
    const existing = await this.findIdentityUserId(identity);
    if (existing) return existing;

    const userId = `user-${this.nextUser++}`;
    this.identities.set(this.key(identity), userId);
    this.usersByEmail.set(identity.email, userId);
    return userId;
  }

  async hasActiveApproval(userId: string) {
    return this.approvals.has(userId);
  }
}

const identity = (
  overrides: Partial<ExternalIdentity> = {}
): ExternalIdentity => ({
  provider: 'workos',
  issuer: 'https://api.workos.com',
  subject: 'user_ernie',
  email: BOOTSTRAP_EMAIL,
  emailVerified: true,
  name: 'Ernie',
  ...overrides,
});

describe('parseSearchAccessMode', () => {
  it('fails closed to allowlist for missing or invalid configuration', () => {
    expect(parseSearchAccessMode(undefined)).toBe('allowlist');
    expect(parseSearchAccessMode('')).toBe('allowlist');
    expect(parseSearchAccessMode('typo')).toBe('allowlist');
  });

  it('accepts each explicit access mode', () => {
    expect(parseSearchAccessMode('allowlist')).toBe('allowlist');
    expect(parseSearchAccessMode('authenticated')).toBe('authenticated');
    expect(parseSearchAccessMode('public')).toBe('public');
  });
});

describe('resolveSearchAccess', () => {
  it('requires authentication unless public mode is explicit', async () => {
    const repository = new MemorySearchAccessRepository();

    await expect(
      resolveSearchAccess(repository, null, 'allowlist', BOOTSTRAP_EMAIL)
    ).resolves.toEqual({
      granted: false,
      status: 401,
      code: 'AUTHENTICATION_REQUIRED',
    });
    await expect(
      resolveSearchAccess(repository, null, 'public', BOOTSTRAP_EMAIL)
    ).resolves.toEqual({
      granted: true,
      internalUserId: null,
      reason: 'public',
    });
  });

  it('binds the configured immutable bootstrap subject without an email claim', async () => {
    const repository = new MemorySearchAccessRepository();

    await expect(
      resolveSearchAccess(
        repository,
        identity({
          email: 'workos-user_ernie@identity.paillette.invalid',
          emailVerified: false,
        }),
        'allowlist',
        BOOTSTRAP_EMAIL,
        BOOTSTRAP_SUBJECT
      )
    ).resolves.toEqual({
      granted: true,
      internalUserId: BOOTSTRAP_USER_ID,
      reason: 'approved',
    });
    expect(repository.identities.get('https://api.workos.com|user_ernie')).toBe(
      BOOTSTRAP_USER_ID
    );
  });

  it('keeps approval after the bound bootstrap identity changes profile email', async () => {
    const repository = new MemorySearchAccessRepository();
    await resolveSearchAccess(
      repository,
      identity(),
      'allowlist',
      BOOTSTRAP_EMAIL,
      BOOTSTRAP_SUBJECT
    );

    await expect(
      resolveSearchAccess(
        repository,
        identity({ email: 'new-address@ernie.sg' }),
        'allowlist',
        BOOTSTRAP_EMAIL,
        BOOTSTRAP_SUBJECT
      )
    ).resolves.toEqual({
      granted: true,
      internalUserId: BOOTSTRAP_USER_ID,
      reason: 'approved',
    });
  });

  it('keeps an existing issuer and subject binding when a default token has no verified email', async () => {
    const repository = new MemorySearchAccessRepository();
    repository.identities.set(
      'https://api.workos.com|user_ernie',
      BOOTSTRAP_USER_ID
    );

    await expect(
      resolveSearchAccess(
        repository,
        identity({
          email: 'workos-user_ernie@identity.paillette.invalid',
          emailVerified: false,
        }),
        'allowlist',
        BOOTSTRAP_EMAIL
      )
    ).resolves.toEqual({
      granted: true,
      internalUserId: BOOTSTRAP_USER_ID,
      reason: 'approved',
    });
    expect(repository.emailLookupCount).toBe(0);
  });

  it('provisions a viewer when the bootstrap subject is missing or mismatched', async () => {
    const repository = new MemorySearchAccessRepository();

    await expect(
      resolveSearchAccess(
        repository,
        identity({ subject: 'user-not-bootstrap', emailVerified: false }),
        'allowlist',
        BOOTSTRAP_EMAIL,
        BOOTSTRAP_SUBJECT
      )
    ).resolves.toMatchObject({
      granted: false,
      status: 403,
      code: 'ACCESS_PENDING',
    });
    expect(repository.identities.has('https://api.workos.com|user-not-bootstrap')).toBe(
      true
    );
  });

  it('does not grant bootstrap access to a second subject claiming the bootstrap email', async () => {
    const repository = new MemorySearchAccessRepository();
    await resolveSearchAccess(
      repository,
      identity(),
      'allowlist',
      BOOTSTRAP_EMAIL,
      BOOTSTRAP_SUBJECT
    );

    await expect(
      resolveSearchAccess(
        repository,
        identity({ subject: 'user_impostor' }),
        'allowlist',
        BOOTSTRAP_EMAIL,
        BOOTSTRAP_SUBJECT
      )
    ).resolves.toEqual({
      granted: false,
      status: 403,
      code: 'ACCESS_PENDING',
    });
  });

  it('allows any valid identity in authenticated mode', async () => {
    const repository = new MemorySearchAccessRepository();

    await expect(
      resolveSearchAccess(
        repository,
        identity({ subject: 'user_guest', email: 'guest@example.com' }),
        'authenticated',
        BOOTSTRAP_EMAIL
      )
    ).resolves.toEqual({
      granted: true,
      internalUserId: 'user-1',
      reason: 'authenticated',
    });
  });

  it('provisions a nonprivileged viewer for a default token in authenticated mode', async () => {
    const repository = new MemorySearchAccessRepository();

    await expect(
      resolveSearchAccess(
        repository,
        identity({
          subject: 'user_default_authkit',
          email: 'workos-user_default_authkit@identity.paillette.invalid',
          emailVerified: false,
        }),
        'authenticated',
        BOOTSTRAP_EMAIL
      )
    ).resolves.toEqual({
      granted: true,
      internalUserId: 'user-1',
      reason: 'authenticated',
    });
    expect(repository.emailLookupCount).toBe(0);
  });

  it('never bootstraps a default token into the configured email account', async () => {
    const repository = new MemorySearchAccessRepository();

    await expect(
      resolveSearchAccess(
        repository,
        identity({
          subject: 'user_default_authkit',
          email: 'workos-user_default_authkit@identity.paillette.invalid',
          emailVerified: false,
        }),
        'allowlist',
        BOOTSTRAP_EMAIL
      )
    ).resolves.toMatchObject({
      granted: false,
      status: 403,
      code: 'ACCESS_PENDING',
    });
    expect(repository.emailLookupCount).toBe(0);
    expect(repository.identities.get('https://api.workos.com|user_default_authkit')).not.toBe(
      BOOTSTRAP_USER_ID
    );
  });
});
