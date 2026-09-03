/**
 * Record the deal.
 *
 * The deal animation is the one thing in this build that a screenshot cannot
 * show: the whole argument is that picks *stay* while rejects leave and
 * newcomers arrive, and "stayed" is a claim about two frames, not one. So this
 * records a video of the loop instead of photographing the ends of it.
 *
 * Usage:
 *   pnpm --filter web dev --port 5200
 *   node scripts/capture-deal-video.mjs [baseUrl] [outDir]
 */

import { createRequire } from 'node:module';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(
  new URL('../apps/web/package.json', import.meta.url)
);
const { chromium } = require('@playwright/test');

const baseUrl = process.argv[2] ?? 'http://localhost:5200';
const outDir = process.argv[3] ?? 'docs/night/shots';
const VIEWPORT = { width: 1560, height: 1040 };

/** IIIF images are not instant, and a deal into empty frames proves nothing. */
const IMAGE_SETTLE_MS = 3500;

async function imagesDecoded(page, selector, timeout = 45000) {
  try {
    await page.waitForFunction(
      (sel) => {
        const images = Array.from(document.querySelectorAll(sel));
        return (
          images.length > 0 &&
          images.every((image) => image.complete && image.naturalWidth > 0)
        );
      },
      selector,
      { timeout }
    );
  } catch {
    console.log(`  ! images never settled: ${selector}`);
  }
}

async function main() {
  const raw = path.join(outDir, '.video-raw');
  await mkdir(outDir, { recursive: true });
  await rm(raw, { recursive: true, force: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: raw, size: VIEWPORT },
  });
  const page = await context.newPage();

  await page.goto(`${baseUrl}/night/deal`, { waitUntil: 'networkidle' });
  await imagesDecoded(page, '.lt-slide-well img');
  await page.waitForTimeout(1500);

  // Flag by hand first, so the redeal has something of the human's to keep and
  // the video shows continuity rather than a reshuffle.
  const cards = page.locator('[data-board-slot]');
  for (const slot of [0, 4, 9]) {
    await cards.nth(slot).getByLabel('Pick').click();
    await page.waitForTimeout(400);
  }
  for (const slot of [2, 6]) {
    await cards.nth(slot).getByLabel('Reject').click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1200);

  // Two deals, with a beat between them: the first shows picks holding, the
  // second shows the tray filling as the board keeps moving around them.
  for (let i = 0; i < 2; i += 1) {
    await page.getByRole('button', { name: 'Redeal' }).click();
    await page.waitForTimeout(IMAGE_SETTLE_MS);
  }

  await context.close();
  await browser.close();

  const [file] = await readdir(raw);
  if (!file) throw new Error('playwright wrote no video');
  const target = path.join(outDir, 'deal-animation.webm');
  await rename(path.join(raw, file), target);
  await rm(raw, { recursive: true, force: true });
  console.log(`  → ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
