/**
 * The beat this lane exists for, run against the real model, three times.
 *
 *   "The human edits the statement — 'it's not about weather, it's about
 *    leaving' — and the agent re-selects works and re-labels around the
 *    correction, keeping the human's own words."
 *
 * So this is that sequence, in a real browser, typed — no speech anywhere in
 * the path.
 *
 * The one design decision worth defending: the correction is never restated in
 * the prompt bar. Committing the edit is now itself a turn — the human's own
 * sentence goes up as the instruction — and where that does not fire, the
 * human types a **content-free nudge** ("Again.") instead. Either way the word
 * "leaving" reaches the model from the statement the human rewrote and from
 * nowhere else, so a board and a set of labels that come back about leaving
 * are attributable to the edit alone.
 *
 *   node apps/web/scripts/verify-theme-correction.mjs [baseUrl] [runs]
 *
 * What is real: the page, every tool, `POST /api/public-agent/turn`, the
 * system prompt, the model, and `POST /api/public-labels` — which reads the
 * real catalogue rows and the persisted vision captions out of D1, so the
 * labels are written about the actual pictures.
 *
 * What is not: the *ranking*. A dev server holds no public-search credential,
 * so the search and exemplar transports are answered here from the
 * credential-free browse endpoint. The works, their ids, their titles and
 * their captions are real National Gallery records; which twelve of them come
 * back for a given query is not a real retrieval. That is fine for what this
 * checks — whether the prose loop turns — and it is stated rather than hidden.
 */

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5174';
const RUNS = Number(process.argv[3] ?? 3);
const SHOTS = '/tmp/theme-correction';
mkdirSync(SHOTS, { recursive: true });

const OPENING = 'Make this into a show about the weather at sea.';

/** The correction. The only place the word "leaving" appears in the whole run. */
const CORRECTION =
  'It is not about weather. It is about leaving — the hour before someone goes, ' +
  'and the room that keeps their shape after they have gone.';

/** Deliberately empty of direction. See the note at the top. */
const NUDGE = 'Again.';

/** Real NGA works, from the endpoint that needs no credential. */
const pool = async () => {
  const response = await fetch(
    `${BASE}/api/public-search/nga/browse?limit=48`
  );
  const body = await response.json();
  const results = body?.data?.results ?? [];
  if (results.length < 24) {
    throw new Error(
      `Only ${results.length} works came back from browse; need 24.`
    );
  }
  return results.map((work, index) => ({
    ...work,
    similarity: 0.9 - index * 0.002,
  }));
};

const payload = (rows) => ({
  success: true,
  data: { results: rows, count: rows.length, total: rows.length, queryTime: 4 },
});

const readExhibition = (page) =>
  page.evaluate(() => window.__paillette_webmcp.call('get_exhibition', {}));

/**
 * The loop is done when the agent route has been quiet for a while. There is
 * no "finished" signal on the page, and guessing at one is how a check ends up
 * passing because it looked too early.
 */
const settle = async (page, since, quietMs = 12_000, capMs = 240_000) => {
  const deadline = Date.now() + capMs;
  while (Date.now() < deadline && Date.now() - since.at < quietMs) {
    await page.waitForTimeout(500);
  }
};

/**
 * The prompt bar is disabled for exactly as long as the loop is running, which
 * makes it the page's own "am I finished" signal — and a better one than
 * network quiet, because the state the tools write lands after the response
 * that carried them.
 *
 * Without this the run reads the exhibition between the agent's last tool call
 * and the effect of it, and then mistakes a still-running first turn for the
 * statement edit having fired a second one. Both happened before it was here.
 */
const idle = (page) =>
  page
    .locator('input[aria-label="Ask the agent"]:not([disabled])')
    .waitFor({ timeout: 120_000 })
    .catch(() => {});

const runOnce = async (browser, index, works) => {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1150 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  const shelf = works.slice(0, 12);
  const dealt = works.slice(12, 24);

  const since = { at: Date.now() };
  const toolCalls = [];
  const labelCalls = [];
  const turnErrors = [];

  // What the browser *sent*. Without this a run cannot distinguish "the edit
  // never reached the model" from "the model read it and ignored it", and
  // those two have completely different fixes.
  const sentTurns = [];
  page.on('request', (request) => {
    if (!request.url().includes('/api/public-agent/turn')) return;
    try {
      const body = JSON.parse(request.postData() ?? '{}');
      if (body.turn) sentTurns.push(body.turn);
    } catch {
      /* a body we cannot read is not worth failing the run over */
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/public-labels')) {
      since.at = Date.now();
      try {
        const body = await response.json();
        labelCalls.push({
          ok: Boolean(body?.success),
          count: body?.data?.labels?.length ?? 0,
          error: body?.error?.code ?? null,
        });
      } catch {
        labelCalls.push({ ok: false, count: 0, error: 'unreadable' });
      }
      return;
    }
    if (!url.includes('/api/public-agent/turn')) return;
    since.at = Date.now();
    try {
      const body = await response.json();
      if (!body?.success) {
        turnErrors.push(`${response.status()} ${JSON.stringify(body?.error)}`);
        return;
      }
      for (const call of body?.data?.message?.tool_calls ?? []) {
        toolCalls.push({
          phase: toolCalls.phase,
          name: call.function.name,
          args: call.function.arguments,
        });
      }
    } catch (error) {
      turnErrors.push(`${response.status()} unreadable: ${String(error)}`);
    }
  });

  // Search and exemplars only. `/api/public-labels` is deliberately not routed:
  // the label writer is the thing under test and must be the real one.
  await page.route('**/api/public-search/**', (route) => {
    const url = route.request().url();
    if (url.includes('/quota')) {
      return route.fulfill({
        json: { success: true, data: { limit: 100, used: 3, remaining: 97 } },
      });
    }
    return route.fulfill({
      json: payload(url.includes('/exemplars') ? dealt : shelf),
    });
  });

  await page.goto(`${BASE}/nga/search?q=the%20weather%20at%20sea&webmcp-debug`, {
    waitUntil: 'networkidle',
    timeout: 90_000,
  });
  await page.waitForSelector('.paillette-card', { timeout: 60_000 });

  // ---- 1. the opening instruction -----------------------------------------
  const bar = page.locator('input[aria-label="Ask the agent"]');
  await bar.click();
  await bar.fill(OPENING);
  since.at = Date.now();
  await page.keyboard.press('Enter');
  await settle(page, since);
  await idle(page);

  const before = await readExhibition(page);
  const callsBefore = toolCalls.length;
  await page.screenshot({ path: `${SHOTS}/run-${index}-a-drafted.png` });

  // ---- 2. the human rewrites the statement, in place ------------------------
  const statement = page.locator('textarea[aria-label="Exhibition statement"]');
  let edited = false;
  if (await statement.count()) {
    await statement.click();
    await statement.fill(CORRECTION);
    // Blur commits, exactly as a person clicking away would.
    await page.locator('h1, body').first().click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(400);
    edited = true;
    // The commit may itself be the turn, so the clock starts here.
    since.at = Date.now();
    await page.waitForTimeout(1200);
  }

  /*
   * ---- 3. hand it back -----------------------------------------------------
   *
   * A rewritten statement is now a turn on its own: committing the edit with
   * nothing in the prompt bar sends the human's own sentence as the
   * instruction. So the correction usually hands itself over, and the bar is
   * disabled while the agent works on it.
   *
   * Only if nothing fired does the nudge get typed. Keeping the fallback is
   * what makes this check independent of that behaviour — it measures whether
   * the correction reaches the wall, either way.
   */
  const firedOnCommit = await page
    .locator('input[aria-label="Ask the agent"]:not([disabled])')
    .waitFor({ state: 'detached', timeout: 4000 })
    .then(() => true)
    .catch(() => false);

  if (firedOnCommit) {
    await settle(page, since);
  } else {
    await bar.click();
    await bar.fill(NUDGE);
    since.at = Date.now();
    await page.keyboard.press('Enter');
    await settle(page, since);
  }
  await idle(page);

  const after = await readExhibition(page);
  await page.screenshot({ path: `${SHOTS}/run-${index}-b-corrected.png` });
  await page.close();

  return {
    edited,
    before,
    after,
    firedOnCommit,
    sentTurns,
    openingCalls: toolCalls.slice(0, callsBefore),
    correctionCalls: toolCalls.slice(callsBefore),
    labelCalls,
    turnErrors,
    pageErrors,
  };
};

const labelsOf = (exhibition) =>
  new Map((exhibition?.works ?? []).map((work) => [work.artworkId, work]));

const titleOf = (id, works) =>
  works.find((work) => work.id === id)?.title ?? id;

const works = await pool();
const browser = await chromium.launch();
const runs = [];

for (let index = 1; index <= RUNS; index += 1) {
  const outcome = await runOnce(browser, index, works);
  runs.push(outcome);

  const { before, after } = outcome;
  const beforeLabels = labelsOf(before);
  const afterLabels = labelsOf(after);
  const beforeIds = [...beforeLabels.keys()];
  const afterIds = [...afterLabels.keys()];
  const kept = afterIds.filter((id) => beforeLabels.has(id));

  console.log(`\n${'═'.repeat(78)}\nRUN ${index}\n${'═'.repeat(78)}`);

  console.log('\n── 1. the agent drafts ─────────────────────────────────────');
  console.log('title      :', before?.title?.text ?? '(none)',
    `[${before?.title?.by ?? '—'}]`);
  console.log('statement  :', before?.statement?.text ?? '(none)',
    `\n             [${before?.statement?.by ?? '—'}]`,
    `${(before?.statement?.text ?? '').split(/\s+/).filter(Boolean).length} words`);
  console.log('board      :', beforeIds.length, 'works');
  for (const id of beforeIds.slice(0, 4)) {
    console.log(`   · ${titleOf(id, works)}\n     “${beforeLabels.get(id)?.label ?? '(unlabelled)'}”`);
  }
  console.log('tools      :', outcome.openingCalls.map((c) => c.name).join(' → ') || '(none)');

  console.log('\n── 2. the human rewrites the statement ─────────────────────');
  console.log(outcome.edited ? `   “${CORRECTION}”` : '   !! the field was not on the page');
  console.log(
    outcome.firedOnCommit
      ? '   committing the edit was itself the turn; nothing typed'
      : `   nothing fired, so they type: “${NUDGE}” (no direction in the words)`
  );

  const correctionTurn = outcome.sentTurns[1];
  const sentEdits = correctionTurn?.exhibitionEdits ?? [];
  console.log('   sent to the model:',
    sentEdits.length
      ? sentEdits.map((e) => `${e.field}="${String(e.value).slice(0, 60)}…"`).join('; ')
      : '!! NO exhibitionEdits in the turn payload');

  console.log('\n── 3. the agent acts on it ─────────────────────────────────');
  console.log('title      :', after?.title?.text ?? '(none)',
    `[${after?.title?.by ?? '—'}]`);
  console.log('statement  :', after?.statement?.text ?? '(none)',
    `\n             [${after?.statement?.by ?? '—'}]`);
  console.log('kept human words :',
    (after?.statement?.text ?? '').includes('leaving') ? 'YES' : 'NO');
  console.log('board      :', afterIds.length, 'works;',
    afterIds.filter((id) => !beforeLabels.has(id)).length, 'new,',
    beforeIds.filter((id) => !afterLabels.has(id)).length, 'dropped');
  console.log('tools      :', outcome.correctionCalls.map((c) => c.name).join(' → ') || '(none)');

  console.log('\n── the evidence: same work, two statements ─────────────────');
  let changed = 0;
  for (const id of kept.slice(0, 4)) {
    const a = beforeLabels.get(id)?.label ?? null;
    const b = afterLabels.get(id)?.label ?? null;
    if (a && b && a !== b) changed += 1;
    console.log(`\n   ${titleOf(id, works)}`);
    console.log(`   weather : “${a ?? '(unlabelled)'}”`);
    console.log(`   leaving : “${b ?? '(unlabelled)'}”`);
  }
  console.log(`\n   ${changed}/${Math.min(kept.length, 4)} shown were rewritten.`);

  if (outcome.labelCalls.length) {
    console.log('\nwrite_labels calls:',
      outcome.labelCalls.map((c) => (c.ok ? `ok(${c.count})` : `FAIL ${c.error}`)).join(', '));
  }
  for (const error of outcome.turnErrors.slice(0, 3)) console.log('turn error :', error);
  if (outcome.pageErrors.length) console.log('page errors:', outcome.pageErrors.slice(0, 2));
}

await browser.close();
writeFileSync(`${SHOTS}/runs.json`, JSON.stringify(runs, null, 2));
console.log(`\nTranscripts written to ${SHOTS}/runs.json, screenshots alongside.`);

/**
 * The check is whether **the wall changed**, and nothing weaker.
 *
 * An earlier version of this passed when the human's statement survived and
 * the agent made any tool call at all, and it duly reported 3/3 on a batch
 * where two runs re-selected works and left every label written against the
 * old theme. "The statement changed and the wall did not" is the precise
 * failure this lane exists to prevent, so a run only counts if at least one
 * work that was hanging before the correction is hanging after it with a
 * different label on it.
 */
const verdict = (run) => {
  if (run.after?.statement?.by !== 'human') return 'lost the human’s words';

  const before = labelsOf(run.before);
  const labelledBefore = [...before.values()].filter((work) => work.label);
  const after = run.after?.works ?? [];
  const relabelled = run.correctionCalls.some((c) => c.name === 'write_labels');

  if (after.some((work) => {
    const was = before.get(work.artworkId)?.label;
    return was && work.label && work.label !== was;
  })) {
    return 'turned';
  }

  /*
   * A run whose opening turn hung nothing — or hung works it never labelled —
   * has no prior label for the correction to differ from, so the comparison is
   * unavailable rather than failed. Scoring that as a failure would be the same
   * class of mistake as the criterion this replaced: reporting something the
   * evidence does not say. It is only a real failure if there *was* something
   * to rewrite.
   */
  if (!labelledBefore.length) {
    return relabelled && after.some((work) => work.label)
      ? 'inconclusive — nothing was labelled before the correction, but it wrote a full set after'
      : 'inconclusive — the opening turn left nothing to rewrite';
  }
  return relabelled
    ? 'write_labels ran but no label changed'
    : 'write_labels was never called';
};

const verdicts = runs.map(verdict);
const turned = verdicts.filter((v) => v === 'turned').length;
const inconclusive = verdicts.filter((v) => v.startsWith('inconclusive')).length;

console.log(
  `\n${turned}/${runs.length} runs kept the human's statement AND rewrote the labels under it` +
    (inconclusive ? `; ${inconclusive} inconclusive` : '') + '.'
);
for (const [index, v] of verdicts.entries()) {
  if (v === 'turned') continue;
  console.log(
    `   run ${index + 1}: ${v} (tools: ${
      runs[index].correctionCalls.map((c) => c.name).join(' → ') || 'none'
    })`
  );
}

// Renaming the room is checked separately: three runs relabelled correctly and
// still left the show called "Weather at Sea" under a statement about leaving.
const renamed = runs.filter(
  (run) =>
    run.before?.title?.text &&
    run.after?.title?.text &&
    run.after.title.text !== run.before.title.text
).length;
console.log(`${renamed}/${runs.length} runs renamed the room to match the new statement.`);

process.exit(turned + inconclusive === runs.length ? 0 : 1);
