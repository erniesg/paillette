import { Hono, type Context } from 'hono';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { Env } from '../index';
import { getAuth, requireAuthOrApiKey } from '../middleware/auth';
import { resolveOrgIdentifier } from '../utils/orgs';

type CollectionRow = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  artwork_count: number;
  thumbnail_artwork_id: string | null;
  created_at: string;
  created_by: string;
};

const collectionIdSchema = z.string().trim().min(1).max(160);

const CreateCollectionSchema = z.object({
  id: collectionIdSchema.optional(),
  name: z.string().trim().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  thumbnail_artwork_id: collectionIdSchema.nullable().optional(),
});

const UpdateCollectionSchema = CreateCollectionSchema.omit({
  id: true,
}).partial();

const UpsertCollectionSchema = CreateCollectionSchema;

const AddArtworkSchema = z.object({
  artwork_id: collectionIdSchema,
  position: z.number().int().min(0).optional().default(0),
});

const collections = new Hono<{ Bindings: Env }>();

const routeOrgId = async (c: Context<{ Bindings: Env }>) =>
  resolveOrgIdentifier(
    c.env.DB,
    c.req.param('orgId') || c.req.param('galleryId')
  );

const collectionResponse = (row: CollectionRow) => ({
  id: row.id,
  org_id: row.org_id,
  gallery_id: row.org_id,
  name: row.name,
  description: row.description,
  artwork_count: row.artwork_count,
  thumbnail_artwork_id: row.thumbnail_artwork_id,
  created_at: row.created_at,
  created_by: row.created_by,
});

const getCollection = (db: D1Database, orgId: string, collectionId: string) =>
  db
    .prepare('SELECT * FROM collections WHERE id = ? AND org_id = ?')
    .bind(collectionId, orgId)
    .first<CollectionRow>();

const ensureCollectionAndArtwork = async (
  db: D1Database,
  orgId: string,
  collectionId: string,
  artworkId: string
) => {
  const [collection, artwork] = await Promise.all([
    db
      .prepare('SELECT id FROM collections WHERE id = ? AND org_id = ?')
      .bind(collectionId, orgId)
      .first<{ id: string }>(),
    db
      .prepare(
        'SELECT id FROM artworks WHERE id = ? AND org_id = ? AND deleted_at IS NULL'
      )
      .bind(artworkId, orgId)
      .first<{ id: string }>(),
  ]);

  return { collection, artwork };
};

collections.get('/', async (c) => {
  const orgId = await routeOrgId(c);
  if (!orgId) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Org ID is required' },
      },
      400
    );
  }

  const result = await c.env.DB.prepare(
    'SELECT * FROM collections WHERE org_id = ? ORDER BY created_at DESC'
  )
    .bind(orgId)
    .all<CollectionRow>();

  return c.json({
    success: true,
    data: result.results.map(collectionResponse),
  });
});

collections.post('/', requireAuthOrApiKey as any, async (c) => {
  const orgId = await routeOrgId(c);
  if (!orgId) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Org ID is required' },
      },
      400
    );
  }

  const validation = CreateCollectionSchema.safeParse(await c.req.json());
  if (!validation.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid collection',
          details: validation.error.issues,
        },
      },
      400
    );
  }

  const input = validation.data;
  const id = input.id || randomUUID();
  const auth = getAuth(c as any);

  await c.env.DB.prepare(
    `INSERT INTO collections (
      id, org_id, name, description, thumbnail_artwork_id, created_by
    ) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      orgId,
      input.name,
      input.description ?? null,
      input.thumbnail_artwork_id ?? null,
      auth.userId
    )
    .run();

  const created = await getCollection(c.env.DB, orgId, id);
  return c.json(
    {
      success: true,
      data: collectionResponse(
        created || {
          id,
          org_id: orgId,
          name: input.name,
          description: input.description ?? null,
          artwork_count: 0,
          thumbnail_artwork_id: input.thumbnail_artwork_id ?? null,
          created_at: new Date().toISOString(),
          created_by: auth.userId,
        }
      ),
    },
    201
  );
});

collections.post('/upsert', requireAuthOrApiKey as any, async (c) => {
  const orgId = await routeOrgId(c);
  if (!orgId) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Org ID is required' },
      },
      400
    );
  }

  const validation = UpsertCollectionSchema.safeParse(await c.req.json());
  if (!validation.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid collection',
          details: validation.error.issues,
        },
      },
      400
    );
  }

  const input = validation.data;
  const existing = input.id
    ? await getCollection(c.env.DB, orgId, input.id)
    : null;

  if (!existing) {
    const id = input.id || randomUUID();
    const auth = getAuth(c as any);
    await c.env.DB.prepare(
      `INSERT INTO collections (
        id, org_id, name, description, thumbnail_artwork_id, created_by
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        orgId,
        input.name,
        input.description ?? null,
        input.thumbnail_artwork_id ?? null,
        auth.userId
      )
      .run();
    const created = await getCollection(c.env.DB, orgId, id);
    return c.json(
      {
        success: true,
        data: {
          created: true,
          collection: collectionResponse(created!),
        },
      },
      201
    );
  }

  await c.env.DB.prepare(
    `UPDATE collections
     SET name = ?, description = ?, thumbnail_artwork_id = ?
     WHERE id = ? AND org_id = ?`
  )
    .bind(
      input.name,
      input.description ?? null,
      input.thumbnail_artwork_id ?? null,
      existing.id,
      orgId
    )
    .run();

  const updated = await getCollection(c.env.DB, orgId, existing.id);
  return c.json({
    success: true,
    data: {
      created: false,
      collection: collectionResponse(updated || existing),
    },
  });
});

collections.get('/:collectionId', async (c) => {
  const orgId = await routeOrgId(c);
  const collectionId = c.req.param('collectionId');
  if (!orgId) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Org ID is required' },
      },
      400
    );
  }

  const collection = await getCollection(c.env.DB, orgId, collectionId);
  if (!collection) {
    return c.json(
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Collection not found' },
      },
      404
    );
  }

  return c.json({ success: true, data: collectionResponse(collection) });
});

collections.patch('/:collectionId', requireAuthOrApiKey as any, async (c) => {
  const orgId = await routeOrgId(c);
  const collectionId = c.req.param('collectionId');
  if (!orgId) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Org ID is required' },
      },
      400
    );
  }

  const existing = await getCollection(c.env.DB, orgId, collectionId);
  if (!existing) {
    return c.json(
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Collection not found' },
      },
      404
    );
  }

  const validation = UpdateCollectionSchema.safeParse(await c.req.json());
  if (!validation.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid collection update',
          details: validation.error.issues,
        },
      },
      400
    );
  }

  const input = validation.data;
  const updates: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    updates.push('name = ?');
    params.push(input.name);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    params.push(input.description);
  }
  if (input.thumbnail_artwork_id !== undefined) {
    updates.push('thumbnail_artwork_id = ?');
    params.push(input.thumbnail_artwork_id);
  }

  if (updates.length > 0) {
    params.push(collectionId, orgId);
    await c.env.DB.prepare(
      `UPDATE collections SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`
    )
      .bind(...params)
      .run();
  }

  const updated = await getCollection(c.env.DB, orgId, collectionId);
  return c.json({
    success: true,
    data: collectionResponse(updated || existing),
  });
});

collections.delete('/:collectionId', requireAuthOrApiKey as any, async (c) => {
  const orgId = await routeOrgId(c);
  const collectionId = c.req.param('collectionId');
  if (!orgId) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Org ID is required' },
      },
      400
    );
  }

  const result = await c.env.DB.prepare(
    'DELETE FROM collections WHERE id = ? AND org_id = ?'
  )
    .bind(collectionId, orgId)
    .run();

  if (!result.meta.changes) {
    return c.json(
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Collection not found' },
      },
      404
    );
  }

  return c.json({
    success: true,
    data: { id: collectionId, deleted: true },
  });
});

collections.post(
  '/:collectionId/artworks',
  requireAuthOrApiKey as any,
  async (c) => {
    const orgId = await routeOrgId(c);
    const collectionId = c.req.param('collectionId');
    if (!orgId) {
      return c.json(
        {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Org ID is required' },
        },
        400
      );
    }

    const validation = AddArtworkSchema.safeParse(await c.req.json());
    if (!validation.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid collection artwork',
            details: validation.error.issues,
          },
        },
        400
      );
    }

    const input = validation.data;
    const { collection, artwork } = await ensureCollectionAndArtwork(
      c.env.DB,
      orgId,
      collectionId,
      input.artwork_id
    );

    if (!collection || !artwork) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: !collection ? 'Collection not found' : 'Artwork not found',
          },
        },
        404
      );
    }

    await c.env.DB.prepare(
      `INSERT INTO collection_artworks (collection_id, artwork_id, position)
       VALUES (?, ?, ?)
       ON CONFLICT(collection_id, artwork_id)
       DO UPDATE SET position = excluded.position`
    )
      .bind(collectionId, input.artwork_id, input.position)
      .run();

    return c.json({
      success: true,
      data: {
        collection_id: collectionId,
        artwork_id: input.artwork_id,
        position: input.position,
      },
    });
  }
);

collections.delete(
  '/:collectionId/artworks/:artworkId',
  requireAuthOrApiKey as any,
  async (c) => {
    const orgId = await routeOrgId(c);
    const collectionId = c.req.param('collectionId');
    const artworkId = c.req.param('artworkId');
    if (!orgId) {
      return c.json(
        {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Org ID is required' },
        },
        400
      );
    }

    const { collection, artwork } = await ensureCollectionAndArtwork(
      c.env.DB,
      orgId,
      collectionId,
      artworkId
    );

    if (!collection || !artwork) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: !collection ? 'Collection not found' : 'Artwork not found',
          },
        },
        404
      );
    }

    await c.env.DB.prepare(
      `DELETE FROM collection_artworks
       WHERE collection_id = ? AND artwork_id = ?`
    )
      .bind(collectionId, artworkId)
      .run();

    return c.json({
      success: true,
      data: {
        collection_id: collectionId,
        artwork_id: artworkId,
        removed: true,
      },
    });
  }
);

export default collections;
