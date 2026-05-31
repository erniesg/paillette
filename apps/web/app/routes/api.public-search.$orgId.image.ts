import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { ApiResponse, SearchResponse } from '~/types';
import {
  buildPublicSearchHeaders,
  getApiBaseUrl,
  getServerEnv,
  isHiddenPublicNgsArtwork,
  publicSearchConfigError,
  resolvePublicSearchOrgId,
} from '~/lib/public-search.server';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const clamp = (value: FormDataEntryValue | null, min: number, max: number, fallback: number) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(number, min), max);
};

export const action = async ({ context, params, request }: ActionFunctionArgs) => {
  const orgId = params.orgId;
  if (!orgId) {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Org ID is required.',
        },
      },
      { status: 400 }
    );
  }

  const env = getServerEnv(context);
  const headers = buildPublicSearchHeaders(request, env);
  if (!headers) {
    return publicSearchConfigError();
  }

  const incoming = await request.formData();
  const image = incoming.get('image');
  if (!(image instanceof File)) {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Image file is required.',
        },
      },
      { status: 400 }
    );
  }

  if (image.size > MAX_IMAGE_BYTES) {
    return json<ApiResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Image must be 10 MB or smaller.',
        },
      },
      { status: 400 }
    );
  }

  const outbound = new FormData();
  outbound.set('image', image);
  outbound.set('topK', String(clamp(incoming.get('topK'), 1, 100, 30)));
  outbound.set('minScore', String(clamp(incoming.get('minScore'), 0, 1, 0.3)));

  const response = await fetch(
    `${getApiBaseUrl(env)}/orgs/${resolvePublicSearchOrgId(orgId)}/search/image`,
    {
      method: 'POST',
      headers,
      body: outbound,
    }
  );

  const payload = (await response.json()) as ApiResponse<SearchResponse>;
  if (payload.success && payload.data) {
    const results = payload.data.results.filter(
      (artwork) => !isHiddenPublicNgsArtwork(artwork as any)
    );
    payload.data = {
      ...payload.data,
      results,
      count: results.length,
    };
  }

  return json(payload, { status: response.status });
};
