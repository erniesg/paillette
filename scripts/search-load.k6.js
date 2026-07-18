import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const API_BASE = (
  __ENV.API_BASE || 'https://paillette-api-stg.berlayar.ai'
).replace(/\/+$/, '');
const WEB_BASE = (
  __ENV.WEB_BASE || 'https://paillette-stg.berlayar.ai'
).replace(/\/+$/, '');
const NGS_ID = __ENV.NGS_ID || 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';
const NGA_ID = __ENV.NGA_ID || 'nga';
const API_KEY = __ENV.API_KEY || '';
const TOKEN = __ENV.TOKEN || '';
const SLEEP_SECONDS = Number(__ENV.SLEEP_SECONDS || 0.2);
const QUERIES = (__ENV.QUERIES || 'pineapple,fishing boats,self portrait')
  .split(',')
  .map((query) => query.trim())
  .filter(Boolean);
const ALLOW_COLD = __ENV.ALLOW_COLD === '1';
const COLD_ITERATIONS = Math.min(
  Math.max(Number(__ENV.COLD_ITERATIONS || 1), 1),
  10
);

const userVisibleLatency = new Trend('public_search_user_visible_ms');
const responseBytes = new Trend('public_search_response_bytes');
const upstreamEmbeddings = new Counter('public_search_upstream_embeddings');
const rateLimited = new Rate('public_search_rate_limited');
const serverErrors = new Rate('public_search_server_errors');
const requestFailures = new Rate('public_search_failed_checks');

const headers = {
  'Content-Type': 'application/json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
};

const summaryTrendStats = [
  'count',
  'avg',
  'min',
  'med',
  'p(95)',
  'p(99)',
  'max',
];
const coverageBreakdowns = {
  'public_search_user_visible_ms{scope:NGS}': ['p(99)<60000'],
  'public_search_user_visible_ms{scope:NGA}': ['p(99)<60000'],
  'public_search_user_visible_ms{tier:l1-hit}': ['p(99)<60000'],
  'public_search_user_visible_ms{tier:l2-hit}': ['p(99)<60000'],
  'public_search_user_visible_ms{tier:embedding-hit-result-miss}': [
    'p(99)<60000',
  ],
  ...(ALLOW_COLD
    ? {
        'public_search_user_visible_ms{tier:fully-cold}': ['p(99)<60000'],
      }
    : {}),
};

export const options =
  __ENV.PROFILE === 'load'
    ? {
        scenarios: {
          warm_public_search: {
            executor: 'ramping-vus',
            exec: 'warmLoad',
            stages: [
              { duration: __ENV.WARMUP || '30s', target: 1 },
              {
                duration: __ENV.RAMP || '1m',
                target: Number(__ENV.SUSTAIN_VUS || 3),
              },
              {
                duration: __ENV.SUSTAIN || '2m',
                target: Number(__ENV.SUSTAIN_VUS || 3),
              },
              { duration: __ENV.RAMP_DOWN || '30s', target: 0 },
            ],
          },
        },
        thresholds: {
          ...coverageBreakdowns,
          public_search_user_visible_ms: ['p(95)<5000', 'p(99)<10000'],
          public_search_server_errors: ['rate<0.01'],
          public_search_failed_checks: ['rate<0.05'],
        },
        summaryTrendStats,
      }
    : {
        scenarios: {
          cache_coverage: {
            executor: 'shared-iterations',
            exec: 'cacheCoverage',
            vus: 1,
            iterations: 1,
            maxDuration: __ENV.MAX_DURATION || '2m',
          },
        },
        thresholds: {
          ...coverageBreakdowns,
          public_search_server_errors: ['rate<0.01'],
          public_search_failed_checks: ['rate<0.05'],
        },
        summaryTrendStats,
      };

function getHeader(response, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(response.headers)) {
    if (key.toLowerCase() === target) return String(value);
  }
  return '';
}

function record(response, scope, tier) {
  const tags = { scope, tier };
  rateLimited.add(response.status === 429, tags);
  serverErrors.add(response.status >= 500, tags);
  userVisibleLatency.add(response.timings.duration, tags);
  responseBytes.add(response.body ? response.body.length : 0, tags);
  upstreamEmbeddings.add(
    Number(getHeader(response, 'X-Paillette-Upstream-Embeddings')) || 0,
    tags
  );

  const ok = check(
    response,
    {
      'status is 200 or 429': (value) =>
        value.status === 200 || value.status === 429,
      'diagnostic contract headers are present': (value) =>
        value.status !== 200 ||
        (Boolean(getHeader(value, 'X-Paillette-Search-Cache')) &&
          Boolean(getHeader(value, 'X-Paillette-Upstream-Embeddings')) &&
          Boolean(getHeader(value, 'X-Paillette-Embedding-Cache')) &&
          Boolean(getHeader(value, 'X-Paillette-Search-Path')) &&
          Boolean(getHeader(value, 'X-Paillette-Search-Contract')) &&
          Boolean(getHeader(value, 'Server-Timing'))),
    },
    tags
  );
  requestFailures.add(!ok, tags);
  return response;
}

function apiSearch(scope, query, tier) {
  const orgId = scope === 'NGA' ? NGA_ID : NGS_ID;
  return record(
    http.post(
      `${API_BASE}/api/v1/orgs/${orgId}/search/text`,
      JSON.stringify({ query, topK: 100, minScore: 0 }),
      { headers, tags: { scope, tier } }
    ),
    scope,
    tier
  );
}

function webSearch(scope, query, tier) {
  const orgId = scope === 'NGA' ? 'nga' : 'ngs';
  return record(
    http.post(
      `${WEB_BASE}/api/public-search/${orgId}/text`,
      JSON.stringify({ query, topK: 30, minScore: 0.2 }),
      { headers: { 'Content-Type': 'application/json' }, tags: { scope, tier } }
    ),
    scope,
    tier
  );
}

export function cacheCoverage() {
  if (!TOKEN && !API_KEY) {
    throw new Error(
      'Cache coverage requires TOKEN or API_KEY for direct API stages'
    );
  }

  const baseQuery = QUERIES[0];

  // L1: the second web request should be served by the edge response cache.
  webSearch('NGS', `${baseQuery} l1 coverage`, 'l1-prime');
  webSearch('NGS', `${baseQuery} l1 coverage`, 'l1-hit');

  // L2: prime API KV directly, then miss web L1 and hit the API result cache.
  apiSearch('NGA', `${baseQuery} l2 coverage`, 'l2-prime');
  webSearch('NGA', `${baseQuery} l2 coverage`, 'l2-hit');

  // Same embedding identity, different result identity: embedding hit/result miss.
  const sharedEmbeddingQuery = `${baseQuery} embedding coverage`;
  apiSearch('NGS', sharedEmbeddingQuery, 'embedding-prime');
  apiSearch('NGA', sharedEmbeddingQuery, 'embedding-hit-result-miss');

  // Fully-cold work is explicit and capped at ten requests per invocation.
  if (ALLOW_COLD) {
    for (let index = 0; index < COLD_ITERATIONS; index += 1) {
      apiSearch(
        index % 2 === 0 ? 'NGS' : 'NGA',
        `bounded cold coverage ${Date.now()} ${index}`,
        'fully-cold'
      );
    }
  }
}

export function warmLoad() {
  const scope = __ITER % 2 === 0 ? 'NGS' : 'NGA';
  webSearch(scope, QUERIES[__ITER % QUERIES.length], 'warm-load');
  sleep(SLEEP_SECONDS);
}

export function handleSummary(data) {
  const baseline = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    benchmark: 'public-search-cache-coverage',
    scopes: ['NGS', 'NGA'],
    tiers: [
      'l1-hit',
      'l2-hit',
      'embedding-hit-result-miss',
      ...(ALLOW_COLD ? ['fully-cold'] : []),
    ],
    metrics: data.metrics,
    caveats: [
      'D1 rows are emitted by structured Worker diagnostics and must be joined from Worker logs.',
      'Fully-cold requests are disabled unless ALLOW_COLD=1 and capped at ten.',
    ],
  };
  const costUnits = {
    schema_version: 1,
    generated_at: baseline.generated_at,
    upstream_embedding_calls:
      data.metrics.public_search_upstream_embeddings?.values?.count || 0,
    response_bytes:
      (data.metrics.public_search_response_bytes?.values?.avg || 0) *
      (data.metrics.public_search_response_bytes?.values?.count || 0),
    d1_rows_read: null,
    d1_rows_written: null,
    caveat:
      'Join d1 rows_read/rows_written from the public_search Worker events.',
  };

  return {
    stdout: JSON.stringify(
      { benchmark: baseline.benchmark, caveats: baseline.caveats },
      null,
      2
    ),
    'tmp/public-search-baseline.json': JSON.stringify(baseline, null, 2),
    'tmp/public-search-cost-units.json': JSON.stringify(costUnits, null, 2),
  };
}
