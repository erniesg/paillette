/**
 * The same budget as `search-budget.mjs`, but fired the way the agent fires it.
 *
 * Serially the limit is almost unreachable: an NGA text search takes ~5s, so a
 * human typing one query at a time gets about twelve into a minute and the
 * bucket rolls over underneath them. Sixteen serial searches were never
 * refused. The agent does not search serially — a single turn issues a burst,
 * and `beats.json` from this run's capture shows eight NGA searches inside one
 * 24-second turn.
 *
 * So this fires N at once and records which are refused, which is the shape
 * that actually happens on camera.
 *
 *   node scripts/demo/e2e4/search-burst.mjs [baseUrl] [n]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const N = Number(process.argv[3] ?? 14);
const OUT = path.resolve('docs/night/e2e-evidence/iteration-4');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/nga/search`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await sleep(2000);

console.log(`firing ${N} distinct text searches at once…`);
const results = await page.evaluate(async (n) => {
  const one = async (i) => {
    const t = performance.now();
    const res = await fetch('/api/public-search/nga/text', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: `burst ${i} ${Math.floor(performance.now())}`, topK: 4 }),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return {
      i,
      status: res.status,
      code: body?.error?.code ?? null,
      retryAfter: res.headers.get('retry-after'),
      ms: Math.round(performance.now() - t),
    };
  };
  return await Promise.all(Array.from({ length: n }, (_, i) => one(i + 1)));
}, N);

for (const r of results) {
  console.log(`  #${String(r.i).padStart(2)}  ${r.status}  ${r.code ?? 'ok'}  ${r.ms}ms${r.retryAfter ? `  retry-after=${r.retryAfter}` : ''}`);
}
const ok = results.filter((r) => r.status === 200).length;
const refused = results.filter((r) => r.status === 429).length;
console.log(`\n${ok} accepted, ${refused} refused out of ${N} fired at once`);

await writeFile(
  path.join(OUT, 'search-burst.json'),
  JSON.stringify({ base: BASE, fired: N, accepted: ok, refused, results }, null, 2)
);
await browser.close();
