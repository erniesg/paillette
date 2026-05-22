import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env } from '../index';
import { requireLogtoUser } from '../middleware/auth';

const impactRoutes = new Hono<{ Bindings: Env }>();

impactRoutes.use('*', requireLogtoUser as any);

impactRoutes.get(
  '/artworks',
  zValidator(
    'query',
    z.object({
      orgId: z.string().optional(),
      galleryId: z.string().optional(),
      days: z.string().optional().default('30'),
      limit: z.string().optional().default('50'),
    })
  ),
  async (c) => {
    const query = c.req.valid('query');
    const days = Math.min(Math.max(Number.parseInt(query.days, 10) || 30, 1), 365);
    const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 50, 1), 500);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const orgId = query.orgId || query.galleryId;

    const orgFilter = orgId ? 'AND aue.org_id = ?' : '';
    const params = orgId ? [since, orgId, limit] : [since, limit];

    const { results } = await c.env.DB.prepare(
      `
      SELECT
        aue.artwork_id AS artwork_id,
        aue.org_id AS org_id,
        a.title AS title,
        a.artist AS artist,
        a.image_url AS image_url,
        COUNT(*) AS result_exposures,
        COUNT(DISTINCT aue.usage_event_id) AS search_count,
        MIN(aue.rank) AS best_rank,
        AVG(aue.rank) AS avg_rank,
        MAX(aue.created_at) AS last_seen_at
      FROM artwork_usage_events aue
      LEFT JOIN artworks a ON a.id = aue.artwork_id
      WHERE aue.created_at >= ?
        ${orgFilter}
      GROUP BY aue.artwork_id, aue.org_id
      ORDER BY result_exposures DESC, best_rank ASC
      LIMIT ?
      `
    )
      .bind(...params)
      .all();

    return c.json({
      success: true,
      data: {
        since,
        days,
        artworks: results,
      },
    });
  }
);

export default impactRoutes;
