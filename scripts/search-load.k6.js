import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const API_BASE = (__ENV.API_BASE || 'https://paillette-api-stg.berlayar.ai').replace(/\/+$/, '');
const ORG_ID = __ENV.ORG_ID || '00000000-0000-4000-8000-000000000101';
const API_KEY = __ENV.API_KEY || '';
const TOKEN = __ENV.TOKEN || '';
const TOP_K = Number(__ENV.TOP_K || 10);
const MIN_SCORE = Number(__ENV.MIN_SCORE || 0.3);
const SLEEP_SECONDS = Number(__ENV.SLEEP_SECONDS || 1);
const QUERIES = (__ENV.QUERIES || 'pineapple,fishing boats,self portrait')
  .split(',')
  .map((query) => query.trim())
  .filter(Boolean);

const searchQueryTime = new Trend('search_query_time_ms');
const rateLimited = new Rate('search_rate_limited');
const serverErrors = new Rate('search_server_errors');
const requestFailures = new Rate('search_failed_checks');

function getHeader(response, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(response.headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return '';
}

const headers = {
  'Content-Type': 'application/json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
};

export const options =
  __ENV.PROFILE === 'load'
    ? {
        scenarios: {
          warmup_ramp_sustain_spike: {
            executor: 'ramping-vus',
            stages: [
              { duration: __ENV.WARMUP || '30s', target: Number(__ENV.WARMUP_VUS || 1) },
              { duration: __ENV.RAMP || '1m', target: Number(__ENV.SUSTAIN_VUS || 3) },
              { duration: __ENV.SUSTAIN || '2m', target: Number(__ENV.SUSTAIN_VUS || 3) },
              { duration: __ENV.SPIKE || '30s', target: Number(__ENV.SPIKE_VUS || 8) },
              { duration: __ENV.RAMP_DOWN || '30s', target: 0 },
            ],
          },
        },
        summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
        thresholds: {
          http_req_duration: ['p(95)<5000', 'p(99)<10000'],
          search_server_errors: ['rate<0.01'],
          search_failed_checks: ['rate<0.05'],
        },
      }
    : {
        scenarios: {
          smoke: {
            executor: 'shared-iterations',
            vus: Number(__ENV.VUS || 1),
            iterations: Number(__ENV.ITERATIONS || 5),
            maxDuration: __ENV.MAX_DURATION || '1m',
          },
        },
        summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
        thresholds: {
          search_server_errors: ['rate<0.01'],
          search_failed_checks: ['rate<0.05'],
        },
      };

export default function () {
  if (!TOKEN && !API_KEY) {
    throw new Error('Registered-only search requires TOKEN or API_KEY');
  }

  const query = QUERIES[__ITER % QUERIES.length];
  const response = http.post(
    `${API_BASE}/api/v1/orgs/${ORG_ID}/search/text`,
    JSON.stringify({ query, topK: TOP_K, minScore: MIN_SCORE }),
    { headers, tags: { query } }
  );

  rateLimited.add(response.status === 429);
  serverErrors.add(response.status >= 500);

  const ok = check(response, {
    'status is 200 or 429': (res) => res.status === 200 || res.status === 429,
    '200 response has success true': (res) =>
      res.status !== 200 || Boolean(res.json('success')),
    'rate limit headers present': (res) =>
      res.status === 429 ||
      (Boolean(getHeader(res, 'X-RateLimit-Limit')) &&
        Boolean(getHeader(res, 'X-RateLimit-Remaining'))),
  });
  requestFailures.add(!ok);

  if (response.status === 200) {
    const queryTime = Number(response.json('data.queryTime'));
    if (Number.isFinite(queryTime)) {
      searchQueryTime.add(queryTime);
    }
  }

  sleep(SLEEP_SECONDS);
}
