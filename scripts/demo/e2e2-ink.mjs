/**
 * Two colours of ink, read off computed styles rather than off class names.
 *
 * §9's last clause. Checked here for two reasons: the e2e phase should not
 * inherit it from another lane's report, and one thing this phase found while
 * measuring the board needs recording — `NoteSwatches`, the palette strips
 * under the wall label, carry `data-artwork-id` and `data-flag` but *not*
 * `data-flag-by`, so a strip says a work was flagged without saying by whom.
 *
 * No model calls: `flag_artworks` is driven directly through the debug driver,
 * which is the same code path the agent's tool call takes.
 *
 *   PLAYWRIGHT_CORE=… node scripts/demo/e2e2-ink.mjs <base-url> <out-dir>
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e2-ink';
const QUERY = process.env.E2E_QUERY ?? 'warm landscape';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const note = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  process.stdout.write(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}\n`
  );
};

const main = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const net = [];
  page.on('request', (r) => net.push(r.url()));

  await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.waitForFunction(
    async () => ((await window.__paillette_webmcp?.tools?.()) ?? []).length > 0,
    { timeout: 60_000 }
  );
  await page.waitForFunction(() => document.querySelectorAll('.paillette-card').length > 0, {
    timeout: 60_000,
  });
  await sleep(1200);

  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('.paillette-card[data-artwork-id]')].map((el) =>
      el.getAttribute('data-artwork-id')
    )
  );

  // A human pick, by keyboard.
  await page.evaluate(() => document.activeElement?.blur?.());
  const humanCard = page.locator(`.paillette-card[data-artwork-id="${ids[0]}"]`).first();
  await humanCard.scrollIntoViewIfNeeded();
  await humanCard.hover();
  await page.keyboard.press('p');
  await sleep(400);

  // An agent pick, through the tool the agent calls.
  const agentResult = await page.evaluate(
    (id) =>
      window.__paillette_webmcp.call('flag_artworks', {
        flags: [{ artworkId: id, flag: 'pick', reason: 'the warmest thing on the board' }],
      }),
    ids[1]
  );
  await sleep(900);

  const readInk = (page, id) =>
    page.evaluate((artworkId) => {
      const el = document.querySelector(`.paillette-card[data-artwork-id="${artworkId}"]`);
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return {
        flag: el.getAttribute('data-flag'),
        by: el.getAttribute('data-flag-by'),
        provisional: el.getAttribute('data-flag-provisional'),
        // A confirmed mark is a solid 1px ring drawn with box-shadow; a
        // provisional one is a dashed outline. Reading only `outline` reports
        // the human's mark as absent, because the human's mark is not an
        // outline — a mistake worth not repeating.
        ink: style.getPropertyValue('--ink').trim(),
        boxShadow: style.boxShadow,
        outlineColor: style.outlineColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    }, id);

  const human = await readInk(page, ids[0]);
  const agent = await readInk(page, ids[1]);
  note(
    human?.by === 'human' && agent?.by === 'agent',
    'the two hands are distinguishable on the card',
    JSON.stringify({ human, agent })
  );
  note(
    Boolean(human?.ink) && Boolean(agent?.ink) && human.ink !== agent.ink,
    'and they are two different colours, read off computed styles',
    `--ink resolves to ${human?.ink} on the human's card and ${agent?.ink} on the agent's`
  );
  note(
    /rgb/.test(human?.boxShadow ?? '') && human?.boxShadow !== agent?.boxShadow,
    "the human's confirmed mark is a solid ring, drawn with box-shadow, not an outline",
    `human box-shadow: ${human?.boxShadow}`
  );
  note(
    agent?.provisional === 'true' && agent?.outlineStyle === 'dashed',
    "the agent's proposal is dashed until the human confirms it",
    `agent outline-style=${agent?.outlineStyle}; human outline-style=${human?.outlineStyle}`
  );
  await page.screenshot({ path: path.join(OUT, 'i1-both-inks.png') });

  // The observation this script exists to record.
  const swatches = await page.evaluate(() =>
    [...document.querySelectorAll('.lt-note-swatch')].map((el) => ({
      id: el.getAttribute('data-artwork-id'),
      flag: el.getAttribute('data-flag'),
      by: el.getAttribute('data-flag-by'),
      ariaLabel: el.getAttribute('aria-label'),
    }))
  );
  note(
    swatches.every((s) => s.by !== null),
    'the note swatches say whose flag they are drawing',
    JSON.stringify(swatches)
  );

  const modelCalls = net.filter((u) => /public-agent\/turn/.test(u)).length;
  note(modelCalls === 0, 'no model call was spent', `${modelCalls}`);

  await writeFile(
    path.join(OUT, 'ink.json'),
    `${JSON.stringify({ base: BASE, human, agent, agentResult, swatches, results }, null, 2)}\n`
  );
  await ctx.close();
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length} passed, ${failed.length} failed\n`);
};

await main();
