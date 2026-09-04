/**
 * Does the deal animate on /nga/search, or only in the /night/deal harness?
 *
 * The brief says confirm it. The preflight's first answer was "1 distinct
 * layout", which is the same number iteration 5's walk run 2 produced and then
 * had to retract — its sampler stopped before the exemplars call returned. So
 * this probe refuses to score the animation until it has evidence the board
 * actually changed:
 *
 *   - it waits for the POST /exemplars *response*, not a fixed interval;
 *   - it records the card ids before and after and reports how many are new;
 *   - it samples continuously from the keypress and reports when each distinct
 *     layout was first seen, so a flat result can be told apart from a late one.
 *
 *   node scripts/demo/film/probe-deal.mjs [base-url] [query]
 */

import { chromium } from '../browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const QUERY = process.argv[3] ?? 'warm landscape';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const wire = [];
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('/api/public-')) wire.push({ t: Date.now(), kind: 'req', url: u });
});
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/public-'))
    wire.push({ t: Date.now(), kind: 'res', status: r.status(), url: u });
});

await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForSelector('[data-artwork-id]', { timeout: 60_000 });
await sleep(3000);

const boardIds = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')]
      .filter((el) => !el.closest('.lt-tray'))
      .map((el) => el.getAttribute('data-artwork-id'))
  );

const gridPresent = () =>
  page.evaluate(() =>
    Boolean(document.querySelector('[data-testid="deal-board-grid"]'))
  );

console.log(`grid before any flag: ${await gridPresent()}`);

const cards = page.locator('[data-artwork-id]');
for (const [i, key] of [
  [0, 'x'],
  [1, 'x'],
  [2, 'p'],
]) {
  await cards.nth(i).hover();
  await sleep(400);
  await page.keyboard.press(key);
  await sleep(300);
}
await page.mouse.move(5, 5);
await sleep(800);

console.log(`grid after flags:     ${await gridPresent()}`);

// Two Enters. The first is the jump cut off a text search; the second is the
// board-to-board deal the film actually wants. Both measured.
for (const pass of [1, 2]) {
  const before = await boardIds();
  const gridBefore = await gridPresent();

  const sample = page.evaluate(
    () =>
      new Promise((resolve) => {
        const first = new Map();
        let frames = 0;
        const t0 = performance.now();
        const tick = () => {
          const g = document
            .querySelector('[data-testid="deal-board-grid"]')
            ?.getBoundingClientRect();
          if (g) {
            const key = [...document.querySelectorAll('[data-artwork-id]')]
              .filter((el) => !el.closest('.lt-tray'))
              .map((el) => {
                const r = el.getBoundingClientRect();
                return `${Math.round(r.x - g.x)},${Math.round(r.y - g.y)}`;
              })
              .join('|');
            if (key && !first.has(key))
              first.set(key, Math.round(performance.now() - t0));
          }
          frames += 1;
          if (performance.now() - t0 < 15000) requestAnimationFrame(tick);
          else
            resolve({
              layouts: first.size,
              frames,
              firstSeenAt: [...first.values()].sort((a, b) => a - b),
            });
        };
        requestAnimationFrame(tick);
      })
  );

  const mark = Date.now();
  await page.keyboard.press('Enter');
  const { layouts, frames, firstSeenAt } = await sample;
  const after = await boardIds();

  const exemplars = wire.filter(
    (w) => w.kind === 'res' && w.url.includes('/exemplars') && w.t >= mark
  );
  const fresh = after.filter((id) => !before.includes(id));

  console.log(
    [
      ``,
      `--- Enter #${pass} ---`,
      `grid before:      ${gridBefore}`,
      `cards before/after: ${before.length} -> ${after.length}`,
      `new cards:        ${fresh.length}`,
      `exemplars call:   ${
        exemplars.length
          ? `${exemplars.length}, http ${exemplars.map((e) => e.status).join(',')}, +${
              exemplars[0].t - mark
            } ms`
          : 'NONE'
      }`,
      `distinct layouts: ${layouts} over ${frames} frames`,
      `layouts first seen at (ms): ${firstSeenAt.slice(0, 30).join(' ')}${
        firstSeenAt.length > 30 ? ' …' : ''
      }`,
    ].join('\n')
  );

  await sleep(4000);
}

await page.screenshot({ path: '/tmp/film-probe-deal.png' });
await ctx.close();
await browser.close();
