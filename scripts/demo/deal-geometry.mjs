/**
 * Does the board move when the human presses Enter?
 *
 * §7.1 calls the deal "the single most important visual in the submission" and
 * its entire content is that the picks do not move. The e2e lane measured them
 * moving — 450→192px in one run, 497→192px in another — and traced 56px of it
 * to the note wrapper's `empty:hidden` collapsing when the deterministic redeal
 * wrote no note.
 *
 * No model call anywhere in this script: it presses P and X and Enter, which is
 * the whole point of the beat it measures.
 *
 *   node scripts/demo/deal-geometry.mjs <base-url> <out-dir>
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/deal-geometry';
const QUERY = process.env.CENSUS_QUERY ?? 'storms at sea';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => process.stdout.write(`${line}\n`);

/** Only the board's own cards. The reject tray carries ids too. */
const BOARD_CARD = '[data-testid="deal-board-grid"] [data-artwork-id]';

const readBoard = (page) =>
  page.evaluate((selector) => {
    const label = document.querySelector('.paillette-wall-label');
    const noteBox = document.querySelector('[data-board-note]');
    const cards = [...document.querySelectorAll(selector)];
    const top = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null);
    return {
      note: label?.textContent?.trim() ?? null,
      noteProvenance: label?.getAttribute('data-provenance') ?? null,
      noteHeight: noteBox ? Math.round(noteBox.getBoundingClientRect().height) : 0,
      dealError:
        document.querySelector('[data-deal-error]')?.textContent?.trim() ?? null,
      cards: cards.map((el) => ({
        id: el.getAttribute('data-artwork-id'),
        flag: el.getAttribute('data-flag'),
        by: el.getAttribute('data-flag-by'),
        top: top(el),
      })),
    };
  }, BOARD_CARD);

/** Hover a card and press a culling key, the way a person does. */
const press = async (page, id, key) => {
  await page.evaluate(() => document.activeElement?.blur?.());
  const card = page.locator(`${BOARD_CARD}[data-artwork-id="${id}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.keyboard.press(key);
  await sleep(400);
};

const enter = async (page) => {
  const before = await page.evaluate(
    (selector) =>
      [...document.querySelectorAll(selector)]
        .map((el) => el.getAttribute('data-artwork-id'))
        .join(','),
    BOARD_CARD
  );
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Enter');
  await page
    .waitForFunction(
      ([selector, previous]) =>
        [...document.querySelectorAll(selector)]
          .map((el) => el.getAttribute('data-artwork-id'))
          .join(',') !== previous,
      [BOARD_CARD, before],
      { timeout: 45_000 }
    )
    .catch(() => {});
  await sleep(2000);
};

const main = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const model = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/public-agent/turn')) model.push(request.url());
  });

  const out = { base: BASE, steps: [] };
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const note = (label, detail) => {
    out.steps.push({ label, ...detail });
    log(`${label}: ${JSON.stringify(detail)}`);
  };

  await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-artwork-id]').length > 0,
    { timeout: 60_000 }
  );
  await sleep(1500);

  // Flag from the human's own grid, then deal. This first Enter also folds the
  // search form away, so it is grid-to-board and not the claim under test.
  const gridIds = await page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')]
      .map((el) => el.getAttribute('data-artwork-id'))
      .slice(0, 3)
  );
  for (const [index, id] of gridIds.entries()) {
    await page.evaluate(() => document.activeElement?.blur?.());
    const card = page.locator(`[data-artwork-id="${id}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.keyboard.press(index === 2 ? 'p' : 'x');
    await sleep(300);
  }
  await enter(page);
  const first = await readBoard(page);
  note('first deal (grid → board)', {
    note: first.note,
    provenance: first.noteProvenance,
    noteHeight: first.noteHeight,
    cards: first.cards.length,
    picks: first.cards.filter((card) => card.flag === 'pick').length,
    dealError: first.dealError,
  });
  await shot('01-first-deal');

  /*
   * The claim, measured: one deal becoming the next.
   *
   * Pick two more works off the board, then press Enter, and compare where the
   * picks were with where they are. A pick that holds its slot moves 0px.
   */
  const unflagged = first.cards
    .filter((card) => card.flag !== 'pick' && card.flag !== 'reject')
    .slice(0, 2);
  for (const card of unflagged) await press(page, card.id, 'p');

  const before = await readBoard(page);
  const picksBefore = before.cards.filter((card) => card.flag === 'pick');
  note('before the second Enter', {
    note: before.note,
    noteHeight: before.noteHeight,
    picks: picksBefore.map((card) => ({ id: card.id, top: card.top })),
  });
  await shot('02-before-second');

  await enter(page);
  const after = await readBoard(page);
  const picksAfter = new Map(
    after.cards
      .filter((card) => card.flag === 'pick')
      .map((card) => [card.id, card.top])
  );
  note('after the second Enter', {
    note: after.note,
    provenance: after.noteProvenance,
    noteHeight: after.noteHeight,
    dealError: after.dealError,
    boardChanged:
      before.cards.map((c) => c.id).join(',') !==
      after.cards.map((c) => c.id).join(','),
    movement: picksBefore.map((card) => ({
      id: card.id,
      before: card.top,
      after: picksAfter.get(card.id) ?? null,
      moved:
        picksAfter.has(card.id) && card.top !== null
          ? (picksAfter.get(card.id) ?? 0) - card.top
          : null,
    })),
    modelCalls: model.length,
  });
  await shot('03-after-second');

  /*
   * The negative control: what the missing sentence was worth.
   *
   * Before this fix the deterministic redeal passed no note and the wrapper
   * hides an empty one, so the row was simply not there. Rather than assert
   * that from arithmetic, take the row away in the browser and measure the
   * board again. Whatever this number is, it is what the human's own Enter
   * used to do to their picks.
   */
  const withoutTheNote = await page.evaluate((selector) => {
    const before = [...document.querySelectorAll(selector)].map((el) =>
      Math.round(el.getBoundingClientRect().top)
    );
    const box = document.querySelector('[data-board-note]');
    if (!box) return { removed: false, moved: null };
    box.style.display = 'none';
    const after = [...document.querySelectorAll(selector)].map((el) =>
      Math.round(el.getBoundingClientRect().top)
    );
    box.style.display = '';
    return {
      removed: true,
      moved: before.map((top, index) => (after[index] ?? top) - top),
    };
  }, BOARD_CARD);
  note('with the note row taken away', {
    removed: withoutTheNote.removed,
    everyCardMovedBy: [...new Set(withoutTheNote.moved ?? [])],
  });
  await shot('04-note-removed');

  /*
   * The other half of the same defect: the exhibition strip.
   *
   * `ExhibitionHead` renders from the first pick onwards, so the human's first
   * `P` puts a title, a statement and a count rail above the cards — and the
   * board's own height is computed from a `--lt-board-chrome` that a
   * `:has(.paillette-exhibition-head)` rule changes at the same moment. The
   * e2e lane attributed 104px of pick movement to it.
   *
   * Measured the same way the note row was: take the element out of the
   * document — out, not hidden, because `:has()` still matches a hidden
   * element — and see what the cards do. Whatever this number is, it is what
   * the strip's arrival costs the board.
   */
  const withoutTheStrip = await page.evaluate((selector) => {
    const head = document.querySelector('.paillette-exhibition-head');
    if (!head) return { removed: false, moved: null, headHeight: 0 };
    const headHeight = Math.round(head.getBoundingClientRect().height);
    const before = [...document.querySelectorAll(selector)].map((el) =>
      Math.round(el.getBoundingClientRect().top)
    );
    const anchor = head.nextSibling;
    const parent = head.parentNode;
    head.remove();
    const after = [...document.querySelectorAll(selector)].map((el) =>
      Math.round(el.getBoundingClientRect().top)
    );
    parent?.insertBefore(head, anchor);
    return {
      removed: true,
      headHeight,
      moved: before.map((top, index) => (after[index] ?? top) - top),
    };
  }, BOARD_CARD);
  note('with the exhibition strip taken away', {
    removed: withoutTheStrip.removed,
    headHeight: withoutTheStrip.headHeight,
    everyCardMovedBy: [...new Set(withoutTheStrip.moved ?? [])],
  });
  await shot('05-strip-removed');

  await writeFile(
    path.join(OUT, 'geometry.json'),
    `${JSON.stringify(out, null, 2)}\n`
  );
  await ctx.close();
  await browser.close();
};

await main();
