/**
 * Why the picks move on camera even though the FLIP is correct.
 *
 * The main walk measures a pick at viewport y 497 before the redeal and y 192
 * after, while the deal grid's own top moves 425 → 176. Two different things
 * could produce that and they need different fixes, so this separates them:
 *
 *   - the grid's box moving under a card that is holding its slot, or
 *   - the card genuinely changing slot inside the grid.
 *
 * It walks the loop once and, at each of the three moments, writes down every
 * block above the deal grid with its height. A layout that grows and shrinks
 * in the same beat as the deal is the thing to name in the report, and naming
 * it needs the element, not the delta.
 *
 *   node apps/web/scripts/e2e-geometry-probe.mjs <baseUrl> <outDir>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e6/geometry';
const BAR = 'input[aria-label="Ask the agent"]';
const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';

mkdirSync(`${OUT}/shots`, { recursive: true });
const save = (n, v) => writeFileSync(`${OUT}/${n}`, typeof v === 'string' ? v : JSON.stringify(v, null, 2));

/**
 * Everything between the top of the document and the top of the deal grid,
 * as a list of boxes. Only laid-out, non-empty, reasonably wide blocks — the
 * question is what is taking up vertical room, not what exists.
 */
const above = (page) =>
  page.evaluate(() => {
    const grid = document.querySelector('.lt-deal-viewport');
    if (!grid) return { grid: null, blocks: [] };
    const g = grid.getBoundingClientRect();
    const seen = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.height < 12 || r.width < 200) continue;
      if (r.bottom > g.top + 1) continue;
      if (el.contains(grid)) continue;
      if (seen.some((s) => s.el.contains(el))) continue;
      seen.push({ el, r });
    }
    return {
      grid: { y: Math.round(g.y), h: Math.round(g.height) },
      scrollY: Math.round(window.scrollY),
      docH: Math.round(document.documentElement.scrollHeight),
      blocks: seen.map(({ el, r }) => ({
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.baseVal ?? el.className ?? '').toString().slice(0, 70),
        y: Math.round(r.y),
        h: Math.round(r.height),
        text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 70),
      })),
    };
  });

/** The first card's position relative to the grid, and to the viewport. */
const firstCards = (page) =>
  page.$$eval('.paillette-card', (cards) => {
    const grid = document.querySelector('.lt-deal-viewport');
    const g = grid ? grid.getBoundingClientRect() : { x: 0, y: 0 };
    return cards.slice(0, 4).map((c) => {
      const r = c.getBoundingClientRect();
      return {
        id: c.getAttribute('data-artwork-id'),
        flag: c.getAttribute('data-flag'),
        viewport: { x: Math.round(r.x), y: Math.round(r.y) },
        grid: { x: Math.round(r.x - g.x), y: Math.round(r.y - g.y) },
      };
    });
  });

const main = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const out = {};

  await page.goto(`${BASE}/nga/search?webmcp-debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);

  const bar = await page.$(BAR);
  await bar.click();
  await page.keyboard.type(SOFA, { delay: 8 });
  await page.keyboard.press('Enter');
  for (let i = 0; i < 120 && (await page.$$('.paillette-card')).length < 4; i += 1) {
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);

  out.A_dealt = { above: await above(page), cards: await firstCards(page) };
  await page.screenshot({ path: `${OUT}/shots/g1-dealt.png` });

  const cards = await firstCards(page);
  const rejectIds = [cards[0].id, cards[1].id];
  const pickId = cards[2].id;
  for (const id of [...rejectIds, pickId]) {
    await page.hover(`.paillette-card[data-artwork-id="${id}"]`);
    await page.waitForTimeout(160);
    await page.keyboard.press(id === pickId ? 'p' : 'x');
    await page.waitForTimeout(280);
  }
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);

  out.B_flagged = { above: await above(page), cards: await firstCards(page) };
  await page.screenshot({ path: `${OUT}/shots/g2-flagged.png` });

  const barEl = await page.$(BAR);
  await barEl.click();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(7000);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(600);

  out.C_redealt = { above: await above(page), cards: await firstCards(page) };
  await page.screenshot({ path: `${OUT}/shots/g3-redealt.png` });

  out.pick = {
    id: pickId,
    dealt: out.A_dealt.cards.find((c) => c.id === pickId) ?? null,
    flagged: out.B_flagged.cards.find((c) => c.id === pickId) ?? null,
    redealt: out.C_redealt.cards.find((c) => c.id === pickId) ?? null,
  };

  save('geometry.json', out);

  for (const [k, v] of Object.entries(out)) {
    if (!v.above) continue;
    console.log(`\n=== ${k}  grid top ${v.above.grid?.y}px  height ${v.above.grid?.h}px  scrollY ${v.above.scrollY} ===`);
    for (const b of v.above.blocks) console.log(`  y${String(b.y).padStart(5)} h${String(b.h).padStart(4)}  ${b.cls.slice(0, 34).padEnd(34)} ${b.text}`);
  }
  console.log('\n=== the pick ===');
  console.log(JSON.stringify(out.pick, null, 2));

  await context.close();
  await browser.close();
};

main().catch((e) => { console.error(e); process.exit(2); });
