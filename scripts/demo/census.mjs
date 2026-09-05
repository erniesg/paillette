/**
 * The tool-call census, taken by typing.
 *
 * Iteration 5's critique counted 508 model-chosen tool calls across every
 * transcript the night produced and found `flag_artworks` 0,
 * `compare_artworks` 0, `search_by_exemplars` 0 — while every demonstration of
 * those three in every report had been driven through
 * `window.__paillette_webmcp.call`, the debug console. So the census is the
 * only measurement that settles it, and it has to be read off the model's own
 * responses rather than off anything a harness called.
 *
 * Everything here is typed into the utterance bar or pressed on the keyboard.
 * The debug harness is loaded (`?webmcp-debug`) because the page's own agent
 * uses it to dispatch, but this script never calls `__paillette_webmcp.call`
 * to *make* anything happen — only to read `get_view_context` back, which is a
 * read, and which is noted as `harnessReads` in the output so it can never be
 * confused with the census.
 *
 * It also measures the beat that Enter used to delete: the wall label and the
 * top of a picked card, before and after a deterministic redeal.
 *
 *   node scripts/demo/census.mjs <base-url> <out-dir> [runs]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/census';
const RUNS = Number(process.argv[4] ?? 3);
const QUERY = process.env.CENSUS_QUERY ?? 'storms at sea';

const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';
/** The two most natural follow-ups after flagging. Both produced nothing before. */
const FOLLOW_UPS = [
  'Narrow these down for me — I can only hang one.',
  'I’m torn. Help me decide.',
];

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => process.stdout.write(`${line}\n`);

/** Wait for the agent to stop working: the bar re-enables and stays enabled. */
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
  let quietSince = null;
  while (Date.now() - started < deadlineMs) {
    const busy = await bar.isDisabled().catch(() => false);
    if (!busy) {
      quietSince = quietSince ?? Date.now();
      if (Date.now() - quietSince > 3500) return Date.now() - started;
    } else {
      quietSince = null;
    }
    await sleep(250);
  }
  return -1;
};

/**
 * What is on screen, measured rather than described. Card geometry is read off
 * the first work the human picked, because "the picks do not move" is the
 * claim §7.1 makes about this frame.
 */
const readScreen = (page) =>
  page.evaluate(() => {
    const label = document.querySelector('.paillette-wall-label');
    const cards = [...document.querySelectorAll('[data-artwork-id]')];
    const picked = cards.find((el) => el.getAttribute('data-flag') === 'pick');
    const box = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null);
    const inks = new Set(
      [...document.querySelectorAll('[data-provenance]')]
        .map((el) => el.getAttribute('data-provenance'))
        .filter((value) => value && value !== 'none')
    );
    return {
      note: label?.textContent?.trim() ?? null,
      noteProvenance: label?.getAttribute('data-provenance') ?? null,
      pickedId: picked?.getAttribute('data-artwork-id') ?? null,
      pickedTop: box(picked),
      firstCardTop: box(cards[0]),
      cards: cards.length,
      agentFlags: cards.filter(
        (el) => el.getAttribute('data-flag-by') === 'agent'
      ).length,
      compareOpen: Boolean(
        document.querySelector('[data-compare-room]')
      ),
      inks: [...inks],
      transcript: [
        ...document.querySelectorAll(
          'section[aria-label="Ask the agent"] ol li p'
        ),
      ].map((p) => ({
        provenance: p.getAttribute('data-provenance'),
        text: p.textContent?.trim() ?? '',
      })),
    };
  });

const main = async () => {
  const browser = await chromium.launch();
  const runs = [];
  /** Every tool the model chose, across every run. This is the census. */
  const census = {};

  for (let run = 1; run <= RUNS; run += 1) {
    const dir = path.join(OUT, `run-${run}`);
    await mkdir(dir, { recursive: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    /** The model's own tool calls, read off the responses. */
    const chosen = [];
    /** System messages the page appended — the post-conditions firing. */
    const nudges = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/api/public-agent/turn')) return;
      try {
        const body = await response.json();
        for (const call of body?.data?.message?.tool_calls ?? []) {
          chosen.push(call.function?.name);
          census[call.function?.name] = (census[call.function?.name] ?? 0) + 1;
        }
      } catch {
        // A non-JSON body is an error page; the run records it elsewhere.
      }
    });
    await page.route('**/api/public-agent/turn', async (route) => {
      try {
        const body = JSON.parse(route.request().postData() ?? 'null');
        const last = body?.messages?.at(-1);
        if (last?.role === 'system') nudges.push(String(last.content).slice(0, 160));
      } catch {
        // Unparseable request bodies are not what this measures.
      }
      await route.continue();
    });

    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error.message)));
    const shot = (name) =>
      page.screenshot({ path: path.join(dir, `${name}.png`) });
    const record = { run, steps: [], chosen: [], nudges: [] };
    const step = (label, detail) => {
      record.steps.push({ label, ...detail });
      log(`  run ${run} · ${label}: ${JSON.stringify(detail).slice(0, 260)}`);
    };

    await page.goto(
      `${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`,
      { waitUntil: 'domcontentloaded', timeout: 60_000 }
    );
    await page.waitForFunction(
      () => document.querySelectorAll('[data-artwork-id]').length > 0,
      { timeout: 60_000 }
    );
    await page.waitForFunction(
      async () => ((await window.__paillette_webmcp?.tools?.()) ?? []).length > 0,
      { timeout: 45_000 }
    );
    await sleep(1500);

    // --- the human's hands: two X and one P ------------------------------
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('[data-artwork-id]')].map((el) =>
        el.getAttribute('data-artwork-id')
      )
    );
    for (const target of [
      { id: ids[0], key: 'x' },
      { id: ids[1], key: 'x' },
      { id: ids[2], key: 'p' },
    ]) {
      await page.evaluate(() => document.activeElement?.blur?.());
      const card = page.locator(`[data-artwork-id="${target.id}"]`).first();
      await card.scrollIntoViewIfNeeded();
      await card.hover();
      await page.keyboard.press(target.key);
      await sleep(250);
    }
    await shot('a-flagged');

    // --- Enter on an empty bar: the deterministic beat --------------------
    const before = await readScreen(page);
    const modelCallsBefore = chosen.length;
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Enter');
    await page
      .waitForFunction(
        (previous) =>
          [...document.querySelectorAll('[data-artwork-id]')]
            .map((el) => el.getAttribute('data-artwork-id'))
            .join(',') !== previous,
        ids.join(','),
        { timeout: 60_000 }
      )
      .catch(() => {});
    await sleep(2500);
    const after = await readScreen(page);
    step('Enter on an empty bar', {
      modelCallsDuring: chosen.length - modelCallsBefore,
      noteBefore: before.note,
      noteAfter: after.note,
      noteProvenanceAfter: after.noteProvenance,
      pickedTopBefore: before.pickedTop,
      pickedTopAfter: after.pickedTop,
      pickMoved:
        before.pickedTop !== null && after.pickedTop !== null
          ? after.pickedTop - before.pickedTop
          : null,
      inks: after.inks,
    });
    await shot('b-after-redeal');

    /*
     * And again, board to board.
     *
     * The first Enter is grid-to-board: the search form folds away and the
     * whole page re-lays out, so a card moving there is the fold, not the
     * defect. §7.1's claim — "the picks do not move" — is about one deal
     * becoming the next, which is what this measures.
     */
    const boardIds = await page.evaluate(() =>
      [...document.querySelectorAll('[data-artwork-id]')].map((el) =>
        el.getAttribute('data-artwork-id')
      )
    );
    const second = boardIds.find((id) => id !== after.pickedId);
    if (second) {
      await page.evaluate(() => document.activeElement?.blur?.());
      const card = page.locator(`[data-artwork-id="${second}"]`).first();
      await card.hover();
      await page.keyboard.press('p');
      await sleep(400);
    }
    const beforeAgain = await readScreen(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Enter');
    await page
      .waitForFunction(
        (previous) =>
          [...document.querySelectorAll('[data-artwork-id]')]
            .map((el) => el.getAttribute('data-artwork-id'))
            .join(',') !== previous,
        boardIds.join(','),
        { timeout: 60_000 }
      )
      .catch(() => {});
    await sleep(2500);
    const afterAgain = await readScreen(page);
    step('Enter again, board to board', {
      noteBefore: beforeAgain.note,
      noteAfter: afterAgain.note,
      pickedTopBefore: beforeAgain.pickedTop,
      pickedTopAfter: afterAgain.pickedTop,
      pickMoved:
        beforeAgain.pickedTop !== null && afterAgain.pickedTop !== null
          ? afterAgain.pickedTop - beforeAgain.pickedTop
          : null,
      firstCardMoved:
        beforeAgain.firstCardTop !== null && afterAgain.firstCardTop !== null
          ? afterAgain.firstCardTop - beforeAgain.firstCardTop
          : null,
    });
    await shot('b2-after-second-redeal');

    // --- the typed instruction, and the two natural follow-ups -----------
    const bar = page.locator('input[aria-label="Ask the agent"]');
    /*
     * Answer a two-up if one is open, rather than reaching past it.
     *
     * §7.3: compare is a room, not a dialog — two works at large scale and
     * nothing else on screen — so when the agent opens one, the bar is
     * genuinely not there to type into. The click is the human's next turn
     * either way: gestures are utterances.
     */
    const answerCompare = async () => {
      const room = page.locator('[data-compare-room]');
      if (!(await room.count())) return null;
      const choice = page.locator('[data-compare-room] [aria-label^="Choose "]').first();
      const name = await choice.getAttribute('aria-label');
      await choice.click();
      const quietMs = await waitForQuiet(page);
      await sleep(1500);
      const screen = await readScreen(page);
      step('answered the two-up', {
        chose: name,
        quietMs,
        agentFlagsOnBoard: screen.agentFlags,
        note: screen.note,
      });
      await shot('c-compare-answered');
      return name;
    };

    const typed = [SOFA, ...FOLLOW_UPS];
    for (const [index, instruction] of typed.entries()) {
      await answerCompare();
      const at = chosen.length;
      await bar.click();
      await bar.fill(instruction);
      await bar.press('Enter');
      const quietMs = await waitForQuiet(page);
      await sleep(1500);
      const screen = await readScreen(page);
      step(`typed ${index + 1}`, {
        instruction,
        quietMs,
        tools: chosen.slice(at),
        agentFlagsOnBoard: screen.agentFlags,
        compareOpen: screen.compareOpen,
        note: screen.note,
        inks: screen.inks,
      });
      await shot(`c-typed-${index + 1}`);
    }

    await answerCompare();

    // A read, not a drive. Named so it can never be mistaken for the census.
    record.harnessReads = await page
      .evaluate(async () => {
        const raw = await window.__paillette_webmcp.call('get_view_context', {});
        const parsed = Array.isArray(raw?.content)
          ? JSON.parse(raw.content[0].text)
          : raw;
        return {
          picks: parsed?.flags?.picks?.length ?? 0,
          rejects: parsed?.flags?.rejects?.length ?? 0,
          provisional: parsed?.flags?.provisional?.length ?? 0,
        };
      })
      .catch(() => null);

    record.chosen = chosen;
    record.nudges = nudges;
    record.errors = errors;
    runs.push(record);
    await ctx.close();
    await writeFile(
      path.join(OUT, 'census.json'),
      `${JSON.stringify({ census, runs }, null, 2)}\n`
    );
    if (run < RUNS) await sleep(4000);
  }

  await browser.close();

  log('\n=== the census, model-chosen tool calls only ===');
  const total = Object.values(census).reduce((sum, n) => sum + n, 0);
  for (const [name, count] of Object.entries(census).sort((a, b) => b[1] - a[1])) {
    log(`  ${name} ${count}`);
  }
  for (const name of [
    'flag_artworks',
    'compare_artworks',
    'search_by_exemplars',
  ]) {
    if (!census[name]) log(`  ${name} 0   <-- still zero`);
  }
  log(`  total ${total}`);
};

await main();
