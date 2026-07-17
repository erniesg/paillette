import { afterEach, describe, expect, it, vi } from 'vitest';

import { loader as browseLoader } from '../api.public-search.$orgId.browse';
import { action as imageAction } from '../api.public-search.$orgId.image';

describe('public search scope guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects arbitrary org IDs before public image search can spend an embedding call', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await imageAction({
      context: {},
      params: { orgId: 'private-org' },
      request: new Request(
        'https://paillette.test/api/public-search/private-org/image',
        { method: 'POST' }
      ),
    } as any);

    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects arbitrary org IDs before public browse can read another org', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await browseLoader({
      context: {},
      params: { orgId: 'private-org' },
      request: new Request(
        'https://paillette.test/api/public-search/private-org/browse'
      ),
    } as any);

    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
