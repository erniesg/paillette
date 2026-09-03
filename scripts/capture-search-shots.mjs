/**
 * Headless capture of the restyled search grid.
 *
 * The public search API needs a bearer token that a local dev server does not
 * have, so a plain `pnpm dev` run can only ever reach the "A valid bearer token
 * is required" state. This intercepts the search endpoint and answers it with
 * the same real NGA works the board demo uses, so the masonry and salon layouts
 * render with actual pictures and actual catalogue data.
 *
 * What is stubbed is the *transport*, not the components: everything below the
 * fetch is the real page. What these shots do not prove is retrieval quality —
 * the ranking here is the fixture's order, not the search engine's.
 *
 * Usage:
 *   pnpm --filter web dev --port 5210
 *   node scripts/capture-search-shots.mjs [baseUrl] [outDir]
 */

import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(
  new URL('../apps/web/package.json', import.meta.url)
);
const { chromium } = require('@playwright/test');

const baseUrl = process.argv[2] ?? 'http://localhost:5210';
const outDir = process.argv[3] ?? 'docs/night/shots';

async function loadFixtureWorks() {
  // The fixture is a TS module; rather than compile it, read the literals out.
  const source = await readFile(
    new URL('../apps/web/app/lib/board/demo-works.ts', import.meta.url),
    'utf8'
  );
  const works = [];
  const blocks = source.split('  {\n').slice(1);
  for (const block of blocks) {
    const field = (name) =>
      block.match(new RegExp(`${name}:\\s*\\n?\\s*'([^']*)'`))?.[1] ?? '';
    const id = field('id');
    if (!id) continue;
    works.push({
      id,
      galleryId: 'nga',
      title: field('title'),
      artist: field('artist'),
      year: Number(field('dateText')) || undefined,
      imageUrl: field('imageUrl'),
      thumbnailUrl: field('thumbnailUrl'),
      similarity: 0.9 - works.length * 0.01,
      metadata: {
        accessionNumber: field('accession'),
        classification: 'Painting',
        medium: 'tempera on panel',
      },
    });
  }
  return works;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const works = await loadFixtureWorks();
  console.log(`fixture: ${works.length} works`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1560, height: 1180 },
    deviceScaleFactor: 2,
  });

  // A predicate rather than a glob: the glob form silently failed to match and
  // the shots came back showing the API's "valid bearer token" error instead of
  // the grid, which is a stub that fails open into a screenshot of nothing.
  await context.route(
    (url) => url.pathname.endsWith('/text'),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { results: works.slice(0, 24), count: 24, queryTime: 120 },
        }),
      });
    }
  );

  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`  ! ${message.text().slice(0, 110)}`);
  });

  await page.goto(`${baseUrl}/nga/search`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(outDir, '10-search-idle.png') });
  console.log('  → 10-search-idle.png');

  const box = page.getByPlaceholder('search by feeling, era, subject...');
  await box.click({ force: true });
  await box.fill('gold ground madonna');
  await box.press('Enter');
  await page.waitForTimeout(6000);

  // Fail loudly rather than saving a picture of an error state. The previous
  // run of this script wrote three screenshots of "A valid bearer token is
  // required" and they looked, at a glance, like screenshots of the page.
  const cards = await page.locator('article.lt-slide').count();
  if (cards === 0) {
    throw new Error(
      'no result cards rendered — the search stub did not take effect'
    );
  }
  console.log(`  ${cards} cards on the grid`);

  await page.screenshot({ path: path.join(outDir, '11-search-masonry.png') });
  console.log('  → 11-search-masonry.png');

  for (const [view, file] of [
    ['Salon', '12-search-salon.png'],
    ['Table', '13-search-table.png'],
  ]) {
    const button = page.getByRole('button', { name: view, exact: true }).first();
    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(4000);
      await page.screenshot({ path: path.join(outDir, file) });
      console.log(`  → ${file}`);
    }
  }

  // Light theme, to show the restyle did not regress it.
  await page.getByRole('button', { name: 'Masonry', exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, '14-search-light-theme.png') });
  console.log('  → 14-search-light-theme.png');

  await browser.close();
  console.log('done');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
