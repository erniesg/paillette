/**
 * Where the labels go.
 *
 * The correction runs call write_labels up to eight times and the wall stays
 * blank, with no page error and a label endpoint that answers in 6s when
 * curled. So this drives the tool directly, with no model in the loop, and
 * prints what it returns.
 *
 *   node scripts/demo/probe-labels.mjs <base-url>
 */
import { chromium } from '/home/ubuntu/paillette-night/merge/scripts/demo/browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const STATEMENT =
  'It is not about weather. It is about leaving — the hour before someone goes, and the room that keeps their shape after they have gone.';

const browser = await chromium.launch();
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: 900 } })
).newPage();
page.on('pageerror', (e) => console.log('pageerror:', String(e.message).slice(0, 200)));

await page.goto(`${BASE}/nga/search?q=${encodeURIComponent('storms at sea')}&webmcp-debug`, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});
await page.waitForFunction(
  () => document.querySelectorAll('[data-artwork-id]').length > 0,
  { timeout: 60_000 }
);
await page.waitForFunction(
  async () => ((await window.__paillette_webmcp?.tools?.()) ?? []).length > 0,
  { timeout: 45_000 }
);

const call = (name, args = {}) =>
  page.evaluate(
    ([n, a]) => window.__paillette_webmcp.call(n, a).then(
      (r) => r,
      (e) => ({ threw: String(e?.message ?? e) })
    ),
    [name, args]
  );

const ids = await page.evaluate(() =>
  [...document.querySelectorAll('[data-artwork-id]')]
    .map((el) => el.getAttribute('data-artwork-id'))
    .slice(0, 6)
);
console.log('board ids:', ids);

console.log(
  'set_exhibition:',
  JSON.stringify(
    await call('set_exhibition', {
      title: 'The Hour Before',
      statement: STATEMENT,
      works: ids.map((artworkId) => ({ artworkId })),
    })
  ).slice(0, 400)
);

// Straight away, while every work is certainly in the session index.
console.log(
  'write_labels (cold):',
  JSON.stringify(await call('write_labels', { artworkIds: ids })).slice(0, 700)
);
const afterFirst = await call('get_exhibition');
console.log(
  'unlabelled after first:',
  (afterFirst?.data?.works ?? afterFirst?.works ?? []).filter((w) => !w.label).length
);

// Now the shape a drafting turn actually has: searches in between, which is
// what pushes earlier records out of a bounded index.
for (const query of ['leaving', 'empty rooms', 'departure', 'harbour at dusk', 'interiors']) {
  await call('search_artworks', { query, limit: 60 });
}
console.log('index size:', await page.evaluate(() => window.__paillette_webmcp?.debug?.indexSize?.() ?? 'n/a'));

console.log(
  'write_labels (after searches):',
  JSON.stringify(await call('write_labels', { artworkIds: ids })).slice(0, 700)
);
const afterSecond = await call('get_exhibition');
const works = afterSecond?.data?.works ?? afterSecond?.works ?? [];
console.log('works:', works.length, 'unlabelled:', works.filter((w) => !w.label).length);
console.log(JSON.stringify(works.slice(0, 3), null, 1).slice(0, 600));

await browser.close();
