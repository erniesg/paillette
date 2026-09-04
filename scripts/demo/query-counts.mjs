#!/usr/bin/env node
/**
 * How many works each candidate demo query actually returns, on a deployed
 * build, driven through the page's own search rather than a guessed endpoint.
 *
 * Exists because "warm landscape" — the phrase in the demo script — returned
 * zero works on staging and nobody had checked. A query that comes back empty
 * is the first thing a judge sees, and there is no recovering from it on film.
 *
 *   node scripts/demo/query-counts.mjs <base-url> [query...]
 */

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const QUERIES = process.argv.slice(3).length
  ? process.argv.slice(3)
  : [
      'warm landscape',
      'golden light',
      'storm at sea',
      'sunset landscape',
      'something warm for above the sofa',
      'landscape',
      'sunset',
      'harbour',
      'river',
      'autumn',
      'mountains',
      'sea',
      'portrait',
      'still life',
    ];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const rows = [];
for (const query of QUERIES) {
  await page.goto(
    `${BASE}/nga/search?q=${encodeURIComponent(query)}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 }
  );
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('[data-artwork-id]').length > 0 ||
        document.body.innerText.includes('No works'),
      { timeout: 45_000 }
    )
    .catch(() => {});
  await page.waitForTimeout(1200);
  const count = await page.evaluate(
    () =>
      [...document.querySelectorAll('[data-artwork-id]')].filter(
        (el) => !el.closest('.lt-tray')
      ).length
  );
  rows.push({ query, count });
  process.stdout.write(`${String(count).padStart(3)}  ${query}\n`);
}

await browser.close();
process.stdout.write(`\n${JSON.stringify(rows)}\n`);
