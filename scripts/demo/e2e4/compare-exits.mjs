/**
 * Every way out of the two-up room, tried in order.
 *
 * `compare-cold.mjs` got stuck here: after opening the room it pressed Escape,
 * then clicked `.paillette-compare-neither`, and the room was still on screen
 * covering the board 30 seconds later. §7.3 makes compare a room rather than a
 * dialog, and a room with one door is a different thing to film than a room
 * with three. So this tries each exit against a fresh room and records what
 * each one actually does.
 *
 *   node scripts/demo/e2e4/compare-exits.mjs [baseUrl]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = path.resolve('docs/night/e2e-evidence/iteration-4');
const SHOTS = path.resolve('docs/night/shots/e2e4');
const CARD = 'article.paillette-card';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(OUT, { recursive: true });
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`, {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});
await page.waitForSelector(CARD, { timeout: 120_000 });

const ids = await page.evaluate(
  (sel) => [...document.querySelectorAll(sel)].map((el) => el.getAttribute('data-artwork-id')),
  CARD
);

const openRoom = async (pair) => {
  await page.evaluate(
    async (p) =>
      await window.__paillette_webmcp.call('compare_artworks', {
        artworkIds: p,
        question: 'Which one belongs above the sofa?',
      }),
    pair
  );
  await sleep(800);
};

const roomState = () =>
  page.evaluate(() => {
    const room = document.querySelector('[data-compare-room]');
    return {
      open: !!room,
      neitherButton: !!document.querySelector('.paillette-compare-neither'),
      neitherInput: !!document.querySelector('.paillette-compare-neither input, .paillette-compare-neither textarea'),
      focused: document.activeElement?.tagName ?? null,
      compareOpenAttr: document.documentElement.getAttribute('data-compare-open'),
    };
  });

const flagsOf = (pair) =>
  page.evaluate((p) => {
    const read = (id) => {
      const el = document.querySelector(`article.paillette-card[data-artwork-id="${id}"]`);
      const trayed = !!document.querySelector(`.lt-tray-card[data-artwork-id="${id}"]`);
      return el ? { id, flag: el.getAttribute('data-flag') } : { id, offBoard: true, inTray: trayed };
    };
    return p.map(read);
  }, pair);

const trials = [];
const trial = async (name, pair, action) => {
  await openRoom(pair);
  const before = await roomState();
  await action();
  await sleep(1200);
  const after = await roomState();
  const flags = await flagsOf(pair);
  const t = { name, before, after, closed: before.open && !after.open, flags };
  trials.push(t);
  console.log(`${name.padEnd(28)} open ${before.open} → ${after.open}   ${t.closed ? 'CLOSED' : 'still open'}   flags=${JSON.stringify(flags)}`);
  // make sure the next trial starts from a closed room
  if (after.open) {
    await page.locator('.paillette-compare-work').first().click().catch(() => {});
    await sleep(1200);
  }
  return t;
};

await trial('Escape', ids.slice(0, 2), async () => {
  await page.keyboard.press('Escape');
});
await trial('click the backdrop', ids.slice(2, 4), async () => {
  await page.mouse.click(20, 450);
});
await trial('click "Neither"', ids.slice(4, 6), async () => {
  await page.locator('.paillette-compare-neither').first().click().catch(() => {});
  await page.screenshot({ path: path.join(SHOTS, '33-compare-neither-clicked.png') });
});
await trial('"Neither" then Enter', ids.slice(6, 8), async () => {
  await page.locator('.paillette-compare-neither').first().click().catch(() => {});
  await sleep(500);
  await page.keyboard.press('Enter');
});
await trial('click a work', ids.slice(8, 10), async () => {
  await page.locator('.paillette-compare-work').first().click();
});

console.log('\nexits that close the room:', trials.filter((t) => t.closed).map((t) => t.name).join(', ') || 'NONE');
await writeFile(path.join(OUT, 'compare-exits.json'), JSON.stringify({ base: BASE, trials }, null, 2));
await browser.close();
