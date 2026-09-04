/**
 * How often does the agent actually render on a cold load?
 *
 * The brief names one thing that can waste a whole shoot: a mount-order race
 * under `?webmcp-debug` where the in-page agent does not render at all. The fix
 * is `928b5dc` and it is merged. But one run of the note check died at the
 * first step with "the agent bar is not on the page", so "merged" and "always
 * renders" are not the same claim and only one of them has been checked.
 *
 * This loads the page cold N times and, for each load, records *when* each
 * piece arrives rather than whether it is there after an arbitrary wait — a
 * bar that appears at 9s and a bar that never appears look identical to a
 * harness that gives up at 4.5s, and they need different fixes.
 *
 * No model turns, so this is cheap: it only costs one page load each.
 *
 *   node apps/web/scripts/e2e-mount-probe.mjs <baseUrl> <n> <outDir>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const N = Number(process.argv[3] ?? 12);
const OUT = process.argv[4] ?? '/tmp/e2e6/mount';
const BAR = 'input[aria-label="Ask the agent"]';

mkdirSync(`${OUT}/shots`, { recursive: true });
const save = (n, v) => writeFileSync(`${OUT}/${n}`, typeof v === 'string' ? v : JSON.stringify(v, null, 2));

const main = async () => {
  const browser = await chromium.launch();
  const runs = [];

  for (let i = 1; i <= N; i += 1) {
    // A fresh context each time: same cold start a judge opening the URL gets.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    const failedRequests = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', (r) => {
      if (r.status() >= 400) failedRequests.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });

    const t0 = Date.now();
    const run = { run: i, barMs: null, driverMs: null, cardsMs: null, errors, failedRequests };
    try {
      await page.goto(`${BASE}/nga/search?webmcp-debug`, { waitUntil: 'domcontentloaded' });
      // Poll for 20s. Each piece is timestamped the moment it first appears.
      while (Date.now() - t0 < 20_000) {
        const now = Date.now() - t0;
        if (run.barMs === null && (await page.$(BAR))) run.barMs = now;
        if (run.driverMs === null &&
          (await page.evaluate(() => typeof window.__paillette_webmcp?.call === 'function'))) {
          run.driverMs = now;
        }
        // `.paillette-card` is a *board* card. An idle /nga/search has no board
        // — it shows the landing hero — so this is expected to stay null here
        // and is recorded rather than scored.
        if (run.cardsMs === null) {
          const n = await page.$$eval('.paillette-card', (c) => c.length).catch(() => 0);
          if (n > 0) run.cardsMs = now;
        }
        if (run.barMs !== null && run.driverMs !== null) break;
        await page.waitForTimeout(300);
      }
      run.tools = await page
        .evaluate(async () => (await window.__paillette_webmcp?.tools?.())?.length ?? null)
        .catch(() => null);
      run.bodyText = await page.evaluate(() =>
        document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 200));
    } catch (e) {
      run.error = String(e);
    }
    if (run.barMs === null) {
      // A page that failed to mount is also a page whose webfonts may never
      // settle, and Playwright waits on fonts before it shoots. Never let the
      // screenshot of a failure be the thing that loses the failure.
      run.dom = await page
        .evaluate(() => ({
          inputs: [...document.querySelectorAll('input')].map((el) => el.getAttribute('aria-label') ?? el.placeholder),
          hasAgentMount: Boolean(document.querySelector('[data-agent-prompt], .pa-activity-glyph')),
          html: document.body.innerHTML.length,
        }))
        .catch((e) => ({ error: String(e) }));
      await page
        .screenshot({ path: `${OUT}/shots/no-bar-run${i}.png`, animations: 'disabled', timeout: 8000 })
        .catch((e) => { run.screenshotError = String(e).slice(0, 120); });
    }
    runs.push(run);
    console.log(
      `run ${String(i).padStart(2)}  bar ${String(run.barMs ?? 'NEVER').padStart(6)}  ` +
      `driver ${String(run.driverMs ?? 'NEVER').padStart(6)}  cards ${String(run.cardsMs ?? 'NEVER').padStart(6)}  ` +
      `tools ${run.tools ?? '—'}  ${run.failedRequests.length ? 'HTTP: ' + run.failedRequests.join(',') : ''}` +
      `${run.errors.length ? '  ERR ' + run.errors[0].slice(0, 80) : ''}`
    );
    save('mount-runs.json', runs);
    await context.close();
  }

  const noBar = runs.filter((r) => r.barMs === null);
  const noDriver = runs.filter((r) => r.driverMs === null);
  const noCards = runs.filter((r) => r.cardsMs === null);
  const bars = runs.filter((r) => r.barMs !== null).map((r) => r.barMs);
  console.log(`\n${runs.length - noBar.length}/${runs.length} loads rendered the agent bar` +
    (bars.length ? `  (min ${Math.min(...bars)}ms, max ${Math.max(...bars)}ms)` : ''));
  console.log(`${runs.length - noDriver.length}/${runs.length} installed the debug driver`);
  console.log(`${runs.length - noCards.length}/${runs.length} ever showed a card`);
  save('summary.json', {
    loads: runs.length,
    barRendered: runs.length - noBar.length,
    driverInstalled: runs.length - noDriver.length,
    cardsShown: runs.length - noCards.length,
    barMsMin: bars.length ? Math.min(...bars) : null,
    barMsMax: bars.length ? Math.max(...bars) : null,
    failures: [...noBar, ...noCards].map((r) => ({
      run: r.run, barMs: r.barMs, cardsMs: r.cardsMs,
      failedRequests: r.failedRequests, errors: r.errors, bodyText: r.bodyText,
    })),
  });
  await browser.close();
};

main().catch((e) => { console.error(e); process.exit(2); });
