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
} from '../../src/utils/orgs';

const RESOLVED_OPEN_ACCESS_ORG_ID = 'open-access-art-org-id';

const mockDb = (id: string | null = RESOLVED_OPEN_ACCESS_ORG_ID) =>
  ({
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('id IN')) {
            return { id: NGS_ORG_ID };
          }

          if (
            sql.includes('lower(slug)') &&
            params[0] === OPEN_ACCESS_ORG_SLUG
          ) {
            return id ? { id } : null;
          }

          return null;
        }),
      })),
    })),
  }) as unknown as D1Database;

describe('resolveOrgIdentifier', () => {
  it('resolves Open Access Art aliases through the Open Access Art slug', async () => {
    const db = mockDb();

    await expect(resolveOrgIdentifier(db, 'nga')).resolves.toBe(
      RESOLVED_OPEN_ACCESS_ORG_ID
    );
    await expect(resolveOrgIdentifier(db, 'open')).resolves.toBe(
      RESOLVED_OPEN_ACCESS_ORG_ID
    );
    await expect(resolveOrgIdentifier(db, 'open-access-art')).resolves.toBe(
      RESOLVED_OPEN_ACCESS_ORG_ID
    );
  });

  it('falls back to the Open Access Art slug when the org row is absent', async () => {
    const db = mockDb(null);

    await expect(resolveOrgIdentifier(db, 'nga')).resolves.toBe(
      OPEN_ACCESS_ORG_SLUG
    );
    await expect(resolveOrgIdentifier(db, 'open')).resolves.toBe(
      OPEN_ACCESS_ORG_SLUG
    );
  });

  it('keeps ngs mapped to National Gallery Singapore', async () => {
    const db = mockDb();

    await expect(resolveOrgIdentifier(db, 'ngs')).resolves.toBe(NGS_ORG_ID);
    expect(isNgsPublicOrg('ngs')).toBe(true);
    expect(isOpenAccessPublicOrg('ngs')).toBe(false);
  });

  it('recognizes only Open Access Art public aliases as NGA aliases', () => {
    expect(isOpenAccessPublicOrg('nga')).toBe(true);
    expect(isOpenAccessPublicOrg('open')).toBe(true);
    expect(isOpenAccessPublicOrg('open-access-art')).toBe(true);
    expect(isOpenAccessArtPublicOrg('nga')).toBe(true);
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
