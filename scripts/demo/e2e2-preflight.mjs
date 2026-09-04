/**
 * The two questions that can waste a whole e2e run, asked before anything else.
 *
 * 1. Does the in-page agent render under `?webmcp-debug`? The mount-order race
 *    `928b5dc` fixes leaves the page with no bar to type into, and a harness
 *    that drives nothing looks identical to a product that does nothing.
 * 2. Is the deal animation on the *real* page — `/nga/search` against the live
 *    collection — or only on the visuals lane's `/night/deal` fixture route?
 *    The deal is the money shot; a deal that only exists in a harness is not a
 *    shot at all.
 *
 * Both are answered against a deployed build, with no model call, so this is
 * safe to re-run against the 40-per-hour anonymous budget.
 *
 *   PLAYWRIGHT_CORE=… node scripts/demo/e2e2-preflight.mjs <base-url> <out-dir>
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e2-preflight';
const QUERY = process.env.E2E_QUERY ?? 'sunset landscape';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const note = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
};

/** Card geometry, page-relative and slot-relative, ignoring the reject tray. */
const boxes = (page) =>
  page.evaluate(() => {
    const grid = document.querySelector('[data-testid="deal-board-grid"]');
    const g = grid?.getBoundingClientRect();
    return {
      grid: g ? { x: Math.round(g.x), y: Math.round(g.y + window.scrollY) } : null,
      cards: Object.fromEntries(
        [...document.querySelectorAll('[data-artwork-id]')]
          .filter((el) => !el.closest('.lt-tray'))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return [
              el.getAttribute('data-artwork-id'),
              {
                page: { x: Math.round(r.x), y: Math.round(r.y + window.scrollY) },
                board: g
                  ? { x: Math.round(r.x - g.x), y: Math.round(r.y - g.y) }
                  : null,
              },
            ];
          })
      ),
    };
  });

/**
 * Count distinct layouts across a redeal, sampled once per animation frame.
 *
 * A jump cut — the board simply being replaced — measures 4 or 5, because only
 * mount and paint change anything. A real FLIP measures twenty-odd. This is
 * the difference between "the works changed" and "the works were dealt", and
 * it is the only way to tell them apart from outside the page.
 */
const sampleLayouts = (page, ms) =>
  page.evaluate((duration) => {
    return new Promise((resolve) => {
      const seen = new Set();
      let frames = 0;
      const started = performance.now();
      const tick = () => {
        frames += 1;
        const sig = [...document.querySelectorAll('[data-artwork-id]')]
          .filter((el) => !el.closest('.lt-tray'))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return `${el.getAttribute('data-artwork-id')}:${Math.round(r.x)},${Math.round(r.y)}`;
          })
          .join('|');
        seen.add(sig);
        if (performance.now() - started < duration) requestAnimationFrame(tick);
        else resolve({ layouts: seen.size, frames });
      };
      requestAnimationFrame(tick);
    });
  }, ms);

const main = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const requests = [];
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url() }));
  const consoleWarnings = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') consoleWarnings.push(m.text());
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

  // ---------------------------------------------------------------- Q1 -----
  await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-artwork-id]').length > 0,
    { timeout: 60_000 }
  );
  await page.waitForFunction(
    async () => ((await window.__paillette_webmcp?.tools?.()) ?? []).length > 0,
    { timeout: 60_000 }
  );
  await sleep(1500);

  const tools = await page.evaluate(async () => await window.__paillette_webmcp.tools());
  note(tools.length > 0, 'the debug host registers tools', `${tools.length} tools`);

  const bar = await page.locator('input[aria-label="Ask the agent"]').count();
  note(bar === 1, 'the in-page agent bar renders under ?webmcp-debug', `count=${bar}`);

  const barVisible = bar
    ? await page.locator('input[aria-label="Ask the agent"]').first().isVisible()
    : false;
  note(barVisible, 'the bar is actually visible, not merely in the DOM', String(barVisible));

  const focus = await page.evaluate(() => document.activeElement?.tagName ?? 'none');
  note(focus === 'BODY', 'focus is on BODY at cold load, so P/X/U are live', focus);

  const dupWarnings = consoleWarnings.filter((w) => /already registered/i.test(w));
  note(dupWarnings.length === 0, 'no "already registered" warnings', `${dupWarnings.length}`);
  await shot('p1-agent-bar-under-debug-flag');

  // The same page with no flag at all, which is what a judge opening the URL gets.
  const plain = await ctx.newPage();
  await plain.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await plain
    .waitForFunction(() => document.querySelectorAll('[data-artwork-id]').length > 0, {
      timeout: 60_000,
    })
    .catch(() => {});
  await sleep(1500);
  const plainState = await plain.evaluate(() => ({
    host: Boolean(document.modelContext),
    driver: Boolean(window.__paillette_webmcp),
    bar: document.querySelectorAll('input[aria-label="Ask the agent"]').length,
    cards: document.querySelectorAll('[data-artwork-id]').length,
  }));
  note(
    plainState.host && plainState.bar === 1,
    'with no flag at all the host is still claimed and the bar still renders',
    JSON.stringify(plainState)
  );
  note(
    plainState.driver === false,
    'the console back door stays behind the flag',
    `__paillette_webmcp present=${plainState.driver}`
  );
  await plain.screenshot({ path: path.join(OUT, 'p2-no-flag-at-all.png') });
  await plain.close();

  // ---------------------------------------------------------------- Q2 -----
  // Is the *fixture* route even the same thing? Ask the product page directly.
  const dealRoute = await page.evaluate(async (base) => {
    const res = await fetch(`${base}/night/deal`, { redirect: 'follow' });
    return { status: res.status };
  }, BASE);
  note(true, '/night/deal (the visuals fixture route) responds', `HTTP ${dealRoute.status}`);

  // Now the real thing: flag on the real page, redeal, and measure.
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')]
      .filter((el) => !el.closest('.lt-tray'))
      .map((el) => el.getAttribute('data-artwork-id'))
  );
  note(ids.length >= 4, 'the real search deals works', `${ids.length} cards for "${QUERY}"`);

  const press = async (id, key) => {
    await page.evaluate(() => document.activeElement?.blur?.());
    const card = page.locator(`[data-artwork-id="${id}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.keyboard.press(key);
    await sleep(200);
  };
  await press(ids[0], 'p');
  await press(ids[1], 'p');
  await press(ids[2], 'x');
  await press(ids[3], 'x');

  const redeal = async (label) => {
    const before = await page.evaluate(() =>
      [...document.querySelectorAll('[data-artwork-id]')]
        .filter((el) => !el.closest('.lt-tray'))
        .map((el) => el.getAttribute('data-artwork-id'))
        .join(',')
    );
    const geomBefore = await boxes(page);
    await page.evaluate(() => {
      document.activeElement?.blur?.();
      window.scrollTo(0, 0);
    });
    const sampling = sampleLayouts(page, 2600);
    const t0 = Date.now();
    await page.keyboard.press('Enter');
    await page
      .waitForFunction(
        (prev) =>
          [...document.querySelectorAll('[data-artwork-id]')]
            .filter((el) => !el.closest('.lt-tray'))
            .map((el) => el.getAttribute('data-artwork-id'))
            .join(',') !== prev,
        before,
        { timeout: 45_000 }
      )
      .catch(() => {});
    const changedMs = Date.now() - t0;
    const sampled = await sampling;
    await sleep(1200);
    const geomAfter = await boxes(page);
    return { label, changedMs, sampled, geomBefore, geomAfter, before };
  };

  const first = await redeal('first redeal (masonry → board)');
  note(
    true,
    'first redeal, distinct layouts',
    `${first.sampled.layouts} across ${first.sampled.frames} frames (jump cut = 4–5)`
  );
  await shot('p3-after-first-redeal');

  const second = await redeal('second redeal (board → board)');
  note(
    second.sampled.layouts >= 10,
    'THE DEAL ANIMATION RUNS ON /nga/search, board to board',
    `${second.sampled.layouts} distinct layouts across ${second.sampled.frames} frames (jump cut = 4–5)`
  );
  await shot('p4-after-second-redeal');

  // Did the picks hold their pixels board to board?
  const heldIds = Object.keys(second.geomBefore.cards).filter((id) =>
    Object.prototype.hasOwnProperty.call(second.geomAfter.cards, id)
  );
  const moved = heldIds.map((id) => ({
    id,
    dxPage: second.geomAfter.cards[id].page.x - second.geomBefore.cards[id].page.x,
    dyPage: second.geomAfter.cards[id].page.y - second.geomBefore.cards[id].page.y,
    dxBoard: (second.geomAfter.cards[id].board?.x ?? 0) - (second.geomBefore.cards[id].board?.x ?? 0),
    dyBoard: (second.geomAfter.cards[id].board?.y ?? 0) - (second.geomBefore.cards[id].board?.y ?? 0),
  }));
  note(
    moved.length >= 2 && moved.every((m) => m.dxBoard === 0 && m.dyBoard === 0),
    'the held picks move zero pixels in their slots across a board-to-board redeal',
    JSON.stringify(moved)
  );

  // Twelve cards, and do they fit?
  const fit = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="deal-board-grid"]');
    const cards = [...document.querySelectorAll('[data-artwork-id]')].filter(
      (el) => !el.closest('.lt-tray')
    );
    const g = grid?.getBoundingClientRect();
    let best = 0;
    // The best scroll position, not the accidental one.
    const docTop = (g?.y ?? 0) + window.scrollY;
    for (let top = Math.max(0, docTop - 200); top <= docTop + 400; top += 40) {
      const visible = cards.filter((el) => {
        const r = el.getBoundingClientRect();
        const y = r.y + window.scrollY;
        return y >= top && y + r.height <= top + window.innerHeight;
      }).length;
      if (visible > best) best = visible;
    }
    return {
      count: cards.length,
      gridHeight: g ? Math.round(g.height) : null,
      viewport: window.innerHeight,
      fullyVisibleAtBestScroll: best,
      tray: document.querySelectorAll('.lt-tray [data-artwork-id]').length,
    };
  });
  note(fit.count === 12, 'twelve cards', JSON.stringify(fit));
  note(
    fit.fullyVisibleAtBestScroll === 12,
    'all twelve fit on screen at 1440×900',
    `${fit.fullyVisibleAtBestScroll}/12, grid ${fit.gridHeight}px in a ${fit.viewport}px viewport`
  );
  note(fit.tray >= 2, 'the rejects are in a visible tray', `${fit.tray} in the tray`);

  const modelCalls = requests.filter((r) => /public-agent\/turn/.test(r.url));
  note(
    modelCalls.length === 0,
    'nothing in this preflight reached a model',
    `${modelCalls.length} of ${requests.length} requests`
  );
  note(errors.length === 0, 'no uncaught page errors', JSON.stringify(errors.slice(0, 3)));

  await writeFile(
    path.join(OUT, 'preflight.json'),
    `${JSON.stringify(
      { base: BASE, query: QUERY, tools, results, first, second, fit, errors },
      null,
      2
    )}\n`
  );

  await ctx.close();
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(
    `\n${results.length - failed.length} passed, ${failed.length} failed\n`
  );
  process.exit(failed.length ? 1 : 0);
};

await main();
