/**
 * Twenty timed agent turns against staging, and what they add up to.
 *
 * Issue 076: a typed instruction took 12 to 33 seconds and nothing on the agent
 * path said where the time went. The page now keeps a timing record for every
 * turn it runs (`apps/web/app/lib/webmcp/turn-timing.ts`) and the debug harness
 * hands them back; this script types the turns, waits for each record, and
 * writes them down. It measures nothing itself — every number in the output is
 * the page's own.
 *
 * Three classes, each in a fresh browser context so no turn inherits a warm
 * board or a long history from the one before:
 *
 *   ask         a goal typed into an empty page                      ×10
 *   redeal      a typed instruction over a board with 1 pick, 2 rejects ×5
 *   correction  the statement retyped over a drafted show               ×5
 *
 * A correction needs a show to correct, so each one is preceded by a drafting
 * turn. That turn is timed and kept as `draft`, and is not one of the twenty.
 *
 * `write_labels` is capped per caller per clock hour (issue 075 is changing
 * that), and a turn the page refused labels to ends early and reads as fast.
 * So a refused turn is kept, marked `discarded`, and its session is run again
 * after the next hour boundary rather than being reported as a measurement.
 *
 *   node docs/night/verify-demo-path.mjs --timing [base] \
 *     [--label=baseline] [--classes=correction,ask,redeal] [--count=N]
 *   node docs/night/latency-runs.mjs --summarise <file.json> [<file.json>]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LATENCY_DIR = path.join(HERE, 'e2e-evidence', 'latency');

const ASKS = [
  'something warm for above the sofa',
  'a room about storms at sea',
  'something lonely',
  'a tiny figure under an enormous sky',
  'pictures about work',
  'quiet interiors with morning light',
  'Winslow Homer watercolours',
  'blue and gold harbour scenes',
  "something for a child's bedroom",
  'unsettling portraits',
];

const REDEALS = [
  'warmer',
  'more like the ones I picked',
  'less busy',
  'keep going',
  'quieter, and fewer people',
];

const DRAFTS = [
  'Build me a room about storms at sea — pick a dozen works, and write me a title and a statement for it.',
  'Build me a room about harbours at dusk — pick a dozen works, and write me a title and a statement for it.',
  'Build me a room about gardens — pick a dozen works, and write me a title and a statement for it.',
  'Build me a room about winter — pick a dozen works, and write me a title and a statement for it.',
  'Build me a room about city streets — pick a dozen works, and write me a title and a statement for it.',
];

const CORRECTIONS = [
  'It is not about weather. It is about leaving — the hour before someone goes, and the room that keeps their shape after they have gone.',
  'It is not about boats. It is about waiting — people at the edge of something, looking out for a return.',
  'It is not about flowers. It is about work — the hands that keep a place alive, and what they leave behind.',
  'It is not about cold. It is about silence — the moment after a sound stops and before the next begins.',
  'It is not about cities. It is about strangers — faces passing close and never meeting.',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line) => process.stdout.write(`${line}\n`);

const argValue = (argv, name, fallback) => {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const gitSha = () => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: HERE }).toString().trim();
  } catch {
    return null;
  }
};

/** Until the next UTC hour, plus a margin for clock skew between us and CF. */
const msToNextHour = () => 3_600_000 - (Date.now() % 3_600_000) + 45_000;

// --- driving the page -------------------------------------------------------

const openPage = async (browser, base, query) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error.message).slice(0, 200)));
  const url = `${base}/nga/search?webmcp-debug${query ? `&q=${encodeURIComponent(query)}` : ''}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Polled, never slept: the bar arrives anywhere from 0.7 s to 2.8 s.
  await page.waitForFunction(
    () =>
      Boolean(window.__paillette_webmcp?.timing) &&
      Boolean(document.querySelector('input[aria-label="Ask the agent"]')),
    { timeout: 45_000 }
  );
  if (query) await page.waitForSelector('[data-artwork-id]', { timeout: 45_000 });
  await sleep(1200);
  // A fresh context has an empty record; this makes sure of it.
  await page.evaluate(() => window.__paillette_webmcp.timing({ clear: true, quiet: true }));
  return { context, page, errors };
};

/** The page's own record of the next turn to finish. */
const nextTiming = async (page, already, deadlineMs = 300_000) => {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    const timings = await page
      .evaluate(() => window.__paillette_webmcp.timing({ quiet: true }))
      .catch(() => []);
    if (timings.length > already) return timings[already];
    await sleep(400);
  }
  return null;
};

const typeTurn = async (page, text) => {
  const already = (
    await page.evaluate(() => window.__paillette_webmcp.timing({ quiet: true }))
  ).length;
  const bar = page.locator('input[aria-label="Ask the agent"]');
  await bar.click();
  await bar.fill(text);
  await bar.press('Enter');
  return nextTiming(page, already);
};

const readShow = async (page) => {
  const show = await page.evaluate(() =>
    window.__paillette_webmcp.call('get_exhibition', {})
  );
  const works = show?.works ?? [];
  return {
    title: show?.title?.text ?? null,
    works: works.length,
    unlabelled: works.filter((work) => !String(work.label ?? '').trim()).length,
  };
};

const flagBoard = async (page) => {
  const ids = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('[data-artwork-id]')]
      .map((el) => el.getAttribute('data-artwork-id')))].slice(0, 3)
  );
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  const press = async (id, key) => {
    const card = page.locator(`[data-artwork-id="${id}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.keyboard.press(key);
    await sleep(300);
  };
  await press(ids[0], 'p');
  await press(ids[1], 'x');
  await press(ids[2], 'x');
  return ids;
};

// --- one session per class ---------------------------------------------------

const session = {
  ask: async (browser, base, index) => {
    const prompt = ASKS[index % ASKS.length];
    const { context, page, errors } = await openPage(browser, base);
    try {
      const timing = await typeTurn(page, prompt);
      return [{ class: 'ask', prompt, timing, errors }];
    } finally {
      await context.close();
    }
  },

  redeal: async (browser, base, index) => {
    const prompt = REDEALS[index % REDEALS.length];
    const { context, page, errors } = await openPage(browser, base, 'warm landscape');
    try {
      const flagged = await flagBoard(page);
      const timing = await typeTurn(page, prompt);
      return [{ class: 'redeal', prompt, flagged, timing, errors }];
    } finally {
      await context.close();
    }
  },

  correction: async (browser, base, index) => {
    const brief = DRAFTS[index % DRAFTS.length];
    const correction = CORRECTIONS[index % CORRECTIONS.length];
    const { context, page, errors } = await openPage(browser, base);
    try {
      const draft = await typeTurn(page, brief);
      await sleep(1500);
      const drafted = await readShow(page);
      const turns = [{ class: 'draft', prompt: brief, timing: draft, show: drafted, errors: [...errors] }];
      if (!drafted.works) {
        turns.push({ class: 'correction', prompt: correction, timing: null, skipped: 'the draft hung nothing' });
        return turns;
      }
      const already = (
        await page.evaluate(() => window.__paillette_webmcp.timing({ quiet: true }))
      ).length;
      const statement = page.locator('[aria-label="Exhibition statement"]');
      await statement.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type(correction, { delay: 4 });
      // A paragraph commits on the modifier; the timer starts here, on the page.
      await page.keyboard.press('Control+Enter');
      const timing = await nextTiming(page, already);
      await sleep(1500);
      turns.push({ class: 'correction', prompt: correction, timing, show: await readShow(page), errors });
      return turns;
    } finally {
      await context.close();
    }
  },
};

const PLAN = { ask: 10, redeal: 5, correction: 5 };

export const runTimedTurns = async ({ base, argv }) => {
  const label = argValue(argv, 'label', 'run');
  const classes = argValue(argv, 'classes', 'correction,ask,redeal').split(',');
  const countOverride = argValue(argv, 'count', null);
  const retries = Number(argValue(argv, 'retries', '2'));

  mkdirSync(LATENCY_DIR, { recursive: true });
  const file = path.join(LATENCY_DIR, `${label}.json`);
  const output = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : { label, base, git: gitSha(), startedAt: new Date().toISOString(), turns: [] };
  const save = () => {
    output.finishedAt = new Date().toISOString();
    writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
  };

  const { resolveBrowserDriver } = await import('../../scripts/demo/browser.mjs');
  const { chromium } = await resolveBrowserDriver();
  // The same override verify-demo-path.mjs takes, for a machine whose
  // installed browser is not the build the workspace's driver expects.
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
  );

  try {
    for (const kind of classes) {
      const count = Number(countOverride ?? PLAN[kind] ?? 0);
      // Index continues from what this label already holds, so a resumed run
      // types the next prompt rather than the first one again.
      const done = output.turns.filter((turn) => turn.class === kind && !turn.discarded).length;
      for (let i = done; i < done + count; i += 1) {
        for (let attempt = 0; attempt <= retries; attempt += 1) {
          let turns;
          try {
            turns = await session[kind](browser, base, i);
          } catch (error) {
            turns = [{ class: kind, index: i, error: String(error).slice(0, 300), timing: null }];
          }
          const refused = turns.some((turn) => turn.timing?.labelsRefused);
          const missing = turns.some((turn) => turn.class === kind && !turn.timing && !turn.skipped);
          for (const turn of turns) {
            output.turns.push({
              ...turn,
              index: i,
              attempt,
              at: new Date().toISOString(),
              ...(refused ? { discarded: 'labels refused by the hourly cap' } : {}),
              ...(missing && !refused ? { discarded: 'no timing record' } : {}),
            });
          }
          save();
          for (const turn of turns) {
            const t = turn.timing;
            log(
              `${label} ${turn.class.padEnd(10)} #${i} ` +
                (t
                  ? `total ${t.totalMs}ms note ${t.noteMs ?? '-'}ms calls ${t.modelCallCount} nudges ${t.nudges} ` +
                    `model ${t.breakdown.modelMs} tools ${t.breakdown.toolsMs} tokens ${t.breakdown.promptTokens}` +
                    (t.labelsRefused ? ' LABELS REFUSED' : '')
                  : `no timing (${turn.error ?? turn.skipped ?? 'timed out'})`)
            );
          }
          if (!refused && !missing) break;
          if (refused && attempt < retries) {
            const wait = msToNextHour();
            log(`  labels refused; waiting ${Math.round(wait / 1000)}s for the next hour`);
            await sleep(wait);
          }
        }
      }
    }
  } finally {
    await browser.close();
    save();
  }
  log(`\nwrote ${path.relative(process.cwd(), file)}`);
  summarise([file]);
  return 0;
};

// --- reading the runs back -----------------------------------------------------

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(Math.max(1, Math.ceil((p / 100) * sorted.length)), sorted.length) - 1];
};
const median = (values) => percentile(values, 50);
const sum = (values) => values.reduce((a, b) => a + b, 0);

export const statsFor = (turns) => {
  const kept = turns.filter((turn) => turn.timing && !turn.discarded);
  const t = kept.map((turn) => turn.timing);
  const field = (pick) => t.map(pick);
  const total = sum(field((x) => x.totalMs));
  return {
    n: t.length,
    p50: median(field((x) => x.totalMs)),
    p95: percentile(field((x) => x.totalMs), 95),
    noteP50: median(field((x) => x.noteMs).filter((v) => v !== null)),
    notes: field((x) => x.noteMs).filter((v) => v !== null).length,
    callsP50: median(field((x) => x.modelCallCount)),
    callsMean: t.length ? +(sum(field((x) => x.modelCallCount)) / t.length).toFixed(2) : null,
    nudges: sum(field((x) => x.nudges)),
    promptTokensP50: median(field((x) => x.breakdown.promptTokens)),
    firstCallPromptTokensP50: median(
      t.map((x) => x.modelCalls[0]?.server?.promptTokens).filter((v) => typeof v === 'number')
    ),
    // Shares of all the time in the class, not medians of shares.
    share: total
      ? {
          model: +(sum(field((x) => x.breakdown.modelMs)) / total).toFixed(3),
          serverModel: +(sum(field((x) => x.breakdown.serverModelMs)) / total).toFixed(3),
          tools: +(sum(field((x) => x.breakdown.toolsMs)) / total).toFixed(3),
          nudges: +(sum(field((x) => x.breakdown.nudgeMs)) / total).toFixed(3),
          other: +(sum(field((x) => x.breakdown.otherMs)) / total).toFixed(3),
        }
      : null,
  };
};

export const summarise = (files) => {
  const rows = [];
  for (const file of files) {
    const run = JSON.parse(readFileSync(file, 'utf8'));
    for (const kind of ['ask', 'redeal', 'correction', 'draft']) {
      const turns = run.turns.filter((turn) => turn.class === kind);
      if (!turns.length) continue;
      rows.push({ run: run.label, class: kind, discarded: turns.filter((x) => x.discarded).length, ...statsFor(turns) });
    }
  }
  for (const row of rows) {
    log(
      `${row.run.padEnd(14)} ${row.class.padEnd(10)} n=${row.n} (discarded ${row.discarded}) ` +
        `p50 ${row.p50}ms p95 ${row.p95}ms note-p50 ${row.noteP50}ms calls-p50 ${row.callsP50} nudges ${row.nudges} ` +
        `tokens-p50 ${row.promptTokensP50} first-call-tokens-p50 ${row.firstCallPromptTokensP50} ` +
        `share ${JSON.stringify(row.share)}`
    );
  }
  return rows;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--summarise') {
    const rows = summarise(argv.slice(1).filter((arg) => !arg.startsWith('--')));
    if (argv.includes('--json')) log(JSON.stringify(rows, null, 2));
  } else {
    const base = argv.find((arg) => !arg.startsWith('--')) ?? 'https://paillette-stg.berlayar.ai';
    process.exit(await runTimedTurns({ base, argv }));
  }
}
