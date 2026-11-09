# Search stage traces

The API emits one JSON `search_trace` event (version 1) for each foreground text
or image search, including authentication/quota rejection, invalid input and
errors. `traceId` is generated locally, not taken from a caller, and returned as
`X-Paillette-Search-Request-Id` for proxy/log correlation. No trace payload is
added to the response body.

- `totalMs` is monotonic wall time from search observation middleware entry
  (before the API's shared authentication boundary) through awaited
  downstream middleware, including usage annotation and artwork-result telemetry.
  It is **not** the response's `queryTime` (which can be cached or historical).
- `spans` contain fixed `stage` labels, start offsets (`startMs`), durations and
  `ok`/`error`/`timeout`/`skipped` status. Sort by start offset to see overlap. Do not add
  durations: retrieval, embedding/model, vector and metadata spans can overlap
  or nest. Uninstrumented synchronous planning/filtering appears in wall time.
- `auth_quota` ends at handler entry (or rejection). `request_limit` and
  `quota_reservation` measure NGA preflight separately. `artist_check`, `intent`,
  `metadata`, `hydration` and `visual_refinement` separate other retrieval costs.
- Embedding stages distinguish `image`, `caption` and `refinement` channels;
  `*_cache` measures KV reads, `*_generate` model calls, and `*_wait` a follower's
  wait for coalesced work. Only the owner records cache/model work. Cloudflare
  caption generation and uploaded images currently bypass the embedding cache.
  `attempts` explicitly counts actual embedding generation and Vectorize query
  starts by channel, plus each refinement `getByIds` chunk (20 IDs per call).
  Cache hits and coalesced followers start at zero; owner counts are never replayed.
  Counts cover attempts started before finalization. If a parallel fail-open
  branch leaves a sibling that starts its provider call after response completion,
  a separate `search_tail_attempt` event records its fixed counter increment
  with the parent `traceId` and `work: background_tail`; aggregate these with
  foreground counts for total provider work. No response wait is added.
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
- `d1` aggregates returned `meta.rows_read`, `meta.rows_written` and
  `meta.duration` (provider milliseconds), plus returned statement counts, under
  `artist_check`, `metadata` (including attribution and facet pages), and
  `hydration`. No SQL or additional queries are used. If any statement omits a
  numeric field, that stage's aggregate field is `null` (unknown), not zero.
  No entry means no returned statement observed; failed queries have error
  spans but no returned D1 cost. Compare scan rows with candidate/result counts.
- `context` contains only `nga`/`ngs`/`other` scope, bounded path/intent labels,
  the source contract version and allowlisted `v1`/`v2` index identity. Before
  scope resolution it remains `other`/`unresolved`/`unknown`. Cache hits report
  planned routing context, not a replay of the owner's resolved artist/collection
  intent. `routedIntent` records the actual hybrid route after metadata-based
  refinement; it remains `skipped` when that routing step did not execute.
  `degradedChannels` and `errorCategory` use fixed categories; provider messages
  and arbitrary environment/model/index strings are never attached.
- `responseBytes` uses an already-available Content-Length, otherwise `null`.
  There is no async response buffering. KV JSON reads do not expose original
  serialized byte size, so read sizes remain unavailable. Serialized KV write
  byte sizes are emitted as separate `search_cache_write` events with parent
  `traceId`, channel, status and `work: background_persistence`, even if the
  foreground event is already finished. These bytes describe the attempted
  serialized value, not the provider's transfer size; `skipped` means oversize.
- Optional `result_telemetry` is `skipped` without an eligible usage event or
  results, `error` on the existing caught write failure, and `ok` on success.
  Failures remain nonfatal.

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
and cache outcomes retain their own failures. Result telemetry explicitly
returns its fixed outcome from the helper's catch/no-op boundary.

## Response and proxy diagnostics

The API adds bounded embedding-count/cache, search-path/contract and request-ID
headers alongside the existing result-cache header. `Server-Timing` includes
fixed stage durations (repeated stages are summed, so concurrent chunks can
exceed wall time) and `total`. These are timings for the current request, not
cached values. The public text proxy preserves only validated diagnostic
headers and fixed timing labels, then appends `public_proxy` through response
construction. One `public_search_proxy` event per request records sanitized
requested numeric K (null if missing/non-numeric or outside ±1,000,000),
normalized/defaulted K and canonical upstream K, total wall milliseconds,
upstream fetch-plus-body-decode milliseconds (null if not executed), status,
scope and the generated API request ID where available. It never logs payloads.
The API event and proxy event separate server work from upstream round-trip and
proxy overhead without relying on historical `queryTime`.

The existing response `queryTime` contract is deliberately unchanged: KV hits
can return zero and coalesced results can contain the owner's historical time.
This remains an issue #49 gap; use new request wall events/headers as authoritative.
Live warm-result, embedding-hit/result-miss and cold load matrices, percentile
baselines, runtime overhead and activation are not established by source tests.
Refs #49, not completion of #49.

These are server measurements, not browser network timings or paints. Work
before entry into the search observation middleware and background persistence are outside the
foreground total. Tests use fake/deferred clocks and mocked providers; a live
authenticated provider/browser test is not yet available.
