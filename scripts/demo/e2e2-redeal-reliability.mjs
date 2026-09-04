/**
 * The headline beat, ten times in a row, on the deployed build.
 *
 * One good take is not evidence that a beat is filmable; a beat that works
 * eight times in ten is a beat that will fail on camera. Run 2 of
 * `e2e2-loop.mjs` came back with two rejected works still sitting on the board
 * after Enter, which either is a real defect or was the harness reading the
 * board while the deal was still in flight. This settles it by doing the same
 * thing ten times and, each time, comparing three things that must agree:
 *
 *   - `board.order`, which is what the agent is told is on the table
 *   - the ids actually rendered in the deal grid, which is what a viewer sees
 *   - the confirmed rejects, none of which may be in either
 *
 * Costs no model calls, so it can be run as often as anyone likes.
 *
 *   PLAYWRIGHT_CORE=… node scripts/demo/e2e2-redeal-reliability.mjs <base> <out> [rounds]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e2-reliability';
const ROUNDS = Number(process.argv[4] ?? 10);
const QUERY = process.env.E2E_QUERY ?? 'still life fruit';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => process.stdout.write(`${line}\n`);

const unwrap = (raw) => {
  if (Array.isArray(raw?.content)) {
    try {
      return JSON.parse(raw.content[0].text);
    } catch {
      return raw.content[0].text;
    }
  }
  return raw;
};

/**
 * The ids in the deal grid, and nothing else.
 *
 * `[data-artwork-id]` alone is too loose on this page: `NoteSwatches` hangs a
 * palette strip under the wall label for every confirmed flag and gives it the
 * same attribute, and the reject tray carries it too. Counting those as cards
 * is what made one run look like a fifteen-card board.
 */
const gridIds = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="deal-board-grid"] [data-artwork-id]')].map((el) =>
      el.getAttribute('data-artwork-id')
    )
  );

const sampleLayouts = (page, ms) =>
  page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const seen = new Set();
        let frames = 0;
        const started = performance.now();
        const tick = () => {
          frames += 1;
          seen.add(
            [...document.querySelectorAll('[data-testid="deal-board-grid"] [data-artwork-id]')]
              .map((el) => {
                const r = el.getBoundingClientRect();
                return `${el.getAttribute('data-artwork-id')}:${Math.round(r.x)},${Math.round(r.y)}`;
              })
              .join('|')
          );
          if (performance.now() - started < duration) requestAnimationFrame(tick);
          else resolve({ layouts: seen.size, frames });
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
  page.on('request', (r) => net.push({ at: Date.now(), url: r.url() }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.waitForFunction(
    async () => ((await window.__paillette_webmcp?.tools?.()) ?? []).length > 0,
    { timeout: 60_000 }
  );
  await page.waitForFunction(() => document.querySelectorAll('[data-artwork-id]').length > 0, {
    timeout: 60_000,
  });
  await sleep(1200);

  const press = async (id, key) => {
    await page.evaluate(() => document.activeElement?.blur?.());
    const card = page.locator(`.paillette-card[data-artwork-id="${id}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.keyboard.press(key);
    await sleep(250);
  };

  const startIds = await page.evaluate(() =>
    [...document.querySelectorAll('.paillette-card[data-artwork-id]')].map((el) =>
      el.getAttribute('data-artwork-id')
    )
  );
  await press(startIds[0], 'p');
  await press(startIds[1], 'x');
  await press(startIds[2], 'x');

  const rounds = [];
  for (let round = 1; round <= ROUNDS; round += 1) {
    const before = (await gridIds(page)).join(',');
    const modelBefore = net.filter((n) => /public-agent\/turn/.test(n.url)).length;
    const reqBefore = net.length;

    await page.evaluate(() => {
      document.activeElement?.blur?.();
      window.scrollTo(0, 0);
    });
    // Sampling starts first so the very first moved frame is caught.
    const sampling = sampleLayouts(page, 2600);
    const t0 = Date.now();
    await page.keyboard.press('Enter');
    let changed = false;
    try {
      await page.waitForFunction(
        (prev) =>
          [...document.querySelectorAll('[data-testid="deal-board-grid"] [data-artwork-id]')]
            .map((el) => el.getAttribute('data-artwork-id'))
            .join(',') !== prev,
        before,
        { timeout: 45_000 }
      );
      changed = true;
    } catch {
      changed = false;
    }
    const changedMs = Date.now() - t0;
    const sampled = await sampling;
    // Let the deal settle before reading anything: a board sampled mid-flight
    // reports the old works and an empty tray, which is exactly the mistake
    // this script exists to stop making.
    await sleep(2500);

    const rendered = await gridIds(page);
    const ctxState = unwrap(
      await page.evaluate(() => window.__paillette_webmcp.call('get_view_context', {}))
    );
    const order = ctxState?.board?.order ?? [];
    const flags = ctxState?.flags ?? {};
    const rejectIds = new Set((flags.rejects ?? []).map((f) => f.id));
    const pickIds = new Set((flags.picks ?? []).map((f) => f.id));
    const tray = await page.evaluate(() =>
      [...document.querySelectorAll('.lt-tray [data-artwork-id]')].map((el) =>
        el.getAttribute('data-artwork-id')
      )
    );

    const row = {
      round,
      changed,
      changedMs,
      layouts: sampled.layouts,
      frames: sampled.frames,
      renderedCount: rendered.length,
      orderCount: order.length,
      renderedMatchesOrder: rendered.join(',') === order.join(','),
      rejectsOnBoard: rendered.filter((id) => rejectIds.has(id)),
      rejectsInOrder: order.filter((id) => rejectIds.has(id)),
      picksOnBoard: rendered.filter((id) => pickIds.has(id)),
      trayCount: tray.length,
      modelCalls: net.filter((n) => /public-agent\/turn/.test(n.url)).length - modelBefore,
      exemplarCalls: net
        .slice(reqBefore)
        .filter((n) => /nga\/exemplars/.test(n.url)).length,
    };
    rounds.push(row);
    log(
      `round ${String(round).padStart(2)}  ` +
        `${row.layouts} layouts · ${row.renderedCount} cards · order ${row.orderCount} · ` +
        `rejects on board ${row.rejectsOnBoard.length} · tray ${row.trayCount} · ` +
        `picks held ${row.picksOnBoard.length} · model calls ${row.modelCalls} · ` +
        `exemplar calls ${row.exemplarCalls}` +
        (row.renderedMatchesOrder ? '' : '  << rendered board differs from board.order')
    );
    await page.screenshot({ path: path.join(OUT, `round-${String(round).padStart(2, '0')}.png`) });
  }

  const bad = rounds.filter(
    (r) => r.rejectsOnBoard.length > 0 || r.modelCalls > 0 || r.layouts < 10 || !r.changed
  );
  log('');
  log(`${rounds.length - bad.length}/${rounds.length} clean rounds`);
  log(`  a round is clean when: the board changed, no reject is on it, no model was called,`);
  log(`  and the deal measured 10+ distinct layouts (a jump cut measures 4–5).`);
  if (bad.length) {
    for (const r of bad) log(`  round ${r.round}: ${JSON.stringify(r)}`);
  }
  log(`total model calls across ${rounds.length} redeals: ${net.filter((n) => /public-agent\/turn/.test(n.url)).length}`);
  log(`page errors: ${JSON.stringify(errors)}`);

  await writeFile(
    path.join(OUT, 'reliability.json'),
    `${JSON.stringify({ base: BASE, query: QUERY, rounds, errors }, null, 2)}\n`
  );

  await ctx.close();
  await browser.close();
  process.exit(bad.length ? 1 : 0);
};

await main();
