/**
 * Evidence for the one claim the deal animation makes.
 *
 * "Picks stay exactly where they are" is falsifiable, so it should be measured
 * rather than eyeballed: this drives the real board in a real browser, records
 * every pick's bounding box before and after a redeal, and fails if any of them
 * moved. It also samples an arriving card mid-flight to show the newcomers are
 * genuinely animating in rather than appearing, and records the whole thing to
 * video, which is the only artifact that actually shows the deal.
 *
 * Usage:
 *   node scripts/verify-deal-animation.mjs [baseUrl] [outDir]
 */

import { createRequire } from 'node:module';
import { mkdir, readdir, rename } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(
  new URL('../apps/web/package.json', import.meta.url)
);
const { chromium } = require('@playwright/test');

const baseUrl = process.argv[2] ?? 'http://localhost:5210';
const outDir = process.argv[3] ?? 'docs/night/shots';

/** A pick must not move at all. One pixel of slop for sub-pixel layout. */
const TOLERANCE_PX = 1;

const boxesBySlot = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-board-slot]')).map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        slot: node.getAttribute('data-board-slot'),
        held: node.hasAttribute('data-held'),
        title: node.querySelector('h3')?.textContent ?? '',
        flag: node.querySelector('[data-flag]')?.getAttribute('data-flag') ?? null,
        hand: node.querySelector('[data-hand]')?.getAttribute('data-hand') ?? null,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
      };
    })
  );

async function main() {
  await mkdir(outDir, { recursive: true });
  const videoDir = path.join(outDir, '.video');
  await mkdir(videoDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1560, height: 1040 },
    recordVideo: { dir: videoDir, size: { width: 1560, height: 1040 } },
  });
  const page = await context.newPage();

  await page.goto(`${baseUrl}/night/deal`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  // Flag: three picks and two rejects, one of each hand.
  const cards = page.locator('[data-board-slot]');
  for (const slot of [0, 4, 9]) await cards.nth(slot).getByLabel('Pick').click();
  for (const slot of [2, 6]) await cards.nth(slot).getByLabel('Reject').click();
  await page.getByRole('button', { name: 'Agent proposes' }).click();
  await page.waitForTimeout(600);

  const before = await boxesBySlot(page);
  const pickedBefore = before.filter((card) => card.flag === 'pick');
  console.log(`\nBefore the redeal — ${pickedBefore.length} picks on the board:`);
  for (const card of pickedBefore) {
    console.log(`  slot ${card.slot} (${card.hand}) @ ${card.x},${card.y}  ${card.title.slice(0, 40)}`);
  }

  await page.getByRole('button', { name: 'Redeal' }).click();

  // Mid-flight: an entering card should still be offset to the right.
  await page.waitForTimeout(110);
  const midflight = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-board-slot]')).map((node) => ({
      title: node.querySelector('h3')?.textContent ?? '',
      held: node.hasAttribute('data-held'),
      transform: getComputedStyle(node).transform,
    }))
  );
  const moving = midflight.filter(
    (card) => card.transform && card.transform !== 'none' && !card.transform.startsWith('matrix(1, 0, 0, 1, 0, 0')
  );
  console.log(`\nMid-flight (110ms in): ${moving.length} of ${midflight.length} cards carrying a transform`);
  for (const card of moving.slice(0, 4)) {
    console.log(`  ${card.held ? 'HELD ' : 'new  '} ${card.transform}  ${card.title.slice(0, 34)}`);
  }

  await page.waitForTimeout(2500);
  const after = await boxesBySlot(page);

  // The claim.
  let failures = 0;
  console.log('\nAfter the redeal — did the picks move?');
  for (const card of pickedBefore) {
    const match = after.find((other) => other.title === card.title);
    if (!match) {
      console.log(`  ✗ ${card.title.slice(0, 40)} — left the board entirely`);
      failures += 1;
      continue;
    }
    const dx = Math.abs(match.x - card.x);
    const dy = Math.abs(match.y - card.y);
    const ok = dx <= TOLERANCE_PX && dy <= TOLERANCE_PX;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? '✓' : '✗'} ${card.title.slice(0, 40).padEnd(42)} slot ${card.slot}→${match.slot}  Δ${dx},${dy}px`
    );
  }

  const heldCount = after.filter((card) => card.held).length;
  console.log(`\nBoard reports ${heldCount} held cards.`);

  await context.close();
  await browser.close();

  // Playwright names videos by page guid; give it a name a human can find.
  const files = await readdir(videoDir);
  const video = files.find((file) => file.endsWith('.webm'));
  if (video) {
    const dest = path.join(outDir, 'deal-animation.webm');
    await rename(path.join(videoDir, video), dest);
    console.log(`Video → ${dest}`);
  }

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} pick(s) moved during the redeal.`);
    process.exit(1);
  }
  console.log('\nOK: every pick held its exact position through the redeal.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
