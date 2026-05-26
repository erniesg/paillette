import { Hono } from 'hono';
import type { Env } from '../index';
import {
  ngsReviewImageAllowlist,
  type NgsReviewImageRole,
} from '../generated/ngs-review-image-allowlist';

const ngsReviewRoutes = new Hono<{ Bindings: Env }>();

const reviewEndpointEnabled = (env: Env) =>
  env.ENVIRONMENT !== 'production' || env.ENABLE_NGS_REVIEW === 'true';

const decodeParam = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isImageRole = (role: string): role is NgsReviewImageRole =>
  role === 'thumb' || role === 'original';

ngsReviewRoutes.get('/stale-assets/:staleId/:role', async (c) => {
  if (!reviewEndpointEnabled(c.env)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'REVIEW_DISABLED',
          message: 'NGS discrepancy review assets are disabled.',
        },
      },
      404
    );
  }

  const staleId = decodeParam(c.req.param('staleId'));
  const role = c.req.param('role');

  if (!isImageRole(role)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_REVIEW_ASSET_ROLE',
          message: 'Review asset role must be thumb or original.',
        },
      },
      400
    );
  }

  const record =
    ngsReviewImageAllowlist[staleId as keyof typeof ngsReviewImageAllowlist];
  const objectKey = record?.[role];

  if (!objectKey) {
    return c.json(
      {
        success: false,
        error: {
          code: 'REVIEW_ASSET_NOT_ALLOWLISTED',
          message: 'This stale artwork image is not in the review allowlist.',
        },
      },
      404
    );
  }

  const object = await c.env.IMAGES.get(objectKey);
  if (!object) {
    return c.json(
      {
        success: false,
        error: {
          code: 'REVIEW_ASSET_UNAVAILABLE',
          message: 'Review asset object was not found in storage.',
        },
      },
      404
    );
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'private, max-age=3600');

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', role === 'thumb' ? 'image/webp' : 'image/jpeg');
  }

  return new Response(object.body, { headers });
});

ngsReviewRoutes.get('/summary', (c) => {
  if (!reviewEndpointEnabled(c.env)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'REVIEW_DISABLED',
          message: 'NGS discrepancy review is disabled.',
        },
      },
      404
    );
  }

  return c.json({
    success: true,
    data: {
      allowlistedStaleImages: Object.keys(ngsReviewImageAllowlist).length,
    },
  });
});

export default ngsReviewRoutes;
