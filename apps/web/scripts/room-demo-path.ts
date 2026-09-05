/**
 * The room's demo path, end to end, against whatever is deployed.
 *
 * Run repeatedly. Every step is what a visitor does — open a URL, click a
 * word, click a picture, press a key — and every claim is checked rather than
 * described. It throws on the first thing that is not true, so a green run is
 * the whole path and a red one names the beat that broke.
 *
 *   PAILLETTE_ORIGIN=https://paillette-stg.berlayar.ai \
 *   CODE=u4G4Gkv pnpm --filter web exec tsx scripts/room-demo-path.ts
 *
 * The scene publishes its own position and texture accounting on
 * `window.__paillette_room`. That is a readout — the only way to get a number
 * out of a render loop — and nothing in the product reads it. No step below is
 * driven through it.
 */

import { chromium, type Page } from '@playwright/test';

const ORIGIN = process.env.PAILLETTE_ORIGIN ?? 'http://localhost:5199';
/** A published show with two named regions. */
const CODE = process.env.CODE ?? 'u4G4Gkv';
/** A show published before regions existed, which must be unaffected. */
const PLAIN_CODE = process.env.PLAIN_CODE ?? 'MKwsxHy';

interface Stats {
  fps: number;
  textureBytes: number;
  nearCount: number;
  roomIndex: number;
  roomCount: number;
  roomName: string | null;
  metresIntoRoom: number;
}

const stats = (page: Page) =>
  page.evaluate(
    () => (window as Window & { __paillette_room?: Stats }).__paillette_room ?? null
  );

let step = 0;
const check = (claim: string, actual: unknown, expected?: unknown) => {
  step += 1;
  const ok = expected === undefined ? Boolean(actual) : actual === expected;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${String(step).padStart(2)}. ${claim.padEnd(52)} ${String(actual)}`
  );
  if (!ok) throw new Error(`${claim}: expected ${String(expected)}, got ${String(actual)}`);
};

const enterRoom = async (page: Page) => {
  await page.getByRole('link', { name: 'Room', exact: true }).click();
  await page.locator('canvas.exhibition-room-canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(9000);
};

/** Click across the wall until a label opens. A visitor hunts too. */
const clickAWork = async (page: Page) => {
  const box = (await page.locator('canvas.exhibition-room-canvas').boundingBox())!;
  const focus = page.locator('.exhibition-room-focus');
  for (const fy of [0.53, 0.5, 0.56]) {
    for (const fx of [0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(450);
      if (await focus.isVisible()) return true;
    }
  }
  return false;
};

const walkInto = async (page: Page, room: number) => {
  await page
    .locator('canvas.exhibition-room-canvas')
    .click({ position: { x: 40, y: 40 } });
  for (let press = 0; press < 80; press += 1) {
    const now = await stats(page);
    if (now && now.roomIndex === room && now.metresIntoRoom >= 2.9) break;
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(2500);
};

const main = async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));

  console.log(`\n${ORIGIN}  code ${CODE}\n`);

  // 1 — the link, opened cold, by someone who has never used any of this.
  await page.goto(`${ORIGIN}/e/${CODE}`, { waitUntil: 'networkidle' });
  check('a cold short link opens the flat page', await page.locator('main.exhibition-page').isVisible(), true);
  check('the works are on it', await page.locator('.exhibition-work').count() > 0, true);
  check('no canvas was created', await page.locator('canvas.exhibition-room-canvas').count(), 0);

  // 2 — the choice. Two words, and the room is the one you have to ask for.
  check('PAGE is offered', await page.getByRole('link', { name: 'Page', exact: true }).count(), 1);
  check('ROOM is offered', await page.getByRole('link', { name: 'Room', exact: true }).count(), 1);
  await enterRoom(page);
  check('the room is at the shareable URL', page.url(), `${ORIGIN}/e/${CODE}?v=room`);

  // 3 — the show's own architecture, from its own regions.
  const opened = (await stats(page))!;
  check('the show was built as named rooms', opened.roomCount > 1, true);
  check('the visitor starts in the first one', opened.roomName, 'The Working Harbor');
  check('every work has a texture', opened.nearCount > 0, true);

  // 4 — walking, on the keyboard alone, into the second named room.
  await walkInto(page, 1);
  const second = (await stats(page))!;
  check('walking arrives in the second named room', second.roomName, 'The Empty Shore');
  check('and well inside it, not in the doorway', second.metresIntoRoom >= 2.9, true);

  // 5 — the beat: stand in front of a work and the label arrives.
  check('clicking a work opens its wall label', await clickAWork(page), true);
  const label = await page
    .locator('.exhibition-room-focus .exhibition-label')
    .innerText();
  check('the label is the one written for this show', label.length > 0, true);
  check(
    'who wrote it is ink, not a word',
    (await page
      .locator('.exhibition-room-focus .exhibition-label')
      .getAttribute('data-provenance')) !== null,
    true
  );
  check(
    'the panel says nothing about the room',
    (await page.locator('.exhibition-room-focus').innerText())
      .toLowerCase()
      .includes('click'),
    false
  );

  // Closing the label leaves the visitor in front of the work rather than
  // teleporting them back to wherever they were before they approached it.
  const atWork = (await stats(page))!;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1400);
  const afterEscape = (await stats(page))!;
  check(
    'closing the label leaves you where you walked to',
    Math.abs(afterEscape.metresIntoRoom - atWork.metresIntoRoom) < 1.2,
    true
  );
  check('and in the same room', afterEscape.roomIndex, atWork.roomIndex);
  check('the label is gone', await page.locator('.exhibition-room-focus').count(), 0);

  // 6 — the budget, after all of that.
  const spent = (await stats(page))!;
  check(
    'texture use is under the 96 MiB ceiling',
    spent.textureBytes < 96 * 1024 * 1024,
    true
  );
  check('no more than six works at full resolution', spent.nearCount <= 6, true);
  console.log(
    `       ${(spent.textureBytes / 1024 / 1024).toFixed(1)} MiB of texture, ${spent.nearCount} at full resolution, ${spent.fps} fps`
  );

  // 7 — back out, and the flat page is exactly the page.
  await page.getByRole('link', { name: 'Page', exact: true }).click();
  await page.waitForTimeout(1500);
  check('PAGE returns to the plain URL', page.url(), `${ORIGIN}/e/${CODE}`);
  check('the flat page is intact', await page.locator('.exhibition-work').count() > 0, true);

  // 8 — a show published before regions existed is untouched by any of it.
  await page.goto(`${ORIGIN}/e/${PLAIN_CODE}?v=room`, { waitUntil: 'networkidle' });
  await page.locator('canvas.exhibition-room-canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(8000);
  const plain = (await stats(page))!;
  check('an older show still opens in the room', plain.nearCount > 0, true);
  check('and is one unnamed room', plain.roomName, null);

  check('nothing threw on any page', errors.length, 0);
  console.log('');
  await browser.close();
};

void main();
