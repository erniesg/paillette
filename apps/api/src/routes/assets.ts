import { Hono } from 'hono';
import type { Env } from '../index';

interface AssetRow {
  id: string;
  storage_provider: 'r2' | 'external';
  object_key: string;
  url: string | null;
  mime_type: string | null;
}

const assets = new Hono<{ Bindings: Env }>();

assets.get('/:assetId/content', async (c) => {
  const assetId = c.req.param('assetId');

  const asset = await c.env.DB.prepare(
    `
    SELECT id, storage_provider, object_key, url, mime_type
    FROM assets
    WHERE id = ?
    `
  )
    .bind(assetId)
    .first<AssetRow>();

  if (!asset) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Asset not found',
        },
      },
      404
    );
  }

  if (asset.storage_provider === 'external') {
    if (!asset.url) {
      return c.json(
        {
          success: false,
          error: {
            code: 'ASSET_UNAVAILABLE',
            message: 'External asset URL is missing',
          },
        },
        404
      );
    }

    return c.redirect(asset.url);
  }

  const object = await c.env.IMAGES.get(asset.object_key);

  if (!object) {
    return c.json(
      {
        success: false,
        error: {
          code: 'ASSET_UNAVAILABLE',
          message: 'Asset object was not found in storage',
        },
      },
      404
    );
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=86400');

  if (asset.mime_type && !headers.has('Content-Type')) {
    headers.set('Content-Type', asset.mime_type);
  }

  return new Response(object.body, { headers });
});

export default assets;
