/**
 * The half of the loop that has no model in it, recorded as video.
 *
 * Deal · P · X · Enter · deal again. Written as a separate harness from
 * `loop.mjs` for one reason: with the deployed agent returning 429 this is the
 * part of the demo that still runs, and it is worth knowing exactly how much
 * of the film survives without a model behind it.
 *
 * Also checks the two things §9 asks about flags that a single redeal does not
 * show: that they survive a reload (per session), and that the loop works with
 * no `?webmcp-debug` and therefore no agent on the page at all.
 *
 *   node scripts/demo/e2e3/deterministic.mjs [baseUrl]
 */

import { mkdir, writeFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const SHOTS = path.resolve('docs/night/shots');
const OUT = path.resolve('docs/night/e2e-evidence/iteration-3');
const VIDEO_DIR = path.resolve('docs/night/shots/video');

const BAR = 'input[aria-label="Ask the agent"]';
const CARD = 'article.paillette-card';
const TRAY = '.lt-tray-card';

const results = [];
const say = (ok, what, detail) => {
  results.push({ ok, what, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readBoard = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('article.paillette-card')].map((el) => {
      const b = el.getBoundingClientRect();
      const slot = el.closest('[data-board-slot]');
      return {
        id: el.getAttribute('data-artwork-id'),
        slot: slot ? Number(slot.getAttribute('data-board-slot')) : null,
        flag: el.getAttribute('data-flag'),
        by: el.getAttribute('data-flag-by'),
        x: Math.round(b.x),
        y: Math.round(b.y),
      };
    })
  );

const sampleLayouts = (page, ms) =>
  page.evaluate(async (duration) => {
    const layouts = [];
    let firstChangeAt = null;
    const t0 = performance.now();
    return await new Promise((resolve) => {
      const tick = () => {
        const key = [...document.querySelectorAll('article.paillette-card')]
          .map((el) => {
            const b = el.getBoundingClientRect();
            return `${el.getAttribute('data-artwork-id')}:${Math.round(b.x)},${Math.round(b.y)}`;
          })
          .join('|');
        if (firstChangeAt === null && layouts.length && key !== layouts[0]) {
          firstChangeAt = Math.round(performance.now() - t0);
        }
        layouts.push(key);
        if (performance.now() - t0 < duration) requestAnimationFrame(tick);
        else
          resolve({
            frames: layouts.length,
            distinct: new Set(layouts).size,
            distinctAfterChange:
              firstChangeAt === null
                ? 0
                : new Set(layouts.slice(layouts.findIndex((l) => l !== layouts[0]))).size,
            firstChangeAtMs: firstChangeAt,
          });
      };
      requestAnimationFrame(tick);
    });
  }, ms);

const flag = async (page, id, key) => {
  const el = page.locator(`${CARD}[data-artwork-id="${id}"]`).first();
  await el.scrollIntoViewIfNeeded();
  await el.hover();
  await sleep(150);
  await page.keyboard.press(key);
  await sleep(300);
};

await mkdir(SHOTS, { recursive: true });
await mkdir(OUT, { recursive: true });
await mkdir(VIDEO_DIR, { recursive: true });

const browser = await chromium.launch();
const evidence = { base: BASE };

// =========================================================================
// 1 — the loop with no agent on the page at all: no ?webmcp-debug
// =========================================================================
console.log('\n--- no ?webmcp-debug: the loop with one operator ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const wire = [];
  page.on('request', (r) => wire.push(`${r.method()} ${r.url()}`));
  await page.goto(`${BASE}/nga/search?q=warm%20landscape`, {
    waitUntil: 'domcontentloaded', timeout: 120_000,
  });
  await page.waitForSelector(CARD, { timeout: 120_000 });
  const hasBar = await page.evaluate(
    (s) => !!document.querySelector(s), BAR
  );
  const board = await readBoard(page);
  await flag(page, board[0].id, 'x');
  await flag(page, board[1].id, 'x');
  await flag(page, board[2].id, 'p');
  const mark = wire.length;
  // No bar to press Enter in when the agent is absent — the board itself takes it.
  await page.locator(`${CARD}`).first().click({ position: { x: 2, y: 2 } }).catch(() => {});
  await page.keyboard.press('Enter');
  await sleep(7000);
  const after = await readBoard(page);
  const modelCalls = wire.slice(mark).filter((r) => r.includes('/public-agent/turn')).length;
  const exemplarCalls = wire.slice(mark).filter((r) => r.includes('/exemplars')).length;
  say(after.length === 12, 'plain browser, no debug flag: Enter deals twelve', `${after.length} cards, bar present=${hasBar}`);
  say(modelCalls === 0, 'plain browser: no model call', `${modelCalls}`);
  say(exemplarCalls >= 1, 'plain browser: the deterministic engine ran', `${exemplarCalls} POSTs to /exemplars`);
  evidence.plainBrowser = { hasBar, boardSize: after.length, modelCalls, exemplarCalls };
  await page.screenshot({ path: path.join(SHOTS, 'e2e3-09-plain-browser-redeal.png') });
  await ctx.close();
}

// =========================================================================
// 2 — flags survive a reload (§9: "flags persist per session")
// =========================================================================
console.log('\n--- flags across a reload ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`, {
    waitUntil: 'domcontentloaded', timeout: 120_000,
  });
  await page.waitForSelector(CARD, { timeout: 120_000 });
  const board = await readBoard(page);
  const marked = { reject: [board[0].id, board[1].id], pick: [board[2].id] };
  await flag(page, marked.reject[0], 'x');
  await flag(page, marked.reject[1], 'x');
  await flag(page, marked.pick[0], 'p');
  const beforeReload = await page.evaluate(
    async () => await window.__paillette_webmcp.call('get_view_context', {})
  );
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector(CARD, { timeout: 120_000 });
  await sleep(2500);
  const afterReload = await page.evaluate(
    async () => await window.__paillette_webmcp.call('get_view_context', {})
  );
  const idsOf = (v) => ({
    picks: (v?.flags?.picks ?? []).map((f) => f.id).sort(),
    rejects: (v?.flags?.rejects ?? []).map((f) => f.id).sort(),
  });
  const b4 = idsOf(beforeReload);
  const af = idsOf(afterReload);
  const same =
    JSON.stringify(b4) === JSON.stringify(af) && b4.picks.length + b4.rejects.length === 3;
  say(same, 'flags survive a reload, per session',
    `before ${JSON.stringify(b4)} · after ${JSON.stringify(af)}`);
  evidence.reload = { before: b4, after: af, survived: same };
  await page.screenshot({ path: path.join(SHOTS, 'e2e3-10-flags-after-reload.png') });
  await ctx.close();
}

// =========================================================================
// 3 — the deal, on video, with no model anywhere in the take
// =========================================================================
console.log('\n--- the deal, recorded ---');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
  });
  const page = await ctx.newPage();
  const wire = [];
  page.on('request', (r) => wire.push(`${r.method()} ${r.url()}`));
  await page.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`, {
    waitUntil: 'domcontentloaded', timeout: 120_000,
  });
  await page.waitForSelector(CARD, { timeout: 120_000 });
  await sleep(2000);
  await page.screenshot({ path: path.join(SHOTS, 'e2e3-11-deal-00-browsing.png') });

  const board = await readBoard(page);
  await flag(page, board[0].id, 'x');
  await flag(page, board[1].id, 'x');
  await flag(page, board[2].id, 'p');
  await flag(page, board[3].id, 'p');
  await sleep(600);
  await page.screenshot({ path: path.join(SHOTS, 'e2e3-11-deal-01-flagged.png') });

  const deals = [];
  for (let n = 1; n <= 4; n += 1) {
    const before = await readBoard(page);
    const mark = wire.length;
    await page.click(BAR);
    await page.press(BAR, 'Enter');
    const flip = await sampleLayouts(page, 8000);
    await sleep(1500);
    const after = await readBoard(page);
    const held = before
      .filter((c) => c.flag === 'pick')
      .map((p) => {
        const now = after.find((c) => c.id === p.id);
        return { id: p.id, moved: now ? Math.abs(now.x - p.x) + Math.abs(now.y - p.y) : null };
      });
    const tray = await page.evaluate(
      (s) => document.querySelectorAll(s).length, TRAY
    );
    const d = {
      deal: n,
      cards: after.length,
      tray,
      modelCalls: wire.slice(mark).filter((r) => r.includes('/public-agent/turn')).length,
      exemplarCalls: wire.slice(mark).filter((r) => r.includes('/exemplars')).length,
      flip,
      held,
    };
    deals.push(d);
    console.log(
      `  deal ${n}: ${d.cards} cards · tray ${d.tray} · ${d.flip.distinctAfterChange} layouts ` +
      `(first move ${d.flip.firstChangeAtMs}ms) · ${d.modelCalls} model calls · picks moved ${JSON.stringify(d.held.map((h) => h.moved))}`
    );
    await page.screenshot({ path: path.join(SHOTS, `e2e3-11-deal-${String(n + 1).padStart(2, '0')}-redeal${n}.png`) });
  }
  evidence.deals = deals;

  const totalModel = deals.reduce((a, d) => a + d.modelCalls, 0);
  say(totalModel === 0, 'four consecutive redeals, zero model calls', `${totalModel}`);
  const boardToBoard = deals.slice(1);
  say(boardToBoard.every((d) => d.held.every((h) => h.moved === 0)),
    'picks hold position on every board-to-board redeal',
    JSON.stringify(boardToBoard.map((d) => d.held.map((h) => h.moved))));
  say(boardToBoard.every((d) => d.flip.distinctAfterChange > 6),
    'the deal animates on every board-to-board redeal',
    JSON.stringify(deals.map((d) => d.flip.distinctAfterChange)));
  say(deals.every((d) => d.cards === 12), 'twelve cards every deal',
    JSON.stringify(deals.map((d) => d.cards)));

  await ctx.close();
  const files = (await readdir(VIDEO_DIR)).filter((f) => f.endsWith('.webm'));
  const newest = files.sort().pop();
  if (newest) {
    await rename(path.join(VIDEO_DIR, newest), path.join(VIDEO_DIR, 'e2e3-deal-on-nga-search.webm'));
    evidence.video = 'docs/night/shots/video/e2e3-deal-on-nga-search.webm';
    console.log(`  video: ${evidence.video}`);
  }
}

evidence.results = results;
await writeFile(path.join(OUT, 'deterministic.json'), JSON.stringify(evidence, null, 2));
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
