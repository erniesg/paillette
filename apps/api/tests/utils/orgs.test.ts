import { describe, expect, it, vi } from 'vitest';

import {
  NGS_ORG_ID,
  OPEN_ACCESS_ORG_ID,
  OPEN_ACCESS_ORG_SLUG,
  isAllowedPublicSearchRouteScope,
  isNgsPublicOrg,
  isOpenAccessArtPublicOrg,
  isOpenAccessPublicOrg,
  resolveOpenAccessProviderScope,
  resolveOrgIdentifier,
  resolveOrgSearchScope,
} from '../../src/utils/orgs';

const PRIVATE_ORG_ID = '11111111-1111-4111-8111-111111111111';

const mockDb = (id: string | null = PRIVATE_ORG_ID) =>
  ({
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('id IN')) {
            return { id: NGS_ORG_ID };
          }

          if (sql.includes('lower(slug)') && params[0] === 'private-gallery') {
            return id ? { id } : null;
          }

          return null;
        }),
      })),
    })),
  }) as unknown as D1Database;

describe('resolveOrgIdentifier', () => {
  it('pins public NGA aliases to the canonical NGA organisation ID even when its slug changes', async () => {
    const db = mockDb();

    await expect(resolveOrgIdentifier(db, 'nga')).resolves.toBe(OPEN_ACCESS_ORG_ID);
    await expect(resolveOrgIdentifier(db, 'open')).resolves.toBe(OPEN_ACCESS_ORG_ID);
    await expect(resolveOrgIdentifier(db, 'open-access-art')).resolves.toBe(
      OPEN_ACCESS_ORG_ID
    );
  });

  it('does not resolve an attacker-owned NGA slug as the public organisation', async () => {
    const db = mockDb(PRIVATE_ORG_ID);

    await expect(resolveOrgIdentifier(db, OPEN_ACCESS_ORG_SLUG)).resolves.toBe(
      OPEN_ACCESS_ORG_ID
    );
  });

  it('continues to resolve non-public organisation slugs through the database', async () => {
    const db = mockDb(PRIVATE_ORG_ID);

    await expect(resolveOrgIdentifier(db, 'private-gallery')).resolves.toBe(
      PRIVATE_ORG_ID
    );
  });

  it('keeps ngs mapped to National Gallery Singapore', async () => {
    const db = mockDb();

    await expect(resolveOrgIdentifier(db, 'ngs')).resolves.toBe(NGS_ORG_ID);
    expect(isNgsPublicOrg('ngs')).toBe(true);
    expect(isOpenAccessPublicOrg('ngs')).toBe(false);
  });

  it('classifies only the canonical NGA organisation ID as public', () => {
    expect(isOpenAccessPublicOrg(OPEN_ACCESS_ORG_ID)).toBe(true);
    expect(isOpenAccessPublicOrg('nga')).toBe(false);
    expect(isOpenAccessPublicOrg('open')).toBe(false);
    expect(isOpenAccessPublicOrg('open-access-art')).toBe(false);
    expect(isOpenAccessArtPublicOrg(OPEN_ACCESS_ORG_ID)).toBe(true);
    expect(isOpenAccessArtPublicOrg('national-gallery-singapore')).toBe(false);
  });
});

describe('resolveOpenAccessProviderScope', () => {
  it('scopes every canonical NGA identifier to the NGA provider', () => {
    expect(resolveOpenAccessProviderScope('nga')).toBe('nga');
    expect(resolveOpenAccessProviderScope('NGA')).toBe('nga');
    expect(resolveOpenAccessProviderScope('open-access-art')).toBe('nga');
    expect(resolveOpenAccessProviderScope('open')).toBe('nga');
    expect(resolveOpenAccessProviderScope(OPEN_ACCESS_ORG_ID)).toBe('nga');
    expect(resolveOpenAccessProviderScope('ngs')).toBeUndefined();
  });
});

describe('resolveOrgSearchScope', () => {
  it('derives NGA provider scope from a renamed slug\'s resolved canonical ID', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({ id: OPEN_ACCESS_ORG_ID }),
        }),
      }),
    } as unknown as D1Database;

    await expect(resolveOrgSearchScope(db, 'national-gallery-of-art')).resolves.toEqual({
      orgId: OPEN_ACCESS_ORG_ID,
      provider: 'nga',
    });
  });
});

describe('isAllowedPublicSearchRouteScope', () => {
  it('allows only the dedicated NGA provider route', () => {
    expect(isAllowedPublicSearchRouteScope('nga')).toBe(true);
    expect(isAllowedPublicSearchRouteScope('NGA')).toBe(true);
  });

  it('rejects NGS, generic open-access, and arbitrary org scopes', () => {
    expect(isAllowedPublicSearchRouteScope('ngs')).toBe(false);
    expect(isAllowedPublicSearchRouteScope('national-gallery-singapore')).toBe(
      false
    );
    expect(
      isAllowedPublicSearchRouteScope('cf98791d-f3cc-4f9f-b40c-a350efadbd05')
    ).toBe(false);
    expect(isAllowedPublicSearchRouteScope('open')).toBe(false);
    expect(isAllowedPublicSearchRouteScope('open-access-art')).toBe(false);
    expect(
      isAllowedPublicSearchRouteScope('11111111-1111-4111-8111-111111111111')
    ).toBe(false);
    expect(isAllowedPublicSearchRouteScope('private-gallery')).toBe(false);
    expect(isAllowedPublicSearchRouteScope(undefined)).toBe(false);
  });
});
