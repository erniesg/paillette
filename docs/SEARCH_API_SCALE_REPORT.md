# Search API Auth, Quota, and Scale Report

Last updated: 2026-05-23.

## Current Rule

NGS search is now registered-only at the API layer:

- `POST /api/v1/orgs/:orgId/search/text` requires a Logto bearer token, a personal API key, or the non-production dev user headers.
- Anonymous requests return `401 UNAUTHORIZED`.
- Valid signed-in users are tracked as `principal_type=user`.
- Valid API keys are tracked as `principal_type=api_key`.
- The daily quota defaults to `DAILY_FREE_QUERY_LIMIT` or `100`, using the current UTC date from `new Date().toISOString().slice(0, 10)`.
- Quota reservation is atomic: the update only succeeds when `used + cost <= quota`.
- Failed route responses (`>=400`) roll back the reserved quota and the usage event rows.

The public NGS demo path was removed from search auth. The NGS seed/migration also sets `settings.allowPublicAccess=false` for the NGS org, but the API no longer depends on that setting for search access.

## What Is Tested

Run:

```bash
pnpm --filter @paillette/api exec vitest run tests/routes/search.test.ts --config vitest.node.config.ts
```

Covered behavior:

- Anonymous text search returns `401`.
- Authenticated text search returns `success: true` and `data.results[]`.
- Successful searches include `X-RateLimit-Limit` and `X-RateLimit-Remaining`.
- `api_usage_daily` increments exactly once per successful query.
- Invalid/failed requests roll back `api_usage_daily`, `api_usage_events`, and `artwork_usage_events`.
- `api_usage_events` records method, path, query type, org id, auth kind, and Cloudflare/request metadata fields.
- `artwork_usage_events` records result artwork ids, ranks, and scores.
- API key calls are tracked as `principal_type=api_key`.
- 110 concurrent requests against a 100/day quota produce exactly 100 successes and 10 `429 DAILY_QUOTA_EXCEEDED` responses in the fake D1 test harness.
- Quota resets across UTC dates.

## Load Test

Script:

```bash
scripts/search-load.k6.js
```

Smoke test, intentionally small so it does not burn the quota:

```bash
API_KEY=plt_stg_... k6 run scripts/search-load.k6.js
```

Bearer-token variant:

```bash
TOKEN="$ACCESS_TOKEN" k6 run scripts/search-load.k6.js
```

Low-risk ramp/spike profile:

```bash
PROFILE=load \
API_KEY=plt_stg_... \
SUSTAIN_VUS=3 \
SPIKE_VUS=8 \
SLEEP_SECONDS=1 \
k6 run scripts/search-load.k6.js
```

Useful overrides:

- `API_BASE=https://paillette-api-stg.berlayar.ai`
- `ORG_ID=cf98791d-f3cc-4f9f-b40c-a350efadbd05`
- `QUERIES="pineapple,fishing boats,self portrait"`
- `TOP_K=10`
- `MIN_SCORE=0.3`
- `ITERATIONS=5` for smoke runs
- `--summary-export search-load-summary.json` to persist k6 output

The script records p50/p95/p99 via k6 summary stats, HTTP status mix, `429` rate-limit rate, server error rate, and app-level `data.queryTime` as `search_query_time_ms`.

## Live Load Status

No live high-RPS load run has been executed from this session because registered-only search now requires a real API key or bearer token, and `k6` is not installed locally. Start with the smoke test, then 1-3 VUs, then the ramp profile above.

During any live run, watch:

- Cloudflare Workers: requests, errors, CPU time, wall duration.
- D1: rows read, rows written, query duration.
- Vectorize: query count and queried vector dimensions.
- Workers AI: embedding latency and failure rate.
- Jina: RPM/TPM, latency, and non-2xx rate.
- App response: `data.queryTime` and `X-RateLimit-Remaining`.

## Expected Bottlenecks

For text search, the current hot path can include:

- Jina text embedding (`jina-clip-v2`/configured Jina model, default 1024 dimensions).
- Workers AI caption embedding with `@cf/baai/bge-large-en-v1.5`.
- One Vectorize query against the Jina image/text index.
- One Vectorize query against the caption index.
- One D1 metadata fallback query using `LIKE` predicates.
- One D1 artwork lookup for ranked ids.
- Usage rows in `api_usage_daily`, `api_usage_events`, and `artwork_usage_events`.

Cloudflare should not be the first scaling limit at modest traffic. The likely first limits are Jina RPM/TPM and embedding latency, then Workers AI latency, then D1 metadata scan cost if the catalog grows and the `LIKE` fallback is not replaced with FTS/indexed search. Vectorize cost and latency should remain manageable for this catalog size.

## Rough Cloudflare Cost Shape

Pricing checked against official Cloudflare docs on 2026-05-23:

- Workers Standard: 10M requests/month included, then $0.30/M; 30M CPU ms/month included, then $0.02/M CPU ms. Source: https://developers.cloudflare.com/workers/platform/pricing/
- D1 Paid: 25B rows read/month and 50M rows written/month included; then $0.001/M rows read and $1/M rows written. Source: https://developers.cloudflare.com/d1/platform/pricing/
- Vectorize Paid: first 50M queried dimensions/month included, then $0.01/M queried dimensions. Source: https://developers.cloudflare.com/vectorize/platform/pricing/
- R2 Standard: 10 GB-month free; $0.015/GB-month storage; Class B reads $0.36/M after 10M free; egress is free. Source: https://developers.cloudflare.com/r2/pricing/
- Workers AI `@cf/baai/bge-large-en-v1.5`: $0.204/M input tokens. Source: https://developers.cloudflare.com/workers-ai/platform/pricing/

Assumptions for the table below:

- 1 Worker request per search.
- 2 Vectorize queries per text search, each roughly 1024 dimensions, so about 2048 queried dimensions/search.
- 20 Workers AI input tokens/search for the caption query embedding.
- `topK=10`, so roughly 12-13 D1 written rows/search depending on whether the daily row already exists.
- R2 image reads are excluded because they depend on result browsing, not the search API call itself.
- Jina cost is excluded and must be checked against the active Jina plan.

| Searches/month | Expected CF cost |
| --- | --- |
| 1k | About the Workers Paid minimum if on Standard; D1, Vectorize, and Workers AI are effectively inside included usage. |
| 10k | Same shape as 1k; Workers minimum dominates. |
| 100k | Workers minimum dominates; Vectorize is about $1.55 after the 50M queried-dim allowance; Workers AI is about $0.41. |
| 1M | Workers minimum still covers request count; D1 writes stay below 50M at `topK=10`; Vectorize is about $20; Workers AI is about $4.08. |

These are infrastructure estimates, not a capacity measurement. The live k6 run is still required to answer the actual QPS threshold for p95/p99 degradation.

## Practical Scale Answer

The quota/auth behavior is now test-backed for exactly 100 successful searches per principal per UTC day.

The concurrency test proves the quota cannot be exceeded by a burst of simultaneous requests in the app/D1 logic. It does not prove production QPS, because production QPS is governed by external embedding latency and provider limits.

To find the real number:

1. Run the k6 smoke test with a staging API key.
2. Run `PROFILE=load` at low VUs and confirm p95, server errors, and Jina/Workers AI failures.
3. Increase `SUSTAIN_VUS` until p95 crosses the target or errors appear.
4. If Jina is first to degrade, add query embedding cache and/or a provider fallback before increasing traffic.
5. If D1 metadata scan is first to degrade, move the metadata fallback to FTS/indexed search or make it optional after vector results are healthy.
