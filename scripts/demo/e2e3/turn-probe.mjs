/**
 * One agent request against deployed staging, with the status and body printed.
 * Cheap enough to run repeatedly: it asks for one turn and stops.
 */
import { chromium } from '../browser.mjs';
const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const seen = [];
p.on('response', async (r) => {
  if (!r.url().includes('/public-agent/turn')) return;
  let body = null; try { body = (await r.text()).slice(0, 220); } catch {}
  seen.push({ status: r.status(), body });
});
await p.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForSelector('article.paillette-card', { timeout: 120000 });
await p.click('input[aria-label="Ask the agent"]');
await p.type('input[aria-label="Ask the agent"]', 'show me warm landscapes', { delay: 4 });
await p.press('input[aria-label="Ask the agent"]', 'Enter');
await p.waitForTimeout(20000);
const note = await p.evaluate(() => document.querySelector('.paillette-wall-label')?.textContent?.trim() ?? null);
console.log(new Date().toISOString(), JSON.stringify({ requests: seen.length, statuses: seen.map(s=>s.status), first: seen[0], note }));
await b.close();
