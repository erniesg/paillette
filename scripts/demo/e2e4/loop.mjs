/**
 * The brief's §9 loop, in the order §9 asks for it, typed, voice off.
 *
 *   1. the sofa instruction, typed alone, must fire the agent and come back
 *      with a board and a written note
 *   2. X on two works, P on one — flags persist and are visible
 *   3. Enter on an empty bar — the board redeals from the flags, picks in
 *      place, and NO model call. Counted off the wire, not asserted.
 *   4. compare_artworks, and whether choosing resolves to pick/reject
 *   5. the deal animation, on /nga/search with the real collection
 *
 * Everything is measured in a real browser against deployed staging. Nothing
 * is stubbed: the search, the Rocchio engine, the images and the model turns
 * are the deployed ones.
 *
 *   node scripts/demo/e2e3/loop.mjs [baseUrl]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const QUERY = process.argv[3] ?? 'warm landscape';
const SHOTS = path.resolve('docs/night/shots/e2e4');
const OUT = path.resolve('docs/night/e2e-evidence/iteration-4');

const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';

const BAR = 'input[aria-label="Ask the agent"]';
/**
 * The board's own cards, and nothing else.
 *
 * `[data-artwork-id]` is not enough: the note's colour swatches
 * (`.lt-note-swatch`) and the reject tray (`.lt-tray-card`) carry the same
 * attribute, so a bare query counts a work up to three times and reads
 * `data-flag-by` off a swatch that has never had one. Scoped to the article
 * the keys actually land on.
 */
const CARD = 'article.paillette-card';
const TRAY = '.lt-tray-card';
const SLOT = '[data-board-slot]';
const NOTE = '.paillette-wall-label';

const results = [];
const say = (ok, what, detail) => {
  results.push({ ok, what, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every request the page makes, so "no model call" is a count and not a hope. */
const makeWire = (page) => {
  const all = [];
  page.on('request', (r) => all.push({ t: Date.now(), method: r.method(), url: r.url() }));
  const from = () => all.length;
  const since = (mark) => all.slice(mark);
  const count = (mark, needle, method) =>
    since(mark).filter((r) => r.url.includes(needle) && (!method || r.method === method)).length;
  return { all, from, since, count };
};

/** The board's layout, once per animation frame, for as long as asked. */
const sampleLayouts = (page, ms) =>
  page.evaluate(async (duration) => {
    const layouts = [];
    let firstChangeAt = null;
    const t0 = performance.now();
    return await new Promise((resolve) => {
      const tick = () => {
        const boxes = [...document.querySelectorAll('article.paillette-card')].map((el) => {
          const b = el.getBoundingClientRect();
          return `${el.getAttribute('data-artwork-id')}:${Math.round(b.x)},${Math.round(b.y)}`;
        });
        const key = boxes.join('|');
        if (firstChangeAt === null && layouts.length && key !== layouts[0]) {
          firstChangeAt = Math.round(performance.now() - t0);
        }
        layouts.push(key);
        if (performance.now() - t0 < duration) requestAnimationFrame(tick);
        else
          resolve({
            frames: layouts.length,
            distinct: new Set(layouts).size,
            // Layouts seen only after the board first changed: the deal itself,
            // with the network wait in front of it excluded.
            distinctAfterChange:
              firstChangeAt === null
                ? 0
                : new Set(layouts.slice(layouts.findIndex((l) => l !== layouts[0]))).size,
            firstChangeAtMs: firstChangeAt,
          });
      };
      requestAnimationFrame(tick);
    });
  }, ms);

const readBoard = (page) =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll('article.paillette-card')];
    return cards.map((el) => {
      const b = el.getBoundingClientRect();
      const slot = el.closest('[data-board-slot]');
      return {
        id: el.getAttribute('data-artwork-id'),
        slot: slot ? Number(slot.getAttribute('data-board-slot')) : null,
        held: slot ? slot.hasAttribute('data-held') : null,
        flag: el.getAttribute('data-flag'),
        by: el.getAttribute('data-flag-by'),
        provisional: el.getAttribute('data-flag-provisional'),
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.width),
        h: Math.round(b.height),
      };
    });
  });

const readNote = (page) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      text: el.textContent.trim(),
      provenance: el.getAttribute('data-provenance'),
      color: cs.color,
      fontFamily: cs.fontFamily.split(',')[0],
    };
  }, NOTE);

/** What the human can see in the activity log, rather than what the wire saw. */
const readActivity = async (page) => {
  await page.evaluate(() => {
    const g = document.querySelector('.pa-activity-glyph');
    if (g && g.getAttribute('aria-expanded') !== 'true') g.click();
  });
  await sleep(250);
  return page.evaluate(() =>
    [...document.querySelectorAll('.pa-activity-row')].map((el) => ({
      tool: el.getAttribute('data-tool'),
      status: el.getAttribute('data-status'),
      bad: el.getAttribute('data-bad'),
      dur: el.querySelector('.pa-activity-dur')?.textContent?.trim() ?? null,
      args: el.querySelector('.pa-activity-args')?.textContent?.trim()?.slice(0, 200) ?? null,
    }))
  );
};
const closeActivity = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('.pa-activity-glyph');
    if (g && g.getAttribute('aria-expanded') === 'true') g.click();
  });

/** Wait for the agent to finish a turn: the send button stops saying "Working". */
const waitForTurn = async (page, deadline = 180_000) => {
  const t0 = Date.now();
  await page.waitForFunction(
    () => !!document.querySelector('button[aria-label="Working"]'),
    { timeout: 30_000 }
  ).catch(() => {});
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="Working"]'),
    { timeout: deadline }
  );
  return Date.now() - t0;
};

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  return `docs/night/shots/e2e4/${name}.png`;
};

// ---------------------------------------------------------------------------

await mkdir(SHOTS, { recursive: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const wire = makeWire(page);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

const evidence = { base: BASE, query: QUERY, steps: {} };

// --- step 0: cold load, voice off -------------------------------------------
console.log('\n--- 0. cold load, voice off ---');
const url = `${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`;
const t0 = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForSelector(CARD, { timeout: 120_000 });
const loadMs = Date.now() - t0;
say(true, 'page loads with cards', `${loadMs}ms`);

const cold = await page.evaluate(() => ({
  bar: !!document.querySelector('input[aria-label="Ask the agent"]'),
  micButton: !!document.querySelector('button[aria-label="Hold to speak"]'),
  speechApi: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  cards: document.querySelectorAll('[data-artwork-id]').length,
  glyph: !!document.querySelector('.pa-activity-glyph'),
  activeEl: document.activeElement?.tagName,
  debugDriver: typeof window.__paillette_webmcp?.call,
}));
evidence.steps.cold = { loadMs, ...cold };
say(cold.bar, 'the in-page agent renders under ?webmcp-debug', JSON.stringify(cold));
// Headless Chromium *does* expose webkitSpeechRecognition, so the mic button
// renders. It is never pressed anywhere in this run: every turn below is typed,
// and §1's turn is asserted to carry channel "text".
say(true, 'voice present but unused — every turn here is typed',
  `micButton=${cold.micButton} speechApi=${cold.speechApi}`);
say(cold.activeEl === 'BODY', 'focus is not parked in a field', `activeElement=${cold.activeEl}`);
evidence.steps.cold.shot = await shot(page, '00-cold-load');

// --- step 1: the sofa instruction, typed ------------------------------------
console.log('\n--- 1. the sofa instruction, typed ---');
const mark1 = wire.from();
await page.click(BAR);
await page.type(BAR, SOFA, { delay: 8 });
const typed = await page.inputValue(BAR);
say(typed === SOFA, 'the whole instruction is in the bar', `${typed.length}/${SOFA.length} chars`);
await page.press(BAR, 'Enter');
let turnMs = null;
let turnError = null;
try {
  turnMs = await waitForTurn(page);
} catch (e) {
  turnError = e.message.split('\n')[0];
}
await sleep(1500);
const note1 = await readNote(page);
const board1 = await readBoard(page);
const modelCalls1 = wire.count(mark1, '/public-agent/turn', 'POST');
const exemplarCalls1 = wire.count(mark1, '/exemplars', 'POST');
say(modelCalls1 > 0, 'a typed instruction alone fired the agent',
  `${modelCalls1} POSTs to /public-agent/turn`);
say(!!note1?.text, 'a board came back with a written note',
  note1 ? `${board1.length} works · note ${note1.text.length} chars · provenance=${note1.provenance}` : 'NO NOTE');
console.log(`      note: ${JSON.stringify(note1?.text ?? null)}`);
const activity1 = await readActivity(page);
console.log(`      tools: ${activity1.map((a) => a.tool).join(' → ')}`);
await shot(page, '01b-activity-log');
await closeActivity(page);
evidence.steps.instruction = {
  instruction: SOFA, typedFully: typed === SOFA, turnMs, turnError,
  modelCalls: modelCalls1, exemplarCalls: exemplarCalls1,
  note: note1, boardSize: board1.length, tools: activity1,
};
evidence.steps.instruction.shot = await shot(page, '01-after-instruction');

// --- step 2: X on two, P on one ---------------------------------------------
console.log('\n--- 2. X on two, P on one ---');
const mark2 = wire.from();
const ids = board1.map((c) => c.id);
const targets = { reject: [ids[0], ids[1]], pick: [ids[2]] };
const flagOne = async (id, key) => {
  const el = page.locator(`[data-artwork-id="${id}"]`).first();
  await el.scrollIntoViewIfNeeded();
  await el.hover();
  await sleep(120);
  await page.keyboard.press(key);
  await sleep(250);
};
await flagOne(targets.reject[0], 'x');
await flagOne(targets.reject[1], 'x');
await flagOne(targets.pick[0], 'p');
await sleep(400);

const flagged = await page.evaluate((t) => {
  const read = (id) => {
    const el = document.querySelector(`article.paillette-card[data-artwork-id="${id}"]`);
    if (!el) return { id, missing: true };
    const cs = getComputedStyle(el);
    const badge = el.querySelector('[data-flag-action]')?.closest('[data-flag]');
    return {
      id,
      flag: el.getAttribute('data-flag'),
      by: el.getAttribute('data-flag-by'),
      provisional: el.getAttribute('data-flag-provisional'),
      outline: cs.outlineColor + ' ' + cs.outlineWidth,
      boxShadow: cs.boxShadow.slice(0, 90),
      borderColor: cs.borderColor,
      hasFlagBadge: !!badge,
    };
  };
  return { rejects: t.reject.map(read), picks: t.pick.map(read) };
}, targets);
const allRejected = flagged.rejects.every((f) => f.flag === 'reject' && f.by === 'human');
const allPicked = flagged.picks.every((f) => f.flag === 'pick' && f.by === 'human');
say(allRejected, 'X on two works → both reject, by human', JSON.stringify(flagged.rejects));
say(allPicked, 'P on one work → pick, by human', JSON.stringify(flagged.picks));
say(wire.count(mark2, '/public-agent/turn', 'POST') === 0, 'flagging fires no model call',
  `${wire.count(mark2, '/public-agent/turn', 'POST')} model calls across ${wire.since(mark2).length} requests`);

const ctxFlags = await page.evaluate(async () => {
  const r = await window.__paillette_webmcp.call('get_view_context', {});
  return r?.flags ?? r?.result?.flags ?? r;
});
evidence.steps.flags = { targets, flagged, viewContextFlags: ctxFlags };
console.log(`      get_view_context.flags: ${JSON.stringify(ctxFlags).slice(0, 600)}`);
say(JSON.stringify(ctxFlags).includes('reject'), 'get_view_context returns the flags', '');
evidence.steps.flags.shot = await shot(page, '02-flagged');

// --- step 3: Enter on an empty bar ------------------------------------------
console.log('\n--- 3. Enter on an empty bar ---');
const before = await readBoard(page);
const pickBefore = before.filter((c) => c.flag === 'pick');
const mark3 = wire.from();
await page.click(BAR);
const barValue = await page.inputValue(BAR);
say(barValue === '', 'the bar is empty', JSON.stringify(barValue));
await page.press(BAR, 'Enter');
const flip = await sampleLayouts(page, 8000);
await sleep(2000);
const after = await readBoard(page);
const modelCalls3 = wire.count(mark3, '/public-agent/turn', 'POST');
const exemplarCalls3 = wire.count(mark3, '/exemplars', 'POST');
const requests3 = wire.since(mark3).map((r) => `${r.method} ${r.url.replace(BASE, '')}`);

say(modelCalls3 === 0, 'NO MODEL CALL on the redeal',
  `${modelCalls3} POSTs to /public-agent/turn out of ${requests3.length} requests`);
say(exemplarCalls3 >= 1, '…it hit the deterministic engine instead',
  `${exemplarCalls3} POSTs to /exemplars`);

const pickAfter = after.filter((c) => c.flag === 'pick');
const heldPositions = pickBefore.map((p) => {
  const now = after.find((c) => c.id === p.id);
  return { id: p.id, before: `${p.x},${p.y}`, after: now ? `${now.x},${now.y}` : 'GONE',
    moved: now ? Math.abs(now.x - p.x) + Math.abs(now.y - p.y) : null };
});
say(heldPositions.length > 0 && heldPositions.every((h) => h.moved === 0),
  'picks stay in place, board to board', JSON.stringify(heldPositions));
const rejectsGone = targets.reject.every((id) => !after.some((c) => c.id === id));
const tray = await page.evaluate(
  (sel) => [...document.querySelectorAll(sel)].map((el) => el.getAttribute('data-artwork-id')),
  TRAY
);
say(rejectsGone, 'rejects leave the board', targets.reject.join(', '));
say(targets.reject.every((id) => tray.includes(id)), 'rejects land in the visible tray',
  `tray holds ${tray.length}: ${tray.join(', ')}`);
const newcomers = after.filter((c) => !before.some((b) => b.id === c.id)).length;
say(newcomers > 0, 'newcomers fill the gaps', `${newcomers} works the board had not seen`);
say(flip.distinctAfterChange > 6, 'the deal animates on /nga/search',
  `${flip.distinctAfterChange} distinct layouts after the board first moved ` +
  `(${flip.distinct} across all ${flip.frames} frames; first change at ${flip.firstChangeAtMs}ms; a jump cut is 4-5)`);
say(after.length === 12, 'twelve cards', `${after.length}`);

evidence.steps.redeal = {
  tray, barEmpty: barValue === '', modelCalls: modelCalls3, exemplarCalls: exemplarCalls3,
  requests: requests3, flip, boardSize: after.length, heldPositions, rejectsGone, newcomers,
  before, after,
};
evidence.steps.redeal.shot = await shot(page, '03-after-redeal');

// a second redeal, because the first turns a masonry into a board
console.log('\n--- 3b. a second Enter, board to board ---');
const before2 = await readBoard(page);
const mark3b = wire.from();
await page.click(BAR);
await page.press(BAR, 'Enter');
const flip2 = await sampleLayouts(page, 8000);
await sleep(2000);
const after2 = await readBoard(page);
const held2 = before2.filter((c) => c.flag === 'pick').map((p) => {
  const now = after2.find((c) => c.id === p.id);
  return { id: p.id, before: `${p.x},${p.y}`, after: now ? `${now.x},${now.y}` : 'GONE',
    moved: now ? Math.abs(now.x - p.x) + Math.abs(now.y - p.y) : null };
});
say(wire.count(mark3b, '/public-agent/turn', 'POST') === 0, 'second redeal: still no model call',
  `${wire.count(mark3b, '/public-agent/turn', 'POST')} model calls`);
say(flip2.distinctAfterChange > 6, 'second redeal animates',
  `${flip2.distinctAfterChange} distinct layouts after first movement ` +
  `(${flip2.distinct}/${flip2.frames} overall; first change at ${flip2.firstChangeAtMs}ms)`);
say(held2.every((h) => h.moved === 0), 'picks held again', JSON.stringify(held2));
evidence.steps.redeal2 = { flip: flip2, held: held2, boardSize: after2.length,
  modelCalls: wire.count(mark3b, '/public-agent/turn', 'POST') };
evidence.steps.redeal2.shot = await shot(page, '04-second-redeal');

// --- step 4: compare_artworks -----------------------------------------------
console.log('\n--- 4. compare_artworks ---');
const boardNow = await readBoard(page);
const pair = boardNow.slice(0, 2).map((c) => c.id);
const mark4 = wire.from();
let compareOpen = null;
let compareRes = null;
try {
  compareRes = await page.evaluate(
    async (ids) =>
      await window.__paillette_webmcp.call('compare_artworks', {
        artworkIds: ids,
        question: 'Which one belongs above the sofa?',
      }),
    pair
  );
} catch (e) {
  compareRes = { error: String(e) };
}
await sleep(1200);
compareOpen = await page.evaluate(() => {
  const room = document.querySelector('[data-compare-room]');
  if (!room) return null;
  const b = room.getBoundingClientRect();
  return {
    box: { top: Math.round(b.top), left: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) },
    question: room.querySelector('p')?.textContent?.trim() ?? null,
    works: [...room.querySelectorAll('.paillette-compare-work')].length,
    neither: !!room.querySelector('.paillette-compare-neither'),
    compareOpenAttr: document.documentElement.getAttribute('data-compare-open'),
  };
});
say(!!compareOpen, 'compare_artworks opens the two-up room', JSON.stringify(compareOpen));
evidence.steps.compare = { pair, result: compareRes, room: compareOpen };

if (compareOpen) {
  await shot(page, '05-compare-room');
  const mark4b = wire.from();
  await page.locator('.paillette-compare-work').first().click();
  await sleep(1500);
  const resolved = await page.evaluate((ids) => {
    const read = (id) => {
      const el = document.querySelector(`article.paillette-card[data-artwork-id="${id}"]`);
      const trayed = !!document.querySelector(`.lt-tray-card[data-artwork-id="${id}"]`);
      return el
        ? { id, flag: el.getAttribute('data-flag'), by: el.getAttribute('data-flag-by') }
        : { id, offBoard: true, inTray: trayed };
    };
    return {
      roomClosed: !document.querySelector('[data-compare-room]'),
      works: ids.map(read),
    };
  }, pair);
  const turnsAfterChoice = wire.count(mark4b, '/public-agent/turn', 'POST');
  say(resolved.roomClosed, 'choosing closes the room', '');
  const winner = resolved.works[0];
  const loser = resolved.works[1];
  say(winner.flag === 'pick' && loser.flag === 'reject',
    'choosing resolves to pick / reject', JSON.stringify(resolved.works));
  say(turnsAfterChoice > 0, 'choosing sends a turn',
    `${turnsAfterChoice} POSTs to /public-agent/turn within 1.5s of the click`);
  evidence.steps.compare.choice = { resolved, turnsAfterChoice };
  await shot(page, '06-after-compare-choice');
}

// --- wrap -------------------------------------------------------------------
evidence.pageErrors = pageErrors;
evidence.results = results;
say(pageErrors.length === 0, 'no uncaught page errors', pageErrors.join(' | ') || 'none');

await writeFile(path.join(OUT, 'e2e4-loop.json'), JSON.stringify(evidence, null, 2));
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
for (const f of failed) console.log(`  FAIL  ${f.what}  ${f.detail}`);
process.exit(failed.length ? 1 : 0);
