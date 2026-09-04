/**
 * The thesis, tested where it actually gets tested: with the agent switched off.
 *
 * "The loop must work with no agent in it." The claim is easy to make while the
 * model is answering; it is only worth anything if the board still deals when
 * the model cannot. So this runs the culling loop against an agent route that
 * is returning 429 — the real failure mode, since the shared anonymous budget
 * is 40 model calls per client per hour and a rehearsal will eat it.
 *
 *   node apps/web/scripts/verify-agentless-loop.mjs [baseUrl]
 */

import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const GALLERY = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

const failures = [];
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) failures.push(label);
};

const work = (id, rank) => ({
  id,
  galleryId: GALLERY,
  orgId: GALLERY,
  title: `Work ${id}`,
  artist: 'A. Painter',
  imageUrl: null,
  thumbnailUrl: null,
  similarity: 0.9 - rank * 0.01,
  metadata: {},
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

let agentCalls = 0;
await page.route('**/api/public-agent/**', (route) => {
  agentCalls += 1;
  return route.fulfill({
    status: 429,
    json: {
      success: false,
      error: {
        code: 'AGENT_RATE_LIMITED',
        message: 'You have used this hour’s shared agent budget. Try again shortly.',
      },
    },
  });
});

await page.route('**/api/public-search/**', (route) => {
  const url = route.request().url();
  const rows = url.includes('/exemplars')
    ? Array.from({ length: 12 }, (_, index) => work(`d${index}`, index))
    : Array.from({ length: 6 }, (_, index) => work(`w${index}`, index));
  return route.fulfill({
    json: { success: true, data: { results: rows, count: rows.length, queryTime: 2 } },
  });
});

const context = () =>
  page.evaluate(() => window.__paillette_webmcp.call('get_view_context', {}));

await page.goto(`${BASE}/nga/search?q=anything&webmcp-debug`, {
  waitUntil: 'networkidle',
  timeout: 60_000,
});
await page.waitForSelector('.paillette-card', { timeout: 30_000 });

console.log('\nthe agent is unavailable; the human is not');
await page.locator('.paillette-card[data-artwork-id="w0"]').hover();
await page.keyboard.press('p');
await page.locator('.paillette-card[data-artwork-id="w1"]').hover();
await page.keyboard.press('x');
check('P and X still flag', (await context()).flags.picks.length === 1);

const bar = page.locator('input[aria-label="Ask the agent"]');
await bar.click();
await page.keyboard.press('Enter');
await page
  .waitForFunction(() => document.querySelectorAll('.paillette-card').length === 12, undefined, {
    timeout: 15_000,
  })
  .catch(() => {});

const dealt = await context();
check('Enter on an empty bar still deals twelve', dealt.board?.order?.length === 12, String(dealt.board?.order?.length));
check('the pick is still in its seat', dealt.board?.order?.[0] === 'w0');
check('and no agent call was made at all', agentCalls === 0, String(agentCalls));

console.log('\nand the agent path fails readably rather than silently');
await bar.click();
await bar.fill('something warmer');
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
check('the request was attempted', agentCalls > 0, String(agentCalls));
const shown = await page.locator('text=/shared agent budget/i').count();
check('the human is told why', shown > 0);

const afterFailedTurn = await context();
check(
  'the board the human dealt is untouched by the failed turn',
  afterFailedTurn.board?.order?.length === 12 &&
    afterFailedTurn.flags.picks.length === 1
);

await bar.click();
await bar.fill('');
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
const afterSecond = await context();
check(
  'and Enter still deals after the agent has failed',
  (afterSecond.board?.redeals ?? 0) === 2,
  String(afterSecond.board?.redeals)
);

check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(
  `\n${failures.length ? `${failures.length} FAILED: ${failures.join(', ')}` : 'all checks passed'}`
);
process.exit(failures.length ? 1 : 0);
