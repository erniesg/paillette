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
export type SpanStatus = 'ok' | 'error' | 'timeout';
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
