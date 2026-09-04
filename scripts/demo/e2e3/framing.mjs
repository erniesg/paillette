/**
 * Can the agent's sentence and the board it describes be on screen together?
 *
 * The iteration-2 critique failed the submission on exactly this, so it is
 * measured rather than eyeballed — and measured without a model, because a
 * human redeal writes a note too and the deployed agent is refusing turns.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../browser.mjs';
const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const SHOTS = path.resolve('docs/night/shots');
const OUT = path.resolve('docs/night/e2e-evidence/iteration-3');
const BAR = 'input[aria-label="Ask the agent"]';
const CARD = 'article.paillette-card';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(SHOTS, { recursive: true });
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector(CARD, { timeout: 120000 });
const ids = await page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.getAttribute('data-artwork-id')), CARD);
for (const [id, k] of [[ids[0],'x'],[ids[1],'x'],[ids[2],'p'],[ids[3],'p']]) {
  const el = page.locator(`${CARD}[data-artwork-id="${id}"]`).first();
  await el.scrollIntoViewIfNeeded(); await el.hover(); await sleep(150);
  await page.keyboard.press(k); await sleep(300);
}
await page.click(BAR); await page.press(BAR, 'Enter'); await sleep(8000);
await page.click(BAR); await page.press(BAR, 'Enter'); await sleep(8000);

const measure = async (scrollY) => {
  await page.evaluate((y) => window.scrollTo(0, y), scrollY);
  await sleep(600);
  return await page.evaluate(() => {
    const vh = window.innerHeight;
    const note = document.querySelector('.paillette-wall-label');
    const nb = note?.getBoundingClientRect();
    // Is any of the note actually painted, or is the sticky chrome over it?
    let occluded = null;
    if (nb && nb.width) {
      const x = Math.round(nb.left + Math.min(60, nb.width / 2));
      const y = Math.round(nb.top + nb.height / 2);
      const top = document.elementFromPoint(x, y);
      occluded = !(top === note || note.contains(top));
    }
    const cards = [...document.querySelectorAll('article.paillette-card')].map((e) => e.getBoundingClientRect());
    const whole = cards.filter((r) => r.top >= 0 && r.bottom <= vh).length;
    const bar = document.querySelector('input[aria-label="Ask the agent"]')?.getBoundingClientRect();
    return {
      scrollY: Math.round(window.scrollY),
      note: note ? { text: note.textContent.trim().slice(0, 80), provenance: note.getAttribute('data-provenance'),
        top: Math.round(nb.top), bottom: Math.round(nb.bottom), visible: nb.top >= 0 && nb.bottom <= vh, occluded } : null,
      cardsWhole: `${whole}/${cards.length}`,
      bar: bar ? { top: Math.round(bar.top), onScreen: bar.top >= 0 && bar.bottom <= vh } : null,
    };
  });
};
const out = [];
for (const y of [0, 120, 200, 261, 320]) {
  const m = await measure(y);
  out.push(m);
  console.log(JSON.stringify(m));
  await page.screenshot({ path: path.join(SHOTS, `e2e3-12-framing-scroll${String(y).padStart(3,'0')}.png`) });
}
await writeFile(path.join(OUT, 'framing.json'), JSON.stringify(out, null, 2));
await b.close();
