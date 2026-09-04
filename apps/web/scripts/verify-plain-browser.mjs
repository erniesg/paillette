/**
 * The page as an ordinary visitor gets it: no Chrome flag, no `?webmcp-debug`,
 * no WebMCP host of any kind.
 *
 * Every other check here runs with the debug harness installed, which is the
 * right way to exercise the tools — and the wrong way to find out what most
 * people who open this page will actually be able to do. Two failures hid
 * behind that flag: there is no prompt bar without a host, so there was
 * nowhere to press Enter; and the works a visitor sees first arrive from the
 * route loader rather than a fetch, so the session index had never heard of
 * them and the human's first pick vanished from the board on the first deal.
 *
 * The first of those has since been fixed by removing the condition rather
 * than working around it — the host is now claimed on every visit — so the two
 * assertions about it read the other way round now. See the note beside them.
 *
 * Nothing here may call `window.__paillette_webmcp` — it does not exist. Every
 * assertion is made against the DOM, which is all a visitor has.
 *
 *   pnpm --filter web dev
 *   node apps/web/scripts/verify-plain-browser.mjs [baseUrl]
 */

import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const GALLERY = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

const failures = [];
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) failures.push(label);
};

const work = (id, title, rank) => ({
  id,
  galleryId: GALLERY,
  orgId: GALLERY,
  title,
  artist: 'A. Painter',
  imageUrl: null,
  thumbnailUrl: null,
  similarity: 0.9 - rank * 0.01,
  metadata: {},
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const exemplarCalls = [];
let agentCalls = 0;

await page.route('**/api/public-agent/**', (route) => {
  agentCalls += 1;
  return route.fulfill({ json: { success: true, data: { message: { role: 'assistant', content: 'x' } } } });
});

await page.route('**/api/public-search/**', (route) => {
  const url = route.request().url();
  if (url.includes('/exemplars')) {
    const body = JSON.parse(route.request().postData() || '{}');
    exemplarCalls.push(body);
    const round = exemplarCalls.length;
    const rows = Array.from({ length: body.topK ?? 12 }, (_, index) =>
      work(`r${round}-${index}`, `Dealt ${round}-${index}`, index)
    );
    return route.fulfill({ json: { success: true, data: { results: rows, count: rows.length, queryTime: 1 } } });
  }
  const rows = Array.from({ length: 6 }, (_, index) => work(`w${index}`, `Work ${index}`, index));
  return route.fulfill({
    json: { success: true, data: { results: rows, count: rows.length, total: rows.length, queryTime: 1 } },
  });
});

// The URL a visitor arrives on. Note what is missing from it.
await page.goto(`${BASE}/nga/search?q=stormy%20seas`, {
  waitUntil: 'networkidle',
  timeout: 60_000,
});
await page.waitForSelector('.paillette-card', { timeout: 30_000 });

console.log('\nwhat a visitor has');
/*
 * These two assertions were inverted deliberately, and the inversion is the
 * point rather than a concession to a failing check.
 *
 * They used to assert that an ordinary visitor gets no host and therefore no
 * prompt bar, which was true and was the defect: the critique's tenth blocking
 * item was that a judge opening staging cold never reached the good part. The
 * flag was gating the wrong thing. `document.modelContext` is what the page's
 * *own* agent talks to, and a visitor whose browser has no WebMCP host is the
 * common case, not the exception — so the stub is claimed on every visit.
 *
 * What stays behind `?webmcp-debug` is `window.__paillette_webmcp`, the
 * console back door, and the check below still holds it to that.
 */
check(
  'a WebMCP host, claimed on every visit',
  (await page.evaluate(() => typeof document.modelContext)) !== 'undefined'
);
check(
  'no debug harness',
  (await page.evaluate(() => typeof window.__paillette_webmcp)) === 'undefined'
);
check(
  'and therefore a prompt bar',
  (await page.locator('input[aria-label="Ask the agent"]').count()) === 1
);
check('but the cards are there', (await page.locator('.paillette-card').count()) === 6);

console.log('\nthe culling loop, with none of that');
const pick = page.locator('.paillette-card[data-artwork-id="w0"]');
await pick.hover();
await page.keyboard.press('p');
check('P picks the hovered card', (await pick.getAttribute('data-flag')) === 'pick');

await page.locator('.paillette-card[data-artwork-id="w1"]').hover();
await page.keyboard.press('x');
check(
  'X rejects',
  (await page.locator('.paillette-card[data-artwork-id="w1"]').getAttribute('data-flag')) ===
    'reject'
);

// Nothing focused: the only place a visitor can press Enter.
await page.mouse.move(700, 60);
await page.keyboard.press('Enter');
await page
  .waitForFunction(() => document.querySelectorAll('.paillette-card').length === 12, undefined, {
    timeout: 15_000,
  })
  .catch(() => {});

check('Enter on the board deals twelve', (await page.locator('.paillette-card').count()) === 12);
check(
  'it carried the human’s exemplars',
  exemplarCalls[0]?.positiveIds?.[0] === 'w0' && exemplarCalls[0]?.negativeIds?.[0] === 'w1',
  JSON.stringify(exemplarCalls[0])
);
check('and made no model call', agentCalls === 0, String(agentCalls));
check(
  'the pick is the first work on the wall',
  (await page.locator('.paillette-card').first().getAttribute('data-artwork-id')) === 'w0'
);
check(
  'and it is still marked as picked',
  (await page.locator('.paillette-card').first().getAttribute('data-flag')) === 'pick'
);

console.log('\nEnter still belongs to whatever else wants it');
const searchButton = page.locator('button[aria-label="Search text"]');
if (await searchButton.count()) {
  await searchButton.focus();
  const before = exemplarCalls.length;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  check('a focused button keeps its own Enter', exemplarCalls.length === before);
}

check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(
  `\n${failures.length ? `${failures.length} FAILED: ${failures.join(', ')}` : 'all checks passed'}`
);
process.exit(failures.length ? 1 : 0);
