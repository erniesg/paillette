/**
 * Headless capture of the board, so the visuals can be judged without running
 * the app.
 *
 * Usage:
 *   pnpm --filter web dev --port 5200        # in one shell
 *   node scripts/capture-board-shots.mjs [baseUrl] [outDir]
 *
 * Defaults to a dev server on http://localhost:5200 and writes PNGs into
 * docs/night/shots/. Deliberately simple: it drives the /night/deal harness
 * through the loop with real clicks, so what lands in the PNG is what the
 * browser actually painted rather than a mock.
 *
 * Playwright is only installed inside apps/web (it is that package's dev
 * dependency), so the import is resolved from there rather than from the repo
 * root, which has no copy.
 */

import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../apps/web/package.json', import.meta.url)
);
const { chromium } = require('@playwright/test');
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.argv[2] ?? 'http://localhost:5200';
const outDir = process.argv[3] ?? 'docs/night/shots';

const VIEWPORT = { width: 1560, height: 1040 };

/** Images come from NGA's public IIIF endpoint, which is not instant. */
const IMAGE_SETTLE_MS = 3500;

async function settle(page, ms = 700) {
  await page.waitForTimeout(ms);
}

async function shoot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  → ${file}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();

  // The default run; a second context re-runs the deal with the accessibility
  // preference set, because "it degrades cleanly" is a claim that needs a shot.
  for (const variant of ['motion', 'reduced-motion']) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      reducedMotion: variant === 'reduced-motion' ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') console.log(`  ! console: ${message.text()}`);
    });

    console.log(`\n[${variant}] ${baseUrl}/night/deal`);
    await page.goto(`${baseUrl}/night/deal`, { waitUntil: 'networkidle' });
    await settle(page, IMAGE_SETTLE_MS);

    const suffix = variant === 'reduced-motion' ? '-reduced' : '';
    await shoot(page, `01-deal-fresh${suffix}`);

    // Pick three, reject two — the state every screenshot should be able to
    // show two hands in.
    const cards = page.locator('[data-board-slot]');
    for (const slot of [0, 4, 9]) {
      await cards.nth(slot).getByLabel('Pick').click();
    }
    for (const slot of [2, 6]) {
      await cards.nth(slot).getByLabel('Reject').click();
    }
    await settle(page);
    await shoot(page, `02-flagged${suffix}`);

    // The agent proposes, dashed and unconfirmed.
    await page.getByRole('button', { name: 'Agent proposes' }).click();
    await settle(page);
    await shoot(page, `03-agent-provisional${suffix}`);

    // A close crop of the first row, because the whole argument of the ink is
    // whether graphite-vs-colour and dashed-vs-solid are legible at all, and a
    // full-board shot is too small to tell.
    const firstRow = page.locator('[data-board-slot]').first();
    const box = await firstRow.boundingBox();
    if (box) {
      await page.screenshot({
        path: path.join(outDir, `03b-ink-detail${suffix}.png`),
        clip: { x: box.x - 8, y: box.y - 8, width: box.width * 2.2, height: box.height + 16 },
      });
      console.log(`  → ${outDir}/03b-ink-detail${suffix}.png`);
    }

    await page.getByRole('button', { name: 'Confirm marks' }).click();
    await settle(page);
    await shoot(page, `04-agent-confirmed${suffix}`);

    // Mid-deal: caught while the newcomers are still arriving.
    await page.getByRole('button', { name: 'Redeal' }).click();
    await page.waitForTimeout(180);
    await shoot(page, `05-deal-midflight${suffix}`);

    await settle(page, IMAGE_SETTLE_MS);
    await shoot(page, `06-deal-settled${suffix}`);

    // Light theme, once, to prove the restyle did not regress it.
    if (variant === 'motion') {
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'light';
      });
      await settle(page, 900);
      await shoot(page, '07-deal-light-theme');
    }

    await context.close();
  }

  await browser.close();
  console.log('\ndone');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
