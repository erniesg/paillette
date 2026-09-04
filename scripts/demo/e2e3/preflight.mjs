import { chromium } from '../browser.mjs';
const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const URL = `${BASE}/nga/search?q=warm%20landscape&webmcp-debug`;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e)));
const t0 = Date.now();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
let cardErr = null;
try { await p.waitForSelector('[data-artwork-id]', { timeout: 90000 }); } catch (e) { cardErr = e.message.split('\n')[0]; }
const tCards = Date.now() - t0;
const probe = await p.evaluate(() => {
  const all = [...document.querySelectorAll('input,textarea')].map(el => ({
    tag: el.tagName, type: el.type, testid: el.getAttribute('data-testid'),
    ph: el.getAttribute('placeholder'), aria: el.getAttribute('aria-label'),
    cls: (el.className||'').toString().slice(0,80),
  }));
  return {
    url: location.href,
    host: !!document.modelContext,
    tools: document.modelContext?.tools?.length ?? null,
    toolNames: (document.modelContext?.tools ?? []).map(t => t.name ?? t),
    debugDriver: !!window.__paillette_webmcp,
    debugCall: typeof window.__paillette_webmcp?.call,
    cards: document.querySelectorAll('[data-artwork-id]').length,
    inputs: all,
    glyph: !!document.querySelector('.pa-activity-glyph'),
    dealBoardEls: ['[data-deal-board]','.pa-deal-board','[data-testid="deal-board"]','.lt-deal-board','[data-board]']
      .filter(s => document.querySelector(s)),
    activeEl: document.activeElement?.tagName,
  };
});
console.log(JSON.stringify({ tCardsMs: tCards, cardErr, ...probe, pageErrors: errs }, null, 2));
await p.screenshot({ path: '/tmp/e2e3/preflight.png', fullPage: false });
await b.close();
