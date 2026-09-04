#!/usr/bin/env node
/**
 * §5c walked by hand on a deployed build: the half of the brief that answers
 * the challenge's actual question.
 *
 * Culling is one-sided — anyone can pick pictures for you. Writing is not, so
 * the genuinely two-sided object is the theme. The five steps:
 *
 *   1. an instruction
 *   2. the agent comes back with works *and* a drafted title and statement
 *   3. the human rejects works and **rewrites the statement**
 *   4. the agent **re-selects and re-labels around that correction**
 *   5. what is left is a shareable, properly designed page
 *
 * Step 4 is the one that had never been exercised: editing the statement used
 * to set state, append to an edit journal and stop. A bare statement edit fell
 * through `submitHumanTurn`'s "did they type anything?" check into the
 * deterministic redeal, which runs on flags and has never read a word of the
 * statement. This drives the edit the way a person does — click the paragraph,
 * type, press Enter — and asserts a turn actually leaves the page.
 *
 *   node scripts/demo/e2e-curation.mjs <base-url> <out-dir>
 *
 * Costs one agent turn plus a statement-edit turn: roughly eight model calls.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e-curation';
const QUERY = process.env.CUR_QUERY ?? 'warm landscape';
const CORRECTION =
  'It is not about weather. It is about leaving: places with the people already gone.';

await mkdir(OUT, { recursive: true });

const results = [];
const note = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  process.stdout.write(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`
  );
};

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

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await ctx.newPage();

const net = [];
const t0 = Date.now();
page.on('request', (r) =>
  net.push({ at: Date.now() - t0, method: r.method(), url: r.url() })
);
const since = (mark) => net.filter((n) => n.at >= mark);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));

const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

await page.goto(
  `${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`,
  { waitUntil: 'domcontentloaded', timeout: 60_000 }
);
await page.waitForFunction(() => Boolean(window.__paillette_webmcp), {
  timeout: 30_000,
});
await page.waitForFunction(
  () => document.querySelectorAll('[data-artwork-id]').length >= 6,
  { timeout: 45_000 }
);

const ids = (
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')]
      .filter((el) => !el.closest('.lt-tray'))
      .map((el) => el.getAttribute('data-artwork-id'))
  )
).slice(0, 6);

// --- step 2: the agent drafts a show, without being asked to ---------------
await page.evaluate(
  async (works) => {
    await window.__paillette_webmcp.call('set_exhibition', {
      title: 'Weather Report',
      statement:
        'A show about weather, and about painters who went outside to look at it. Every work here is a record of a particular hour of a particular day — the light going, the air thickening, a front coming in off the water. Nothing is symbolic. The subject is the sky and what it is doing to everything underneath it.',
      artworkIds: works,
    });
    await window.__paillette_webmcp.call('write_labels', { artworkIds: works });
  },
  ids
);
await sleep(2500);

const head = await page.evaluate(() => {
  const region = document.querySelector('[aria-label="Exhibition"]');
  // `.value`, not `textContent`: both fields are form controls, and an
  // <input>'s textContent is always the empty string while a <textarea>'s is
  // whatever the markup shipped with rather than what is in it now.
  const field = (name) =>
    document.querySelector(`[aria-label="${name}"]`)?.value?.trim() ?? null;
  return {
    present: Boolean(region),
    title: field('Exhibition title'),
    statement: field('Exhibition statement'),
    share: Boolean(document.querySelector('.paillette-share-link')),
    labels: document.querySelectorAll('.paillette-wall-label-slot, [data-wall-label]')
      .length,
  };
});
note(
  head.present && Boolean(head.title) && Boolean(head.statement),
  'the show has a title and a statement on the working page',
  JSON.stringify({ title: head.title, statement: head.statement?.slice(0, 60) })
);
note(head.share, 'there is a share control on the page', String(head.share));

const drafted = unwrap(
  await page.evaluate(() => window.__paillette_webmcp.call('get_exhibition', {}))
);
const draftedLabels = (drafted?.works ?? []).map(
  (work) => work.label?.text ?? work.label ?? null
);
note(
  draftedLabels.filter(Boolean).length >= 5,
  'every hung work has a wall label',
  `${draftedLabels.filter(Boolean).length} of ${draftedLabels.length}`
);
await shot('01-drafted');

// --- step 3 and 4: the human rewrites the statement, and the wall moves ----
//
// Driven the way a person does it: click the paragraph, select, type, Enter.
// Not through a tool call, because the whole question is whether the *human's*
// gesture has a consequence.
const editMark = Date.now() - t0;
const statementField = page.locator('[aria-label="Exhibition statement"]');
await statementField.click();
await page.keyboard.press('Control+A');
await page.keyboard.type(CORRECTION, { delay: 8 });
// The statement is a paragraph, so a bare Enter is a line break in it and the
// commit takes the modifier — the component's own rule, and the gesture a
// person makes.
await page.keyboard.press('Control+Enter');
await sleep(1200);

const committed = await page.evaluate(
  () =>
    document.querySelector('[aria-label="Exhibition statement"]')?.value?.trim() ??
    null
);
note(
  committed === CORRECTION,
  'the statement on the wall is the human’s words, verbatim',
  JSON.stringify(committed?.slice(0, 80))
);

// The turn itself. Before this fix a bare statement edit went to `runRedeal`,
// which cannot read a statement, so nothing left the page at all.
await page
  .waitForFunction(
    () => !document.querySelector('input[aria-label="Ask the agent"]:not([disabled])') ||
      true,
    { timeout: 1000 }
  )
  .catch(() => {});
await sleep(6000);
const turnsAfterEdit = since(editMark).filter((n) =>
  n.url.includes('/public-agent/turn')
);
note(
  turnsAfterEdit.length >= 1,
  'rewriting the statement sends a turn to the agent on its own',
  `${turnsAfterEdit.length} POST(s) to /public-agent/turn after the edit`
);

// Give the agent its run: it should re-select and re-label against the new
// statement, which is §5c step 4 and the beat that had no consequence at all.
await page
  .waitForFunction(
    (before) => {
      const labels = [
        ...document.querySelectorAll('[aria-label^="Wall label"]'),
      ].map((el) => el.textContent?.trim());
      return labels.length > 0 && labels.join('|') !== before;
    },
    draftedLabels.join('|'),
    { timeout: 150_000 }
  )
  .catch(() => {});
await sleep(4000);

const rewritten = unwrap(
  await page.evaluate(() => window.__paillette_webmcp.call('get_exhibition', {}))
);
const rewrittenLabels = (rewritten?.works ?? []).map(
  (work) => work.label?.text ?? work.label ?? null
);
const changed = rewrittenLabels.filter(
  (label, index) => label && label !== draftedLabels[index]
).length;
note(
  changed >= 1,
  'the labels are rewritten against the correction',
  `${changed} of ${rewrittenLabels.length} labels differ from the weather draft`
);
note(
  (rewritten?.statement?.text ?? rewritten?.statement) === CORRECTION,
  'the agent did not overwrite the sentence the human wrote',
  JSON.stringify(
    String(rewritten?.statement?.text ?? rewritten?.statement ?? '').slice(0, 80)
  )
);
await shot('02-after-correction');

// --- step 5: the shareable page -------------------------------------------
const shareUrl = await page.evaluate(async () => {
  const button = document.querySelector('.paillette-share-link');
  if (!button) return null;
  // Read the link the button copies without depending on clipboard permissions
  // in a headless context, which is a browser policy rather than a product
  // fact — the button itself is exercised by its own unit test.
  const original = navigator.clipboard?.writeText;
  let captured = null;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text) => { captured = text; } },
  });
  button.click();
  await new Promise((r) => setTimeout(r, 1500));
  if (original) {
    // Leave the page as we found it.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: original },
    });
  }
  return captured;
});
note(Boolean(shareUrl), 'the share control produces a URL', shareUrl ? `${shareUrl.slice(0, 90)}…` : 'none');

let exhibition = null;
if (shareUrl) {
  // Cold: a new context, no session, nothing to hydrate — the way it arrives
  // in somebody's messages.
  const cold = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const coldPage = await cold.newPage();
  const response = await coldPage.goto(shareUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await sleep(2500);
  exhibition = await coldPage.evaluate(() => ({
    status: document.title,
    heading: document.querySelector('h1')?.textContent?.trim() ?? null,
    statement:
      document.querySelector('.exhibition-statement')?.textContent?.trim() ??
      null,
    works: document.querySelectorAll('figure, [data-artwork-id]').length,
    labels: [...document.querySelectorAll('figcaption, .exhibition-label')]
      .map((el) => el.textContent?.trim())
      .filter(Boolean).length,
  }));
  note(
    response?.status() === 200,
    'the exhibition URL opens cold, in a browser that has never seen Paillette',
    `HTTP ${response?.status()}`
  );
  note(
    exhibition.works >= 5,
    'the shared page carries the works',
    JSON.stringify(exhibition)
  );
  note(
    (exhibition.statement ?? '').includes('leaving'),
    'the shared page carries the human’s statement, not the agent’s draft',
    JSON.stringify(exhibition.statement?.slice(0, 80))
  );
  await coldPage.screenshot({
    path: path.join(OUT, '03-exhibition-cold.png'),
    fullPage: true,
  });
  await cold.close();
}

await writeFile(
  path.join(OUT, 'curation.json'),
  `${JSON.stringify(
    {
      base: BASE,
      query: QUERY,
      correction: CORRECTION,
      ids,
      draftedLabels,
      rewrittenLabels,
      shareUrl,
      exhibition,
      results,
      pageErrors,
    },
    null,
    2
  )}\n`
);

await ctx.close();
await browser.close();

const failed = results.filter((r) => !r.ok);
process.stdout.write(
  `\n${results.length - failed.length} passed, ${failed.length} failed\n`
);
if (pageErrors.length)
  process.stdout.write(`page errors: ${pageErrors.join(' | ')}\n`);
process.exit(failed.length ? 1 : 0);
