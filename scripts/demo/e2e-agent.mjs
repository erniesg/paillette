/**
 * The demo loop's agentic half, driven by typing, on a deployed build.
 *
 * Steps 1 and 4 of the brief's §9 loop: the sofa instruction typed into the
 * utterance bar with voice switched off, and — after two `X` presses and a `P`
 * — whether the agent's next note refers to the *content* of what was thrown
 * out rather than merely to the fact that something was.
 *
 * Costs model calls. The anonymous budget is 40 per client per hour and one
 * typed instruction spends three or four, so `RUNS` is deliberately small.
 * Every request to the agent route is recorded with its body, so what the
 * model was actually told is evidence rather than inference.
 *
 *   PLAYWRIGHT_CORE=… node scripts/demo/e2e-agent.mjs <base-url> <out-dir> [runs]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PLAYWRIGHT_CORE =
  process.env.PLAYWRIGHT_CORE ??
  new URL(
    '../../node_modules/.pnpm/playwright-core@1.56.1/node_modules/playwright-core/index.mjs',
    import.meta.url
  ).pathname;
const { chromium } = await import(PLAYWRIGHT_CORE);

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e-agent';
const RUNS = Number(process.argv[4] ?? 3);
const QUERY = process.env.E2E_QUERY ?? 'sunset landscape';

const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (line) => process.stdout.write(`${line}\n`);

/** Wait for the agent to stop working: the bar re-enables and stays enabled. */
const waitForQuiet = async (page, deadlineMs = 150_000) => {
  const bar = page.locator('input[aria-label="Ask the agent"]');
  const started = Date.now();
  // It has to go busy first, or "already quiet" reads as "finished".
  await page
    .waitForFunction(
      () => document.querySelector('input[aria-label="Ask the agent"]')?.disabled === true,
      { timeout: 20_000 }
    )
    .catch(() => {});
  let quietSince = null;
  while (Date.now() - started < deadlineMs) {
    const busy = await bar.isDisabled().catch(() => false);
    if (!busy) {
      quietSince = quietSince ?? Date.now();
      if (Date.now() - quietSince > 3000) return Date.now() - started;
    } else {
      quietSince = null;
    }
    await sleep(250);
  }
  return -1;
};

const readNote = (page) =>
  page.evaluate(() => {
    const label = document.querySelector('.paillette-wall-label');
    const entries = [...document.querySelectorAll('section[aria-label="Ask the agent"] ol li p')]
      .map((p) => p.textContent?.trim())
      .filter(Boolean);
    const error = document.querySelector('[data-deal-error]')?.textContent ?? null;
    return {
      wallLabel: label?.textContent?.trim() ?? null,
      provenance: label?.getAttribute('data-provenance') ?? null,
      transcript: entries,
      dealError: error,
      view: document.querySelector('[data-testid="deal-board-grid"]') ? 'deal-board' : 'other',
      cards: [...document.querySelectorAll('[data-artwork-id]')].map((el) => ({
        id: el.getAttribute('data-artwork-id'),
        flag: el.getAttribute('data-flag'),
        by: el.getAttribute('data-flag-by'),
      })),
    };
  });

const main = async () => {
  const browser = await chromium.launch();
  const runs = [];

  for (let run = 1; run <= RUNS; run += 1) {
    const dir = path.join(OUT, `run-${run}`);
    await mkdir(dir, { recursive: true });
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      recordVideo: { dir, size: { width: 1440, height: 1000 } },
    });
    const page = await ctx.newPage();

    /** Every agent request, with the body, so "what was it told" is evidence. */
    const turns = [];
    await page.route('**/api/public-agent/turn', async (route) => {
      let body = null;
      try {
        body = JSON.parse(route.request().postData() ?? 'null');
      } catch {
        body = { unparsed: route.request().postData()?.slice(0, 400) };
      }
      turns.push({
        at: Date.now(),
        messages: body?.messages?.length ?? 0,
        turn: body?.turn ?? null,
        lastMessage: body?.messages?.at(-1) ?? null,
      });
      await route.continue();
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));

    const shot = (name) => page.screenshot({ path: path.join(dir, `${name}.png`) });
    const record = { run, steps: [] };
    const step = (label, detail) => {
      record.steps.push({ label, ...detail });
      log(`  run ${run} · ${label}: ${JSON.stringify(detail).slice(0, 220)}`);
    };

    await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-artwork-id]').length > 0,
      { timeout: 45_000 }
    );
    await page.waitForFunction(
      async () => ((await window.__paillette_webmcp?.tools?.()) ?? []).length > 0,
      { timeout: 45_000 }
    );
    await sleep(1500);
    await shot('a-loaded');

    const bar = page.locator('input[aria-label="Ask the agent"]');

    // --- step 2: two X and one P, on works whose titles we keep -----------
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('[data-artwork-id]')].map((el) =>
        el.getAttribute('data-artwork-id')
      )
    );
    const targets = [
      { id: ids[0], key: 'x' },
      { id: ids[1], key: 'x' },
      { id: ids[2], key: 'p' },
    ];
    for (const t of targets) {
      await page.evaluate(() => document.activeElement?.blur?.());
      const card = page.locator(`[data-artwork-id="${t.id}"]`).first();
      await card.scrollIntoViewIfNeeded();
      await card.hover();
      await page.keyboard.press(t.key);
      await sleep(250);
    }
    const flagged = await page.evaluate(async () => {
      const raw = await window.__paillette_webmcp.call('get_view_context', {});
      const parsed = Array.isArray(raw?.content) ? JSON.parse(raw.content[0].text) : raw;
      return parsed?.flags ?? null;
    });
    step('flags laid down', {
      picks: flagged?.picks?.map((f) => f.title) ?? [],
      rejects: flagged?.rejects?.map((f) => f.title) ?? [],
    });
    await shot('b-flagged');

    // --- step 3: Enter on the empty bar, so the agent's turn follows a deal
    const netBefore = turns.length;
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Enter');
    await page
      .waitForFunction(
        (prev) =>
          [...document.querySelectorAll('[data-artwork-id]')]
            .map((el) => el.getAttribute('data-artwork-id'))
            .join(',') !== prev,
        ids.join(','),
        { timeout: 45_000 }
      )
      .catch(() => {});
    await sleep(2000);
    step('deterministic redeal', {
      modelCallsDuring: turns.length - netBefore,
      board: await readNote(page).then((s) => ({ view: s.view, cards: s.cards.length })),
    });
    await shot('c-after-redeal');

    // --- steps 1 & 4: the sofa instruction, typed, voice untouched -------
    const typedAt = Date.now();
    await bar.click();
    await bar.fill(SOFA);
    const inBar = await bar.inputValue();
    step('instruction in the bar', { chars: inBar.length, verbatim: inBar === SOFA });
    await bar.press('Enter');
    const quietMs = await waitForQuiet(page);
    await sleep(1500);
    const after = await readNote(page);
    step('agent turn', {
      quietMs,
      elapsedMs: Date.now() - typedAt,
      modelCalls: turns.length - netBefore,
      wallLabel: after.wallLabel,
      provenance: after.provenance,
      view: after.view,
      cards: after.cards.length,
      picksHeld: after.cards.filter((c) => c.flag === 'pick').length,
      dealError: after.dealError,
      transcript: after.transcript,
    });
    await shot('d-agent-note');

    record.turns = turns.map((t) => ({
      messages: t.messages,
      turn: t.turn,
      lastRole: t.lastMessage?.role ?? null,
    }));
    record.errors = errors;
    record.note = after.wallLabel;
    record.transcript = after.transcript;
    runs.push(record);

    await ctx.close();
    await writeFile(path.join(OUT, 'runs.json'), `${JSON.stringify(runs, null, 2)}\n`);
    // Space the runs so the hourly cap is not hit in a burst.
    if (run < RUNS) await sleep(5000);
  }

  await browser.close();

  log('\n=== the three notes, verbatim ===');
  for (const r of runs) {
    log(`\nrun ${r.run}:`);
    log(`  wall label: ${JSON.stringify(r.note)}`);
    log(`  transcript: ${JSON.stringify(r.transcript)}`);
  }
};

await main();
