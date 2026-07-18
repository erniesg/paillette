import { PUBLIC_SEARCH_CONTRACT_VERSION } from '@paillette/types/public-search';

export const PUBLIC_SEARCH_TIMING_STAGES = [
  'result_kv',
  'artist_lookup',
  'image_embedding_cache',
  'image_embedding_upstream',
  'image_vectorize',
  'caption_embedding_cache',
  'caption_embedding_upstream',
  'caption_vectorize',
  'metadata',
  'hydration',
  'usage',
  'telemetry',
] as const;

export type PublicSearchTimingStage =
  (typeof PUBLIC_SEARCH_TIMING_STAGES)[number];
export type PublicSearchEmbeddingChannel = 'image' | 'caption';
export type PublicSearchEmbeddingDisposition =
  | 'hit'
  | 'miss'
  | 'coalesced'
  | 'bypass'
  | 'not-needed';

type D1Meta = {
  duration?: number;
  rows_read?: number;
  rows_written?: number;
};

export type PublicSearchObservation = {
  startedAt: number;
  timings: Record<PublicSearchTimingStage, number>;
  upstreamEmbeddings: Record<PublicSearchEmbeddingChannel, number>;
  vectorizeCalls: Record<PublicSearchEmbeddingChannel, number>;
  embeddingCache: Record<
    PublicSearchEmbeddingChannel,
    PublicSearchEmbeddingDisposition
  >;
  d1: { rowsRead: number; rowsWritten: number; durationMs: number };
  cacheValueBytes: number;
  routedIntent: string;
};

export const createPublicSearchObservation = (): PublicSearchObservation => ({
  startedAt: performance.now(),
  timings: Object.fromEntries(
    PUBLIC_SEARCH_TIMING_STAGES.map((stage) => [stage, 0])
  ) as Record<PublicSearchTimingStage, number>,
  upstreamEmbeddings: { image: 0, caption: 0 },
  vectorizeCalls: { image: 0, caption: 0 },
  embeddingCache: { image: 'not-needed', caption: 'not-needed' },
  d1: { rowsRead: 0, rowsWritten: 0, durationMs: 0 },
  cacheValueBytes: 0,
  routedIntent: 'unknown',
});

export const addPublicSearchTiming = (
  observation: PublicSearchObservation | undefined,
  stage: PublicSearchTimingStage,
  durationMs: number
) => {
  if (!observation || !Number.isFinite(durationMs)) return;
  observation.timings[stage] += Math.max(durationMs, 0);
};

export const measurePublicSearchStage = async <T>(
  observation: PublicSearchObservation | undefined,
  stage: PublicSearchTimingStage,
  operation: () => Promise<T>
): Promise<T> => {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    addPublicSearchTiming(observation, stage, performance.now() - startedAt);
  }
};

export const recordPublicSearchD1 = (
  observation: PublicSearchObservation | undefined,
  result: { meta?: D1Meta }
) => {
  if (!observation) return;
  const meta = result.meta;
  observation.d1.rowsRead += Number(meta?.rows_read || 0);
  observation.d1.rowsWritten += Number(meta?.rows_written || 0);
  observation.d1.durationMs += Number(meta?.duration || 0);
};

const duration = (value: number) =>
  Number.isFinite(value) ? Math.max(value, 0).toFixed(1) : '0.0';

export const buildPublicSearchServerTiming = (
  observation: PublicSearchObservation,
  totalMs = performance.now() - observation.startedAt
) =>
  [
    ...PUBLIC_SEARCH_TIMING_STAGES.map(
      (stage) => `${stage};dur=${duration(observation.timings[stage])}`
    ),
    `total;dur=${duration(totalMs)}`,
  ].join(', ');

export const getPublicSearchErrorClass = (error: unknown) => {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return 'timeout';
    }
    if (error.name === 'TypeError') return 'invalid_runtime_response';
  }
  return 'upstream_or_internal';
};

export const getPublicSearchScope = (
  requestedOrgId: string | undefined,
  provider: string | undefined
) =>
  provider === 'nga' || requestedOrgId?.toLowerCase() === 'nga' ? 'NGA' : 'NGS';

export type PublicSearchStructuredEventInput = {
  observation: PublicSearchObservation;
  requestedOrgId?: string;
  provider?: string;
  cacheDisposition: string;
  embeddingIndexVersion: string;
  fusionMode: string;
  imageModel: string;
  captionModel: string;
  degradedChannels: string[];
  resultCount: number;
  responseBytes: number;
  errorClass?: string | null;
};

export const buildPublicSearchStructuredEvent = ({
  observation,
  requestedOrgId,
  provider,
  cacheDisposition,
  embeddingIndexVersion,
  fusionMode,
  imageModel,
  captionModel,
  degradedChannels,
  resultCount,
  responseBytes,
  errorClass = null,
}: PublicSearchStructuredEventInput) => ({
  event: 'public_search',
  scope: getPublicSearchScope(requestedOrgId, provider),
  routed_intent: observation.routedIntent,
  cache_disposition: cacheDisposition,
  revisions: {
    contract: PUBLIC_SEARCH_CONTRACT_VERSION,
    embedding_index: embeddingIndexVersion,
    fusion: fusionMode,
    image_model: imageModel,
    caption_model: captionModel,
  },
  channels: {
    image: {
      embedding_cache: observation.embeddingCache.image,
      upstream_embeddings: observation.upstreamEmbeddings.image,
      vectorize_calls: observation.vectorizeCalls.image,
      degraded: degradedChannels.includes('image_embedding'),
    },
    caption: {
      embedding_cache: observation.embeddingCache.caption,
      upstream_embeddings: observation.upstreamEmbeddings.caption,
      vectorize_calls: observation.vectorizeCalls.caption,
      degraded: degradedChannels.includes('caption_embedding'),
    },
    metadata: {
      degraded: degradedChannels.includes('metadata'),
    },
  },
  d1: {
    rows_read: observation.d1.rowsRead,
    rows_written: observation.d1.rowsWritten,
    duration_ms: Number(duration(observation.d1.durationMs)),
  },
  response_bytes: responseBytes,
  cache_value_bytes: observation.cacheValueBytes,
  result_count: resultCount,
  degraded: degradedChannels.length > 0,
  degraded_channels: degradedChannels,
  error_class: errorClass,
});
