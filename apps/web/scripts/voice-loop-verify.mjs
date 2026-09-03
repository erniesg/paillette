/**
 * Section 9 of the brief, run end to end against the real page in real
 * Chromium. The board, the store, the tools, the keyboard and the utterance
 * bar are all genuine; only the network is fixtured, so the run is
 * deterministic and needs no API key.
 *
 * Unit tests could not have caught the two worst bugs this found. jsdom sets
 * `document.modelContext` before anything mounts, so the race that kept the
 * bar off the page did not exist there; and jsdom has no layout, so nothing
 * that depends on the cursor leaving a card was observable.
 *
 *   pnpm --filter web dev          # in one terminal
 *   node apps/web/scripts/voice-loop-verify.mjs
 *
 * Exits non-zero if any check fails.
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const WORKS = [
  ['nga-1', 'Lumber Schooners at Evening on Penobscot Bay', 'Fitz Henry Lane'],
  ['nga-2', "Estuary at Day's End", 'Fitz Henry Lane'],
  ['nga-3', 'Fallen Tree', 'George Inness'],
  ['nga-4', 'Autumn Oaks', 'George Inness'],
  ['nga-5', 'The Lackawanna Valley', 'George Inness'],
  ['nga-6', 'Salt Marsh', 'Martin Johnson Heade'],
  ['nga-7', 'Approaching Thunder Storm', 'Martin Johnson Heade'],
  ['nga-8', 'Sunset over the Marshes', 'Martin Johnson Heade'],
  ['nga-9', 'Lake George', 'John Frederick Kensett'],
  ['nga-10', 'Newport Coast', 'John Frederick Kensett'],
  ['nga-11', 'Beacon Rock', 'John Frederick Kensett'],
  ['nga-12', 'Twilight in the Wilderness', 'Frederic Edwin Church'],
];
const px =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#7a5230"/></svg>'
  ).toString('base64');
const asResult = ([id, title, artist], i) => ({
  id, galleryId: 'nga', title, artist, year: 1860 + i,
  imageUrl: px, thumbnailUrl: px, similarity: 0.9 - i * 0.01,
  metadata: { medium: 'oil on canvas' },
});
const body = (ids = WORKS.map((w) => w[0])) => {
  const chosen = WORKS.filter((w) => ids.includes(w[0]));
  return { success: true, data: { results: chosen.map(asResult), count: chosen.length, total: chosen.length } };
};

const out = [];
const say = (l) => { out.push(l); console.log(l); };
const check = (label, pass, detail = '') =>
  say(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let agentCalls = 0, exemplarCalls = 0;

await page.route('**/api/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/public-agent/turn')) {
    agentCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true,
      data: { message: { role: 'assistant', content: 'Five warm, calm options. I dropped the two with figures.' } },
    })});
  }
  if (path.endsWith('/exemplars')) {
    exemplarCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(body(['nga-6','nga-7','nga-8','nga-9','nga-10','nga-11','nga-12'])) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body()) });
});

await page.addInitScript(() => {
  class FakeRecognition {
    constructor() { window.__rec = this; }
    start() { window.__recStarted = (window.__recStarted ?? 0) + 1; }
    stop() { window.__recStopped = (window.__recStopped ?? 0) + 1; }
  }
  // Chromium ships native SpeechRecognition and a read-only speechSynthesis
  // accessor, so both must be replaced by definition, not assignment.
  Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
  window.__spoken = [];
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speaking: false, pending: false, speak: (u) => window.__spoken.push(u.text), cancel() {} } });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(t) { this.text = t; } } });
});
page.on('pageerror', (e) => say(`PAGE ERROR: ${e.message}`));

const ctx = () => page.evaluate(() => window.__paillette_webmcp.call('get_view_context', {}));

await page.goto(`${BASE}/nga/search?webmcp-debug&q=estuary+at+dusk`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const bar = page.locator('input[aria-label="Ask the agent"]');
check('utterance bar renders', (await bar.count()) === 1);
const c0 = await ctx();
check('grid has works', (c0.humanResults?.count ?? 0) > 0, `${c0.humanResults?.count} on screen`);

// -- 1. TEXT FIRST: typed instruction alone fires the agent -----------------
await bar.click();
await bar.fill('something warm for above the sofa');
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
check('typed instruction fires the agent', agentCalls === 1, `${agentCalls} call(s)`);
check('note is rendered', (await page.getByText('Five warm, calm options.', { exact: false }).count()) > 0);
check('typed turn stays silent', (await page.evaluate(() => window.__spoken)).length === 0);

// -- 2. HUMAN FLAGS: hover + P / X ------------------------------------------
const card = (id) => page.locator(`[data-artwork-id="${id}"]`).first();
await card('nga-1').hover();
await page.keyboard.press('p');
await page.waitForTimeout(200);
await card('nga-2').hover();
await page.keyboard.press('x');
await page.waitForTimeout(300);
const c1 = await ctx();
check('P records a human pick', (c1.flags?.picks ?? []).some((f) => f.id === 'nga-1'),
  JSON.stringify((c1.flags?.picks ?? []).map((f) => f.id)));
check('X records a human reject', (c1.flags?.rejects ?? []).some((f) => f.id === 'nga-2'),
  JSON.stringify((c1.flags?.rejects ?? []).map((f) => f.id)));
check('hovered is reported', Boolean(c1.hovered), JSON.stringify(c1.hovered));
await page.screenshot({ path: '/tmp/vcheck/flags.png' });

// -- 3. ENTER ON AN EMPTY BAR: redeal, no model call ------------------------
const agentBefore = agentCalls;
const orderBefore = [...(c1.board?.order ?? [])];
await bar.click();
await bar.fill('');
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
const c2 = await ctx();
const orderAfter = [...(c2.board?.order ?? [])];
check('redeal ran the exemplar search', exemplarCalls >= 1, `${exemplarCalls} call(s)`);
check('redeal made NO model call', agentCalls === agentBefore, `${agentCalls - agentBefore} extra`);
check('board changed', JSON.stringify(orderBefore) !== JSON.stringify(orderAfter));
// Picks holding their index is only meaningful across two deals.
const idxA = orderAfter.indexOf('nga-1');
await bar.click(); await bar.fill(''); await page.keyboard.press('Enter');
await page.waitForTimeout(2200);
const c3 = await ctx();
const idxB = (c3.board?.order ?? []).indexOf('nga-1');
check('pick holds its place across a second redeal', idxA >= 0 && idxA === idxB,
  `index ${idxA} then ${idxB}`);
check('reject left the board', !orderAfter.includes('nga-2'));
await page.screenshot({ path: '/tmp/vcheck/redeal.png' });

// -- 4. DEIXIS: "this one" binds to what the cursor is over ------------------
await bar.click();
await bar.fill('');
await card('nga-6').hover();
await page.waitForTimeout(250);
await page.keyboard.type('more like this one but brighter');
await page.waitForTimeout(500);
const chipText = await page.locator('.text-primary-200').allInnerTexts();
check('typed deixis binds to the pointed-at work', chipText.length > 0, JSON.stringify(chipText));
check('the chip carries a thumbnail', (await page.locator('p.flex.flex-wrap img').count()) > 0);
// The referent must survive the cursor leaving the card.
await page.mouse.move(5, 5);
await page.waitForTimeout(300);
check('referent survives the cursor moving away',
  (await page.locator('.text-primary-200').allInnerTexts()).length > 0);
await page.screenshot({ path: '/tmp/vcheck/deixis.png' });

// -- 5. VOICE: push-to-talk in a real browser -------------------------------
const mic = page.locator('button[aria-label="Hold to speak"]');
check('mic control present', (await mic.count()) === 1);
await bar.fill('');
await mic.hover();
await page.mouse.down();
await page.waitForTimeout(200);
await page.evaluate(() =>
  window.__rec.onresult({ results: [Object.assign([{ transcript: 'something warm' }], { isFinal: false })] })
);
await page.waitForTimeout(200);
check('interim text lands in the field', (await bar.inputValue()) === 'something warm', await bar.inputValue());
await page.screenshot({ path: '/tmp/vcheck/listening.png' });

await page.evaluate(() =>
  window.__rec.onresult({ results: [Object.assign([{ transcript: 'something warm and quiet' }], { isFinal: true })] })
);
await page.mouse.up();
await page.waitForTimeout(250);
const graceVisible = await page.locator('[role="progressbar"]').count();
check('grace bar appears on release', graceVisible === 1);
await page.screenshot({ path: '/tmp/vcheck/grace.png' });

const agentBeforeVoice = agentCalls;
await page.waitForTimeout(1600);
check('utterance commits after the grace', agentCalls === agentBeforeVoice + 1, `${agentCalls - agentBeforeVoice}`);
await page.waitForTimeout(800);
check('spoken turn speaks the note back',
  (await page.evaluate(() => window.__spoken)).length === 1,
  JSON.stringify(await page.evaluate(() => window.__spoken)));

await browser.close();
console.log('\n================ RESULT ================');
console.log(out.join('\n'));
const failures = out.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
