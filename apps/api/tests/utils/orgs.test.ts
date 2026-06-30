import { describe, expect, it, vi } from 'vitest';

import { resolveOrgIdentifier } from '../../src/utils/orgs';

const mockDb = (id: string | null) =>
  ({
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => (id ? { id } : null)),
      })),
    })),
  }) as unknown as D1Database;

describe('resolveOrgIdentifier', () => {
  it('resolves the open short key through the Open Access Art slug', async () => {
    const db = mockDb('org-open-access');

    await expect(resolveOrgIdentifier(db, 'open')).resolves.toBe(
      'org-open-access'
    );
  });

  it('falls back to the Open Access Art slug when the org row is absent', async () => {
    const db = mockDb(null);

    await expect(resolveOrgIdentifier(db, 'open')).resolves.toBe(
      'open-access-art'
    );
  });
});
