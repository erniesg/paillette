# Search stage traces

The API emits one JSON `search_trace` event (version 1) for each foreground text
or image search, including authentication/quota rejection, invalid input and
errors. `traceId` is generated locally, not taken from a caller. It is log-only:
no trace details or correlation headers are added to public responses.

- `totalMs` is monotonic wall time from search observation middleware entry
  (before the API's shared authentication boundary) through awaited
  downstream middleware, including usage annotation and artwork-result telemetry.
  It is **not** the response's `queryTime` (which can be cached or historical).
- `spans` contain fixed `stage` labels, start offsets (`startMs`), durations and
  `ok`/`error`/`timeout` status. Sort by start offset to see overlap. Do not add
  durations: retrieval, embedding/model, vector and metadata spans can overlap
  or nest. Uninstrumented synchronous planning/filtering appears in wall time.
- `auth_quota` ends at handler entry (or rejection). `request_limit` and
  `quota_reservation` measure NGA preflight separately. `artist_check`, `intent`,
  `metadata`, `hydration` and `visual_refinement` separate other retrieval costs.
- Embedding stages distinguish `image`, `caption` and `refinement` channels;
  `*_cache` measures KV reads, `*_generate` model calls, and `*_wait` a follower's
  wait for coalesced work. Only the owner records cache/model work. Cloudflare
  caption generation and uploaded images currently bypass the embedding cache.
- `caches` reports result and embedding outcomes: hit, miss, stale, coalesced,
  timeout, error, bypass or spotlight. A KV timeout/error can still produce a
  successful search via the existing fallback. Invalid cache entries are misses.
  Background writes are not foreground spans. Missing stages mean work was not
  performed by this request, not zero-cost provider work.
- `counts.requestedTopK` is the validated/defaulted text value or numeric image
  request value (when finite). `effectiveTopK` is the retrieval input after plan
  expansion, `imageTopK`/`captionTopK` the actual Vectorize limits, and
  `metadataTopK` the SQL retrieval limit. Raw per-channel
  candidate counts precede fusion; `candidates` is the text retrieval pool
  before final filtering/reranking (or the image vector pool before hydration),
  and `results` is the returned count. Counts
  for work skipped by cache hits/spotlights are absent; they are not copied from
  the cache owner. Metadata-only/facet paths have no vector/embedding spans.

Stale cache refreshes emit a separate event with `work: background_refresh` and
an independent ID/clock; their spans never belong to the foreground hit. Their
`httpStatus` is a synthetic load outcome (200/500), not another HTTP response.
A follower records its own wait, never the owner's start time or model spans.

New trace events contain only fixed labels, generated IDs, statuses and numeric
measurements: no query text, image data/names, vectors, cache keys, organization
or user identities, URLs, provider error messages or credentials. Existing usage
telemetry/error logging is unchanged. Provider timeout classification is best
effort from error type/message; it does not alter failure handling. Helpers that
already swallow provider failures may report an OK outer stage; KV read stages
and cache outcomes retain their own failures.

These are server measurements, not browser network timings or paints. Work
before entry into the search observation middleware and background persistence are outside the
foreground total. Tests use fake/deferred clocks and mocked providers; a live
authenticated provider/browser test is not yet available.
