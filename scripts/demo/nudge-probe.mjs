/**
 * Does the page actually put the turn back to work, in a browser?
 *
 * The census on this deploy came back with `flag_artworks` 6 and
 * `compare_artworks` 3 across nine typed turns and **zero** nudges: the model
 * proposed of its own accord every time, so the post-condition that was built
 * to catch it never fired. That is the good outcome and it is also a gap in the
 * evidence — a backstop nobody has seen catch anything is a backstop on paper.
 *
 * So the model is made to fail on purpose. The first response of the turn is
 * intercepted and replaced with what the model used to do every single time —
 * one sentence, no tool calls — and then the page is watched. If the mechanism
 * works there is a second request, carrying a system message the page appended,
 * naming `flag_artworks` and the ids on the board; and the real model answers
 * that one.
 *
 * Only the model's words are faked. The page, the tools, the store and the
 * board are the deployed ones, and the second turn is a real model call.
 *
 *   node scripts/demo/nudge-probe.mjs <base-url> <out-dir>
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/nudge-probe';
const QUERY = process.env.CENSUS_QUERY ?? 'storms at sea';
const SAID = 'Something warm, please.';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => process.stdout.write(`${line}\n`);

const main = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  /** What the page sent, request by request. */
  const requests = [];
  /** What the model chose, after the first response was taken away from it. */
  const chosen = [];
  let intercepted = 0;

  await page.route('**/api/public-agent/turn', async (route) => {
    const body = JSON.parse(route.request().postData() ?? 'null');
    const last = body?.messages?.at(-1);
    requests.push({
      messages: body?.messages?.length ?? 0,
      lastRole: last?.role ?? null,
      lastContent: last?.role === 'system' ? String(last.content) : null,
    });
    if (intercepted === 0) {
      // Exactly what 508 consecutive tool calls' worth of transcripts did:
      // narrate, touch nothing, stop.
      intercepted += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            message: { role: 'assistant', content: 'Following the warm ones.' },
          },
        }),
      });
      return;
    }
    await route.continue();
  });
  page.on('response', async (response) => {
    if (!response.url().includes('/api/public-agent/turn')) return;
    try {
      const body = await response.json();
      for (const call of body?.data?.message?.tool_calls ?? []) {
        chosen.push(call.function?.name);
      }
    } catch {
      // The fulfilled response has no tool calls, which is the point of it.
    }
  });

  await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-artwork-id]').length > 0,
    { timeout: 60_000 }
  );
  await sleep(1500);

  // One human gesture. Without it the page owes nothing and must not nudge.
  const first = await page.evaluate(() =>
    document.querySelector('[data-artwork-id]')?.getAttribute('data-artwork-id')
  );
  await page.evaluate(() => document.activeElement?.blur?.());
  const card = page.locator(`[data-artwork-id="${first}"]`).first();
  await card.hover();
  await page.keyboard.press('p');
  await sleep(400);

  const bar = page.locator('input[aria-label="Ask the agent"]');
  await bar.click();
  await bar.fill(SAID);
  await bar.press('Enter');

  const started = Date.now();
  while (Date.now() - started < 180_000) {
    const busy = await bar.isDisabled().catch(() => false);
    if (!busy && Date.now() - started > 8000) break;
    await sleep(300);
  }
  await sleep(2500);

  const board = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-artwork-id]')];
    return {
      agentMarked: cards.filter(
        (el) => el.getAttribute('data-flag-by') === 'agent'
      ).length,
      compareOpen: Boolean(document.querySelector('[data-compare-room]')),
    };
  });
  await page.screenshot({ path: path.join(OUT, 'after-the-nudge.png') });

  const nudges = requests
    .map((request) => request.lastContent)
    .filter(Boolean)
    .filter((content) => content.includes('flag_artworks'));

  const result = {
    base: BASE,
    requests: requests.length,
    interceptedFirstResponse: intercepted === 1,
    nudgeFired: nudges.length > 0,
    nudge: nudges[0] ?? null,
    modelChoseAfterNudge: chosen,
    board,
  };
  await writeFile(
    path.join(OUT, 'nudge.json'),
    `${JSON.stringify(result, null, 2)}\n`
  );

  log(`requests: ${result.requests}`);
  log(`nudge fired: ${result.nudgeFired}`);
  if (result.nudge) log(`  "${result.nudge.slice(0, 160)}…"`);
  log(`model chose after the nudge: ${chosen.join(', ') || '(nothing)'}`);
  log(`agent marks on the board: ${board.agentMarked}, two-up open: ${board.compareOpen}`);

  await context.close();
  await browser.close();
  if (!result.nudgeFired) process.exitCode = 1;
};

await main();
