/**
 * Why run 2 diverged, asked without spending a model call.
 *
 * Run 2 of `e2e2-loop.mjs` was the only one of three where the agent, of its
 * own accord, also wrote an exhibition (`set_exhibition` + `write_labels`) and
 * asked for the salon view before handing the board back. On that run — and
 * only that run — the deal measured **3 distinct layouts** instead of 21, the
 * reject tray read empty, and fifteen elements answered to `[data-artwork-id]`
 * where twelve works were on the board.
 *
 * Three candidate explanations, and they are not the same bug:
 *   a. the extra elements are a second rendering of the flagged works
 *      somewhere else on the page, and the harness counted both — a measuring
 *      fault, not a product one;
 *   b. an exhibition statement above the board pushes the deal below the fold,
 *      so the deal happens off camera — a filming problem;
 *   c. the deal genuinely does not animate once an exhibition is on the page —
 *      a product problem, and the money shot.
 *
 * This reproduces the state directly through the debug driver: set an
 * exhibition, ask for salon, flag, redeal. No model is involved, so it is
 * cheap and repeatable, and it dumps the ancestor chain of every element
 * carrying `data-artwork-id` so "where did the duplicates come from" is
 * answered rather than guessed.
 *
 *   PLAYWRIGHT_CORE=… node scripts/demo/e2e2-run2-repro.mjs <base-url> <out-dir>
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e2-repro';
const QUERY = process.env.E2E_QUERY ?? 'still life fruit';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const note = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  process.stdout.write(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}\n`
  );
};

/** Every element answering to [data-artwork-id], and where in the page it sits. */
const census = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')].map((el) => {
      const chain = [];
      let node = el;
      while (node && node !== document.body) {
        chain.push(
          `${node.tagName.toLowerCase()}${
            node.className && typeof node.className === 'string'
              ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}`
              : ''
          }`
        );
        node = node.parentElement;
      }
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-artwork-id'),
        flag: el.getAttribute('data-flag'),
        by: el.getAttribute('data-flag-by'),
        provisional: el.getAttribute('data-flag-provisional'),
        inTray: Boolean(el.closest('.lt-tray')),
        inDealGrid: Boolean(el.closest('[data-testid="deal-board-grid"]')),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        chain: chain.slice(0, 6).join(' < '),
      };
    })
  );

const sampleLayouts = (page, ms) =>
  page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const seen = new Set();
        const inGrid = new Set();
        let frames = 0;
        const started = performance.now();
        const tick = () => {
          frames += 1;
          const cards = [...document.querySelectorAll('[data-artwork-id]')].filter(
            (el) => el.closest('[data-testid="deal-board-grid"]')
          );
          cards.forEach((c) => inGrid.add(c.getAttribute('data-artwork-id')));
          seen.add(
            cards
              .map((el) => {
                const r = el.getBoundingClientRect();
                return `${el.getAttribute('data-artwork-id')}:${Math.round(r.x)},${Math.round(r.y)}`;
              })
              .join('|')
          );
          if (performance.now() - started < duration) requestAnimationFrame(tick);
          else resolve({ layouts: seen.size, frames, distinctCards: inGrid.size });
        };
        requestAnimationFrame(tick);
      }),
    ms
  );

const main = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const net = [];
  page.on('request', (r) => net.push(r.url()));

  await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.waitForFunction(
    async () => ((await window.__paillette_webmcp?.tools?.()) ?? []).length > 0,
    { timeout: 60_000 }
  );
  await page.waitForFunction(
    () => document.querySelectorAll('[data-artwork-id]').length > 0,
    { timeout: 60_000 }
  );
  await sleep(1200);

  const call = (name, args) =>
    page.evaluate(
      ([n, a]) => window.__paillette_webmcp.call(n, a),
      [name, args]
    );

  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')].map((el) =>
      el.getAttribute('data-artwork-id')
    )
  );

  const press = async (id, key) => {
    await page.evaluate(() => document.activeElement?.blur?.());
    const card = page.locator(`[data-artwork-id="${id}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.keyboard.press(key);
    await sleep(250);
  };

  // --- control: the plain loop, no exhibition, no salon -------------------
  await press(ids[0], 'x');
  await press(ids[1], 'x');
  await press(ids[2], 'p');
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  await page.keyboard.press('Enter'); // first redeal: masonry -> board
  await sleep(4000);

  const beforeControl = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="deal-board-grid"] [data-artwork-id]')]
      .map((el) => el.getAttribute('data-artwork-id'))
      .join(',')
  );
  const sampControl = sampleLayouts(page, 2600);
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  await page.keyboard.press('Enter');
  await page
    .waitForFunction(
      (prev) =>
        [...document.querySelectorAll('[data-testid="deal-board-grid"] [data-artwork-id]')]
          .map((el) => el.getAttribute('data-artwork-id'))
          .join(',') !== prev,
      beforeControl,
      { timeout: 45_000 }
    )
    .catch(() => {});
  const control = await sampControl;
  await sleep(1500);
  const censusControl = await census(page);
  note(
    control.layouts >= 10,
    'CONTROL — with no exhibition on the page the deal animates',
    JSON.stringify(control)
  );
  note(
    censusControl.length === censusControl.filter((c) => c.inDealGrid || c.inTray).length,
    'CONTROL — every [data-artwork-id] is either on the board or in the tray',
    `${censusControl.length} elements: ${censusControl.filter((c) => c.inDealGrid).length} board, ${
      censusControl.filter((c) => c.inTray).length
    } tray, ${censusControl.filter((c) => !c.inDealGrid && !c.inTray).length} elsewhere`
  );
  await page.screenshot({ path: path.join(OUT, 'r1-control-after-deal.png') });

  // --- now reproduce run 2: an exhibition, and a salon request ------------
  const boardIds = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="deal-board-grid"] [data-artwork-id]')].map((el) =>
      el.getAttribute('data-artwork-id')
    )
  );
  const exhibition = await call('set_exhibition', {
    title: 'Warm Company',
    statement:
      'This room gathers works that make warmth feel spacious rather than insistent. Honeyed light, ochre earth, softened paper, and small domestic things offer a resting place for the eye. Open horizons and singular objects keep the mood unhurried; even when evening enters, it arrives as glow rather than drama. Hung together, these pictures turn the wall above a sofa into a quiet counterweight to the life gathered below it.',
    artworkIds: boardIds.slice(0, 10),
  });
  note(
    exhibition?.isError !== true,
    'set_exhibition applied (the thing run 2 did and runs 1 and 3 did not)',
    JSON.stringify(exhibition).slice(0, 200)
  );
  await call('set_view', { view: 'salon' });
  await sleep(2500);
  await page.screenshot({ path: path.join(OUT, 'r2-exhibition-on-page.png'), fullPage: false });

  const geometry = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="deal-board-grid"]');
    const r = grid?.getBoundingClientRect();
    return grid
      ? {
          present: true,
          topInViewport: Math.round(r.top),
          height: Math.round(r.height),
          viewport: window.innerHeight,
          scrollY: Math.round(window.scrollY),
          documentHeight: document.documentElement.scrollHeight,
        }
      : { present: false };
  });
  note(
    geometry.present,
    'the deal board survives set_view("salon") with an exhibition on the page',
    JSON.stringify(geometry)
  );

  const censusExhibition = await census(page);
  const counts = censusExhibition.reduce((acc, c) => {
    const where = c.inTray ? 'tray' : c.inDealGrid ? 'board' : 'elsewhere';
    acc[where] = (acc[where] ?? 0) + 1;
    return acc;
  }, {});
  const elsewhere = censusExhibition.filter((c) => !c.inDealGrid && !c.inTray);
  note(
    elsewhere.length === 0,
    'with an exhibition on the page, no work is rendered outside the board and tray',
    `${JSON.stringify(counts)} — elsewhere: ${JSON.stringify(
      elsewhere.map((c) => ({ id: c.id, flag: c.flag, chain: c.chain }))
    ).slice(0, 700)}`
  );

  // --- and does the deal still animate in that state? ---------------------
  const beforeExh = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="deal-board-grid"] [data-artwork-id]')]
      .map((el) => el.getAttribute('data-artwork-id'))
      .join(',')
  );
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  const sampExh = sampleLayouts(page, 2600);
  await page.keyboard.press('Enter');
  await page
    .waitForFunction(
      (prev) =>
        [...document.querySelectorAll('[data-testid="deal-board-grid"] [data-artwork-id]')]
          .map((el) => el.getAttribute('data-artwork-id'))
          .join(',') !== prev,
      beforeExh,
      { timeout: 45_000 }
    )
    .catch(() => {});
  const withExhibition = await sampExh;
  await sleep(1500);
  note(
    withExhibition.layouts >= 10,
    'WITH AN EXHIBITION ON THE PAGE — does the deal still animate?',
    `${withExhibition.layouts} distinct layouts across ${withExhibition.frames} frames (control measured ${control.layouts}); a jump cut is 4–5`
  );
  const geomAfter = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="deal-board-grid"]');
    const r = grid?.getBoundingClientRect();
    return {
      topInViewport: Math.round(r?.top ?? 0),
      scrollY: Math.round(window.scrollY),
      viewport: window.innerHeight,
    };
  });
  note(
    geomAfter.topInViewport >= 0 && geomAfter.topInViewport < window_innerHeightGuess(geomAfter),
    'the board is on camera when the deal runs',
    JSON.stringify(geomAfter)
  );
  await page.screenshot({ path: path.join(OUT, 'r3-after-deal-with-exhibition.png') });

  const modelCalls = net.filter((u) => /public-agent\/turn/.test(u)).length;
  note(modelCalls === 0, 'no model call was spent proving any of this', `${modelCalls}`);

  await writeFile(
    path.join(OUT, 'repro.json'),
    `${JSON.stringify(
      { base: BASE, control, withExhibition, geometry, geomAfter, censusControl, censusExhibition, results },
      null,
      2
    )}\n`
  );

  await ctx.close();
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length} passed, ${failed.length} failed\n`);
};

const window_innerHeightGuess = (g) => g.viewport;

await main();
