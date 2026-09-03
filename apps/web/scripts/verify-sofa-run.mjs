/**
 * The brief's definition-of-done, run against the real model.
 *
 *   "Given the sofa prompt and two X presses, the agent's redeal note refers
 *    to the *content* of what was rejected. Check by hand on three runs."
 *
 * So this is that sequence, in a real browser, typed — no speech anywhere in
 * the path. Only the corpus is stubbed: the search and exemplar responses are
 * fixtures with legible warm/cool titles, so the note can be read for whether
 * it names what was thrown out. Everything else is real — the page, the tools,
 * `POST /api/public-agent/turn`, the system prompt, and the model.
 *
 *   cd apps/api && npx wrangler dev --port 8787        # needs OPENAI_API_KEY
 *   PAILLETTE_API_URL=http://localhost:8787 pnpm --filter web dev
 *   node apps/web/scripts/verify-sofa-run.mjs [baseUrl] [runs]
 *
 * Prints the note from each run and whether a human could tell, from that
 * sentence alone, what was rejected. Judge it by eye — that is what the brief
 * asked for.
 */

import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const RUNS = Number(process.argv[3] ?? 3);
const GALLERY = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

const PROMPT = 'I want something warm for above the sofa. Nothing grim.';

/** Titles are the fixture's whole job: the note has to be readable against them. */
const SHELF = [
  ['w0', 'Golden Wheatfield at Noon', 'P. Sun'],
  ['w1', 'Amber Still Life with Peaches', 'R. Warm'],
  ['w2', 'Winter Harbour, Grey Light', 'J. Cole'],
  ['w3', 'Blue Interior at Dusk', 'M. Reed'],
  ['w4', 'Cold Estuary, Slate Sky', 'F. Lane'],
  ['w5', 'Sunlit Orchard in July', 'P. Sun'],
  ['w6', 'Fog over the Breakwater', 'J. Cole'],
  ['w7', 'Rust and Ochre Barn', 'R. Warm'],
];

const DEALT = [
  ['d0', 'Pale Shore, Low Tide', 'F. Lane'],
  ['d1', 'Grey Morning, Empty Quay', 'J. Cole'],
  ['d2', 'Blue Hour over Rooftops', 'M. Reed'],
  ['d3', 'Slate Water, Still Air', 'F. Lane'],
  ['d4', 'Winter Field, Thin Light', 'J. Cole'],
  ['d5', 'Harbour Wall in Mist', 'M. Reed'],
  ['d6', 'Cold Sky, Two Boats', 'F. Lane'],
  ['d7', 'Estuary at First Light', 'J. Cole'],
  ['d8', 'Quiet Dock, Overcast', 'M. Reed'],
  ['d9', 'Low Cloud, Long Water', 'F. Lane'],
  ['d10', 'Grey Dunes', 'J. Cole'],
  ['d11', 'Pale Inlet', 'M. Reed'],
];

const work = ([id, title, artist], rank) => ({
  id,
  galleryId: GALLERY,
  orgId: GALLERY,
  title,
  artist,
  year: 1888,
  imageUrl: null,
  thumbnailUrl: null,
  similarity: 0.9 - rank * 0.01,
  metadata: { classification: 'Painting', dateText: '1888' },
});

const searchPayload = (rows) => ({
  success: true,
  data: {
    results: rows.map(work),
    count: rows.length,
    total: rows.length,
    queryTime: 4,
  },
});

const runOnce = async (browser, index) => {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  const toolCalls = [];
  const replies = [];
  const turnErrors = [];
  let lastTurnAt = 0;
  page.on('response', async (response) => {
    if (!response.url().includes('/api/public-agent/turn')) return;
    lastTurnAt = Date.now();
    try {
      const payload = await response.json();
      if (!payload?.success) {
        turnErrors.push(`${response.status()} ${JSON.stringify(payload?.error)}`);
        return;
      }
      const message = payload?.data?.message;
      for (const call of message?.tool_calls ?? []) {
        toolCalls.push(`${call.function.name} ${call.function.arguments}`);
      }
      if (message?.content) replies.push(message.content);
    } catch (error) {
      turnErrors.push(`${response.status()} unreadable: ${String(error)}`);
    }
  });

  await page.route('**/api/public-search/**', (route) => {
    const url = route.request().url();
    if (url.includes('/quota')) {
      return route.fulfill({
        json: { success: true, data: { limit: 100, used: 3, remaining: 97 } },
      });
    }
    return route.fulfill({
      json: searchPayload(url.includes('/exemplars') ? DEALT : SHELF),
    });
  });

  await page.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  await page.waitForSelector('.paillette-card', { timeout: 30_000 });

  // Two X presses. The keyboard only — no badge clicks, no speech.
  for (const id of ['w0', 'w1']) {
    await page.locator(`.paillette-card[data-artwork-id="${id}"]`).hover();
    await page.keyboard.press('x');
  }
  // And one pick, so the redeal has a direction to deal in.
  await page.locator('.paillette-card[data-artwork-id="w2"]').hover();
  await page.keyboard.press('p');

  const flags = await page.evaluate(() =>
    window.__paillette_webmcp.call('get_view_context', {})
  );

  const bar = page.locator('input[aria-label="Ask the agent"]');
  await bar.click();
  await bar.fill(PROMPT);
  await page.keyboard.press('Enter');

  // The loop is done when the agent route has been quiet for a while. There
  // is no "finished" signal on the page, and guessing at one is how a check
  // ends up passing because it looked too early.
  lastTurnAt = Date.now();
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && Date.now() - lastTurnAt < 10_000) {
    await page.waitForTimeout(500);
  }

  const after = await page.evaluate(() =>
    window.__paillette_webmcp.call('get_view_context', {})
  );

  await page.screenshot({ path: `/tmp/sofa-run-${index}.png`, fullPage: false });
  await page.close();

  return {
    rejectedTitles: flags.flags.rejects.map(
      (entry) => entry.title ?? entry.id
    ),
    note: after.board?.note ?? after.agentResults?.note ?? null,
    boardSize: after.board?.order?.length ?? 0,
    lastChangeBy: after.board?.lastChangeBy ?? null,
    picksSurvived: after.flags.picks.map((entry) => entry.id),
    toolCalls,
    replies,
    turnErrors,
    pageErrors,
  };
};

const browser = await chromium.launch();
const results = [];
for (let index = 1; index <= RUNS; index += 1) {
  const outcome = await runOnce(browser, index);
  results.push(outcome);
  console.log(`\n── run ${index} ──────────────────────────────`);
  console.log('rejected      :', outcome.rejectedTitles.join(' | '));
  console.log('board         :', outcome.boardSize, 'cards, by', outcome.lastChangeBy);
  console.log('picks survived:', outcome.picksSurvived.join(', ') || '(none)');
  console.log('tool calls    :');
  for (const call of outcome.toolCalls) console.log('   ', call.slice(0, 240));
  console.log('reply         :', outcome.replies.join(' / ') || '(none)');
  if (outcome.turnErrors.length) {
    console.log('turn errors   :', outcome.turnErrors.slice(0, 3));
  }
  console.log('NOTE          :', outcome.note ?? '(none written)');
  if (outcome.pageErrors.length) {
    console.log('page errors   :', outcome.pageErrors.slice(0, 3));
  }
}
await browser.close();

const withNotes = results.filter((entry) => entry.note);
console.log(
  `\n${withNotes.length}/${results.length} runs wrote a note. Read them above ` +
    'and judge whether each names what was thrown out.'
);
process.exit(withNotes.length === results.length ? 0 : 1);
