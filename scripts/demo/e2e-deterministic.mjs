/**
 * The demo loop's *agentless* half, walked on a deployed build.
 *
 * Steps 2, 3, 5 and 6 of the brief's §9 loop — flag, Enter on an empty bar,
 * compare, and the deal animation — none of which may reach a model. Every
 * request the page makes is recorded, so "no model call" is asserted against
 * the network log rather than against a comment.
 *
 * Zero model calls, so it is safe to re-run against the anonymous agent budget.
 *
 *   PLAYWRIGHT_CORE=… node scripts/demo/e2e-deterministic.mjs <base-url> <out-dir>
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e-det';
const QUERY = process.env.E2E_QUERY ?? 'sunset landscape';

await mkdir(OUT, { recursive: true });

const results = [];
const note = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Where every card is, twice over.
 *
 * `page` is the position in the document, which is what a viewer's eye tracks.
 * `board` is the position inside the deal grid, which is what "the pick held
 * its slot" means. They disagree whenever anything above the board changes
 * height, and that difference is the whole of the answer to "do the picks
 * visibly hold position".
 */
const boxes = (page) =>
  page.evaluate(() => {
    const grid = document.querySelector('[data-testid="deal-board-grid"]');
    const g = grid?.getBoundingClientRect();
    return {
      grid: g ? { x: Math.round(g.x), y: Math.round(g.y + window.scrollY) } : null,
      cards: Object.fromEntries(
        // The tray carries `data-artwork-id` too, and must not be counted as
        // the board. A reject that has left the board and is sitting in the
        // tray is precisely what §7.1 asks for; counting it here would report
        // the tray working as the deal failing.
        [...document.querySelectorAll('[data-artwork-id]')]
          .filter((el) => !el.closest('.lt-tray'))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return [
              el.getAttribute('data-artwork-id'),
              {
                page: { x: Math.round(r.x), y: Math.round(r.y + window.scrollY) },
                board: g
                  ? { x: Math.round(r.x - g.x), y: Math.round(r.y - g.y) }
                  : null,
                w: Math.round(r.width),
              },
            ];
          })
      ),
    };
  });

/** What is in the tray, which is where a reject is supposed to end up. */
const trayIds = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.lt-tray [data-artwork-id]')].map((el) =>
      el.getAttribute('data-artwork-id')
    )
  );

const flagsOnScreen = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')]
      .filter((el) => !el.closest('.lt-tray'))
      .map((el) => ({
        id: el.getAttribute('data-artwork-id'),
        flag: el.getAttribute('data-flag'),
        by: el.getAttribute('data-flag-by'),
        provisional: el.getAttribute('data-flag-provisional'),
      }))
  );

/**
 * `P`/`X`/`U` only reach the board when no text field holds the caret, and
 * pressing Enter in the utterance bar leaves the caret there. A human driving
 * with a mouse never notices; a script does, and so would anyone who clicked
 * the bar once before reaching for the keys.
 */
const handBackToBoard = async (page) => {
  await page.evaluate(() => document.activeElement?.blur?.());
};

const flag = async (page, id, key) => {
  await handBackToBoard(page);
  const card = page.locator(`[data-artwork-id="${id}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.keyboard.press(key);
  await new Promise((r) => setTimeout(r, 250));
};

/** The bridge answers `{ok, ...}` or an MCP content envelope; read both. */
const unwrap = (value) => {
  if (value && typeof value === 'object' && Array.isArray(value.content)) {
    try {
      return JSON.parse(value.content[0]?.text ?? 'null');
    } catch {
      return value;
    }
  }
  return value;
};

const main = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  /** Every request the page makes, with a monotonic clock. */
  const net = [];
  const t0 = Date.now();
  page.on('request', (r) =>
    net.push({ at: Date.now() - t0, method: r.method(), url: r.url() })
  );
  const since = (mark) => net.filter((n) => n.at >= mark);
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e.message)));

  const shot = async (name) =>
    page.screenshot({ path: path.join(OUT, `${name}.png`) });

  const url = `${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // --- preconditions -----------------------------------------------------
  await page.waitForFunction(() => Boolean(document.modelContext), { timeout: 30_000 });
  const tools = await page.evaluate(async () => {
    for (let i = 0; i < 60; i += 1) {
      const t = await window.__paillette_webmcp?.tools?.();
      if (t?.length) return t.map((x) => x.name);
      await new Promise((r) => setTimeout(r, 250));
    }
    return [];
  });
  note(tools.length > 0, `webmcp-debug registers tools`, `${tools.length} tools`);

  const agentBar = page.locator('input[aria-label="Ask the agent"]');
  note(
    (await agentBar.count()) === 1,
    'in-page agent bar renders under ?webmcp-debug',
    `count=${await agentBar.count()}`
  );

  await page.waitForFunction(
    () => document.querySelectorAll('[data-artwork-id]').length > 0,
    { timeout: 30_000 }
  );
  const focus = await page.evaluate(() => document.activeElement?.tagName ?? 'NONE');
  note(focus === 'BODY', 'focus is on BODY at cold load (culling keys live)', focus);
  await shot('01-loaded');

  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')].map((el) =>
      el.getAttribute('data-artwork-id')
    )
  );
  note(ids.length >= 3, `board has works`, `${ids.length} cards for "${QUERY}"`);

  // --- step 2: X, X, P ---------------------------------------------------
  const flagMark = Date.now() - t0;
  const targets = [
    { id: ids[0], key: 'x', want: 'reject' },
    { id: ids[1], key: 'x', want: 'reject' },
    { id: ids[2], key: 'p', want: 'pick' },
  ];
  for (const t of targets) await flag(page, t.id, t.key);
  const marks = await flagsOnScreen(page);
  const byId = (id) => marks.find((m) => m.id === id);
  for (const t of targets) {
    const m = byId(t.id);
    note(
      m?.flag === t.want && m?.by === 'human' && m?.provisional === 'false',
      `${t.key.toUpperCase()} sets ${t.want} on ${t.id}`,
      JSON.stringify(m)
    );
  }
  note(
    since(flagMark).every((n) => !n.url.includes('/public-agent/turn')),
    'flagging fires no model call',
    `${since(flagMark).length} requests during flagging`
  );

  // Flags survive a reload of the same board (per-session persistence).
  const viewCtx = unwrap(
    await page.evaluate(() => window.__paillette_webmcp.call('get_view_context', {}))
  );
  const ctxFlags = viewCtx?.flags ?? null;
  note(
    ctxFlags?.picks?.length === 1 && ctxFlags?.rejects?.length === 2,
    'get_view_context reports the three flags',
    JSON.stringify(ctxFlags).slice(0, 700)
  );
  note(
    ctxFlags?.exemplars?.positive?.length === 1 &&
      ctxFlags?.exemplars?.negative?.length === 2,
    'get_view_context hands the agent the exemplar sets',
    JSON.stringify(ctxFlags?.exemplars)
  );
  await writeFile(
    path.join(OUT, 'get_view_context.json'),
    `${JSON.stringify(viewCtx, null, 2)}\n`
  );
  await shot('02-flagged');

  // --- step 3: Enter on an empty bar ------------------------------------
  const before = await boxes(page);
  const pickId = targets[2].id;

  // Sample the layout every animation frame across the redeal, so the FLIP is
  // measured rather than asserted. A jump cut produces 4–5 distinct layouts.
  await page.evaluate(() => {
    window.__layouts = [];
    window.__sampling = true;
    const tick = () => {
      if (!window.__sampling) return;
      window.__layouts.push(
        [...document.querySelectorAll('[data-artwork-id]')]
          .map((el) => {
            const r = el.getBoundingClientRect();
            return `${Math.round(r.x)},${Math.round(r.y)}`;
          })
          .join('|')
      );
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const enterMark = Date.now() - t0;
  await agentBar.click();
  const barValue = await agentBar.inputValue();
  note(barValue === '', 'the utterance bar is empty before Enter', JSON.stringify(barValue));
  const enterAt = Date.now();
  await agentBar.press('Enter');

  await page
    .waitForFunction(
      (prev) => {
        const now = [...document.querySelectorAll('[data-artwork-id]')].map((el) =>
          el.getAttribute('data-artwork-id')
        );
        return now.length > 0 && now.join(',') !== prev;
      },
      Object.keys(before.cards).join(','),
      { timeout: 45_000 }
    )
    .catch(() => {});
  const redealMs = Date.now() - enterAt;
  await sleep(1500);
  await page.evaluate(() => {
    window.__sampling = false;
  });

  const during = since(enterMark);
  const modelCalls = during.filter((n) => n.url.includes('/public-agent/turn'));
  const exemplarCalls = during.filter((n) => n.url.includes('exemplar'));
  note(
    modelCalls.length === 0,
    'Enter on an empty bar makes NO model call',
    `${modelCalls.length} requests to /public-agent/turn; ${during.length} requests total in the window`
  );
  note(
    exemplarCalls.length >= 1,
    'Enter on an empty bar hits the deterministic exemplar engine',
    exemplarCalls.map((n) => `${n.method} ${n.url}`).join(' , ') || 'none'
  );

  const after = await boxes(page);
  const afterIds = Object.keys(after.cards);
  note(
    afterIds.includes(pickId),
    'the pick survives the redeal',
    `pick=${pickId} board=${afterIds.length} works`
  );
  const rejected = targets.filter((t) => t.want === 'reject');
  const rejectsGone = rejected.every((t) => !afterIds.includes(t.id));
  note(rejectsGone, 'both rejects leave the board');
  // §7.1: rejects slide to a narrow visible tray at the left edge, still
  // restorable. Off screen entirely is the degraded version, and it makes
  // "still restorable" a claim the docs make and the viewer cannot see.
  const inTray = await trayIds(page);
  note(
    rejected.every((t) => inTray.includes(t.id)),
    'the rejects are in the visible tray, not gone',
    `tray holds ${inTray.length}: ${inTray.join(', ') || 'nothing'}`
  );
  note(
    after.grid !== null,
    'the redeal renders the deal board, not the browsing masonry',
    after.grid ? 'data-testid="deal-board-grid" present' : 'no deal-board-grid in the DOM'
  );

  // §4: twelve cards, so every move reads on video. Two thirds of the deal
  // happening below the fold is the legibility argument gone.
  const fit = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="deal-board-grid"]');
    if (!grid) return null;
    const cards = [...grid.querySelectorAll('[data-artwork-id]')];
    const visible = cards.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
    const g = grid.getBoundingClientRect();
    return {
      cards: cards.length,
      visible: visible.length,
      gridHeight: Math.round(g.height),
      viewport: window.innerHeight,
    };
  });
  note(
    Boolean(fit) && fit.visible === fit.cards,
    'every dealt card is on screen at once',
    JSON.stringify(fit)
  );

  const moved = (a, b, id) =>
    a.cards[id] && b.cards[id]
      ? {
          page: {
            dx: Math.abs(b.cards[id].page.x - a.cards[id].page.x),
            dy: Math.abs(b.cards[id].page.y - a.cards[id].page.y),
          },
          board:
            a.cards[id].board && b.cards[id].board
              ? {
                  dx: Math.abs(b.cards[id].board.x - a.cards[id].board.x),
                  dy: Math.abs(b.cards[id].board.y - a.cards[id].board.y),
                }
              : null,
        }
      : null;

  const m1 = moved(before, after, pickId);
  note(
    m1 !== null,
    'first redeal (masonry -> board): the pick is measurable on both sides',
    JSON.stringify(m1)
  );

  const layouts = await page.evaluate(() => ({
    frames: window.__layouts.length,
    distinct: new Set(window.__layouts).size,
  }));
  // Known and expected to be a cut: this deal replaces a browsing masonry with
  // a board, so nothing can hold a slot it never had. The board-to-board deal
  // below is the one that has to animate, and the one that gets filmed.
  note(
    true,
    'first redeal (masonry -> board) is a cut, not a deal',
    `${layouts.distinct} distinct layouts across ${layouts.frames} frames — a jump cut measures 4–5`
  );
  note(true, 'redeal latency', `${redealMs}ms from Enter to a changed board`);
  await shot('03-after-first-redeal');

  // A second redeal: board-to-board, which is the one that gets filmed.
  const before2 = await boxes(page);
  await page.evaluate(() => {
    window.__layouts = [];
    window.__sampling = true;
    const tick = () => {
      if (!window.__sampling) return;
      window.__layouts.push(
        [...document.querySelectorAll('[data-artwork-id]')]
          .map((el) => {
            const r = el.getBoundingClientRect();
            return `${Math.round(r.x)},${Math.round(r.y)}`;
          })
          .join('|')
      );
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const mark2 = Date.now() - t0;
  // Flag two more so the second deal has something to move.
  const freshIds = afterIds.filter((id) => id !== pickId).slice(0, 2);
  for (const id of freshIds) await flag(page, id, 'x');
  const marks2 = await flagsOnScreen(page);
  note(
    freshIds.every((id) => marks2.find((m) => m.id === id)?.flag === 'reject'),
    'X still flags after a redeal',
    JSON.stringify(marks2.filter((m) => freshIds.includes(m.id)))
  );
  // Enter with nothing focused — the path a human on a mouse actually takes,
  // and the one `isBareBoardEnter` exists for.
  await handBackToBoard(page);
  await page.keyboard.press('Enter');
  await page
    .waitForFunction(
      (prev) => {
        const now = [...document.querySelectorAll('[data-artwork-id]')].map((el) =>
          el.getAttribute('data-artwork-id')
        );
        return now.length > 0 && now.join(',') !== prev;
      },
      afterIds.join(','),
      { timeout: 45_000 }
    )
    .catch(() => {});
  await sleep(1500);
  await page.evaluate(() => {
    window.__sampling = false;
  });
  const after2 = await boxes(page);
  const layouts2 = await page.evaluate(() => ({
    frames: window.__layouts.length,
    distinct: new Set(window.__layouts).size,
  }));
  const model2 = since(mark2).filter((n) => n.url.includes('/public-agent/turn'));
  const exemplars2 = since(mark2).filter((n) => n.url.includes('exemplar'));
  note(
    model2.length === 0,
    'Enter with nothing focused (bare board) redeals with NO model call',
    `${model2.length} model calls; ${exemplars2.length} exemplar calls`
  );
  const m2 = moved(before2, after2, pickId);
  note(
    m2?.board?.dx === 0 && m2?.board?.dy === 0,
    'board-to-board: the pick holds its slot in the deal grid',
    JSON.stringify(m2)
  );
  note(
    m2?.page?.dx === 0 && m2?.page?.dy === 0,
    'board-to-board: the pick moves zero pixels on the page',
    JSON.stringify(m2)
  );
  note(
    layouts2.distinct > 8,
    'board-to-board deal animates',
    `${layouts2.distinct} distinct layouts across ${layouts2.frames} frames`
  );
  await shot('04-after-second-redeal');

  // --- step 5: compare_artworks -----------------------------------------
  const pair = Object.keys(after2.cards).slice(0, 2);
  const compareMark = Date.now() - t0;
  const compareResult = await page.evaluate(
    async ([a, b]) =>
      await window.__paillette_webmcp.call('compare_artworks', {
        artworkIds: [a, b],
        question: 'Which one holds the wall better?',
      }),
    pair
  );
  await sleep(1200);
  const compareOnScreen = await page.evaluate(() => {
    const el = document.querySelector('.paillette-compare');
    return {
      present: Boolean(el),
      label: el?.getAttribute('aria-label') ?? null,
      askedBy: el?.getAttribute('data-asked-by') ?? null,
      question: el?.querySelector('p')?.textContent ?? null,
      choices: [...(el?.querySelectorAll('.paillette-compare-work') ?? [])].map((b) => ({
        id: b.getAttribute('data-artwork-id'),
        side: b.getAttribute('data-side'),
        label: b.getAttribute('aria-label'),
      })),
      fullScreen: el
        ? (() => {
            const r = el.getBoundingClientRect();
            return `${Math.round(r.width)}x${Math.round(r.height)}`;
          })()
        : null,
      // Where it actually is. `fixed` is relative to the viewport only until
      // an ancestor has a transform, and a finished GSAP tween leaves an
      // identity matrix on the results section — which put this room 2,500px
      // below the fold. Portalled to <body>, so the numbers are the viewport's.
      box: el
        ? (() => {
            const r = el.getBoundingClientRect();
            return {
              top: Math.round(r.top),
              left: Math.round(r.left),
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          })()
        : null,
      portalled: el?.parentElement === document.body,
      // §7.3 asks for a room with nothing else on screen. Anything still
      // visible outside it is the interface narrating over the pictures.
      chromeVisible: [
        'header',
        'input[aria-label="Ask the agent"]',
        '[data-testid="deal-board-grid"]',
      ].filter((selector) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const style = window.getComputedStyle(node);
        return style.visibility !== 'hidden' && style.display !== 'none';
      }),
    };
  });
  note(
    !compareResult?.isError && compareResult?.ok !== false,
    'compare_artworks resolves',
    JSON.stringify(compareResult).slice(0, 300)
  );
  note(
    compareOnScreen.present && compareOnScreen.choices.length === 2,
    'the two-up is on screen as a room',
    JSON.stringify(compareOnScreen).slice(0, 500)
  );
  note(
    compareOnScreen.question === 'Which one holds the wall better?',
    "the agent's question is set between the two works",
    JSON.stringify(compareOnScreen.question)
  );
  note(
    compareOnScreen.box?.top === 0 && compareOnScreen.box?.left === 0,
    'the two-up is at the top of the viewport, not below the fold',
    JSON.stringify({
      box: compareOnScreen.box,
      portalled: compareOnScreen.portalled,
    })
  );
  note(
    compareOnScreen.chromeVisible?.length === 0,
    'nothing else is on screen while the two-up is open',
    `still visible: ${compareOnScreen.chromeVisible?.join(', ') || 'nothing'}`
  );
  await shot('05-compare');

  // Choosing a winner: pick/reject must resolve, and the brief says the click
  // is sent as a human turn.
  const chooseMark = Date.now() - t0;
  const winner = compareOnScreen.choices[0]?.id;
  const loser = compareOnScreen.choices[1]?.id;
  await page.locator(`.paillette-compare-work[data-artwork-id="${winner}"]`).click();
  await sleep(3000);
  const afterChoice = await flagsOnScreen(page);
  const stillOpen = await page.evaluate(() =>
    Boolean(document.querySelector('.paillette-compare'))
  );
  const turnSent = since(chooseMark).filter((n) => n.url.includes('/public-agent/turn'));
  const mark = (id) => afterChoice.find((m) => m.id === id) ?? null;
  note(!stillOpen, 'choosing closes the two-up');
  note(
    mark(winner)?.flag === 'pick' && mark(winner)?.by === 'human',
    'the winner becomes a human pick',
    JSON.stringify(mark(winner))
  );
  note(
    mark(loser)?.flag === 'reject' && mark(loser)?.by === 'human',
    'the loser becomes a human reject',
    JSON.stringify(mark(loser))
  );
  // The brief's P4 says the click "is sent as a human turn". The build does
  // not send it: `resolveCompare` records the choice and lets it ride the next
  // turn, deliberately, so the board does not thrash. Recorded either way.
  note(
    turnSent.length >= 1,
    'choosing sends a human turn to the agent immediately',
    `${turnSent.length} POST(s) to /public-agent/turn in the 3s after the click` +
      (turnSent.length === 0
        ? ' — resolveCompare() records the choice for the *next* turn instead'
        : '')
  );
  await shot('06-after-choice');

  // --- the layout the agent picks must not be able to delete the board -----
  //
  // `ResultsLayout` used to answer salon/atlas/table before it checked whether
  // a deal had put these works on the table, and the system prompt was
  // recommending "salon for a curated hang" — so on a cold run the model could
  // choose a layout with no pinned picks, no FLIP and no deal grid, and the
  // money shot simply would not exist. A dealt board now outranks every one of
  // them, whoever asked.
  for (const layout of ['salon', 'atlas', 'table', 'masonry']) {
    await page.evaluate(
      (view) => window.__paillette_webmcp.call('set_view', { view }),
      layout
    );
    await sleep(1200);
    const grid = await page.evaluate(() =>
      Boolean(document.querySelector('[data-testid="deal-board-grid"]'))
    );
    note(
      grid,
      `set_view "${layout}" cannot take the dealt board away`,
      `deal-board-grid present=${grid} while a dealt board is on the table`
    );
    await shot(`07-view-${layout}`);
  }

  // --- the whole network log, for the report ----------------------------
  await writeFile(
    path.join(OUT, 'network.json'),
    `${JSON.stringify(
      net.filter(
        (n) =>
          n.url.includes('/api/') ||
          n.url.includes('public-agent') ||
          n.url.includes('exemplar')
      ),
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(OUT, 'results.json'),
    `${JSON.stringify({ base: BASE, query: QUERY, results, consoleErrors }, null, 2)}\n`
  );

  await ctx.close();
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(
    `\n${results.length - failed.length} passed, ${failed.length} failed\n`
  );
  if (consoleErrors.length) process.stdout.write(`page errors: ${consoleErrors.join(' | ')}\n`);
  process.exit(failed.length ? 1 : 0);
};

await main();
