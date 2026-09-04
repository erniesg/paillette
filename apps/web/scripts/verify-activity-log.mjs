/**
 * The glyph and the log under the conditions that actually break things.
 *
 * The capture script photographs the happy path. This one drives the unhappy
 * ones in a real browser: a call that hangs, a call that is cancelled, five
 * tools handed ids that no longer resolve, a backend that refuses, a buffer
 * that overflows, three calls in flight at once, and a host that behaves the
 * way Chrome's does rather than the way our debug stub does.
 *
 * Usage:
 *   pnpm --filter web dev --port 5222 --strictPort
 *   node apps/web/scripts/verify-activity-log.mjs [baseUrl]
 *
 * Exits non-zero on the first failure. Nothing here is a screenshot; every
 * assertion reads the DOM or the store.
 */

import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const baseUrl = process.argv[2] ?? 'http://localhost:5222';

let failures = 0;
let checks = 0;
const check = (label, ok, detail = '') => {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`);
};
const section = (name) => console.log(`\n${name}`);

const WORKS = Array.from({ length: 24 }, (_, index) => ({
  id: `nga-${index + 1}`,
  galleryId: 'nga',
  title: `Work ${index + 1}`,
  artist: 'Fitz Henry Lane',
  imageUrl: '',
  thumbnailUrl: '',
  similarity: 0.92 - index * 0.01,
  metadata: { accessionNumber: `1990.${index}`, classification: 'Painting' },
}));

async function main() {
  const browser = await chromium.launch();

  /** Latency and status the stubbed search endpoints answer with. */
  const net = { hold: 0, status: 200 };

  const openPage = async (context) => {
    await context.route(
      (url) =>
        url.pathname.includes('/api/public-search/') ||
        url.pathname.includes('/api/public-describe'),
      async (route) => {
        if (net.hold) {
          await new Promise((resolve) => setTimeout(resolve, net.hold));
        }
        if (net.status !== 200) {
          await route.fulfill({
            status: net.status,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              error: 'The collection is not accepting searches right now.',
            }),
          });
          return;
        }
        let sent = {};
        try {
          sent = JSON.parse(route.request().postData() ?? '{}');
        } catch {
          sent = {};
        }
        const blocked = new Set([
          ...(sent.excludeIds ?? []),
          ...(sent.positiveIds ?? []),
          ...(sent.negativeIds ?? []),
        ]);
        const available = WORKS.filter((work) => !blocked.has(work.id));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              results: available.slice(0, 12),
              count: Math.min(12, available.length),
              queryTime: 110,
            },
          }),
        });
      }
    );

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${baseUrl}/nga/search?q=estuary&webmcp-debug`, {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(() => Boolean(window.__paillette_webmcp));
    await page.waitForTimeout(2200);
    return { page, pageErrors };
  };

  const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  const { page, pageErrors } = await openPage(context);

  const call = (tool, input = {}) =>
    page.evaluate(
      ([name, args]) =>
        window.__paillette_webmcp.call(name, args).catch((error) => ({
          threw: String(error),
        })),
      [tool, input]
    );

  const start = (tool, input = {}) =>
    page.evaluate(
      ([name, args]) => {
        window.__pa_inflight = (window.__pa_inflight ?? []).concat(
          window.__paillette_webmcp.call(name, args).catch(() => null)
        );
      },
      [tool, input]
    );

  const drain = () =>
    page.evaluate(async () => {
      await Promise.all(window.__pa_inflight ?? []);
      window.__pa_inflight = [];
    });

  const openLog = async () => {
    if ((await page.locator('.pa-activity-log').count()) === 0) {
      await page.click('.pa-activity-glyph');
      await page.waitForTimeout(200);
    }
  };
  const closeLog = async () => {
    if (await page.locator('.pa-activity-log').count()) {
      await page.click('.pa-activity-glyph');
      await page.waitForTimeout(200);
    }
  };

  const rowFor = (tool) =>
    page.locator(`.pa-activity-row[data-tool="${tool}"]`).last();

  const phase = () => page.getAttribute('.pa-activity-cells', 'data-phase');

  // ── a call that takes a long time ─────────────────────────────────────────
  section('the connection is slow');
  net.hold = 9_000;
  await start('search_artworks', { query: 'estuary at dusk' });
  await page.waitForTimeout(600);
  check('the glyph is running', (await phase()) === 'running');
  await openLog();
  check(
    'the row shows no duration while it is in flight',
    (await rowFor('search_artworks').textContent())?.includes('···') === true
  );
  check(
    'and it is marked as running, not merely un-styled',
    (await rowFor('search_artworks').getAttribute('data-running')) === 'true'
  );
  await page.waitForTimeout(4_000);
  check(
    'four seconds later it is still animating rather than having given up',
    (await phase()) === 'running'
  );
  net.hold = 0;
  await drain();
  await page.waitForTimeout(400);
  check('it settles when the call finally lands', (await phase()) === 'idle');
  const slowDuration = await rowFor('search_artworks')
    .locator('.pa-activity-dur')
    .textContent();
  const slowSeconds = Number((slowDuration ?? '').replace(/[^0-9.]/g, ''));
  check(
    'and the duration it reports is the real one, not a rounding of zero',
    /s$/.test((slowDuration ?? '').trim()) && slowSeconds >= 8.5,
    slowDuration ?? ''
  );

  // ── cancellation is not failure ───────────────────────────────────────────
  section('the call is cancelled');
  net.hold = 4_000;
  const aborted = await page.evaluate(() =>
    window.__paillette_webmcp.callAndAbort('search_artworks', { query: 'x' }, 150)
  );
  check('the tool reports an abort', aborted?.aborted === true, aborted?.error);
  await page.waitForTimeout(400);
  check(
    'a cancelled call rests as idle, not as a failure',
    (await phase()) === 'idle'
  );
  const abortedRow = page.locator('.pa-activity-row[data-status="aborted"]').last();
  check('the log records it as cancelled', (await abortedRow.count()) === 1);
  check(
    'and does not draw it in the failure ink',
    (await abortedRow.getAttribute('data-bad')) === 'false'
  );
  net.hold = 0;

  // ── ids that no longer resolve ────────────────────────────────────────────
  section('ids that no longer resolve');
  const stale = [
    ['show_artwork', { artworkId: 'ghost-1' }],
    ['describe_artwork', { artwork: 'ghost-1' }],
    ['search_by_exemplars', { positiveIds: ['ghost-1'] }],
    ['flag_artworks', { flags: [{ artworkId: 'ghost-1', flag: 'pick', reason: 'x' }] }],
    ['compare_artworks', { artworkIds: ['ghost-1', 'ghost-2'] }],
    ['lookup_artwork', { artworkId: 'ghost-1' }],
  ];
  for (const [tool, input] of stale) {
    const result = await call(tool, input);
    const row = rowFor(tool);
    const bad = await row.getAttribute('data-bad');
    const text = (await row.textContent()) ?? '';
    const message =
      result?.error?.message ?? result?.error?.code ?? '(no shaped error)';
    check(
      `${tool} is drawn as a failure`,
      bad === 'true',
      `${result?.error?.code ?? result?.threw ?? 'ok'}`
    );
    check(
      `${tool} shows the message the tool wrote`,
      typeof message === 'string' &&
        message !== '(no shaped error)' &&
        text.includes(message.slice(0, 24)),
      message.slice(0, 60)
    );
  }
  check('the glyph rests as a failure afterwards', (await phase()) === 'failed');

  // ── redeal with no direction ──────────────────────────────────────────────
  section('redeal with nothing picked');
  const noDirection = await call('redeal', { count: 12 });
  check(
    'it refuses with a code rather than dealing at random',
    noDirection?.ok === false && noDirection?.error?.code === 'NO_EXEMPLARS',
    noDirection?.error?.code
  );
  check(
    'and the log draws the refusal as a failure',
    (await rowFor('redeal').getAttribute('data-bad')) === 'true'
  );

  // ── the backend refusing ──────────────────────────────────────────────────
  section('the backend refuses');
  net.status = 503;
  const refused = await call('search_artworks', { query: 'anything' });
  net.status = 200;
  await page.waitForTimeout(300);
  const refusedRow = await rowFor('search_artworks').textContent();
  check(
    'a 503 reaches the caller as a shaped failure',
    refused?.ok === false,
    refused?.error?.code
  );
  check(
    'and the log shows it as a failure with a readable message',
    (await rowFor('search_artworks').getAttribute('data-bad')) === 'true' &&
      (refusedRow?.length ?? 0) > 20,
    refusedRow?.slice(0, 70)
  );
  check('the glyph rests as a failure', (await phase()) === 'failed');

  // ── the log must not stand between the human and the board ────────────────
  //
  // This is the defect the voice lane filed against the panel this replaced:
  // an opaque overlay across the lower-left of the board eats clicks on the
  // cards under it. It is much less severe now that nothing opens the log by
  // itself, but "less severe" is not "fixed".
  section('the log gets out of the way');
  await openLog();
  const panelBox = await page.locator('.pa-activity-log').boundingBox();

  // A card the panel is not sitting on. Cards underneath an open overlay are
  // unreachable, which is true of every overlay ever drawn; what must not
  // happen is a click *beside* it being swallowed or wasted.
  const picks = page.locator('.paillette-flag-button[data-flag-action="pick"]');
  let clearPick = null;
  for (let index = 0; index < (await picks.count()); index += 1) {
    const candidate = picks.nth(index);
    const box = await candidate.boundingBox();
    if (!box) continue;
    if (box.x > (panelBox?.x ?? 0) + (panelBox?.width ?? 0) + 8) {
      clearPick = candidate;
      break;
    }
  }
  check('found a card the open log is not covering', clearPick !== null);
  await clearPick.click({ timeout: 5_000 });
  await page.waitForTimeout(300);
  check(
    'reaching for a card closes the log',
    (await page.locator('.pa-activity-log').count()) === 0
  );
  check(
    'and the card still got the click it was given — nothing is spent dismissing',
    (await clearPick.getAttribute('aria-pressed')) === 'true'
  );

  // ── several calls in flight ───────────────────────────────────────────────
  section('three calls at once');
  await page.waitForTimeout(250);
  net.hold = 5_000;
  await start('search_artworks', { query: 'a' });
  await page.waitForTimeout(120);
  await start('describe_artwork', {
    artwork: await page.getAttribute('.paillette-card', 'data-artwork-id'),
  });
  await page.waitForTimeout(120);
  await start('redeal', { count: 12 });
  await page.waitForTimeout(400);
  // Reaching for a card closed the log a moment ago; open it to read the rows.
  await openLog();
  check(
    'the glyph counts them',
    (await page.getAttribute('.pa-activity-glyph', 'data-running')) === '3'
  );
  check(
    'and plays the newest one',
    (await page.getAttribute('.pa-activity-cells', 'data-kind')) === 'deal'
  );
  check(
    'three rows are marked running at once',
    (await page.locator('.pa-activity-row[data-running="true"]').count()) === 3
  );
  net.hold = 0;
  await drain();
  await page.waitForTimeout(500);
  check('all three settle', (await phase()) !== 'running');
  check(
    'and nothing is left marked running',
    (await page.locator('.pa-activity-row[data-running="true"]').count()) === 0
  );

  // ── a payload nobody wants pasted into a panel ────────────────────────────
  section('a large result');
  await call('browse_collection', { limit: 60 });
  await page.waitForTimeout(200);
  await openLog();
  await rowFor('browse_collection').click();
  await page.waitForTimeout(200);
  const detailLength = await page.evaluate(
    () =>
      document.querySelector('.pa-activity-detail')?.textContent?.length ?? 0
  );
  check(
    'the captured result is capped rather than pasted whole',
    detailLength > 0 && detailLength < 6_000,
    `${detailLength} chars`
  );
  await rowFor('browse_collection').click();

  // ── history across a client-side navigation ───────────────────────────────
  //
  // The bridge mounts once from `root.tsx` and the store lives outside React,
  // so a route change should cost nothing. A marker on `window` distinguishes
  // a client-side navigation from a full document load, because the second
  // would wipe the session and the check would fail for a reason that has
  // nothing to do with the log.
  section('the human navigates');
  await openLog();
  const beforeNav = await page.locator('.pa-activity-row').count();
  await closeLog();
  await page.evaluate(() => {
    window.__pa_same_document = true;
  });
  const link = page.locator('header a[href="/about"]').first();
  const navigable = (await link.count()) > 0;
  check('the header offers a route to navigate to', navigable);
  if (navigable) {
    await link.click();
    await page.waitForTimeout(1_500);
    await page.goBack();
    await page.waitForTimeout(1_800);
  }
  const sameDocument = await page.evaluate(() =>
    Boolean(window.__pa_same_document)
  );
  check('the navigation was client-side, not a reload', sameDocument);
  check(
    'the glyph is still mounted afterwards',
    await page.evaluate(() => Boolean(document.querySelector('.pa-activity')))
  );
  await openLog();
  const afterNav = await page.locator('.pa-activity-row').count();
  check(
    'and the session survived it intact',
    afterNav === beforeNav,
    `${beforeNav} -> ${afterNav}`
  );
  await closeLog();

  // ── the buffer overflows ──────────────────────────────────────────────────
  section('more calls than the log can hold');
  await page.evaluate(async () => {
    for (let index = 0; index < 130; index += 1) {
      await window.__paillette_webmcp.call('get_view_context', {}).catch(() => null);
    }
  });
  await page.waitForTimeout(400);
  await openLog();
  const rowCount = await page.locator('.pa-activity-row').count();
  const earlier = await page
    .locator('.pa-activity-earlier')
    .textContent()
    .catch(() => null);
  check('the log holds its ceiling and no more', rowCount === 120, `${rowCount} rows`);
  check(
    'and says how many it had to drop rather than truncating silently',
    /^…\s\d+\searlier$/.test((earlier ?? '').trim()),
    (earlier ?? '').trim()
  );
  check(
    'the newest call is still the last row',
    (await page.locator('.pa-activity-row').last().getAttribute('data-tool')) ===
      'get_view_context'
  );

  // ── keyboard ──────────────────────────────────────────────────────────────
  section('keyboard');
  await closeLog();
  await page.evaluate(() => document.querySelector('.pa-activity-glyph').focus());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  check(
    'Enter on the focused glyph opens the log',
    (await page.locator('.pa-activity-log').count()) === 1
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check(
    'Escape closes it',
    (await page.locator('.pa-activity-log').count()) === 0
  );

  check('no uncaught page errors anywhere', pageErrors.length === 0, pageErrors[0]);
  await context.close();

  // ── a host shaped like Chrome's ───────────────────────────────────────────
  //
  // The debug harness hands the page's own tool objects back out of
  // `getTools()`, execute included. A real host does not: `docs/HANDOFF.md`
  // records that Chrome 152 returns *descriptors* with no `execute`, and that
  // running one means `executeTool(toolObject, JSON.stringify(args))` — an
  // object, and a JSON string. This installs a host with that contract before
  // any of the page's script runs, which is where a real one would be, and
  // checks the call still reaches the log.
  //
  // It is a simulation of the documented contract, not Chrome. The Chromium on
  // this machine is 141 and exposes no `document.modelContext` at all, with or
  // without `--enable-features=WebMCPTesting`.
  section('a host shaped like Chrome 152');
  const hostContext = await browser.newContext({
    viewport: { width: 1440, height: 940 },
  });
  await hostContext.addInitScript(() => {
    const registered = new Map();
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      writable: true,
      value: {
        registerTool: async (tool) => {
          if (registered.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" is already registered.`);
          }
          registered.set(tool.name, tool);
        },
        unregisterTool: async (name) => registered.delete(name),
        // Descriptors only. No `execute` crosses this boundary.
        getTools: async () =>
          [...registered.values()].map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
          })),
        executeTool: async (descriptor, argsJson) => {
          const tool = registered.get(descriptor?.name);
          if (!tool) throw new Error('not of type RegisteredTool');
          if (typeof argsJson !== 'string') {
            throw new Error('Failed to parse input arguments');
          }
          return tool.execute(JSON.parse(argsJson), {
            signal: new AbortController().signal,
          });
        },
      },
    });
    window.__pa_spec_host = true;
  });
  const { page: hostPage, pageErrors: hostErrors } = await openPage(hostContext);

  check(
    'the page registered its tools with the host rather than a stub',
    (await hostPage.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      return tools.length;
    })) >= 21
  );
  check(
    'the host sees descriptors, with no execute on any of them',
    (await hostPage.evaluate(async () => {
      const tools = await document.modelContext.getTools();
      return tools.every((tool) => typeof tool.execute !== 'function');
    })) === true
  );
  const hostResult = await hostPage.evaluate(async () => {
    const tools = await document.modelContext.getTools();
    const tool = tools.find((candidate) => candidate.name === 'search_artworks');
    return document.modelContext.executeTool(
      tool,
      JSON.stringify({ query: 'driven by the host' })
    );
  });
  check('the host ran the tool', hostResult?.ok === true, `${hostResult?.count} results`);
  await hostPage.waitForTimeout(300);
  await hostPage.click('.pa-activity-glyph');
  await hostPage.waitForTimeout(250);
  const hostRow = await hostPage
    .locator('.pa-activity-row[data-tool="search_artworks"]')
    .last()
    .textContent();
  check(
    'and the log recorded it, with the arguments the host sent',
    (hostRow ?? '').includes('driven by the host'),
    (hostRow ?? '').slice(0, 70)
  );
  check(
    'passing a name instead of the object fails the way Chrome fails',
    (await hostPage.evaluate(async () => {
      try {
        await document.modelContext.executeTool('search_artworks', '{}');
        return 'no error';
      } catch (error) {
        return String(error);
      }
    })).includes('not of type RegisteredTool')
  );
  check('no uncaught page errors under the spec host', hostErrors.length === 0, hostErrors[0]);
  await hostContext.close();

  await browser.close();
  console.log(
    `\n${failures === 0 ? `all ${checks} checks passed` : `${failures} of ${checks} FAILED`}`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
