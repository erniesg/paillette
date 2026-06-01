import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { ApiResponse, ArtworkSearchResult, SearchResponse } from '~/types';
import {
  buildPublicSearchHeaders,
  getApiBaseUrl,
  getServerEnv,
  isHiddenPublicNgsArtwork,
  logPublicUsageEvent,
  publicSearchConfigError,
  resolvePublicSearchOrgId,
} from '~/lib/public-search.server';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const clamp = (
  value: FormDataEntryValue | null,
  min: number,
  max: number,
  fallback: number
) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(number, min), max);
};

const getUsageResult = (artwork: ArtworkSearchResult, index: number) => {
  const metadata = artwork.metadata || {};

  return {
    artworkId: artwork.id,
    orgId: artwork.orgId || artwork.galleryId,
    rank: index + 1,
    score: artwork.similarity,
    metadata: {
      title: artwork.title || metadata.title || null,
      artist: artwork.artist || metadata.artist || null,
      accessionNumber:
        metadata.accessionNumber || metadata.accession_number || null,
      sourceUrl: metadata.sourceUrl || metadata.source_url || null,
      sourceInstitution:
        metadata.sourceInstitution || metadata.source_institution || null,
    },
  };
};

export const action = async ({
  context,
  params,
  request,
}: ActionFunctionArgs) => {
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
  const topK = clamp(incoming.get('topK'), 1, 100, 30);
  const minScore = clamp(incoming.get('minScore'), 0, 1, 0.3);
  outbound.set('topK', String(topK));
  outbound.set('minScore', String(minScore));
  const resolvedOrgId = resolvePublicSearchOrgId(orgId);

  const response = await fetch(
    `${getApiBaseUrl(env)}/orgs/${resolvedOrgId}/search/image`,
    {
      method: 'POST',
      headers,
      body: outbound,
    }
  );

  const payload = (await response.json()) as ApiResponse<SearchResponse>;
  if (payload.success && payload.data) {
    const rawResultCount = payload.data.results.length;
    const results = payload.data.results.filter(
      (artwork) => !isHiddenPublicNgsArtwork(artwork as any)
    );
    payload.data = {
      ...payload.data,
      results,
      count: results.length,
    };

    await logPublicUsageEvent(request, env, {
      eventType: 'search',
      queryType: 'public_image_search',
      orgId: resolvedOrgId,
      search: {
        mode: 'image',
        image: {
          name: image.name || null,
          type: image.type || null,
          size: image.size,
          lastModified: image.lastModified || null,
        },
        topK,
        minScore,
        rawResultCount,
        resultCount: results.length,
        hiddenFilteredCount: rawResultCount - results.length,
        queryTime: payload.data.queryTime,
      },
      results: results.map(getUsageResult),
      metadata: {
        routeOrgId: orgId,
      },
    });
  }

  return json(payload, { status: response.status });
};
