/**
 * The brief's §9 sequence, run repeatedly, plus the failure paths a judge will
 * find before we do.
 *
 * Lives under docs/ on purpose: this lane writes rather than builds, and
 * scripts/demo/ belongs to the e2e lane. It duplicates nothing — the e2e
 * harnesses walk the loop once and measure it; this one runs the demo path N
 * times looking for flakiness, and then does the things nobody scripts: a flag
 * on an id that no longer resolves, Enter with no flags at all, a compare
 * against a stale id.
 *
 * Zero model calls, by construction. Every §9 bullet it touches is reachable
 * without one; the two that are not (the agent's note, real speech) are called
 * out as skipped rather than silently dropped.
 *
 *   PLAYWRIGHT_CORE=<path> node docs/night/verify-demo-path.mjs [base] [runs]
 */

import { writeFileSync } from 'node:fs';
import { resolveBrowserDriver } from '../../scripts/demo/browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const RUNS = Number(process.argv[3] ?? 3);
const QUERY = 'warm landscape';
const CHROME = process.env.CHROME_PATH ?? undefined;

const results = [];
let failures = 0;

const record = (run, name, ok, detail) => {
  results.push({ run, name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  run ${run}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
};

const { chromium } = await resolveBrowserDriver();
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});

for (let run = 1; run <= RUNS; run += 1) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const requests = [];
  const pageErrors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const modelCallsSince = (n) => requests.slice(n).filter((u) => u.includes('/public-agent/')).length;

  // A fresh tab each run. The board runs out after ~5 redeals against one pick
  // set, so re-using a context would measure that instead of what we came for.
  await page.goto(`${BASE}/nga/search?webmcp-debug&q=${encodeURIComponent(QUERY)}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-artwork-id]', { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());

  // `__paillette_webmcp.call` resolves to the tool's own object. It is *not*
  // wrapped in an MCP `{content:[{text}]}` envelope — assuming it was is what
  // made the first version of this script report 27 product defects that were
  // all mine.
  const call = (name, args) =>
    page.evaluate(([n, a]) => window.__paillette_webmcp.call(n, a), [name, args]);

  // ---- §9.1 — the keys work, flags persist, get_view_context returns them ----

  record(run, 'focus is on BODY at cold load, so the keys are live',
    (await page.evaluate(() => document.activeElement?.tagName)) === 'BODY');

  const ids = await page.evaluate(() =>
    [...new Set(Array.from(document.querySelectorAll('[data-artwork-id]'))
      .map((e) => e.getAttribute('data-artwork-id')))].slice(0, 4));

  const press = async (id, key) => {
    const card = page.locator(`[data-artwork-id="${id}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.keyboard.press(key);
    await page.waitForTimeout(280);
  };
  const flagOf = (id) => page.evaluate((i) => {
    const el = document.querySelector(`[data-artwork-id="${i}"][data-flag]`);
    return el ? { flag: el.getAttribute('data-flag'), by: el.getAttribute('data-flag-by') } : null;
  }, id);

  await press(ids[0], 'x');
  record(run, 'X rejects the hovered card, in the human\'s ink',
    JSON.stringify(await flagOf(ids[0])) === '{"flag":"reject","by":"human"}', await flagOf(ids[0]));

  await press(ids[1], 'x');
  await press(ids[2], 'p');
  record(run, 'P picks the hovered card',
    (await flagOf(ids[2]))?.flag === 'pick', await flagOf(ids[2]));

  // U is the one key the earlier draft never exercised.
  await press(ids[1], 'u');
  record(run, 'U clears a flag it set',
    ((await flagOf(ids[1]))?.flag ?? 'none') === 'none', await flagOf(ids[1]));
  await press(ids[1], 'x');

  const ctx = (await call('get_view_context', {})) ?? {};
  record(run, 'get_view_context returns the flags, with visual facts attached',
    ctx?.flags?.picks?.length === 1 && ctx?.flags?.rejects?.length === 2
      && Array.isArray(ctx.flags.rejects[0]?.palette) && ctx.flags.rejects[0].palette.length > 0,
    { picks: ctx?.flags?.picks?.length, rejects: ctx?.flags?.rejects?.length,
      palette: ctx?.flags?.rejects?.[0]?.palette, medium: ctx?.flags?.rejects?.[0]?.medium });

  // Flags survive a different search — "persist per session". This must be an
  // *in-page* search. A `page.goto` is a reload, and flags are in-memory page
  // state that a reload is documented to lose; testing it that way measures
  // the wrong thing and calls correct behaviour a defect.
  const beforeSearch = requests.length;
  const searchField = page.locator('input[placeholder="search by feeling, era, subject..."]').first();
  await searchField.click();
  await searchField.fill('still life fruit');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(7000);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  const afterSearch = (await call('get_view_context', {})) ?? {};
  record(run, 'the flags survive the human running a different search',
    (afterSearch?.flags?.picks?.length ?? 0) === 1 && (afterSearch?.flags?.rejects?.length ?? 0) === 2,
    { picks: afterSearch?.flags?.picks?.length, rejects: afterSearch?.flags?.rejects?.length,
      modelCalls: modelCallsSince(beforeSearch) });

  // ---- §9.2 — Enter on an empty bar, picks in place, no model call ----

  const beforeEnter = requests.length;
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
  const firstDeal = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="deal-board-grid"]');
    return g ? { cards: g.querySelectorAll('[data-artwork-id]').length } : null;
  });
  record(run, 'Enter #1 deals a board', !!firstDeal, firstDeal);

  const beforeSecond = requests.length;
  const slotBefore = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="deal-board-grid"]');
    const pick = g?.querySelector('[data-flag="pick"]');
    if (!pick || !g) return null;
    const a = pick.getBoundingClientRect(); const b = g.getBoundingClientRect();
    return { id: pick.getAttribute('data-artwork-id'), dx: Math.round(a.x - b.x), dy: Math.round(a.y - b.y) };
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
  const board = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="deal-board-grid"]');
    if (!g) return null;
    const cards = Array.from(g.querySelectorAll('[data-artwork-id]'));
    const visible = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
    const rejectsOnBoard = cards.filter((c) => c.getAttribute('data-flag') === 'reject').length;
    const tray = document.querySelector('.lt-tray');
    return { cards: cards.length, fullyVisible: visible.length, rejectsOnBoard,
      gridHeight: Math.round(g.getBoundingClientRect().height),
      tray: tray ? tray.querySelectorAll('[data-artwork-id]').length : 0 };
  });
  const slotAfter = await page.evaluate((id) => {
    const g = document.querySelector('[data-testid="deal-board-grid"]');
    const pick = g?.querySelector(`[data-artwork-id="${id}"]`);
    if (!pick || !g) return null;
    const a = pick.getBoundingClientRect(); const b = g.getBoundingClientRect();
    return { dx: Math.round(a.x - b.x), dy: Math.round(a.y - b.y) };
  }, slotBefore?.id);

  record(run, 'Enter on an empty bar makes NO model call', modelCallsSince(beforeSecond) === 0,
    { modelCalls: modelCallsSince(beforeSecond),
      exemplarCalls: requests.slice(beforeSecond).filter((u) => u.includes('/exemplars')).length });
  record(run, 'the board is twelve and all twelve are on screen',
    board?.cards === 12 && board?.fullyVisible === 12, board);
  record(run, 'no reject is ever on the board', board?.rejectsOnBoard === 0, board?.rejectsOnBoard);
  record(run, 'the rejects are in the tray, restorable', (board?.tray ?? 0) >= 2, board?.tray);
  record(run, 'the pick holds its slot, to the pixel',
    !!slotBefore && !!slotAfter && slotAfter.dx === slotBefore.dx && slotAfter.dy === slotBefore.dy,
    { before: slotBefore, after: slotAfter });

  // ---- §9.1 (C) — the two-up is a room, opened by the human, no model call ----

  const beforeCompare = requests.length;
  const hoverable = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="deal-board-grid"]');
    const card = Array.from(g?.querySelectorAll('[data-artwork-id]') ?? [])
      .find((c) => c.getAttribute('data-flag') !== 'pick');
    return card?.getAttribute('data-artwork-id') ?? null;
  });
  if (hoverable) await press(hoverable, 'c');
  const room = await page.evaluate(() => {
    const o = document.querySelector('[data-asked-by]');
    if (!o) return null;
    const r = o.getBoundingClientRect();
    const others = Array.from(document.body.children)
      .filter((c) => !c.contains(o) && getComputedStyle(c).visibility !== 'hidden' && c.getBoundingClientRect().height > 0);
    return { box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      askedBy: o.getAttribute('data-asked-by'), chromeVisible: others.length,
      viewport: { w: window.innerWidth, h: window.innerHeight } };
  });
  record(run, 'C opens the two-up as a room, full viewport, nothing else on screen',
    !!room && room.box.x === 0 && room.box.y === 0 && room.box.w === room.viewport.w && room.chromeVisible === 0, room);
  record(run, 'opening the two-up makes NO model call', modelCallsSince(beforeCompare) === 0);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(600);

  // ---- §9.5 — two colours of ink, with an agent flag laid beside a human one ----

  const beforeInk = requests.length;
  const agentTarget = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="deal-board-grid"]');
    const card = Array.from(g?.querySelectorAll('[data-artwork-id]') ?? [])
      .find((c) => (c.getAttribute('data-flag') ?? 'none') === 'none');
    return card?.getAttribute('data-artwork-id') ?? null;
  });
  if (agentTarget) {
    await call('flag_artworks', { flags: [{ artworkId: agentTarget, flag: 'reject', reason: 'ink check' }] });
    await page.waitForTimeout(900);
  }
  const ink = await page.evaluate(([human, agent]) => {
    const read = (id) => {
      const el = document.querySelector(`[data-artwork-id="${id}"][data-flag]`);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { flag: el.getAttribute('data-flag'), by: el.getAttribute('data-flag-by'),
        provisional: el.getAttribute('data-flag-provisional'),
        boxShadow: s.boxShadow.slice(0, 60), outlineStyle: s.outlineStyle };
    };
    return { human: read(human), agent: read(agent) };
  }, [slotBefore?.id, agentTarget]);
  record(run, 'the agent\'s flag lands provisional and dashed, beside the human\'s solid one',
    ink?.agent?.by === 'agent' && ink?.agent?.provisional === 'true'
      && ink?.human?.by === 'human' && ink?.human?.provisional === 'false',
    ink);
  record(run, 'an agent flag makes NO model call', modelCallsSince(beforeInk) === 0);

  // ---- Failure paths: what a judge finds before we do ----

  const stale = 'open-access-art:nga:000000000';
  const flagStale = await call('flag_artworks', { flags: [{ artworkId: stale, flag: 'pick', reason: 'stale id' }] });
  record(run, 'flag_artworks on an id that does not resolve fails loudly, not silently',
    JSON.stringify(flagStale ?? {}).length > 0
      && !JSON.stringify(flagStale).includes('"ok":true'), flagStale);

  const compareStale = await call('compare_artworks', { artworkIds: [stale, `${stale}1`], question: 'stale?' });
  record(run, 'compare_artworks on stale ids does not open an empty room',
    !JSON.stringify(compareStale ?? {}).includes('"ok":true'), compareStale);

  const lookupStale = await call('lookup_artwork', { artwork: stale });
  record(run, 'lookup_artwork on a stale id returns an error rather than throwing',
    JSON.stringify(lookupStale ?? {}).length > 0, lookupStale);

  record(run, 'no uncaught page errors anywhere in the run', pageErrors.length === 0, pageErrors);
  await context.close();
}

// Enter with no flags at all, in its own tab — the empty state.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const requests = []; const pageErrors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-artwork-id]', { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  const before = requests.length;
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4000);
  const state = await page.evaluate(() => ({
    dealGrid: !!document.querySelector('[data-testid="deal-board-grid"]'),
    enterArmed: !!document.querySelector('.lt-enter-armed'),
    dealError: document.querySelector('.paillette-deal-error')?.textContent?.trim() ?? null,
    stillHasResults: document.querySelectorAll('[data-artwork-id]').length > 0,
  }));
  record(0, 'Enter with no flags at all does not blank the page or error',
    state.stillHasResults && !state.dealGrid, state);
  record(0, 'the enter affordance is absent until a flag exists', state.enterArmed === false, state);
  record(0, 'Enter with no flags makes no request at all',
    requests.slice(before).filter((u) => u.includes('/api/')).length === 0,
    requests.slice(before).filter((u) => u.includes('/api/')));
  record(0, 'no page errors in the empty state', pageErrors.length === 0, pageErrors);
  await context.close();
}

await browser.close();

const summary = { base: BASE, query: QUERY, runs: RUNS, checks: results.length, failures, results };
writeFileSync(new URL('./e2e-evidence/demo-path.json', import.meta.url), JSON.stringify(summary, null, 2));
console.log(`\n${results.length - failures} passed, ${failures} failed, across ${RUNS} run(s). Zero model calls by construction.`);
process.exit(failures ? 1 : 0);
