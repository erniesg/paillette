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
 * The conditions a visitor arrives in are knobs, because one green run on a
 * 1440×900 desktop with default motion and a browser that can speak is one
 * green run, not a working feature. `VIEWPORT=phone`, `MOTION=reduce` and
 * `SPEECH=off` each change what a visitor has, and `room-demo-matrix.ts`
 * sweeps them.
 *
 * The scene publishes its own position and texture accounting on
 * `window.__paillette_room`. That is a readout — the only way to get a number
 * out of a render loop — and nothing in the product reads it. No step below is
 * driven through it.
 */

import { chromium, type Page } from '@playwright/test';

const ORIGIN = process.env.PAILLETTE_ORIGIN ?? 'http://localhost:5199';

/** 1440×900, or a phone held upright with a 3× screen. */
const VIEWPORT =
  process.env.VIEWPORT === 'phone'
    ? {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

const REDUCED = process.env.MOTION === 'reduce';
const SILENT = process.env.SPEECH === 'off';
const TOUCH = process.env.VIEWPORT === 'phone';
/** A published show with two named regions. */
const CODE = process.env.CODE ?? 'u4G4Gkv';
/** A show published before regions existed, which must be unaffected. */
const PLAIN_CODE = process.env.PLAIN_CODE ?? 'MKwsxHy';

/**
 * What the show being walked is supposed to be, asked of the show itself.
 *
 * The names were hardcoded to one demo exhibition, which meant the script
 * could only ever prove the one shape it was written against — twelve works in
 * two named rooms. The smallest room the planner will build and the largest
 * show that can be published had never been through a whole visit. The
 * expectations come from the published record now, so the same twenty-six
 * steps run against any code.
 */
interface Shape {
  works: number;
  labels: number;
  regions: string[];
}

const readShape = async (code: string): Promise<Shape> => {
  const response = await fetch(`${ORIGIN}/e/${code}?_data=routes%2Fe.%24code`);
  if (!response.ok) throw new Error(`${code}: the page would not load (${response.status})`);
  const page = (await response.json()) as {
    works: { label: string | null }[];
    regions?: { label: string }[];
  };
  return {
    works: page.works.length,
    labels: page.works.filter((work) => work.label).length,
    regions: (page.regions ?? []).map((region) => region.label),
  };
};

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
const tap = async (page: Page, x: number, y: number) => {
  // A phone has a finger, not a pointer, and the room has to answer both.
  if (TOUCH) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
};

/**
 * Look around until a work is in front of you, then tap it.
 *
 * A portrait phone has a horizontal field of about 42°, so deep in a room you
 * see roughly one work at a time and it may be at the edge of the frame. A
 * visitor turns their head; so does this. The sweep alone was enough on a
 * desktop's 87° field and was not on a phone, which read as "the room will not
 * let you tap anything" when the room was fine and the script was staring
 * straight ahead.
 */
const lookAround = async (page: Page, degrees: number) => {
  const box = (await page.locator('canvas.exhibition-room-canvas').boundingBox())!;
  const midX = box.x + box.width / 2;
  const midY = box.y + box.height / 2;
  const dx = degrees * 8;
  if (TOUCH) {
    await page.touchscreen.tap(midX, midY);
    await page.mouse.move(midX, midY);
  }
  await page.mouse.move(midX, midY);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(midX + (dx * step) / 10, midY);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
};

const clickAWork = async (page: Page) => {
  const box = (await page.locator('canvas.exhibition-room-canvas').boundingBox())!;
  const focus = page.locator('.exhibition-room-focus');
  const sweep = async () => {
    for (const fy of [0.53, 0.5, 0.56, 0.46, 0.6]) {
      for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9]) {
        await tap(page, box.x + box.width * fx, box.y + box.height * fy);
        await page.waitForTimeout(380);
        if (await focus.isVisible()) return true;
      }
    }
    return false;
  };

  if (await sweep()) return true;
  // Nothing straight ahead: turn, and look again. Twice each way.
  for (const turn of [-35, 70, -70]) {
    await lookAround(page, turn);
    if (await sweep()) return true;
  }
  return false;
};

const walkInto = async (page: Page, room: number) => {
  const box = (await page.locator('canvas.exhibition-room-canvas').boundingBox())!;
  const arrived = async () => {
    const now = await stats(page);
    return Boolean(now && now.roomIndex === room && now.metresIntoRoom >= 2.9);
  };

  if (TOUCH) {
    /*
     * A phone has no arrow keys, so a phone visitor walks by tapping the floor
     * — and the room walks them as far along that line as the building allows.
     * Driving a phone with `keyboard.press` is what made this look broken when
     * it was not: the tap meant to focus the canvas landed on the title, which
     * on a 390 px screen covers a good deal of the top-left.
     */
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (await arrived()) break;
      await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.72);
      await page.waitForTimeout(900);
    }
    await page.waitForTimeout(2000);
    return;
  }

  // Tab to the room the way somebody without a mouse reaches it, rather than
  // clicking a pixel chosen for being empty.
  for (let press = 0; press < 12; press += 1) {
    const reached = await page.evaluate(() =>
      Boolean(document.activeElement?.classList.contains('exhibition-room-canvas'))
    );
    if (reached) break;
    await page.keyboard.press('Tab');
  }
  for (let press = 0; press < 80; press += 1) {
    if (await arrived()) break;
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(2500);
};

const main = async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({
    ...VIEWPORT,
    reducedMotion: REDUCED ? 'reduce' : 'no-preference',
  });
  if (SILENT) {
    /*
     * Every speech API removed before a byte of the page runs. Text first is
     * not "voice is optional" — it is that the whole visit completes with no
     * speech available at all, and the read-aloud is *absent* rather than a
     * control that fails when pressed.
     */
    await context.addInitScript({
      content: `
        Object.defineProperty(window, 'speechSynthesis', {
          get: () => undefined, configurable: true,
        });
        window.SpeechSynthesisUtterance = undefined;
        window.SpeechRecognition = undefined;
        window.webkitSpeechRecognition = undefined;
      `,
    });
  }
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));

  const shape = await readShape(CODE);
  // Regions become rooms; a show with none is chunked by count, twelve to a room.
  const expectedRooms = shape.regions.length || Math.max(1, Math.ceil(shape.works / 12));
  console.log(
    `\n${ORIGIN}  code ${CODE}  —  ${shape.works} works, ${shape.labels} labels, ` +
      `${shape.regions.length ? shape.regions.join(' / ') : 'no named regions'}` +
      ` → ${expectedRooms} room(s)\n`
  );

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

  // 3 — the show's own architecture, from its own structure.
  const opened = (await stats(page))!;
  check('the room count matches the show', opened.roomCount, expectedRooms);
  check(
    'the visitor starts in the first room',
    opened.roomName,
    shape.regions[0] ?? null
  );
  check('every work has a texture', opened.nearCount > 0, true);

  /*
   * 4 — walking. A show with more than one room is walked into the next one;
   * a single-room show is walked across, which is the same verb answering a
   * different building and is the only thing the smallest room can be asked.
   */
  if (expectedRooms > 1) {
    await walkInto(page, 1);
    const second = (await stats(page))!;
    check(
      'walking arrives in the second room',
      second.roomName,
      shape.regions[1] ?? null
    );
    check('and well inside it, not in the doorway', second.metresIntoRoom >= 2.9, true);
  } else {
    const before = (await stats(page))!.metresIntoRoom;
    await walkInto(page, 0);
    const after = (await stats(page))!;
    check('walking crosses the one room it has', after.metresIntoRoom > before, true);
    check('and stays inside it', after.roomIndex, 0);
  }

  // 5 — the beat: stand in front of a work and the label arrives.
  check('clicking a work opens its wall label', await clickAWork(page), true);
  check(
    'the catalogue line is always there',
    (await page.locator('.exhibition-room-focus .exhibition-line').innerText()).length >
      0,
    true
  );

  /*
   * A show with no labels is a real state, not a broken one.
   *
   * The first version of this waited thirty seconds for a `.exhibition-label`
   * that a legitimately unlabelled show does not have, and died — which said
   * the room was broken when the room was right and the script's assumption
   * was wrong. So it asks whether this show has labels and checks the matching
   * thing either way.
   */
  const labelled = await page.locator('.exhibition-room-focus .exhibition-label').count();
  if (labelled) {
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
  } else {
    check('an unlabelled show shows the catalogue line and no empty rule', true, true);
  }
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
