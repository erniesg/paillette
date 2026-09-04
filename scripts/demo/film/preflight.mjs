/**
 * Before the first take.
 *
 * The shot list's ten-item pre-flight, run as code rather than read as a list.
 * Everything here is free — zero model calls — except the last check, which
 * spends exactly one throwaway turn to find out whether the hour's anonymous
 * budget is already gone. A take that discovers that halfway through beat 1 has
 * burned twenty seconds of agent time and a browser context for nothing.
 *
 *   node scripts/demo/film/preflight.mjs [base-url]
 */

import { chromium } from '../browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const results = [];
const note = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  process.stdout.write(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`
  );
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();

// ---------------------------------------------------------------- 1. the page
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/nga/search`, { waitUntil: 'domcontentloaded' });

  // Poll, never sleep: the bar takes 691–2786 ms across 20 cold loads, with an
  // outlier past 4500. A flat wait is how the e2e lane lost a run.
  const barAt = await (async () => {
    const t0 = Date.now();
    await page.waitForSelector('input[aria-label="Ask the agent"]', {
      timeout: 30_000,
    });
    return Date.now() - t0;
  })().catch(() => null);
  note(barAt !== null, 'the agent bar mounts with no ?webmcp-debug', `${barAt} ms`);

  const tools = await page
    .evaluate(async () =>
      document.modelContext ? (await document.modelContext.getTools()).length : -1
    )
    .catch(() => -2);
  note(tools === 25, 'document.modelContext carries 25 tools, no flag', `${tools}`);

  const glyph = await page.locator('button[aria-label="Agent activity"]').count();
  note(glyph === 1, 'the activity glyph renders at rest', `${glyph} found`);

  await ctx.close();
}

// ------------------------------------------- 2. the deal, on the real route
//
// The brief's instruction: confirm the animation runs on /nga/search with the
// real collection and not only at /night/deal. Measured the way the e2e lane
// measured it — distinct card layouts *relative to the grid*, so a container
// sliding under a still board cannot inflate the count. A jump cut scores 4–5.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/nga/search?q=warm+landscape`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('[data-artwork-id]', { timeout: 60_000 });
  await sleep(2500);

  const route = page.url();
  note(
    route.includes('/nga/search') && !route.includes('/night/deal'),
    'filming the product route, not the fixture harness',
    route
  );

  // Flag two rejects and a pick, hovering rather than clicking — the affordance
  // the film shows.
  const cards = page.locator('[data-artwork-id]');
  const n = await cards.count();
  for (const [i, key] of [
    [0, 'x'],
    [1, 'x'],
    [2, 'p'],
  ]) {
    if (i < n) {
      await cards.nth(i).hover();
      await sleep(400);
      await page.keyboard.press(key);
      await sleep(300);
    }
  }
  const flagged = await page.evaluate(
    () => document.querySelectorAll('[data-flag-by="human"]').length
  );
  note(flagged >= 3, 'P and X flag in the human ink from the keyboard', `${flagged}`);

  // Park the pointer off the board so a hover lift cannot be mistaken for the
  // deal, then sample every frame across the redeal.
  await page.mouse.move(5, 5);
  await sleep(600);

  const modelCalls = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/public-agent/turn')) modelCalls.push(r.url());
  });

  // The FIRST Enter off a text search is a masonry becoming a board — a jump
  // cut with no slot to hold, and it scores 1 on this ruler because the grid
  // does not exist until the new board lands. Measuring it and reporting "the
  // deal does not animate" is the mistake iteration 5 made and retracted.
  // Spend it, then measure the second, which is the one the film shoots.
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="deal-board-grid"]', {
    timeout: 60_000,
  });
  await sleep(5000);

  const sample = page.evaluate(
    () =>
      new Promise((resolve) => {
        const seen = new Set();
        let frames = 0;
        const grid = () =>
          document.querySelector('[data-testid="deal-board-grid"]');
        const tick = () => {
          const g = grid()?.getBoundingClientRect();
          if (g) {
            const key = [...document.querySelectorAll('[data-artwork-id]')]
              .filter((el) => !el.closest('.lt-tray'))
              .map((el) => {
                const r = el.getBoundingClientRect();
                return `${Math.round(r.x - g.x)},${Math.round(r.y - g.y)}`;
              })
              .join('|');
            if (key) seen.add(key);
          }
          frames += 1;
          if (performance.now() - t0 < 12_000) requestAnimationFrame(tick);
          else resolve({ layouts: seen.size, frames });
        };
        const t0 = performance.now();
        requestAnimationFrame(tick);
      })
  );

  await page.keyboard.press('Enter');
  const { layouts, frames } = await sample;

  note(
    layouts >= 10,
    'the deal animates on /nga/search, board to board, real collection',
    `${layouts} distinct grid-relative layouts over ${frames} frames (a jump cut scores 1–5)`
  );
  note(
    modelCalls.length === 0,
    'Enter on an empty bar reaches no model',
    `${modelCalls.length} calls to /api/public-agent/turn`
  );

  await ctx.close();
}

// ------------------------------------------------- 3. the share page, still up
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const res = await page.goto(`${BASE}/e/MKwsxHy`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(3000);
  const works = await page.locator('[data-artwork-id], figure, article').count();
  note(
    res.status() === 200 && works > 0,
    '/e/MKwsxHy still resolves',
    `http ${res.status()}, ${works} work-ish elements`
  );
  await ctx.close();
}

// --------------------------------------------- 4. one throwaway agent turn
//
// The only check here that costs anything. It answers the one question that
// cannot be answered any other way: is this hour's 40-call anonymous budget
// already spent. The instruction is deliberately trivial.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/nga/search`, { waitUntil: 'domcontentloaded' });
  const input = page.locator('input[aria-label="Ask the agent"]');
  await input.waitFor({ timeout: 30_000 });

  const statuses = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/public-agent/turn')) statuses.push(r.status());
  });

  await input.fill('show me one blue picture');
  await input.press('Enter');
  await sleep(25_000);

  const alert = await page
    .locator('[role="alert"]')
    .first()
    .textContent()
    .catch(() => null);
  const refused = statuses.includes(429);
  note(
    !refused,
    'the anonymous agent budget has room',
    refused
      ? `429 seen; page says: ${(alert ?? '').trim()}`
      : `turn statuses: ${statuses.join(',') || 'none observed'}`
  );

  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
process.stdout.write(
  `\n${results.length - failed.length}/${results.length} pass\n`
);
process.exit(failed.length ? 1 : 0);
