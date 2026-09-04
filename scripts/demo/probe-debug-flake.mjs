/**
 * Chase the one cold load in five where `window.__paillette_webmcp` never
 * appears. Records enough to tell the three candidate causes apart: the query
 * parameter not surviving the navigation, the module never evaluating, and the
 * page erroring before it got there.
 *
 *   node scripts/demo/probe-debug-flake.mjs <base-url> [loads]
 */

import { chromium } from './browser.mjs';

const [base = 'https://paillette-stg.berlayar.ai', loads = '12'] =
  process.argv.slice(2);

const browser = await chromium.launch();
const runs = [];

for (let i = 1; i <= Number(loads); i += 1) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 200)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
  });
  page.on('requestfailed', (request) =>
    failedRequests.push(`${request.method()} ${request.url().slice(0, 120)}`)
  );

  let navError = null;
  try {
    await page.goto(`${base}/nga/search?q=warm%20landscape&webmcp-debug`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
  } catch (error) {
    navError = error.message.split('\n')[0];
  }

  const appeared = await page
    .waitForFunction(() => Boolean(window.__paillette_webmcp), { timeout: 25_000 })
    .then(() => true)
    .catch(() => false);

  const state = await page
    .evaluate(() => ({
      href: location.href,
      hasParam: new URLSearchParams(location.search).has('webmcp-debug'),
      hasDriver: Boolean(window.__paillette_webmcp),
      hasModelContext: Boolean(document.modelContext),
      // The bar only renders once a host is claimed, so its presence says the
      // module graph got that far even if the driver did not.
      hasBar: Boolean(document.querySelector('input[aria-label="Ask the agent"]')),
      cards: document.querySelectorAll('.paillette-card').length,
      readyState: document.readyState,
    }))
    .catch((error) => ({ evaluateFailed: String(error).slice(0, 160) }));

  runs.push({
    load: i,
    appeared,
    navError,
    ...state,
    pageErrors,
    consoleErrors,
    failedRequests: failedRequests.slice(0, 4),
  });
  await context.close();
}

await browser.close();
const bad = runs.filter((run) => !run.appeared);
console.log(
  JSON.stringify(
    { base, loads: runs.length, failures: bad.length, bad, runs },
    null,
    2
  )
);
