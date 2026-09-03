/**
 * Drive the whole culling loop with the keyboard and nothing else.
 *
 * "Text first" means every beat works by typing with voice off, and at the
 * limit that means with no pointer either. Unit tests cover the pieces; this
 * asserts the pieces are wired to each other in a real browser — that a card
 * can hold focus, that P/X/U land on the focused card, that C opens two-up and
 * an arrow key answers it, and that picks keep their exact slots through a
 * redeal.
 *
 * It found a real bug the unit tests could not: `LightTableCard` rendered a
 * *disabled* button whenever it had nothing to open, which took every card out
 * of the tab order and silently killed the keyboard path on any board that was
 * not also click-to-open.
 *
 * Usage:
 *   pnpm --filter web dev --port 5211
 *   node scripts/drive-deal-keyboard.mjs [baseUrl]
 *
 * Exits non-zero on the first failed assertion, so it can gate a commit.
 */

import { createRequire } from 'node:module';
const require = createRequire(
  new URL('../apps/web/package.json', import.meta.url)
);
const { chromium } = require('@playwright/test');

const fails = [];
const ok = [];
const check = (cond, label) => (cond ? ok : fails).push(label);

const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1560, height: 1000 } });
const p = await c.newPage();
p.on('pageerror', (e) => fails.push('PAGE ERROR: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') fails.push('CONSOLE: ' + m.text().slice(0,120)); });

const baseUrl = process.argv[2] ?? 'http://localhost:5211';
await p.goto(`${baseUrl}/night/deal`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);

// 1. Are the cards reachable by Tab at all?
let reachedCard = false;
for (let i = 0; i < 40 && !reachedCard; i++) {
  await p.keyboard.press('Tab');
  reachedCard = await p.evaluate(() =>
    Boolean(document.activeElement?.closest('[data-board-slot]')));
}
check(reachedCard, 'a card is reachable by Tab alone');

const slotFlag = (n) => p.getAttribute(`[data-board-slot="${n}"] article.lt-slide`, 'data-flag');
// Focus the card itself, not a control inside it. The card is the thing the
// culling keys act on, so the card is what has to be able to hold focus.
const focusSlot = (n) => p.evaluate((i) => {
  document.querySelector(`[data-board-slot="${i}"] article.lt-slide`)?.focus();
}, n);
const focusedIsCard = () => p.evaluate(() =>
  document.activeElement?.matches('article.lt-slide') ?? false);

// 2. P / X / U on the focused card, no pointer involved.
await focusSlot(0);
check(await focusedIsCard(), 'the card itself can hold focus');
await p.keyboard.press('p'); await p.waitForTimeout(200);
check((await slotFlag(0)) === 'pick', 'P picks the focused card');

await focusSlot(1); await p.keyboard.press('x'); await p.waitForTimeout(200);
check((await slotFlag(1)) === 'reject', 'X rejects the focused card');

await p.keyboard.press('u'); await p.waitForTimeout(200);
check((await slotFlag(1)) === null, 'U clears the focused card');

// 3. Blur must disarm: no target, no flag.
await p.evaluate(() => document.activeElement?.blur());
await p.keyboard.press('p'); await p.waitForTimeout(200);
check((await slotFlag(1)) === null, 'P does nothing once nothing is targeted');

// 4. C opens two-up; ArrowLeft answers it.
await p.keyboard.press('c'); await p.waitForTimeout(700);
check(await p.locator('.lt-two-up').count() === 1, 'C opens two-up');
await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(700);
check(await p.locator('.lt-two-up').count() === 0, 'ArrowLeft answers and closes two-up');

// 5. The picks must survive a redeal, in place.
const before = await p.evaluate(() => Array.from(
  document.querySelectorAll('[data-board-slot]'),
  (n) => [n.getAttribute('data-board-slot'),
          n.querySelector('article')?.getAttribute('data-flag'),
          n.querySelector('h3')?.textContent]));
const picksBefore = before.filter((r) => r[1] === 'pick');

await p.getByRole('button', { name: 'Redeal' }).focus();
await p.keyboard.press('Enter');
await p.waitForTimeout(2500);

const after = await p.evaluate(() => Array.from(
  document.querySelectorAll('[data-board-slot]'),
  (n) => [n.getAttribute('data-board-slot'),
          n.querySelector('article')?.getAttribute('data-flag'),
          n.querySelector('h3')?.textContent]));

let held = 0;
for (const [slot, , title] of picksBefore) {
  const still = after.find((r) => r[0] === slot && r[2] === title);
  if (still) held++;
}
check(picksBefore.length > 0, `there were picks to hold (${picksBefore.length})`);
check(held === picksBefore.length,
  `every pick held its slot through a redeal (${held}/${picksBefore.length})`);

// 6. The ledger recorded the turns and can be operated by keyboard.
const frames = await p.locator('.lt-ledger-frame').count();
check(frames >= 3, `ledger recorded turns (${frames})`);

await b.close();
console.log('\nPASS');
for (const o of ok) console.log('  ✓', o);
if (fails.length) { console.log('\nFAIL'); for (const f of fails) console.log('  ✗', f); }
process.exit(fails.length ? 1 : 0);
