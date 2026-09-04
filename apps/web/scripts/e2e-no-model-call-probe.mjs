/**
 * The one claim the submission rests on: Enter on an empty bar calls no model.
 *
 * A first walk measured 0 model calls in the redeal window and a second walk
 * measured 1, which is the difference between a submission and an embarrassment
 * — so neither number is worth anything until the question is asked properly.
 *
 * The trouble with counting requests "in the window" is that the opening turn
 * is a *chain*: the agent calls a tool, the page answers, the agent is invoked
 * again. That chain is still firing POSTs long after its sentence has appeared
 * on screen, and a POST that lands 200ms before the Enter keypress is
 * indistinguishable, to a counter, from one the Enter caused.
 *
 * So this does three things the walk does not:
 *
 *   1. **Waits for silence.** It does not press Enter until the page has made
 *      no request to the model endpoint for QUIET_MS consecutive milliseconds.
 *      Everything after that point is attributable to the keypress.
 *   2. **Times from the keypress**, not from a mark taken some tool calls
 *      earlier, so "before" and "after" are not a judgement call.
 *   3. **Reads the body** of any model turn it does see. A turn carrying the
 *      original typed sentence is the opening chain finishing; a turn carrying
 *      only a flagsDelta would be Enter genuinely reaching the model.
 *
 * It also samples the deal for 12s rather than 6s. The second walk reported
 * "1 distinct layout" — no animation at all — on a run where the exemplars
 * call did not even return until 6.2s, so the sampler had stopped before the
 * board moved. That was the ruler, not the board.
 *
 *   node apps/web/scripts/e2e-no-model-call-probe.mjs <baseUrl> <n> <outDir>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const N = Number(process.argv[3] ?? 3);
const OUT = process.argv[4] ?? '/tmp/e2e6/nomodel';
const BAR = 'input[aria-label="Ask the agent"]';
const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';
/** How long the model endpoint must be silent before the Enter is attributable. */
const QUIET_MS = 20_000;
const SAMPLE_MS = 12_000;

mkdirSync(`${OUT}/shots`, { recursive: true });
const save = (n, v) => writeFileSync(`${OUT}/${n}`, typeof v === 'string' ? v : JSON.stringify(v, null, 2));

const runOnce = async (browser, i) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const wire = [];
  page.on('request', (r) => {
    const url = r.url();
    if (/\.(png|jpe?g|webp|avif|gif|svg|woff2?|css|js|ico)(\?|$)/i.test(url)) return;
    const entry = { t: Date.now(), method: r.method(), path: new URL(url).pathname };
    if (r.method() === 'POST' && url.includes('/api/public-agent/turn')) {
      entry.isModel = true;
      try {
        const b = JSON.parse(r.postData() ?? 'null');
        const msgs = b?.messages ?? [];
        entry.turnSummary = {
          messageCount: msgs.length,
          firstUserText: msgs.find((m) => m.role === 'user')?.content?.slice?.(0, 90) ?? null,
          // A turn the Enter caused would be a fresh human turn: no assistant
          // messages behind it, because nothing has been said since.
          assistantMessages: msgs.filter((m) => m.role === 'assistant').length,
          toolMessages: msgs.filter((m) => m.role === 'tool').length,
        };
      } catch { entry.turnSummary = { unparsed: true }; }
    }
    wire.push(entry);
  });

  const run = { run: i };
  try {
    await page.goto(`${BASE}/nga/search?webmcp-debug`, { waitUntil: 'domcontentloaded' });
    let bar = null;
    const tBar = Date.now();
    while (!bar && Date.now() - tBar < 25_000) {
      bar = await page.$(BAR);
      if (!bar) await page.waitForTimeout(400);
    }
    if (!bar) throw new Error('the agent bar never appeared');

    await bar.click();
    await page.keyboard.type(SOFA, { delay: 8 });
    await page.keyboard.press('Enter');

    // Wait for a board, then for the model endpoint to go quiet.
    for (let k = 0; k < 150 && (await page.$$('.paillette-card')).length < 4; k += 1) {
      await page.waitForTimeout(1000);
    }
    run.openingCards = (await page.$$('.paillette-card')).length;
    run.openingModelCalls = wire.filter((r) => r.isModel).length;

    const tQuietStart = Date.now();
    let lastModel = () => Math.max(0, ...wire.filter((r) => r.isModel).map((r) => r.t));
    while (Date.now() - lastModel() < QUIET_MS && Date.now() - tQuietStart < 180_000) {
      await page.waitForTimeout(1000);
    }
    run.quietWaitMs = Date.now() - tQuietStart;
    run.modelCallsBeforeQuiet = wire.filter((r) => r.isModel).length;
    run.reachedSilence = Date.now() - lastModel() >= QUIET_MS;

    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);

    // Flag: X on two, P on one.
    const ids = await page.$$eval('.paillette-card', (c) =>
      c.slice(0, 3).map((x) => x.getAttribute('data-artwork-id')));
    for (const [k, id] of ids.entries()) {
      await page.hover(`.paillette-card[data-artwork-id="${id}"]`);
      await page.waitForTimeout(160);
      await page.keyboard.press(k === 2 ? 'p' : 'x');
      await page.waitForTimeout(260);
    }
    const pickId = ids[2];
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    run.modelCallsAfterFlagging = wire.filter((r) => r.isModel).length;

    const posBefore = await page.evaluate((id) => {
      const grid = document.querySelector('.lt-deal-viewport');
      const g = grid ? grid.getBoundingClientRect() : { x: 0, y: 0 };
      const c = document.querySelector(`.paillette-card[data-artwork-id="${id}"]`);
      const r = c.getBoundingClientRect();
      return { viewport: { x: Math.round(r.x), y: Math.round(r.y) },
        grid: { x: Math.round(r.x - g.x), y: Math.round(r.y - g.y) }, gridTop: Math.round(g.y) };
    }, pickId);
    const idsBefore = await page.$$eval('.paillette-card', (c) =>
      c.map((x) => x.getAttribute('data-artwork-id')));

    // ------------------------------------------------------ the keypress
    await page.evaluate((duration) => {
      window.__flip = [];
      const t0 = performance.now();
      const tick = () => {
        const now = performance.now() - t0;
        if (now > duration) return;
        const grid = document.querySelector('.lt-deal-viewport');
        const g = grid ? grid.getBoundingClientRect() : { x: 0, y: 0 };
        window.__flip.push({
          t: Math.round(now), gridY: Math.round(g.y),
          cards: [...document.querySelectorAll('.paillette-card')].map((c) => {
            const r = c.getBoundingClientRect();
            return { id: c.getAttribute('data-artwork-id'),
              gx: Math.round(r.x - g.x), gy: Math.round(r.y - g.y),
              x: Math.round(r.x), y: Math.round(r.y) };
          }),
        });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, SAMPLE_MS);

    const barEl = await page.$(BAR);
    await barEl.click();
    run.barValue = await page.inputValue(BAR);
    const tEnter = Date.now();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(SAMPLE_MS + 3000);

    const after = wire.filter((r) => r.t >= tEnter);
    run.tEnter = tEnter;
    run.requestsAfterEnter = after.map((r) => ({
      msAfterEnter: r.t - tEnter, method: r.method, path: r.path,
      ...(r.isModel ? { MODEL: true, turnSummary: r.turnSummary } : {}),
    }));
    run.modelCallsAfterEnter = after.filter((r) => r.isModel).length;
    run.exemplarCallsAfterEnter = after.filter((r) => r.path.includes('exemplars')).length;

    const frames = await page.evaluate(() => window.__flip ?? []);
    const layouts = new Set(frames.map((f) =>
      f.cards.map((c) => `${c.id}:${c.gx},${c.gy}`).sort().join('|'))).size;
    const idsAfter = await page.$$eval('.paillette-card', (c) =>
      c.map((x) => x.getAttribute('data-artwork-id')));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    const posAfter = await page.evaluate((id) => {
      const grid = document.querySelector('.lt-deal-viewport');
      const g = grid ? grid.getBoundingClientRect() : { x: 0, y: 0 };
      const c = document.querySelector(`.paillette-card[data-artwork-id="${id}"]`);
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { viewport: { x: Math.round(r.x), y: Math.round(r.y) },
        grid: { x: Math.round(r.x - g.x), y: Math.round(r.y - g.y) }, gridTop: Math.round(g.y) };
    }, pickId);

    run.board = {
      arrived: idsAfter.filter((id) => !idsBefore.includes(id)).length,
      left: idsBefore.filter((id) => !idsAfter.includes(id)).length,
      size: idsAfter.length,
    };
    run.animation = { frames: frames.length, layouts, gridTops: [...new Set(frames.map((f) => f.gridY))] };
    run.pick = { id: pickId, before: posBefore, after: posAfter };
    await page.screenshot({ path: `${OUT}/shots/n${i}-after-redeal.png` });
  } catch (e) {
    run.error = String(e);
  }
  await context.close();
  return run;
};

const main = async () => {
  const browser = await chromium.launch();
  const runs = [];
  for (let i = 1; i <= N; i += 1) {
    console.log(`\n=== run ${i} ===`);
    const r = await runOnce(browser, i);
    runs.push(r);
    save('runs.json', runs);
    if (r.error) { console.log('  ERROR', r.error); continue; }
    console.log(`  opening: ${r.openingCards} cards, ${r.openingModelCalls} model calls`);
    console.log(`  waited ${Math.round(r.quietWaitMs / 1000)}s for silence; reached it: ${r.reachedSilence}`);
    console.log(`  flagging fired ${r.modelCallsAfterFlagging - r.modelCallsBeforeQuiet} model calls`);
    console.log(`  bar value at Enter: ${JSON.stringify(r.barValue)}`);
    console.log(`  MODEL CALLS AFTER ENTER: ${r.modelCallsAfterEnter}   exemplar calls: ${r.exemplarCallsAfterEnter}`);
    for (const q of r.requestsAfterEnter) {
      console.log(`    +${String(q.msAfterEnter).padStart(6)}ms  ${q.method} ${q.path}${q.MODEL ? '   <-- MODEL ' + JSON.stringify(q.turnSummary) : ''}`);
    }
    console.log(`  board: ${r.board.left} left, ${r.board.arrived} arrived, ${r.board.size} on the board`);
    console.log(`  animation: ${r.animation.layouts} layouts over ${r.animation.frames} frames, grid tops ${JSON.stringify(r.animation.gridTops)}`);
    console.log(`  pick: ${JSON.stringify(r.pick.before)} -> ${JSON.stringify(r.pick.after)}`);
  }

  const good = runs.filter((r) => !r.error);
  console.log(`\n=== ${good.filter((r) => r.modelCallsAfterEnter === 0).length}/${good.length} runs: Enter on an empty bar made zero model calls ===`);
  save('runs.json', runs);
  await browser.close();
};

main().catch((e) => { console.error(e); process.exit(2); });
