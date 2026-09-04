/**
 * The brief's §9 loop, in the brief's order, typed, on a deployed build.
 *
 * Iteration 1's agent harness laid the flags down *before* the instruction,
 * which is cheaper but is not the order the brief asks for. This one runs the
 * loop as written:
 *
 *   1. the sofa instruction on a cold page — a board comes back with a note
 *   2. X on two works, P on one — the flags persist and are visible
 *   3. Enter on an empty bar — the board redeals with NO model call, proven
 *      off the wire rather than asserted
 *   4. the agent's next note, and whether it names the *content* of what was
 *      thrown out
 *   6. the deal animates and the picks visibly hold position
 *
 * Step 5 (compare) lives in `e2e-deterministic.mjs`, which already drives it
 * and costs nothing.
 *
 * Voice is untouched throughout: nothing here clicks the microphone, and the
 * instruction is typed character by character into the utterance bar.
 *
 * Model calls are the scarce resource — the anonymous budget is 40 per client
 * per hour and one typed instruction spends five or six — so there are two
 * modes:
 *
 *   --full       the whole loop above, two agent turns (steps 1 and 4)
 *   --note-only  steps 2→4 only, one agent turn: flags, Enter, then the sofa
 *                prompt, which is exactly what §9's third bullet asks be
 *                checked three times
 *
 *   PLAYWRIGHT_CORE=… node scripts/demo/e2e2-loop.mjs --full <base> <out> [label]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const argv = process.argv.slice(2);
const MODE = argv.find((a) => a.startsWith('--'))?.slice(2) ?? 'note-only';
const rest = argv.filter((a) => !a.startsWith('--'));
const BASE = rest[0] ?? 'https://paillette-stg.berlayar.ai';
const OUT = rest[1] ?? '/tmp/e2e2-loop';
const LABEL = rest[2] ?? MODE;
const QUERY = process.env.E2E_QUERY ?? 'sunset landscape';

const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const note = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  process.stdout.write(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}\n`
  );
};

const unwrap = (raw) => {
  if (Array.isArray(raw?.content)) {
    try {
      return JSON.parse(raw.content[0].text);
    } catch {
      return raw.content[0].text;
    }
  }
  return raw;
};

/**
 * What counts as a card on the board.
 *
 * `[data-artwork-id]` alone is too loose on this page and reading it that way
 * cost a whole run. Three different things carry the attribute: the result
 * cards, the reject tray, and `NoteSwatches` — a palette strip hung under the
 * wall label for every confirmed flag. Counting the swatches made a twelve-card
 * board measure fifteen, and, worse, made the pre-Enter id list stale the
 * moment a flag was laid, so `waitForFunction(list changed)` returned in 43ms
 * on a deal that had not started and the board was read mid-flight.
 */
const BOARD_CARDS =
  '[data-testid="deal-board-grid"] [data-artwork-id], .paillette-card[data-artwork-id]';

const cardIds = (page) =>
  page.evaluate(
    (selector) =>
      [...document.querySelectorAll(selector)]
        .filter((el) => !el.closest('.lt-tray'))
        .map((el) => el.getAttribute('data-artwork-id')),
    BOARD_CARDS
  );

/** Card geometry, page-relative and slot-relative, ignoring the tray and the swatches. */
const boxes = (page) =>
  page.evaluate(() => {
    const grid = document.querySelector('[data-testid="deal-board-grid"]');
    const g = grid?.getBoundingClientRect();
    return {
      grid: g ? { x: Math.round(g.x), y: Math.round(g.y + window.scrollY) } : null,
      cards: Object.fromEntries(
        [...document.querySelectorAll(
          '[data-testid="deal-board-grid"] [data-artwork-id], .paillette-card[data-artwork-id]'
        )]
          .filter((el) => !el.closest('.lt-tray'))
          .map((el) => {
            const r = el.getBoundingClientRect();
            return [
              el.getAttribute('data-artwork-id'),
              {
                page: { x: Math.round(r.x), y: Math.round(r.y + window.scrollY) },
                board: g ? { x: Math.round(r.x - g.x), y: Math.round(r.y - g.y) } : null,
              },
            ];
          })
      ),
    };
  });

const sampleLayouts = (page, ms) =>
  page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const seen = new Set();
        let frames = 0;
        const started = performance.now();
        const tick = () => {
          frames += 1;
          seen.add(
            [...document.querySelectorAll(
              '[data-testid="deal-board-grid"] [data-artwork-id], .paillette-card[data-artwork-id]'
            )]
              .filter((el) => !el.closest('.lt-tray'))
              .map((el) => {
                const r = el.getBoundingClientRect();
                return `${el.getAttribute('data-artwork-id')}:${Math.round(r.x)},${Math.round(r.y)}`;
              })
              .join('|')
          );
          if (performance.now() - started < duration) requestAnimationFrame(tick);
          else resolve({ layouts: seen.size, frames });
        };
        requestAnimationFrame(tick);
      }),
    ms
  );

const readBoard = (page) =>
  page.evaluate(() => {
    const label = document.querySelector('.paillette-wall-label');
    return {
      wallLabel: label?.textContent?.trim() ?? null,
      provenance: label?.getAttribute('data-provenance') ?? null,
      dealError: document.querySelector('[data-deal-error]')?.textContent ?? null,
      view: document.querySelector('[data-testid="deal-board-grid"]') ? 'deal-board' : 'other',
      onBoard: [...document.querySelectorAll(
        '[data-testid="deal-board-grid"] [data-artwork-id], .paillette-card[data-artwork-id]'
      )]
        .filter((el) => !el.closest('.lt-tray'))
        .map((el) => ({
          id: el.getAttribute('data-artwork-id'),
          flag: el.getAttribute('data-flag'),
          by: el.getAttribute('data-flag-by'),
          provisional: el.getAttribute('data-flag-provisional'),
        })),
      tray: [...document.querySelectorAll('.lt-tray [data-artwork-id]')].map((el) =>
        el.getAttribute('data-artwork-id')
      ),
      transcript: [...document.querySelectorAll('section[aria-label="Ask the agent"] ol li p')]
        .map((p) => p.textContent?.trim())
        .filter(Boolean),
    };
  });

/** The agent has stopped working when the bar re-enables and stays enabled. */
const waitForQuiet = async (page, deadlineMs = 180_000) => {
  const bar = page.locator('input[aria-label="Ask the agent"]');
  const started = Date.now();
  await page
    .waitForFunction(
      () => document.querySelector('input[aria-label="Ask the agent"]')?.disabled === true,
      { timeout: 25_000 }
    )
    .catch(() => {});
  let quietSince = null;
  while (Date.now() - started < deadlineMs) {
    const busy = await bar.isDisabled().catch(() => false);
    if (!busy) {
      quietSince = quietSince ?? Date.now();
      if (Date.now() - quietSince > 3500) return Date.now() - started;
    } else quietSince = null;
    await sleep(250);
  }
  return -1;
};

const main = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  const page = await ctx.newPage();

  const t0 = Date.now();
  /** Every request, timestamped, so "no model call" is read off the wire. */
  const net = [];
  page.on('request', (r) =>
    net.push({ at: Date.now() - t0, method: r.method(), url: r.url() })
  );
  /** Every agent POST with its body, so what the model was told is evidence. */
  const turns = [];
  await page.route('**/api/public-agent/turn', async (route) => {
    let body = null;
    try {
      body = JSON.parse(route.request().postData() ?? 'null');
    } catch {
      body = { unparsed: route.request().postData()?.slice(0, 300) };
    }
    turns.push({ at: Date.now() - t0, turn: body?.turn ?? null, messages: body?.messages?.length ?? 0 });
    await route.continue();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  const since = (mark) => net.filter((n) => n.at >= mark);

  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const record = { label: LABEL, mode: MODE, base: BASE, query: QUERY };

  // ---- cold load ---------------------------------------------------------
  const startUrl =
    MODE === 'full'
      ? `${BASE}/nga/search?webmcp-debug`
      : `${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`;
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(
    async () => ((await window.__paillette_webmcp?.tools?.()) ?? []).length > 0,
    { timeout: 60_000 }
  );
  if (MODE !== 'full') {
    await page.waitForFunction(
      () => document.querySelectorAll('[data-artwork-id]').length > 0,
      { timeout: 60_000 }
    );
  }
  await sleep(1500);
  await shot('01-cold-load');

  const bar = page.locator('input[aria-label="Ask the agent"]');
  note((await bar.count()) === 1, 'the utterance bar is on the page', `${await bar.count()}`);

  const micState = await page.evaluate(() => {
    const mic = document.querySelector('[data-testid="mic-button"], button[aria-label*="oice" i], button[aria-label*="peak" i]');
    return {
      micPresent: Boolean(mic),
      micPressed: mic?.getAttribute('aria-pressed') ?? null,
      listening: Boolean(document.querySelector('[data-listening="true"]')),
    };
  });
  note(
    micState.listening === false && micState.micPressed !== 'true',
    'voice is off — nothing is listening',
    JSON.stringify(micState)
  );

  // ---- STEP 1 (full mode): the instruction that needs no coaching --------
  if (MODE === 'full') {
    const mark = Date.now() - t0;
    const typedAt = Date.now();
    await bar.click();
    // Typed, character by character, into the bar. Not `fill`, not a paste,
    // not a synthesised transcript — the primary path is a person typing.
    await bar.type(SOFA, { delay: 12 });
    const inBar = await bar.inputValue();
    note(inBar === SOFA, 'the sofa instruction is in the bar, verbatim, typed', `${inBar.length} chars`);
    await shot('02-instruction-typed');
    await bar.press('Enter');
    const quietMs = await waitForQuiet(page);
    await sleep(2000);
    const board1 = await readBoard(page);
    record.step1 = {
      quietMs,
      elapsedMs: Date.now() - typedAt,
      modelCalls: since(mark).filter((n) => n.url.includes('/public-agent/turn')).length,
      toolTraffic: since(mark)
        .filter((n) => /\/api\//.test(n.url))
        .map((n) => `${n.at}ms ${n.method} ${n.url.replace(BASE, '').split('?')[0]}`),
      board: board1,
    };
    note(
      board1.onBoard.length > 0,
      'STEP 1 — a board comes back',
      `${board1.onBoard.length} works, view=${board1.view}, ${Math.round((Date.now() - typedAt) / 1000)}s from Enter`
    );
    note(
      Boolean(board1.wallLabel),
      'STEP 1 — with a written note',
      JSON.stringify(board1.wallLabel)
    );
    note(
      board1.provenance === 'agent',
      "STEP 1 — the note is in the agent's ink",
      `data-provenance=${board1.provenance}`
    );
    await shot('03-step1-board-and-note');
  }

  // ---- STEP 2: X on two, P on one ---------------------------------------
  const flagMark = Date.now() - t0;
  const ids = await cardIds(page);
  const targets = [
    { id: ids[0], key: 'x' },
    { id: ids[1], key: 'x' },
    { id: ids[2], key: 'p' },
  ];
  for (const t of targets) {
    await page.evaluate(() => document.activeElement?.blur?.());
    const card = page.locator(`.paillette-card[data-artwork-id="${t.id}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.keyboard.press(t.key);
    await sleep(300);
  }
  const flags = unwrap(
    await page.evaluate(() => window.__paillette_webmcp.call('get_view_context', {}))
  )?.flags;
  record.step2 = { targets, flags };
  const rejectedTitles = (flags?.rejects ?? []).map((f) => `${f.title} — ${f.artist}`);
  const pickedTitles = (flags?.picks ?? []).map((f) => `${f.title} — ${f.artist}`);
  note(
    (flags?.rejects ?? []).length === 2 && (flags?.picks ?? []).length === 1,
    'STEP 2 — two rejects and one pick land',
    JSON.stringify({ rejects: rejectedTitles, picks: pickedTitles })
  );
  note(
    [...(flags?.rejects ?? []), ...(flags?.picks ?? [])].every((f) => f.by === 'human'),
    "STEP 2 — every flag is the human's, none provisional",
    JSON.stringify(
      [...(flags?.rejects ?? []), ...(flags?.picks ?? [])].map((f) => ({ by: f.by, flag: f.flag ?? null }))
    )
  );
  // Visible, not merely in the store: read the marks off the cards.
  const visibleMarks = await page.evaluate(
    (wanted) =>
      wanted.map(({ id, key }) => {
        const el = document.querySelector(`[data-artwork-id="${id}"]`);
        const badge = el?.querySelector('[data-flag-badge], .paillette-flag-badge');
        return {
          id,
          key,
          onScreen: Boolean(el),
          flag: el?.getAttribute('data-flag') ?? null,
          by: el?.getAttribute('data-flag-by') ?? null,
          badge: badge ? (badge.textContent ?? '').trim() : null,
          outline: el ? window.getComputedStyle(el).outlineColor : null,
        };
      }),
    targets
  );
  record.step2.visibleMarks = visibleMarks;
  note(
    visibleMarks.every((m) => m.flag === (m.key === 'x' ? 'reject' : 'pick')),
    'STEP 2 — the flags are visible on the cards themselves',
    JSON.stringify(visibleMarks)
  );
  const flagModelCalls = since(flagMark).filter((n) => n.url.includes('/public-agent/turn')).length;
  note(flagModelCalls === 0, 'STEP 2 — flagging fires no model call', `${flagModelCalls}`);
  await shot('04-step2-flagged-XXP');

  // ---- STEP 3: Enter on an empty bar, no model call ----------------------
  const barValue = await bar.inputValue();
  note(barValue === '', 'STEP 3 — the bar is empty before Enter', JSON.stringify(barValue));
  const geomBefore = await boxes(page);
  // Read immediately before the key, not from `ids` ten steps ago: laying a
  // flag inserts a note swatch, which changed the old list and made the wait
  // below satisfied before the deal had begun.
  const beforeIds = (await cardIds(page)).join(',');
  const redealMark = Date.now() - t0;
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  const sampling = sampleLayouts(page, 2600);
  const tRedeal = Date.now();
  await page.keyboard.press('Enter');
  await page
    .waitForFunction(
      (prev) =>
        [...document.querySelectorAll(
          '[data-testid="deal-board-grid"] [data-artwork-id], .paillette-card[data-artwork-id]'
        )]
          .filter((el) => !el.closest('.lt-tray'))
          .map((el) => el.getAttribute('data-artwork-id'))
          .join(',') !== prev,
      beforeIds,
      { timeout: 60_000 }
    )
    .catch(() => {});
  const redealMs = Date.now() - tRedeal;
  const sampled1 = await sampling;
  // Let the deal land before reading it. A board read mid-flight reports the
  // works that are on their way out and an empty tray.
  await sleep(3000);
  const board3 = await readBoard(page);
  const geomAfter = await boxes(page);
  const redealTraffic = since(redealMark).filter((n) => /\/api\//.test(n.url));
  const redealModelCalls = redealTraffic.filter((n) => n.url.includes('/public-agent/turn'));
  record.step3 = {
    redealMs,
    sampled: sampled1,
    board: board3,
    traffic: redealTraffic.map((n) => `${n.at}ms ${n.method} ${n.url.replace(BASE, '').split('?')[0]}`),
    modelCalls: redealModelCalls.length,
    allRequestsAfterEnter: since(redealMark).length,
  };
  note(
    board3.onBoard.length === 12,
    'STEP 3 — the board redeals to twelve',
    `${board3.onBoard.length} cards, view=${board3.view}`
  );
  note(
    redealModelCalls.length === 0,
    'STEP 3 — NO MODEL CALL: zero POSTs to /public-agent/turn',
    `${redealModelCalls.length} of ${since(redealMark).length} requests after Enter; API traffic was ${
      redealTraffic.map((n) => n.url.replace(BASE, '').split('?')[0]).join(', ') || 'none'
    }`
  );
  note(
    redealTraffic.some((n) => n.url.includes('exemplars')),
    'STEP 3 — it hit the deterministic engine instead',
    redealTraffic.map((n) => n.url.replace(BASE, '').split('?')[0]).join(', ')
  );
  const pickId = targets.find((t) => t.key === 'p')?.id;
  const pickHeld =
    geomBefore.cards[pickId] && geomAfter.cards[pickId]
      ? {
          dxPage: geomAfter.cards[pickId].page.x - geomBefore.cards[pickId].page.x,
          dyPage: geomAfter.cards[pickId].page.y - geomBefore.cards[pickId].page.y,
          dxBoard: (geomAfter.cards[pickId].board?.x ?? 0) - (geomBefore.cards[pickId].board?.x ?? 0),
          dyBoard: (geomAfter.cards[pickId].board?.y ?? 0) - (geomBefore.cards[pickId].board?.y ?? 0),
        }
      : null;
  record.step3.pickHeld = pickHeld;
  note(
    Boolean(geomAfter.cards[pickId]),
    'STEP 3 — the pick is still on the board after the redeal',
    JSON.stringify(pickHeld)
  );
  const rejectIds = targets.filter((t) => t.key === 'x').map((t) => t.id);
  note(
    rejectIds.every((id) => !geomAfter.cards[id]),
    'STEP 3 — both rejects have left the board',
    JSON.stringify({ tray: board3.tray })
  );
  await shot('05-step3-after-first-redeal');

  // ---- STEP 6: the second redeal is the deal, and the pick holds ---------
  const geomB = await boxes(page);
  const idsB = (await cardIds(page)).join(',');
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  const sampling2 = sampleLayouts(page, 2600);
  await page.keyboard.press('Enter');
  await page
    .waitForFunction(
      (prev) =>
        [...document.querySelectorAll(
          '[data-testid="deal-board-grid"] [data-artwork-id], .paillette-card[data-artwork-id]'
        )]
          .filter((el) => !el.closest('.lt-tray'))
          .map((el) => el.getAttribute('data-artwork-id'))
          .join(',') !== prev,
      idsB,
      { timeout: 60_000 }
    )
    .catch(() => {});
  // Mid-flight, while the cards are still travelling.
  await sleep(380);
  await shot('06-step6-deal-midflight');
  const sampled2 = await sampling2;
  await sleep(3000);
  const geomC = await boxes(page);
  const held = Object.keys(geomB.cards)
    .filter((id) => geomC.cards[id])
    .map((id) => ({
      id,
      dxPage: geomC.cards[id].page.x - geomB.cards[id].page.x,
      dyPage: geomC.cards[id].page.y - geomB.cards[id].page.y,
      dxBoard: (geomC.cards[id].board?.x ?? 0) - (geomB.cards[id].board?.x ?? 0),
      dyBoard: (geomC.cards[id].board?.y ?? 0) - (geomB.cards[id].board?.y ?? 0),
    }));
  record.step6 = { first: sampled1, second: sampled2, held };
  note(
    sampled2.layouts >= 10,
    'STEP 6 — the deal animates board to board',
    `${sampled2.layouts} distinct layouts across ${sampled2.frames} frames (a jump cut is 4–5; the first redeal measured ${sampled1.layouts})`
  );
  note(
    held.length >= 1 && held.every((h) => h.dxBoard === 0 && h.dyBoard === 0),
    'STEP 6 — the picks visibly hold position, to the pixel',
    JSON.stringify(held)
  );
  await shot('07-step6-deal-settled');

  // ---- STEP 4: the agent's next note ------------------------------------
  const noteMark = Date.now() - t0;
  const flagsBefore = unwrap(
    await page.evaluate(() => window.__paillette_webmcp.call('get_view_context', {}))
  )?.flags;
  const typedAt2 = Date.now();
  await bar.click();
  await bar.type(SOFA, { delay: 12 });
  await shot('08-step4-instruction-typed');
  await bar.press('Enter');
  const quiet2 = await waitForQuiet(page);
  await sleep(2500);
  const board4 = await readBoard(page);
  record.step4 = {
    flagsBefore,
    rejectedTitles: (flagsBefore?.rejects ?? []).map((f) => ({
      title: f.title,
      artist: f.artist,
    })),
    pickedTitles: (flagsBefore?.picks ?? []).map((f) => ({ title: f.title, artist: f.artist })),
    quietMs: quiet2,
    elapsedMs: Date.now() - typedAt2,
    modelCalls: since(noteMark).filter((n) => n.url.includes('/public-agent/turn')).length,
    turnPayloads: turns.filter((t) => t.at >= noteMark).map((t) => t.turn),
    note: board4.wallLabel,
    provenance: board4.provenance,
    view: board4.view,
    transcript: board4.transcript,
    board: board4.onBoard,
  };
  note(
    Boolean(board4.wallLabel),
    'STEP 4 — the agent wrote a note',
    JSON.stringify(board4.wallLabel)
  );
  note(
    board4.view === 'deal-board',
    'STEP 4 — the board is still a deal board after the agent turn',
    board4.view
  );
  note(
    board4.onBoard.some((c) => c.flag === 'pick'),
    "STEP 4 — the human's pick is still on the board",
    JSON.stringify(board4.onBoard.filter((c) => c.flag))
  );
  await shot('09-step4-agent-note');

  record.results = results;
  record.errors = errors;
  record.turns = turns;
  record.net = net.filter((n) => /\/api\//.test(n.url));
  note(errors.length === 0, 'no uncaught page errors', JSON.stringify(errors.slice(0, 3)));

  await writeFile(path.join(OUT, 'loop.json'), `${JSON.stringify(record, null, 2)}\n`);

  process.stdout.write('\n=== the note, verbatim ===\n');
  process.stdout.write(`rejected: ${JSON.stringify(record.step4.rejectedTitles)}\n`);
  process.stdout.write(`picked:   ${JSON.stringify(record.step4.pickedTitles)}\n`);
  process.stdout.write(`note:     ${JSON.stringify(record.step4.note)}\n`);
  process.stdout.write(`transcript: ${JSON.stringify(record.step4.transcript)}\n`);
  process.stdout.write(`model calls this run: ${turns.length}\n`);

  await ctx.close();
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length} passed, ${failed.length} failed\n`);
  process.exit(failed.length ? 1 : 0);
};

await main();
