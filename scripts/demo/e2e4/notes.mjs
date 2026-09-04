/**
 * §9's third clause, by hand, three times:
 *
 *   "Given the sofa prompt and two X presses, the agent's redeal note refers
 *    to the *content* of what was rejected."
 *
 * One run is: fresh browser context → type the sofa instruction → X two works
 * off the board the agent dealt → Enter on an empty bar (the deterministic
 * redeal, no model) → then one neutral typed nudge, so the agent's *next* note
 * is written with the rejects in view.
 *
 * The nudge is deliberately empty of content — "again" — because a nudge that
 * named what to avoid would be the check answering itself. Whatever the note
 * says about the rejects has to have come from the flags.
 *
 * Prints, per run: the two rejected works in full (title, artist, palette,
 * medium, year) and the note verbatim, so a human can judge "content" rather
 * than trust a regex.
 *
 * Paced deliberately. The NGA public-search limiter admits **ten searches per
 * minute per client** (measured: `scripts/demo/e2e4/search-burst.mjs` got 10
 * accepted and 4 refused out of 14 fired at once, `retry-after: 56`), and it
 * covers `/text`, `/color` *and* `/exemplars`. One agent turn spends four to
 * eight of those ten. An unpaced version of this script refused a `redeal`
 * mid-run — `REDEAL_FAILED: "Too many NGA public searches; try again shortly"` —
 * and then failed to load a page at all. So there is a wait between the opening
 * turn and the nudge, and another between runs, which is also what a human
 * moving between beats on camera would do.
 *
 *   node scripts/demo/e2e4/notes.mjs [baseUrl] [runs]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const RUNS = Number(process.argv[3] ?? 3);
const OUT = path.resolve('docs/night/e2e-evidence/iteration-4');
const SHOTS = path.resolve('docs/night/shots/e2e4');

const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';
const NUDGE = 'again';
/** Long enough for the limiter's one-minute bucket to roll over. */
const BUCKET_MS = 65_000;

const BAR = 'input[aria-label="Ask the agent"]';
const CARD = 'article.paillette-card';
const NOTE = '.paillette-wall-label';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitForTurn = async (page, deadline = 180_000) => {
  const t0 = Date.now();
  await page
    .waitForFunction(() => !!document.querySelector('button[aria-label="Working"]'), {
      timeout: 30_000,
    })
    .catch(() => {});
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="Working"]'),
    { timeout: deadline }
  );
  return Date.now() - t0;
};

const readNote = (page) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el
      ? { text: el.textContent.trim(), provenance: el.getAttribute('data-provenance') }
      : null;
  }, NOTE);

await mkdir(OUT, { recursive: true });
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch();
const runs = [];

for (let i = 1; i <= RUNS; i += 1) {
  console.log(`\n================ run ${i} ================`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const turnBodies = [];
  const wire = [];
  page.on('request', (r) => {
    wire.push({ method: r.method(), url: r.url() });
    if (r.method() === 'POST' && r.url().includes('/public-agent/turn')) {
      try {
        turnBodies.push(JSON.parse(r.postData() ?? 'null'));
      } catch {
        turnBodies.push({ unparsed: (r.postData() ?? '').slice(0, 400) });
      }
    }
  });

  const run = { run: i, base: BASE };
  try {
    await page.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    await page.waitForSelector(CARD, { timeout: 120_000 });

    // 1 — the sofa instruction, typed
    await page.click(BAR);
    await page.type(BAR, SOFA, { delay: 5 });
    await page.press(BAR, 'Enter');
    run.openingTurnMs = await waitForTurn(page);
    await sleep(1500);
    run.openingNote = await readNote(page);
    console.log(`opening note: ${JSON.stringify(run.openingNote?.text ?? null)}`);

    // 2 — X on two works, and record what they actually are
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
    const flags = await page.evaluate(
      async () => await window.__paillette_webmcp.call('get_view_context', {})
    );
    run.rejected = (flags?.flags?.rejects ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      medium: r.medium,
      year: r.year,
      classification: r.classification,
      palette: r.palette,
    }));
    console.log('rejected:');
    for (const r of run.rejected) {
      console.log(`   "${r.title}" — ${r.artist}, ${r.year}, ${r.medium}, ${(r.palette ?? []).join(' ')}`);
    }

    // Let the limiter's minute roll over before spending more of it: the
    // opening turn above has just used most of this client's ten.
    console.log(`waiting ${BUCKET_MS / 1000}s for the search bucket to roll over…`);
    await sleep(BUCKET_MS);

    // 3 — Enter on an empty bar: the deterministic redeal
    const beforeRedeal = wire.length;
    await page.click(BAR);
    await page.press(BAR, 'Enter');
    await sleep(6000);
    run.redealModelCalls = wire
      .slice(beforeRedeal)
      .filter((r) => r.method === 'POST' && r.url.includes('/public-agent/turn')).length;
    console.log(`redeal model calls: ${run.redealModelCalls}`);

    // 4 — the agent's next note, from a nudge that says nothing about content
    const beforeNudge = wire.length;
    await page.click(BAR);
    await page.type(BAR, NUDGE, { delay: 15 });
    await page.press(BAR, 'Enter');
    run.nudgeTurnMs = await waitForTurn(page);
    await sleep(1500);
    run.note = await readNote(page);
    run.nudgeModelCalls = wire
      .slice(beforeNudge)
      .filter((r) => r.method === 'POST' && r.url.includes('/public-agent/turn')).length;
    run.turnPayloads = turnBodies;
    console.log(`\nNOTE (run ${i}): ${JSON.stringify(run.note?.text ?? null)}`);
    console.log(`   provenance=${run.note?.provenance} · ${run.nudgeModelCalls} model calls · ${run.nudgeTurnMs}ms`);

    await page.screenshot({ path: path.join(SHOTS, `10-note-run${i}.png`) });
    run.shot = `docs/night/shots/e2e4/10-note-run${i}.png`;
  } catch (e) {
    run.error = e.message.split('\n').slice(0, 3).join(' | ');
    console.log(`RUN ${i} ERROR: ${run.error}`);
    await page.screenshot({ path: path.join(SHOTS, `10-note-run${i}-error.png`) }).catch(() => {});
  }
  runs.push(run);
  await ctx.close();
  if (i < RUNS) {
    console.log(`waiting ${BUCKET_MS / 1000}s before run ${i + 1}…`);
    await sleep(BUCKET_MS);
  }
}

await writeFile(path.join(OUT, 'notes-e2e4-paced.json'), JSON.stringify(runs, null, 2));
await browser.close();

console.log('\n================ all three notes, verbatim ================');
for (const r of runs) {
  console.log(`\nrun ${r.run}`);
  console.log(`  rejected: ${(r.rejected ?? []).map((x) => `"${x.title}"`).join(', ')}`);
  console.log(`  note:     ${JSON.stringify(r.note?.text ?? r.error ?? null)}`);
}
