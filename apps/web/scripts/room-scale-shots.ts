/**
 * The six-work show, photographed and measured, before and after its works
 * had sizes.
 *
 * Opens the published short link in the room the way a visitor does, lets the
 * near textures settle, and saves one frame. Alongside it, the loader's own
 * data for the same link — what `dimensions` each work arrived with and what
 * the shared parser makes of it — and, where the deployed scene publishes it,
 * what each work was actually hung at. A screenshot of "different sizes" is a
 * judgement; the sizes are a number.
 *
 *   ROOM_SCALE_LABEL=before pnpm --filter web exec tsx scripts/room-scale-shots.ts
 *
 * `CHROME_PATH` points it at an installed Chromium when the one Playwright
 * pins is not on the machine.
 *
 * `--enable-unsafe-swiftshader` because this VM has no real GPU; the renderer
 * string is recorded so nobody reads anything here as a frame-rate claim.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import { parseDimensions } from '../app/lib/room/dimensions';

const ORIGIN = process.env.PAILLETTE_ORIGIN ?? 'https://paillette-stg.berlayar.ai';
const CODE = process.env.ROOM_SCALE_CODE ?? 'MKwsxHy';
const LABEL = process.env.ROOM_SCALE_LABEL;
const OUT = process.env.ROOM_SCALE_OUT ?? '../../docs/night/shots/room-scale';

if (!LABEL || !/^[a-z0-9-]+$/.test(LABEL)) {
  throw new Error('ROOM_SCALE_LABEL must be set, e.g. before or after');
}

interface HungSize {
  artworkId: string;
  widthM: number;
  heightM: number;
  measured: boolean;
}

const readWorks = (page: Page) =>
  page.evaluate(
    () =>
      (window as Window & { __paillette_room?: { works?: HungSize[] } }).__paillette_room
        ?.works ?? null
  );

const drag = async (page: Page, dx: number) => {
  const box = (await page.locator('canvas.exhibition-room-canvas').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(x + (dx * step) / 12, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(2500);
};

const main = async () => {
  await mkdir(OUT, { recursive: true });

  const loader = (await (
    await fetch(`${ORIGIN}/e/${CODE}?_data=${encodeURIComponent('routes/e.$code')}`)
  ).json()) as { works: { artworkId: string; title: string; dimensions: unknown }[] };
  const catalogue = loader.works.map((work) => ({
    artworkId: work.artworkId,
    title: work.title,
    dimensions: work.dimensions,
    parsed: parseDimensions(work.dimensions),
  }));

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto(`${ORIGIN}/e/${CODE}?v=room`, { waitUntil: 'load' });
  await page.locator('canvas.exhibition-room-canvas').waitFor({ state: 'visible' });
  // Walls, then every base texture, then the near ones.
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT}/${LABEL}.png` });
  // The side walls, looked at by dragging, the way a visitor turns their head.
  await drag(page, 320);
  await page.screenshot({ path: `${OUT}/${LABEL}-west.png` });
  await drag(page, -640);
  await page.screenshot({ path: `${OUT}/${LABEL}-east.png` });

  const hung = await readWorks(page);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  await browser.close();

  const distinctHungSizes = hung
    ? new Set(hung.map((work) => `${work.widthM.toFixed(4)}x${work.heightM.toFixed(4)}`)).size
    : null;
  const result = {
    label: LABEL,
    url: `${ORIGIN}/e/${CODE}?v=room`,
    takenAt: new Date().toISOString(),
    renderer,
    works: catalogue.length,
    parsed: catalogue.filter((work) => work.parsed).length,
    distinctHungSizes,
    catalogue,
    hung,
    pageErrors: errors,
  };
  await writeFile(`${OUT}/${LABEL}.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    JSON.stringify(
      { label: LABEL, works: result.works, parsed: result.parsed, distinctHungSizes, errors: errors.length },
      null,
      2
    )
  );
};

await main();
