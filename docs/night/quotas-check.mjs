/**
 * Issue 075 on staging, in a browser: the budgets read, the spent state on the
 * glyph, and the copy-link notice for works without labels.
 *
 * Zero model calls. The show is hung through the debug harness
 * (`set_exhibition`), not by the agent, because what is being checked is what
 * the page does with an unlabelled wall, and staging's model account has no
 * credit.
 *
 * The one thing faked: for the spent-glyph shot, the budgets response is
 * intercepted to report the labelling budget spent, because spending a real
 * one means sixty label calls from this machine's address, which every other
 * lane on this VM shares. That shot says so in its filename and in the JSON.
 *
 *   CHROME_PATH=... node docs/night/quotas-check.mjs [base]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolveBrowserDriver } from '../../scripts/demo/browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const SHOTS = new URL('./shots/quotas/', import.meta.url);
mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: new URL(`${name}.png`, SHOTS).pathname });

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}  ${JSON.stringify(detail ?? '')}`);
};

const { chromium } = await resolveBrowserDriver();
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
);

const open = async (intercept) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const budgets = [];
  page.on('response', async (response) => {
    if (!response.url().includes('/api/public-usage/nga') || response.request().method() !== 'GET') return;
    budgets.push({ status: response.status(), body: await response.json().catch(() => null) });
  });
  if (intercept) {
    await page.route('**/api/public-usage/nga', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { success: true, data: intercept } })
        : route.continue()
    );
  }
  await page.goto(`${BASE}/nga/search?webmcp-debug&q=${encodeURIComponent('warm landscape')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(() => Boolean(window.__paillette_webmcp?.call), { timeout: 45_000 });
  await page.waitForSelector('[data-artwork-id]', { timeout: 45_000 });
  await page.waitForTimeout(2500);
  return { context, page, budgets };
};

// ---- 1. The real budgets read, and an idle glyph ---------------------------
{
  const { context, page, budgets } = await open(null);
  const body = budgets[0]?.body;
  record('GET /api/public-usage/nga answers on arrival with four budgets', budgets[0]?.status === 200 &&
    ['labels', 'agentCalls', 'search', 'dailySite'].every((k) => body?.data?.[k] && 'remaining' in body.data[k]),
    { status: budgets[0]?.status, keys: Object.keys(body?.data ?? {}) });
  const phase = await page.evaluate(() => document.querySelector('.pa-activity-cells')?.getAttribute('data-phase'));
  record('with room in every budget, the glyph is not spent', phase !== 'spent', { phase });

  // ---- 3. A show with one unlabelled work, published through the notice ----
  const ids = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('[data-artwork-id]')].map((el) => el.getAttribute('data-artwork-id')))].slice(0, 3)
  );
  await page.evaluate(
    (works) =>
      window.__paillette_webmcp.call('set_exhibition', {
        title: 'Quota check',
        statement: 'A show hung by the harness to see what the page does with a blank wall.',
        works,
      }),
    [
      { artworkId: ids[0], label: 'Labelled by the harness.' },
      { artworkId: ids[1], label: 'Labelled by the harness.' },
      { artworkId: ids[2] },
    ]
  );
  await page.waitForTimeout(1200);
  const posts = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/exhibitions') && request.method() === 'POST') posts.push(request.url());
  });
  const share = page.locator('.paillette-share-link');
  await share.scrollIntoViewIfNeeded();
  await share.click();
  const notice = page.locator('.paillette-share-unlabelled');
  await notice.waitFor({ timeout: 10_000 }).catch(() => {});
  const noticeText = (await notice.textContent().catch(() => null))?.trim() ?? null;
  record('Copy link lists the unlabelled work and publishes nothing yet',
    Boolean(noticeText?.startsWith('1 without a label')) && posts.length === 0, { noticeText, posts: posts.length });
  await notice.scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, '01-copy-link-unlabelled-notice');

  await page.getByRole('button', { name: 'Wait' }).click();
  await page.waitForTimeout(400);
  record('Wait closes the notice and publishes nothing',
    (await notice.count()) === 0 && posts.length === 0, { posts: posts.length });

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => { window.__copied = text; } },
    });
  });
  await share.click();
  await page.getByRole('button', { name: 'Publish anyway' }).click();
  await page.waitForFunction(() => Boolean(window.__copied), { timeout: 20_000 }).catch(() => {});
  const copied = await page.evaluate(() => window.__copied ?? null);
  record('Publish anyway publishes and copies the link', posts.length === 1 && Boolean(copied), {
    posts: posts.length,
    shortLink: Boolean(copied && /\/e\/[A-Za-z0-9]+$/.test(copied)),
  });
  await context.close();
}

// ---- 2. The spent state on the glyph (budgets response intercepted) --------
{
  const nextAt = Date.now() + 37 * 60_000;
  const room = { limit: 10, used: 1, remaining: 9, nextAt: null };
  const { context, page } = await open({
    labels: { limit: 60, used: 60, remaining: 0, nextAt },
    agentCalls: room,
    search: room,
    dailySite: room,
  });
  const glyph = await page.evaluate(() => ({
    phase: document.querySelector('.pa-activity-cells')?.getAttribute('data-phase') ?? null,
    frame: document.querySelector('.pa-activity-cells')?.textContent ?? null,
    line: document.querySelector('.pa-activity-spent')?.textContent ?? null,
  }));
  record('[intercepted budgets] a spent labelling budget shows one terse state on the glyph',
    glyph.phase === 'spent' && /^labels spent · /.test(glyph.line ?? ''), glyph);
  await shot(page, '02-glyph-labels-spent-INTERCEPTED-budgets');
  await context.close();
}

await browser.close();
const failures = results.filter((result) => !result.ok).length;
writeFileSync(
  new URL('./e2e-evidence/quotas-check.json', import.meta.url),
  `${JSON.stringify({ base: BASE, at: new Date().toISOString(), failures, results }, null, 2)}\n`
);
console.log(`\n${results.length - failures} passed, ${failures} failed. Zero model calls.`);
process.exit(failures ? 1 : 0);
