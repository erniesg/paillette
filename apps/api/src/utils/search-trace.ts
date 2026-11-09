import { PUBLIC_SEARCH_CONTRACT_VERSION } from '@paillette/types/public-search';

// Only fixed labels and numeric measurements belong here; never attach request data.
export type SearchStage =
  | 'auth_quota'
  | 'scope'
  | 'request_parse'
  | 'request_limit'
  | 'quota_reservation'
  | 'intent'
  | 'artist_check'
  | 'retrieval'
  | 'metadata'
  | 'hydration'
  | 'visual_refinement'
  | 'vector_image'
  | 'vector_caption'
  | 'vector_get_by_ids'
  | 'embedding_image_cache'
  | 'embedding_caption_cache'
  | 'embedding_refinement_cache'
  | 'embedding_image_generate'
  | 'embedding_caption_generate'
  | 'embedding_refinement_generate'
  | 'embedding_image_wait'
  | 'embedding_caption_wait'
  | 'embedding_refinement_wait'
  | 'result_cache'
  | 'result_cache_read'
  | 'result_cache_wait'
  | 'usage_annotation'
  | 'result_telemetry';
export type SpanStatus = 'ok' | 'error' | 'timeout' | 'skipped';
export type CacheOutcome =
  | 'hit'
  | 'miss'
  | 'stale'
  | 'coalesced'
  | 'timeout'
  | 'error'
  | 'bypass'
  | 'spotlight';
export type EmbeddingChannel = 'image' | 'caption' | 'refinement';
type Counts =
  | 'requestedTopK'
  | 'effectiveTopK'
  | 'imageTopK'
  | 'captionTopK'
  | 'metadataTopK'
  | 'imageCandidates'
  | 'captionCandidates'
  | 'metadataCandidates'
  | 'candidates'
  | 'results';

export const searchErrorStatus = (error: unknown): SpanStatus => {
  // Best effort only. Never serialize provider messages or change error handling.
  return error instanceof Error &&
    /timeout|timed out|deadline/i.test(`${error.name} ${error.message}`)
    ? 'timeout'
    : 'error';
};

export class SearchTrace {
  private readonly started: number;
  private readonly id = crypto.randomUUID();
  private readonly spans: Array<{
    stage: SearchStage;
    startMs: number;
    durationMs: number;
    status: SpanStatus;
  }> = [];
  private readonly counts: Partial<Record<Counts, number>> = {};
  private readonly caches: Partial<
    Record<'result' | EmbeddingChannel, CacheOutcome>
  > = {};
  private finished = false;
  private context: {
    scope: string;
    path: string;
    intent: string;
    routedIntent: string;
    contract: string;
    index: string;
  } = {
    scope: 'other',
    path: 'unresolved',
    intent: 'unresolved',
    routedIntent: 'skipped',
    contract: PUBLIC_SEARCH_CONTRACT_VERSION,
    index: 'unknown',
  };
  private readonly attempts = {
    embedding_image: 0,
    embedding_caption: 0,
    embedding_refinement: 0,
    vector_image: 0,
    vector_caption: 0,
    vector_get_by_ids: 0,
  };
  private readonly d1: Partial<
    Record<
      'artist_check' | 'metadata' | 'hydration',
      {
        statements: number;
        rows_read: number | null;
        rows_written: number | null;
        duration: number | null;
      }
    >
  > = {};
  private readonly degraded = new Set<string>();
  private responseBytes: number | null = null;

  setContext(context: {
    scope?: 'nga' | 'ngs' | 'other';
    path?:
      | 'hybrid'
      | 'legacy'
      | 'metadata'
      | 'artist'
      | 'classification'
      | 'image';
    intent?: string;
    routedIntent?: string;
    index?: 'v1' | 'v2';
  }) {
    if (this.finished) return;
    for (const key of ['scope', 'path', 'index'] as const) {
      const value = context[key];
      if (value) this.context[key] = value;
    }
    if (context.routedIntent)
      this.context.routedIntent = [
        'balanced',
        'artist_exact',
        'accession_exact',
        'color_visual',
        'medium_exact',
        'temporal',
        'formal_visual',
        'title_exact',
      ].includes(context.routedIntent)
        ? context.routedIntent
        : 'other';
    if (context.intent)
      this.context.intent = [
        'structured',
        'semantic',
        'relational',
        'attribution',
        'artist_exact',
        'artist',
        'classification',
        'collection',
        'image',
      ].includes(context.intent)
        ? context.intent
        : 'other';
  }

  degradation(channels: Iterable<string>) {
    if (this.finished) return;
    for (const channel of channels) {
      if (
        [
          'image_embedding',
          'caption_embedding',
          'visual_refinement',
          'metadata',
        ].includes(channel)
      )
        this.degraded.add(channel);
    }
  }

  observeD1(stage: 'artist_check' | 'metadata' | 'hydration', meta: unknown) {
    if (this.finished) return;
    const value = (this.d1[stage] ||= {
      statements: 0,
      rows_read: 0,
      rows_written: 0,
      duration: 0,
    });
    value.statements++;
    const fields =
      meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
    for (const key of ['rows_read', 'rows_written', 'duration'] as const) {
      const number = fields[key];
      value[key] =
        value[key] !== null &&
        typeof number === 'number' &&
        Number.isFinite(number) &&
        number >= 0
          ? value[key] + number
          : null;
    }
  }

  // Persistence is not foreground work, even if serialization occurs before finish.
  cacheWrite(
    channel: 'result' | EmbeddingChannel,
    bytes: number,
    status: 'ok' | 'error' | 'skipped'
  ) {
    try {
      this.emit({
        event: 'search_cache_write',
        traceId: this.id,
        work: 'background_persistence',
        channel,
        bytes,
        status,
      });
    } catch {
      /* fail open */
    }
  }

  headers(): Record<string, string> {
    const durations = new Map<SearchStage, number>();
    for (const span of this.spans)
      durations.set(
        span.stage,
        (durations.get(span.stage) || 0) + span.durationMs
      );
    const timing = [...durations].map(
      ([stage, duration]) => `${stage};dur=${duration.toFixed(2)}`
    );
    timing.push(`total;dur=${(this.clock() - this.started).toFixed(2)}`);
    return {
      'X-Paillette-Search-Request-Id': this.id,
      'X-Paillette-Embedding-Count': String(
        this.attempts.embedding_image +
          this.attempts.embedding_caption +
          this.attempts.embedding_refinement
      ),
      'X-Paillette-Embedding-Cache': (
        ['image', 'caption', 'refinement'] as const
      )
        .map((channel) => `${channel}:${this.caches[channel] || 'skipped'}`)
        .join(','),
      'X-Paillette-Search-Path': this.context.path,
      'X-Paillette-Search-Contract': PUBLIC_SEARCH_CONTRACT_VERSION,
      'Server-Timing': timing.join(', '),
    };
  }

  responseSize(value: string | null) {
    if (value && /^\d+$/.test(value)) this.responseBytes = Number(value);
  }

  constructor(
    private readonly mode: 'text' | 'image',
    private readonly work: 'foreground' | 'background_refresh' = 'foreground',
    private readonly clock: () => number = () => performance.now(),
    private readonly emit: (event: unknown) => void = (event) =>
      console.log(JSON.stringify(event))
  ) {
    this.started = clock();
  }

  count(name: Counts, value: number) {
    if (!this.finished && Number.isFinite(value)) this.counts[name] = value;
  }

  cache(name: 'result' | EmbeddingChannel, outcome: CacheOutcome) {
    if (!this.finished) this.caches[name] = outcome;
  }

  start(stage: SearchStage) {
    const start = this.clock();
    let attempt: keyof typeof this.attempts | undefined;
    if (
      stage === 'vector_image' ||
      stage === 'vector_caption' ||
      stage === 'vector_get_by_ids'
    )
      attempt = stage;
    for (const channel of ['image', 'caption', 'refinement'] as const) {
      if (stage === `embedding_${channel}_generate`)
        attempt = `embedding_${channel}`;
    }
    if (attempt) {
      if (!this.finished) this.attempts[attempt]++;
      else {
        // Promise.all fail-open paths can leave already-launched sibling work.
        // Do not delay the response or mutate the finished foreground event.
        try {
          this.emit({
            event: 'search_tail_attempt',
            traceId: this.id,
            work: 'background_tail',
            attempts: { [attempt]: 1 },
          });
        } catch {
          /* fail open */
        }
      }
    }
    let ended = false;
    return (status: SpanStatus = 'ok') => {
      if (ended || this.finished) return;
      ended = true;
      this.spans.push({
        stage,
        startMs: start - this.started,
        durationMs: this.clock() - start,
        status,
      });
    };
  }

  async run<T>(stage: SearchStage, operation: () => Promise<T>): Promise<T> {
    const end = this.start(stage);
    try {
      const value = await operation();
      end();
      return value;
    } catch (error) {
      end(searchErrorStatus(error));
      throw error;
    }
  }

  finish(httpStatus: number) {
    if (this.finished) return;
    this.finished = true;
    try {
      this.emit({
        event: 'search_trace',
        version: 1,
        traceId: this.id,
        mode: this.mode,
        work: this.work,
        httpStatus,
        totalMs: this.clock() - this.started,
        context: this.context,
        attempts: this.attempts,
        d1: this.d1,
        responseBytes: this.responseBytes,
        degradedChannels: [...this.degraded].sort(),
        errorCategory:
          httpStatus >= 500
            ? 'server'
            : httpStatus >= 400
              ? 'rejected'
              : this.spans.some((span) => span.status === 'timeout')
                ? 'timeout'
                : this.spans.some((span) => span.status === 'error')
                  ? 'dependency'
                  : null,
        counts: this.counts,
        caches: this.caches,
        spans: this.spans,
      });
    } catch {
      /* Observability must not break search. */
    }
  }
}

export const traceSearchStage = <T>(
  trace: SearchTrace | undefined,
  stage: SearchStage,
  operation: () => Promise<T>
): Promise<T> => (trace ? trace.run(stage, operation) : operation());
