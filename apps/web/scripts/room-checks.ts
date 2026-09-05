/**
 * The claims in `docs/night/room-report.md`, re-runnable.
 *
 * Everything here is checked the way a visitor would meet it: a URL is opened,
 * a word is clicked, the floor is clicked, keys are pressed, a picture is
 * tapped with a finger. Nothing calls into the scene to make something happen.
 * The scene does publish its own position and texture accounting onto
 * `window.__paillette_room`, because there is no other way to read a number
 * out of a render loop — but that is a readout, not a control surface, and
 * nothing in the product reads it.
 *
 *   pnpm --filter web exec tsx scripts/room-checks.ts
 *
 * `PAILLETTE_ORIGIN` points it at staging instead of a dev server.
 * `ROOM_LINKS` is the JSON from `room-demo-links.ts`.
 */

import { chromium, type Browser, type Page } from '@playwright/test';

const ORIGIN = process.env.PAILLETTE_ORIGIN ?? 'http://localhost:5199';
const ARGS = ['--enable-unsafe-swiftshader'];

interface Stats {
  fps: number;
  textureBytes: number;
  nearCount: number;
  metresIntoRoom: number;
  roomIndex: number;
}

const stats = (page: Page) =>
  page.evaluate(
    () => (window as Window & { __paillette_room?: Stats }).__paillette_room ?? null
  );

const openRoom = async (page: Page, url: string, settleMs = 7000) => {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('canvas.exhibition-room-canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(settleMs);
};

const say = (label: string, value: unknown) =>
  console.log(`  ${label.padEnd(42)} ${String(value)}`);

/** What is actually drawing. Every frame rate below has to be read against it. */
const renderer = async (browser: Browser) => {
  const page = await browser.newPage();
  await page.goto('about:blank');
  const name = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'none';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
  });
  await page.close();
  return name;
};

const main = async () => {
  const links = JSON.parse(process.env.ROOM_LINKS ?? '{}') as Record<string, string>;
  const six = `${ORIGIN}${links.six ?? '/e/MKwsxHy'}`;
  const room = `${six}${six.includes('?') ? '&' : '?'}v=room`;

  const browser = await chromium.launch({ args: ARGS });

  console.log('\nrenderer');
  say('what is drawing', await renderer(browser));

  console.log('\ndegrades honestly');
  {
    const noGl = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // Overridden at the exact API the capability check calls, so what this
    // proves is our branch rather than the behaviour of a real GPU-less device.
    /*
     * Passed as source text, not as a function, and that is the whole reason
     * these checks were reporting passes they had not earned.
     *
     * `addInitScript(fn)` serialises `fn.toString()` — but this file is
     * TypeScript, so what `toString()` returns is *esbuild's* output, which
     * can reference helpers (`__name`, and friends) that do not exist in the
     * page. The script then throws on injection, silently, and the run
     * measures an ordinary browser while claiming to measure a crippled one.
     * The `precondition:` lines below exist so that can never pass unnoticed
     * again.
     */
    await noGl.addInitScript({
      content: `
        const real = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          if (String(type).indexOf('webgl') === 0) return null;
          return real.apply(this, [type].concat(rest));
        };
      `,
    });
    const page = await noGl.newPage();
    await page.goto(room, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    // The precondition, printed. A check whose setup silently failed to apply
    // is a check that asserts nothing, and `deviceMemory` below did exactly
    // that once — the override did not take and the run read as a pass.
    say(
      'precondition: a WebGL context can be made',
      await page.evaluate(() =>
        Boolean(document.createElement('canvas').getContext('webgl2'))
      )
    );
    say('no WebGL, ?v=room → flat page', await page.locator('main.exhibition-page').isVisible());
    say('no WebGL → canvases on the page', await page.locator('canvas.exhibition-room-canvas').count());
    say('no WebGL → ROOM offered', await page.getByRole('link', { name: 'Room', exact: true }).count());
    await noGl.close();

    const low = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await low.addInitScript({
      content: `
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => 1,
          configurable: true,
        });
      `,
    });
    const lowPage = await low.newPage();
    await lowPage.goto(six, { waitUntil: 'networkidle' });
    await lowPage.waitForTimeout(2000);
    say(
      'precondition: navigator.deviceMemory reads',
      await lowPage.evaluate(
        () => (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      )
    );
    say('deviceMemory 1 GB → ROOM offered', await lowPage.getByRole('link', { name: 'Room', exact: true }).count());
    await low.close();

    const noJs = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      javaScriptEnabled: false,
    });
    const noJsPage = await noJs.newPage();
    await noJsPage.goto(six, { waitUntil: 'domcontentloaded' });
    say('no JavaScript → works rendered', await noJsPage.locator('.exhibition-work').count());
    say('no JavaScript → ROOM offered', await noJsPage.getByRole('link', { name: 'Room', exact: true }).count());
    await noJs.close();
  }

  console.log('\nwalking');
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await openRoom(page, room);
    const box = (await page.locator('canvas.exhibition-room-canvas').boundingBox())!;
    // Every height on the floor, including the ones that project past the far
    // wall — all of them have to move the visitor, not only the near ones.
    for (const fraction of [0.62, 0.7, 0.79, 0.88, 0.95]) {
      const before = (await stats(page))!.metresIntoRoom;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * fraction);
      await page.waitForTimeout(1100);
      const after = (await stats(page))!.metresIntoRoom;
      say(`click floor at ${fraction} of the height`, `${before.toFixed(2)}m → ${after.toFixed(2)}m`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.1);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(700);
    }
    await page.close();
  }

  console.log('\nprefers-reduced-motion');
  for (const motion of ['no-preference', 'reduce'] as const) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: motion,
    });
    const page = await context.newPage();
    await openRoom(page, room);
    const box = (await page.locator('canvas.exhibition-room-canvas').boundingBox())!;
    const before = (await stats(page))!.metresIntoRoom;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.79);

    /*
     * The question is not "how long does it take" — the position is published
     * on the level-of-detail tick, so timing it finely would be measuring the
     * sampler. It is the binary one: was the very first reading after the
     * click already the final position? Under `reduce` it must be, because the
     * requirement is no eased camera movement at all rather than a slower one.
     */
    await page.waitForTimeout(240);
    const first = (await stats(page))!.metresIntoRoom;
    await page.waitForTimeout(1600);
    const settled = (await stats(page))!.metresIntoRoom;
    say(
      `${motion}: moved`,
      `${before.toFixed(2)}m → ${settled.toFixed(2)}m, arrival ` +
        (Math.abs(first - settled) < 0.02 ? 'INSTANT' : 'eased over several frames')
    );
    await context.close();
  }

  console.log('\ntouch and keyboard');
  {
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await phone.newPage();
    await openRoom(page, room, 8000);
    const box = (await page.locator('canvas.exhibition-room-canvas').boundingBox())!;
    let opened = false;
    for (const fraction of [0.25, 0.75, 0.5, 0.35, 0.65]) {
      await page.touchscreen.tap(box.x + box.width * fraction, box.y + box.height * 0.53);
      await page.waitForTimeout(700);
      if (await page.locator('.exhibition-room-focus').isVisible()) {
        opened = true;
        break;
      }
    }
    say('tapping a work opens its wall label', opened);
    await phone.close();

    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await openRoom(desktop, room);
    let reached = false;
    for (let press = 0; press < 12 && !reached; press += 1) {
      await desktop.keyboard.press('Tab');
      reached = await desktop.evaluate(() =>
        Boolean(document.activeElement?.classList.contains('exhibition-room-canvas'))
      );
    }
    const before = (await stats(desktop))!.metresIntoRoom;
    for (let step = 0; step < 3; step += 1) {
      await desktop.keyboard.press('ArrowUp');
      await desktop.waitForTimeout(320);
    }
    const after = (await stats(desktop))!.metresIntoRoom;
    say('Tab reaches the room', reached);
    say('three arrow presses walk', `${(after - before).toFixed(2)}m`);
    await desktop.close();
  }

  console.log('\ntexture budget under the most pressure it sees');
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await openRoom(page, `${ORIGIN}${links.thirty}&v=room`, 11000);
    let peak = 0;
    await page.locator('canvas.exhibition-room-canvas').click({ position: { x: 40, y: 40 } });
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(120);
      const now = await stats(page);
      if (now) peak = Math.max(peak, now.textureBytes);
    }
    const end = (await stats(page))!;
    say('peak texture bytes walking 30 works', `${(peak / 1024 / 1024).toFixed(1)} MiB`);
    say('high-resolution textures held', end.nearCount);
    say('frame rate at the end of the walk', end.fps);
    await page.close();
  }

  await browser.close();
  console.log('');
};

void main();
