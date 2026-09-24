/**
 * What #75 says the merged room must do on staging, checked in a browser.
 *
 * `room-shots.ts` photographs and measures; this answers yes or no to the
 * claims that a photograph can only suggest:
 *
 *   flat      a bare `/e/:code` still opens the flat page, not the room
 *   textures  `?v=room` fetches all four wall and floor materials
 *   walk      the on-screen walk pad is visible, on a desktop and on a phone
 *   frames    choosing a frame changes what the room draws around the works
 *   label     a wall label edited on the page survives a reload in the same
 *             browser, and does not appear in a different one
 *
 * `SABOTAGE=1` breaks each claim on purpose — materials blocked, the walk pad
 * hidden, the room asked for where the flat page should be, the frame left
 * unchanged, the reload done in a fresh browser, a build that is not the
 * deployed one expected — and every check must then
 * fail. A check that cannot fail is not evidence.
 *
 *   CODE=MKwsxHy pnpm --filter web exec tsx scripts/room-merged-checks.ts
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

const ORIGIN =
  process.env.PAILLETTE_ORIGIN ?? 'https://paillette-stg.berlayar.ai';
const CODE = process.env.CODE ?? 'MKwsxHy';
const SABOTAGE = process.env.SABOTAGE === '1';

const MATERIALS = [
  'oak-color.png',
  'oak-normal.png',
  'plaster-color.png',
  'plaster-normal.png',
];

const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};
const DESKTOP = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
};

/**
 * Staging is shared by several lanes and any of them can deploy over this
 * one mid-run. The exhibition bundle's content hash names the build that
 * answered; a run that does not start and end on `EXPECT_BUNDLE` proves
 * nothing about this tree.
 */
const servedBundle = async (): Promise<string> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const url = `${ORIGIN}/e/${CODE}?v=room&bundle=${Date.now()}`;
      const html = await (await fetch(url)).text();
      return html.match(/exhibition-view-[\w-]+\.js/)?.[0] ?? 'none';
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
};

const results: { check: string; ok: boolean; detail: string }[] = [];
const record = (check: string, ok: boolean, detail: string) => {
  results.push({ check, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}  ${detail}`);
};

/** One of staging's edge addresses drops connections from this VM; retry. */
const open = async (page: Page, path: string) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(`${ORIGIN}${path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      break;
    } catch (error) {
      // The app replacing its own URL during load lands on the same page.
      if (String(error).includes('interrupted by another navigation')) break;
      if (attempt >= 3) throw error;
    }
  }
  await page
    .waitForLoadState('networkidle', { timeout: 30000 })
    .catch(() => {});
};

const canvas = (page: Page) => page.locator('canvas.exhibition-room-canvas');

const flat = async (browser: Browser) => {
  const context = await browser.newContext(DESKTOP);
  const page = await context.newPage();
  await open(page, SABOTAGE ? `/e/${CODE}?v=room` : `/e/${CODE}`);
  await page.waitForTimeout(3000);
  const rooms = await canvas(page).count();
  const hung = await page.locator('.exhibition-page .exhibition-image').count();
  record(
    'flat',
    rooms === 0 && hung > 0,
    `room canvases=${rooms} flat images=${hung}`
  );
  await context.close();
};

const room = async (
  browser: Browser,
  label: string,
  device: typeof DESKTOP | typeof PHONE
) => {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  const loaded = new Map<string, number>();
  page.on('response', (response) => {
    const name = response.url().split('/room/materials/')[1];
    if (name) loaded.set(name.split('?')[0]!, response.status());
  });
  if (SABOTAGE) {
    await page.route('**/room/materials/**', (route) => route.abort());
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '.gallery-walk { display: none !important; }';
        document.head.appendChild(style);
      });
    });
  }
  await open(page, `/e/${CODE}?v=room`);
  await canvas(page).waitFor({ state: 'visible' });
  await page.waitForTimeout(6000);

  const fetched = MATERIALS.filter((name) => loaded.get(name) === 200);
  record(
    `textures (${label})`,
    fetched.length === MATERIALS.length,
    `${fetched.length}/${MATERIALS.length} materials 200: ${MATERIALS.map((m) => `${m}=${loaded.get(m) ?? 'none'}`).join(' ')}`
  );

  const buttons = page.locator('nav.gallery-walk button[data-direction]');
  const count = await buttons.count();
  let visible = 0;
  const size = page.viewportSize()!;
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const box = await button.boundingBox();
    if (
      (await button.isVisible()) &&
      box &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= size.width &&
      box.y + box.height <= size.height
    ) {
      visible += 1;
    }
  }
  record(
    `walk (${label})`,
    count === 4 && visible === 4,
    `${visible}/${count} walk buttons visible inside the viewport`
  );
  await context.close();
};

/**
 * Pixels that change when the frame changes, with the camera left where the
 * room opens. Frames are drawn in WebGL, so the DOM cannot say whether one is
 * there; the difference between two renders of the same view can.
 */
const frames = async (browser: Browser) => {
  const shotOf = async (frame: string | null) => {
    const context = await browser.newContext(DESKTOP);
    const page = await context.newPage();
    await open(page, `/e/${CODE}?v=room${frame ? `&frame=${frame}` : ''}`);
    await canvas(page).waitFor({ state: 'visible' });
    await page.waitForTimeout(8000);
    const png = await canvas(page).screenshot();
    await context.close();
    return png;
  };
  const plain = await shotOf(null);
  const oak = await shotOf(SABOTAGE ? null : 'oak');
  const page = await (await browser.newContext()).newPage();
  // A string, not a function: tsx rewrites named functions with a helper
  // that does not exist inside the page.
  const changed = (await page.evaluate(`(async ([a, b]) => {
    const decode = async (base64) => {
      const bitmap = await createImageBitmap(
        await (await fetch('data:image/png;base64,' + base64)).blob()
      );
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = surface.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const [left, right] = await Promise.all([decode(a), decode(b)]);
    let differing = 0;
    for (let index = 0; index < left.length; index += 4) {
      const delta =
        Math.abs(left[index] - right[index]) +
        Math.abs(left[index + 1] - right[index + 1]) +
        Math.abs(left[index + 2] - right[index + 2]);
      if (delta > 48) differing += 1;
    }
    return { differing, total: left.length / 4 };
  })(${JSON.stringify([plain.toString('base64'), oak.toString('base64')])})`)) as {
    differing: number;
    total: number;
  };
  // A frame ring round six works at the opening view is thousands of pixels;
  // render noise between two identical loads is not.
  record(
    'frames',
    changed.differing > 2000,
    `${changed.differing} of ${changed.total} pixels differ between frame=none and frame=${SABOTAGE ? 'none' : 'oak'}`
  );
};

const label = async (browser: Browser) => {
  const text = `Merged-room check ${Date.now()}: the draft stays on this device.`;
  const context: BrowserContext = await browser.newContext(DESKTOP);
  const page = await context.newPage();
  await open(page, `/e/${CODE}`);
  const editor = page.locator('.paillette-label-editor textarea').first();
  // The server-rendered button is on screen before React owns it, and a click
  // that lands first does nothing. Click until the editor opens.
  for (
    let attempt = 0;
    attempt < 12 && !(await editor.isVisible());
    attempt += 1
  ) {
    await page
      .getByRole('button', { name: 'Edit labels' })
      .click({ timeout: 60000 });
    await editor.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  }
  await editor.waitFor({ state: 'visible' });
  const before = await editor.inputValue();
  await editor.fill(text);
  await page
    .locator('.paillette-label-editor')
    .first()
    .getByRole('button', { name: 'Save label' })
    .click();
  await page.getByRole('button', { name: 'Done editing' }).click();
  const shownBeforeReload = await page.getByText(text, { exact: true }).count();

  let after: Page;
  let otherContext: BrowserContext | null = null;
  if (SABOTAGE) {
    otherContext = await browser.newContext(DESKTOP);
    after = await otherContext.newPage();
  } else {
    after = page;
  }
  await (SABOTAGE
    ? open(after, `/e/${CODE}`)
    : after.reload({ waitUntil: 'networkidle' }));
  await after.waitForTimeout(2000);
  const shownAfterReload = await after.getByText(text, { exact: true }).count();
  record(
    'label',
    shownBeforeReload > 0 && shownAfterReload > 0,
    `was "${before.slice(0, 40)}…"; edited copy shown before reload=${shownBeforeReload} after reload=${shownAfterReload}`
  );

  // A different browser never sees it: the draft is this device's, not the
  // show's. Sabotaged, the "stranger" is the same browser, which does.
  const stranger = SABOTAGE ? context : await browser.newContext(DESKTOP);
  const strangerPage = await stranger.newPage();
  await open(strangerPage, `/e/${CODE}`);
  await strangerPage.waitForTimeout(2000);
  const leaked = await strangerPage.getByText(text, { exact: true }).count();
  record(
    'label stays local',
    leaked === 0,
    `edited copy shown in a ${SABOTAGE ? 'second tab of the same' : 'fresh'} browser=${leaked}`
  );
  if (!SABOTAGE) await stranger.close();
  await otherContext?.close();
  await context.close();
};

const main = async () => {
  // Sabotaged, the run expects a build that is not the one deployed.
  const expected = SABOTAGE
    ? 'exhibition-view-not-this-build.js'
    : process.env.EXPECT_BUNDLE;
  const bundleBefore = await servedBundle();
  const browser = await chromium.launch({
    // Unset, Playwright uses the build it pins. Set, a browser already on the
    // machine stands in for it rather than downloading another.
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
    args: [
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--ignore-gpu-blocklist',
    ],
  });
  try {
    await flat(browser);
    await room(browser, 'desktop', DESKTOP);
    await room(browser, 'phone', PHONE);
    await frames(browser);
    await label(browser);
  } finally {
    await browser.close();
  }
  const bundleAfter = await servedBundle();
  record(
    'bundle',
    !expected || (bundleBefore === expected && bundleAfter === expected),
    `served before=${bundleBefore} after=${bundleAfter} expected=${expected ?? 'unset'}`
  );
  const failed = results.filter((result) => !result.ok).length;
  console.log(
    JSON.stringify(
      {
        origin: ORIGIN,
        code: CODE,
        sabotage: SABOTAGE,
        passed: results.length - failed,
        failed,
        results,
      },
      null,
      2
    )
  );
  process.exitCode = failed ? 1 : 0;
};

void main();
