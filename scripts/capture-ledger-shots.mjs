import { createRequire } from 'node:module';
const require = createRequire('/home/ubuntu/paillette-night/visuals/apps/web/package.json');
const { chromium } = require('@playwright/test');

const settled = (p, sel) =>
  p.waitForFunction((s) => {
    const imgs = Array.from(document.querySelectorAll(s));
    return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  }, sel, { timeout: 60000 }).catch(() => {});

const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1560, height: 1000 }, deviceScaleFactor: 2 });
const p = await c.newPage();
p.on('console', (m) => { if (m.type() === 'error') console.log('  !', m.text().slice(0, 140)); });
await p.goto('http://localhost:5210/night/deal', { waitUntil: 'networkidle' });
await settled(p, '.lt-slide-well img');

const click = async (name) => { await p.getByRole('button', { name, exact: true }).first().click(); await p.waitForTimeout(900); };

// Six turns, so the strip has something to be a record of.
await click('Agent proposes');
await click('Confirm marks');
await click('Redeal');
await settled(p, '.lt-slide-well img');
// Flag a couple by hand, then redeal again so the boards visibly diverge.
const picks = await p.locator('button[aria-label="Pick"]').all();
for (const b2 of picks.slice(2, 5)) { await b2.click(); await p.waitForTimeout(150); }
await click('Redeal');
await settled(p, '.lt-slide-well img');
await click('Agent asks');
await settled(p, '.lt-two-up-choice img');
await p.getByRole('button', { name: /^Choose / }).first().click();
await p.waitForTimeout(1200);
await settled(p, '.lt-slide-well img');
await settled(p, '.lt-ledger-thumb img');
await p.waitForTimeout(1200);

await p.screenshot({ path: 'docs/night/shots/21-ledger.png' });
console.log('  -> 21-ledger.png  frames:', await p.locator('.lt-ledger-frame').count());
await p.locator('.lt-ledger').screenshot({ path: 'docs/night/shots/22-ledger-detail.png' });
console.log('  -> 22-ledger-detail.png');
await b.close();
