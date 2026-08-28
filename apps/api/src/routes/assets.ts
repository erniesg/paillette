import { Hono } from 'hono';
import type { Env } from '../index';
import { getAuth, requireAuthOrApiKey } from '../middleware/auth';
import { isNgsPublicOrg, isOpenAccessPublicOrg } from '../utils/orgs';

interface AssetRow {
  id: string;
  storage_provider: 'r2' | 'external';
  object_key: string;
  url: string | null;
  mime_type: string | null;
  org_id: string;
  org_slug: string | null;
}

const assets = new Hono<{ Bindings: Env }>();

const canReadAsset = async (
  env: Env,
  userId: string,
  orgId: string
) => {
  const row = await env.DB.prepare(
    `
      SELECT 1 AS allowed
      FROM users
      WHERE id = ? AND role = 'admin'
      UNION ALL
      SELECT 1 AS allowed
      FROM orgs
      WHERE id = ? AND owner_id = ?
      UNION ALL
      SELECT 1 AS allowed
      FROM org_users
      WHERE org_id = ? AND user_id = ?
      LIMIT 1
    `
  )
    .bind(userId, orgId, userId, orgId, userId)
    .first<{ allowed: 1 }>();
  return Boolean(row?.allowed);
};

const isPublicNgaAsset = (asset: AssetRow) =>
  isOpenAccessPublicOrg(asset.org_slug) || isOpenAccessPublicOrg(asset.org_id);

const isNgsAsset = (asset: AssetRow) =>
  isNgsPublicOrg(asset.org_slug) || isNgsPublicOrg(asset.org_id);

assets.get('/:assetId/content', async (c) => {
  const assetId = c.req.param('assetId');

  const asset = await c.env.DB.prepare(
    `
    SELECT a.id, a.storage_provider, a.object_key, a.url, a.mime_type,
           a.org_id, o.slug AS org_slug
    FROM assets a
    LEFT JOIN orgs o ON o.id = a.org_id
    WHERE a.id = ?
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

  if (!isPublicNgaAsset(asset)) {
    // The app-wide search middleware intentionally does not cover binary
    // assets. Authenticate here only after identifying a public NGA asset.
    // With no credentials, use the same response as an absent asset to avoid
    // turning this endpoint into an asset-existence oracle.
    if (!c.req.header('Authorization') && !c.req.header('X-API-Key') && !c.req.header('X-User-Id')) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Asset not found' } },
        404
      );
    }

    const authResult = await requireAuthOrApiKey(c as any, async () => undefined);
    if (authResult) return authResult;
    const auth = getAuth(c as any);
    const canRead =
      Boolean(auth?.searchAccess?.granted) && isNgsAsset(asset)
        ? true
        : auth
          ? await canReadAsset(c.env, auth.userId, asset.org_id)
          : false;
    if (!canRead) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Asset not found' } },
        404
      );
    }
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

    c.header(
      'Cache-Control',
      isPublicNgaAsset(asset) ? 'public, max-age=86400' : 'private, no-store'
    );
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
  headers.set(
    'Cache-Control',
    isPublicNgaAsset(asset) ? 'public, max-age=86400' : 'private, no-store'
  );

  if (asset.mime_type && !headers.has('Content-Type')) {
    headers.set('Content-Type', asset.mime_type);
  }

  return new Response(object.body, { headers });
});

export default assets;
