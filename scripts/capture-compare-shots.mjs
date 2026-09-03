import { createRequire } from 'node:module';
const require = createRequire('/home/ubuntu/paillette-night/visuals/apps/web/package.json');
const { chromium } = require('@playwright/test');

const settled = (p, sel) =>
  p.waitForFunction((s) => {
    const imgs = Array.from(document.querySelectorAll(s));
    return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  }, sel, { timeout: 60000 });

const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1560, height: 1000 }, deviceScaleFactor: 2 });
const p = await c.newPage();
p.on('console', (m) => { if (m.type() === 'error') console.log('  !', m.text().slice(0, 120)); });
await p.goto('http://localhost:5210/night/deal', { waitUntil: 'networkidle' });
await settled(p, '.lt-slide-well img');
await p.getByRole('button', { name: 'Agent asks' }).click();
await settled(p, '.lt-two-up-choice img');
await p.waitForTimeout(600);
await p.screenshot({ path: 'docs/night/shots/20-two-up.png' });
console.log('  -> 20-two-up.png');
await b.close();
