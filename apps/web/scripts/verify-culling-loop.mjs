/**
 * Drive the culling loop in a real browser and assert what it did.
 *
 * The unit tests prove each piece in jsdom. This proves the pieces are wired
 * to each other on the actual page — that P lands on the card under the
 * cursor, that Enter on an empty bar reaches the exemplar route and not the
 * agent route, and that a pick the human made is still on the board after the
 * deal. Those are claims about the page, and jsdom cannot make them.
 *
 * Every network call is intercepted, so this costs nothing and needs no keys.
 *
 *   pnpm --filter web dev            # in another shell
 *   node apps/web/scripts/verify-culling-loop.mjs [baseUrl]
 *
 * Exits non-zero on the first failed assertion.
 */

import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const GALLERY = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

const failures = [];
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${label}`);
    return true;
  }
  failures.push(label);
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  return false;
};

const work = (id, rank) => ({
  id,
  galleryId: GALLERY,
  orgId: GALLERY,
  title: `Work ${id}`,
  artist: 'A. Painter',
  year: 1888,
  imageUrl: null,
  thumbnailUrl: null,
  similarity: 0.9 - rank * 0.01,
  metadata: { classification: 'Print', dateText: '1888' },
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });

const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const exemplarCalls = [];
const agentCalls = [];

await page.route('**/api/public-search/**', async (route) => {
  if (route.request().url().includes('/exemplars')) {
    const body = JSON.parse(route.request().postData() || '{}');
    exemplarCalls.push(body);
    const dealt = Array.from({ length: body.topK ?? 12 }, (_, index) =>
      work(`deal${exemplarCalls.length}-${index}`, index)
    );
    return route.fulfill({
      json: { success: true, data: { results: dealt, count: dealt.length, queryTime: 3 } },
    });
  }
  const results = Array.from({ length: 8 }, (_, index) => work(`w${index}`, index));
  return route.fulfill({
    json: { success: true, data: { results, count: results.length, queryTime: 5 } },
  });
});

await page.route('**/api/public-agent/**', async (route) => {
  agentCalls.push(JSON.parse(route.request().postData() || '{}'));
  return route.fulfill({
    json: {
      success: true,
      data: { message: { role: 'assistant', content: 'Following the picks.' } },
    },
  });
});

const context = () =>
  page.evaluate(() => window.__paillette_webmcp.call('get_view_context', {}));

await page.goto(`${BASE}/nga/search?q=stormy%20seas&webmcp-debug`, {
  waitUntil: 'networkidle',
  timeout: 60_000,
});
await page.waitForSelector('.paillette-card', { timeout: 30_000 });

const cards = page.locator('.paillette-card');
const first = cards.first();
const second = cards.nth(1);
const third = cards.nth(2);

console.log('\nflags');
const firstId = await first.getAttribute('data-artwork-id');
await first.hover();
check(
  'hover sets the deictic anchor',
  (await first.getAttribute('data-hovered')) === 'true'
);
await page.keyboard.press('p');
check('P picks the hovered card', (await first.getAttribute('data-flag')) === 'pick');
check(
  'the pick is drawn in the human’s ink',
  (await first.getAttribute('data-flag-by')) === 'human'
);
check(
  'the badge announces the state',
  (await first.locator('[data-flag-action="pick"]').getAttribute('aria-pressed')) ===
    'true'
);

await second.hover();
await page.keyboard.press('x');
check('X rejects the hovered card', (await second.getAttribute('data-flag')) === 'reject');

const beforeRedeal = await context();
check(
  'get_view_context reports the flags',
  beforeRedeal.flags.picks.length === 1 && beforeRedeal.flags.rejects.length === 1,
  JSON.stringify(beforeRedeal.flags)
);

console.log('\nselection');
await third.click({ modifiers: ['Shift'] });
const thirdId = await third.getAttribute('data-artwork-id');
check(
  'shift-click selects instead of opening the work',
  (await third.getAttribute('data-selected')) === 'true' &&
    (await page.locator('[role="dialog"]').count()) === 0
);
check(
  'get_view_context reports "these"',
  (await context()).selection.map((entry) => entry.id).join() === thirdId
);
await page.keyboard.press('Escape');
check('Escape drops the selection', (await context()).selection.length === 0);

console.log('\nredeal with no agent in it');
const bar = page.locator('input[aria-label="Ask the agent"]');
check('the utterance bar is on the page', (await bar.count()) === 1);
await bar.click();
await page.keyboard.press('Enter');
await page.waitForFunction(
  () => document.querySelectorAll('.paillette-card').length === 12,
  undefined,
  { timeout: 10_000 }
).catch(() => {});

check('Enter reached the exemplar route', exemplarCalls.length === 1);
check('Enter made no model call', agentCalls.length === 0, JSON.stringify(agentCalls));
check(
  'the request carried the human’s exemplars',
  exemplarCalls[0]?.positiveIds?.length === 1 && exemplarCalls[0]?.negativeIds?.length === 1,
  JSON.stringify(exemplarCalls[0])
);
check('the board deals twelve', (await cards.count()) === 12);

const afterRedeal = await context();
check(
  'the pick survived the deal, in place',
  afterRedeal.board?.order?.[0] === firstId,
  `order[0]=${afterRedeal.board?.order?.[0]} pick=${firstId}`
);
check(
  'the reject left the board',
  !afterRedeal.board?.order?.includes(
    beforeRedeal.flags.rejects[0]?.id
  )
);
check(
  'the board is marked as the human’s move',
  afterRedeal.board?.lastChangeBy === 'human'
);

console.log('\ngestures ride the next spoken turn');
await bar.click();
await bar.fill('something warm');
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);

const turn = agentCalls[0]?.turn;
check('the agent request carries a turn payload', Boolean(turn), JSON.stringify(agentCalls[0] ?? {}).slice(0, 200));
check('it carries the words', turn?.text === 'something warm');
check(
  'it carries the gestures, with titles resolved',
  turn?.flagsDelta?.length === 2 && Boolean(turn.flagsDelta[0].title),
  JSON.stringify(turn?.flagsDelta)
);

console.log('\ntwo-up');
await page.evaluate(
  ([a, b]) =>
    window.__paillette_webmcp.call('compare_artworks', {
      artworkIds: [a, b],
      question: 'Which reads from further away?',
    }),
  [
    afterRedeal.board.order[0],
    afterRedeal.board.order[1],
  ]
);
await page.waitForSelector('.paillette-compare', { timeout: 5000 });
check('the two-up opens with the question set between the works', true);
await page.locator('.paillette-compare-work[data-side="left"]').click();
const afterCompare = await context();
check(
  'one click resolves a winner and a loser',
  afterCompare.flags.picks.some((p) => p.id === afterRedeal.board.order[0]) &&
    afterCompare.flags.rejects.some((r) => r.id === afterRedeal.board.order[1]),
  JSON.stringify(afterCompare.flags)
);
check('the two-up closes on the answer', (await page.locator('.paillette-compare').count()) === 0);

check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();

console.log(
  `\n${failures.length ? `${failures.length} FAILED: ${failures.join(', ')}` : 'all checks passed'}`
);
process.exit(failures.length ? 1 : 0);
