/**
 * Does the two-up ever open with no pictures in it?
 *
 * One observation says yes: `docs/night/shots/e2e4/05-compare-room.png`, taken
 * by the loop harness more than 1.2s after `compare_artworks` returned, shows
 * two empty rectangles with only the serif titles under them. Two later
 * measurements say the pictures are up within ~75ms. The difference between
 * those runs was what the board held: the fast ones compared works from the
 * *first* board, the blank one compared works dealt in by two redeals.
 *
 * So this tests that difference directly, in one page: compare a pair off the
 * opening board, then redeal and compare a pair the redeal brought in, and time
 * both from the moment the tool is called. Every image URL fetched is logged,
 * so a slow 843px derivative is distinguishable from one never requested.
 *
 *   node scripts/demo/e2e4/compare-cold.mjs [baseUrl]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = path.resolve('docs/night/e2e-evidence/iteration-4');
const SHOTS = path.resolve('docs/night/shots/e2e4');
const CARD = 'article.paillette-card';
const BAR = 'input[aria-label="Ask the agent"]';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(OUT, { recursive: true });
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const images = [];
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/iiif/')) images.push({ t: Date.now(), status: r.status(), url: u });
});

await page.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`, {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});
await page.waitForSelector(CARD, { timeout: 120_000 });

const boardIds = () =>
  page.evaluate(
    (sel) => [...document.querySelectorAll(sel)].map((el) => el.getAttribute('data-artwork-id')),
    CARD
  );

/** Open the two-up on `pair` and poll until both pictures are painted. */
const timeCompare = async (pair, label) => {
  const t0 = Date.now();
  const pending = page.evaluate(
    async (p) =>
      await window.__paillette_webmcp.call('compare_artworks', {
        artworkIds: p,
        question: 'Which one belongs above the sofa?',
      }),
    pair
  );
  const samples = [];
  let loadedAt = null;
  for (let i = 0; i < 60; i += 1) {
    const s = await page.evaluate(() => {
      const room = document.querySelector('[data-compare-room]');
      if (!room) return null;
      return [...room.querySelectorAll('img')].map((img) => ({
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        src: (img.currentSrc || img.src || '').slice(-56),
      }));
    });
    const at = Date.now() - t0;
    samples.push({ atMs: at, imgs: s });
    if (s && s.length >= 2 && s.every((x) => x.complete && x.naturalWidth > 0)) {
      loadedAt = at;
      break;
    }
    await sleep(100);
  }
  await page.screenshot({ path: path.join(SHOTS, `32-compare-${label}.png`) });
  await pending.catch(() => {});
  const roomAt = samples.find((s) => s.imgs !== null)?.atMs ?? null;
  console.log(`${label}: room at ${roomAt}ms, both pictures painted at ${loadedAt === null ? 'NEVER within 6s' : `${loadedAt}ms`}`);
  // Close the room. Measured in `compare-exits.mjs`: Escape does not close it,
  // the backdrop does not close it, and "Neither" alone only opens the reason
  // field — "Neither" then Enter is the exit that does not pick a winner.
  await page.locator('.paillette-compare-neither').first().click().catch(() => {});
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(1200);
  const stillOpen = await page.evaluate(() => !!document.querySelector('[data-compare-room]'));
  return { label, pair, roomAtMs: roomAt, loadedAtMs: loadedAt, closedCleanly: !stillOpen, samples };
};

const first = await timeCompare((await boardIds()).slice(0, 2), 'opening-board');

// redeal, then compare two works the redeal brought in
const beforeIds = await boardIds();
await page.locator(`${CARD}`).first().hover();
await sleep(150);
await page.keyboard.press('x');
await sleep(300);
await page.click(BAR);
await page.press(BAR, 'Enter');
await sleep(6000);
const afterIds = await boardIds();
const newcomers = afterIds.filter((id) => !beforeIds.includes(id));
console.log(`redeal brought in ${newcomers.length} works the browser had never rendered`);
const second = newcomers.length >= 2 ? await timeCompare(newcomers.slice(0, 2), 'freshly-dealt') : null;

const report = {
  base: BASE,
  openingBoard: first,
  freshlyDealt: second,
  newcomerCount: newcomers.length,
  iiifResponses: images.length,
  largeDerivatives: images.filter((i) => /\/full\/(8|9|1[0-9])\d\d,\//.test(i.url)).length,
};
console.log(`\niiif responses seen: ${report.iiifResponses}, of which large (>=800px wide): ${report.largeDerivatives}`);
await writeFile(path.join(OUT, 'compare-cold.json'), JSON.stringify(report, null, 2));
await browser.close();
