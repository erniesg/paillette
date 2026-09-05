/**
 * Where the agent's marks actually land.
 *
 * The census answers "did the model call `flag_artworks`". §7.2 asks a second
 * question the census cannot — *"every screenshot shows two hands"* — and the
 * first census run on this deploy called `flag_artworks` and left the board
 * showing no agent mark, so the two questions are visibly not the same one.
 *
 * This asks the second. One typed instruction after a flag, then the ids the
 * agent proposed on read out of `get_view_context`, checked against the cards
 * on screen. Anything the agent marked that is not on the board is the gap.
 *
 *   node scripts/demo/agent-marks.mjs <base-url> <out-dir> [runs]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/agent-marks';
const RUNS = Number(process.argv[4] ?? 2);
const QUERY = process.env.CENSUS_QUERY ?? 'storms at sea';
const SAID = 'Narrow these down for me — I can only hang one.';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => process.stdout.write(`${line}\n`);

const waitForQuiet = async (page, deadlineMs = 210_000) => {
  const bar = page.locator('input[aria-label="Ask the agent"]');
  const started = Date.now();
  await page
    .waitForFunction(
      () =>
        document.querySelector('input[aria-label="Ask the agent"]')?.disabled ===
        true,
      { timeout: 25_000 }
    )
    .catch(() => {});
  let quiet = null;
  while (Date.now() - started < deadlineMs) {
    const busy = await bar.isDisabled().catch(() => false);
    if (!busy) {
      quiet = quiet ?? Date.now();
      if (Date.now() - quiet > 3500) return Date.now() - started;
    } else {
      quiet = null;
    }
    await sleep(250);
  }
  return -1;
};

const main = async () => {
  const browser = await chromium.launch();
  const runs = [];

  for (let run = 1; run <= RUNS; run += 1) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const chosen = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/api/public-agent/turn')) return;
      try {
        const body = await response.json();
        for (const call of body?.data?.message?.tool_calls ?? []) {
          chosen.push(call.function?.name);
        }
      } catch {
        // An error page; recorded by the empty census rather than by a throw.
      }
    });

    await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-artwork-id]').length > 0,
      { timeout: 60_000 }
    );
    await page.waitForFunction(
      async () => ((await window.__paillette_webmcp?.tools?.()) ?? []).length > 0,
      { timeout: 45_000 }
    );
    await sleep(1200);

    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('[data-artwork-id]')]
        .map((el) => el.getAttribute('data-artwork-id'))
        .slice(0, 3)
    );
    for (const [index, id] of ids.entries()) {
      await page.evaluate(() => document.activeElement?.blur?.());
      const card = page.locator(`[data-artwork-id="${id}"]`).first();
      await card.scrollIntoViewIfNeeded();
      await card.hover();
      await page.keyboard.press(index === 2 ? 'p' : 'x');
      await sleep(250);
    }
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Enter');
    await sleep(4000);

    const bar = page.locator('input[aria-label="Ask the agent"]');
    await bar.click();
    await bar.fill(SAID);
    await bar.press('Enter');
    const quietMs = await waitForQuiet(page);
    await sleep(2000);

    const seen = await page.evaluate(async () => {
      const raw = await window.__paillette_webmcp.call('get_view_context', {});
      const parsed = Array.isArray(raw?.content)
        ? JSON.parse(raw.content[0].text)
        : raw;
      const onScreen = [
        ...document.querySelectorAll('[data-artwork-id]'),
      ].map((el) => ({
        id: el.getAttribute('data-artwork-id'),
        flag: el.getAttribute('data-flag'),
        by: el.getAttribute('data-flag-by'),
        provisional: el.getAttribute('data-flag-provisional'),
      }));
      const provisional = (parsed?.flags?.provisional ?? []).map(
        (flag) => flag.id ?? flag.artworkId
      );
      return {
        provisional,
        compareOpen: Boolean(document.querySelector('[data-compare-room]')),
        onScreenIds: onScreen.map((card) => card.id),
        agentMarkedOnScreen: onScreen
          .filter((card) => card.by === 'agent')
          .map((card) => card.id),
        missing: provisional.filter(
          (id) => !onScreen.some((card) => card.id === id)
        ),
      };
    });

    await page.screenshot({ path: path.join(OUT, `run-${run}.png`) });
    const record = { run, quietMs, chosen, ...seen };
    runs.push(record);
    log(
      `run ${run}: tools=${chosen.join(',')} provisional=${seen.provisional.length} ` +
        `onBoard=${seen.agentMarkedOnScreen.length} offBoard=${seen.missing.length} ` +
        `compareOpen=${seen.compareOpen}`
    );
    if (seen.missing.length) log(`  off the board: ${seen.missing.join(', ')}`);
    await context.close();
    if (run < RUNS) await sleep(3000);
  }

  await browser.close();
  await writeFile(
    path.join(OUT, 'marks.json'),
    `${JSON.stringify(runs, null, 2)}\n`
  );
};

await main();
