#!/usr/bin/env node
/**
 * The §9 voice clause, checked on a real browser:
 *
 *   "A voice utterance lands in the editable field; the note is spoken only
 *    after voice input."
 *
 * Both halves, because only one of them is about speaking. The negative half —
 * a typed turn staying silent — is the one that actually protects the demo,
 * since a page that reads its own wall labels aloud at someone who is typing
 * is worse than a page that never speaks at all.
 *
 * Nothing here needs a microphone. The recogniser is replaced with a stub that
 * emits a settled transcript on demand, which the page cannot distinguish from
 * Chrome doing it, and the agent's reply is served from this script so the
 * check measures the channel rule rather than the catalogue.
 *
 * Two ways to get a false pass, both learned by getting them:
 *
 *  - `window.speechSynthesis = stub` **does nothing**. It is a readonly
 *    accessor on Window; the assignment silently no-ops and the real
 *    synthesiser stays in charge, so `spoken` stays empty and every assertion
 *    against it passes for the wrong reason. `Object.defineProperty` is
 *    required, and this script verifies its own stubs took before asserting.
 *  - Chromium ships an **unprefixed** `window.SpeechRecognition`, and the page
 *    reads `SpeechRecognition ?? webkitSpeechRecognition`. Stubbing only the
 *    prefixed name leaves the native recogniser in charge, and a native
 *    recogniser in a headless browser hears nothing.
 *
 * Usage:
 *   node scripts/demo/verify-voice-symmetry.mjs [url]
 *
 * Default url is http://localhost:5183/nga/search. Exits non-zero on failure.
 */

import { resolveBrowserDriver } from './browser.mjs';

const NOTE = 'These share a low horizon.';
const TOTAL = 8;
const AGENT_INPUT = 'input[aria-label="Ask the agent"]';
const UTTERANCE = 'something warm for above the sofa';

/**
 * Installed before any page script runs. `defineProperty` throughout — see the
 * header; plain assignment is the trap this whole file exists downstream of.
 */
const installStubs = () => {
  window.__spoken = [];
  function Recognition() {
    window.__rec = this;
  }
  Recognition.prototype.start = function () {};
  Recognition.prototype.stop = function () {
    if (this.onend) this.onend();
  };
  const put = (name, value) =>
    Object.defineProperty(window, name, {
      configurable: true,
      writable: true,
      value,
    });
  put('SpeechRecognition', Recognition);
  put('webkitSpeechRecognition', Recognition);
  put('speechSynthesis', {
    speaking: false,
    pending: false,
    cancel() {},
    getVoices: () => [],
    speak: (utterance) => window.__spoken.push(String(utterance && utterance.text)),
  });
  put('SpeechSynthesisUtterance', function Utterance(text) {
    this.text = text;
  });
};

const withDebugParam = (url) => {
  const parsed = new URL(url);
  parsed.searchParams.set('webmcp-debug', '');
  return parsed.toString();
};

/** The agent answering with a wall label and no tool calls. */
const answerOk = (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: { message: { role: 'assistant', content: NOTE } },
    }),
  });

/** The agent route down, which is staging's actual state at the time of writing. */
const answerDown = (route) =>
  route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      success: false,
      error: {
        code: 'AGENT_UNAVAILABLE',
        message: 'The agent is temporarily unavailable.',
      },
    }),
  });

/**
 * Hold, say one settled sentence, let go, and let the grace bar commit it.
 *
 * The 1.2s wait is the grace window doing its job, not a sleep to make a race
 * go away: this is the interval in which a human could still type over the
 * transcript, and the check has to let it elapse the way a person would.
 */
const speak = async (page, said) => {
  const box = await page.getByLabel('Hold to speak').boundingBox();
  if (!box) throw new Error('no microphone control to hold');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.evaluate(
    (text) =>
      window.__rec.onresult({
        results: Object.assign(
          [{ 0: { transcript: text }, isFinal: true, length: 1 }],
          { length: 1 }
        ),
      }),
    said
  );
  await page.waitForTimeout(250);
  const landed = await page.locator(AGENT_INPUT).inputValue();
  await page.mouse.up();
  await page.waitForTimeout(2200);
  return landed;
};

const openPage = async (browser, url) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(installStubs);
  const page = await context.newPage();
  await page.goto(withDebugParam(url), {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.locator(AGENT_INPUT).waitFor({ timeout: 30_000 });

  // Refuse to report anything if the stubs did not take.
  const stubbed = await page.evaluate(
    () =>
      Array.isArray(window.__spoken) &&
      typeof window.speechSynthesis.speak === 'function' &&
      window.speechSynthesis.getVoices().length === 0
  );
  if (!stubbed) throw new Error('speech stubs did not install');
  return { context, page };
};

/**
 * The agent goes down under a spoken turn, and the human speaks again.
 *
 * This is the shape a bad conference network actually takes, and the failure
 * that would be worst on camera is not the error — it is the page never coming
 * back: a disabled bar, a grace bar stuck part-drained, or a microphone that
 * has quietly stopped working for the rest of the take.
 */
const runFailureThenRecovery = async (browser, url) => {
  let down = true;
  const { context, page } = await openPage(browser, url);
  try {
    await page.route('**/api/public-agent/turn', (route) =>
      down ? answerDown(route) : answerOk(route)
    );

    await speak(page, UTTERANCE);
    await page.waitForTimeout(2500);
    const afterFailure = {
      errors: await page.locator('[role="alert"]').allTextContents(),
      typeable: await page.locator(AGENT_INPUT).isEnabled(),
      micPresent: (await page.getByLabel('Hold to speak').count()) === 1,
      graceCleared: (await page.getByRole('progressbar').count()) === 0,
      spoken: await page.evaluate(() => window.__spoken),
    };

    down = false;
    await speak(page, 'warmer');
    await page.waitForTimeout(3500);
    return {
      afterFailure,
      recoveredSpoken: await page.evaluate(() => window.__spoken),
    };
  } finally {
    await context.close();
  }
};

const runTurn = async (browser, url, mode) => {
  const { context, page } = await openPage(browser, url);

  // What is under test is which channel the reply comes back on, not whether
  // the catalogue can be searched from this machine.
  await page.route('**/api/public-agent/turn', answerOk);

  try {
    const field = page.locator(AGENT_INPUT);
    let landed = null;
    if (mode === 'voice') {
      landed = await speak(page, UTTERANCE);
    } else {
      await field.fill(UTTERANCE);
      await field.press('Enter');
    }
    await page.waitForTimeout(4000);

    const entries = await page
      .locator('section[aria-label="Ask the agent"] ol li')
      .allTextContents();
    return {
      landed,
      onWall: entries.some((entry) => entry.includes(NOTE)),
      spoken: await page.evaluate(() => window.__spoken),
    };
  } finally {
    await context.close();
  }
};

const main = async () => {
  const url =
    process.argv.slice(2).find((arg) => arg.startsWith('http')) ??
    'http://localhost:5183/nga/search';

  const { chromium } = await resolveBrowserDriver();
  const browser = await chromium.launch();
  const failures = [];
  const say = (ok, id, detail) => {
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(28)}${detail}\n`);
    if (!ok) failures.push(id);
  };

  try {
    process.stdout.write(`\n${url}\n\n`);
    const voice = await runTurn(browser, url, 'voice');
    const text = await runTurn(browser, url, 'text');
    const outage = await runFailureThenRecovery(browser, url);

    say(
      voice.landed === UTTERANCE,
      'voice.landsInField',
      `field held ${JSON.stringify(voice.landed)} before release`
    );
    say(voice.onWall, 'voice.noteOnWall', 'the note is above the board');
    say(
      voice.spoken.includes(NOTE),
      'voice.spokenBack',
      `spoken: ${JSON.stringify(voice.spoken)}`
    );
    say(text.onWall, 'text.noteOnWall', 'the note is above the board');
    say(
      text.spoken.length === 0,
      'text.staysSilent',
      `spoken: ${JSON.stringify(text.spoken)}`
    );

    // What a bad network actually looks like. The error is not the danger —
    // the page never coming back is: a disabled bar, a grace bar stuck
    // part-drained, or a mic that has quietly died for the rest of the take.
    const bad = outage.afterFailure;
    say(
      bad.errors.length === 1 && bad.typeable && bad.micPresent && bad.graceCleared,
      'outage.staysUsable',
      `${bad.errors.length} error(s), typeable=${bad.typeable}, mic=${bad.micPresent}, grace cleared=${bad.graceCleared}`
    );
    say(
      bad.spoken.length === 0,
      'outage.saysNothingAloud',
      `spoken: ${JSON.stringify(bad.spoken)}`
    );
    say(
      outage.recoveredSpoken.includes(NOTE),
      'outage.recovers',
      `next utterance spoken: ${JSON.stringify(outage.recoveredSpoken)}`
    );

    process.stdout.write(
      `\n${TOTAL - failures.length} pass · ${failures.length} fail\n`
    );
  } finally {
    await browser.close();
  }

  if (failures.length) process.exitCode = 1;
};

await main();
