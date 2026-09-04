/**
 * Walk the demo loop by hand, in the order the brief asks for it:
 *
 *   deal a board · P on two works · X on two others · Enter on an empty bar ·
 *   the board redeals with the picks still in place and no model call ·
 *   the FLIP actually animates and the picks visibly stay put
 *
 * The existing `e2e-deterministic.mjs` flags X, X, P. Two picks rather than one
 * is not pedantry: with a single pick, "the picks stayed put" and "the one pin
 * we have happens to land back on slot zero" are the same measurement. Two
 * picks in different slots tell those apart.
 *
 * Everything here is measured, not asserted. The FLIP is counted by sampling
 * the board's layout every animation frame — a real tween produces dozens of
 * distinct layouts, a jump cut produces four or five — and "no model call" is
 * counted off the wire rather than trusted.
 *
 *   node scripts/demo/walk-the-loop.mjs [baseUrl] [query]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const QUERY = process.argv[3] ?? 'warm landscape';
const OUT = path.resolve('docs/night/e2e-evidence/walk');

const results = [];
const note = (ok, what, detail) => {
  results.push({ ok, what, detail: detail ?? '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Positions of the cards in the deal grid — the board, not the tray. */
const boardSlots = (page) =>
  page.evaluate(() => {
    const grid = document.querySelector('[data-testid="deal-board-grid"]');
    const scope = grid ?? document;
    const out = {};
    for (const el of scope.querySelectorAll('[data-artwork-id]')) {
      const r = el.getBoundingClientRect();
      out[el.getAttribute('data-artwork-id')] = { x: Math.round(r.x), y: Math.round(r.y) };
    }
    return out;
  });

const flagsOnScreen = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')]
      .map((el) => ({
        id: el.getAttribute('data-artwork-id'),
        flag: el.getAttribute('data-flag'),
        by: el.getAttribute('data-flag-by'),
        provisional: el.getAttribute('data-flag-provisional'),
      }))
      .filter((m) => m.flag && m.flag !== 'none')
  );

/**
 * Put the hand back on the board. The search field autofocuses, and the board
 * keyboard correctly ignores bare letters typed into a text field, so P does
 * nothing until something outside the field has focus. The voice lane flagged
 * this as an invisible precondition; it is real, and it is the first thing
 * that would wreck a take.
 */
const handBackToBoard = async (page) => {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && active !== document.body && 'blur' in active) active.blur();
  });
};

const flag = async (page, id, key) => {
  await handBackToBoard(page);
  const card = page.locator(`[data-artwork-id="${id}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.keyboard.press(key);
  await sleep(300);
};

const startSampling = (page) =>
  page.evaluate(() => {
    window.__layouts = [];
    window.__sampling = true;
    const tick = () => {
      if (!window.__sampling) return;
      const grid = document.querySelector('[data-testid="deal-board-grid"]');
      window.__layouts.push(
        [...(grid ?? document).querySelectorAll('[data-artwork-id]')]
          .map((el) => {
            const r = el.getBoundingClientRect();
            return `${el.getAttribute('data-artwork-id')}@${Math.round(r.x)},${Math.round(r.y)}`;
          })
          .join('|')
      );
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

const stopSampling = async (page) => {
  const layouts = await page.evaluate(() => {
    window.__sampling = false;
    return window.__layouts ?? [];
  });
  return { frames: layouts.length, distinct: new Set(layouts.filter(Boolean)).size };
};

const main = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  const net = [];
  const t0 = Date.now();
  page.on('request', (r) => net.push({ at: Date.now() - t0, url: r.url() }));
  const since = (mark) => net.filter((n) => n.at >= mark);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

  // --- step 0: open the page --------------------------------------------
  await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-artwork-id]').length > 0, {
    timeout: 45_000,
  });
  const bar = page.locator('input[aria-label="Ask the agent"]');
  note((await bar.count()) === 1, 'the utterance bar is on the page', `count=${await bar.count()}`);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')].map((el) =>
      el.getAttribute('data-artwork-id')
    )
  );
  note(ids.length >= 4, `the search dealt works for "${QUERY}"`, `${ids.length} cards`);
  await shot('01-search');

  // --- step 1: P on two works, X on two others --------------------------
  const picks = [ids[0], ids[1]];
  const rejects = [ids[2], ids[3]];
  const flagMark = Date.now() - t0;
  for (const id of picks) await flag(page, id, 'p');
  for (const id of rejects) await flag(page, id, 'x');

  const marks = await flagsOnScreen(page);
  const markOf = (id) => marks.find((m) => m.id === id);
  for (const id of picks) {
    const m = markOf(id);
    note(m?.flag === 'pick' && m?.by === 'human', `P marks ${id.split(':').pop()} as a human pick`, JSON.stringify(m));
  }
  for (const id of rejects) {
    const m = markOf(id);
    note(m?.flag === 'reject' && m?.by === 'human', `X marks ${id.split(':').pop()} as a human reject`, JSON.stringify(m));
  }
  note(
    since(flagMark).every((n) => !n.url.includes('/public-agent/turn')),
    'flagging fires no model call',
    `${since(flagMark).length} requests while flagging`
  );
  await shot('02-flagged');

  // --- step 2: Enter on an empty bar deals the board ---------------------
  await bar.click();
  note((await bar.inputValue()) === '', 'the bar is empty before Enter', '');
  const deal1Mark = Date.now() - t0;
  await bar.press('Enter');
  await page
    .waitForFunction(() => Boolean(document.querySelector('[data-testid="deal-board-grid"]')), {
      timeout: 45_000,
    })
    .catch(() => {});
  await sleep(4000);

  const deal1 = since(deal1Mark);
  note(
    deal1.filter((n) => n.url.includes('/public-agent/turn')).length === 0,
    'Enter on an empty bar makes NO model call',
    `${deal1.filter((n) => n.url.includes('/public-agent/turn')).length} model calls, ${deal1.length} requests total`
  );
  note(
    deal1.filter((n) => n.url.includes('exemplar')).length >= 1,
    'Enter on an empty bar hits the deterministic exemplar engine',
    `${deal1.filter((n) => n.url.includes('exemplar')).length} calls`
  );

  const board = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="deal-board-grid"]');
    if (!grid) return null;
    const cards = [...grid.querySelectorAll('[data-artwork-id]')];
    const vh = window.innerHeight;
    return {
      count: cards.length,
      fullyVisible: cards.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= vh;
      }).length,
      gridHeight: Math.round(grid.getBoundingClientRect().height),
      viewport: vh,
    };
  });
  note(board?.count === 12, 'the board is twelve cards', JSON.stringify(board));
  note(
    board && board.fullyVisible === board.count,
    'every card on the board is fully on screen',
    `${board?.fullyVisible}/${board?.count} visible in ${board?.viewport}px`
  );

  const tray = await page.evaluate(() =>
    [...document.querySelectorAll('.lt-tray [data-artwork-id]')].map((el) =>
      el.getAttribute('data-artwork-id')
    )
  );
  note(
    rejects.every((id) => tray.includes(id)),
    'both rejects are in the visible tray, still restorable',
    `tray holds ${tray.length}: ${tray.map((t) => t.split(':').pop()).join(', ')}`
  );
  await shot('03-dealt');

  // --- step 3: Enter again — the board-to-board deal, where the pin counts
  const beforeSlots = await boardSlots(page);
  const pickSlotsBefore = Object.fromEntries(picks.map((id) => [id, beforeSlots[id] ?? null]));
  note(
    picks.every((id) => beforeSlots[id]),
    'both picks are on the dealt board before the second deal',
    JSON.stringify(pickSlotsBefore)
  );

  await startSampling(page);
  const deal2Mark = Date.now() - t0;
  await bar.click();
  await bar.press('Enter');
  await page
    .waitForFunction(
      (prev) => {
        const grid = document.querySelector('[data-testid="deal-board-grid"]');
        if (!grid) return false;
        const now = [...grid.querySelectorAll('[data-artwork-id]')]
          .map((el) => el.getAttribute('data-artwork-id'))
          .join(',');
        return now && now !== prev;
      },
      Object.keys(beforeSlots).join(','),
      { timeout: 45_000 }
    )
    .catch(() => {});
  await sleep(4000);
  const flip = await stopSampling(page);

  const deal2 = since(deal2Mark);
  note(
    deal2.filter((n) => n.url.includes('/public-agent/turn')).length === 0,
    'the second Enter also makes NO model call',
    `${deal2.filter((n) => n.url.includes('/public-agent/turn')).length} model calls`
  );

  const afterSlots = await boardSlots(page);
  const held = picks.filter(
    (id) =>
      beforeSlots[id] &&
      afterSlots[id] &&
      beforeSlots[id].x === afterSlots[id].x &&
      beforeSlots[id].y === afterSlots[id].y
  );
  note(
    held.length === picks.length,
    'both picks hold the exact same pixels across the redeal',
    picks
      .map(
        (id) =>
          `${id.split(':').pop()}: ${JSON.stringify(beforeSlots[id])} -> ${JSON.stringify(afterSlots[id])}`
      )
      .join('  |  ')
  );
  note(
    rejects.every((id) => !afterSlots[id]),
    'the rejects are gone from the board',
    rejects.map((id) => `${id.split(':').pop()}=${afterSlots[id] ? 'still there' : 'gone'}`).join(', ')
  );

  // A jump cut is four or five distinct layouts: before, after, and the frames
  // either side. A real tween moves cards over ~400ms at 60fps.
  note(
    flip.distinct >= 10,
    'the deal actually animates rather than cutting',
    `${flip.distinct} distinct layouts across ${flip.frames} sampled frames`
  );
  await shot('04-redealt');

  note(pageErrors.length === 0, 'no uncaught page errors across the walk', pageErrors.join(' | ').slice(0, 300));

  await writeFile(
    path.join(OUT, 'walk.json'),
    `${JSON.stringify({ base: BASE, query: QUERY, picks, rejects, board, tray, flip, beforeSlots, afterSlots, results }, null, 2)}\n`
  );

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass} pass · ${results.length - pass} fail`);
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
