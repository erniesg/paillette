import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import {
  indexErrorResponse,
  proxyPublicIndexJson,
} from '~/lib/public-index.server';

/** POST /api/public-index/jobs — create an indexing job and its collection. */
export const action = async ({ context, request }: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return indexErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  }

  let body: string;
  try {
    body = JSON.stringify(await request.json());
  } catch {
    return indexErrorResponse(400, 'INVALID_INPUT', 'Invalid JSON request body.');
  }

  return proxyPublicIndexJson(request, context, '/jobs', {
    method: 'POST',
    body,
    contentType: 'application/json',
  });
};
