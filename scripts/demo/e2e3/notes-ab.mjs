/**
 * §9's third clause, both ways round, because §9's wording allows both:
 *
 *   "Given the sofa prompt and two X presses, the agent's redeal note refers
 *    to the *content* of what was rejected."
 *
 *   A — instruction, then flags, then Enter, then a neutral nudge.
 *       This is the brief's own step order. The nudge is "again": it carries
 *       no content, so anything the note says about the rejects came from the
 *       flags rather than from the sentence.
 *
 *   B — flags first, then the sofa instruction. The gestures and the words
 *       arrive on the same turn, which is the shape the "you said warm; you
 *       picked the cool ones" behaviour was written for — the note needs a
 *       *said* to contrast the *chose* against.
 *
 * Prints the rejected works in full and the note verbatim, per run, so the
 * "content" judgement is made by a human against the evidence.
 *
 *   node scripts/demo/e2e3/notes-ab.mjs <A|B> [runs] [baseUrl]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../browser.mjs';

const MODE = (process.argv[2] ?? 'B').toUpperCase();
const RUNS = Number(process.argv[3] ?? 3);
const BASE = process.argv[4] ?? 'https://paillette-stg.berlayar.ai';
const OUT = path.resolve('docs/night/e2e-evidence/iteration-3');
const SHOTS = path.resolve('docs/night/shots');

const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';

const BAR = 'input[aria-label="Ask the agent"]';
const CARD = 'article.paillette-card';
const NOTE = '.paillette-wall-label';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitForTurn = async (page, deadline = 240_000) => {
  const t0 = Date.now();
  const working = () => !!document.querySelector('button[aria-label="Working"]');
  try {
    await page.waitForFunction(working, { timeout: 30_000 });
  } catch {
    // The turn may have finished inside 30s, or never started. Either way the
    // wait below settles it; this one is only here to avoid returning before
    // the turn has begun.
  }
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Working"]'), {
    timeout: deadline,
  });
  return Date.now() - t0;
};

const readNote = (page) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el
      ? { text: el.textContent.trim(), provenance: el.getAttribute('data-provenance') }
      : null;
  }, NOTE);

const flagTwo = async (page) => {
  const ids = await page.evaluate(
    (sel) => [...document.querySelectorAll(sel)].map((el) => el.getAttribute('data-artwork-id')),
    CARD
  );
  const rejects = ids.slice(0, 2);
  for (const id of rejects) {
    const el = page.locator(`${CARD}[data-artwork-id="${id}"]`).first();
    await el.scrollIntoViewIfNeeded();
    await el.hover();
    await sleep(150);
    await page.keyboard.press('x');
    await sleep(300);
  }
  await sleep(500);
  const view = await page.evaluate(
    async () => await window.__paillette_webmcp.call('get_view_context', {})
  );
  return (view?.flags?.rejects ?? []).map((r) => ({
    id: r.id, title: r.title, artist: r.artist, medium: r.medium,
    year: r.year, classification: r.classification, palette: r.palette,
  }));
};

await mkdir(OUT, { recursive: true });
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch();
const runs = [];

for (let i = 1; i <= RUNS; i += 1) {
  console.log(`\n============ mode ${MODE} · run ${i} ============`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const wire = [];
  const turnBodies = [];
  page.on('request', (r) => {
    wire.push({ method: r.method(), url: r.url() });
    if (r.method() === 'POST' && r.url().includes('/public-agent/turn')) {
      try {
        const b = JSON.parse(r.postData() ?? 'null');
        turnBodies.push({
          hasTurn: !!b?.turn,
          text: b?.turn?.text ?? null,
          flagsDelta: (b?.turn?.flagsDelta ?? []).map((f) => `${f.to}:${f.title ?? f.artworkId}`),
          messageCount: b?.messages?.length ?? null,
        });
      } catch {
        turnBodies.push({ unparsed: true });
      }
    }
  });

  const responses = [];
  page.on('response', async (res) => {
    if (!res.url().includes('/public-agent/turn')) return;
    let body = null;
    try { body = (await res.text()).slice(0, 400); } catch { body = '<unreadable>'; }
    responses.push({ status: res.status(), body });
  });

  const run = { mode: MODE, run: i };
  try {
    await page.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`, {
      waitUntil: 'domcontentloaded', timeout: 120_000,
    });
    await page.waitForSelector(CARD, { timeout: 120_000 });

    if (MODE === 'A') {
      await page.click(BAR);
      await page.type(BAR, SOFA, { delay: 5 });
      await page.press(BAR, 'Enter');
      run.openingTurnMs = await waitForTurn(page);
      await sleep(1500);
      run.openingNote = await readNote(page);
      console.log(`opening note: ${JSON.stringify(run.openingNote?.text ?? null)}`);

      run.rejected = await flagTwo(page);
      const mark = wire.length;
      await page.click(BAR);
      await page.press(BAR, 'Enter');
      await sleep(6000);
      run.redealModelCalls = wire.slice(mark)
        .filter((r) => r.method === 'POST' && r.url.includes('/public-agent/turn')).length;
      console.log(`redeal model calls: ${run.redealModelCalls}`);

      await page.click(BAR);
      await page.type(BAR, 'again', { delay: 15 });
      await page.press(BAR, 'Enter');
      run.turnMs = await waitForTurn(page);
      run.instruction = 'again';
    } else {
      run.rejected = await flagTwo(page);
      await page.click(BAR);
      await page.type(BAR, SOFA, { delay: 5 });
      await page.press(BAR, 'Enter');
      run.turnMs = await waitForTurn(page);
      run.instruction = SOFA;
    }

    await sleep(1500);
    run.note = await readNote(page);
    run.requests = turnBodies;
    run.responses = responses;
    const bad = responses.filter((r) => r.status !== 200);
    if (bad.length) console.log(`NON-200 turn responses: ${JSON.stringify(bad)}`);
    console.log('rejected:');
    for (const r of run.rejected) {
      console.log(`   "${r.title}" — ${r.artist}, ${r.year}, ${r.medium}, ${(r.palette ?? []).join(' ')}`);
    }
    console.log(`NOTE: ${JSON.stringify(run.note?.text ?? null)}   (${run.turnMs}ms)`);
    console.log(`gestures on request: ${turnBodies.map((t, n) => (t.hasTurn ? n : null)).filter((n) => n !== null).join(',')} of ${turnBodies.length}`);
    await page.screenshot({ path: path.join(SHOTS, `e2e3-08-note-${MODE}${i}.png`) });
    run.shot = `docs/night/shots/e2e3-08-note-${MODE}${i}.png`;
  } catch (e) {
    run.error = e.message.split('\n').slice(0, 2).join(' | ');
    run.requests = turnBodies;
    run.responses = responses;
    console.log(`turn responses: ${JSON.stringify(responses)}`);
    console.log(`ERROR: ${run.error}`);
    await page.screenshot({ path: path.join(SHOTS, `e2e3-08-note-${MODE}${i}-error.png`) }).catch(() => {});
  }
  runs.push(run);
  await ctx.close();
}

const file = path.join(OUT, `notes-${MODE}.json`);
await writeFile(file, JSON.stringify(runs, null, 2));
await browser.close();

console.log(`\n======== mode ${MODE}: all notes verbatim ========`);
for (const r of runs) {
  console.log(`\nrun ${r.run}  (instruction: ${JSON.stringify(r.instruction ?? null)})`);
  console.log(`  rejected: ${(r.rejected ?? []).map((x) => `"${x.title}"`).join(', ')}`);
  console.log(`  note:     ${JSON.stringify(r.note?.text ?? r.error ?? null)}`);
}
