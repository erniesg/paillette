/**
 * Does the sticky results toolbar sit on top of the agent's wall label?
 *
 * Section 7 calls the note-plus-board frame the defining image of the
 * submission, and the one frame the night produced of it had the sentence
 * sliced horizontally. Assertions were not enough to catch that — the geometry
 * was measured and passed, because what was measured was the *bar*, not the
 * note. So this measures the two rectangles against each other and writes the
 * picture out next to the numbers.
 *
 *   node scripts/demo/note-vs-toolbar.mjs <url> "<instruction>" <out-dir>
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from './browser.mjs';

const [url, instruction, outDir = 'docs/night/shots/note-vs-toolbar'] =
  process.argv.slice(2);
if (!url || !instruction) {
  console.error(
    'usage: node scripts/demo/note-vs-toolbar.mjs <url> "<instruction>" [outDir]'
  );
  process.exit(2);
}

const SCROLLS = [0, 120, 200, 261, 320];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The note, wherever it is on the page, and the sticky bar above it. */
const measure = () => {
  const note =
    document.querySelector('[data-board-note]') ??
    document.querySelector('.paillette-board-note') ??
    [...document.querySelectorAll('p, div')].find((el) =>
      el.className &&
      typeof el.className === 'string' &&
      el.className.includes('font-wall') &&
      el.textContent.trim().length > 30 &&
      el.getBoundingClientRect().width > 200
    ) ??
    null;
  const bar = [...document.querySelectorAll('div')].find(
    (el) => getComputedStyle(el).position === 'sticky'
  );
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      left: Math.round(r.left),
      height: Math.round(r.height),
    };
  };
  return {
    noteText: note?.textContent?.trim().slice(0, 140) ?? null,
    note: rect(note),
    bar: rect(bar),
    barPosition: bar ? getComputedStyle(bar).position : null,
  };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle' });

const input = page.locator('input[aria-label="Ask the agent"]');
await input.waitFor({ timeout: 30_000 });
await input.fill(instruction);
await input.press('Enter');

// The note is the last thing a turn writes, so wait for text rather than a
// spinner settling.
const deadline = Date.now() + 150_000;
let sawNote = false;
while (Date.now() < deadline) {
  const seen = await page.evaluate(measure);
  if (seen.noteText) {
    sawNote = true;
    break;
  }
  await sleep(2000);
}

await mkdir(outDir, { recursive: true });
const frames = [];
for (const scrollY of SCROLLS) {
  await page.evaluate((y) => window.scrollTo(0, y), scrollY);
  await sleep(400);
  const seen = await page.evaluate(measure);
  const overlap =
    seen.note && seen.bar
      ? Math.max(
          0,
          Math.min(seen.note.bottom, seen.bar.bottom) -
            Math.max(seen.note.top, seen.bar.top)
        )
      : null;
  frames.push({
    scrollY,
    ...seen,
    // The number that matters: how many pixels of the sentence the bar is
    // sitting on. Anything above zero means the money shot is unusable.
    overlapPx: overlap,
    sliced: Boolean(overlap && overlap > 0),
  });
  await page.screenshot({
    path: path.join(outDir, `note-scroll${String(scrollY).padStart(3, '0')}.png`),
  });
}

const report = { url, instruction, sawNote, frames };
await writeFile(
  path.join(outDir, 'note-vs-toolbar.json'),
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(sawNote && frames.every((frame) => !frame.sliced) ? 0 : 1);
