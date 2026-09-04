/**
 * Two things the recorded run got wrong about itself, redone.
 *
 *  - the plain browser check clicked a card to move focus, and a card click
 *    opens the work, so it measured a navigation rather than a redeal. The
 *    bar is present without ?webmcp-debug (the host is claimed on every
 *    visit), so Enter goes in the bar here as it would for a visitor.
 *  - "flags persist per session" is tested against the thing that would spoil
 *    a take: a new search in the same tab, and separately a reload.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const SHOTS = path.resolve('docs/night/shots');
const OUT = path.resolve('docs/night/e2e-evidence/iteration-3');
const BAR = 'input[aria-label="Ask the agent"]';
const CARD = 'article.paillette-card';
const SEARCH = 'input.lt-search-field';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { base: BASE, checks: [] };
const say = (ok, what, detail) => { out.checks.push({ ok, what, detail }); console.log(`${ok?'ok  ':'FAIL'}  ${what}  ${detail}`); };

const board = (page) => page.evaluate(() =>
  [...document.querySelectorAll('article.paillette-card')].map((el) => ({
    id: el.getAttribute('data-artwork-id'), flag: el.getAttribute('data-flag'),
  })));
const flag = async (page, id, key) => {
  const el = page.locator(`${CARD}[data-artwork-id="${id}"]`).first();
  await el.scrollIntoViewIfNeeded(); await el.hover(); await sleep(150);
  await page.keyboard.press(key); await sleep(300);
};
const flags = (page) => page.evaluate(() => {
  const s = window.__paillette_webmcp;
  if (s) return s.call('get_view_context', {}).then((v) => ({
    picks: (v?.flags?.picks ?? []).map((f) => f.id).sort(),
    rejects: (v?.flags?.rejects ?? []).map((f) => f.id).sort(),
  }));
  return {
    picks: [...document.querySelectorAll('[data-flag="pick"][data-artwork-id]')].map((e) => e.getAttribute('data-artwork-id')).sort(),
    rejects: [...document.querySelectorAll('[data-flag="reject"][data-artwork-id]')].map((e) => e.getAttribute('data-artwork-id')).sort(),
  };
});

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch();

// --- plain browser, no ?webmcp-debug ---------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const wire = [];
  page.on('request', (r) => wire.push(`${r.method()} ${r.url()}`));
  await page.goto(`${BASE}/nga/search?q=warm%20landscape`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector(CARD, { timeout: 120000 });
  const probe = await page.evaluate((bar) => ({
    bar: !!document.querySelector(bar),
    debugDriver: !!window.__paillette_webmcp,
    host: !!document.modelContext,
  }), BAR);
  const b = await board(page);
  await flag(page, b[0].id, 'x'); await flag(page, b[1].id, 'x'); await flag(page, b[2].id, 'p');
  const mark = wire.length;
  await page.click(BAR);
  await page.press(BAR, 'Enter');
  await sleep(8000);
  const after = await board(page);
  const model = wire.slice(mark).filter((r) => r.includes('/public-agent/turn')).length;
  const exemplars = wire.slice(mark).filter((r) => r.includes('/exemplars')).length;
  say(after.length === 12, 'plain browser (no ?webmcp-debug): Enter deals twelve',
    `${after.length} cards · bar=${probe.bar} host=${probe.host} debugDriver=${probe.debugDriver}`);
  say(model === 0 && exemplars >= 1, 'plain browser: deterministic engine, no model',
    `${model} model calls, ${exemplars} exemplar calls`);
  out.plainBrowser = { ...probe, cards: after.length, model, exemplars };
  await page.screenshot({ path: path.join(SHOTS, 'e2e3-09-plain-browser-redeal.png') });
  await ctx.close();
}

// --- flags across a new search, and across a reload -------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector(CARD, { timeout: 120000 });
  const b = await board(page);
  await flag(page, b[0].id, 'x'); await flag(page, b[1].id, 'x'); await flag(page, b[2].id, 'p');
  const before = await flags(page);

  await page.click(SEARCH);
  await page.fill(SEARCH, 'harbour at dusk');
  await page.press(SEARCH, 'Enter');
  await sleep(9000);
  const afterSearch = await flags(page);
  say(JSON.stringify(before) === JSON.stringify(afterSearch),
    'flags survive a new search in the same session',
    `before ${JSON.stringify(before)} · after ${JSON.stringify(afterSearch)}`);
  await page.screenshot({ path: path.join(SHOTS, 'e2e3-10-flags-after-new-search.png') });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector(CARD, { timeout: 120000 });
  await sleep(3000);
  const afterReload = await flags(page);
  say(JSON.stringify(before) === JSON.stringify(afterReload),
    'flags survive a reload',
    `before ${JSON.stringify(before)} · after ${JSON.stringify(afterReload)}`);
  out.persistence = { before, afterSearch, afterReload };
  await page.screenshot({ path: path.join(SHOTS, 'e2e3-10b-flags-after-reload.png') });
  await ctx.close();
}

await writeFile(path.join(OUT, 'persistence.json'), JSON.stringify(out, null, 2));
await browser.close();
