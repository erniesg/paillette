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

console.log('\nflags outlive the search that produced them');
// "Flags persist per session" is a line in the definition of done, and the
// thing that ends most sessions-within-a-session is the human running another
// search. A judgement about a picture has to outlive the query it was made
// under, or the exemplar set resets every time somebody changes their mind
// about what to type.
const searchBox = page.locator('input[placeholder*="search by feeling"]');
await searchBox.click();
await searchBox.fill('a different query entirely');
await page.keyboard.press('Enter');
await page.waitForFunction(
  () => window.location.search.includes('a+different+query') ||
    window.location.search.includes('a%20different%20query'),
  undefined,
  { timeout: 10_000 }
).catch(() => {});
const afterSearch = await context();
check(
  'the flags survive a new search',
  afterSearch.flags.picks.length === 1 && afterSearch.flags.rejects.length === 1,
  JSON.stringify(afterSearch.flags)
);
check(
  'and so do the exemplars the deal runs on',
  afterSearch.flags.exemplars.positive[0] === firstId,
  JSON.stringify(afterSearch.flags.exemplars)
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
// On the screen, not only in the store. The board is drawn from records the
// session index can resolve, so a pick the index has never heard of is held
// in state and silently missing from the wall — which is the guarantee
// failing in the only place anyone would notice.
check(
  'and it is actually on the wall, not just in the state',
  (await cards.first().getAttribute('data-artwork-id')) === firstId,
  `first rendered card=${await cards.first().getAttribute('data-artwork-id')}`
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

console.log('\nthree deals in a row');
// The drift the brief describes is three redeals, not one. Everything dealt is
// excluded from the next deal, so this is where a small corpus runs dry and
// the board quietly shrinks — the failure nobody sees until the third beat of
// the demo.
for (const round of [2, 3]) {
  await page.keyboard.press('Escape');
  await bar.click();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const state = await context();
  check(
    `deal ${round} keeps a full board`,
    state.board?.order?.length === 12,
    `${state.board?.order?.length} cards`
  );
  check(
    `deal ${round} still holds the pick first`,
    state.board?.order?.[0] === firstId
  );
  check(
    `deal ${round} excludes everything already dealt`,
    (exemplarCalls[round - 1]?.excludeIds?.length ?? 0) >=
      (exemplarCalls[round - 2]?.excludeIds?.length ?? 0),
    JSON.stringify(exemplarCalls[round - 1]?.excludeIds?.length)
  );
}
check(
  'the session remembers every work it has dealt',
  ((await context()).board?.dealtThisSession ?? 0) >= 24,
  String((await context()).board?.dealtThisSession)
);

console.log('\nC opens the two-up');
// Escape first, because the deals above left the caret in the bar and a bare
// letter must not fire while someone is typing. That is the product being
// right, so the sequence has to do what a person would do.
await page.keyboard.press('Escape');
// The human's route into compare, which is the one the brief's definition of
// done names. Hovering a card that is not the pick pairs it against the pick.
await cards.nth(1).hover();
await page.keyboard.press('c');
await page.waitForSelector('.paillette-compare', { timeout: 5000 }).catch(() => {});
check(
  'C pairs the hovered work against one already kept',
  (await page.locator('.paillette-compare').count()) === 1
);
const pairedWith = await page
  .locator('.paillette-compare-work[data-side="left"]')
  .getAttribute('data-artwork-id');
check('the pick is the work it is weighed against', pairedWith === firstId);
await page.keyboard.press('Escape');
await page.locator('.paillette-compare button:has-text("Neither")').click();
check(
  'declining closes it and flags nothing',
  (await page.locator('.paillette-compare').count()) === 0 &&
    (await context()).flags.rejects.length === 1
);

console.log('\ntwo-up, resolved');
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
// The wait is the assertion: nothing below it can run if the two-up never
// opened, so a redundant check() here would only inflate the count.
await page.waitForSelector('.paillette-compare', { timeout: 5000 });
check(
  'the two-up sets the agent’s question between the works',
  (await page.locator('.paillette-compare').getAttribute('aria-label')) ===
    'Which reads from further away?'
);
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
