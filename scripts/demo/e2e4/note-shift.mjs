/**
 * Why the pick moved 54px on the first human redeal, when its slot did not.
 *
 * The loop harness measures a pick's screen position board-to-board. On the
 * redeal that follows an agent turn it reported `moved: 54` while the card's
 * `data-board-slot` was unchanged (2 → 2) and its x was identical. So the slot
 * held and the whole board translated. This measures what moved instead: the
 * agent's wall label above the board, which a human redeal does not rewrite.
 *
 * Records, before and after one Enter on an empty bar:
 *   - the note element, its text and its box
 *   - the board container's top
 *   - one pick's slot, box and card height
 *
 *   node scripts/demo/e2e4/note-shift.mjs [baseUrl]
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
    .waitForFunction(() => !!document.querySelector('button[aria-label="Working"]'), {
      timeout: 30_000,
    })
    .catch(() => {});
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Working"]'), {
    timeout: deadline,
  });
};

/** The note, the board's top edge, and every card's slot and box. */
const measure = (page) =>
  page.evaluate(() => {
    // Two frames of reference, because they answer different questions.
    // Viewport coordinates are what the eye sees; document coordinates are
    // where the board actually sits. A redeal that scrolls the page moves
    // everything in the first and nothing in the second.
    const box = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        top: Math.round(b.top),
        docTop: Math.round(b.top + window.scrollY),
        left: Math.round(b.left),
        w: Math.round(b.width),
        h: Math.round(b.height),
      };
    };
    const note = document.querySelector('.paillette-wall-label');
    const viewport = document.querySelector('.lt-deal-viewport');
    const cards = [...document.querySelectorAll('article.paillette-card')].map((el) => {
      const slot = el.closest('[data-board-slot]');
      const b = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-artwork-id'),
        slot: slot ? Number(slot.getAttribute('data-board-slot')) : null,
        slotBox: box(slot),
        flag: el.getAttribute('data-flag'),
        hovered: el.matches(':hover'),
        box: box(el),
      };
    });
    return {
      note: note ? { text: note.textContent.trim(), provenance: note.getAttribute('data-provenance'), box: box(note) } : null,
      dealViewport: box(viewport),
      cards,
      scrollY: Math.round(window.scrollY),
    };
  });

await mkdir(OUT, { recursive: true });
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`, {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});
await page.waitForSelector(CARD, { timeout: 120_000 });

await page.click(BAR);
await page.type(BAR, SOFA, { delay: 5 });
await page.press(BAR, 'Enter');
await waitForTurn(page);
await sleep(2000);

// one pick, on the third card of the agent's board
const ids = await page.evaluate(
  (sel) => [...document.querySelectorAll(sel)].map((el) => el.getAttribute('data-artwork-id')),
  CARD
);
const pickId = ids[2];
const el = page.locator(`${CARD}[data-artwork-id="${pickId}"]`).first();
await el.hover();
await sleep(150);
await page.keyboard.press('p');
await sleep(400);

// and reject two, so the redeal has something to push away — the loop's shape
for (const id of [ids[0], ids[1]]) {
  const card = page.locator(`${CARD}[data-artwork-id="${id}"]`).first();
  await card.hover();
  await sleep(150);
  await page.keyboard.press('x');
  await sleep(300);
}

// park the pointer off every card, so nothing is measured mid-hover-lift
await page.mouse.move(5, 5);
await sleep(300);
const before = await measure(page);
await page.screenshot({ path: path.join(SHOTS, '20-note-shift-before.png') });

await page.click(BAR);
await page.press(BAR, 'Enter');
await sleep(4000);
await page.mouse.move(5, 5);
await sleep(400);
const after = await measure(page);
await page.screenshot({ path: path.join(SHOTS, '21-note-shift-after.png') });

const pickBefore = before.cards.find((c) => c.id === pickId);
const pickAfter = after.cards.find((c) => c.id === pickId);

const report = {
  base: BASE,
  pickId,
  note: { before: before.note, after: after.note },
  dealViewport: { before: before.dealViewport, after: after.dealViewport },
  pick: {
    before: pickBefore ? { slot: pickBefore.slot, box: pickBefore.box, slotBox: pickBefore.slotBox, hovered: pickBefore.hovered } : null,
    after: pickAfter ? { slot: pickAfter.slot, box: pickAfter.box, slotBox: pickAfter.slotBox, hovered: pickAfter.hovered } : null,
  },
  boardSize: { before: before.cards.length, after: after.cards.length },
  scrollY: { before: before.scrollY, after: after.scrollY },
};

console.log(JSON.stringify(report, null, 2));
console.log('\n--- read out ---');
console.log(`note before: ${report.note.before ? `present, ${report.note.before.box.h}px tall — ${JSON.stringify(report.note.before.text)}` : 'ABSENT'}`);
console.log(`note after:  ${report.note.after ? `present, ${report.note.after.box.h}px tall — ${JSON.stringify(report.note.after.text)}` : 'ABSENT'}`);
console.log(`scrollY:     ${report.scrollY.before} → ${report.scrollY.after}`);
console.log(`pick slot:   ${report.pick.before?.slot} → ${report.pick.after?.slot}`);
console.log(`pick y  (viewport):  ${report.pick.before?.box.top} → ${report.pick.after?.box.top}`);
console.log(`pick y  (document):  ${report.pick.before?.box.docTop} → ${report.pick.after?.box.docTop}`);
console.log(`card height: ${report.pick.before?.box.h} → ${report.pick.after?.box.h}`);
console.log(`board top (document): ${report.dealViewport.before?.docTop} → ${report.dealViewport.after?.docTop}`);
console.log(`board size:  ${report.boardSize.before} → ${report.boardSize.after}`);

await writeFile(path.join(OUT, 'note-shift.json'), JSON.stringify(report, null, 2));
await browser.close();
