/**
 * `?webmcp-debug` — the mount-order race, checked rather than assumed.
 *
 * The bug (fixed in `928b5dc` on `night/review`) was ordering: the debug
 * driver installed itself before the bridge had registered, so the console
 * handle existed and knew about nothing. It reads as "WebMCP is broken" from
 * the one console a judge is most likely to open.
 *
 * So: load cold, read the tool list back through the driver rather than from
 * the page's own module, and call one read-only tool through it. Repeated over
 * several cold loads, because a race that only sometimes loses is still lost.
 *
 *   node scripts/demo/probe-debug-mount.mjs <base-url> [loads]
 */

import { chromium } from './browser.mjs';

const [base = 'https://paillette-stg.berlayar.ai', loads = '5'] =
  process.argv.slice(2);

const EXPECTED_TOOLS = 25;

const browser = await chromium.launch();
const runs = [];

for (let i = 1; i <= Number(loads); i += 1) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto(`${base}/nga/search?q=warm%20landscape&webmcp-debug`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  // Wait for the handle itself, not for a timer — the race is about ordering.
  await page
    .waitForFunction(() => Boolean(window.__paillette_webmcp), { timeout: 60_000 })
    .catch(() => {});

  const seen = await page.evaluate(async () => {
    const driver = window.__paillette_webmcp;
    if (!driver) return { driver: false };
    const count = async () =>
      ((await document.modelContext?.getTools?.()) ?? []).length;

    // The count the instant the handle appears — this is what the race is
    // about — and then the count once the page has settled. A handle that is
    // briefly empty is fine; a handle that is *permanently* empty is the bug.
    const atHandle = await count();
    const t0 = performance.now();
    const deadline = Date.now() + 20_000;
    let settled = atHandle;
    while (settled === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      settled = await count();
    }
    const msToSettle = Math.round(performance.now() - t0);

    // The back door's own answer, which is the one a judge in the console
    // gets. It waits out the registration window rather than reporting an
    // empty surface as fact, so this should be the full list even when
    // `getTools()` was empty a moment ago.
    const throughDriver = (await driver.tools()).length;

    const tools = (await document.modelContext?.getTools?.()) ?? [];
    let called = null;
    try {
      called = await driver.call('get_view_context', {});
    } catch (error) {
      called = { thrown: String(error) };
    }
    return {
      driver: true,
      hasCall: typeof driver.call === 'function',
      toolCountAtHandle: atHandle,
      toolCount: settled,
      toolCountThroughDriver: throughDriver,
      msToSettle,
      names: tools.map((tool) => tool.name).sort(),
      callOk: Boolean(called?.ok),
      callError: called?.ok ? null : JSON.stringify(called).slice(0, 200),
      onSearchPage: called?.data?.page?.onSearchPage ?? null,
    };
  });

  runs.push({ load: i, ...seen, pageErrors: consoleErrors });
  await context.close();
}

await browser.close();

const ok = runs.every(
  (run) =>
    run.driver &&
    run.hasCall &&
    run.toolCount === EXPECTED_TOOLS &&
    run.callOk &&
    run.pageErrors.length === 0
);

console.log(
  JSON.stringify(
    {
      base,
      expectedTools: EXPECTED_TOOLS,
      allLoadsGood: ok,
      runs: runs.map(({ names, ...rest }) => rest),
      names: runs[0]?.names ?? [],
    },
    null,
    2
  )
);
process.exit(ok ? 0 : 1);
