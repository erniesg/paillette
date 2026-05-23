import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { ApiResponse, Artwork, ArtworkSearchResult } from '~/types';
import {
  getApiBaseUrl,
  getServerEnv,
  resolvePublicSearchOrgId,
} from '~/lib/public-search.server';

const clamp = (value: string | null, min: number, max: number, fallback: number) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(number), min), max);
};

const SORT_BY = new Set(['title', 'artist', 'year', 'created_at', 'updated_at']);
const SORT_ORDER = new Set(['asc', 'desc']);

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

const mapArtworkToSearchResult = (artwork: Artwork & Record<string, any>): ArtworkSearchResult => {
  const orgId = artwork.orgId || artwork.org_id || artwork.galleryId || artwork.gallery_id || '';
  const metadata = {
    ...asRecord(artwork.metadata),
    ...asRecord(artwork.custom_metadata),
    medium: artwork.medium,
    dateText: artwork.date_text,
    date_text: artwork.date_text,
    classification: artwork.classification,
    culture: artwork.culture,
    origin: artwork.origin,
    dimensions: artwork.dimensions,
    description: artwork.description,
    provenance: artwork.provenance,
    creditLine: artwork.credit_line,
    credit_line: artwork.credit_line,
    rights: artwork.rights,
    accessionNumber: artwork.accession_number,
    accession_number: artwork.accession_number,
    sourceUrl: artwork.source_url,
    source_url: artwork.source_url,
    sourceInstitution: artwork.source_institution,
    source_institution: artwork.source_institution,
    sourceCollection: artwork.source_collection,
    source_collection: artwork.source_collection,
    sourceRecordId: artwork.source_record_id,
    source_record_id: artwork.source_record_id,
    fieldSources: artwork.field_sources,
    field_sources: artwork.field_sources,
    dominantColors: artwork.colors?.dominant,
    colorPalette: artwork.colors?.palette,
    citation: artwork.citation,
  };

  return {
    id: artwork.id,
    orgId,
    galleryId: orgId,
    title: artwork.title,
    artist: artwork.artist,
    year: artwork.year,
    imageUrl: artwork.imageUrl ?? artwork.image_url ?? null,
    thumbnailUrl: artwork.thumbnailUrl ?? artwork.thumbnail_url ?? null,
    similarity: 1,
    metadata,
  };
};

export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
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

  const url = new URL(request.url);
  const limit = clamp(url.searchParams.get('limit'), 1, 100, 60);
  const offset = clamp(url.searchParams.get('offset'), 0, 100000, 0);
  const sortBy = SORT_BY.has(url.searchParams.get('sort_by') || '')
    ? url.searchParams.get('sort_by') || 'title'
    : 'title';
  const sortOrder = SORT_ORDER.has(url.searchParams.get('sort_order') || '')
    ? url.searchParams.get('sort_order') || 'asc'
    : 'asc';

  const env = getServerEnv(context);
  const apiUrl = new URL(
    `${getApiBaseUrl(env)}/orgs/${resolvePublicSearchOrgId(orgId)}/artworks`
  );
  apiUrl.searchParams.set('public_only', 'true');
  apiUrl.searchParams.set('limit', String(limit));
  apiUrl.searchParams.set('offset', String(offset));
  apiUrl.searchParams.set('sort_by', sortBy);
  apiUrl.searchParams.set('sort_order', sortOrder);

  const response = await fetch(apiUrl.toString());
  const payload = (await response.json()) as ApiResponse<Artwork[]> & {
    pagination?: {
      total?: number;
      limit?: number;
      offset?: number;
      has_more?: boolean;
    };
  };

  if (!payload.success || !payload.data) {
    return json(payload, { status: response.status });
  }

  const results = payload.data.map((artwork) => mapArtworkToSearchResult(artwork));

  return json({
    success: true,
    data: {
      results,
      count: results.length,
      total: payload.pagination?.total ?? results.length,
      limit: payload.pagination?.limit ?? limit,
      offset: payload.pagination?.offset ?? offset,
      hasMore: payload.pagination?.has_more ?? results.length === limit,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  } satisfies ApiResponse);
};
