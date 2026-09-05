/**
 * Who chose to name the rooms.
 *
 * `room-agent-path.ts` proves that `annotate_atlas` works and that its effect
 * survives publishing, sharing and being opened cold — but it drives the tool
 * through `window.__paillette_webmcp.call`, the developer's back door. The room
 * report says so and refuses to claim the agent chose it. This asks the
 * question that refusal leaves open: **does a language model call
 * `annotate_atlas` because a person typed an ordinary sentence at it?**
 *
 * The only thing that can settle that is the model's own `tool_calls` on the
 * wire, so that is what this reads — the same way `agent-marks.mjs` and
 * `census.mjs` read them, off the response from `/api/public-agent/turn`.
 * Nothing in the first leg is driven through the debug handle. `?webmcp-debug`
 * is loaded only so the board and the show can be *read* back for the census.
 *
 * Two typed turns, because "split these" needs a "these": one that builds a
 * board, one that asks for the rooms. Then the human presses Copy link — the
 * page's own control — and the short code that comes back is the thing
 * `room-demo-path.ts` walks.
 *
 *   node scripts/demo/agent-rooms.mjs <base-url> <out-dir> [runs]
 *
 * Prints, per run, every tool the model chose and whether `annotate_atlas` was
 * among them. A run where it was not is a finding, not a crash: the census is
 * written either way.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/agent-rooms';
const RUNS = Number(process.argv[4] ?? 1);

/** What a curator types to get works on the board. */
const BRIEF =
  process.env.ROOMS_BRIEF ??
  'Build me a show about the coast — a dozen works, half of them working harbours and half of them empty shores.';
/**
 * And what they type to get the rooms. Ordinary words, a curator's words: the
 * tool is never named, because naming it would be the console call again in a
 * longer sentence.
 */
const SPLIT =
  process.env.ROOMS_SPLIT ??
  'Split these into two rooms: the working harbour and the empty shore.';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => process.stdout.write(`${line}\n`);

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

const waitForQuiet = async (page, deadlineMs = 240_000) => {
  const bar = page.locator('input[aria-label="Ask the agent"]');
  const started = Date.now();
  await page
    .waitForFunction(
      () =>
        document.querySelector('input[aria-label="Ask the agent"]')?.disabled ===
        true,
      { timeout: 30_000 }
    )
    .catch(() => {});
  let quietSince = null;
  while (Date.now() - started < deadlineMs) {
    const busy = await bar.isDisabled().catch(() => false);
    if (!busy) {
      quietSince = quietSince ?? Date.now();
      if (Date.now() - quietSince > 4000) return Date.now() - started;
    } else {
      quietSince = null;
    }
    await sleep(300);
  }
  return -1;
};

/** The board and the show as the page holds them. A read, never a drive. */
const readBoard = async (page) => {
  const view = unwrap(
    await page.evaluate(() => window.__paillette_webmcp.call('get_view_context', {}))
  );
  const show = unwrap(
    await page.evaluate(() => window.__paillette_webmcp.call('get_exhibition', {}))
  );
  const regions = (view?.regions ?? show?.regions ?? []).map((region) => ({
    label: region.label ?? null,
    by: region.by ?? null,
    works: (region.artworkIds ?? []).length,
  }));
  const works = (show?.works ?? []).map((work) => ({
    id: work.artworkId,
    label: work.label ?? null,
  }));
  return {
    regions,
    works,
    unlabelled: works.filter((work) => !work.label?.trim()).length,
    title: show?.title?.text ?? show?.title ?? null,
    onScreen: await page.evaluate(
      () => document.querySelectorAll('[data-artwork-id]').length
    ),
  };
};

const main = async () => {
  const browser = await chromium.launch();
  const runs = [];

  for (let run = 1; run <= RUNS; run += 1) {
    const dir = path.join(OUT, `run-${run}`);
    await mkdir(dir, { recursive: true });
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await ctx.newPage();

    /*
     * The census, off the wire.
     *
     * `chosen` is every tool the model asked for, in order, with the arguments
     * it passed. This is the whole evidence for the claim: a name in here came
     * out of the model's own `tool_calls`, and there is no path by which this
     * script could have put it there.
     */
    const chosen = [];
    const nudges = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/api/public-agent/turn')) return;
      try {
        const body = await response.json();
        for (const call of body?.data?.message?.tool_calls ?? []) {
          let args = null;
          try {
            args = JSON.parse(call.function?.arguments || '{}');
          } catch {
            args = { unparseable: call.function?.arguments };
          }
          chosen.push({ id: call.id, name: call.function?.name, args, result: null });
        }
      } catch {
        // An error page; recorded by the census staying empty, not by a throw.
      }
    });
    await page.route('**/api/public-agent/turn', async (route) => {
      try {
        const sent = JSON.parse(route.request().postData() ?? 'null');
        for (const message of sent?.messages ?? []) {
          if (message?.role !== 'tool') continue;
          const waiting = chosen.find(
            (entry) => entry.id === message.tool_call_id && entry.result === null
          );
          if (waiting) waiting.result = String(message.content ?? '').slice(0, 300);
        }
        const last = sent?.messages?.at(-1);
        if (last?.role === 'system') nudges.push(String(last.content).slice(0, 160));
      } catch {
        // Ignored; the census is read off the responses.
      }
      await route.continue();
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error.message)));
    const shot = (name) => page.screenshot({ path: path.join(dir, `${name}.png`) });

    const record = { run };
    await page.goto(`${BASE}/nga/search?webmcp-debug`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForFunction(() => Boolean(window.__paillette_webmcp), {
      timeout: 45_000,
    });
    await sleep(1500);

    const bar = page.locator('input[aria-label="Ask the agent"]');

    // --- turn one: get a board, by typing -------------------------------
    await bar.click();
    await bar.fill(BRIEF);
    await bar.press('Enter');
    record.briefMs = await waitForQuiet(page);
    await sleep(2500);
    record.afterBrief = await readBoard(page);
    record.briefTools = chosen.map((call) => call.name);
    log(
      `  run ${run} · brief in ${record.briefMs}ms: ` +
        `tools=${record.briefTools.join(',') || 'NONE'} ` +
        `works=${record.afterBrief.works.length} onScreen=${record.afterBrief.onScreen}`
    );
    await shot('01-board');

    if (!record.afterBrief.onScreen) {
      record.outcome = 'the drafting turn hung nothing';
      runs.push(record);
      await ctx.close();
      await writeFile(path.join(OUT, 'rooms.json'), `${JSON.stringify(runs, null, 2)}\n`);
      continue;
    }

    // --- turn two: ask for the rooms, in a curator's words --------------
    const at = chosen.length;
    await bar.click();
    await bar.fill(SPLIT);
    await bar.press('Enter');
    record.splitMs = await waitForQuiet(page);
    await sleep(3000);
    const after = await readBoard(page);
    record.after = after;
    record.splitTools = chosen.slice(at).map((call) => call.name);
    record.nudges = nudges;

    /*
     * The finding, stated as a boolean rather than as a paragraph. `chose` is
     * true only if `annotate_atlas` appears in the model's own tool_calls on
     * the turn where the human asked for rooms.
     */
    const annotate = chosen.slice(at).filter((call) => call.name === 'annotate_atlas');
    record.chose = annotate.length > 0;
    record.annotateCalls = annotate;
    log(
      `  run ${run} · split in ${record.splitMs}ms: ` +
        `tools=${record.splitTools.join(',') || 'NONE'}\n` +
        `           annotate_atlas chosen by the model: ${record.chose ? 'YES' : 'NO'} ` +
        `· regions on the board: ${
          after.regions.map((r) => `${r.label} (${r.works}, by ${r.by})`).join(' / ') || 'none'
        }`
    );
    if (nudges.length) log(`           nudges: ${nudges.length}`);
    await shot('02-rooms');

    // --- the human publishes: the page's own control --------------------
    const shareUrl = await page.evaluate(async () => {
      const button = document.querySelector('.paillette-share-link');
      if (!button) return null;
      // The clipboard needs a secure context and a permission this headless
      // run does not have; the button's own behaviour has a unit test. What is
      // wanted here is the URL it publishes.
      let captured = null;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => { captured = text; } },
      });
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return captured;
    });
    record.shareUrl = shareUrl;
    record.code = typeof shareUrl === 'string' ? shareUrl.split('/e/')[1] : null;

    // --- and the show a stranger opens has the model's rooms in it ------
    if (record.code) {
      const response = await fetch(
        `${BASE}/e/${record.code}?_data=routes%2Fe.%24code`
      ).catch(() => null);
      const published = response?.ok ? await response.json() : null;
      record.published = {
        works: published?.works?.length ?? 0,
        labels: (published?.works ?? []).filter((work) => work.label).length,
        regions: (published?.regions ?? []).map((region) => region.label),
      };
      log(
        `  run ${run} · published /e/${record.code}: ` +
          `${record.published.works} works, ${record.published.labels} labels, ` +
          `rooms: ${record.published.regions.join(' / ') || 'NONE'}`
      );
    }

    record.errors = errors;
    record.census = chosen;
    runs.push(record);
    await ctx.close();
    await writeFile(path.join(OUT, 'rooms.json'), `${JSON.stringify(runs, null, 2)}\n`);
    if (run < RUNS) await sleep(5000);
  }

  await browser.close();

  log('\n=== per run ===');
  for (const entry of runs) {
    if (entry.outcome) {
      log(`  run ${entry.run}: ${entry.outcome}`);
      continue;
    }
    log(
      `  run ${entry.run}: annotate_atlas ${entry.chose ? 'CHOSEN' : 'not chosen'} · ` +
        `split turn called ${entry.splitTools.join(',') || 'nothing'} · ` +
        `published ${entry.code ? `/e/${entry.code}` : 'nothing'} with ` +
        `${entry.published?.regions.length ?? 0} named room(s)`
    );
  }
  const walkable = runs.filter((entry) => (entry.published?.regions.length ?? 0) >= 2);
  if (walkable.length) {
    log(
      `\n  walk it:  CODE=${walkable[0].code} PAILLETTE_ORIGIN=${BASE} ` +
        `pnpm --filter web exec tsx scripts/room-demo-path.ts\n`
    );
  }
};

await main();
