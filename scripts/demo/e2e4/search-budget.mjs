/**
 * How many NGA searches a client gets before the page goes dead.
 *
 * Found the hard way: a note run's `redeal` came back
 * `REDEAL_FAILED — "Too many NGA public searches; try again shortly"`, and the
 * next run's page never dealt a single card, showing *"Search is busy right
 * now."* instead. Neither is the model budget and neither is the daily quota —
 * the quota pill read 412/1000 free searches at the time.
 *
 * It is `PUBLIC_SEARCH_COLD_MISS_LIMIT_PER_MINUTE`, which `apps/api/wrangler.toml`
 * does not set, so it falls to `PUBLIC_SEARCH_COLD_MISS_DEFAULT_LIMIT = 10`
 * (`apps/api/src/utils/public-search-cold-miss-rate-limit.ts:4`) — ten accepted
 * NGA searches per minute per client, partitioned by `CF-Connecting-IP`, and
 * enforced on `/search/text` (`search.ts:3180`), `/search/color`
 * (`color-search.ts:137`) *and* `/search/exemplars` (`search.ts:4084`). So the
 * deterministic redeal shares one budget with the agent's own searching.
 *
 * This measures the real ceiling rather than reading it off the constant: it
 * fires text searches through the page's own proxy, one at a time, and records
 * the request number at which the first 429 arrives.
 *
 *   node scripts/demo/e2e4/search-budget.mjs [baseUrl] [attempts]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const ATTEMPTS = Number(process.argv[3] ?? 16);
const OUT = path.resolve('docs/night/e2e-evidence/iteration-4');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// The page is loaded only to get a same-origin fetch through its own proxy —
// no card is flagged and no agent turn is fired here.
await page.goto(`${BASE}/nga/search`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await sleep(2000);

console.log(`firing up to ${ATTEMPTS} distinct text searches, one at a time…`);
const t0 = Date.now();
const attempts = [];
for (let i = 1; i <= ATTEMPTS; i += 1) {
  const r = await page.evaluate(async (n) => {
    const started = performance.now();
    try {
      const res = await fetch('/api/public-search/nga/text', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // A distinct query every time, so nothing is served from the result cache.
        body: JSON.stringify({ query: `budget probe ${n} ${Math.floor(performance.now())}`, topK: 4 }),
      });
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return {
        status: res.status,
        retryAfter: res.headers.get('retry-after'),
        code: body?.error?.code ?? null,
        message: body?.error?.message ?? null,
        results: Array.isArray(body?.data?.results) ? body.data.results.length : null,
        ms: Math.round(performance.now() - started),
      };
    } catch (e) {
      return { status: null, error: String(e), ms: Math.round(performance.now() - started) };
    }
  }, i);
  const at = Math.round((Date.now() - t0) / 1000);
  attempts.push({ n: i, atSeconds: at, ...r });
  console.log(
    `  ${String(i).padStart(2)}  t+${String(at).padStart(3)}s  ${r.status}  ${r.code ?? `${r.results} results`}  ${r.ms}ms${r.retryAfter ? `  retry-after=${r.retryAfter}` : ''}`
  );
  if (r.status === 429 && i >= 2) {
    // One more, to show it stays refused rather than flapping.
    if (attempts.filter((a) => a.status === 429).length >= 2) break;
  }
}

const firstRefusal = attempts.find((a) => a.status === 429);
const accepted = attempts.filter((a) => a.status === 200).length;

const report = {
  base: BASE,
  attempts,
  acceptedBeforeFirstRefusal: firstRefusal ? firstRefusal.n - 1 : accepted,
  firstRefusal: firstRefusal ?? null,
  configuredLimit:
    'PUBLIC_SEARCH_COLD_MISS_LIMIT_PER_MINUTE unset in apps/api/wrangler.toml → default 10/min/client',
};
console.log(
  `\naccepted before the first refusal: ${report.acceptedBeforeFirstRefusal}` +
    (firstRefusal ? `; refused at #${firstRefusal.n}, t+${firstRefusal.atSeconds}s, retry-after ${firstRefusal.retryAfter}s` : '; never refused')
);

await writeFile(path.join(OUT, 'search-budget.json'), JSON.stringify(report, null, 2));
await browser.close();
