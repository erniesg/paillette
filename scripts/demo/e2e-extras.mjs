/**
 * The three things the two other e2e scripts leave open, none of which may
 * spend a model call:
 *
 *  1. A compare choice does not fire a turn of its own. Does it actually ride
 *     the next one? Asserted against the request body, with the agent route
 *     refused at the edge so nothing is billed.
 *  2. The loop with no `?webmcp-debug` at all — no host, no prompt bar — which
 *     is what an ordinary visitor gets.
 *  3. What speech does and does not do in headless Chromium.
 *
 *   PLAYWRIGHT_CORE=… node scripts/demo/e2e-extras.mjs <base-url> <out-dir>
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e-extras';
const QUERY = process.env.E2E_QUERY ?? 'sunset landscape';
await mkdir(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const note = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
};

const flag = async (page, id, key) => {
  await page.evaluate(() => document.activeElement?.blur?.());
  const card = page.locator(`[data-artwork-id="${id}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.keyboard.press(key);
  await sleep(250);
};

const dealtIds = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')].map((el) =>
      el.getAttribute('data-artwork-id')
    )
  );

const browser = await chromium.launch();

// --- 1. does a compare choice ride the next turn? -----------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const bodies = [];
  // Refused at the edge, so the claim is checked without spending the budget.
  await ctx.route('**/api/public-agent/turn', async (route) => {
    try {
      bodies.push(JSON.parse(route.request().postData() ?? 'null'));
    } catch {
      bodies.push({ unparsed: true });
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"success":false,"error":{"message":"refused by e2e-extras — no model call spent"}}',
    });
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-artwork-id]').length > 0,
    { timeout: 45_000 }
  );
  await page.waitForFunction(
    async () => ((await window.__paillette_webmcp?.tools?.()) ?? []).length > 0,
    { timeout: 45_000 }
  );
  const ids = await dealtIds(page);
  const pair = [ids[0], ids[1]];
  await page.evaluate(
    ([a, b]) =>
      window.__paillette_webmcp.call('compare_artworks', {
        artworkIds: [a, b],
        question: 'Which one holds the wall better?',
      }),
    pair
  );
  await sleep(1500);
  await page.locator(`.paillette-compare-work[data-artwork-id="${pair[0]}"]`).click();
  await sleep(1500);
  note(
    bodies.length === 0,
    'a compare choice fires no turn of its own',
    `${bodies.length} agent requests after the click`
  );

  // Now type something and read what the page tells the model.
  const bar = page.locator('input[aria-label="Ask the agent"]');
  await bar.click();
  await bar.fill('what do these have in common?');
  await bar.press('Enter');
  await sleep(6000);
  const first = bodies[0];
  const choice = first?.turn?.compareChoice ?? null;
  note(
    choice?.winner?.id === pair[0] && choice?.loser?.id === pair[1],
    'the compare choice rides the next turn',
    JSON.stringify(choice)
  );
  note(
    (first?.turn?.flagsDelta ?? []).length >= 2,
    'the flags the choice laid down ride with it',
    JSON.stringify(first?.turn?.flagsDelta)
  );
  await writeFile(
    path.join(OUT, 'compare-turn-payload.json'),
    `${JSON.stringify(first?.turn ?? null, null, 2)}\n`
  );
  await page.screenshot({ path: path.join(OUT, '08-compare-rides-next-turn.png') });
  await ctx.close();
}

// --- 2. the loop with no host and no debug flag -------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const net = [];
  const page = await ctx.newPage();
  page.on('request', (r) => net.push(r.url()));
  await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-artwork-id]').length > 0,
    { timeout: 45_000 }
  );
  await sleep(2500);
  const barCount = await page.locator('input[aria-label="Ask the agent"]').count();
  note(barCount === 0, 'no prompt bar without a host', `count=${barCount}`);
  const ids = await dealtIds(page);
  await flag(page, ids[0], 'x');
  await flag(page, ids[1], 'p');
  const marks = await page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')]
      .map((el) => ({ id: el.getAttribute('data-artwork-id'), flag: el.getAttribute('data-flag') }))
      .filter((m) => m.flag !== 'none')
  );
  note(marks.length === 2, 'P and X still flag with no agent on the page', JSON.stringify(marks));
  const mark = net.length;
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Enter');
  await page
    .waitForFunction(
      (prev) =>
        [...document.querySelectorAll('[data-artwork-id]')]
          .map((el) => el.getAttribute('data-artwork-id'))
          .join(',') !== prev,
      ids.join(','),
      { timeout: 45_000 }
    )
    .catch(() => {});
  await sleep(1500);
  const after = net.slice(mark);
  note(
    after.some((u) => u.includes('exemplar')) &&
      !after.some((u) => u.includes('public-agent/turn')),
    'Enter on the bare board redeals, with no agent anywhere',
    `${after.filter((u) => u.includes('/api/')).join(' , ')}`
  );
  const grid = await page.evaluate(() =>
    Boolean(document.querySelector('[data-testid="deal-board-grid"]'))
  );
  note(grid, 'the deal board renders for a visitor with no agent');
  await page.screenshot({ path: path.join(OUT, '09-no-host-redeal.png') });
  await ctx.close();
}

// --- 3. speech, on this machine ----------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(
    async () => ((await window.__paillette_webmcp?.tools?.()) ?? []).length > 0,
    { timeout: 45_000 }
  );
  await sleep(1500);
  const speech = await page.evaluate(() => ({
    SpeechRecognition: typeof window.SpeechRecognition,
    webkitSpeechRecognition: typeof window.webkitSpeechRecognition,
    speechSynthesis: typeof window.speechSynthesis,
    voices: window.speechSynthesis?.getVoices?.().length ?? 0,
    mediaDevices: typeof navigator.mediaDevices?.getUserMedia,
  }));
  const micButton = await page.locator('button[aria-label="Hold to speak"]').count();
  note(
    speech.SpeechRecognition === 'undefined' && speech.webkitSpeechRecognition === 'undefined',
    'headless Chromium exposes no SpeechRecognition — the spoken path cannot be proven here',
    JSON.stringify(speech)
  );
  note(
    micButton === 0,
    'the mic control is feature-detected away where recognition is missing',
    `push-to-talk buttons on screen: ${micButton}`
  );
  note(
    speech.speechSynthesis === 'object',
    'speech *synthesis* exists, so the reply-aloud half is at least reachable',
    `${speech.voices} voices installed`
  );
  await page.screenshot({ path: path.join(OUT, '10-no-mic.png') });
  await ctx.close();
}

await browser.close();
await writeFile(path.join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
const failed = results.filter((r) => !r.ok);
process.stdout.write(`\n${results.length - failed.length} passed, ${failed.length} failed\n`);
process.exit(failed.length ? 1 : 0);
