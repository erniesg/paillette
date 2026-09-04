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
 *   pnpm --filter web dev --port 5199 --strictPort   # in one terminal
 *   node apps/web/scripts/voice-loop-verify.mjs
 *
 * Exits non-zero if any check fails.
 */
import { chromium } from '@playwright/test';

// Other lanes run their own dev servers on this VM and 5173 is first-come.
// Pin the port, or this silently verifies somebody else's tree — which it did
// once, and the results looked entirely plausible.
const BASE = process.env.PAILLETTE_BASE ?? 'http://localhost:5199';
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
const agentBodies = [];

await page.route('**/api/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/public-agent/turn')) {
    agentCalls += 1;
    try { agentBodies.push(JSON.parse(route.request().postData() ?? '{}')); } catch { /* ignore */ }
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

// The agent's activity used to be a fixed panel across the lower-left of the
// board that reopened itself whenever the agent did anything, intercepting
// clicks on the cards underneath — so this script dismissed it the way a person
// would. It is now a glyph, and the log behind it opens only on a click, so
// this is a no-op in the normal case. It stays because a consent gate still
// opens the log by itself, and that would cover the same cards.
const dismissPanel = async () => {
  if (await page.locator('.pa-activity-log').count()) {
    await page.click('.pa-activity-glyph');
    await page.waitForTimeout(200);
  }
};
await dismissPanel();

const bar = page.locator('input[aria-label="Ask the agent"]');
const card = (id) => page.locator(`[data-artwork-id="${id}"]`).first();
check('utterance bar renders', (await bar.count()) === 1);
const c0 = await ctx();
check('grid has works', (c0.humanResults?.count ?? 0) > 0, `${c0.humanResults?.count} on screen`);

// -- 0b. PLURAL DEIXIS: "these two" against a real selection -----------------
// Done before the first agent turn, because the activity panel appears the
// moment the agent acts and then covers the lower-left of the board.
// Shift-click is "these"; a plain click opens the work instead.
await bar.click();
await bar.fill('');
// No board has been dealt yet at this point; the grid is showing the search.
await card('nga-1').click({ modifiers: ['Shift'] });
await page.waitForTimeout(200);
await card('nga-2').click({ modifiers: ['Shift'] });
await page.waitForTimeout(300);
const selection = (await ctx()).selection ?? [];
check('shift-click selects more than one work', selection.length >= 2,
  JSON.stringify(selection.map((s) => s.id)));
await bar.click();
await page.keyboard.type('something between these two');
await page.waitForTimeout(500);
check('plural deixis resolves against the selection',
  (await page.locator('p.flex.flex-wrap img').count()) >= 2,
  `${await page.locator('p.flex.flex-wrap img').count()} thumbnail(s)`);
check('two pictures need no "2 works" caption',
  (await page.getByText('2 works', { exact: true }).count()) === 0);
await page.screenshot({ path: '/tmp/vcheck/plural-live.png' });
await bar.fill('');
await page.waitForTimeout(200);

// -- 1. TEXT FIRST: typed instruction alone fires the agent -----------------
await bar.click();
await bar.fill('something warm for above the sofa');
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
check('typed instruction fires the agent', agentCalls === 1, `${agentCalls} call(s)`);
check('note is rendered', (await page.getByText('Five warm, calm options.', { exact: false }).count()) > 0);
check('typed turn stays silent', (await page.evaluate(() => window.__spoken)).length === 0);

// -- 2. HUMAN FLAGS: hover + P / X ------------------------------------------
// The search field carries `autofocus`, and the grid keys are correctly
// ignored while a text field has focus — so on a fresh page P does nothing
// until focus leaves it. A click on the board is what a human does first
// anyway; without it this whole section is dead. See voice-loop-notes.md.
await page.mouse.click(640, 470);
await page.waitForTimeout(150);
check('grid keys are reachable (focus not trapped in a field)',
  await page.evaluate(() => document.activeElement?.tagName !== 'INPUT'),
  await page.evaluate(() => document.activeElement?.tagName ?? '?'));
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

// U clears a flag; C puts two works up against each other.
await card('nga-2').hover();
await page.keyboard.press('u');
await page.waitForTimeout(250);
const cU = await ctx();
check('U clears the flag it was put on',
  !(cU.flags?.rejects ?? []).some((f) => f.id === 'nga-2'),
  JSON.stringify((cU.flags?.rejects ?? []).map((f) => f.id)));
// Put it back, so the redeal below still has a reject to act on.
await page.keyboard.press('x');
await page.waitForTimeout(200);

await card('nga-3').hover();
await page.keyboard.press('c');
await page.waitForTimeout(400);
const cC = await ctx();
check('C opens a two-up', Boolean(cC.compare), JSON.stringify(cC.compare));
await page.screenshot({ path: '/tmp/vcheck/compare.png' });

// Answer it the way a human does — one click. The winner becomes a pick and
// the loser a reject, which is what "gestures are utterances" means here.
// There is no Escape on this dialog, so clicking is also the only way out.
const [winnerId, loserId] = cC.compare.artworkIds;
await page.locator(`.paillette-compare-work[data-artwork-id="${winnerId}"]`).click();
await page.waitForTimeout(400);
const cAfter = await ctx();
check('the two-up closes when answered', !cAfter.compare);
check('the winner became a pick',
  (cAfter.flags?.picks ?? []).some((f) => f.id === winnerId));
check('the loser became a reject',
  (cAfter.flags?.rejects ?? []).some((f) => f.id === loserId));
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

// -- 3b. GESTURES RIDE THE TURN ---------------------------------------------
// The board is flagged by now, so the next typed turn must carry the flags —
// with titles, or the agent can only recite ids back at somebody.
// Whatever is on the board after the redeals, minus the pick we are keeping.
// The journal was drained by the redeals, so these are fresh gestures.
const onBoard = (c3.board?.order ?? []).filter((id) => id !== 'nga-1');
const target = onBoard[0];
// Note the bar is NOT focused here: a bare letter must reach the grid, and
// pressing x with the caret in the field types an x, which is correct.
await page.mouse.click(640, 470);
await page.waitForTimeout(150);
await card(target).hover();
await page.keyboard.press('x');
await page.waitForTimeout(200);
// And answer a two-up, so the choice is pending when the turn goes.
await card(onBoard[1]).hover();
await page.keyboard.press('c');
await page.waitForTimeout(400);
const cmp = (await ctx()).compare;
if (cmp) {
  await page.locator(`.paillette-compare-work[data-artwork-id="${cmp.artworkIds[0]}"]`).click();
  await page.waitForTimeout(300);
}
await bar.click();
await bar.fill('now warmer');
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
const lastTurn = agentBodies.at(-1)?.turn;
const delta = lastTurn?.flagsDelta ?? [];
check('the typed turn carries the gestures', delta.length > 0,
  `${delta.length} flag change(s)`);
check('the compare answer rides the next turn',
  Boolean(lastTurn?.compareChoice),
  JSON.stringify(lastTurn?.compareChoice ?? null).slice(0, 120));
check('flag changes name the work, not just its id',
  delta.every((f) => typeof f.title === 'string' && f.title.length > 0),
  JSON.stringify(delta.map((f) => `${f.to}:${f.title ?? f.artworkId}`)));

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
