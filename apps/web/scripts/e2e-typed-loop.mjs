/**
 * The demo loop, driven the way it will be driven on camera — by typing.
 *
 * Section 9 of the brief, in the brief's own order, on the deployed build:
 *
 *   1. the sofa instruction, typed, with the mic never touched
 *   2. X on two works and P on one, and the flags stay
 *   3. Enter on an empty bar — the board redeals, and no model is called
 *   4. the agent's next note names *what* was thrown out, not that something was
 *   5. compare_artworks, and choosing resolving to a pick and a reject
 *   6. the deal animates and the picks hold their place
 *
 * Three rules this script holds itself to, because each is how an earlier
 * report came to claim more than it had:
 *
 * - **No Escape, no clicks to wake the page.** The culling keys are pressed on
 *   the page as it arrives from a cold load. A harness that presses Escape
 *   first is testing a page nobody will be filming.
 * - **"No model call" is counted off the wire**, not inferred from the UI. Every
 *   request the page makes during the redeal window is recorded and written out
 *   verbatim, so the claim can be re-read rather than trusted.
 * - **The animation is only scored if the board actually changed.** Sampling
 *   positions after a no-op measures the page settling.
 *
 * Two positions are recorded for every card on every frame: against the
 * viewport, and against the deal grid's own box. They answer different
 * questions. A card can hold its slot in the grid while the whole grid slides
 * underneath it — which on video reads as everything moving — and only the
 * pair of numbers tells those apart.
 *
 *   node apps/web/scripts/e2e-typed-loop.mjs <baseUrl> <outDir> [phase]
 *
 * phase: `all` (default), or `notes` for just the three §9 note runs.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e-typed';
const PHASE = process.argv[4] ?? 'all';

const BAR = 'input[aria-label="Ask the agent"]';
const CARD = '.paillette-card';
const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';

mkdirSync(OUT, { recursive: true });
mkdirSync(`${OUT}/shots`, { recursive: true });

const log = [];
let failed = 0;
const say = (ok, label, detail = '') => {
  if (ok === false) failed += 1;
  const line = `${ok === null ? 'NOTE' : ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`;
  log.push(line);
  console.log(line);
};
const save = (name, value) =>
  writeFileSync(`${OUT}/${name}`, typeof value === 'string' ? value : JSON.stringify(value, null, 2));

/** Every card on the board, with both positions and its full flag state. */
const board = (page) =>
  page.$$eval(CARD, (cards) => {
    const grid = document.querySelector('.lt-deal-viewport');
    const g = grid ? grid.getBoundingClientRect() : { x: 0, y: 0 };
    return cards.map((card, index) => {
      const r = card.getBoundingClientRect();
      return {
        index,
        id: card.getAttribute('data-artwork-id'),
        flag: card.getAttribute('data-flag'),
        by: card.getAttribute('data-flag-by'),
        provisional: card.getAttribute('data-flag-provisional'),
        title: card.getAttribute('data-artwork-title') ?? card.querySelector('img')?.alt ?? null,
        viewport: { x: Math.round(r.x), y: Math.round(r.y) },
        grid: { x: Math.round(r.x - g.x), y: Math.round(r.y - g.y) },
      };
    });
  });

/** The agent's sentence as rendered, verbatim, wherever on the page it sits. */
const noteText = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-board-note] .paillette-wall-label');
    return el
      ? { text: el.textContent.trim(), provenance: el.getAttribute('data-provenance') }
      : null;
  });

/** The tool calls the page's own activity log shows for this session. */
const beats = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.pa-activity-row')].map((row) => ({
      name: row.querySelector('.pa-activity-name')?.textContent?.trim() ?? null,
      text: row.textContent.trim().replace(/\s+/g, ' ').slice(0, 200),
      running: row.getAttribute('data-running'),
      bad: row.getAttribute('data-bad'),
    }))
  );

/** Park the pointer off the board. `.lt-slide:hover` lifts a card 2px. */
const parkPointer = (page) => page.mouse.move(5, 5);

const press = async (page, id, key) => {
  await page.hover(`${CARD}[data-artwork-id="${id}"]`);
  await page.waitForTimeout(160);
  await page.keyboard.press(key);
  await page.waitForTimeout(280);
};

/** Sample every card's position every animation frame for `ms`. */
const startSampling = (page, ms) =>
  page.evaluate((duration) => {
    window.__flip = [];
    const t0 = performance.now();
    const tick = () => {
      const now = performance.now() - t0;
      if (now > duration) return;
      const grid = document.querySelector('.lt-deal-viewport');
      const g = grid ? grid.getBoundingClientRect() : { x: 0, y: 0, height: 0 };
      window.__flip.push({
        t: Math.round(now),
        gridY: Math.round(g.y),
        gridH: Math.round(g.height ?? 0),
        cards: [...document.querySelectorAll('.paillette-card')].map((c) => {
          const r = c.getBoundingClientRect();
          return {
            id: c.getAttribute('data-artwork-id'),
            x: Math.round(r.x),
            y: Math.round(r.y),
            gx: Math.round(r.x - g.x),
            gy: Math.round(r.y - g.y),
          };
        }),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ms);

const readSamples = (page) => page.evaluate(() => window.__flip ?? []);

/**
 * How many distinct layouts the board passed through, keyed on card positions
 * *relative to the grid*. A real tween produces dozens; a jump cut four or five.
 */
const distinctLayouts = (frames, key) =>
  new Set(
    frames.map((f) =>
      f.cards
        .map((c) => (key === 'grid' ? `${c.id}:${c.gx},${c.gy}` : `${c.id}:${c.x},${c.y}`))
        .sort()
        .join('|')
    )
  ).size;

const newPage = async (browser, { recordNetwork = true } = {}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const wire = [];
  const errors = [];
  if (recordNetwork) {
    page.on('request', (r) => {
      const url = r.url();
      // Images are noise; everything else is the claim.
      if (/\.(png|jpe?g|webp|avif|gif|svg|woff2?|css|js|ico)(\?|$)/i.test(url)) return;
      wire.push({ t: Date.now(), method: r.method(), url });
    });
  }
  page.on('pageerror', (e) => errors.push(String(e)));
  return { context, page, wire, errors };
};

const modelCalls = (wire, since = 0) =>
  wire.filter((r) => r.t >= since && r.url.includes('/api/public-agent/turn') && r.method === 'POST');
const exemplarCalls = (wire, since = 0) =>
  wire.filter((r) => r.t >= since && r.url.includes('exemplars'));

/**
 * Type an instruction into the agent bar and submit it. Typed, character by
 * character, with the mic untouched — this is the whole point of the run.
 */
const typeAndSubmit = async (page, text) => {
  /*
   * Poll rather than assume. One note run died here with "the agent bar is not
   * on the page" after a flat 4.5s wait, and a bar that arrives at 9s and a bar
   * that never arrives are different defects needing different fixes. Waiting
   * longer here does not hide the slow case — e2e-mount-probe.mjs times the
   * arrival on cold loads and is the measurement of record for how often it
   * happens at all.
   */
  let bar = null;
  const t0 = Date.now();
  while (!bar && Date.now() - t0 < 25_000) {
    bar = await page.$(BAR);
    if (!bar) await page.waitForTimeout(500);
  }
  if (!bar) throw new Error(`the agent bar never appeared (waited ${Date.now() - t0}ms)`);
  if (Date.now() - t0 > 1000) say(null, 'the agent bar was late', `${Date.now() - t0}ms of polling`);
  await bar.click();
  await page.keyboard.type(text, { delay: 8 });
  const typed = await page.inputValue(BAR);
  if (typed !== text) {
    say(false, 'the bar holds the whole instruction', `got ${typed.length}/${text.length} chars`);
  }
  await page.keyboard.press('Enter');
};

/** Wait until the agent's note appears, or the timeout runs out. */
const waitForNote = async (page, timeoutMs = 90_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const n = await noteText(page);
    if (n?.text) return { ...n, ms: Date.now() - t0 };
    await page.waitForTimeout(500);
  }
  return null;
};

const waitForCards = async (page, min, timeoutMs = 60_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const n = await page.$$eval(CARD, (c) => c.length).catch(() => 0);
    if (n >= min) return n;
    await page.waitForTimeout(400);
  }
  return page.$$eval(CARD, (c) => c.length).catch(() => 0);
};

// ---------------------------------------------------------------------------

const runNoteCheck = async (browser, runIndex) => {
  const { context, page, wire, errors } = await newPage(browser);
  const record = { run: runIndex, errors: [] };
  try {
    await page.goto(`${BASE}/nga/search?webmcp-debug`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);

    // 1. the typed sofa instruction
    const t0 = Date.now();
    await typeAndSubmit(page, SOFA);
    const first = await waitForNote(page, 120_000);
    record.openingNote = first?.text ?? null;
    record.openingMs = first?.ms ?? null;
    record.openingModelCalls = modelCalls(wire, t0).length;
    await waitForCards(page, 4);
    await page.waitForTimeout(1500);
    await parkPointer(page);

    let cards = await board(page);
    record.boardAfterOpening = cards.map((c) => ({ id: c.id, title: c.title }));
    await page.screenshot({ path: `${OUT}/shots/notes-run${runIndex}-a-opening.png` });

    if (cards.length < 3) {
      record.error = `only ${cards.length} cards after the opening turn`;
      await context.close();
      return record;
    }

    // 2. X on two, P on one — the brief's exact flags
    const rejectIds = [cards[0].id, cards[1].id];
    const pickIds = [cards[2].id];
    for (const id of rejectIds) await press(page, id, 'x');
    for (const id of pickIds) await press(page, id, 'p');
    await parkPointer(page);
    await page.waitForTimeout(300);

    cards = await board(page);
    const at = (id) => cards.find((c) => c.id === id);
    record.flags = {
      rejects: rejectIds.map((id) => ({ id, title: at(id)?.title, flag: at(id)?.flag, by: at(id)?.by })),
      picks: pickIds.map((id) => ({ id, title: at(id)?.title, flag: at(id)?.flag, by: at(id)?.by })),
    };
    // What was actually rejected, in the catalogue's own words — this is what
    // the note has to talk about for §9's third clause to pass.
    record.rejectedRecords = await page.evaluate(async (ids) => {
      const ctx = await window.__paillette_webmcp.call('get_view_context', {});
      const flags = ctx?.flags ?? ctx?.result?.flags ?? {};
      const all = [].concat(flags.rejects ?? [], flags.rejected ?? [], flags.picks ?? []);
      return all.filter((f) => ids.includes(f.artworkId ?? f.id));
    }, rejectIds);
    await page.screenshot({ path: `${OUT}/shots/notes-run${runIndex}-b-flagged.png` });

    // 3+4. a typed follow-up, and the note it comes back with
    const t1 = Date.now();
    await typeAndSubmit(page, 'Try again from those.');
    const second = await waitForNote(page, 120_000);
    // The note element can still hold the previous sentence; wait for change.
    const t2 = Date.now();
    let changed = second;
    while (Date.now() - t2 < 120_000 && changed?.text === record.openingNote) {
      await page.waitForTimeout(700);
      changed = await noteText(page);
    }
    record.redealNote = changed?.text ?? null;
    record.redealMs = Date.now() - t1;
    record.redealModelCalls = modelCalls(wire, t1).length;
    record.beats = await beats(page);
    await parkPointer(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/shots/notes-run${runIndex}-c-note.png` });
  } catch (e) {
    record.error = String(e);
  }
  record.errors = errors;
  await context.close();
  return record;
};

// ---------------------------------------------------------------------------

const main = async () => {
  const browser = await chromium.launch();
  const evidence = {};

  if (PHASE === 'notes') {
    const runs = [];
    const first = Number(process.env.NOTE_RUN_FROM ?? 1);
    const last = Number(process.env.NOTE_RUN_TO ?? 3);
    for (let i = first; i <= last; i += 1) {
      console.log(`\n=== note run ${i} ===`);
      runs.push(await runNoteCheck(browser, i));
      save('note-runs.json', runs);
    }
    save('note-runs.json', runs);
    await browser.close();
    return;
  }

  const { context, page, wire, errors } = await newPage(browser);

  // ------------------------------------------------------- preflight A: mount
  await page.goto(`${BASE}/nga/search?webmcp-debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);

  const harness = await page.evaluate(() => ({
    driver: typeof window.__paillette_webmcp?.call === 'function',
    stubbed: window.__paillette_webmcp?.stubbed ?? null,
    host: Boolean(document.modelContext),
  }));
  const barPresent = Boolean(await page.$(BAR));
  say(harness.driver && barPresent,
    'preflight A — the in-page agent renders under ?webmcp-debug',
    `driver=${harness.driver} stubbed=${harness.stubbed} bar=${barPresent}`);
  const tools = await page.evaluate(async () =>
    (await window.__paillette_webmcp.tools()).map((t) => t.name ?? t));
  say(tools.length > 0, `document.modelContext carries ${tools.length} tools`);
  evidence.tools = tools;
  await page.screenshot({ path: `${OUT}/shots/00-cold-load.png` });

  // ------------------------------------------- step 1: the typed sofa prompt
  const t0 = Date.now();
  await typeAndSubmit(page, SOFA);
  await page.screenshot({ path: `${OUT}/shots/01-instruction-typed.png` });
  const openingNote = await waitForNote(page, 120_000);
  const openingCards = await waitForCards(page, 4);
  await page.waitForTimeout(1500);
  await parkPointer(page);
  say(Boolean(openingNote?.text),
    'step 1 — a typed instruction alone brings back a board with a written note',
    `${openingCards} cards, note in ${openingNote?.ms ?? '—'}ms, ${modelCalls(wire, t0).length} model calls`);
  evidence.step1 = {
    instruction: SOFA,
    note: openingNote?.text ?? null,
    noteProvenance: openingNote?.provenance ?? null,
    msToNote: openingNote?.ms ?? null,
    cards: openingCards,
    modelCalls: modelCalls(wire, t0).length,
    beats: await beats(page),
  };
  await page.screenshot({ path: `${OUT}/shots/02-board-and-note.png`, fullPage: false });
  save('step1.json', evidence.step1);

  let cards = await board(page);
  if (cards.length < 4) {
    say(false, 'the opening board has enough works to flag', `${cards.length} cards`);
    save('log.txt', log.join('\n'));
    await context.close();
    await browser.close();
    process.exit(1);
  }

  // ------------------------------------------------ step 2: X on two, P on one
  const focusAfterDeal = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? null,
    label: document.activeElement?.getAttribute?.('aria-label') ?? null,
  }));
  say(focusAfterDeal.tag !== 'INPUT' || focusAfterDeal.label === 'Ask the agent',
    'no catalogue text field is eating the culling keys',
    JSON.stringify(focusAfterDeal));

  const rejectIds = [cards[0].id, cards[1].id];
  const pickIds = [cards[2].id];
  for (const id of rejectIds) await press(page, id, 'x');
  for (const id of pickIds) await press(page, id, 'p');
  await parkPointer(page);
  await page.waitForTimeout(400);

  cards = await board(page);
  const at = (id) => cards.find((c) => c.id === id);
  const rejectsOk = rejectIds.every((id) => at(id)?.flag === 'reject');
  const picksOk = pickIds.every((id) => at(id)?.flag === 'pick');
  say(rejectsOk, 'step 2 — X on two works rejects them, with no Escape first',
    rejectIds.map((id) => `${id}=${at(id)?.flag}/${at(id)?.by}`).join(' '));
  say(picksOk, 'step 2 — P on one work picks it',
    pickIds.map((id) => `${id}=${at(id)?.flag}/${at(id)?.by}`).join(' '));

  const ctx = await page.evaluate(() => window.__paillette_webmcp.call('get_view_context', {}));
  save('view-context-after-flags.json', ctx);
  // `flags` is `{ picks: [...], rejects: [...], provisional: [...] }`, and each
  // entry carries the catalogue record — title, artist, medium, year, palette.
  // That grounding is what §9's third clause needs to be possible at all, so
  // check the entries rather than the word "pick" appearing somewhere.
  const f = ctx?.flags ?? {};
  const flagIds = [...(f.picks ?? []), ...(f.rejects ?? [])].map((x) => x.id);
  say(rejectIds.every((id) => flagIds.includes(id)) && pickIds.every((id) => flagIds.includes(id)),
    'step 2 — get_view_context hands all three flags back, with their catalogue records',
    `picks=${(f.picks ?? []).length} rejects=${(f.rejects ?? []).length} provisional=${(f.provisional ?? []).length}; ` +
    `fields on a reject: ${Object.keys((f.rejects ?? [])[0] ?? {}).join(',')}`);

  // Visible, not just in the DOM: the flag has to be painted.
  const painted = await page.evaluate((ids) =>
    ids.map((id) => {
      const card = document.querySelector(`.paillette-card[data-artwork-id="${id}"]`);
      if (!card) return { id, present: false };
      const badge = card.querySelector('[data-flag-badge], .lt-flag-badge, [class*="flag"]');
      const cs = getComputedStyle(card);
      return {
        id,
        present: true,
        flag: card.getAttribute('data-flag'),
        outline: cs.outlineColor + ' ' + cs.outlineWidth,
        borderColor: cs.borderColor,
        opacity: cs.opacity,
        badgeText: badge?.textContent?.trim()?.slice(0, 40) ?? null,
      };
    }), [...rejectIds, ...pickIds]);
  save('flags-painted.json', painted);
  say(painted.every((p) => p.present), 'step 2 — the flagged cards are on screen', JSON.stringify(painted).slice(0, 300));
  await page.screenshot({ path: `${OUT}/shots/03-flags-xxp.png` });

  evidence.step2 = {
    rejects: rejectIds.map((id) => ({ id, title: at(id)?.title, flag: at(id)?.flag, by: at(id)?.by })),
    picks: pickIds.map((id) => ({ id, title: at(id)?.title, flag: at(id)?.flag, by: at(id)?.by })),
    painted,
  };
  save('step2.json', evidence.step2);

  // ----------------------------------- step 3 + 6: Enter on an empty bar
  const before = cards.map((c) => c.id);
  const pickBefore = Object.fromEntries(
    cards.filter((c) => pickIds.includes(c.id)).map((c) => [c.id, { viewport: c.viewport, grid: c.grid }]));
  const tRedeal = Date.now();
  const wireMark = wire.length;

  await startSampling(page, 6000);
  const bar = await page.$(BAR);
  await bar.click();
  const barValue = await page.inputValue(BAR);
  say(barValue === '', 'step 3 — the bar is empty before Enter', JSON.stringify(barValue));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/shots/04-redeal-midflight.png` });
  await page.waitForTimeout(6000);
  await parkPointer(page);
  await page.waitForTimeout(600);

  const frames = await readSamples(page);
  const redealWire = wire.slice(wireMark);
  save('redeal-wire.json', redealWire);
  const mc = modelCalls(wire, tRedeal);
  const ex = exemplarCalls(wire, tRedeal);
  say(mc.length === 0,
    'step 3 — Enter on an empty bar made NO model call',
    `POST /api/public-agent/turn × ${mc.length}; every request in the window: ${redealWire.map((r) => `${r.method} ${new URL(r.url).pathname}`).join(', ') || '(none)'}`);
  say(ex.length >= 1, 'step 3 — it reached the deterministic exemplar engine instead',
    `${ex.length} call(s) to ${ex[0] ? new URL(ex[0].url).pathname : '—'}`);

  cards = await board(page);
  const after = cards.map((c) => c.id);
  const arrived = after.filter((id) => !before.includes(id));
  const left = before.filter((id) => !after.includes(id));
  say(arrived.length > 0 || left.length > 0, 'step 3 — the board redealt',
    `${left.length} left, ${arrived.length} arrived, ${after.length} on the board`);

  const stillPicked = pickIds.filter((id) => cards.find((c) => c.id === id)?.flag === 'pick');
  say(stillPicked.length === pickIds.length, 'step 3 — the picks are still on the board, still picked',
    `${stillPicked.length}/${pickIds.length}`);
  const rejectsGone = rejectIds.filter((id) => !after.includes(id));
  say(rejectsGone.length === rejectIds.length, 'step 3 — the rejects left the board',
    `${rejectsGone.length}/${rejectIds.length}`);

  const pickAfter = Object.fromEntries(
    cards.filter((c) => pickIds.includes(c.id)).map((c) => [c.id, { viewport: c.viewport, grid: c.grid }]));

  // step 6 — the animation, and whether the picks visibly hold
  const changed = arrived.length > 0 || left.length > 0;
  const layoutsGrid = distinctLayouts(frames, 'grid');
  const layoutsViewport = distinctLayouts(frames, 'viewport');
  const gridTops = [...new Set(frames.map((f) => f.gridY))];
  say(changed && layoutsGrid > 8,
    'step 6 — the deal animates on /nga/search (positions inside the grid)',
    `${layoutsGrid} distinct layouts over ${frames.length} frames; a jump cut is 4-5`);
  const heldGrid = pickIds.filter(
    (id) => pickBefore[id] && pickAfter[id] &&
      pickBefore[id].grid.x === pickAfter[id].grid.x && pickBefore[id].grid.y === pickAfter[id].grid.y);
  const heldViewport = pickIds.filter(
    (id) => pickBefore[id] && pickAfter[id] &&
      pickBefore[id].viewport.x === pickAfter[id].viewport.x &&
      pickBefore[id].viewport.y === pickAfter[id].viewport.y);
  say(heldGrid.length === pickIds.length,
    'step 6 — the picks hold their seat in the grid',
    JSON.stringify({ before: pickBefore, after: pickAfter }));
  say(heldViewport.length === pickIds.length,
    'step 6 — the picks hold their place ON SCREEN (what the camera sees)',
    `grid top moved through ${JSON.stringify(gridTops.slice(0, 12))}`);

  save('flip-frames.json', { frames: frames.length, layoutsGrid, layoutsViewport, gridTops, sample: frames.filter((_, i) => i % 10 === 0) });
  evidence.step3 = {
    barEmpty: barValue === '',
    modelCalls: mc.length,
    exemplarCalls: ex.length,
    requestsInWindow: redealWire.map((r) => `${r.method} ${new URL(r.url).pathname}`),
    left, arrived, boardSize: after.length,
    pickBefore, pickAfter,
    layoutsGrid, layoutsViewport, frames: frames.length, gridTops,
  };
  save('step3.json', evidence.step3);
  await page.screenshot({ path: `${OUT}/shots/05-redealt.png` });

  // --------------------------------------------------------- step 5: compare
  const compareIds = cards.slice(0, 2).map((c) => c.id);
  const tCompare = Date.now();
  const compareRes = await page.evaluate((ids) =>
    window.__paillette_webmcp.call('compare_artworks', {
      artworkIds: ids,
      question: 'Which one sits better above a sofa?',
    }), compareIds);
  await page.waitForTimeout(1800);
  const compareOpen = await page.evaluate(() => {
    const room = document.querySelector('[data-compare-room]');
    if (!room) return { open: false };
    const r = room.getBoundingClientRect();
    return {
      open: true,
      question: room.querySelector('p')?.textContent?.trim() ?? null,
      askedBy: room.getAttribute('data-asked-by'),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      works: [...room.querySelectorAll('button[data-side]')].map((b) => ({
        side: b.getAttribute('data-side'), id: b.getAttribute('data-artwork-id'),
      })),
    };
  });
  save('compare-open.json', { compareRes, compareOpen });
  say(compareOpen.open && compareOpen.works?.length === 2,
    'step 5 — compare_artworks opens the two-up as a room',
    JSON.stringify(compareOpen).slice(0, 400));
  await page.screenshot({ path: `${OUT}/shots/06-two-up.png` });

  // Choose the left work the way a human does: the whole work is the target.
  const chose = { side: compareOpen.works?.[0]?.side ?? null };
  if (chose.side) await page.click(`[data-compare-room] button[data-side="${chose.side}"]`);
  await page.waitForTimeout(2500);
  const afterCompare = await board(page);
  const compareFlags = compareIds.map((id) => {
    const c = afterCompare.find((x) => x.id === id);
    return { id, flag: c?.flag ?? '(off board)', by: c?.by ?? null };
  });
  const compareTurns = modelCalls(wire, tCompare).length;
  say(compareFlags.some((f) => f.flag === 'pick') && compareFlags.some((f) => f.flag === 'reject'),
    'step 5 — choosing resolves to one pick and one reject',
    JSON.stringify(compareFlags));
  // Not scored here. `resolveCompare` (turn.ts:111) records the choice and lets
  // it ride the next turn on purpose — "flags never trigger the agent". Whether
  // it reaches the agent at all is a question about the *next* turn's body, and
  // e2e-compare-probe.mjs reads that body rather than counting requests.
  say(null, 'step 5 — the click itself fires no model turn (by design)',
    `${compareTurns} POST /api/public-agent/turn since the two-up opened`);
  evidence.step5 = { compareIds, compareRes, compareOpen, chose, compareFlags, compareTurns };
  save('step5.json', evidence.step5);
  await page.screenshot({ path: `${OUT}/shots/07-after-compare.png` });

  say(errors.length === 0, 'no uncaught page errors across the walk', errors.join(' | ').slice(0, 400));

  save('wire.json', wire.map((r) => ({ method: r.method, url: r.url })));
  save('log.txt', log.join('\n') + `\n\n${failed} failed\n`);
  save('evidence.json', evidence);
  console.log(`\n${log.filter((l) => l.startsWith('PASS')).length} passed, ${failed} failed`);

  await context.close();
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
};

main().catch((e) => {
  console.error(e);
  save('log.txt', log.join('\n') + `\n\nCRASH: ${e.stack}\n`);
  process.exit(2);
});
