import { chromium } from '@playwright/test';

const INSTRUCTION = 'something warm for above the sofa — give it a title, a statement, and write a wall label for each work';
const RUNS = Number(process.env.RUNS ?? 5);
const results = [];

for (let i = 1; i <= RUNS; i++) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ permissions: ['clipboard-read','clipboard-write'] });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    delete window.webkitSpeechRecognition; delete window.SpeechRecognition;
    Object.defineProperty(window, 'speechSynthesis', { get: () => undefined });
  });
  const r = { run: i, board: false, share: false, posted: null, url: null, works: 0, labels: 0, err: null };
  try {
    await p.goto('https://paillette-stg.berlayar.ai/nga/search', { waitUntil:'domcontentloaded' });
    const bar = p.getByRole('textbox', { name: 'Ask the agent' });
    await bar.waitFor({ timeout: 40000 });
    await bar.click();
    await bar.type(INSTRUCTION, { delay: 4 });
    await p.keyboard.press('Enter');

    try {
      await p.locator('button.paillette-share-link').waitFor({ timeout: 150000 });
      r.share = true;
    } catch { r.err = 'share button never appeared'; }
    r.board = (await p.locator('[data-artwork-id]').count()) > 0;

    if (r.share) {
      await p.waitForTimeout(20000); // let write_labels land if it is coming
      p.on('response', res => { if (res.url().includes('/api/exhibitions')) r.posted = res.status(); });
      await p.locator('button.paillette-share-link').first().click();
      await p.waitForTimeout(8000);
      r.url = await p.evaluate(() => navigator.clipboard.readText().catch(() => null));
    }
  } catch (e) { r.err = String(e).split('\n')[0].slice(0,90); }
  await b.close();

  if (r.url) {
    const html = await (await fetch(r.url, { headers: { 'User-Agent':'Mozilla/5.0 Chrome/152', Accept:'text/html' } })).text();
    r.works  = (html.match(/class="exhibition-work"/g)  || []).length;
    r.labels = (html.match(/class="exhibition-label"/g) || []).length;
  }
  results.push(r);
  console.log(`run ${i}: board=${r.board} share=${r.share} post=${r.posted} works=${r.works} labels=${r.labels} ${r.url||''} ${r.err||''}`);
}

console.log('\n--- summary over ' + RUNS + ' runs ---');
console.log('share button appeared :', results.filter(r=>r.share).length + '/' + RUNS);
console.log('link published (201)  :', results.filter(r=>r.posted===201).length + '/' + RUNS);
console.log('link renders works    :', results.filter(r=>r.works>0).length + '/' + RUNS);
console.log('link renders labels   :', results.filter(r=>r.labels>0).length + '/' + RUNS);
console.log(JSON.stringify(results, null, 1));
