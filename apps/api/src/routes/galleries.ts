import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env } from '../index';
import { galleryQueries } from '@paillette/database';
import { CreateGalleryInputSchema } from '@paillette/types';
import { generateId, generateSlug, generateApiKey, hashApiKey } from '../utils/crypto';

const galleries = new Hono<{ Bindings: Env }>();

/**
 * GET /galleries
 * List all galleries (with pagination)
 */
galleries.get(
  '/',
  zValidator(
    'query',
    z.object({
      page: z.string().optional().default('1'),
      limit: z.string().optional().default('50'),
    })
  ),
  async (c) => {
    const { page, limit } = c.req.valid('query');
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    try {
      const query = galleryQueries.list(limitNum, offset);
      const result = await c.env.DB.prepare(query.sql)
        .bind(...query.params)
        .all();

      // Get total count
      const countResult = await c.env.DB.prepare(
        'SELECT COUNT(*) as total FROM galleries'
      ).first<{ total: number }>();

      return c.json({
        success: true,
        data: result.results,
        metadata: {
          page: pageNum,
          pageSize: limitNum,
          total: countResult?.total || 0,
        },
      });
    } catch (error: any) {
      console.error('Error listing galleries:', error);
      return c.json(
        {
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to fetch galleries',
          },
        },
        500
      );
    }
  }
);

/**
 * GET /galleries/:id
 * Get a single gallery by ID
 */
galleries.get('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const query = galleryQueries.findById(id);
    const gallery = await c.env.DB.prepare(query.sql)
      .bind(...query.params)
      .first();

    if (!gallery) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Gallery not found',
          },
        },
        404
      );
    }

    // Parse JSON fields
    const galleryData = {
      ...gallery,
      settings: gallery.settings ? JSON.parse(gallery.settings as string) : {},
    };

    return c.json({
      success: true,
      data: galleryData,
    });
  } catch (error: any) {
    console.error('Error fetching gallery:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch gallery',
        },
      },
      500
    );
  }
});

/**
 * GET /galleries/slug/:slug
 * Get a gallery by slug
 */
galleries.get('/slug/:slug', async (c) => {
  const slug = c.req.param('slug');

  try {
    const query = galleryQueries.findBySlug(slug);
    const gallery = await c.env.DB.prepare(query.sql)
      .bind(...query.params)
      .first();

    if (!gallery) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Gallery not found',
          },
        },
        404
      );
    }

    // Parse JSON fields
    const galleryData = {
      ...gallery,
      settings: gallery.settings ? JSON.parse(gallery.settings as string) : {},
    };

    return c.json({
      success: true,
      data: galleryData,
    });
  } catch (error: any) {
    console.error('Error fetching gallery:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch gallery',
        },
      },
      500
    );
  }
});

/**
 * POST /galleries
 * Create a new gallery
 */
galleries.post('/', zValidator('json', CreateGalleryInputSchema), async (c) => {
  const input = c.req.valid('json');

  try {
    // TODO: Get authenticated user ID (for now using placeholder)
    const userId = 'user-placeholder'; // Will be replaced with auth

    // Generate gallery data
    const galleryId = generateId();
    const slug = input.slug || generateSlug(input.name);
    const apiKey = generateApiKey();
    const apiKeyHash = await hashApiKey(apiKey);

    // Transform input to database schema (flatten location object)
    const settingsObj = input.settings || {
      allowPublicAccess: false,
      enableEmbeddingProjector: true,
      defaultLanguage: 'en',
      supportedLanguages: ['en'],
    };

    const gallery = {
      id: galleryId,
      name: input.name,
      slug,
      description: input.description || null,
      location_country: input.location?.country || null,
      location_city: input.location?.city || null,
      location_address: input.location?.address || null,
      website: input.website || null,
      api_key: apiKey,
      api_key_hash: apiKeyHash,
      owner_id: userId,
      settings: settingsObj,
    };

    const query = galleryQueries.create(gallery as any);
    await c.env.DB.prepare(query.sql).bind(...query.params).run();

    // Return created gallery (with API key visible only on creation)
    return c.json(
      {
        success: true,
        data: {
          ...gallery,
          settings: settingsObj,
          api_key: apiKey, // Only returned on creation
        },
      },
      201
    );
  } catch (error: any) {
    console.error('Error creating gallery:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to create gallery',
          details: error.message,
        },
      },
      500
    );
  }
});

/**
 * PATCH /galleries/:id
 * Update a gallery
 */
galleries.patch(
  '/:id',
  zValidator(
    'json',
    CreateGalleryInputSchema.partial().omit({ ownerId: true })
  ),
  async (c) => {
    const id = c.req.param('id');
    const updates = c.req.valid('json');

    try {
      // Check if gallery exists
      const existingQuery = galleryQueries.findById(id);
      const existing = await c.env.DB.prepare(existingQuery.sql)
        .bind(...existingQuery.params)
        .first();

      if (!existing) {
        return c.json(
          {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Gallery not found',
            },
          },
          404
        );
      }

      // Transform updates to match database schema
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.slug !== undefined) dbUpdates.slug = updates.slug;
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.website !== undefined) dbUpdates.website = updates.website;
      if (updates.location) {
        if (updates.location.country !== undefined)
          dbUpdates.location_country = updates.location.country;
        if (updates.location.city !== undefined)
          dbUpdates.location_city = updates.location.city;
        if (updates.location.address !== undefined)
          dbUpdates.location_address = updates.location.address;
      }
      if (updates.settings) dbUpdates.settings = JSON.stringify(updates.settings);

      // Update gallery
      if (Object.keys(dbUpdates).length > 0) {
        const query = galleryQueries.update(id, dbUpdates);
        await c.env.DB.prepare(query.sql).bind(...query.params).run();
      }

      // Fetch updated gallery
      const updatedGallery = await c.env.DB.prepare(existingQuery.sql)
        .bind(...existingQuery.params)
        .first();

      if (!updatedGallery) {
        return c.json(
          {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Gallery not found after update',
            },
          },
          404
        );
      }

      return c.json({
        success: true,
        data: {
          ...updatedGallery,
          settings: updatedGallery.settings
            ? JSON.parse(updatedGallery.settings as string)
            : {},
        },
      });
    } catch (error: any) {
      console.error('Error updating gallery:', error);
      return c.json(
        {
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to update gallery',
            details: error.message,
          },
        },
        500
      );
    }
  }
);

/**
 * DELETE /galleries/:id
 * Delete a gallery
 */
galleries.delete('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    // Check if gallery exists
    const existingQuery = galleryQueries.findById(id);
    const existing = await c.env.DB.prepare(existingQuery.sql)
      .bind(...existingQuery.params)
      .first();

    if (!existing) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Gallery not found',
          },
        },
        404
      );
    }

    // Delete gallery
    const query = galleryQueries.delete(id);
    await c.env.DB.prepare(query.sql).bind(...query.params).run();

    return c.json({
      success: true,
      data: { message: 'Gallery deleted successfully' },
    });
  } catch (error: any) {
    console.error('Error deleting gallery:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to delete gallery',
          details: error.message,
        },
      },
      500
    );
  }
});

export default galleries;
