/**
 * §5c step 4, three times, typed — and the page a judge would actually open.
 *
 * The critique's measurement was 1 success in 4 by hand: one drafting turn that
 * produced nothing at all in 150s, one that relabelled nothing, one that
 * changed 0 labels and 0 works in 180s, and one that worked. And even the one
 * that worked ended with six newly-hung works carrying `labelBy: null`, so four
 * of the seven published `/e/:code` pages had no wall label anywhere on them.
 *
 * Everything here is typed or clicked. The show is drafted by typing an
 * instruction into the utterance bar, the correction is made by clicking the
 * statement and retyping it, and the link is taken from the page's own share
 * control. `?webmcp-debug` is loaded so `get_exhibition` can be *read* for the
 * per-run counts; nothing in this script drives the page through it.
 *
 *   node scripts/demo/e2e-correction.mjs <base-url> <out-dir> [runs]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e-correction';
const RUNS = Number(process.argv[4] ?? 3);

const BRIEF =
  'Build me a room about storms at sea — pick a dozen works, and write me a title and a statement for it.';
const CORRECTION =
  'It is not about weather. It is about leaving — the hour before someone goes, and the room that keeps their shape after they have gone.';

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

/** The show as the page holds it. A read through the harness, never a drive. */
const readShow = async (page) => {
  const show = unwrap(
    await page.evaluate(() =>
      window.__paillette_webmcp.call('get_exhibition', {})
    )
  );
  const works = (show?.works ?? []).map((work) => ({
    id: work.artworkId,
    label: work.label ?? null,
    labelBy: work.labelBy ?? null,
  }));
  return {
    title: show?.title?.text ?? show?.title ?? null,
    titleBy: show?.title?.by ?? null,
    statement: show?.statement?.text ?? show?.statement ?? null,
    statementBy: show?.statement?.by ?? null,
    statementTheirs: Boolean(show?.statement?.theirs),
    works,
    unlabelled: works.filter((work) => !work.label?.trim()).length,
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
    const chosen = [];
    const nudges = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/api/public-agent/turn')) return;
      try {
        const body = await response.json();
        for (const call of body?.data?.message?.tool_calls ?? []) {
          chosen.push(call.function?.name);
        }
      } catch {
        // Not JSON: an error page, which the run records elsewhere.
      }
    });
    await page.route('**/api/public-agent/turn', async (route) => {
      try {
        const last = JSON.parse(route.request().postData() ?? 'null')
          ?.messages?.at(-1);
        if (last?.role === 'system') {
          nudges.push(String(last.content).slice(0, 120));
        }
      } catch {
        // Ignored; the census is read off the responses.
      }
      await route.continue();
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error.message)));
    const shot = (name) =>
      page.screenshot({ path: path.join(dir, `${name}.png`) });

    const record = { run };
    await page.goto(`${BASE}/nga/search?webmcp-debug`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForFunction(() => Boolean(window.__paillette_webmcp), {
      timeout: 45_000,
    });
    await sleep(1500);

    // --- the drafting turn, typed ---------------------------------------
    const bar = page.locator('input[aria-label="Ask the agent"]');
    await bar.click();
    await bar.fill(BRIEF);
    await bar.press('Enter');
    record.draftMs = await waitForQuiet(page);
    await sleep(2500);
    const drafted = await readShow(page);
    record.drafted = drafted;
    record.draftTools = [...chosen];
    log(
      `  run ${run} · drafted in ${record.draftMs}ms: ` +
        `title=${JSON.stringify(drafted.title)} works=${drafted.works.length} ` +
        `unlabelled=${drafted.unlabelled}`
    );
    await shot('01-drafted');

    if (!drafted.works.length) {
      record.outcome = 'the drafting turn hung nothing';
      runs.push(record);
      await ctx.close();
      await writeFile(
        path.join(OUT, 'correction.json'),
        `${JSON.stringify(runs, null, 2)}\n`
      );
      continue;
    }

    // --- the correction, typed into the statement -----------------------
    const at = chosen.length;
    const statement = page.locator('[aria-label="Exhibition statement"]');
    await statement.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(CORRECTION, { delay: 6 });
    // A paragraph takes the modifier to commit; a bare Enter is a line break.
    await page.keyboard.press('Control+Enter');
    record.correctionMs = await waitForQuiet(page);
    await sleep(3000);
    const after = await readShow(page);
    record.after = after;
    record.correctionTools = chosen.slice(at);
    record.nudges = nudges;

    const before = new Map(drafted.works.map((work) => [work.id, work.label]));
    const now = new Map(after.works.map((work) => [work.id, work.label]));
    record.counts = {
      added: [...now.keys()].filter((id) => !before.has(id)).length,
      dropped: [...before.keys()].filter((id) => !now.has(id)).length,
      relabelled: [...now.entries()].filter(
        ([id, label]) => before.has(id) && label && label !== before.get(id)
      ).length,
      unlabelled: after.unlabelled,
      titleChanged: after.title !== drafted.title,
      statementIsTheirs: after.statement === CORRECTION,
    };
    log(
      `  run ${run} · correction in ${record.correctionMs}ms: ` +
        JSON.stringify(record.counts)
    );
    await shot('02-after-correction');

    // --- the page a judge opens -----------------------------------------
    const shareUrl = await page.evaluate(async () => {
      const button = document.querySelector('.paillette-share-link');
      if (!button) return null;
      // The clipboard needs a secure context and a permission this headless
      // run does not have; the button's own behaviour has a unit test. What
      // is wanted here is the URL it publishes.
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

    if (shareUrl) {
      const cold = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const coldPage = await cold.newPage();
      const response = await coldPage.goto(shareUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await sleep(2500);
      record.published = {
        status: response?.status() ?? null,
        ...(await coldPage.evaluate(() => ({
          title: document.querySelector('h1')?.textContent?.trim() ?? null,
          statement:
            document
              .querySelector('.exhibition-statement, [data-exhibition-statement]')
              ?.textContent?.trim() ?? null,
          works: document.querySelectorAll('figure').length,
          labels: [
            ...document.querySelectorAll('figcaption, .exhibition-label'),
          ].filter((el) => (el.textContent ?? '').trim().length > 30).length,
        }))),
      };
      log(`  run ${run} · published ${shareUrl}: ${JSON.stringify(record.published)}`);
      await coldPage.screenshot({
        path: path.join(dir, '03-published.png'),
        fullPage: true,
      });
      await cold.close();
    }

    record.errors = errors;
    runs.push(record);
    await ctx.close();
    await writeFile(
      path.join(OUT, 'correction.json'),
      `${JSON.stringify(runs, null, 2)}\n`
    );
    if (run < RUNS) await sleep(5000);
  }

  await browser.close();

  log('\n=== per run ===');
  for (const run of runs) {
    log(
      `  run ${run.run}: ${JSON.stringify(run.counts ?? run.outcome)}` +
        (run.published
          ? ` · published ${run.published.works} works, ${run.published.labels} labels`
          : '')
    );
  }
};

await main();
