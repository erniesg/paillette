import { chromium } from '../browser.mjs';
const BASE='https://paillette-stg.berlayar.ai';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
await p.goto(`${BASE}/nga/search?q=warm%20landscape&webmcp-debug`,{waitUntil:'domcontentloaded',timeout:120000});
await p.waitForSelector('[data-artwork-id]',{timeout:120000});
const ids = await p.evaluate(()=>[...document.querySelectorAll('[data-artwork-id]')].slice(0,3).map(e=>e.getAttribute('data-artwork-id')));
// flag two
for (const [id,k] of [[ids[0],'x'],[ids[1],'p']]) {
  const el = p.locator(`[data-artwork-id="${id}"]`).first();
  await el.scrollIntoViewIfNeeded(); await el.hover(); await p.waitForTimeout(150);
  await p.keyboard.press(k); await p.waitForTimeout(300);
}
await p.waitForTimeout(500);
console.log(JSON.stringify(await p.evaluate((ids)=>{
  const dump = [...document.querySelectorAll('[data-artwork-id]')].map(el=>({
    id: el.getAttribute('data-artwork-id'), tag: el.tagName,
    cls: (el.className||'').toString().slice(0,70),
    flag: el.getAttribute('data-flag'), by: el.getAttribute('data-flag-by'),
    parentCls: (el.parentElement?.className||'').toString().slice(0,60),
  }));
  return { total: dump.length, sample: dump.slice(0,6),
    flaggedRows: dump.filter(d=>ids.includes(d.id)),
    containers: ['[data-deal-board]','.pa-deal-board','.lt-deal-board','[data-board]','.paillette-deal','[data-tray]','.paillette-tray','[data-reject-tray]']
      .map(s=>[s, document.querySelectorAll(s).length]).filter(x=>x[1]) };
}, ids), null, 2));
await b.close();
