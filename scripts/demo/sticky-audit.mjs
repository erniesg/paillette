/**
 * Every element that is pinned, and what it is pinned over.
 *
 * The first attempt at this measured "the first sticky div on the page" and
 * found something 102px tall that was not the results toolbar at all — which
 * is how a geometry check passes while the picture is still wrong. So: list
 * them all, with their classes, and say which of them overlap the note.
 *
 *   node scripts/demo/sticky-audit.mjs <url> "<instruction>" [scrollY]
 */

import { chromium } from './browser.mjs';

const [url, instruction, scrollY = '261'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle' });

if (instruction) {
  const bar = page.locator('input[aria-label="Ask the agent"]');
  await bar.waitFor({ timeout: 30_000 });
  await bar.fill(instruction);
  await bar.press('Enter');
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => Boolean(document.querySelector('[data-board-note]'))))
      break;
    await sleep(2000);
  }
}

await page.evaluate((y) => window.scrollTo(0, Number(y)), scrollY);
await sleep(500);

const audit = await page.evaluate(() => {
  const note = document.querySelector('[data-board-note]');
  const noteRect = note?.getBoundingClientRect() ?? null;
  const pinned = [...document.querySelectorAll('*')]
    .filter((el) => {
      const position = getComputedStyle(el).position;
      return position === 'sticky' || position === 'fixed';
    })
    .map((el) => {
      const r = el.getBoundingClientRect();
      const overlap = noteRect
        ? Math.max(0, Math.min(noteRect.bottom, r.bottom) - Math.max(noteRect.top, r.top))
        : 0;
      return {
        tag: el.tagName.toLowerCase(),
        position: getComputedStyle(el).position,
        zIndex: getComputedStyle(el).zIndex,
        className: String(el.className).slice(0, 110),
        rect: {
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          height: Math.round(r.height),
        },
        overlapsNote: overlap > 0 ? Math.round(overlap) : 0,
      };
    });
  return {
    noteText: note?.textContent?.trim() ?? null,
    noteRect: noteRect
      ? { top: Math.round(noteRect.top), bottom: Math.round(noteRect.bottom) }
      : null,
    boardIsDealt: Boolean(document.querySelector('.lt-deal-viewport')),
    pinned,
  };
});

console.log(JSON.stringify(audit, null, 2));
await browser.close();
