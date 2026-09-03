/**
 * The unhappy half of the tool surface, driven the way a host drives it.
 *
 * Every check here is a call that *should* fail, made through
 * `window.__paillette_webmcp.call` on a real page. What is being tested is not
 * that the code refuses — the unit tests cover that — but that the refusal
 * arrives as a readable `{ok:false,error:{code,message,hint}}` on the page
 * rather than as a thrown exception, a hang, or a half-applied board.
 *
 *   pnpm --filter web dev
 *   node apps/web/scripts/verify-failure-paths.mjs [baseUrl]
 */

import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const GALLERY = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

const failures = [];
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures.push(label);
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`);
};

const work = (id, rank) => ({
  id,
  galleryId: GALLERY,
  orgId: GALLERY,
  title: `Work ${id}`,
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

/** Flipped per-case so one page can play a healthy and a broken backend. */
let exemplarMode = 'ok';

await page.route('**/api/public-search/**', async (route) => {
  const url = route.request().url();
  if (url.includes('/exemplars')) {
    if (exemplarMode === 'offline') return route.abort('failed');
    if (exemplarMode === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    if (exemplarMode === 'error') {
      return route.fulfill({
        status: 422,
        json: {
          success: false,
          error: {
            code: 'EXEMPLARS_NOT_INDEXED',
            message: 'None of the positive exemplars have an image embedding.',
          },
        },
      });
    }
    if (exemplarMode === 'empty') {
      return route.fulfill({
        json: { success: true, data: { results: [], count: 0, queryTime: 1 } },
      });
    }
    const dealt = Array.from({ length: 12 }, (_, index) =>
      work(`deal-${index}`, index)
    );
    return route.fulfill({
      json: { success: true, data: { results: dealt, count: 12, queryTime: 2 } },
    });
  }
  const results = Array.from({ length: 6 }, (_, index) => work(`w${index}`, index));
  return route.fulfill({
    json: { success: true, data: { results, count: 6, queryTime: 3 } },
  });
});

const call = (name, args = {}) =>
  page.evaluate(
    ([toolName, input]) => window.__paillette_webmcp.call(toolName, input),
    [name, args]
  );

const setMode = async (mode) => {
  exemplarMode = mode;
};

await page.goto(`${BASE}/nga/search?q=anything&webmcp-debug`, {
  waitUntil: 'networkidle',
  timeout: 60_000,
});
await page.waitForSelector('.paillette-card', { timeout: 30_000 });

console.log('\nids that do not resolve');
for (const [name, args] of [
  ['flag_artworks', { flags: [{ artworkId: 'ghost', flag: 'pick', reason: 'x' }] }],
  ['compare_artworks', { artworkIds: ['ghost', 'phantom'] }],
  ['search_by_exemplars', { positiveIds: ['ghost'] }],
  ['set_results', { artworkIds: ['ghost'] }],
  ['show_artwork', { artwork: 'ghost' }],
  ['describe_artwork', { artwork: 'ghost' }],
]) {
  const result = await call(name, args);
  const shaped =
    result &&
    result.ok === false &&
    typeof result.error?.code === 'string' &&
    typeof result.error?.message === 'string';
  // flag_artworks reports unresolved ids rather than failing the whole call,
  // because two good flags and one stale id is not a failed turn.
  const reported = name === 'flag_artworks' && result?.unresolved?.length === 1;
  check(`${name} refuses a stale id readably`, shaped || reported, JSON.stringify(result).slice(0, 160));
}

console.log('\nempty and malformed input');
for (const [label, name, args] of [
  ['compare_artworks with one id', 'compare_artworks', { artworkIds: ['w0'] }],
  ['compare_artworks with the same work twice', 'compare_artworks', { artworkIds: ['w0', 'w0'] }],
  ['search_by_exemplars with no positives', 'search_by_exemplars', { positiveIds: [] }],
  ['flag_artworks with an unknown flag', 'flag_artworks', { flags: [{ artworkId: 'w0', flag: 'maybe' }] }],
  ['set_results with nothing at all', 'set_results', {}],
]) {
  const result = await call(name, args);
  check(
    `${label} fails with a code`,
    result?.ok === false && typeof result.error?.code === 'string',
    JSON.stringify(result).slice(0, 160)
  );
}

console.log('\nredeal with nothing to deal from');
const noExemplars = await call('redeal', {});
check(
  'redeal says there is no direction rather than dealing at random',
  noExemplars?.ok === false && noExemplars.error.code === 'NO_EXEMPLARS',
  JSON.stringify(noExemplars).slice(0, 160)
);

// Give it a direction for everything below.
await page.locator('.paillette-card[data-artwork-id="w0"]').hover();
await page.keyboard.press('p');
await page.locator('.paillette-card[data-artwork-id="w1"]').hover();
await page.keyboard.press('x');

console.log('\nthe backend refuses');
await setMode('error');
const refused = await call('redeal', {});
check(
  'the upstream code reaches the caller',
  refused?.ok === false && /EXEMPLAR|REDEAL/.test(refused.error.code),
  JSON.stringify(refused).slice(0, 200)
);
check(
  'the board is not half-applied',
  ((await call('get_view_context')).board?.order?.length ?? 0) === 0
);

console.log('\nthe network is down');
await setMode('offline');
const offline = await call('redeal', {});
check(
  'a dead connection is a shaped failure, not a thrown error',
  offline?.ok === false && offline.error.code === 'REDEAL_FAILED',
  JSON.stringify(offline).slice(0, 200)
);
const afterOffline = await call('get_view_context');
check(
  'the agent is told the deal failed',
  afterOffline.lastDealFailed?.code === 'REDEAL_FAILED'
);
check(
  'and the human is told too, rather than Enter being a dead key',
  (await page.locator('[data-deal-error]').count()) === 1
);
check(
  'the flags are untouched by a failed deal',
  afterOffline.flags.picks.length === 1 && afterOffline.flags.rejects.length === 1
);

console.log('\nthe collection has nothing left');
await setMode('empty');
const empty = await call('redeal', {});
check(
  'an empty deal keeps the picks rather than clearing the board',
  empty?.ok === true && empty.order.length === 1 && empty.added.length === 0,
  JSON.stringify(empty).slice(0, 200)
);
check(
  'the earlier failure is cleared once a deal succeeds',
  (await page.locator('[data-deal-error]').count()) === 0
);

console.log('\nthe network is slow');
await setMode('slow');
const racing = await page.evaluate(async () => {
  const first = window.__paillette_webmcp.call('redeal', {});
  const second = await window.__paillette_webmcp.call('redeal', {});
  return { second, first: await first };
});
check(
  'a second deal on top of a slow one is refused, not interleaved',
  racing.second?.ok === false && racing.second.error.code === 'REDEAL_IN_FLIGHT',
  JSON.stringify(racing.second).slice(0, 160)
);
check('the first deal still lands', racing.first?.ok === true);
check(
  'and the latch releases, so the next press works',
  (await call('redeal', {}))?.ok !== false ||
    (await call('redeal', {}))?.error.code !== 'REDEAL_IN_FLIGHT'
);

console.log('\nEnter with nothing flagged');
await setMode('ok');
await call('flag_artworks', {
  flags: [
    { artworkId: 'w0', flag: 'clear', reason: 'reset' },
    { artworkId: 'w1', flag: 'clear', reason: 'reset' },
  ],
});
// The agent cannot clear a human's flag, so clear them the human's way.
for (const id of ['w0', 'w1']) {
  const card = page.locator(`.paillette-card[data-artwork-id="${id}"]`);
  if (await card.count()) {
    await card.hover();
    await page.keyboard.press('u');
  }
}
const bar = page.locator('input[aria-label="Ask the agent"]');
await bar.click();
await page.keyboard.press('Enter');
await page.waitForTimeout(1000);
check(
  'pressing Enter with no flags says nothing and breaks nothing',
  (await page.locator('[data-deal-error]').count()) === 0 && pageErrors.length === 0,
  pageErrors.join(' | ')
);

check('no uncaught page errors anywhere', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(
  `\n${failures.length ? `${failures.length} FAILED: ${failures.join(', ')}` : 'all checks passed'}`
);
process.exit(failures.length ? 1 : 0);
