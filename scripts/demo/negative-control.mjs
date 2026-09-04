#!/usr/bin/env node
/**
 * The experiment the brief asked for and the first e2e pass did not run.
 *
 * §9 says "check by hand on three runs" that the note refers to the *content*
 * of what was rejected. Three runs were done — with the same two rejects and
 * the same pick every time, which is one condition sampled three times. It
 * cannot tell a grounded note from a canned string, because nothing varied.
 *
 * So: the same instruction, twice, with the flags inverted. Reject the two
 * darkest works on the board, then reject the two brightest. If the note
 * tracks the flags, that pair of takes is the strongest ten seconds in the
 * film. If it does not, the narration is a canned string and a judge will find
 * that out in one attempt.
 *
 * Darkness is computed from the same palette the agent is now handed — the
 * dominant colours Paillette indexed — so the two conditions differ on exactly
 * the axis the note is supposed to be able to name.
 *
 *   node scripts/demo/negative-control.mjs <base-url> <out-dir> [instruction]
 *
 * Costs roughly three model calls per condition.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/negative-control';
const INSTRUCTION =
  process.argv[4] ?? 'something warm for above the sofa';
const QUERY = process.env.NC_QUERY ?? 'warm landscape';

await mkdir(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/**
 * One condition: load cold, reject two works chosen by brightness, type the
 * instruction, and read back the note the agent wrote and the flags it saw.
 */
const run = async (browser, condition) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests = [];
  page.on('request', (r) => requests.push(`${r.method()} ${r.url()}`));

  await page.goto(
    `${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`,
    { waitUntil: 'domcontentloaded', timeout: 60_000 }
  );
  await page.waitForFunction(() => Boolean(window.__paillette_webmcp), {
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-artwork-id]').length >= 8,
    { timeout: 45_000 }
  );

  // Rank the board by how dark its indexed palette is. Perceptual luminance,
  // averaged over the swatches — the same numbers the agent now receives.
  const ranked = await page.evaluate(async () => {
    const context = await window.__paillette_webmcp.call('get_view_context', {});
    const parsed =
      context && Array.isArray(context.content)
        ? JSON.parse(context.content[0].text)
        : context;
    const onScreen = [...document.querySelectorAll('[data-artwork-id]')]
      .filter((el) => !el.closest('.lt-tray'))
      .map((el) => el.getAttribute('data-artwork-id'));

    const luminance = (hex) => {
      const n = hex.replace('#', '');
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    // One call for the whole board: `lookup_artwork` takes `artworkIds` and
    // answers `{ artworks: [...] }`, each with the palette Paillette indexed.
    const looked = await window.__paillette_webmcp.call('lookup_artwork', {
      artworkIds: onScreen.slice(0, 24),
    });
    const payload =
      looked && Array.isArray(looked.content)
        ? JSON.parse(looked.content[0].text)
        : looked;

    const rows = (payload?.artworks ?? [])
      .filter((work) => (work.palette ?? []).length)
      .map((work) => ({
        id: work.id,
        title: work.title ?? null,
        palette: work.palette,
        luminance:
          work.palette.map(luminance).reduce((a, b) => a + b, 0) /
          work.palette.length,
      }));
    rows.sort((a, b) => a.luminance - b.luminance);
    return { rows, seen: parsed?.results?.length ?? onScreen.length };
  });

  const rows = ranked.rows;
  const targets =
    condition === 'darkest' ? rows.slice(0, 2) : rows.slice(-2).reverse();
  if (targets.length < 2) {
    throw new Error(
      `Could not rank the board by palette — got ${rows.length} works with swatches. The experiment is meaningless without the flags, so it fails rather than reporting two unflagged runs as a result.`
    );
  }

  for (const target of targets) {
    await page.evaluate(() => document.activeElement?.blur?.());
    const card = page.locator(`[data-artwork-id="${target.id}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.keyboard.press('x');
    await sleep(250);
  }

  const bar = page.locator('input[aria-label="Ask the agent"]');
  await bar.click();
  await bar.fill(INSTRUCTION);
  await bar.press('Enter');

  // Wait for a note to land, or give up and record that none did.
  await page
    .waitForFunction(
      () => Boolean(document.querySelector('.paillette-wall-label')?.textContent?.trim()),
      { timeout: 180_000 }
    )
    .catch(() => {});
  await sleep(2500);

  const observed = await page.evaluate(() => ({
    note:
      document.querySelector('.paillette-wall-label')?.textContent?.trim() ??
      null,
    swatches: document.querySelectorAll('.lt-note-swatch').length,
    rejectSwatches: document.querySelectorAll(
      '.lt-note-swatch[data-flag="reject"]'
    ).length,
    boardCards: document.querySelectorAll(
      '[data-testid="deal-board-grid"] [data-artwork-id]'
    ).length,
  }));

  const viewContext = unwrap(
    await page.evaluate(() =>
      window.__paillette_webmcp.call('get_view_context', {})
    )
  );

  await page.screenshot({ path: path.join(OUT, `${condition}.png`) });
  const result = {
    condition,
    instruction: INSTRUCTION,
    query: QUERY,
    rejected: targets.map((t) => ({
      id: t.id,
      title: t.title,
      palette: t.palette,
      luminance: Math.round(t.luminance),
    })),
    note: observed.note,
    swatchesBesideTheNote: observed.swatches,
    rejectSwatches: observed.rejectSwatches,
    boardCards: observed.boardCards,
    flagsTheAgentSaw: viewContext?.flags ?? null,
    modelCalls: requests.filter((r) => r.includes('/public-agent/turn')).length,
  };
  await page.close();
  return result;
};

const browser = await chromium.launch();
const results = [];
for (const condition of ['darkest', 'brightest']) {
  const result = await run(browser, condition);
  results.push(result);
  process.stdout.write(`\n=== rejected the two ${condition}\n`);
  for (const work of result.rejected) {
    process.stdout.write(
      `  ${work.title}  L=${work.luminance}  ${work.palette.join(' ')}\n`
    );
  }
  process.stdout.write(`  note: ${result.note ?? '(none)'}\n`);
  process.stdout.write(
    `  swatches beside the note: ${result.swatchesBesideTheNote} (${result.rejectSwatches} struck)\n`
  );
  process.stdout.write(`  model calls: ${result.modelCalls}\n`);
}
await browser.close();

const [dark, bright] = results;
process.stdout.write(
  `\nsame note under inverted flags: ${dark.note && dark.note === bright.note ? 'YES — the note is canned' : 'no'}\n`
);
await writeFile(
  path.join(OUT, 'negative-control.json'),
  `${JSON.stringify({ base: BASE, instruction: INSTRUCTION, query: QUERY, results }, null, 2)}\n`
);
