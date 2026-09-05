/**
 * Screenshots of the room, taken the way a visitor meets it.
 *
 * Every shot below is reached by the same actions a person performs: open a
 * URL, click the word ROOM, drag to look, click a picture. Nothing here calls
 * into the scene's own API to put the camera somewhere flattering, and nothing
 * is driven through a debug console — a demonstration through a back door
 * proves the back door works. The one exception is the *readout*: frame rate
 * and texture bytes are published by the scene onto `window.__paillette_room`
 * because there is no other way to get a number out of a render loop, and
 * nothing in the product reads it.
 *
 * `--enable-unsafe-swiftshader` is passed because this runs on a VM with a
 * paravirtual GPU. The renderer string is captured with every measurement so
 * that nobody reads the frame rates as though they came from real hardware.
 *
 * Run with `pnpm --filter web exec tsx scripts/room-shots.ts`.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';

const ORIGIN = process.env.PAILLETTE_ORIGIN ?? 'http://localhost:5199';

/** Far enough past the threshold that the shot is of the room, not its door. */
const WELL_INSIDE_M = 2.5;
const OUT = process.env.ROOM_SHOTS_OUT ?? '../../docs/night/shots/room';

interface Stats {
  fps: number;
  textureBytes: number;
  nearCount: number;
  rendererTextures: number;
  pixelRatio: number;
  roomIndex: number;
  roomCount: number;
  roomName: string | null;
  metresIntoRoom: number;
}

const readStats = (page: Page) =>
  page.evaluate(
    () => (window as Window & { __paillette_room?: Stats }).__paillette_room ?? null
  );

const rendererName = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return 'none';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
  });

/** Click the word, the way somebody choosing the room clicks it. */
const enterRoom = async (page: Page) => {
  await page.getByRole('link', { name: 'Room', exact: true }).click();
  await page.locator('canvas.exhibition-room-canvas').waitFor({ state: 'visible' });
};

/** Let the walls draw and the near textures settle. */
const settle = async (page: Page, ms = 6000) => {
  await page.waitForTimeout(ms);
};

const drag = async (page: Page, dx: number, dy: number) => {
  const canvas = page.locator('canvas.exhibition-room-canvas');
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(x + (dx * step) / 12, y + (dy * step) / 12);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
};

/**
 * Find something on a wall and click it, the way somebody in the room does.
 *
 * A hard-coded pixel is a screenshot that silently stops containing what its
 * name says the moment the layout moves — which has gone wrong on this project
 * twice. So it hunts across the wall until the focused panel appears, and the
 * caller fails loudly if nothing does.
 */
const clickAWork = async (page: Page): Promise<boolean> => {
  const canvas = page.locator('canvas.exhibition-room-canvas');
  const box = (await canvas.boundingBox())!;
  const focus = page.locator('.exhibition-room-focus');
  for (const fy of [0.53, 0.5, 0.56]) {
    for (const fx of [0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.5]) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(500);
      if (await focus.isVisible()) return true;
    }
  }
  return false;
};

/**
 * Step forward until the visitor is actually in the room we mean to photograph.
 *
 * A fixed number of key presses is a guess, and it was the wrong one: fourteen
 * steps of 85 cm walked straight through the second room into the third, so
 * the file called `thirty-second-room` was a picture of the third. The
 * assertion in `shot` caught it, which is the whole argument for the
 * assertion. Walking a few steps *into* the room rather than stopping on the
 * threshold, because standing in a doorway is not a photograph of a room.
 */
const walkInto = async (page: Page, room: number) => {
  // The canvas takes the keyboard when it is clicked, exactly as it does for a
  // visitor. Pressing arrow keys without this sends them to the document and
  // nothing moves — which is what "expected the second room, got the first"
  // turned out to be, rather than a walkability bug.
  await page
    .locator('canvas.exhibition-room-canvas')
    .click({ position: { x: 40, y: 40 } });
  for (let step = 0; step < 80; step += 1) {
    const stats = await readStats(page);
    if (
      stats &&
      stats.roomIndex === room &&
      stats.metresIntoRoom >= WELL_INSIDE_M + 0.4
    ) {
      break;
    }
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(2800);
};

const main = async () => {
  const links = JSON.parse(process.env.ROOM_LINKS ?? '{}') as Record<string, string>;
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    args: [
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
    ],
  });

  const measured: Record<string, unknown> = {};

  /**
   * A shot is saved only once what it claims has been checked.
   *
   * `expectRoom` is the point of this: a file called `thirty-third-room` that
   * is in fact a photograph of the first room is worse than no file, and it
   * has happened on this project twice. The scene publishes which room the
   * camera is standing in; the assertion throws rather than writing a
   * misnamed picture.
   */
  const shot = async (
    page: Page,
    name: string,
    expect?: { room: number; wellInside?: boolean }
  ) => {
    const stats = await readStats(page);
    if (expect) {
      const expectRoom = expect.room;
      if (!stats) throw new Error(`${name}: the scene never reported a position`);
      if (stats.roomIndex !== expectRoom) {
        throw new Error(
          `${name}: expected room ${expectRoom}, the visitor is in ${stats.roomIndex}`
        );
      }
      if (expect.wellInside && stats.metresIntoRoom < WELL_INSIDE_M) {
        throw new Error(
          `${name}: only ${stats.metresIntoRoom.toFixed(2)} m into room ` +
            `${expectRoom} — that is the doorway, not the room`
        );
      }
    }
    await page.screenshot({ path: `${OUT}/${name}.png` });
    if (stats) measured[name] = stats;
  };

  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await desktop.newPage();
  measured.renderer = await (async () => {
    await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    return rendererName(page);
  })();

  // ---- the flat page, which is what a bare link opens -----------------------
  await page.goto(`${ORIGIN}${links.six}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/page-six.png`, fullPage: false });

  // ---- six works ------------------------------------------------------------
  await enterRoom(page);
  await settle(page);
  await shot(page, 'six', { room: 0 });

  // Turn around and read the wall text, which is where the statement is.
  await drag(page, 900, 0);
  await drag(page, 900, 0);
  await page.waitForTimeout(1200);
  await shot(page, 'six-wall-text');

  // Walk up to a work and stand in front of it.
  await page.goto(`${ORIGIN}${links.six}&v=room`, { waitUntil: 'networkidle' });
  await page.locator('canvas.exhibition-room-canvas').waitFor({ state: 'visible' });
  await settle(page);
  if (!(await clickAWork(page))) throw new Error('nothing on the wall was clickable');
  await page.waitForTimeout(2500);
  await shot(page, 'six-focused');

  // ---- one work: the smallest room the planner will build -------------------
  await page.goto(`${ORIGIN}${links.one}&v=room`, { waitUntil: 'networkidle' });
  await page.locator('canvas.exhibition-room-canvas').waitFor({ state: 'visible' });
  await settle(page);
  await shot(page, 'one');

  // ---- thirty works ---------------------------------------------------------
  await page.goto(`${ORIGIN}${links.thirty}&v=room`, { waitUntil: 'networkidle' });
  await page.locator('canvas.exhibition-room-canvas').waitFor({ state: 'visible' });
  await settle(page, 10000);
  await shot(page, 'thirty', { room: 0 });

  // Walk the enfilade, on the keyboard, one step at a time.
  await walkInto(page, 1);
  await shot(page, 'thirty-second-room', { room: 1, wellInside: true });
  await walkInto(page, 2);
  await shot(page, 'thirty-third-room', { room: 2, wellInside: true });

  // The budget under the most pressure it ever sees: stand in a room and look.
  measured.thirtyAfterWalk = await readStats(page);

  // ---- regions, which are rooms ---------------------------------------------
  await page.goto(`${ORIGIN}${links.grouped}&v=room`, { waitUntil: 'networkidle' });
  await page.locator('canvas.exhibition-room-canvas').waitFor({ state: 'visible' });
  await settle(page);
  const named = await readStats(page);
  if (named?.roomName !== 'The Working Harbor') {
    throw new Error(`regions: expected to open in the first named room, got ${named?.roomName}`);
  }
  await shot(page, 'regions-first', { room: 0 });
  await walkInto(page, 1);
  const second = await readStats(page);
  if (second?.roomName !== 'The Empty Shore') {
    throw new Error(`regions: expected the second named room, got ${second?.roomName}`);
  }
  await shot(page, 'regions-second', { room: 1, wellInside: true });

  /*
   * ---- the same thing, over a published short code -------------------------
   *
   * The self-contained link above carries its regions in the URL. This is the
   * link people actually share, and until recently it flattened a grouped show
   * into one enfilade. `CODE` is a show published through the ordinary
   * endpoint with two named regions.
   */
  const code = process.env.CODE;
  if (code) {
    await page.goto(`${ORIGIN}/e/${code}?v=room`, { waitUntil: 'networkidle' });
    await page.locator('canvas.exhibition-room-canvas').waitFor({ state: 'visible' });
    await settle(page);
    const opened = await readStats(page);
    if (opened?.roomName !== 'The Working Harbor') {
      throw new Error(`short code: expected the first named room, got ${opened?.roomName}`);
    }
    await shot(page, 'shortcode-regions-first', { room: 0 });
    await walkInto(page, 1);
    const next = await readStats(page);
    if (next?.roomName !== 'The Empty Shore') {
      throw new Error(`short code: expected the second named room, got ${next?.roomName}`);
    }
    await shot(page, 'shortcode-regions-second', { room: 1, wellInside: true });
  }

  // ---- the empty case: the room with nothing hung in it ---------------------
  const blind = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const blindPage = await blind.newPage();
  // Not a contrived state: this is exactly what a visitor sees when the
  // institution's image server is unreachable.
  await blindPage.route('**://api.nga.gov/**', (route) => route.abort());
  await blindPage.goto(`${ORIGIN}${links.six}&v=room`, { waitUntil: 'domcontentloaded' });
  await blindPage.locator('canvas.exhibition-room-canvas').waitFor({ state: 'visible' });
  await settle(blindPage);
  await blindPage.screenshot({ path: `${OUT}/empty.png` });
  await blind.close();

  // ---- a phone -------------------------------------------------------------
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const phonePage = await phone.newPage();
  await phonePage.goto(`${ORIGIN}${links.six}`, { waitUntil: 'networkidle' });
  await phonePage.screenshot({ path: `${OUT}/phone-page.png` });
  await phonePage.getByRole('link', { name: 'Room', exact: true }).click();
  await phonePage.locator('canvas.exhibition-room-canvas').waitFor({ state: 'visible' });
  await settle(phonePage);
  await phonePage.screenshot({ path: `${OUT}/phone-six.png` });
  measured.phone = await readStats(phonePage);
  await phone.close();

  await browser.close();
  await writeFile(`${OUT}/measurements.json`, `${JSON.stringify(measured, null, 2)}\n`);
  console.log(JSON.stringify(measured, null, 2));
};

void main();
