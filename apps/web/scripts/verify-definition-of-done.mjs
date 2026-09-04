/**
 * Section 9 of the brief, run as one continuous session, in shooting order.
 *
 * The other harnesses each prove a slice with their own fixtures and reset
 * between sections. A filmed take does not reset. This drives one page from a
 * cold load through every beat of the definition of done in the order a camera
 * would see them, and prints a verdict per bullet rather than per assertion —
 * because "37 checks passed" does not tell you whether bullet three is safe to
 * point a lens at.
 *
 *   pnpm --filter web dev --port 5222 --strictPort
 *   node apps/web/scripts/verify-definition-of-done.mjs [baseUrl] [runs]
 *
 * Every network call is intercepted, so this costs nothing and needs no keys.
 * That is also its limit, and the limit is stated per bullet rather than
 * papered over: what needs a live model or a real microphone is reported
 * SKIPPED, with where the evidence for it actually lives.
 */

import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:5222';
const RUNS = Number(process.argv[3] ?? 1);

/*
 * The take is not only ever shot at one size. 1280x800 is where the voice lane
 * found the old panel overlapping the utterance bar, and the light theme flips
 * every token the ink depends on — so a run cycles through these rather than
 * proving the sequence in one configuration and implying the others.
 */
const VARIANTS = [
  { label: '1500x1000 dark', width: 1500, height: 1000, theme: 'dark' },
  { label: '1280x800 dark', width: 1280, height: 800, theme: 'dark' },
  { label: '1440x900 light', width: 1440, height: 900, theme: 'light' },
];

const BULLETS = {
  keys: 'P/X/U/C and Enter work; flags persist per session; get_view_context returns them',
  redeal: 'Enter on an empty bar redeals from human flags, picks in place, no LLM call',
  note: "the agent's redeal note refers to the content of what was rejected",
  voice: 'a voice utterance lands in the editable field; the note is spoken only after voice',
  ink: 'two colours of ink visible in every state',
};

const work = (id, rank, title) => ({
  id,
  galleryId: 'nga',
  orgId: 'nga',
  title: title ?? `Work ${id}`,
  artist: 'Fitz Henry Lane',
  year: 1863,
  imageUrl: null,
  thumbnailUrl: null,
  similarity: 0.92 - rank * 0.01,
  metadata: { classification: 'Painting', dateText: '1863' },
});

/*
 * Legible titles, so a note about "what was rejected" can be read against what
 * was actually thrown out rather than against an id.
 */
const WARM = ['Amber Harbour at Evening', 'Gold Marsh, Low Sun', 'Lantern on the Quay'];
const COOL = ['Grey Estuary, Rain', 'Slate Harbour, Winter', 'Fog on the Sound'];
const CORPUS = [
  ...WARM,
  ...COOL,
  'Salt Marsh',
  'Fallen Tree',
  'Open Water',
  'Low Cloud',
  // Padding, so a redeal can still deal twelve after the picks, the rejects and
  // everything already dealt have been excluded. A corpus of ten made the board
  // deal eight and looked like a product defect; it was a fixture defect.
  ...Array.from({ length: 30 }, (_, index) => `Study ${index + 1}`),
].map((title, index) => work(`nga-${index + 1}`, index, title));

async function runOnce(variant) {
  const results = Object.fromEntries(
    Object.keys(BULLETS).map((key) => [key, { checks: [], skipped: null }])
  );
  let bullet = 'keys';
  const check = (label, condition, detail) => {
    results[bullet].checks.push({ label, ok: Boolean(condition), detail });
    return Boolean(condition);
  };
  const skip = (key, why) => {
    results[key].skipped = why;
  };

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: variant.width, height: variant.height },
  });

  /*
   * A recogniser that never hears anything, and a synthesiser that records
   * rather than speaks — both installed before the page's script runs, because
   * Chromium ships a native `SpeechRecognition` and a read-only
   * `speechSynthesis` accessor that can only be replaced by definition.
   *
   * This does not make the speech real. It makes the *plumbing* real in a real
   * browser, which is the most that can be done headless — Chrome sends the
   * audio to Google. What it buys is the strongest available form of section
   * 9's fourth bullet: a typed turn and a spoken turn in the same session, so
   * "spoken only after voice" is a contrast rather than two separate claims.
   */
  await context.addInitScript(([theme]) => {
    class FakeRecognition {
      constructor() {
        window.__pa_rec = this;
      }
      start() {
        window.__pa_rec_started = (window.__pa_rec_started ?? 0) + 1;
      }
      stop() {
        window.__pa_rec_stopped = (window.__pa_rec_stopped ?? 0) + 1;
      }
    }
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
      Object.defineProperty(window, name, {
        value: FakeRecognition,
        configurable: true,
        writable: true,
      });
    }
    window.__pa_spoken = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speaking: false,
        pending: false,
        speak: (utterance) => window.__pa_spoken.push(String(utterance?.text ?? '')),
        cancel() {},
      },
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {
        constructor(text) {
          this.text = text;
        }
      },
    });
    if (theme === 'light') {
      window.localStorage.setItem('paillette-theme', 'light');
    }
  }, [variant.theme]);

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  const agentTurns = [];
  const exemplarCalls = [];

  await page.route('**/api/public-search/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/exemplars')) {
      const body = JSON.parse(route.request().postData() || '{}');
      exemplarCalls.push(body);
      const blocked = new Set([
        ...(body.excludeIds ?? []),
        ...(body.positiveIds ?? []),
        ...(body.negativeIds ?? []),
      ]);
      const dealt = CORPUS.filter((entry) => !blocked.has(entry.id)).slice(
        0,
        body.topK ?? 12
      );
      const padded = dealt.length
        ? dealt
        : Array.from({ length: 12 }, (_, index) =>
            work(`fresh${exemplarCalls.length}-${index}`, index)
          );
      return route.fulfill({
        json: {
          success: true,
          data: { results: padded, count: padded.length, queryTime: 4 },
        },
      });
    }
    return route.fulfill({
      json: {
        success: true,
        data: { results: CORPUS, count: CORPUS.length, queryTime: 6 },
      },
    });
  });

  await page.route('**/api/public-agent/**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    agentTurns.push(body);
    return route.fulfill({
      json: {
        success: true,
        data: {
          message: {
            role: 'assistant',
            content:
              'You said warm; you rejected the golds and kept the grey harbour — following the picks.',
          },
        },
      },
    });
  });

  const viewContext = () =>
    page.evaluate(() => window.__paillette_webmcp.call('get_view_context', {}));

  await page.goto(`${BASE}/nga/search?q=warm%20harbour&webmcp-debug`, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  await page.waitForSelector('.paillette-card', { timeout: 30_000 });

  // The search field carries autofocus, and a bare letter is correctly ignored
  // while a text field has focus. One click on neutral ground is the
  // precondition every take has; doing it here rather than pretending it is not
  // needed is the point of running the sequence in order.
  await page.mouse.click(750, 12);
  await page.waitForTimeout(150);
  const focusOnLoad = await page.evaluate(() => document.activeElement?.tagName);

  const cards = page.locator('.paillette-card');
  const cardId = (index) => cards.nth(index).getAttribute('data-artwork-id');

  // ── bullet 1 ──────────────────────────────────────────────────────────────
  bullet = 'keys';
  check('focus is out of the search field before any key is pressed', focusOnLoad !== 'INPUT', focusOnLoad);

  const pickId = await cardId(0);
  const rejectId = await cardId(1);
  const clearId = await cardId(2);

  await cards.nth(0).hover();
  await page.keyboard.press('p');
  await page.waitForTimeout(120);
  await cards.nth(1).hover();
  await page.keyboard.press('x');
  await page.waitForTimeout(120);
  await cards.nth(2).hover();
  await page.keyboard.press('p');
  await page.waitForTimeout(80);
  await page.keyboard.press('u');
  await page.waitForTimeout(150);

  const afterKeys = await viewContext();
  const picks = (afterKeys.flags?.picks ?? []).map((entry) => entry.id);
  const rejects = (afterKeys.flags?.rejects ?? []).map((entry) => entry.id);
  check('P picks the hovered card', picks.includes(pickId), picks.join(','));
  check('X rejects the hovered card', rejects.includes(rejectId), rejects.join(','));
  check(
    'U clears the flag it was put on',
    !picks.includes(clearId) && !rejects.includes(clearId),
    clearId
  );
  check('get_view_context returns the flags', Array.isArray(afterKeys.flags?.picks));

  await cards.nth(3).hover();
  await page.keyboard.press('c');
  await page.waitForTimeout(400);
  const twoUp = page.locator('.paillette-compare');
  const compareOpened = (await twoUp.count()) === 1;
  check('C opens the two-up', compareOpened);
  if (compareOpened) {
    await twoUp.locator('.paillette-compare-work').first().click();
    await page.waitForTimeout(350);
    check('and one click answers it and closes it', (await twoUp.count()) === 0);
  }

  // Flags persist per session: run a different search and look again.
  await page.fill('input[placeholder*="search by feeling"]', 'cold estuary');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_200);
  const afterSearch = await viewContext();
  check(
    'the flags survive the human running a different search',
    (afterSearch.flags?.picks ?? []).some((entry) => entry.id === pickId),
    `${(afterSearch.flags?.picks ?? []).length} pick(s)`
  );

  // ── bullet 2 ──────────────────────────────────────────────────────────────
  bullet = 'redeal';
  const agentTurnsBefore = agentTurns.length;
  const exemplarsBefore = exemplarCalls.length;
  await page.mouse.click(750, 12);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_500);

  const dealt = await viewContext();
  check(
    'Enter reached the exemplar route',
    exemplarCalls.length === exemplarsBefore + 1,
    `${exemplarCalls.length - exemplarsBefore} call(s)`
  );
  check(
    'and made no model call at all',
    agentTurns.length === agentTurnsBefore,
    `${agentTurns.length - agentTurnsBefore} agent call(s)`
  );
  check(
    'the request carried the human’s exemplars',
    (exemplarCalls.at(-1)?.positiveIds ?? []).includes(pickId),
    JSON.stringify(exemplarCalls.at(-1)?.positiveIds ?? [])
  );
  check('the board dealt twelve', (dealt.board?.order ?? []).length === 12, `${(dealt.board?.order ?? []).length}`);
  check('the pick holds its seat', (dealt.board?.order ?? [])[0] === pickId);
  const firstRendered = await cardId(0);
  check(
    'and is the first card actually rendered, not only the first in state',
    firstRendered === pickId,
    `${firstRendered}`
  );
  check('the board is marked as the human’s move', dealt.board?.lastChangeBy === 'human');

  // ── bullet 3 ──────────────────────────────────────────────────────────────
  //
  // The model's behaviour cannot be checked without a key and a worker, and a
  // stub answering with a sentence about rejects would be this script grading
  // its own homework. What *is* checkable offline is the precondition: that the
  // turn the page sends after the sofa prompt and two X presses actually
  // carries the rejected works, by title. If it does not, no model could
  // possibly refer to their content.
  bullet = 'note';
  const boardIds = dealt.board?.order ?? [];
  const rejectTargets = [];
  for (const index of [1, 2]) {
    // Read the id off the card actually being hovered rather than off the board
    // order captured a moment ago. They agree until the board re-renders, and
    // then they do not, and the script blames the payload for its own staleness.
    const id = await cardId(index);
    await cards.nth(index).hover();
    await page.keyboard.press('x');
    await page.waitForTimeout(150);
    rejectTargets.push(id);
  }
  const bar = page.locator('input[aria-label="Ask the agent"]');
  const barPresent = (await bar.count()) === 1;
  check('the utterance bar is on the page', barPresent);
  if (barPresent) {
    await bar.fill(
      'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.'
    );
    await bar.press('Enter');
    await page.waitForTimeout(2_000);
  }
  const turn = agentTurns.at(-1);
  const sent = JSON.stringify(turn ?? {});
  check('a typed instruction alone fired the agent', agentTurns.length > agentTurnsBefore);
  check(
    'the whole sentence reached the service, not the tail of it',
    sent.includes('I want something to hang above the sofa'),
    sent.slice(0, 90)
  );
  const delta = turn?.turn?.flagsDelta ?? turn?.flagsDelta ?? [];
  const sentRejects = delta.filter((entry) => entry?.to === 'reject');
  check(
    'the turn carried the rejects the human just made',
    rejectTargets.every((id) =>
      sentRejects.some((entry) => entry.artworkId === id)
    ),
    `${sentRejects.length} reject(s) of ${delta.length} change(s)`
  );
  check(
    'and named each one, which is what lets a note refer to their content',
    sentRejects.length > 0 &&
      sentRejects.every(
        (entry) =>
          typeof entry.title === 'string' &&
          entry.title.length > 3 &&
          entry.title !== entry.artworkId
      ),
    sentRejects.map((entry) => entry.title).join(' · ')
  );
  skip(
    'note',
    'the model half needs OPENAI_API_KEY and a wrangler worker; run apps/web/scripts/verify-sofa-run.mjs. ' +
      'Evidence today: 9 live runs in the shared-state report, 3 in the voice report.'
  );

  // ── bullet 4 ──────────────────────────────────────────────────────────────
  //
  // The typed turn above has already happened, so the two halves of this bullet
  // can be checked against each other inside one session rather than asserted
  // separately in two scripts.
  bullet = 'voice';
  const spokenAfterTyped = await page.evaluate(() => window.__pa_spoken ?? []);
  check(
    'the typed turn was silent — nothing spoken',
    spokenAfterTyped.length === 0,
    spokenAfterTyped.join(' | ')
  );
  check(
    'the field is editable text, not a transcript view',
    barPresent && (await bar.evaluate((node) => node.tagName)) === 'INPUT'
  );

  const mic = page.locator('button[aria-label="Hold to speak"]');
  const micPresent = (await mic.count()) === 1;
  check('the mic is one control beside the same field', micPresent);

  if (micPresent) {
    await bar.fill('');
    await mic.hover();
    await page.mouse.down();
    await page.waitForTimeout(220);
    await page.evaluate(() =>
      window.__pa_rec.onresult({
        results: [Object.assign([{ transcript: 'something warm' }], { isFinal: false })],
      })
    );
    await page.waitForTimeout(220);
    check(
      'interim words land in the editable field as they arrive',
      (await bar.inputValue()) === 'something warm',
      await bar.inputValue()
    );

    await page.evaluate(() =>
      window.__pa_rec.onresult({
        results: [
          Object.assign([{ transcript: 'something warm and quiet' }], { isFinal: true }),
        ],
      })
    );
    await page.mouse.up();
    await page.waitForTimeout(260);
    check(
      'releasing does not send — a grace bar drains first',
      (await page.locator('[role="progressbar"]').count()) === 1
    );
    check(
      'and the words are editable while it drains',
      (await bar.inputValue()).includes('something warm')
    );

    const agentBeforeVoice = agentTurns.length;
    await page.waitForTimeout(1_800);
    check(
      'the utterance commits after the grace',
      agentTurns.length === agentBeforeVoice + 1,
      `${agentTurns.length - agentBeforeVoice} turn(s)`
    );
    await page.waitForTimeout(900);
    const spokenAfterVoice = await page.evaluate(() => window.__pa_spoken ?? []);
    check(
      'and the note is spoken back — once, and only after the spoken turn',
      spokenAfterVoice.length === 1,
      JSON.stringify(spokenAfterVoice)
    );
  }
  skip(
    'voice',
    'the plumbing is real in a real browser but the speech is not: Chrome ships the ' +
      'audio to Google, so no recogniser has run and no audio has been produced on ' +
      'this machine. A genuinely spoken take must be filmed on a real one.'
  );

  // ── bullet 5 ──────────────────────────────────────────────────────────────
  bullet = 'ink';
  await page.evaluate(
    ([id]) =>
      window.__paillette_webmcp.call('flag_artworks', {
        flags: [{ artworkId: id, flag: 'pick', reason: 'warmer than the rest' }],
      }),
    [boardIds[4]]
  );
  await page.waitForTimeout(500);

  const inks = await page.evaluate(() => {
    /*
     * The mark is the pressed button inside the badge, not the badge itself.
     * The badge is a layout wrapper and inherits body colour, so comparing two
     * badges compares two identical inherited values and reports a defect that
     * is not there. Read the thing that is actually painted.
     */
    const mark = (by) => {
      const card = document.querySelector(`.paillette-card[data-flag-by="${by}"]`);
      if (!card) return null;
      const button = card.querySelector(
        '.paillette-flag-button[aria-pressed="true"]'
      );
      if (!button) return null;
      const style = getComputedStyle(button);
      return {
        colour: style.borderColor,
        borderStyle: style.borderStyle,
        filled: style.backgroundColor !== 'rgba(0, 0, 0, 0)',
      };
    };
    const humanCard = document.querySelector('.paillette-card[data-flag-by="human"]');
    const agentCard = document.querySelector('.paillette-card[data-flag-by="agent"]');
    const glyph = document.querySelector('.pa-activity-cells');

    /*
     * Resolve the tokens through the browser rather than restating their values.
     * The light theme flips every one of them — graphite is #e6e3dc on the
     * charcoal table and #17161a on the paper one — so an assertion carrying a
     * literal passes in one theme and reports a defect in the other that is not
     * there. Painting a probe and reading it back gives the same normalised
     * `rgb(...)` form the computed styles are in.
     */
    const resolve = (token) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${token})`;
      probe.style.position = 'absolute';
      probe.style.opacity = '0';
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };

    return {
      human: mark('human'),
      agent: mark('agent'),
      agentProvisional: agentCard?.getAttribute('data-flag-provisional'),
      humanFrame: humanCard ? getComputedStyle(humanCard).boxShadow : null,
      glyph: glyph ? getComputedStyle(glyph).color : null,
      humanInk: resolve('--ink-human'),
      agentInk: resolve('--ink-agent'),
      theme: document.documentElement.dataset.theme ?? 'dark',
      bothOnScreen: Boolean(humanCard) && Boolean(agentCard),
    };
  });

  check('the human’s mark is painted', Boolean(inks.human), JSON.stringify(inks.human));
  check('the agent’s mark is painted at the same time', inks.bothOnScreen && Boolean(inks.agent));
  check(
    'and the two are different computed values, not just different classes',
    Boolean(inks.human) && Boolean(inks.agent) && inks.human.colour !== inks.agent.colour,
    `${inks.human?.colour} vs ${inks.agent?.colour}`
  );
  check(
    'the human’s mark is filled and solid; the agent’s is outlined and dashed',
    inks.human?.filled === true &&
      inks.human?.borderStyle === 'solid' &&
      inks.agent?.filled === false &&
      inks.agent?.borderStyle === 'dashed',
    `human ${inks.human?.borderStyle}/${inks.human?.filled} · agent ${inks.agent?.borderStyle}/${inks.agent?.filled}`
  );
  check(
    'the agent’s flag stays provisional until the human confirms it',
    inks.agentProvisional === 'true',
    inks.agentProvisional
  );
  check(
    'the human’s mark is the human’s ink, whichever theme is on',
    inks.human?.colour === inks.humanInk,
    `${inks.theme}: ${inks.human?.colour} vs ${inks.humanInk}`
  );
  check(
    'the agent’s mark is the agent’s ink, whichever theme is on',
    inks.agent?.colour === inks.agentInk,
    `${inks.theme}: ${inks.agent?.colour} vs ${inks.agentInk}`
  );
  check(
    'a confirmed human pick carries the hairline frame in that ink',
    (inks.humanFrame ?? '').includes(
      (inks.humanInk ?? '').replace('rgb(', '').replace(')', '')
    ),
    `${inks.theme}: ${(inks.humanFrame ?? '').slice(0, 40)}`
  );
  check(
    'the activity glyph is drawn in the agent’s ink, never the human’s',
    inks.glyph !== null &&
      inks.glyph !== inks.humanInk &&
      inks.glyph.startsWith(
        `rgba(${(inks.agentInk ?? '').replace('rgb(', '').replace(')', '')}`
      ),
    `${inks.theme}: ${inks.glyph} vs ${inks.agentInk}`
  );

  // The glyph's own promise, in the middle of a real take.
  check(
    'the tool-call log never opened itself across the whole sequence',
    (await page.locator('.pa-activity-log').count()) === 0
  );
  check('no uncaught page errors anywhere in the take', pageErrors.length === 0, pageErrors[0]);

  /*
   * Text first, checked rather than asserted.
   *
   * Everything above ran with a recogniser installed. This is the same page with
   * `SpeechRecognition` deleted entirely — the state of any browser that does
   * not ship it, and of anyone who has denied the microphone. The agentic
   * trigger has to fire from a typed instruction alone, and the only thing that
   * may change is that the mic is not drawn.
   */
  bullet = 'voice';
  const voiceOff = await browser.newContext({
    viewport: { width: variant.width, height: variant.height },
  });
  await voiceOff.addInitScript(() => {
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
      Object.defineProperty(window, name, { value: undefined, configurable: true });
    }
  });
  await voiceOff.route('**/api/public-search/**', (route) =>
    route.fulfill({
      json: { success: true, data: { results: CORPUS, count: CORPUS.length, queryTime: 5 } },
    })
  );
  let offTurns = 0;
  await voiceOff.route('**/api/public-agent/**', (route) => {
    offTurns += 1;
    return route.fulfill({
      json: {
        success: true,
        data: { message: { role: 'assistant', content: 'Five warm, calm options.' } },
      },
    });
  });
  const offPage = await voiceOff.newPage();
  const offErrors = [];
  offPage.on('pageerror', (error) => offErrors.push(String(error)));
  await offPage.goto(`${BASE}/nga/search?q=warm%20harbour&webmcp-debug`, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  await offPage.waitForSelector('.paillette-card', { timeout: 30_000 });
  await offPage.waitForTimeout(1_200);

  check(
    'with no recogniser at all, no mic is drawn',
    (await offPage.locator('button[aria-label="Hold to speak"]').count()) === 0
  );
  const offBar = offPage.locator('input[aria-label="Ask the agent"]');
  check('the field is still there', (await offBar.count()) === 1);
  if ((await offBar.count()) === 1) {
    await offBar.fill('something warm for above the sofa');
    await offBar.press('Enter');
    await offPage.waitForTimeout(2_000);
  }
  check(
    'and a typed instruction alone still fires the agent',
    offTurns === 1,
    `${offTurns} turn(s)`
  );
  check('no page errors with voice absent', offErrors.length === 0, offErrors[0]);
  await voiceOff.close();

  await browser.close();
  return { results, pageErrors };
}

const tally = [];
for (let index = 0; index < RUNS; index += 1) {
  const variant = VARIANTS[index % VARIANTS.length];
  console.log(
    `\n================ run ${index + 1} of ${RUNS} · ${variant.label} ================`
  );
  const { results } = await runOnce(variant);
  const summary = {};
  for (const [key, label] of Object.entries(BULLETS)) {
    const { checks, skipped } = results[key];
    const failed = checks.filter((entry) => !entry.ok);
    summary[key] = { passed: checks.length - failed.length, total: checks.length, failed };
    const verdict =
      failed.length === 0
        ? skipped
          ? 'PARTIAL'
          : 'PASS'
        : 'FAIL';
    console.log(`\n[${verdict}] ${label}`);
    for (const entry of checks) {
      console.log(
        `  ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.label}${entry.detail === undefined ? '' : ` — ${entry.detail}`}`
      );
    }
    if (skipped) console.log(`  --   not checkable here: ${skipped}`);
  }
  tally.push(summary);
}

console.log('\n================ across all runs ================');
let anyFailure = false;
for (const [key, label] of Object.entries(BULLETS)) {
  const line = tally
    .map((run) => `${run[key].passed}/${run[key].total}`)
    .join('  ');
  const failed = tally.some((run) => run[key].failed.length > 0);
  if (failed) anyFailure = true;
  console.log(`${failed ? 'FAIL' : 'ok  '} ${line}   ${label}`);
  for (const run of tally) {
    for (const entry of run[key].failed) console.log(`       ↳ ${entry.label}`);
  }
}
process.exit(anyFailure ? 1 : 0);
