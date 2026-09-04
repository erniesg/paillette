/**
 * The one image the submission is built on: the agent's sentence and the board
 * it describes, on screen together, at the viewport a judge will use.
 *
 * The iteration-2 critique failed the build on exactly this and measured it
 * rather than asserting it, so this measures it back the same way — a real
 * typed instruction, a real model turn, and then the rectangles.
 *
 *   node apps/web/scripts/verify-money-shot.mjs [baseUrl]
 */

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const VIEWPORT = { width: 1440, height: 900 };
const SHOTS = '/tmp/moneyshot';
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (label, ok, detail) => {
  results.push({ label, ok: Boolean(ok), detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

/** Read every rectangle that matters, at whatever scroll the page is at. */
const measure = () =>
  page.evaluate(() => {
    const vh = window.innerHeight;
    const visible = (r) => r && r.bottom > 0 && r.top < vh;
    // The agent's sentence is a wall label set in the serif, carrying the ink
    // of whoever wrote it. `board-note.tsx` renders it as `.paillette-wall-label`.
    const noteEl = document.querySelector('.paillette-wall-label');
    const cardEls = [...document.querySelectorAll('.paillette-card')];
    const boxes = cardEls.map((c) => c.getBoundingClientRect());
    const barEl = document.querySelector('input[aria-label="Ask the agent"]');
    const nr = noteEl?.getBoundingClientRect();
    const br = barEl?.getBoundingClientRect();
    return {
      scrollY: Math.round(window.scrollY),
      viewport: vh,
      note: nr
        ? {
            top: Math.round(nr.top),
            bottom: Math.round(nr.bottom),
            visible: visible(nr),
            text: (noteEl.textContent || '').trim().slice(0, 120),
          }
        : null,
      cards: cardEls.length,
      cardsVisible: boxes.filter(visible).length,
      cardsWhole: boxes.filter((b) => b.top >= 0 && b.bottom <= vh).length,
      bar: br
        ? { top: Math.round(br.top), bottom: Math.round(br.bottom), visible: visible(br) }
        : null,
    };
  });

console.log(`\n=== ${BASE} @ ${VIEWPORT.width}x${VIEWPORT.height} ===`);

console.log('\n[0] a judge opening cold finds the agent');
// The critique opened the page the way a judge would — no query, no debug flag
// — and could not find the control at all, because it sat below the fold in a
// 900px viewport. That is a question about the first screen, so it is asked
// before anything else happens to the page.
await page.goto(`${BASE}/nga/search`, { waitUntil: 'networkidle', timeout: 90_000 });
const cold = await page.evaluate(() => {
  const bar = document.querySelector('input[aria-label="Ask the agent"]');
  if (!bar) return { present: false };
  const r = bar.getBoundingClientRect();
  return {
    present: true,
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    viewport: window.innerHeight,
    inView: r.top >= 0 && r.bottom <= window.innerHeight,
    placeholder: bar.getAttribute('placeholder'),
  };
});
console.log('    ', JSON.stringify(cold));
check('the utterance bar exists on a cold load', cold.present);
check(
  'and it is on the first screen, unscrolled',
  cold.inView,
  `${cold.top}..${cold.bottom} in ${cold.viewport}`
);
check('and it says what it is for', Boolean(cold.placeholder), JSON.stringify(cold.placeholder));
await page.screenshot({ path: `${SHOTS}/cold-open.png` });

await page.goto(`${BASE}/nga/search?q=warm%20harbour%20at%20dusk&webmcp-debug`, {
  waitUntil: 'networkidle',
  timeout: 90_000,
});
await page.waitForSelector('.paillette-card', { timeout: 60_000 });

console.log('\n[1] a typed instruction alone fires the agent');
const agentCalls = [];
page.on('request', (r) => {
  if (r.url().includes('/public-agent/')) agentCalls.push(r.url());
});
const bar = page.locator('input[aria-label="Ask the agent"]');
await bar.click();
await bar.fill('Something warm for above the sofa. Not busy, nothing grim.');
await page.keyboard.press('Enter');

// The turn is a real model call against the real collection; give it room.
await page
  .waitForFunction(
    () => {
      const n = document.querySelector('.paillette-wall-label');
      return n && (n.textContent || '').trim().length > 10;
    },
    undefined,
    { timeout: 180_000 }
  )
  .catch(() => {});
await page.waitForTimeout(3000);

check('the typed instruction made a model call', agentCalls.length > 0, `${agentCalls.length}`);

console.log('\n[2] where everything landed, at the scroll the page chose');
const atRest = await measure();
console.log('    ', JSON.stringify(atRest));
check('the agent wrote a note', atRest.note !== null, atRest.note?.text);
await page.screenshot({ path: `${SHOTS}/at-rest.png` });

console.log('\n[3] the money shot: note + board + bar together, at some scroll');
// Try the top of the page first, then let the page settle where it wants, then
// scroll the note to the top. The claim is only that *a* scroll position shows
// all three — a human can scroll, but they cannot make an off-page element
// exist.
const positions = [];
for (const [label, action] of [
  ['top of page', async () => page.evaluate(() => window.scrollTo(0, 0))],
  ['note scrolled into view', async () =>
    page.evaluate(() => {
      document.querySelector('.paillette-wall-label')?.scrollIntoView({ block: 'start' });
    })],
  ['bar scrolled into view', async () =>
    page.evaluate(() => {
      document.querySelector('input[aria-label="Ask the agent"]')?.scrollIntoView({ block: 'center' });
    })],
]) {
  await action();
  await page.waitForTimeout(700);
  const m = await measure();
  const all = Boolean(m.note?.visible) && m.cardsVisible >= 4 && Boolean(m.bar?.visible);
  positions.push({ label, m, all });
  console.log(`    ${label}: note=${m.note?.visible} cards=${m.cardsVisible}/${m.cards} bar=${m.bar?.visible} scrollY=${m.scrollY}`);
  await page.screenshot({ path: `${SHOTS}/${label.replace(/\s+/g, '-')}.png` });
}

const best = positions.find((p) => p.all);
check(
  'the note, the board and the bar are on one screen at some scroll position',
  Boolean(best),
  best ? best.label : positions.map((p) => `${p.label}:note=${p.m.note?.visible},cards=${p.m.cardsVisible},bar=${p.m.bar?.visible}`).join(' | ')
);

const noteAndBoard = positions.find((p) => p.m.note?.visible && p.m.cardsVisible >= 4);
check(
  'at minimum the note and its board are on one screen',
  Boolean(noteAndBoard),
  noteAndBoard ? `${noteAndBoard.label} — ${noteAndBoard.m.cardsVisible} cards with the note` : 'never together'
);

check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

const failed = results.filter((r) => !r.ok);
console.log(`\n================ ${results.length - failed.length}/${results.length} passed ================`);
failed.forEach((f) => console.log(`  FAIL ${f.label}${f.detail ? ` — ${f.detail}` : ''}`));
console.log(`shots in ${SHOTS}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
