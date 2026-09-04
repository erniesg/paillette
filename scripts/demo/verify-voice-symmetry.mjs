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

const runTurn = async (browser, url, mode) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(installStubs);
  const page = await context.newPage();

  // The agent answers with a wall label and no tool calls, so the loop ends on
  // the first pass. What is under test is which channel the reply comes back
  // on, not whether the catalogue can be searched from this machine.
  await page.route('**/api/public-agent/turn', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { message: { role: 'assistant', content: NOTE } },
      }),
    })
  );

  try {
    await page.goto(withDebugParam(url), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const field = page.locator(AGENT_INPUT);
    await field.waitFor({ timeout: 30_000 });

    // Refuse to report anything if the stubs did not take.
    const stubbed = await page.evaluate(
      () =>
        Array.isArray(window.__spoken) &&
        typeof window.speechSynthesis.speak === 'function' &&
        window.speechSynthesis.getVoices().length === 0
    );
    if (!stubbed) throw new Error('speech stubs did not install');

    let landed = null;
    if (mode === 'voice') {
      const mic = page.getByLabel('Hold to speak');
      const box = await mic.boundingBox();
      if (!box) throw new Error('no microphone control to hold');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(300);
      await page.evaluate(
        (said) =>
          window.__rec.onresult({
            results: Object.assign(
              [{ 0: { transcript: said }, isFinal: true, length: 1 }],
              { length: 1 }
            ),
          }),
        UTTERANCE
      );
      await page.waitForTimeout(250);
      // Before release, the words are in the field the keyboard owns.
      landed = await field.inputValue();
      await page.mouse.up();
      // The 1.2s grace bar, plus slack, then it commits itself.
      await page.waitForTimeout(2200);
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

    process.stdout.write(
      `\n${5 - failures.length} pass · ${failures.length} fail\n`
    );
  } finally {
    await browser.close();
  }

  if (failures.length) process.exitCode = 1;
};

await main();
