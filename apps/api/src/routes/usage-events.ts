import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../index';
import {
  recordApiUsageEvent,
  recordArtworkUsageEvents,
  requireAuthOrApiKey,
  type ArtworkUsageInteraction,
} from '../middleware/auth';
import type { ApiResponse } from '../types';

const MAX_METADATA_DEPTH = 5;
const MAX_METADATA_KEYS = 80;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 1000;

const metadataSchema = z.record(z.unknown());

const resultSchema = z.object({
  artworkId: z.string().min(1).max(160),
  orgId: z.string().max(160).optional(),
  galleryId: z.string().max(160).optional(),
  rank: z.number().int().positive().nullable().optional(),
  score: z.number().nullable().optional(),
  metadata: metadataSchema.optional(),
});

const interactionSchema = z.object({
  type: z.enum(['view', 'click', 'download', 'citation_copy']),
  action: z.string().max(120).optional(),
  artworkId: z.string().min(1).max(160),
  orgId: z.string().max(160).optional(),
  galleryId: z.string().max(160).optional(),
  rank: z.number().int().positive().nullable().optional(),
  score: z.number().nullable().optional(),
  metadata: metadataSchema.optional(),
});

const usageEventSchema = z
  .object({
    eventType: z
      .enum(['search', 'browse', 'artwork_interaction'])
      .default('artwork_interaction'),
    queryType: z.string().max(120).optional(),
    orgId: z.string().max(160).optional(),
    galleryId: z.string().max(160).optional(),
    collectionId: z.string().max(160).nullable().optional(),
    search: metadataSchema.optional(),
    results: z.array(resultSchema).max(100).optional(),
    interaction: interactionSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .refine(
    (value) =>
      value.eventType === 'search' ||
      value.eventType === 'browse' ||
      Boolean(value.interaction),
    {
      message: 'interaction is required for artwork_interaction events',
      path: ['interaction'],
    }
  );

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const sanitizeMetadataValue = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, MAX_STRING_LENGTH);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (depth >= MAX_METADATA_DEPTH) {
    return '[truncated]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeMetadataValue(item, depth + 1));
  }

  if (!isPlainObject(value)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_METADATA_KEYS)
      .map(([key, nestedValue]) => [
        key.slice(0, 120),
        /base64|buffer|bytes|dataurl|filecontents|imageData|rawImage/i.test(key)
          ? '[omitted]'
          : sanitizeMetadataValue(nestedValue, depth + 1),
      ])
  );
};

const sanitizeMetadata = (metadata: Record<string, unknown> | undefined) =>
  sanitizeMetadataValue(metadata ?? {}) as Record<string, unknown>;

const defaultQueryType = (
  eventType: 'search' | 'browse' | 'artwork_interaction',
  search: Record<string, unknown> | undefined
) => {
  if (eventType === 'browse') {
    return 'public_browse';
  }

  if (eventType === 'search') {
    const mode = typeof search?.mode === 'string' ? search.mode : 'search';
    return `public_${mode}_search`;
  }

  return 'public_artwork_interaction';
};

const usageEventRoutes = new Hono<{ Bindings: Env }>();

usageEventRoutes.use('*', requireAuthOrApiKey as any);

usageEventRoutes.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid JSON request body',
        },
      },
      400
    );
  }

  const validation = usageEventSchema.safeParse(body);
  if (!validation.success) {
    return c.json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid usage event',
          details: validation.error.flatten(),
        },
      },
      400
    );
  }

  const payload = validation.data;
  const orgId = payload.orgId || payload.galleryId || c.req.param('orgId');
  const searchMetadata = sanitizeMetadata(payload.search);
  const interactionMetadata = payload.interaction
    ? sanitizeMetadata({
        action: payload.interaction.action,
        ...payload.interaction.metadata,
      })
    : null;

  const usageEventId = await recordApiUsageEvent(c as any, {
    queryType:
      payload.queryType || defaultQueryType(payload.eventType, searchMetadata),
    orgId,
    collectionId: payload.collectionId ?? null,
    metadata: sanitizeMetadata({
      eventType: payload.eventType,
      search: searchMetadata,
      interaction: payload.interaction
        ? {
            type: payload.interaction.type,
            action: payload.interaction.action ?? null,
            artworkId: payload.interaction.artworkId,
            rank: payload.interaction.rank ?? null,
            score: payload.interaction.score ?? null,
          }
        : null,
      client: payload.metadata ?? {},
    }),
  });

  const artworkEvents = [
    ...(payload.results ?? []).map((result) => ({
      artworkId: result.artworkId,
      orgId: result.orgId || result.galleryId || orgId,
      rank: result.rank ?? null,
      score: result.score ?? null,
      interaction: 'result' as ArtworkUsageInteraction,
      metadata: sanitizeMetadata(result.metadata),
    })),
    ...(payload.interaction
      ? [
          {
            artworkId: payload.interaction.artworkId,
            orgId:
              payload.interaction.orgId ||
              payload.interaction.galleryId ||
              orgId,
            rank: payload.interaction.rank ?? null,
            score: payload.interaction.score ?? null,
            interaction: payload.interaction.type as ArtworkUsageInteraction,
            metadata: interactionMetadata ?? {},
          },
        ]
      : []),
  ];

  await recordArtworkUsageEvents(c as any, usageEventId, artworkEvents);

  return c.json<ApiResponse<{ usageEventId: string }>>({
    success: true,
    data: {
      usageEventId,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
});

export default usageEventRoutes;
