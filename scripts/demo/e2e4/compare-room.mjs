/**
 * The two-up, in detail — because the loop harness screenshot it at 1.2s and
 * both works were empty rectangles with only their wall text on them.
 *
 * §8 calls compare "the demo's best ten seconds", so whether that is a slow
 * load or an unloaded image matters to whoever films it. This opens the room,
 * polls each `<img>` for `complete` and `naturalWidth` every 250ms, and records
 * when the pictures actually arrive — plus what the room shows and whether
 * choosing sends a turn.
 *
 *   node scripts/demo/e2e4/compare-room.mjs [baseUrl]
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
const wire = [];
page.on('request', (r) => wire.push({ t: Date.now(), method: r.method(), url: r.url() }));

await page.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`, {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});
await page.waitForSelector(CARD, { timeout: 120_000 });

const ids = await page.evaluate(
  (sel) => [...document.querySelectorAll(sel)].map((el) => el.getAttribute('data-artwork-id')),
  CARD
);
const pair = [ids[0], ids[1]];

// Fire the tool without awaiting it, so the clock starts when the human's
// gesture does rather than when the promise settles — the loop harness
// screenshot the room 1.2s after the call *returned* and caught two empty
// rectangles, so the question is how long the pictures take from the click.
const openedAt = Date.now();
const pending = page.evaluate(
  async (p) =>
    await window.__paillette_webmcp.call('compare_artworks', {
      artworkIds: p,
      question: 'Which one belongs above the sofa?',
    }),
  pair
);

/** Every 250ms: is each picture actually painted yet? */
const samples = [];
for (let i = 0; i < 40; i += 1) {
  const s = await page.evaluate(() => {
    const room = document.querySelector('[data-compare-room]');
    if (!room) return null;
    return [...room.querySelectorAll('img')].map((img) => ({
      rect: Math.round(img.getBoundingClientRect().width),
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      src: (img.currentSrc || img.src || '').slice(-60),
    }));
  });
  samples.push({ atMs: Date.now() - openedAt, roomPresent: s !== null, imgs: s });
  if (s && s.length >= 2 && s.every((i2) => i2.complete && i2.naturalWidth > 0)) break;
  await sleep(100);
}
const result = await pending;
const roomFirstSeenAt = samples.find((s) => s.roomPresent)?.atMs ?? null;

const bothLoadedAt = samples.find((s) => s.imgs && s.imgs.length >= 2 && s.imgs.every((i) => i.complete && i.naturalWidth > 0));

await page.screenshot({ path: path.join(SHOTS, '30-compare-room-loaded.png') });

const room = await page.evaluate(() => {
  const el = document.querySelector('[data-compare-room]');
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return {
    box: { top: Math.round(b.top), left: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) },
    question: el.querySelector('p')?.textContent?.trim() ?? null,
    works: [...el.querySelectorAll('.paillette-compare-work')].map((w) => w.textContent.trim().slice(0, 80)),
    neither: !!el.querySelector('.paillette-compare-neither'),
    imgCount: el.querySelectorAll('img').length,
  };
});

// choose the left work, and watch for a turn
const clickedAt = Date.now();
await page.locator('.paillette-compare-work').first().click();
await sleep(3000);
const resolved = await page.evaluate((p) => {
  const read = (id) => {
    const el = document.querySelector(`article.paillette-card[data-artwork-id="${id}"]`);
    const trayed = !!document.querySelector(`.lt-tray-card[data-artwork-id="${id}"]`);
    return el
      ? { id, flag: el.getAttribute('data-flag'), by: el.getAttribute('data-flag-by') }
      : { id, offBoard: true, inTray: trayed };
  };
  return { roomClosed: !document.querySelector('[data-compare-room]'), works: p.map(read) };
}, pair);
const turnsAfterChoice = wire.filter(
  (r) => r.t >= clickedAt && r.method === 'POST' && r.url.includes('/public-agent/turn')
).length;

await page.screenshot({ path: path.join(SHOTS, '31-compare-after-choice.png') });

const report = {
  base: BASE,
  pair,
  toolResult: result,
  room,
  roomFirstSeenAtMs: roomFirstSeenAt,
  imagesFullyLoadedAtMs: bothLoadedAt ? bothLoadedAt.atMs : null,
  imageSamples: samples,
  choice: { resolved, turnsAfterChoice, waitedMs: 3000 },
};

console.log(JSON.stringify({ room, imagesFullyLoadedAtMs: report.imagesFullyLoadedAtMs, choice: report.choice }, null, 2));
console.log('\n--- read out ---');
console.log(`room:            ${room ? `${room.box.w}x${room.box.h} at ${room.box.top},${room.box.left}` : 'ABSENT'}`);
console.log(`question:        ${JSON.stringify(room?.question)}`);
console.log(`images:          ${room?.imgCount} in the room`);
console.log(`room in the DOM at:        ${roomFirstSeenAt}ms after the call was made`);
console.log(`both pictures painted at: ${report.imagesFullyLoadedAtMs === null ? 'NEVER within the poll window' : `${report.imagesFullyLoadedAtMs}ms after the call was made`}`);
console.log(`choosing:        room closed=${resolved.roomClosed}  ${JSON.stringify(resolved.works)}`);
console.log(`turns sent:      ${turnsAfterChoice} within 3s of the click`);

await writeFile(path.join(OUT, 'compare-room.json'), JSON.stringify(report, null, 2));
await browser.close();
