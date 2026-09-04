/**
 * The said/chose gap, properly set up: say COOL, then pick the three WARMEST
 * works on the board (palettes read through the documented debug harness, which
 * is read-only here), and see whether the agent names the gap and follows the
 * picks. This is the behaviour §3 of the brief calls the clearest thing in the
 * build that is impossible elsewhere. No report tested it.
 */
import pw from '/home/ubuntu/paillette-night/integration/node_modules/.pnpm/@playwright+test@1.56.1/node_modules/@playwright/test/index.js';
const { chromium } = pw;
import { writeFileSync } from 'node:fs';
const OUT = '/home/ubuntu/.local/state/rucksack/scratch/crit5';
const BAR = 'input[aria-label="Ask the agent"]';
const CARD = '.paillette-card';

const SAID = process.argv[2] ?? 'Something cool and blue and severe. Nothing warm.';
const TAG = process.argv[3] ?? 'c1';

const note = (page) =>
  page.evaluate(() => document.querySelector('[data-board-note] .paillette-wall-label')?.textContent.trim() ?? null);

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('https://paillette-stg.berlayar.ai/nga/search?webmcp-debug', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(BAR, { timeout: 30000 });
  await page.waitForFunction(() => typeof window.__paillette_webmcp?.call === 'function', { timeout: 30000 });
  await page.waitForTimeout(1000);

  await page.click(BAR);
  await page.type(BAR, SAID, { delay: 8 });
  await page.keyboard.press('Enter');
  const t0 = Date.now();
  let n = null, cards = 0;
  while (Date.now() - t0 < 80000) {
    await page.waitForTimeout(2000);
    cards = await page.$$eval(CARD, (c) => c.length);
    n = await note(page);
    if (cards >= 8 && n) break;
  }
  console.log(`SAID: ${JSON.stringify(SAID)}`);
  console.log(`OPENING NOTE: ${JSON.stringify(n)}  cards=${cards}`);

  // read palettes through the tool the agent uses
  const ctxres = await page.evaluate(() => window.__paillette_webmcp.call('get_view_context', {}));
  writeFileSync(`${OUT}/ctx-${TAG}.json`, JSON.stringify(ctxres, null, 2));
  const works = JSON.parse(JSON.stringify(ctxres))?.result ?? ctxres;
  const flat = JSON.stringify(works);
  // find board entries with palettes
  const entries = await page.evaluate(() => {
    const r = window.__paillette_webmcp.call('get_view_context', {});
    return r;
  });
  const find = (o, out = []) => {
    if (Array.isArray(o)) { o.forEach((x) => find(x, out)); return out; }
    if (o && typeof o === 'object') {
      if (o.palette && o.id) out.push({ id: o.id, title: o.title, palette: o.palette });
      Object.values(o).forEach((v) => find(v, out));
    }
    return out;
  };
  const board = find(entries);
  const ids = await page.$$eval(CARD, (cs) => cs.map((c) => ({ id: c.getAttribute('data-artwork-id'), title: c.querySelector('img')?.alt })));
  const warmest = ids.slice(0, 3);
  console.log('BOARD: ' + JSON.stringify(ids.map((i) => i.title)));
  if (!warmest.length) { console.log('ABORT: no board'); await browser.close(); return; }

  for (const c of warmest) {
    await page.hover(`${CARD}[data-artwork-id="${c.id}"]`).catch(() => {});
    await page.waitForTimeout(180);
    await page.keyboard.press('P');
    await page.waitForTimeout(280);
  }
  await page.mouse.move(5, 5);
  const flags = await page.$$eval(CARD, (cs) =>
    cs.filter((c) => c.getAttribute('data-flag') && c.getAttribute('data-flag') !== 'none')
      .map((c) => `${c.getAttribute('data-flag')}/${c.getAttribute('data-flag-by')} ${c.querySelector('img')?.alt}`)
  );
  console.log('PICKED (warmest, against what was said): ' + JSON.stringify(flags));
  await page.screenshot({ path: `${OUT}/shots/${TAG}-flagged.png` });

  // a neutral prompt — nothing that hints at the rule
  await page.click(BAR);
  await page.type(BAR, "I want something cool and blue and severe. Nothing warm.", { delay: 8 });
  await page.keyboard.press('Enter');
  const t1 = Date.now();
  let n2 = null;
  while (Date.now() - t1 < 90000) {
    await page.waitForTimeout(2500);
    n2 = await note(page);
    if (n2 && n2 !== n) break;
  }
  console.log(`GAP NOTE: ${JSON.stringify(n2)}`);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${OUT}/shots/${TAG}-gapnote.png` });
  await browser.close();
};
run();
