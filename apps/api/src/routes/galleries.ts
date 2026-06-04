import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env } from '../index';
import { orgQueries } from '@paillette/database';
import { CreateOrgInputSchema } from '@paillette/types';
import { getAuth, requireAuthOrApiKey } from '../middleware/auth';
import {
  generateId,
  generateSlug,
  generateApiKey,
  hashApiKey,
} from '../utils/crypto';
import {
  NGS_ORG_KEY,
  isNgsPublicOrg,
  resolveOrgIdentifier,
} from '../utils/orgs';

const orgs = new Hono<{ Bindings: Env }>();

const CreateOrgRequestSchema = CreateOrgInputSchema.omit({ ownerId: true });

/**
 * GET /orgs
 * List all orgs (with pagination)
 */
orgs.get(
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
      const query = orgQueries.list(limitNum, offset);
      const result = await c.env.DB.prepare(query.sql)
        .bind(...query.params)
        .all();

      // Get total count
      const countResult = await c.env.DB.prepare(
        'SELECT COUNT(*) as total FROM orgs'
      ).first<{ total: number }>();

      return c.json({
        success: true,
        data: result.results.map((org: any) => ({
          key: isNgsPublicOrg(org.id) ? NGS_ORG_KEY : org.slug || org.id,
          ...org,
        })),
        metadata: {
          page: pageNum,
          pageSize: limitNum,
          total: countResult?.total || 0,
        },
      });
    } catch (error: any) {
      console.error('Error listing orgs:', error);

      // If database table doesn't exist, return empty data for local dev
      if (error.message?.includes('no such table')) {
        return c.json({
          success: true,
          data: [],
          metadata: {
            page: pageNum,
            pageSize: limitNum,
            total: 0,
          },
        });
      }

      return c.json(
        {
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to fetch orgs',
          },
        },
        500
      );
    }
  }
);

/**
 * GET /orgs/:id
 * Get a single org by ID
 */
orgs.get('/:id', async (c) => {
  const id = await resolveOrgIdentifier(c.env.DB, c.req.param('id'));

  try {
    if (!id) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Org key is required',
          },
        },
        400
      );
    }

    const query = orgQueries.findById(id);
    const org = await c.env.DB.prepare(query.sql)
      .bind(...query.params)
      .first();

    if (!org) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Org not found',
          },
        },
        404
      );
    }

    // Parse JSON fields
    const orgData = {
      key: isNgsPublicOrg((org as any).id)
        ? NGS_ORG_KEY
        : (org as any).slug || id,
      ...org,
      settings: org.settings ? JSON.parse(org.settings as string) : {},
    };

    return c.json({
      success: true,
      data: orgData,
    });
  } catch (error: any) {
    console.error('Error fetching org:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch org',
        },
      },
      500
    );
  }
});

/**
 * GET /orgs/slug/:slug
 * Get an org by slug
 */
orgs.get('/slug/:slug', async (c) => {
  const slug = c.req.param('slug');

  try {
    const query = orgQueries.findBySlug(slug);
    const org = await c.env.DB.prepare(query.sql)
      .bind(...query.params)
      .first();

    if (!org) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Org not found',
          },
        },
        404
      );
    }

    // Parse JSON fields
    const orgData = {
      ...org,
      settings: org.settings ? JSON.parse(org.settings as string) : {},
    };

    return c.json({
      success: true,
      data: orgData,
    });
  } catch (error: any) {
    console.error('Error fetching org:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch org',
        },
      },
      500
    );
  }
});

/**
 * POST /orgs
 * Create a new org
 */
orgs.post(
  '/',
  requireAuthOrApiKey as any,
  zValidator('json', CreateOrgRequestSchema),
  async (c) => {
    const input = c.req.valid('json');

    try {
      const userId = getAuth(c as any).userId;

      // Generate org data
      const orgId = generateId();
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

      const org = {
        id: orgId,
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

      const query = orgQueries.create(org as any);
      await c.env.DB.prepare(query.sql)
        .bind(...query.params)
        .run();

      // Return created org (with API key visible only on creation)
      return c.json(
        {
          success: true,
          data: {
            ...org,
            settings: settingsObj,
            api_key: apiKey, // Only returned on creation
          },
        },
        201
      );
    } catch (error: any) {
      console.error('Error creating org:', error);
      return c.json(
        {
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to create org',
            details: error.message,
          },
        },
        500
      );
    }
  }
);

/**
 * PATCH /orgs/:id
 * Update an org
 */
orgs.patch(
  '/:id',
  requireAuthOrApiKey as any,
  zValidator('json', CreateOrgInputSchema.partial().omit({ ownerId: true })),
  async (c) => {
    const id = c.req.param('id');
    const updates = c.req.valid('json');

    try {
      // Check if org exists
      const existingQuery = orgQueries.findById(id);
      const existing = await c.env.DB.prepare(existingQuery.sql)
        .bind(...existingQuery.params)
        .first();

      if (!existing) {
        return c.json(
          {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Org not found',
            },
          },
          404
        );
      }

      // Transform updates to match database schema
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.slug !== undefined) dbUpdates.slug = updates.slug;
      if (updates.description !== undefined)
        dbUpdates.description = updates.description;
      if (updates.website !== undefined) dbUpdates.website = updates.website;
      if (updates.location) {
        if (updates.location.country !== undefined)
          dbUpdates.location_country = updates.location.country;
        if (updates.location.city !== undefined)
          dbUpdates.location_city = updates.location.city;
        if (updates.location.address !== undefined)
          dbUpdates.location_address = updates.location.address;
      }
      if (updates.settings)
        dbUpdates.settings = JSON.stringify(updates.settings);

      // Update org
      if (Object.keys(dbUpdates).length > 0) {
        const query = orgQueries.update(id, dbUpdates);
        await c.env.DB.prepare(query.sql)
          .bind(...query.params)
          .run();
      }

      // Fetch updated org
      const updatedOrg = await c.env.DB.prepare(existingQuery.sql)
        .bind(...existingQuery.params)
        .first();

      if (!updatedOrg) {
        return c.json(
          {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Org not found after update',
            },
          },
          404
        );
      }

      return c.json({
        success: true,
        data: {
          ...updatedOrg,
          settings: updatedOrg.settings
            ? JSON.parse(updatedOrg.settings as string)
            : {},
        },
      });
    } catch (error: any) {
      console.error('Error updating org:', error);
      return c.json(
        {
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: 'Failed to update org',
            details: error.message,
          },
        },
        500
      );
    }
  }
);

/**
 * DELETE /orgs/:id
 * Delete an org
 */
orgs.delete('/:id', requireAuthOrApiKey as any, async (c) => {
  const id = c.req.param('id');

  try {
    // Check if org exists
    const existingQuery = orgQueries.findById(id);
    const existing = await c.env.DB.prepare(existingQuery.sql)
      .bind(...existingQuery.params)
      .first();

    if (!existing) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Org not found',
          },
        },
        404
      );
    }

    // Delete org
    const query = orgQueries.delete(id);
    await c.env.DB.prepare(query.sql)
      .bind(...query.params)
      .run();

    return c.json({
      success: true,
      data: { message: 'Org deleted successfully' },
    });
  } catch (error: any) {
    console.error('Error deleting org:', error);
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to delete org',
          details: error.message,
        },
      },
      500
    );
  }
});

export default orgs;
