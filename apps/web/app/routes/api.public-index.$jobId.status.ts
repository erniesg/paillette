import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import {
  indexErrorResponse,
  proxyPublicIndexJson,
} from '~/lib/public-index.server';

const SAFE_JOB_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * GET /api/public-index/:jobId/status — what `get_index_status` polls. A
 * WebMCP execute() cannot block for minutes, so progress is read, not awaited.
 */
export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const jobId = params.jobId || '';
  if (!SAFE_JOB_ID.test(jobId)) {
    return indexErrorResponse(400, 'INVALID_INPUT', 'Invalid job ID.');
  }

  return proxyPublicIndexJson(request, context, `/jobs/${jobId}`, {
    method: 'GET',
  });
};
