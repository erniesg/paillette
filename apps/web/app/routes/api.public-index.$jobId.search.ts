import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import {
  indexErrorResponse,
  proxyPublicIndexJson,
} from '~/lib/public-index.server';

const SAFE_JOB_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * POST /api/public-index/:jobId/search — semantic search over the collection
 * this job built, in the same embedding space as the rest of Paillette.
 */
export const action = async ({ context, params, request }: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return indexErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  }

  const jobId = params.jobId || '';
  if (!SAFE_JOB_ID.test(jobId)) {
    return indexErrorResponse(400, 'INVALID_INPUT', 'Invalid job ID.');
  }

  let body: string;
  try {
    body = JSON.stringify(await request.json());
  } catch {
    return indexErrorResponse(400, 'INVALID_INPUT', 'Invalid JSON request body.');
  }

  return proxyPublicIndexJson(request, context, `/jobs/${jobId}/search`, {
    method: 'POST',
    body,
    contentType: 'application/json',
  });
};
