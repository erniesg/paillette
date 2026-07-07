import { describe, expect, it } from 'vitest';
import {
  NGS_ORG_ID,
  OPEN_ACCESS_ART_ORG_SLUG,
  isNgsPublicOrg,
  isOpenAccessArtPublicOrg,
  resolveOrgIdentifier,
} from '../../src/utils/orgs';

const OPEN_ACCESS_ART_ORG_ID = 'open-access-art-org-id';

const createDb = () =>
  ({
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first() {
              if (sql.includes('id IN')) {
                return { id: NGS_ORG_ID };
              }

              if (
                sql.includes('lower(slug)') &&
                params[0] === OPEN_ACCESS_ART_ORG_SLUG
              ) {
                return { id: OPEN_ACCESS_ART_ORG_ID };
              }

              return null;
            },
          };
        },
      };
    },
  }) as unknown as D1Database;

describe('resolveOrgIdentifier', () => {
  it('resolves NGA/Open Access Art aliases through the Open Access Art slug', async () => {
    const db = createDb();

    await expect(resolveOrgIdentifier(db, 'nga')).resolves.toBe(
      OPEN_ACCESS_ART_ORG_ID
    );
    await expect(resolveOrgIdentifier(db, 'open')).resolves.toBe(
      OPEN_ACCESS_ART_ORG_ID
    );
    await expect(resolveOrgIdentifier(db, 'open-access-art')).resolves.toBe(
      OPEN_ACCESS_ART_ORG_ID
    );
  });

  it('keeps ngs mapped to National Gallery Singapore', async () => {
    const db = createDb();

    await expect(resolveOrgIdentifier(db, 'ngs')).resolves.toBe(NGS_ORG_ID);
    expect(isNgsPublicOrg('ngs')).toBe(true);
    expect(isOpenAccessArtPublicOrg('ngs')).toBe(false);
  });

  it('recognizes only Open Access Art public aliases as NGA aliases', () => {
    expect(isOpenAccessArtPublicOrg('nga')).toBe(true);
    expect(isOpenAccessArtPublicOrg('open')).toBe(true);
    expect(isOpenAccessArtPublicOrg('open-access-art')).toBe(true);
    expect(isOpenAccessArtPublicOrg('national-gallery-singapore')).toBe(false);
  });
});
