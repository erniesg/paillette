/**
 * The demo loop, walked by hand on the merged build — iteration 5.
 *
 * Written fresh rather than re-running a lane's own harness. A lane's script
 * asserts what that lane meant to build; the question here is whether the
 * *merged* page does what the brief's walkthrough says, in the order it says,
 * with nothing done for it that a person would not do.
 *
 *   node apps/web/scripts/integration-walk-iter5.mjs https://paillette-stg.berlayar.ai
 *     — nothing stubbed. Search, the Rocchio engine and the pictures are the
 *       deployed ones, so `redeal` and `search_by_exemplars` actually run.
 *
 *   node apps/web/scripts/integration-walk-iter5.mjs http://localhost:5174
 *     — a dev server holds no public-search credential, so `redeal` and
 *       `search_by_exemplars` answer 401 and the redeal half of the walk
 *       cannot be judged. The script says so instead of scoring it.
 *
 * Two things it deliberately does *not* do, because they are how earlier
 * reports came to overstate:
 *
 * - It never presses Escape before the culling keys. Pressing P on a hovered
 *   card is the first beat of the demo and it has to work on the page as it
 *   arrives, not after a keystroke nobody would think to type.
 * - It only calls a redeal animated if a redeal actually changed the board.
 *   Sampling card positions after a no-op measures the page settling, which
 *   is how "the FLIP animates" got asserted off a layout shift.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5174';
const SHOTS = process.env.WALK_SHOTS ?? '/tmp/int5/shots';
const UTTERANCE = '[data-utterance-bar], input[aria-label="Ask the agent"]';
mkdirSync(SHOTS, { recursive: true });

const log = [];
let failed = 0;
const say = (ok, label, detail = '') => {
  if (ok === false) failed += 1;
  const line = `${ok === null ? 'NOTE' : ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`;
  log.push(line);
  console.log(line);
};

const board = (page) =>
  page.$$eval('.paillette-card', (cards) =>
    cards.map((card, index) => {
      const r = card.getBoundingClientRect();
      return {
        index,
        id: card.getAttribute('data-artwork-id'),
        flag: card.getAttribute('data-flag'),
        by: card.getAttribute('data-flag-by'),
        provisional: card.getAttribute('data-flag-provisional'),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) },
      };
    })
  );

const main = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const calls = { agentTurn: 0, exemplars: 0 };
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/public-agent/turn')) calls.agentTurn += 1;
    else if (url.includes('exemplars')) calls.exemplars += 1;
  });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // ------------------------------------------------------------- the harness
  await page.goto(`${BASE}/nga/search?webmcp-debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);

  const harness = await page.evaluate(() => ({
    installed: typeof window.__paillette_webmcp?.call === 'function',
    stubbed: window.__paillette_webmcp?.stubbed ?? null,
  }));
  say(harness.installed, 'window.__paillette_webmcp is installed on ?webmcp-debug',
    `stubbed=${harness.stubbed}`);

  const tools = await page.evaluate(async () =>
    (await window.__paillette_webmcp.tools()).map((t) => t.name ?? t));
  say(tools.length === 25, `document.modelContext carries ${tools.length} tools`,
    tools.length === 25 ? '' : tools.join(','));
  say(Boolean(await page.$(UTTERANCE)), 'the utterance bar is on the page');

  // ------------------------------------------------------------- deal a board
  const pool = await page.evaluate(async () => {
    const r = await fetch('/api/public-search/nga/browse?limit=40');
    const b = await r.json();
    return (b?.data?.results ?? []).map((w) => w.id).filter(Boolean);
  });
  say(pool.length >= 12, `the browse endpoint answered with ${pool.length} real NGA ids`);

  await page.evaluate((ids) =>
    window.__paillette_webmcp.call('set_results', {
      artworkIds: ids.slice(0, 12),
      note: 'Twelve to start from.',
    }), pool);
  await page.waitForTimeout(2000);
  let cards = await board(page);
  say(cards.length >= 12, `a board is dealt: ${cards.length} cards`);
  await page.screenshot({ path: `${SHOTS}/01-dealt.png` });

  // ------------------------------------------------ P on two, X on two others
  const focusAfterDeal = await page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a?.tagName ?? null, placeholder: a?.getAttribute?.('placeholder') ?? null };
  });
  say(focusAfterDeal.tag !== 'INPUT',
    'no text field holds the caret once the board is dealt',
    JSON.stringify(focusAfterDeal));

  const pickIds = [cards[0].id, cards[1].id];
  const rejectIds = [cards[2].id, cards[3].id];
  const press = async (id, key) => {
    await page.hover(`.paillette-card[data-artwork-id="${id}"]`);
    await page.waitForTimeout(150);
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  };
  for (const id of pickIds) await press(id, 'p');
  for (const id of rejectIds) await press(id, 'x');

  cards = await board(page);
  const at = (id) => cards.find((c) => c.id === id);
  say(pickIds.every((id) => at(id)?.flag === 'pick'),
    'P on two hovered works picks them, with no Escape first',
    pickIds.map((id) => `${id}=${at(id)?.flag}/${at(id)?.by}`).join(' '));
  say(rejectIds.every((id) => at(id)?.flag === 'reject'),
    'X on two others rejects them',
    rejectIds.map((id) => `${id}=${at(id)?.flag}/${at(id)?.by}`).join(' '));
  await page.screenshot({ path: `${SHOTS}/02-flagged.png` });

  const ctx = await page.evaluate(() => window.__paillette_webmcp.call('get_view_context', {}));
  const flagsBack = JSON.stringify(ctx?.flags ?? {});
  say(flagsBack.includes('pick') && flagsBack.includes('reject'),
    'get_view_context hands the flags back', flagsBack.slice(0, 220));
  writeFileSync(`${SHOTS}/view-context.json`, JSON.stringify(ctx, null, 2));

  // ----------------------------------------- Enter on an empty bar: the beat
  const before = cards.map((c) => c.id);
  const pickRectsBefore = Object.fromEntries(
    cards.filter((c) => pickIds.includes(c.id)).map((c) => [c.id, c.rect]));
  const agentTurnsBefore = calls.agentTurn;

  await page.evaluate(() => {
    window.__flip = [];
    const t0 = performance.now();
    const tick = () => {
      const now = performance.now() - t0;
      if (now > 1200) return;
      window.__flip.push({
        t: Math.round(now),
        cards: [...document.querySelectorAll('.paillette-card')].map((c) => {
          const r = c.getBoundingClientRect();
          return { id: c.getAttribute('data-artwork-id'), x: Math.round(r.x), y: Math.round(r.y) };
        }),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await (await page.$(UTTERANCE)).click();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);

  cards = await board(page);
  const after = cards.map((c) => c.id);
  const arrived = after.filter((id) => !before.includes(id));
  const left = before.filter((id) => !after.includes(id));
  const redealt = arrived.length > 0 || left.length > 0;

  say(calls.agentTurn === agentTurnsBefore,
    'Enter on an empty bar reached no model',
    `POST /api/public-agent/turn ${agentTurnsBefore} -> ${calls.agentTurn}`);
  say(redealt, 'the board redealt', `${left.length} left, ${arrived.length} arrived`);
  say(pickIds.every((id) => after.includes(id) && at(id)?.flag === 'pick'),
    'the picks are still on the board and still picked',
    pickIds.map((id) => `${id}@${after.indexOf(id)}`).join(' '));
  say(rejectIds.every((id) => !after.includes(id)),
    'the rejects left the board',
    rejectIds.map((id) => `${id}@${after.indexOf(id)}`).join(' '));

  const tray = await page.$$eval('.lt-tray-card', (n) => n.length).catch(() => 0);
  say(null, `the considered-and-declined tray holds ${tray}`);

  // The animation, judged only if there was something to animate.
  const flip = await page.evaluate(() => window.__flip ?? []);
  const seen = {};
  for (const frame of flip) {
    for (const c of frame.cards) (seen[c.id] ??= []).push(`${c.x},${c.y}`);
  }
  const positions = (id) => new Set(seen[id] ?? []).size;
  if (!redealt) {
    say(null,
      'FLIP not judged: the board did not change, so any movement sampled is the page settling, not a deal');
  } else {
    const tweened = Object.keys(seen).filter((id) => positions(id) > 2);
    say(tweened.length > 0,
      `FLIP: ${tweened.length} of ${Object.keys(seen).length} cards passed through intermediate positions`,
      `${flip.length} frames sampled over ${flip.at(-1)?.t ?? 0}ms`);
    say(pickIds.every((id) => {
      const b = pickRectsBefore[id];
      const a = at(id)?.rect;
      return b && a && Math.abs(b.x - a.x) < 8 && Math.abs(b.y - a.y) < 8;
    }),
      'the picks visibly stayed put across the redeal',
      pickIds.map((id) => `${id}: ${JSON.stringify(pickRectsBefore[id])} -> ${JSON.stringify(at(id)?.rect)}, ${positions(id)} sampled positions`).join(' | '));
  }
  writeFileSync(`${SHOTS}/flip.json`, JSON.stringify(flip, null, 2));
  await page.screenshot({ path: `${SHOTS}/03-redealt.png` });

  // ------------------------------------------------ each tool, by hand, direct
  const call = async (name, args) => {
    try {
      const out = await page.evaluate(([n, a]) => window.__paillette_webmcp.call(n, a), [name, args]);
      return { name, ok: out?.ok !== false, out: JSON.stringify(out) };
    } catch (e) {
      return { name, ok: false, out: String(e) };
    }
  };

  const ids = (await board(page)).map((c) => c.id);
  const probes = [
    ['flag_artworks', { flags: [{ artworkId: ids[5], flag: 'reject', reason: 'busier than the picks' }] }],
    ['redeal', { keep: 'picks', strategy: 'widen', note: 'wider, on the same picks' }],
    ['search_by_exemplars', { positiveIds: pickIds, negativeIds: rejectIds, topK: 6 }],
    ['compare_artworks', { artworkIds: [ids[0], ids[1]], question: 'Which one hangs?' }],
    ['set_exhibition', { title: 'Before Leaving', statement: 'A room about the hour before a departure — thresholds, packed light, the last of an afternoon.' }],
    ['get_exhibition', {}],
    ['write_labels', { artworkIds: [ids[0], ids[1]] }],
    ['set_view', { view: 'atlas' }],
    ['annotate_atlas', { regions: [{ label: 'the ones about leaving', artworkIds: [ids[0], ids[1]] }] }],
    ['get_view_context', {}],
  ];
  const results = [];
  for (const [name, args] of probes) {
    const r = await call(name, args);
    await page.waitForTimeout(900);
    results.push(r);
    say(r.ok, `__paillette_webmcp.call('${name}')`, r.out.slice(0, 210).replace(/\s+/g, ' '));
  }
  writeFileSync(`${SHOTS}/probes.json`, JSON.stringify(results, null, 2));
  await page.screenshot({ path: `${SHOTS}/04-after-tools.png` });

  const inks = await page.$$eval('.paillette-card', (cs) =>
    cs.map((c) => ({
      id: c.getAttribute('data-artwork-id'),
      flag: c.getAttribute('data-flag'),
      by: c.getAttribute('data-flag-by'),
      provisional: c.getAttribute('data-flag-provisional'),
    })).filter((c) => c.flag && c.flag !== 'none'));
  say(inks.some((c) => c.by === 'agent' && c.provisional === 'true'),
    "a dashed flag in the agent's ink is on the board",
    JSON.stringify(inks));
  say(inks.some((c) => c.by === 'human'), "a flag in the human's ink is on the same board");

  say(pageErrors.length === 0, `uncaught page errors: ${pageErrors.length}`,
    pageErrors.slice(0, 3).join(' | '));
  say(null, 'network', JSON.stringify(calls));

  writeFileSync(`${SHOTS}/walk.log`, log.join('\n') + '\n');
  await browser.close();
  console.log(`\n${failed === 0 ? 'all observations passed' : `${failed} FAILED`} — shots in ${SHOTS}`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((e) => { console.error(e); process.exit(1); });
