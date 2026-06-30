import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  processOpenAccessAssetBatch,
  sha256Hex,
  type OpenAccessAssetMessage,
} from '../../src/queues/open-access-assets-queue';
import type { Env } from '../../src/index';

type DbCall = {
  sql: string;
  params: unknown[];
};

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly calls: DbCall[],
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async run() {
    this.calls.push({ sql: this.sql, params: this.params });
    return { success: true };
  }
}

const makeDb = () => {
  const calls: DbCall[] = [];
  return {
    calls,
    prepare(sql: string) {
      return new FakeStatement(calls, sql);
    },
  };
};

const makeMessage = (body: OpenAccessAssetMessage) => ({
  body,
  ack: vi.fn(),
  retry: vi.fn(),
});

const makeBatch = (
  messages: Array<ReturnType<typeof makeMessage>>
): MessageBatch<OpenAccessAssetMessage> =>
  ({
    messages,
    queue: 'paillette-open-access-assets-stg',
  }) as unknown as MessageBatch<OpenAccessAssetMessage>;

describe('open access asset queue', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads fetched asset bytes to R2 and marks the asset stored', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const db = makeDb();
    const put = vi.fn(async () => null);
    const env = {
      DB: db,
      IMAGES: { put },
    } as unknown as Env;
    const message = makeMessage({
      assetId: 'asset-web-1',
      artworkId: 'open-access-art:nga:1',
      orgId: 'org-open-access',
      provider: 'nga',
      role: 'web',
      sourceUrl: 'https://example.org/image.jpg',
      objectKey: 'open-access-art/nga/1/web.jpg',
      contentType: 'image/jpeg',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(bytes, { headers: { 'content-type': 'image/jpeg' } })
      )
    );

    await processOpenAccessAssetBatch(makeBatch([message]), env);

    expect(fetch).toHaveBeenCalledWith(
      'https://example.org/image.jpg',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        }),
      })
    );
    expect(put).toHaveBeenCalledWith(
      'open-access-art/nga/1/web.jpg',
      bytes.buffer,
      expect.objectContaining({
        httpMetadata: { contentType: 'image/jpeg' },
      })
    );
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(db.calls.some((call) => call.sql.includes('UPDATE assets'))).toBe(
      true
    );
    expect(
      db.calls.some(
        (call) =>
          call.sql.includes('open_access_asset_ingest') &&
          call.sql.includes("status = 'uploaded'")
      )
    ).toBe(true);
    expect(
      db.calls.some((call) =>
        call.params.includes(
          '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a'
        )
      )
    ).toBe(true);
  });

  it('retries transient source fetch failures without uploading', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = makeDb();
    const put = vi.fn(async () => null);
    const env = {
      DB: db,
      IMAGES: { put },
    } as unknown as Env;
    const message = makeMessage({
      assetId: 'asset-web-2',
      artworkId: 'open-access-art:nga:2',
      orgId: 'org-open-access',
      provider: 'nga',
      role: 'web',
      sourceUrl: 'https://example.org/slow.jpg',
      objectKey: 'open-access-art/nga/2/web.jpg',
      contentType: 'image/jpeg',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('busy', { status: 503 }))
    );

    await processOpenAccessAssetBatch(makeBatch([message]), env);

    expect(put).not.toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith(
      expect.objectContaining({ delaySeconds: expect.any(Number) })
    );
    expect(
      db.calls.some(
        (call) =>
          call.sql.includes('open_access_asset_ingest') &&
          call.sql.includes("status = 'failed'")
      )
    ).toBe(true);
  });

  it('hashes bytes with sha256 hex', async () => {
    await expect(sha256Hex(new Uint8Array([1, 2, 3, 4]).buffer)).resolves.toBe(
      '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a'
    );
  });
});
