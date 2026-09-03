import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import {
  PUBLIC_INDEX_MAX_BATCH_BYTES,
  indexErrorResponse,
  proxyPublicIndexJson,
} from '~/lib/public-index.server';

const SAFE_JOB_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * POST /api/public-index/:jobId/image — visual search over the collection this
 * job built, the counterpart to `:jobId/search`. `search_by_image` uses it when
 * the human is looking at a collection indexed on this page; the published
 * collections keep going through `/api/public-search/:orgId/image`.
 */
export const action = async ({ context, params, request }: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return indexErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  }

  const jobId = params.jobId || '';
  if (!SAFE_JOB_ID.test(jobId)) {
    return indexErrorResponse(400, 'INVALID_INPUT', 'Invalid job ID.');
  }

  const declaredLength = Number(request.headers.get('Content-Length') || '0');
  if (declaredLength > PUBLIC_INDEX_MAX_BATCH_BYTES) {
    return indexErrorResponse(
      413,
      'IMAGE_TOO_LARGE',
      'That query image is too large.'
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return indexErrorResponse(400, 'INVALID_INPUT', 'Expected multipart form data.');
  }

  // Re-serialise so only the fields the API accepts are relayed upstream.
  const forwarded = new FormData();
  const image = formData.get('image');
  if (typeof image === 'string' || !image) {
    return indexErrorResponse(400, 'INVALID_INPUT', 'An "image" file part is required.');
  }
  forwarded.append('image', image, image.name || 'query');
  for (const field of ['topK', 'minScore'] as const) {
    const value = formData.get(field);
    if (typeof value === 'string') forwarded.append(field, value);
  }

  // No contentType: fetch sets the multipart boundary from the FormData body.
  return proxyPublicIndexJson(request, context, `/jobs/${jobId}/image`, {
    method: 'POST',
    body: forwarded,
  });
};
