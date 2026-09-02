import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import {
  PUBLIC_INDEX_MAX_BATCH_BYTES,
  indexErrorResponse,
  proxyPublicIndexJson,
} from '~/lib/public-index.server';

const SAFE_JOB_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * POST /api/public-index/:jobId/items — stream one small batch of images up.
 * The archive itself is never uploaded; the browser extracted these already.
 */
export const action = async ({ context, params, request }: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return indexErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  }

  const jobId = params.jobId || '';
  if (!SAFE_JOB_ID.test(jobId)) {
    return indexErrorResponse(400, 'INVALID_INPUT', 'Invalid job ID.');
  }

  // Reject an oversized batch at the edge rather than buffering it upstream.
  const declaredLength = Number(request.headers.get('Content-Length') || '0');
  if (declaredLength > PUBLIC_INDEX_MAX_BATCH_BYTES) {
    return indexErrorResponse(
      413,
      'BATCH_TOO_LARGE',
      'This upload batch is too large. Send fewer images per batch.'
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return indexErrorResponse(400, 'INVALID_INPUT', 'Expected multipart form data.');
  }

  // Re-serialising through FormData keeps only the fields the API accepts, so
  // an unexpected part in the browser request cannot be relayed upstream.
  const forwarded = new FormData();
  let totalBytes = 0;
  for (const value of formData.getAll('files')) {
    if (typeof value === 'string') continue;
    totalBytes += value.size;
    forwarded.append('files', value, value.name);
  }
  const metadata = formData.get('metadata');
  if (typeof metadata === 'string') forwarded.append('metadata', metadata);

  if (totalBytes > PUBLIC_INDEX_MAX_BATCH_BYTES) {
    return indexErrorResponse(
      413,
      'BATCH_TOO_LARGE',
      'This upload batch is too large. Send fewer images per batch.'
    );
  }

  return proxyPublicIndexJson(request, context, `/jobs/${jobId}/items`, {
    method: 'POST',
    body: forwarded,
  });
};
