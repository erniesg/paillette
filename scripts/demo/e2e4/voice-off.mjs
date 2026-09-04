/**
 * "Voice switched off" is not a switch, and this checks that it does not need
 * to be one.
 *
 * `apps/web/app/lib/voice/speech-channel.ts` derives the channel from how the
 * turn arrived — `shouldSpeakReply(lastTurn) === (lastTurn === 'voice')` — so a
 * typed turn is silent by construction and there is nothing to toggle. §5's
 * "one field, two inputs" depends on that being true in the browser, not just
 * in the module.
 *
 * So: stub `speechSynthesis.speak` and `SpeechRecognition` before any script
 * runs, type the sofa instruction, and count what was spoken and what was
 * listened for. Expected: a note on screen, zero utterances, zero recognisers
 * started.
 *
 *   node scripts/demo/e2e4/voice-off.mjs [baseUrl]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = path.resolve('docs/night/e2e-evidence/iteration-4');
const SHOTS = path.resolve('docs/night/shots/e2e4');
const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';
const BAR = 'input[aria-label="Ask the agent"]';
const CARD = 'article.paillette-card';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitForTurn = async (page, deadline = 180_000) => {
  await page
    .waitForFunction(() => !!document.querySelector('button[aria-label="Working"]'), { timeout: 30_000 })
    .catch(() => {});
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Working"]'), {
    timeout: deadline,
  });
};

await mkdir(OUT, { recursive: true });
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Before any of the page's own script: record every attempt to speak or listen.
await page.addInitScript(() => {
  window.__spoken = [];
  window.__recognisersStarted = 0;
  try {
    if (window.speechSynthesis) {
      const real = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (utterance) => {
        window.__spoken.push(String(utterance?.text ?? ''));
        return real(utterance);
      };
    }
  } catch {
    /* no speechSynthesis in this build of Chromium */
  }
  for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
    const Real = window[name];
    if (!Real) continue;
    window[name] = class extends Real {
      start(...args) {
        window.__recognisersStarted += 1;
        return super.start(...args);
      }
    };
  }
});

await page.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`, {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});
await page.waitForSelector(CARD, { timeout: 120_000 });

await page.click(BAR);
await page.type(BAR, SOFA, { delay: 5 });
await page.press(BAR, 'Enter');
await waitForTurn(page);
await sleep(2500);

const out = await page.evaluate(() => ({
  spoken: window.__spoken ?? null,
  recognisersStarted: window.__recognisersStarted ?? null,
  speechSynthesisPresent: !!window.speechSynthesis,
  micButton: !!document.querySelector('button[aria-label="Hold to speak"]'),
  note: document.querySelector('.paillette-wall-label')?.textContent?.trim() ?? null,
  pending: window.speechSynthesis ? window.speechSynthesis.pending : null,
  speaking: window.speechSynthesis ? window.speechSynthesis.speaking : null,
}));

await page.screenshot({ path: path.join(SHOTS, '40-voice-off-typed-turn.png') });

console.log(JSON.stringify(out, null, 2));
console.log('\n--- read out ---');
console.log(`mic button on the page:   ${out.micButton}`);
console.log(`speechSynthesis present:  ${out.speechSynthesisPresent}`);
console.log(`utterances spoken:        ${out.spoken === null ? 'n/a' : out.spoken.length}`);
console.log(`recognisers started:      ${out.recognisersStarted}`);
console.log(`note on screen:           ${JSON.stringify(out.note)}`);

await writeFile(path.join(OUT, 'voice-off.json'), JSON.stringify({ base: BASE, instruction: SOFA, ...out }, null, 2));
await browser.close();
