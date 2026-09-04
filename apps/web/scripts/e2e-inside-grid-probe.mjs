/**
 * The 56px the picks move *inside* the grid on the deterministic redeal.
 *
 * The geometry probe separated two displacements. The first is the exhibition
 * strip appearing on the first flag and pushing the whole board down; that one
 * is above the grid and easy to name. The second is smaller and stranger: the
 * grid's own box does not move across the redeal (top 176px before and after)
 * yet a pick still travels from grid y 72 to grid y 16.
 *
 * So something *inside* the grid, above the first row, stops taking up room in
 * the same beat as the deal. This lists it by name at both moments.
 *
 *   node apps/web/scripts/e2e-inside-grid-probe.mjs <baseUrl> <outDir>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e6/inside';
const BAR = 'input[aria-label="Ask the agent"]';
const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';

mkdirSync(`${OUT}/shots`, { recursive: true });
const save = (n, v) => writeFileSync(`${OUT}/${n}`, typeof v === 'string' ? v : JSON.stringify(v, null, 2));

/** Everything inside the deal grid that sits above the topmost card. */
const insideGrid = (page) =>
  page.evaluate(() => {
    const grid = document.querySelector('.lt-deal-viewport');
    if (!grid) return null;
    const g = grid.getBoundingClientRect();
    const cards = [...grid.querySelectorAll('.paillette-card')];
    const topCard = cards.length
      ? Math.min(...cards.map((c) => c.getBoundingClientRect().top))
      : g.bottom;
    const blocks = [];
    for (const el of grid.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.height < 8) continue;
      if (r.top >= topCard - 1) continue;
      if (el.querySelector('.paillette-card')) continue;
      if (blocks.some((b) => b.el.contains(el))) continue;
      blocks.push({ el, r });
    }
    return {
      gridTop: Math.round(g.y),
      gridHeight: Math.round(g.height),
      topCardOffset: Math.round(topCard - g.top),
      note: document.querySelector('[data-board-note] .paillette-wall-label')?.textContent?.trim() ?? null,
      noteBox: (() => {
        const n = document.querySelector('[data-board-note]');
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { y: Math.round(r.y), h: Math.round(r.height), insideGrid: grid.contains(n) };
      })(),
      blocks: blocks.map(({ el, r }) => ({
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.baseVal ?? el.className ?? '').toString().slice(0, 60),
        attrs: el.hasAttribute('data-board-note') ? 'data-board-note' : '',
        h: Math.round(r.height),
        text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 80),
      })),
    };
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

  const ids = await page.$$eval('.paillette-card', (c) =>
    c.slice(0, 3).map((x) => x.getAttribute('data-artwork-id')));
  for (const [i, id] of ids.entries()) {
    await page.hover(`.paillette-card[data-artwork-id="${id}"]`);
    await page.waitForTimeout(160);
    await page.keyboard.press(i === 2 ? 'p' : 'x');
    await page.waitForTimeout(280);
  }
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);

  out.before = await insideGrid(page);
  await page.screenshot({ path: `${OUT}/shots/i1-before-redeal.png` });

  const barEl = await page.$(BAR);
  await barEl.click();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(7000);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(600);

  out.after = await insideGrid(page);
  await page.screenshot({ path: `${OUT}/shots/i2-after-redeal.png` });

  save('inside-grid.json', out);
  for (const k of ['before', 'after']) {
    const v = out[k];
    console.log(`\n=== ${k}: grid top ${v.gridTop} height ${v.gridHeight}, first card ${v.topCardOffset}px into the grid ===`);
    console.log(`  note: ${v.note ? JSON.stringify(v.note.slice(0, 90)) : '(none)'}  box=${JSON.stringify(v.noteBox)}`);
    for (const b of v.blocks) console.log(`  h${String(b.h).padStart(4)}  ${b.attrs.padEnd(15)} ${b.cls.slice(0, 30).padEnd(30)} ${b.text}`);
  }

  await context.close();
  await browser.close();
};

main().catch((e) => { console.error(e); process.exit(2); });
