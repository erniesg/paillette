import { describe, expect, it } from 'vitest';
import {
  canMutateGlobally,
  canMutateOrg,
  type AuthPrincipal,
} from './auth';
import { resolveSearchAccess, type SearchAccessRepository } from '../auth/search-access';

const principal = (userId: string): AuthPrincipal => ({
  kind: 'user',
  userId,
  scopes: [],
});

describe('WorkOS identity issuer binding', () => {
  it('does not collapse issuer values that differ by a trailing slash', async () => {
    const seen: Array<{ issuer: string; subject: string }> = [];
    const repository: SearchAccessRepository = {
      async findIdentityUserId(identity) {
        seen.push(identity);
        return identity.issuer === 'https://issuer.example/' ? 'slash-user' : null;
      },
      async findUserIdByEmail() { return null; },
      async bindIdentity() { return 'created'; },
      async ensureIdentityUser() { return 'new-user'; },
      async hasActiveApproval() { return true; },
    };

    await resolveSearchAccess(repository, {
      provider: 'workos', issuer: 'https://issuer.example/', subject: 'same',
      email: 'viewer@example.test', emailVerified: true,
    }, 'authenticated', '');
    await resolveSearchAccess(repository, {
      provider: 'workos', issuer: 'https://issuer.example', subject: 'same',
      email: 'viewer@example.test', emailVerified: true,
    }, 'authenticated', '');

    expect(seen.map((identity) => identity.issuer)).toEqual([
      'https://issuer.example/',
      'https://issuer.example',
    ]);
  });
});

const dbFor = (row: unknown) =>
  ({
    prepare: () => ({
      bind: () => ({ first: async () => row }),
    }),
  }) as unknown as D1Database;

describe('canMutateOrg', () => {
  it('denies a freshly provisioned viewer even when authenticated', async () => {
    await expect(canMutateOrg(dbFor(null), principal('viewer'), 'nga')).resolves.toBe(false);
  });

  it('permits a global admin and an org curator', async () => {
    await expect(canMutateOrg(dbFor({ allowed: 1 }), principal('admin'), 'nga')).resolves.toBe(true);
    await expect(canMutateOrg(dbFor({ allowed: 1 }), principal('curator'), 'nga')).resolves.toBe(true);
  });

  it('never grants writes to the restricted public-search principal', async () => {
    await expect(
      canMutateOrg(
        dbFor({ allowed: 1 }),
        { ...principal('public-search-web'), scopes: ['public_search'] },
        'nga'
      )
    ).resolves.toBe(false);
  });

  it('applies the same database role checks to a signed internal MCP handoff', async () => {
    await expect(
      canMutateOrg(
        dbFor({ allowed: 1 }),
        { ...principal('curator'), internalMcp: true },
        'private-org'
      )
    ).resolves.toBe(true);
    await expect(
      canMutateGlobally(
        dbFor({ allowed: 1 }),
        { ...principal('admin'), internalMcp: true }
      )
    ).resolves.toBe(true);
  });

  it.each([
    'eabbf000-708e-4d4c-8ac8-966b59d4fcac',
    'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
  ])('requires a global admin for canonical system org %s', async (orgId) => {
    const systemOrgDb = (userId: string) =>
      ({
        prepare: (sql: string) => ({
          bind: (...params: unknown[]) => ({
            first: async () => {
              // A renamed or null system slug must not reach the owner/member
              // branch: canonical IDs are protected before any slug lookup.
              expect(sql).toContain("FROM users WHERE id = ? AND role = 'admin'");
              expect(params).toEqual([userId]);
              return userId === 'global-admin' ? { allowed: 1 } : null;
            },
          }),
        }),
      }) as unknown as D1Database;

    await expect(
      canMutateOrg(
        systemOrgDb('curator'),
        principal('curator'),
        orgId
      )
    ).resolves.toBe(false);
    await expect(
      canMutateOrg(
        systemOrgDb('global-admin'),
        principal('global-admin'),
        orgId
      )
    ).resolves.toBe(true);
  });
});
