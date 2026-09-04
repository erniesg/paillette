/**
 * The deal beat when things go wrong.
 *
 * §9's second clause — Enter on an empty bar — is the beat the submission is
 * built on, and everything measured about it so far was measured on a fast,
 * working network with flags already on the board. This drives the ways it can
 * actually fail on a filmed take:
 *
 *   slow      the exemplars route held open for eight seconds
 *   dead      the exemplars route refused outright
 *   empty     Enter with nothing flagged at all
 *   spent     Enter with every work on the board rejected
 *   phantom   an agent flagging ids the page has never loaded
 *   phantom2  a two-up asked for on an id that does not resolve
 *
 * The bar for each is the same and it is not "no crash": **a person must be
 * able to tell what happened without being told twice.** A slow deal has to
 * look like a wait, a dead one has to say so once, and neither may leave the
 * board changed underneath the human's hands.
 *
 * The two `phantom` cases are the only place in any of this lane's harnesses
 * where `window.__paillette_webmcp.call` drives rather than reads — because
 * they are testing what the tool does with bad input, which is not behaviour
 * being demonstrated and cannot be reached by typing.
 *
 *   node scripts/demo/harden.mjs <base-url> <out-dir>
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/harden';
const QUERY = process.env.HARDEN_QUERY ?? 'storms at sea';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => process.stdout.write(`${line}\n`);

const EXEMPLARS = '**/api/public-search/**/exemplars';

const readBoard = (page) =>
  page.evaluate(() => {
    const label = document.querySelector('.paillette-wall-label');
    const armed = document.querySelector('.lt-enter-armed');
    return {
      ids: [...document.querySelectorAll('[data-artwork-id]')].map((el) =>
        el.getAttribute('data-artwork-id')
      ),
      note: label?.textContent?.trim() ?? null,
      dealError:
        document.querySelector('[data-deal-error]')?.textContent?.trim() ?? null,
      dealErrorCode:
        document.querySelector('[data-deal-error]')?.getAttribute('data-deal-error') ??
        null,
      armedPresent: Boolean(armed),
      // The mark that says a deal is out. A word would be the thing §5b
      // forbids, so what is asserted is the state on the mark.
      armedDealing: armed?.getAttribute('data-dealing') ?? null,
      liveRegion:
        document.querySelector('p.sr-only[role="status"]')?.textContent?.trim() ??
        null,
    };
  });

const press = async (page, id, key) => {
  await page.evaluate(() => document.activeElement?.blur?.());
  const card = page.locator(`[data-artwork-id="${id}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.keyboard.press(key);
  await sleep(250);
};

/**
 * `debug` is opt-in, and only two cases want it.
 *
 * The four keyboard cases are pure typing and keying, so loading the debug
 * harness for them adds nothing but a mount to wait on — and waiting on it is
 * a flake: this timed out once on a run where the same case had passed
 * minutes earlier. Only the two that have to call a tool with bad input load
 * it, because only they have no other way in.
 */
const openBoard = async (browser, { flags = 'x x p', debug = false } = {}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error.message)));
  await page.goto(
    `${BASE}/nga/search?q=${encodeURIComponent(QUERY)}${debug ? '&webmcp-debug' : ''}`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 }
  );
  await page.waitForFunction(
    () => document.querySelectorAll('[data-artwork-id]').length > 0,
    { timeout: 60_000 }
  );
  if (debug) {
    await page.waitForFunction(
      async () => ((await window.__paillette_webmcp?.tools?.()) ?? []).length > 0,
      { timeout: 60_000 }
    );
  }
  await sleep(1200);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')]
      .map((el) => el.getAttribute('data-artwork-id'))
      .slice(0, 12)
  );
  const keys = flags.split(' ').filter(Boolean);
  for (const [index, key] of keys.entries()) await press(page, ids[index], key);
  return { context, page, ids, errors };
};

const cases = {
  /** Eight seconds of nothing. The one the film will actually hit. */
  slow: async (browser) => {
    const { context, page, errors } = await openBoard(browser);
    await page.route(EXEMPLARS, async (route) => {
      await sleep(8000);
      await route.continue();
    });
    const before = await readBoard(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Enter');
    await sleep(1500);
    const during = await readBoard(page);
    await page.screenshot({ path: path.join(OUT, 'slow-during.png') });
    await page
      .waitForFunction(
        (previous) =>
          [...document.querySelectorAll('[data-artwork-id]')]
            .map((el) => el.getAttribute('data-artwork-id'))
            .join(',') !== previous,
        before.ids.join(','),
        { timeout: 40_000 }
      )
      .catch(() => {});
    await sleep(1500);
    const after = await readBoard(page);
    await context.close();
    return {
      pass:
        during.armedDealing === 'true' &&
        during.ids.join(',') === before.ids.join(',') &&
        after.ids.join(',') !== before.ids.join(',') &&
        after.armedDealing === 'false' &&
        errors.length === 0,
      inFlightMark: during.armedDealing,
      boardHeldStill: during.ids.join(',') === before.ids.join(','),
      liveRegionDuring: during.liveRegion,
      dealtInTheEnd: after.ids.join(',') !== before.ids.join(','),
      markCleared: after.armedDealing,
      errors,
    };
  },

  /** The route refuses. Enter must not be a dead key. */
  dead: async (browser) => {
    const { context, page, errors } = await openBoard(browser);
    await page.route(EXEMPLARS, (route) => route.abort('failed'));
    const before = await readBoard(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Enter');
    await sleep(6000);
    const after = await readBoard(page);
    await page.screenshot({ path: path.join(OUT, 'dead.png') });
    await context.close();
    return {
      pass:
        Boolean(after.dealError) &&
        after.ids.join(',') === before.ids.join(',') &&
        after.armedDealing === 'false' &&
        errors.length === 0,
      dealError: after.dealError,
      dealErrorCode: after.dealErrorCode,
      boardUnchanged: after.ids.join(',') === before.ids.join(','),
      markCleared: after.armedDealing,
      errors,
    };
  },

  /**
   * Enter with nothing flagged at all, from inside the bar.
   *
   * Deliberately *from the bar*. With no flags the bare-board binding does not
   * claim Enter at all — that is by design, so the key keeps whatever meaning
   * it had before anyone has marked anything — and pressing it into the void
   * measures the design rather than the failure path. Inside the bar the beat
   * always runs, so this is the state where it has to answer for itself.
   */
  empty: async (browser) => {
    const { context, page, errors } = await openBoard(browser, { flags: '' });
    const before = await readBoard(page);
    const bar = page.locator('input[aria-label="Ask the agent"]');
    await bar.click();
    await bar.press('Enter');
    await sleep(9000);
    const after = await readBoard(page);
    await page.screenshot({ path: path.join(OUT, 'empty.png') });
    // And the other half of the same question: with nothing flagged, a bare
    // Enter on the page must leave the key alone rather than half-fire.
    const bareClaimed = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    await context.close();
    // Either answer is defensible; silence is not. Deal and name the board, or
    // say once that there is nothing to deal from.
    const dealt = after.ids.join(',') !== before.ids.join(',');
    return {
      pass:
        (dealt ? Boolean(after.note) : Boolean(after.dealError)) &&
        errors.length === 0,
      dealt,
      note: after.note,
      dealError: after.dealError,
      bareEnterLeftAlone: bareClaimed === false,
      errors,
    };
  },

  /** Every work on the board thrown out: nothing left to deal from. */
  spent: async (browser) => {
    const { context, page, ids, errors } = await openBoard(browser, { flags: '' });
    for (const id of ids) await press(page, id, 'x');
    const before = await readBoard(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Enter');
    await sleep(8000);
    const after = await readBoard(page);
    await page.screenshot({ path: path.join(OUT, 'spent.png') });
    await context.close();
    const dealt = after.ids.join(',') !== before.ids.join(',');
    return {
      pass: (dealt ? Boolean(after.note) : Boolean(after.dealError)) && errors.length === 0,
      rejectedEverything: ids.length,
      dealt,
      dealError: after.dealError,
      dealErrorCode: after.dealErrorCode,
      note: after.note,
      errors,
    };
  },

  /** An agent flagging ids this page has never loaded. */
  phantom: async (browser) => {
    const { context, page, errors } = await openBoard(browser, { debug: true });
    const result = await page.evaluate(async () => {
      const raw = await window.__paillette_webmcp.call('flag_artworks', {
        flags: [
          { artworkId: 'open-access-art:nga:000000000', flag: 'reject', reason: 'nope' },
          { artworkId: 'not-an-id-at-all', flag: 'pick', reason: 'nope' },
        ],
      });
      const parsed = Array.isArray(raw?.content)
        ? JSON.parse(raw.content[0].text)
        : raw;
      return {
        parsed,
        marksOnScreen: [...document.querySelectorAll('[data-artwork-id]')].filter(
          (el) => el.getAttribute('data-flag-by') === 'agent'
        ).length,
      };
    });
    await context.close();
    return {
      // The refusal is the error envelope, which is what the tool returns and
      // what the model reads. An earlier version of this asserted a top-level
      // `success: false` that the envelope does not carry, and called a
      // correctly-behaving tool a failure.
      pass:
        Boolean(result.parsed?.error?.code) &&
        result.marksOnScreen === 0 &&
        errors.length === 0,
      code: result.parsed?.error?.code ?? null,
      message: result.parsed?.error?.message ?? null,
      phantomMarksLeftOnBoard: result.marksOnScreen,
      errors,
    };
  },

  /** A two-up asked for on an id that does not resolve. */
  phantom2: async (browser) => {
    const { context, page, ids, errors } = await openBoard(browser, { debug: true });
    const result = await page.evaluate(async (realId) => {
      const raw = await window.__paillette_webmcp.call('compare_artworks', {
        artworkIds: [realId, 'not-an-id-at-all'],
        question: 'Which holds the room?',
      });
      const parsed = Array.isArray(raw?.content)
        ? JSON.parse(raw.content[0].text)
        : raw;
      return {
        parsed,
        roomOpen: Boolean(document.querySelector('[data-compare-room]')),
      };
    }, ids[0]);
    await page.screenshot({ path: path.join(OUT, 'phantom-compare.png') });
    await context.close();
    return {
      // A room with one empty wall is worse than no room. Either it refuses
      // and stays shut, or it opens with both works actually in it.
      pass:
        (Boolean(result.parsed?.error?.code) && !result.roomOpen) ||
        (!result.parsed?.error && result.roomOpen),
      refused: Boolean(result.parsed?.error?.code),
      code: result.parsed?.error?.code ?? null,
      roomOpen: result.roomOpen,
      errors,
    };
  },
};

const main = async () => {
  const browser = await chromium.launch();
  const results = {};
  for (const [name, run] of Object.entries(cases)) {
    try {
      results[name] = await run(browser);
    } catch (error) {
      results[name] = { pass: false, threw: String(error).slice(0, 300) };
    }
    log(
      `${name.padEnd(9)} ${results[name].pass ? 'pass' : 'FAIL'}  ${JSON.stringify(
        results[name]
      ).slice(0, 220)}`
    );
  }
  await browser.close();
  await writeFile(
    path.join(OUT, 'harden.json'),
    `${JSON.stringify(results, null, 2)}\n`
  );
  if (Object.values(results).some((result) => !result.pass)) process.exitCode = 1;
};

await main();
