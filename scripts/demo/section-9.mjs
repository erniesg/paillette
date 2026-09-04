/**
 * §9, the definition of done, as one sequence on a real deploy.
 *
 * Every clause of §9 has been asserted somewhere in this repo's reports. None
 * of them had been run *together*, in order, on one board, by a harness that
 * types — which is the only thing that answers "does the demo work". This does
 * that, N times, and writes down what failed.
 *
 * The five clauses, verbatim:
 *
 *   1. P/X/U/C and Enter work on the grid; flags persist per session;
 *      get_view_context returns them.
 *   2. Enter on an empty bar redeals from human flags with picks in place and
 *      no LLM call.
 *   3. Given the sofa prompt and two X presses, the agent's redeal note refers
 *      to the content of what was rejected.
 *   4. A voice utterance lands in the editable field; the note is spoken only
 *      after voice input.
 *   5. Two colours of ink visible in every state.
 *
 * **Voice is a mode of this script, not a dependency of it.** `--voice=off`
 * deletes SpeechRecognition and speechSynthesis before the page loads and runs
 * clauses 1, 2, 3 and 5 with no speech API in the browser at all; that is the
 * text-first path and it is the one the demo is filmed on. `--voice=stub`
 * installs a fake recogniser and records every utterance the page speaks, which
 * is the only way to check clause 4 in both directions — that a spoken turn is
 * answered aloud and that a typed turn is *not*.
 *
 *   node scripts/demo/section-9.mjs <base-url> <out-dir> [runs] [--voice=off|stub]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const flags = process.argv.slice(2).filter((arg) => arg.startsWith('--'));
const BASE = args[0] ?? 'https://paillette-stg.berlayar.ai';
const OUT = args[1] ?? '/tmp/section-9';
const RUNS = Number(args[2] ?? 3);
const VOICE =
  flags.find((flag) => flag.startsWith('--voice='))?.split('=')[1] ?? 'off';

const QUERY = process.env.SECTION9_QUERY ?? 'storms at sea';
const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';
const SPOKEN = 'Something quieter, please.';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => process.stdout.write(`${line}\n`);

/**
 * The browser the demo is filmed in, or one that has never heard of speech.
 *
 * Installed before any page script runs, so the page's own feature detection
 * sees exactly what a browser without the API would show it. Nothing here
 * patches the page — only the platform underneath it.
 */
const voiceHarness = (mode) => `
  window.__spoken = [];
  window.__recognisers = [];
  if (${mode === 'off'}) {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
  } else {
    class FakeRecognition {
      constructor() {
        this.continuous = false;
        this.interimResults = false;
        this.lang = 'en-US';
        window.__recognisers.push(this);
      }
      start() { this.started = true; }
      stop() { this.stopped = true; this.onend && this.onend(); }
      abort() { this.aborted = true; }
      // Drive it the way the platform would. The shape is exactly what
      // readTranscripts walks: a results list of alternatives, each carrying
      // isFinal and a [0].transcript. (No backticks in here — this whole
      // harness is a template literal.)
      __say(text) {
        const alternatives = [{ transcript: text }];
        alternatives.isFinal = true;
        this.onresult && this.onresult({ resultIndex: 0, results: [alternatives] });
      }
    }
    window.SpeechRecognition = FakeRecognition;
    window.speechSynthesis = {
      speaking: false,
      pending: false,
      cancel() {},
      speak(utterance) { window.__spoken.push(String(utterance.text ?? '')); },
    };
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  }
`;

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
  let quiet = null;
  while (Date.now() - started < deadlineMs) {
    const busy = await bar.isDisabled().catch(() => false);
    if (!busy) {
      quiet = quiet ?? Date.now();
      if (Date.now() - quiet > 3500) return Date.now() - started;
    } else {
      quiet = null;
    }
    await sleep(250);
  }
  return -1;
};

/** Hover a card and press a culling key, exactly as a person does. */
const press = async (page, id, key) => {
  await page.evaluate(() => document.activeElement?.blur?.());
  const card = page.locator(`[data-artwork-id="${id}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.keyboard.press(key);
  await sleep(300);
};

/** Flags as the page holds them, keyed by id. A read of the DOM, not a drive. */
const flagsOnScreen = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-artwork-id]')].map((el) => [
        el.getAttribute('data-artwork-id'),
        {
          flag: el.getAttribute('data-flag'),
          by: el.getAttribute('data-flag-by'),
          top: Math.round(el.getBoundingClientRect().top),
        },
      ])
    )
  );

/**
 * Clause 5, asked of whatever is on screen right now.
 *
 * Both inks have to be *visible*, so this looks for elements carrying each
 * provenance and checks they have a box. `data-flag-by` covers the marks on
 * cards, `data-provenance` covers the sentences.
 */
const inksOnScreen = (page) =>
  page.evaluate(() => {
    const seen = { human: [], agent: [] };
    const consider = (el, hand) => {
      if (hand !== 'human' && hand !== 'agent') return;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) return;
      seen[hand].push(
        el.getAttribute('data-artwork-id') ??
          el.className?.toString().split(' ')[0] ??
          el.tagName.toLowerCase()
      );
    };
    for (const el of document.querySelectorAll('[data-provenance]')) {
      consider(el, el.getAttribute('data-provenance'));
    }
    for (const el of document.querySelectorAll('[data-flag-by]')) {
      consider(el, el.getAttribute('data-flag-by'));
    }
    return {
      human: seen.human.length,
      agent: seen.agent.length,
      both: seen.human.length > 0 && seen.agent.length > 0,
    };
  });

/**
 * A read through the debug harness, and null when it is not there.
 *
 * `page.evaluate` has a 30s default timeout, so calling into a harness that has
 * not mounted hangs the whole run rather than failing a clause — which is
 * exactly what happened after the reload below, where the script waited for
 * cards but not for the harness. Waiting for it is the fix; returning null
 * rather than throwing is the belt.
 */
const viewContext = async (page) => {
  const ready = await page
    .waitForFunction(
      async () => ((await window.__paillette_webmcp?.tools?.()) ?? []).length > 0,
      { timeout: 45_000 }
    )
    .then(() => true)
    .catch(() => false);
  if (!ready) return null;
  return page.evaluate(async () => {
    const raw = await window.__paillette_webmcp.call('get_view_context', {});
    return Array.isArray(raw?.content) ? JSON.parse(raw.content[0].text) : raw;
  });
};

/**
 * A hint, not a verdict.
 *
 * §9 says to check this clause *by hand* on three runs, and that instruction is
 * right: "the note refers to the content of what was rejected" is a judgement
 * about meaning, and no token matcher settles it. A real run made that obvious.
 * The note read *"You rejected four stormy sea scenes; following the picked
 * painting's warm bone-and-umber palette"* over two rejects titled "Sea
 * Pasture" and "The Bell Buoy" — a plainly correct reference to their content
 * that shares no matchable stem with either title.
 *
 * So the overlap is reported where it exists and nothing is concluded where it
 * does not. The run records the note beside the rejected works' catalogue
 * records so a person can make the judgement and another can disagree with it.
 * What the clause asserts mechanically is narrower and actually checkable: a
 * note arrived, it is one sentence, and the turn was not refused upstream.
 */
const STOP = new Set([
  'the', 'and', 'with', 'from', 'this', 'that', 'their', 'view', 'plate',
  'recto', 'verso', 'untitled', 'after', 'series', 'number', 'unknown',
  'american', 'french', 'british', 'artist', 'century', 'print', 'work',
  'works', 'drawing', 'painting', 'photograph',
]);

const stems = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP.has(word))
    .map((word) => word.slice(0, 4));

const referencesRejects = (note, rejects) => {
  const noteStems = new Set(stems(note));
  const matched = [];
  for (const reject of rejects) {
    const facts = [
      reject.title,
      reject.artist,
      reject.medium,
      reject.classification,
      ...(reject.palette ?? []).map((entry) => entry?.name ?? entry),
    ];
    for (const fact of facts) {
      for (const stem of stems(fact)) {
        if (noteStems.has(stem)) matched.push({ from: fact, stem });
      }
    }
  }
  return { referenced: matched.length > 0, matched };
};

const main = async () => {
  const browser = await chromium.launch();
  const runs = [];

  for (let run = 1; run <= RUNS; run += 1) {
    const dir = path.join(OUT, `run-${run}`);
    await mkdir(dir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await context.addInitScript(voiceHarness(VOICE));
    const page = await context.newPage();

    const record = { run, voice: VOICE, clauses: {}, errors: [] };
    // Everything from here to the end of the run is inside one try. A single
    // timeout used to take the whole invocation down with it, so a flake on
    // run 1 meant runs 2 and 3 never happened — and repeatability is the only
    // thing this script exists to measure.
    try {
    const modelCalls = [];
    /**
     * What the agent route actually answered.
     *
     * Without this a rate-limited turn looks exactly like a model that chose
     * to say nothing useful, and clause 3 goes red for a reason that has
     * nothing to do with the build. A harness that is red for the wrong reason
     * is worse than one that is green for the wrong reason, because it gets
     * believed.
     */
    const modelReplies = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/public-agent/turn')) {
        modelCalls.push(Date.now());
      }
    });
    page.on('response', async (response) => {
      if (!response.url().includes('/api/public-agent/turn')) return;
      const entry = { status: response.status() };
      if (!response.ok()) {
        entry.body = await response.text().catch(() => '');
        entry.body = entry.body.slice(0, 200);
      }
      modelReplies.push(entry);
    });
    page.on('pageerror', (error) => record.errors.push(String(error.message)));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        record.errors.push(`console: ${message.text().slice(0, 200)}`);
      }
    });
    const shot = (name) =>
      page.screenshot({ path: path.join(dir, `${name}.png`) });

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
    await sleep(1200);

    // --- clause 1: P / X / U / C, persistence, get_view_context ----------
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('[data-artwork-id]')]
        .map((el) => el.getAttribute('data-artwork-id'))
        .slice(0, 5)
    );
    await press(page, ids[0], 'x');
    await press(page, ids[1], 'x');
    await press(page, ids[2], 'p');
    // U has to actually undo something, so set a flag and take it away again.
    await press(page, ids[3], 'p');
    const afterExtraPick = await flagsOnScreen(page);
    await press(page, ids[3], 'u');
    const afterUnflag = await flagsOnScreen(page);

    // C: shift-click two works, then the key. §P4 — the optometrist's two-up.
    await page.evaluate(() => document.activeElement?.blur?.());
    for (const id of [ids[0], ids[1]]) {
      await page
        .locator(`[data-artwork-id="${id}"]`)
        .first()
        .click({ modifiers: ['Shift'] });
      await sleep(200);
    }
    await page.keyboard.press('c');
    await sleep(1200);
    const compareOpen = await page.evaluate(() =>
      Boolean(document.querySelector('[data-compare-room]'))
    );
    await shot('01-compare-room');
    if (compareOpen) {
      await page.keyboard.press('Escape');
      await sleep(800);
    }

    const beforeReload = await flagsOnScreen(page);
    const beforeCount = Object.values(beforeReload).filter(
      (entry) => entry.flag !== 'none'
    ).length;
    const contextBeforeReload = await viewContext(page);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-artwork-id]').length > 0,
      { timeout: 60_000 }
    );
    await sleep(2000);
    const afterReload = await flagsOnScreen(page);
    const survived = Object.entries(beforeReload).filter(
      ([id, entry]) =>
        entry.flag !== 'none' && afterReload[id]?.flag === entry.flag
    ).length;
    const hadFlags = Object.values(beforeReload).filter(
      (entry) => entry.flag !== 'none'
    ).length;

    const context1 = await viewContext(page);
    /*
     * Split in two on purpose.
     *
     * "P/X/U/C and Enter work on the grid" and "get_view_context returns them"
     * are one question, asked of a live page. "Flags persist per session" is a
     * second question and it depends entirely on what session means: the flag
     * store is explicitly in-memory ("a working surface, not a saved
     * document"), so a document reload empties it. Rolling both into one
     * pass/fail would either hide that or condemn four working bindings for
     * it, and neither is a useful thing to write down.
     */
    record.clauses.one = {
      pass:
        afterExtraPick[ids[3]]?.flag === 'pick' &&
        afterUnflag[ids[3]]?.flag === 'none' &&
        compareOpen &&
        beforeCount > 0 &&
        (contextBeforeReload?.flags?.picks?.length ?? 0) +
          (contextBeforeReload?.flags?.rejects?.length ?? 0) ===
          beforeCount,
      pickSetByP: afterExtraPick[ids[3]]?.flag ?? null,
      clearedByU: afterUnflag[ids[3]]?.flag ?? null,
      compareOpenedByC: compareOpen,
      flagsOnScreen: beforeCount,
      viewContextBeforeReload: {
        picks: contextBeforeReload?.flags?.picks?.length ?? 0,
        rejects: contextBeforeReload?.flags?.rejects?.length ?? 0,
      },
    };
    record.clauses.onePersistence = {
      // Measured, not asserted. The report carries the number either way.
      pass: hadFlags > 0 && survived === hadFlags,
      flagsBeforeReload: hadFlags,
      flagsAfterReload: survived,
      viewContextAfterReload: {
        picks: context1?.flags?.picks?.length ?? 0,
        rejects: context1?.flags?.rejects?.length ?? 0,
      },
    };

    /*
     * Re-flag, so the deal beat is measured from a known board.
     *
     * The reload above is an experiment, not part of the demo — nobody
     * reloads mid-take. Whatever it did to the flags, clause 2 is about what
     * Enter does to a board that has marks on it, so the marks go back.
     */
    if (survived !== hadFlags) {
      const fresh = await page.evaluate(() =>
        [...document.querySelectorAll('[data-artwork-id]')]
          .map((el) => el.getAttribute('data-artwork-id'))
          .slice(0, 3)
      );
      await press(page, fresh[0], 'x');
      await press(page, fresh[1], 'x');
      await press(page, fresh[2], 'p');
    }

    // --- clause 2: Enter on an empty bar ---------------------------------
    const modelCallsBefore = modelCalls.length;
    const boardBefore = await flagsOnScreen(page);
    const pickIds = Object.entries(boardBefore)
      .filter(([, entry]) => entry.flag === 'pick')
      .map(([id]) => id);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Enter');
    await page
      .waitForFunction(
        (previous) =>
          [...document.querySelectorAll('[data-artwork-id]')]
            .map((el) => el.getAttribute('data-artwork-id'))
            .join(',') !== previous,
        Object.keys(boardBefore).join(','),
        { timeout: 60_000 }
      )
      .catch(() => {});
    await sleep(2500);

    // Once more, board to board — the first Enter folds the search form away,
    // so a card moving there is the fold rather than the claim under test.
    const settled = await flagsOnScreen(page);
    const settledIds = Object.keys(settled);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Enter');
    await page
      .waitForFunction(
        (previous) =>
          [...document.querySelectorAll('[data-artwork-id]')]
            .map((el) => el.getAttribute('data-artwork-id'))
            .join(',') !== previous,
        settledIds.join(','),
        { timeout: 60_000 }
      )
      .catch(() => {});
    await sleep(2500);
    const afterSecond = await flagsOnScreen(page);
    const noteAfterDeal = await page.evaluate(() => {
      const label = document.querySelector('.paillette-wall-label');
      return {
        text: label?.textContent?.trim() ?? null,
        provenance: label?.getAttribute('data-provenance') ?? null,
        sentences: (label?.textContent?.match(/\./g) ?? []).length,
      };
    });
    const held = Object.entries(settled)
      .filter(([, entry]) => entry.flag === 'pick')
      .map(([id, entry]) => ({
        id,
        before: entry.top,
        after: afterSecond[id]?.top ?? null,
        moved: afterSecond[id] ? afterSecond[id].top - entry.top : null,
      }));
    record.clauses.two = {
      pass:
        modelCalls.length === modelCallsBefore &&
        held.length > 0 &&
        held.every((card) => card.moved === 0) &&
        Boolean(noteAfterDeal.text),
      modelCallsDuring: modelCalls.length - modelCallsBefore,
      picksBeforeDeal: pickIds.length,
      picksHeld: held,
      note: noteAfterDeal,
    };
    await shot('02-after-enter');

    // --- clause 5, first reading: the deterministic board ----------------
    const inksDeterministic = await inksOnScreen(page);

    // --- clause 3: the sofa prompt after two X ---------------------------
    const boardIds = Object.entries(afterSecond)
      .filter(([, entry]) => entry.flag === 'none')
      .map(([id]) => id)
      .slice(0, 2);
    for (const id of boardIds) await press(page, id, 'x');
    // Only the two just thrown out. Matching against every reject in the
    // session would let a note about clause 1's rejects pass as a reference to
    // these, which is the sort of near-miss that makes a green harness a lie.
    const fresh = new Set(boardIds);
    const rejectedFacts = ((await viewContext(page))?.flags?.rejects ?? []).filter(
      (entry) => fresh.has(entry.id ?? entry.artworkId)
    );

    const repliesBeforeSofa = modelReplies.length;
    const bar = page.locator('input[aria-label="Ask the agent"]');
    await bar.click();
    await bar.fill(SOFA);
    await bar.press('Enter');
    const quietMs = await waitForQuiet(page);
    await sleep(1500);
    const noteAfterAgent = await page.evaluate(() => {
      const label = document.querySelector('.paillette-wall-label');
      return {
        text: label?.textContent?.trim() ?? null,
        provenance: label?.getAttribute('data-provenance') ?? null,
      };
    });
    const reference = referencesRejects(noteAfterAgent.text, rejectedFacts);
    // Everything the agent route said during this turn. A 429 here means the
    // clause was never actually exercised.
    const turnReplies = modelReplies.slice(repliesBeforeSofa);
    const refused = turnReplies.filter((reply) => reply.status !== 200);
    /*
     * §5b, measured on the model's own sentence rather than trusted to the
     * prompt. "The agent's note is one sentence… under about twenty-five
     * words" — so count them, every run, and let the report carry the spread
     * instead of an assurance.
     */
    const noteShape = {
      sentences: (noteAfterAgent.text?.match(/[.!?](\s|$)/g) ?? []).length,
      words: (noteAfterAgent.text ?? '').split(/\s+/).filter(Boolean).length,
    };
    const spokenAfterTyping = await page.evaluate(() => window.__spoken ?? []);
    record.clauses.three = {
      // What can honestly be decided here: a note arrived, it is one sentence,
      // and the route did not refuse the turn. Whether it refers to the content
      // of what was rejected is a judgement, left to a person and recorded
      // below with the evidence for it. A turn the route refused was never run
      // at all, so it is reported as blocked and never as a pass.
      pass:
        !refused.length &&
        Boolean(noteAfterAgent.text) &&
        noteShape.sentences === 1,
      referenceIsAJudgement:
        'read `note` against `rejected`; `tokenOverlap` is a hint and finds nothing when the reference is not lexical',
      tokenOverlap: reference.matched,
      ...(refused.length
        ? { blocked: `agent route answered ${refused.map((r) => r.status).join(', ')}`, refused }
        : {}),
      quietMs,
      note: noteAfterAgent.text,
      noteShape,
      rejected: rejectedFacts.map((entry) => ({
        id: entry.id,
        title: entry.title,
        medium: entry.medium,
      })),
    };
    await shot('03-after-sofa-prompt');

    const inksAfterAgent = await inksOnScreen(page);

    // --- clause 4: voice in, voice out — and silence after typing --------
    // The push-to-talk control is rendered only when `getSpeechRecognition()`
    // finds a constructor, so its absence is the page's own feature detection
    // answering correctly rather than something this script arranged.
    const micVisible = await page.evaluate(
      () =>
        document.querySelectorAll(
          '[aria-label="Hold to speak"], [aria-label="Listening — release to send"]'
        ).length > 0
    );
    record.clauses.four = {
      mode: VOICE,
      micRendered: micVisible,
      spokenAfterTypedTurn: spokenAfterTyping,
      // The half that matters for text-first: a typed turn is answered in
      // writing and nothing comes out of the speakers.
      silentAfterTyping: spokenAfterTyping.length === 0,
    };
    if (VOICE === 'stub') {
      /*
       * Push-to-talk, held for real.
       *
       * `startListening` only constructs a recogniser on pointerdown, so
       * saying something before the mic is held drives nothing. Hold, speak,
       * release — and the release starts the 1.2s grace bar rather than
       * sending, which is the whole design, so this waits it out.
       */
      const mic = page.locator('[aria-label="Hold to speak"]').first();
      const box = await mic.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await sleep(600);
        // Diagnostics, because "the field was empty" has several causes and
        // they are not the same finding: no recogniser means the hold never
        // started, a recogniser with no transcript means the drive did not
        // reach `onresult`.
        record.clauses.four.recognisersAfterHold = await page.evaluate(
          () => window.__recognisers.length
        );
        record.clauses.four.drove = await page.evaluate((said) => {
          const recogniser = window.__recognisers.at(-1);
          if (!recogniser) return 'no recogniser was constructed';
          if (typeof recogniser.onresult !== 'function') {
            return 'recogniser has no onresult handler';
          }
          recogniser.__say(said);
          return 'said';
        }, SPOKEN);
        await sleep(500);
        const inFieldBeforeSend = await page
          .locator('input[aria-label="Ask the agent"]')
          .inputValue();
        await page.mouse.up();
        // The grace bar, then the turn.
        await sleep(2200);
        const quiet = await waitForQuiet(page);
        await sleep(1500);
        const spoken = await page.evaluate(() => window.__spoken ?? []);
        record.clauses.four.utteranceLandedInField = inFieldBeforeSend;
        record.clauses.four.heardBackAfterSpeaking = spoken.slice(
          spokenAfterTyping.length
        );
        record.clauses.four.quietMs = quiet;
      } else {
        record.clauses.four.micUnreachable = true;
      }
      await shot('04-after-voice-turn');
    }
    record.clauses.four.pass =
      VOICE === 'off'
        ? // Text-first: no speech API in the browser, no mic control on screen,
          // nothing spoken, and every clause above still passed.
          record.clauses.four.silentAfterTyping && !micVisible
        : // Voice: the utterance reaches the editable field, and the reply is
          // spoken *because* the turn was spoken — having been silent for the
          // typed turn before it.
          record.clauses.four.silentAfterTyping &&
          micVisible &&
          (record.clauses.four.utteranceLandedInField ?? '').includes('quieter') &&
          (record.clauses.four.heardBackAfterSpeaking ?? []).length > 0;

    // --- clause 5: every state ------------------------------------------
    record.clauses.five = {
      pass: inksAfterAgent.both,
      onDeterministicBoard: inksDeterministic,
      afterTheAgentTurn: inksAfterAgent,
    };

    } catch (error) {
      record.threw = String(error).split('\n')[0].slice(0, 200);
    }
    record.pass =
      !record.threw &&
      Object.keys(record.clauses).length > 0 &&
      Object.values(record.clauses).every((clause) => clause.pass);
    runs.push(record);
    log(
      `run ${run} [voice=${VOICE}] ` +
        Object.entries(record.clauses)
          .map(([name, clause]) => `${name}:${clause.pass ? 'pass' : 'FAIL'}`)
          .join(' ') +
        (record.threw ? ` · threw: ${record.threw}` : '') +
        (record.errors.length ? ` · ${record.errors.length} page errors` : '')
    );
    await context.close().catch(() => {});
    await writeFile(
      path.join(OUT, 'section-9.json'),
      `${JSON.stringify(runs, null, 2)}\n`
    );
    if (run < RUNS) await sleep(3000);
  }

  await browser.close();

  log('\n=== §9, per clause ===');
  for (const clause of [
    'one',
    'onePersistence',
    'two',
    'three',
    'four',
    'five',
  ]) {
    const reached = runs.filter((run) => run.clauses[clause]).length;
    const passes = runs.filter((run) => run.clauses[clause]?.pass).length;
    const blocked = runs.filter((run) => run.clauses[clause]?.blocked).length;
    log(
      `  clause ${clause}: ${passes}/${runs.length}` +
        (reached < runs.length ? ` (reached in ${reached})` : '') +
        (blocked ? ` · ${blocked} blocked upstream` : '')
    );
  }
  const failed = runs.filter((run) => !run.pass);
  if (failed.length) {
    log(`\n${failed.length} of ${runs.length} runs failed at least one clause.`);
    process.exitCode = 1;
  }
};

await main();
