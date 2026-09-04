/**
 * The two-up, measured rather than described.
 *
 * The brief's step 5 asks for two things: that choosing resolves to a pick and
 * a reject, and that it "sends a turn". Those are separate claims and the code
 * answers them differently — `resolveCompare` (turn.ts:111) sets both flags and
 * then deliberately does *not* fire, on the grounds that flags never trigger
 * the agent. So the honest question is not "did a POST happen" but "does the
 * choice reach the agent, and when". This reads the actual request body of the
 * next turn to find out, instead of counting requests.
 *
 * Also re-checks Escape, which was only fixed in `4e79c6c`, and which is the
 * one exit from the room that is not an answer.
 *
 *   node apps/web/scripts/e2e-compare-probe.mjs <baseUrl> <outDir>
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/e2e6/compare';
const BAR = 'input[aria-label="Ask the agent"]';
const ROOM = '[data-compare-room]';
const SOFA =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';

mkdirSync(`${OUT}/shots`, { recursive: true });
const log = [];
let failed = 0;
const say = (ok, label, detail = '') => {
  if (ok === false) failed += 1;
  const line = `${ok === null ? 'NOTE' : ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`;
  log.push(line);
  console.log(line);
};
const save = (n, v) => writeFileSync(`${OUT}/${n}`, typeof v === 'string' ? v : JSON.stringify(v, null, 2));

const flags = (page) =>
  page.$$eval('.paillette-card', (cards) =>
    Object.fromEntries(cards.map((c) => [
      c.getAttribute('data-artwork-id'),
      { flag: c.getAttribute('data-flag'), by: c.getAttribute('data-flag-by') },
    ])));

const main = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  /** Every model turn, with its body — the payload is the evidence here. */
  const turns = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/public-agent/turn')) {
      let body = null;
      try { body = JSON.parse(r.postData() ?? 'null'); } catch { body = r.postData(); }
      turns.push({ t: Date.now(), body });
    }
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${BASE}/nga/search?webmcp-debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);

  // A real board first, from a typed instruction — the two-up needs works.
  const barEl = await page.$(BAR);
  await barEl.click();
  await page.keyboard.type(SOFA, { delay: 8 });
  await page.keyboard.press('Enter');
  for (let i = 0; i < 120 && (await page.$$('.paillette-card')).length < 4; i += 1) {
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);
  await page.mouse.move(5, 5);

  const ids = await page.$$eval('.paillette-card', (c) =>
    c.map((x) => x.getAttribute('data-artwork-id')).slice(0, 2));
  say(ids.length === 2, 'a real board is on the table to compare from', ids.join(' vs '));
  if (ids.length < 2) { await browser.close(); process.exit(1); }

  // ---------------------------------------------------------- Escape first
  await page.evaluate((pair) => window.__paillette_webmcp.call('compare_artworks', {
    artworkIds: pair, question: 'Which one sits better above a sofa?',
  }), ids);
  await page.waitForTimeout(1500);
  const escOpened = Boolean(await page.$(ROOM));
  await page.screenshot({ path: `${OUT}/shots/c1-two-up-open.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  const escStillOpen = Boolean(await page.$(ROOM));
  const flagsAfterEsc = await flags(page);
  say(escOpened && !escStillOpen, 'Escape leaves the two-up without answering it',
    `opened=${escOpened} open after Escape=${escStillOpen}`);
  say(ids.every((id) => (flagsAfterEsc[id]?.flag ?? 'none') === 'none'),
    'Escape flags nothing', JSON.stringify(ids.map((id) => flagsAfterEsc[id])));

  // ------------------------------------------------- open it again and choose
  await page.evaluate((pair) => window.__paillette_webmcp.call('compare_artworks', {
    artworkIds: pair, question: 'Which one sits better above a sofa?',
  }), ids);
  await page.waitForTimeout(1500);

  const room = await page.evaluate(() => {
    const r = document.querySelector('[data-compare-room]');
    if (!r) return null;
    const rect = r.getBoundingClientRect();
    return {
      question: r.querySelector('p')?.textContent?.trim() ?? null,
      askedBy: r.getAttribute('data-asked-by'),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      works: [...r.querySelectorAll('button[data-side]')].map((b) => ({
        side: b.getAttribute('data-side'),
        id: b.getAttribute('data-artwork-id'),
        label: b.getAttribute('aria-label'),
      })),
      otherControls: [...r.querySelectorAll('button:not([data-side])')].map((b) => b.textContent.trim()),
      // §7.3 — "nothing else on screen"
      rootAttr: document.documentElement.getAttribute('data-compare-open')
        ?? document.body.getAttribute('data-compare-open'),
    };
  });
  save('room.json', room);
  say(Boolean(room) && room.works.length === 2, 'compare_artworks opens the two-up as a room',
    JSON.stringify(room?.rect) + ` question="${room?.question}" askedBy=${room?.askedBy}`);
  await page.screenshot({ path: `${OUT}/shots/c2-two-up-room.png` });

  const turnsBefore = turns.length;
  const winner = room.works[0].id;
  const loser = room.works[1].id;
  await page.click(`${ROOM} button[data-side="${room.works[0].side}"]`);
  await page.waitForTimeout(2500);

  const closed = !(await page.$(ROOM));
  say(closed, 'choosing closes the room');
  const f = await flags(page);
  say(f[winner]?.flag === 'pick' && f[loser]?.flag === 'reject',
    'step 5 — the winner resolves to a pick and the loser to a reject',
    `${winner}=${f[winner]?.flag}/${f[winner]?.by}  ${loser}=${f[loser]?.flag}/${f[loser]?.by}`);
  await page.screenshot({ path: `${OUT}/shots/c3-after-choice.png` });

  const firedOnClick = turns.length - turnsBefore;
  say(null, 'the click itself fires no model turn',
    `${firedOnClick} POST /api/public-agent/turn on the click (turn.ts:111 says so on purpose)`);

  // ------------------------------ does the choice reach the agent at all?
  const barEl2 = await page.$(BAR);
  await barEl2.click();
  await page.keyboard.type('Go on from that.', { delay: 8 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(20_000);

  const carried = turns.slice(turnsBefore);
  save('turn-bodies.json', carried);
  const withChoice = carried.filter((t) => JSON.stringify(t.body ?? {}).includes('compareChoice')
    && JSON.stringify(t.body ?? {}).includes(winner));
  const payload = JSON.stringify(carried[0]?.body ?? {});
  say(withChoice.length > 0,
    'step 5 — the choice reaches the agent on the next turn, as compareChoice',
    payload.length > 900 ? payload.slice(0, 900) + '…' : payload);

  say(errors.length === 0, 'no uncaught page errors', errors.join(' | ').slice(0, 300));
  save('log.txt', log.join('\n') + `\n\n${failed} failed\n`);
  await context.close();
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
};

main().catch((e) => { console.error(e); save('log.txt', log.join('\n') + `\nCRASH ${e.stack}`); process.exit(2); });
