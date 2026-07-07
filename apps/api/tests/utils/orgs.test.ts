import { describe, expect, it, vi } from 'vitest';

import {
  NGS_ORG_ID,
  OPEN_ACCESS_ORG_SLUG,
  isNgsPublicOrg,
  isOpenAccessArtPublicOrg,
  isOpenAccessPublicOrg,
  resolveOrgIdentifier,
} from '../../src/utils/orgs';

const OPEN_ACCESS_ORG_ID = 'open-access-art-org-id';

const mockDb = (id: string | null = OPEN_ACCESS_ORG_ID) =>
  ({
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('id IN')) {
            return { id: NGS_ORG_ID };
          }

          if (sql.includes('lower(slug)') && params[0] === OPEN_ACCESS_ORG_SLUG) {
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
      OPEN_ACCESS_ORG_ID
    );
    await expect(resolveOrgIdentifier(db, 'open')).resolves.toBe(
      OPEN_ACCESS_ORG_ID
    );
    await expect(resolveOrgIdentifier(db, 'open-access-art')).resolves.toBe(
      OPEN_ACCESS_ORG_ID
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
