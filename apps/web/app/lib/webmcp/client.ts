/**
 * Browser-side wrappers over Paillette's anonymous public-search endpoints.
 *
 * These are the *same* same-origin routes the human's own UI calls — no
 * parallel API, no privileged key, no DOM scraping. Everything here threads
 * the agent's `AbortSignal` down to `fetch` so a cancelled turn actually stops
 * work in flight, and normalises the `{success, error}` envelope into a thrown
 * `PailletteApiError` that the tool layer turns into a structured result.
 */

import type { ApiResponse, ArtworkSearchResult, SearchResponse } from '~/types';
import type { NgaSearchQuota } from '~/lib/nga-search-quota';

/** Mirrors the limits enforced by `api.public-search.$orgId.image.ts`. */
export const IMAGE_SEARCH_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_SEARCH_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export class PailletteApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'PailletteApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const publicSearchPath = (collectionId: string, leaf: string) =>
  `/api/public-search/${encodeURIComponent(collectionId)}/${leaf}`;

/**
 * Reads a Paillette API envelope. A non-JSON body means we hit an HTML error
 * page (an unrouted path on an older deploy, or an edge error) — surface that
 * as a distinct code instead of a JSON parse crash inside `execute`.
 */
const readEnvelope = async <T>(response: Response): Promise<T> => {
  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new PailletteApiError(
      'NON_JSON_RESPONSE',
      `Paillette returned a non-JSON response (HTTP ${response.status}). This endpoint may not be available on this deployment.`,
      response.status
    );
  }

  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new PailletteApiError(
      payload.error?.code ?? 'PUBLIC_SEARCH_FAILED',
      payload.error?.message ?? `Request failed with HTTP ${response.status}.`,
      response.status,
      payload.error?.details
    );
  }

  return payload.data;
};

export interface TextSearchInput {
  collectionId: string;
  query: string;
  topK: number;
  minScore: number;
  facet?: 'artist' | 'classification';
  signal?: AbortSignal;
}

export const searchTextPublic = async ({
  collectionId,
  query,
  topK,
  minScore,
  facet,
  signal,
}: TextSearchInput): Promise<SearchResponse> => {
  const response = await fetch(publicSearchPath(collectionId, 'text'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      topK,
      minScore,
      ...(facet ? { facet } : {}),
    }),
    signal,
  });
  return readEnvelope<SearchResponse>(response);
};

export interface ImageSearchInput {
  collectionId: string;
  image: Blob;
  topK: number;
  minScore: number;
  signal?: AbortSignal;
}

export const searchImagePublic = async ({
  collectionId,
  image,
  topK,
  minScore,
  signal,
}: ImageSearchInput): Promise<SearchResponse> => {
  const form = new FormData();
  // The route requires exactly one `image` entry and reads `.type`/`.size`,
  // so send a File rather than a bare Blob.
  const extension = image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg';
  form.set('image', new File([image], `agent-query.${extension}`, { type: image.type }));
  form.set('topK', String(topK));
  form.set('minScore', String(minScore));

  const response = await fetch(publicSearchPath(collectionId, 'image'), {
    method: 'POST',
    body: form,
    signal,
  });
  return readEnvelope<SearchResponse>(response);
};

export interface BrowseInput {
  collectionId: string;
  limit: number;
  offset: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  signal?: AbortSignal;
}

export interface BrowseResponse {
  results: ArtworkSearchResult[];
  count: number;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export const browsePublic = async ({
  collectionId,
  limit,
  offset,
  sortBy,
  sortOrder,
  signal,
}: BrowseInput): Promise<BrowseResponse> => {
  const url = new URL(
    publicSearchPath(collectionId, 'browse'),
    window.location.origin
  );
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('sort_by', sortBy);
  url.searchParams.set('sort_order', sortOrder);

  const response = await fetch(url.toString(), { signal });
  return readEnvelope<BrowseResponse>(response);
};

export const getSearchQuotaPublic = async (
  collectionId: string,
  signal?: AbortSignal
): Promise<NgaSearchQuota> => {
  const response = await fetch(publicSearchPath(collectionId, 'quota'), {
    signal,
  });
  return readEnvelope<NgaSearchQuota>(response);
};

export interface DescribeArtworkInput {
  collectionId: string;
  artworkId: string;
  model?: 'gpt-4o-mini' | 'gpt-4o';
  signal?: AbortSignal;
}

export interface DescribeArtworkResponse {
  artworkId: string;
  collectionId: string;
  caption: string;
  model: string;
  cached: boolean;
  persisted: boolean;
}

export const describeArtworkPublic = async ({
  collectionId,
  artworkId,
  model,
  signal,
}: DescribeArtworkInput): Promise<DescribeArtworkResponse> => {
  const response = await fetch('/api/public-describe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collectionId,
      artworkId,
      ...(model ? { model } : {}),
    }),
    signal,
  });
  return readEnvelope<DescribeArtworkResponse>(response);
};

/**
 * Turns an image reference into a Blob the image-search route will accept,
 * enforcing the route's own limits here so the agent gets a precise, actionable
 * message instead of a generic 400.
 *
 * Cross-origin URLs are subject to CORS: a host that does not send
 * `Access-Control-Allow-Origin` cannot be read by the page, which is why
 * `search_by_image` prefers `artworkId` (an image on Paillette's own asset
 * host) over an arbitrary `imageUrl`.
 */
export const loadImageBlob = async (
  imageUrl: string,
  signal?: AbortSignal
): Promise<Blob> => {
  let response: Response;
  try {
    response = await fetch(imageUrl, { signal, mode: 'cors' });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    throw new PailletteApiError(
      'IMAGE_FETCH_BLOCKED',
      `The browser could not read ${imageUrl}. Cross-origin images must send CORS headers; pass an artworkId from a previous search instead, or a data: URI.`,
      0
    );
  }
  if (!response.ok) {
    throw new PailletteApiError(
      'IMAGE_FETCH_FAILED',
      `Fetching ${imageUrl} returned HTTP ${response.status}.`,
      response.status
    );
  }

  const blob = await response.blob();
  if (!IMAGE_SEARCH_ALLOWED_TYPES.includes(blob.type as never)) {
    throw new PailletteApiError(
      'IMAGE_TYPE_UNSUPPORTED',
      `Image search accepts ${IMAGE_SEARCH_ALLOWED_TYPES.join(', ')}; received "${blob.type || 'unknown'}".`,
      400
    );
  }
  if (blob.size > IMAGE_SEARCH_MAX_BYTES) {
    throw new PailletteApiError(
      'IMAGE_TOO_LARGE',
      `Image search accepts files up to 10 MB; received ${(blob.size / 1024 / 1024).toFixed(1)} MB.`,
      400
    );
  }
  return blob;
};

/** Mirrors `INDEXING_CAPS.maxTotalBytes` in `apps/api/src/routes/indexing.ts`. */
export const INDEX_ARCHIVE_MAX_BYTES = 120 * 1024 * 1024;
/** Mirrors `INDEXING_CAPS.maxFileBytes`. */
export const INDEX_FILE_MAX_BYTES = 8 * 1024 * 1024;

const basenameFromUrl = (url: string): string | null => {
  if (url.startsWith('data:')) return null;
  try {
    const { pathname } = new URL(url, window.location.origin);
    const base = decodeURIComponent(pathname.split('/').pop() || '').trim();
    return base || null;
  } catch {
    return null;
  }
};

/**
 * Turns a reference the agent supplied — an https:// URL or a data: URI — into
 * a named `File`, which is what `indexZip` / `indexFiles` consume.
 *
 * Deliberately permissive about MIME: the archive parser and the server's own
 * `inferMimeType` decide what is indexable, and a data: URI frequently arrives
 * as `application/octet-stream`. Size is *not* permissive: the caps here are
 * the Worker's caps, enforced before bytes move so the agent gets a precise
 * message instead of a 413 halfway through a job.
 *
 * Same CORS caveat as `loadImageBlob`: a cross-origin host that does not send
 * `Access-Control-Allow-Origin` cannot be read by this page at all.
 */
export const loadAgentFile = async (
  url: string,
  options: {
    /** Wins when the caller knows the filename (extension drives MIME server-side). */
    name?: string;
    fallbackName: string;
    maxBytes: number;
    signal?: AbortSignal;
  }
): Promise<File> => {
  const isData = url.startsWith('data:');
  let response: Response;
  try {
    response = await fetch(
      url,
      isData ? { signal: options.signal } : { signal: options.signal, mode: 'cors' }
    );
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    throw new PailletteApiError(
      'FILE_FETCH_BLOCKED',
      `The browser could not read ${url.slice(0, 120)}. Cross-origin files must send CORS headers; pass a data: URI instead.`,
      0
    );
  }
  if (!response.ok) {
    throw new PailletteApiError(
      'FILE_FETCH_FAILED',
      `Fetching ${url.slice(0, 120)} returned HTTP ${response.status}.`,
      response.status
    );
  }

  // Bytes, not a Blob: `new File([blob], …)` silently stringifies the blob to
  // "[object Blob]" when the Response and the File come from different
  // implementations (jsdom over undici does exactly this), and a zip that
  // arrives as 15 bytes of text is indistinguishable from a corrupt archive.
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new PailletteApiError('FILE_EMPTY', `${url.slice(0, 120)} was empty.`, 400);
  }
  if (bytes.byteLength > options.maxBytes) {
    throw new PailletteApiError(
      'FILE_TOO_LARGE',
      `This accepts up to ${Math.round(options.maxBytes / (1024 * 1024))} MB; received ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB.`,
      400
    );
  }

  const name =
    options.name?.trim() || basenameFromUrl(url) || options.fallbackName;
  return new File([bytes], name, {
    type: response.headers.get('content-type') || 'application/octet-stream',
  });
};
