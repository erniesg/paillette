# Load Testing Guide for Paillette

This document outlines the load testing strategy and configuration for the Paillette application.

## Tools

We recommend using [k6](https://k6.io/) for load testing as it integrates well with Cloudflare Workers.

### Installation

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

## Load Test Scenarios

### 1. API Endpoint Load Test (k6-api.js)

Create `k6-api.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 20 },  // Ramp up to 20 users
    { duration: '3m', target: 20 },  // Stay at 20 users
    { duration: '1m', target: 50 },  // Ramp up to 50 users
    { duration: '3m', target: 50 },  // Stay at 50 users
    { duration: '1m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],   // Error rate under 1%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Test homepage
  let res = http.get(`${BASE_URL}/`);
  check(res, {
    'homepage status 200': (r) => r.status === 200,
    'homepage load time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);

  // Test API health endpoint
  res = http.get(`${BASE_URL}/api/health`);
  check(res, {
    'health check status 200': (r) => r.status === 200,
    'health check time < 100ms': (r) => r.timings.duration < 100,
  });

  sleep(1);
}
```

Run with:
```bash
k6 run k6-api.js
# or with custom base URL
k6 run --env BASE_URL=https://your-app.pages.dev k6-api.js
```

### 2. Frame Processing Load Test (k6-processing.js)

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    frame_processing: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 5 },
        { duration: '2m', target: 5 },
        { duration: '30s', target: 10 },
        { duration: '2m', target: 10 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'], // Frame processing can take longer
    http_req_failed: ['rate<0.05'],     // 5% error rate acceptable for processing
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const GALLERY_ID = __ENV.GALLERY_ID || 'test-gallery';

export default function () {
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  // Test get processing stats
  let res = http.get(
    `${BASE_URL}/api/galleries/${GALLERY_ID}/processing-stats`,
    params
  );

  check(res, {
    'stats endpoint status 200': (r) => r.status === 200,
    'stats response time < 300ms': (r) => r.timings.duration < 300,
  });

  sleep(2);
}
```

### 3. Search Load Test (k6-search.js)

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<200'], // Search should be fast
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const GALLERY_ID = __ENV.GALLERY_ID || 'test-gallery';

const SEARCH_QUERIES = [
  'landscape',
  'portrait',
  'van gogh',
  'impressionism',
  'modern',
];

export default function () {
  const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];

  const res = http.get(
    `${BASE_URL}/api/galleries/${GALLERY_ID}/search?q=${query}`,
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );

  check(res, {
    'search status 200': (r) => r.status === 200,
    'search time < 200ms': (r) => r.timings.duration < 200,
    'results returned': (r) => {
      const body = JSON.parse(r.body);
      return body.results && body.results.length >= 0;
    },
  });

  sleep(1);
}
```

## Performance Targets

### Response Time Targets
- **Homepage**: < 500ms (p95)
- **API Health Check**: < 100ms (p95)
- **Search**: < 200ms (p95)
- **Frame Processing Status**: < 300ms (p95)
- **Frame Processing Job**: < 5s (p95)

### Throughput Targets
- **Concurrent Users**: Support 50+ concurrent users
- **Requests/Second**: Handle 100+ req/s on API endpoints
- **Search Queries**: Handle 50+ concurrent searches

### Error Rate Targets
- **General Endpoints**: < 1% error rate
- **Processing Endpoints**: < 5% error rate (acceptable for async processing)

## Running Load Tests

### Local Testing
```bash
# Start local dev server
pnpm dev

# In another terminal, run load tests
k6 run k6-api.js
k6 run k6-search.js
```

### Production Testing
```bash
# Set your production URL
export BASE_URL=https://paillette.pages.dev
export GALLERY_ID=your-real-gallery-id

k6 run k6-api.js
k6 run k6-processing.js
k6 run k6-search.js
```

### CI/CD Integration
```bash
# Add to GitHub Actions workflow
- name: Run load tests
  run: |
    k6 run --out json=results.json k6-api.js
    k6 run --out json=results-search.json k6-search.js
```

## Monitoring & Metrics

When running load tests, monitor:

1. **Cloudflare Analytics**
   - Request rate
   - Error rate
   - Response time percentiles
   - Cache hit ratio

2. **D1 Database Metrics**
   - Query execution time
   - Connection pool utilization
   - Read/write operations per second

3. **R2 Storage**
   - Object read/write operations
   - Bandwidth usage
   - Request latency

4. **Worker CPU Time**
   - CPU time per request
   - Wall clock time
   - Memory usage

## Optimization Recommendations

Based on load testing results:

1. **Enable caching** for static assets and frequently accessed data
2. **Use pagination** for large result sets
3. **Implement rate limiting** to prevent abuse
4. **Use batching** for bulk operations
5. **Monitor and optimize** D1 query performance
6. **Use vector search** optimizations for large galleries
7. **Implement CDN caching** for images via R2

## Troubleshooting

### High Response Times
- Check Cloudflare Worker CPU time
- Review D1 query execution plans
- Verify R2 access patterns
- Check for N+1 query problems

### High Error Rates
- Review Worker error logs
- Check D1 connection limits
- Verify R2 rate limits
- Monitor queue processing backlog

### Memory Issues
- Profile Worker memory usage
- Review data serialization
- Check for memory leaks in long-running processes
- Optimize vector embedding storage
