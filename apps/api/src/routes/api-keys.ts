import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env } from '../index';
import { createApiKey, getAuth, requireLogtoUser } from '../middleware/auth';
import { generateId } from '../utils/crypto';

type Variables = {
  auth: ReturnType<typeof getAuth>;
};

const apiKeys = new Hono<{ Bindings: Env; Variables: Variables }>();

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80).optional().default('Default key'),
});

apiKeys.use('*', requireLogtoUser);

apiKeys.get('/api-keys', async (c) => {
  const auth = getAuth(c as any);
  const today = new Date().toISOString().slice(0, 10);

  const { results } = await c.env.DB.prepare(
    `
    SELECT
      ak.id,
      ak.name,
      ak.key_prefix,
      ak.status,
      ak.created_at,
      ak.last_used_at,
      ak.revoked_at,
      COALESCE(aud.used, 0) AS used_today,
      COALESCE(aud.quota, ?) AS quota_today
    FROM api_keys ak
    LEFT JOIN api_usage_daily aud
      ON aud.principal_type = 'api_key'
      AND aud.principal_id = ak.id
      AND aud.usage_date = ?
    WHERE ak.user_id = ?
    ORDER BY ak.created_at DESC
    `
  )
    .bind(Number(c.env.DAILY_FREE_QUERY_LIMIT || 100), today, auth.userId)
    .all();

  return c.json({
    success: true,
    data: {
      keys: results,
      today,
    },
  });
});

apiKeys.post('/api-keys', zValidator('json', createApiKeySchema), async (c) => {
  const auth = getAuth(c as any);
  const body = c.req.valid('json');

  const activeCount = await c.env.DB.prepare(
    `
    SELECT COUNT(*) AS count
    FROM api_keys
    WHERE user_id = ?
      AND status = 'active'
    `
  )
    .bind(auth.userId)
    .first<{ count: number }>();

  if ((activeCount?.count ?? 0) >= 1) {
    return c.json(
      {
        success: false,
        error: {
          code: 'API_KEY_LIMIT_REACHED',
          message: 'Each user can have one active Paillette API key for now.',
        },
      },
      409
    );
  }

  const generated = await createApiKey(c.env);
  const id = generateId();

  await c.env.DB.prepare(
    `
    INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash)
    VALUES (?, ?, ?, ?, ?)
    `
  )
    .bind(id, auth.userId, body.name, generated.keyPrefix, generated.keyHash)
    .run();

  return c.json(
    {
      success: true,
      data: {
        id,
        name: body.name,
        key: generated.key,
        key_prefix: generated.keyPrefix,
        status: 'active',
        created_at: new Date().toISOString(),
      },
    },
    201
  );
});

apiKeys.delete('/api-keys/:id', async (c) => {
  const auth = getAuth(c as any);
  const id = c.req.param('id');

  const result = await c.env.DB.prepare(
    `
    UPDATE api_keys
    SET status = 'revoked',
        revoked_at = datetime('now')
    WHERE id = ?
      AND user_id = ?
      AND status = 'active'
    `
  )
    .bind(id, auth.userId)
    .run();

  if (!result.meta.changes) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Active API key not found',
        },
      },
      404
    );
  }

  return c.json({
    success: true,
    data: { id, status: 'revoked' },
  });
});

apiKeys.get('/usage/today', async (c) => {
  const auth = getAuth(c as any);
  const today = new Date().toISOString().slice(0, 10);
  const quota = Number(c.env.DAILY_FREE_QUERY_LIMIT || 100);

  const row = await c.env.DB.prepare(
    `
    SELECT used, quota
    FROM api_usage_daily
    WHERE principal_type = 'user'
      AND principal_id = ?
      AND usage_date = ?
    `
  )
    .bind(auth.userId, today)
    .first<{ used: number; quota: number }>();

  return c.json({
    success: true,
    data: {
      date: today,
      used: row?.used ?? 0,
      quota: row?.quota ?? quota,
    },
  });
});

export default apiKeys;
