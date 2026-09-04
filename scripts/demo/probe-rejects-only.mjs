/**
 * The gesture the brief calls the headline beat: X on two pictures, Enter on
 * an empty bar, nothing picked.
 *
 * Reproduces the critique's probe exactly — a cold `/nga/search`, a typed
 * query, two `X` presses, Enter — and reports what the critique measured:
 * how many requests went out, whether the board changed, and whether the page
 * said anything either way. Typed throughout; the mic is never touched.
 *
 *   node scripts/demo/probe-rejects-only.mjs <base-url> [out-dir]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from './browser.mjs';

const [base = 'https://paillette-stg.berlayar.ai', outDir = 'docs/night/shots/fix4-rejects'] =
  process.argv.slice(2);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The works on screen, in order, by their card ids. */
const readBoard = () =>
  [...document.querySelectorAll('.paillette-card[data-artwork-id]')].map((el) =>
    el.getAttribute('data-artwork-id')
  );

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const requests = [];
page.on('request', (request) => {
  const url = request.url();
  if (!/\.(png|jpe?g|webp|avif|svg|css|woff2?)(\?|$)/i.test(url)) {
    requests.push({ method: request.method(), url });
  }
});

await page.goto(`${base}/nga/search?q=warm%20landscape`, {
  waitUntil: 'networkidle',
});
await page.waitForSelector('[data-artwork-id]', { timeout: 60_000 });
await sleep(1500);

const before = await page.evaluate(readBoard);
await mkdir(outDir, { recursive: true });
await page.screenshot({ path: path.join(outDir, '01-grid.png') });

// Two X presses on the first two cards, by hovering and pressing the key —
// the human's own path, not a tool call.
const rejected = [];
for (const id of before.slice(0, 2)) {
  const card = page.locator(`[data-artwork-id="${id}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await sleep(200);
  await page.keyboard.press('x');
  await sleep(300);
  rejected.push(id);
}
await page.screenshot({ path: path.join(outDir, '02-two-rejects.png') });

const flagsAfterX = await page.evaluate(() =>
  [...document.querySelectorAll('.paillette-card[data-flag]')]
    .filter((el) => el.getAttribute('data-flag') !== 'none')
    .map((el) => ({
      id: el.getAttribute('data-artwork-id'),
      flag: el.getAttribute('data-flag'),
      by: el.getAttribute('data-flag-by'),
    }))
);

// Enter on the empty bar.
const mark = requests.length;
const bar = page.locator('input[aria-label="Ask the agent"]');
await bar.waitFor({ timeout: 30_000 });
await bar.click();
await bar.fill('');
await bar.press('Enter');

// Give the deal room to run and settle.
await sleep(9000);

const after = await page.evaluate(readBoard);
const issued = requests.slice(mark);
await page.screenshot({ path: path.join(outDir, '03-after-enter.png') });

const surfaces = await page.evaluate(() => ({
  dealError:
    document.querySelector('[data-deal-error]')?.getAttribute('data-deal-error') ??
    null,
  dealErrorText:
    document.querySelector('[data-deal-error]')?.textContent?.trim() ?? null,
  note: document.querySelector('[data-board-note]')?.textContent?.trim() ?? null,
  trayPresent: Boolean(document.querySelector('.lt-tray')),
  tray: document.querySelectorAll('.lt-tray .paillette-card, .lt-tray [data-artwork-id]')
    .length,
  dealtBoard: Boolean(document.querySelector('.lt-deal-viewport')),
}));

const result = {
  base,
  rejected,
  boardBefore: before.length,
  boardAfter: after.length,
  boardChanged: JSON.stringify(before) !== JSON.stringify(after),
  newWorks: after.filter((id) => !before.includes(id)).length,
  rejectsStillOnBoard: rejected.filter((id) => after.includes(id)).length,
  requestsAfterEnter: issued,
  exemplarCalls: issued.filter((r) => r.url.includes('/exemplars')).length,
  agentCalls: issued.filter((r) => r.url.includes('public-agent')).length,
  ...surfaces,
  flagsAfterX,
};

await writeFile(
  path.join(outDir, 'rejects-only.json'),
  `${JSON.stringify(result, null, 2)}\n`
);
console.log(
  JSON.stringify(
    { ...result, requestsAfterEnter: issued.map((r) => `${r.method} ${r.url}`) },
    null,
    2
  )
);
await browser.close();
