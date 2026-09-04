/**
 * The demo loop, walked end to end on the merged build.
 *
 * Deliberately unlike every lane's own harness, which invents works with
 * legible titles so an assertion can read them. This deals **real National
 * Gallery works with real pictures**, so it says whether the merged page runs
 * rather than whether its pieces behave when fed fixtures.
 *
 *   node apps/web/scripts/integration-walkthrough.mjs https://paillette-stg.berlayar.ai
 *     — nothing stubbed at all. The search, the Rocchio engine and the images
 *       are the deployed ones.
 *
 *   node apps/web/scripts/integration-walkthrough.mjs http://localhost:5311
 *     — a dev server holds no public-search credential, so text search and
 *       `/exemplars` 401. The transport for those two is answered from the
 *       *unauthenticated* browse endpoint, which is real data. The pictures,
 *       the page and every tool are real; the ranking is not. The script says
 *       so in its own output rather than quietly passing.
 *
 * Writes screenshots to /tmp/walkthrough so a person can look at the result.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5311';
const SHOTS = '/tmp/walkthrough';
mkdirSync(SHOTS, { recursive: true });

/** Real NGA works, from the endpoint that needs no credential. */
const pool = async () => {
  const response = await fetch(`${BASE}/api/public-search/nga/browse?limit=60`);
  const body = await response.json();
  return (body?.data?.results ?? []).map((work, index) => ({
    ...work,
    similarity: 0.9 - index * 0.002,
  }));
};

const results = [];
const note = (ok, label, detail = '') => {
  results.push({ ok, label, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const board = (page) =>
  page.$$eval('.paillette-card', (cards) =>
    cards.map((card, index) => ({
      index,
      id: card.getAttribute('data-artwork-id'),
      flag: card.getAttribute('data-flag'),
      by: card.getAttribute('data-flag-by'),
      title: card.querySelector('h3, h2, [data-title]')?.textContent?.trim() ?? null,
    }))
  );

const main = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

  const calls = { exemplars: 0, agent: 0, text: 0 };
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/exemplars')) calls.exemplars += 1;
    if (url.includes('/public-agent/turn')) calls.agent += 1;
    if (url.includes('/public-search/nga/text')) calls.text += 1;
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  // Does this deployment hold a search credential? If not, answer the two
  // credentialled routes with real works and say so loudly.
  const probe = await fetch(`${BASE}/api/public-search/nga/text`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'storm at sea', limit: 12 }),
  }).catch(() => null);
  const credentialled = probe?.status === 200;
  let works = [];
  if (!credentialled) {
    works = await pool();
    console.log(
      `\n!! ${BASE} holds no public-search credential (${probe?.status}). ` +
        `Serving ${works.length} real NGA works to /text and /exemplars.\n` +
        '!! The pictures and the page are real; the RANKING IS NOT.\n'
    );
    let deal = 0;
    await page.route('**/api/public-search/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/quota')) {
        return route.fulfill({ json: { success: true, data: { remaining: 100, limit: 100 } } });
      }
      if (url.includes('/exemplars')) {
        const body = JSON.parse(route.request().postData() || '{}');
        const exclude = new Set([
          ...(body.excludeIds ?? []),
          ...(body.positiveIds ?? []),
          ...(body.negativeIds ?? []),
        ]);
        deal += 1;
        const results = works
          .filter((work) => !exclude.has(work.id))
          .slice(deal * 3, deal * 3 + (body.topK ?? 12));
        return route.fulfill({
          json: { success: true, data: { results, count: results.length, queryTime: 4 } },
        });
      }
      if (url.includes('/text')) {
        const results = works.slice(0, 12);
        return route.fulfill({
          json: { success: true, data: { results, count: results.length, queryTime: 4 } },
        });
      }
      return route.continue();
    });
  } else {
    console.log(`\n== ${BASE} answers text search live. Nothing is stubbed.\n`);
  }
  note(true, credentialled ? 'the deployment answers search live' : 'transport stubbed with real works (no local credential)');

  // ---- 1. deal a board --------------------------------------------------
  await page.goto(`${BASE}/nga/search?q=storm%20at%20sea&webmcp-debug`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.paillette-card', { timeout: 30_000 });
  const dealt = await board(page);
  note(dealt.length > 0, 'a board deals from the real collection', `${dealt.length} works, ${calls.text} text search(es)`);
  await page.screenshot({ path: `${SHOTS}/1-dealt.png` });

  const focus = await page.evaluate(() => document.activeElement?.tagName ?? null);
  note(focus !== 'INPUT', 'focus is not parked in the search field on a cold load', `activeElement=${focus}`);

  // ---- 2. P on two, X on two -------------------------------------------
  const ids = dealt.map((entry) => entry.id).filter(Boolean);
  const press = async (id, key) => {
    await page.hover(`[data-artwork-id="${id}"]`);
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
  };
  await press(ids[0], 'p');
  await press(ids[1], 'p');
  await press(ids[2], 'x');
  await press(ids[3], 'x');

  const flagged = await board(page);
  const picks = flagged.filter((entry) => entry.flag === 'pick');
  const rejects = flagged.filter((entry) => entry.flag === 'reject');
  note(picks.length === 2, 'P marks two works as picks', picks.map((entry) => entry.id).join(', '));
  note(rejects.length === 2, 'X marks two works as rejects', rejects.map((entry) => entry.id).join(', '));
  note(
    picks.every((entry) => entry.by === 'human'),
    'the picks are drawn in the human’s hand',
    picks.map((entry) => entry.by).join(', ')
  );
  await page.screenshot({ path: `${SHOTS}/2-flagged.png` });

  const ink = await page.evaluate(() => {
    const read = (flag) => {
      const card = document.querySelector(`.paillette-card[data-flag="${flag}"]`);
      return card ? getComputedStyle(card).boxShadow + '|' + getComputedStyle(card).outlineColor : null;
    };
    return { pick: read('pick'), reject: read('reject') };
  });
  note(Boolean(ink.pick), 'a pick is actually painted on screen', (ink.pick ?? '').slice(0, 70));

  // ---- 3. Enter on an empty bar ----------------------------------------
  //
  // Two different questions, kept apart on purpose. The *seat* is the board's
  // order, which is the contract the redeal actually makes. The *position* is
  // where the card is on the human's screen, which is what the money shot is
  // about — and on a masonry grid the two are not the same thing.
  const seatsOf = () =>
    page.evaluate(async () => {
      const context = await window.__paillette_webmcp?.call('get_view_context', {});
      const data = context?.data ?? context ?? {};
      return { order: data.board?.order ?? [], picks: (data.flags?.picks ?? []).map((p) => p.id ?? p) };
    });
  const positionsOf = () =>
    page.$$eval('.paillette-card', (cards) =>
      Object.fromEntries(
        cards.map((card) => {
          const box = card.getBoundingClientRect();
          return [
            card.getAttribute('data-artwork-id'),
            { x: Math.round(box.x), y: Math.round(box.y + window.scrollY) },
          ];
        })
      )
    );

  const before = { exemplars: calls.exemplars, agent: calls.agent };
  const seatsBefore = await seatsOf();
  const positionsBefore = await positionsOf();
  const pickIds = picks.map((entry) => entry.id);

  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
  await page.mouse.move(700, 700);

  // Sample the layout across the whole redeal, starting before Enter lands.
  const motionPromise = page.evaluate(async () => {
    const sample = () =>
      Array.from(document.querySelectorAll('.paillette-card'))
        .map((card) => {
          const box = card.getBoundingClientRect();
          return `${card.getAttribute('data-artwork-id')}@${Math.round(box.x)},${Math.round(box.y)}`;
        })
        .join(' ');
    const frames = [];
    const start = performance.now();
    while (performance.now() - start < 4000) {
      frames.push(sample());
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    // How many frames sit *between* the first layout and the last one? A FLIP
    // has intermediate states; a jump cut has exactly two.
    const distinct = [];
    for (const frame of frames) if (frame !== distinct[distinct.length - 1]) distinct.push(frame);
    return { frames: frames.length, distinct: distinct.length };
  });

  await page.keyboard.press('Enter');
  const motion = await motionPromise;
  await page.waitForTimeout(600);

  note(calls.exemplars > before.exemplars, 'Enter on an empty bar reached the exemplar route', `${calls.exemplars - before.exemplars} call(s)`);
  note(calls.agent === before.agent, 'Enter on an empty bar made NO model call', `${calls.agent - before.agent} model call(s)`);

  const after = await board(page);
  await page.screenshot({ path: `${SHOTS}/3-redealt.png` });
  note(after.length > 0, 'the board redealt', `${after.length} works`);
  const dealError = await page.$('[data-deal-error]');
  if (dealError) note(false, 'the deal ran', await dealError.getAttribute('data-deal-error'));

  const seatsAfter = await seatsOf();
  const held = pickIds.every((id) => seatsAfter.order.includes(id));
  note(held, 'the picks are still on the board after the redeal', `order[0..3]=${seatsAfter.order.slice(0, 4).join(', ')}`);
  const seatKept = pickIds.every(
    (id) => seatsBefore.order.indexOf(id) < 0 || seatsBefore.order.indexOf(id) === seatsAfter.order.indexOf(id)
  );
  note(
    seatKept,
    'and each pick holds the seat it had in the board order',
    pickIds.map((id) => `${seatsBefore.order.indexOf(id)}->${seatsAfter.order.indexOf(id)}`).join(', ')
  );
  const rejectsGone = rejects.every((entry) => !after.some((now) => now.id === entry.id));
  note(rejectsGone, 'the rejects left the board');
  const fresh = after.filter((entry) => !dealt.some((old) => old.id === entry.id)).length;
  note(fresh > 0, 'newcomers arrived', `${fresh} work(s) the board had not seen`);

  const positionsAfter = await positionsOf();
  const moved = pickIds
    .map((id) => ({ id, from: positionsBefore[id], to: positionsAfter[id] }))
    .filter((entry) => entry.from && entry.to && (entry.from.x !== entry.to.x || entry.from.y !== entry.to.y));
  // Expected to move: this deal replaced the browsing masonry with a board.
  // Recorded rather than asserted; the board-to-board case is below.
  console.log(
    `      (first deal moved ${moved.length} of ${pickIds.length} picks on screen — ` +
      'a browsing grid becoming a board, so this is not the claim)'
  );

  // ---- 4. the second redeal, which is the one the claim is about --------
  //
  // The first deal replaces a browsing grid with a board, so of course
  // everything moves. Board to board is where "your picks stay put" has to be
  // true, and where the FLIP has something to animate.
  const positionsBeforeSecond = await positionsOf();
  const motionSecond = page.evaluate(async () => {
    const sample = () =>
      Array.from(document.querySelectorAll('.paillette-card'))
        .map((card) => {
          const box = card.getBoundingClientRect();
          return `${card.getAttribute('data-artwork-id')}@${Math.round(box.x)},${Math.round(box.y)}`;
        })
        .join(' ');
    const frames = [];
    const start = performance.now();
    while (performance.now() - start < 4000) {
      frames.push(sample());
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const distinct = [];
    for (const frame of frames) if (frame !== distinct[distinct.length - 1]) distinct.push(frame);
    return { frames: frames.length, distinct: distinct.length };
  });
  await page.mouse.move(700, 700);
  await page.keyboard.press('Enter');
  const secondMotion = await motionSecond;
  await page.waitForTimeout(600);

  const positionsAfterSecond = await positionsOf();
  const movedSecond = pickIds
    .map((id) => ({ id, from: positionsBeforeSecond[id], to: positionsAfterSecond[id] }))
    .filter((entry) => entry.from && entry.to && (entry.from.x !== entry.to.x || entry.from.y !== entry.to.y));
  note(
    movedSecond.length === 0,
    'board to board: each pick is in exactly the same place on screen',
    movedSecond.length === 0
      ? 'none moved'
      : movedSecond
          .map((entry) => `${entry.id.split(':').pop()} ${entry.from.x},${entry.from.y} -> ${entry.to.x},${entry.to.y}`)
          .join(' · ')
  );
  note(
    secondMotion.distinct > 8,
    'board to board: the cards animate rather than cutting (FLIP)',
    `${secondMotion.distinct} distinct layouts across ${secondMotion.frames} frames ` +
      `(first deal was ${motion.distinct}; /night/deal measures ~23)`
  );
  await page.screenshot({ path: `${SHOTS}/3b-second-deal.png` });

  // ---- 5. the tools, driven directly -----------------------------------
  await page.goto(`${BASE}/nga/search?q=storm%20at%20sea&webmcp-debug=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.paillette-card', { timeout: 30_000 });
  const liveIds = (await board(page)).map((entry) => entry.id).filter(Boolean);

  const toolNames = await page.evaluate(async () =>
    ((await window.__paillette_webmcp?.tools?.()) ?? []).map((tool) => tool.name)
  );
  note(toolNames.length > 0, 'the debug host installs and the tools register', `${toolNames.length} tools`);
  for (const name of ['flag_artworks', 'search_by_exemplars', 'redeal', 'compare_artworks']) {
    note(toolNames.includes(name), `${name} is registered`);
  }

  const call = (name, args) =>
    page.evaluate(([n, a]) => window.__paillette_webmcp.call(n, a), [name, args]);

  const flagged2 = await call('flag_artworks', {
    flags: [{ artworkId: liveIds[0], flag: 'pick', reason: 'the light' }],
  });
  note(flagged2?.ok !== false, 'flag_artworks accepted an agent pick', JSON.stringify(flagged2).slice(0, 140));
  const provisional = await page.getAttribute(`[data-artwork-id="${liveIds[0]}"]`, 'data-flag-provisional');
  const hand = await page.getAttribute(`[data-artwork-id="${liveIds[0]}"]`, 'data-flag-by');
  note(hand === 'agent' && provisional === 'true', 'and it lands dashed, in the agent’s ink', `by=${hand} provisional=${provisional}`);
  await page.screenshot({ path: `${SHOTS}/4-agent-flag.png` });

  const exemplars = await call('search_by_exemplars', { positiveIds: [liveIds[0]], topK: 6 });
  note(
    exemplars?.ok !== false,
    'search_by_exemplars returned works from the real index',
    JSON.stringify(exemplars).slice(0, 200)
  );

  await page.hover(`[data-artwork-id="${liveIds[1]}"]`);
  await page.keyboard.press('p');
  await page.waitForTimeout(150);
  const redealt = await call('redeal', { keep: 'picks', strategy: 'widen', note: 'Wider, and cooler.' });
  note(redealt?.ok !== false, 'redeal ran through the tool surface', JSON.stringify(redealt).slice(0, 220));
  const wallLabel = await page.textContent('.paillette-wall-label').catch(() => null);
  note(Boolean(wallLabel), 'the note is rendered as a wall label', (wallLabel ?? '').trim().slice(0, 90));
  const labelInk = await page
    .evaluate(() => {
      const label = document.querySelector('.paillette-wall-label');
      return label ? getComputedStyle(label).color : null;
    })
    .catch(() => null);
  note(Boolean(labelInk), 'and it carries an ink', String(labelInk));
  await page.screenshot({ path: `${SHOTS}/5-agent-redeal.png` });

  // ---- 5b. the agent's presence never covers the board -----------------
  //
  // There used to be a fixed panel across the lower-left of the board, which is
  // where the picks are, and every tool call reopened it — a turn is five or
  // six calls, so on camera it covered the one thing the board is for. It is
  // now a five-character glyph, and the log behind it opens only when a human
  // asks. This asserts that nothing opens itself through a whole turn.
  await call('get_view_context', {});
  await call('flag_artworks', { flags: [{ artworkId: liveIds[2], flag: 'reject', reason: 'busier' }] });
  await page.waitForTimeout(300);
  const logOpen = await page.$('.pa-activity-log');
  note(logOpen === null, 'the tool-call log does not open itself during a turn', logOpen ? 'it opened' : 'closed');
  const glyphBox = await page.evaluate(() => {
    const glyph = document.querySelector('.pa-activity');
    if (!glyph) return null;
    const box = glyph.getBoundingClientRect();
    return { w: Math.round(box.width), h: Math.round(box.height) };
  });
  note(
    Boolean(glyphBox) && glyphBox.w < 120 && glyphBox.h < 80,
    'the agent is present as a mark rather than a panel',
    glyphBox ? `${glyphBox.w}x${glyphBox.h}` : 'missing'
  );
  await page.screenshot({ path: `${SHOTS}/5b-glyph-not-a-panel.png` });

  const nowIds = (await board(page)).map((entry) => entry.id).filter(Boolean);
  const compared = await call('compare_artworks', {
    artworkIds: [nowIds[0], nowIds[1]],
    question: 'Which reads warmer to you?',
  });
  note(compared?.ok !== false, 'compare_artworks opened the two-up', JSON.stringify(compared).slice(0, 160));
  const room = await page.$('.paillette-compare');
  note(Boolean(room), 'the compare room is on screen');
  await page.screenshot({ path: `${SHOTS}/6-compare.png` });

  const context = await call('get_view_context', {});
  const keys = Object.keys(context?.data ?? context ?? {});
  note(
    ['flags', 'board', 'selection', 'hovered', 'compare'].every((key) => keys.includes(key)),
    'get_view_context carries flags, board, selection, hovered and compare',
    keys.join(', ')
  );

  note(pageErrors.length === 0, 'no uncaught page errors anywhere', pageErrors.slice(0, 2).join(' | '));

  await browser.close();

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
