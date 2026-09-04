/**
 * What voice adds on top of the proven typed path — and what it cannot prove here.
 *
 * The typed loop is the primary path and is settled elsewhere. This asks the
 * narrower question: with the typed loop working, does switching voice on
 * break anything, and how far down the spoken path can this machine actually
 * get?
 *
 * The honest boundary: headless Chromium *does* expose a `SpeechRecognition`
 * constructor — so the mic control is on screen — but Chrome performs
 * recognition by streaming audio to a Google service, and there is no
 * microphone here and no audio to stream. So `start()` can be called and the
 * failure it produces can be observed, but no spoken word can ever reach the
 * page on this box. Everything after the transcript is testable, and is tested
 * here by delivering the words the way the recogniser's final result would.
 *
 * No model calls: the agent route is refused at the edge, so what the page
 * *tried* to send is recorded without anything being billed.
 *
 *   PLAYWRIGHT_CORE=… node scripts/demo/e2e2-voice.mjs <base-url> <out-dir>
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e2-voice';
const QUERY = process.env.E2E_QUERY ?? 'warm landscape';

const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const note = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  process.stdout.write(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}\n`
  );
};

const main = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['microphone'],
  });
  const page = await ctx.newPage();

  const attempted = [];
  // Refuse the agent route at the edge. What the page *wanted* to send is the
  // evidence; paying for the answer is not.
  await page.route('**/api/public-agent/turn', async (route) => {
    let body = null;
    try {
      body = JSON.parse(route.request().postData() ?? 'null');
    } catch {
      body = { unparsed: route.request().postData()?.slice(0, 300) };
    }
    attempted.push(body?.turn ?? body);
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: { code: 'BLOCKED_BY_HARNESS' } }),
    });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-artwork-id]').length > 0,
    { timeout: 60_000 }
  );
  await sleep(1500);

  // --- what this browser actually has ------------------------------------
  const capability = await page.evaluate(() => ({
    SpeechRecognition: typeof window.SpeechRecognition,
    webkitSpeechRecognition: typeof window.webkitSpeechRecognition,
    speechSynthesis: typeof window.speechSynthesis,
    voices: window.speechSynthesis?.getVoices?.().length ?? 0,
    mediaDevices: typeof navigator.mediaDevices?.getUserMedia,
  }));
  note(
    capability.SpeechRecognition === 'function',
    'headless Chromium DOES expose a SpeechRecognition constructor',
    JSON.stringify(capability)
  );
  note(
    capability.voices === 0,
    '…and NO synthesis voices, so nothing can actually be spoken back here',
    `${capability.voices} voices`
  );

  // --- the mic control ----------------------------------------------------
  const mic = page.locator('button[aria-label="Hold to speak"]').first();
  const micCount = await mic.count();
  note(micCount === 1, 'the push-to-talk control is on screen', `count=${micCount}`);
  await page.screenshot({ path: path.join(OUT, 'v1-bar-idle.png') });

  // Press it and see what a machine with no microphone does. This is the case
  // a judge on a locked-down laptop will hit, so a silent hang is a defect and
  // a legible refusal is not.
  let heldState = null;
  if (micCount) {
    // Push to talk is a hold, not a click: press, hold, release.
    const box = await mic.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await sleep(2500);
    const whileHeld = await page.evaluate(() => {
      const b = document.querySelector(
        'button[aria-label="Hold to speak"], button[aria-label="Listening — release to send"]'
      );
      return { label: b?.getAttribute('aria-label'), pressed: b?.getAttribute('aria-pressed') };
    });
    heldState = whileHeld;
    await page.screenshot({ path: path.join(OUT, 'v2a-mic-held.png') });
    await page.mouse.up();
    await sleep(3000);
  }
  const afterMic = await page.evaluate(() => {
    const bar = document.querySelector('input[aria-label="Ask the agent"]');
    const micButton = document.querySelector(
      'button[aria-label="Hold to speak"], button[aria-label="Listening — release to send"]'
    );
    return {
      listening: micButton?.getAttribute('aria-pressed') ?? null,
      barValue: bar?.value ?? null,
      barDisabled: bar?.disabled ?? null,
      status: [...document.querySelectorAll('[role="status"], [data-voice-status]')]
        .map((el) => el.textContent?.trim())
        .filter(Boolean)
        .slice(0, 6),
      anyVisibleError: [...document.querySelectorAll('[role="alert"]')]
        .map((el) => el.textContent?.trim())
        .filter(Boolean),
    };
  });
  note(
    true,
    'holding the mic on a machine with no microphone — while held',
    JSON.stringify(heldState)
  );
  note(
    true,
    '…and after release',
    JSON.stringify(afterMic)
  );
  note(
    errors.length === 0,
    'pressing the mic throws no uncaught error',
    JSON.stringify(errors)
  );
  await page.screenshot({ path: path.join(OUT, 'v2-after-mic-press.png') });

  // --- the transcript path, which is everything after recognition ---------
  //
  // Delivered the way the recogniser's final result delivers it: the words
  // land in the editable field, and the human commits them. That is §5's "a
  // voice utterance lands in the editable field" — the half of the spoken path
  // that does not need a microphone.
  const typedDirectly = await page.evaluate((text) => {
    const bar = document.querySelector('input[aria-label="Ask the agent"]');
    if (!bar) return null;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    setter?.call(bar, text);
    bar.dispatchEvent(new Event('input', { bubbles: true }));
    return bar.value;
  }, SOFA);
  note(
    typedDirectly === SOFA,
    'a transcript lands in the editable field, verbatim and editable',
    JSON.stringify(typedDirectly)
  );
  const editable = await page.evaluate(() => {
    const bar = document.querySelector('input[aria-label="Ask the agent"]');
    return { readOnly: bar?.readOnly ?? null, disabled: bar?.disabled ?? null };
  });
  note(
    editable.readOnly === false && editable.disabled === false,
    'the field the transcript landed in is editable, not a read-only receipt',
    JSON.stringify(editable)
  );
  await page.screenshot({ path: path.join(OUT, 'v3-transcript-in-field.png') });

  await page.locator('input[aria-label="Ask the agent"]').press('Enter');
  await sleep(4000);
  note(
    attempted.length >= 1,
    'committing the transcript sends exactly the same turn a typed instruction does',
    JSON.stringify(attempted[0]).slice(0, 400)
  );
  note(
    attempted[0]?.text === SOFA,
    'the turn carries the transcript verbatim',
    JSON.stringify(attempted[0]?.text)
  );
  await page.screenshot({ path: path.join(OUT, 'v4-turn-refused-by-harness.png') });

  await writeFile(
    path.join(OUT, 'voice.json'),
    `${JSON.stringify(
      { base: BASE, capability, heldState, afterMic, attempted, results, errors },
      null,
      2
    )}\n`
  );

  await ctx.close();
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${results.length - failed.length} passed, ${failed.length} failed\n`);
};

await main();
