/**
 * Does the money shot fit in the frame?
 *
 * Iteration 2's blocking critique was a measurement, not an opinion: at
 * 1440x900 the wall label sat at y=479 with 0 of 12 cards fully visible, and
 * at the scroll position where all twelve were framed the label was at y=-210
 * and the utterance bar at y=-284. The note and the board it describes could
 * not be photographed together at any scroll position, so the image the whole
 * submission is built around did not exist.
 *
 * This is that measurement, runnable. It seeds the board with ?demo=sofa,
 * presses Enter on the empty bar to deal deterministically, then reports the
 * geometry of the three things that have to share one screen: the agent's
 * sentence, the twelve cards, and the bar you press Enter in.
 *
 *   node scripts/demo/measure-frame.mjs [url]
 *
 * Exits non-zero if they do not all fit, so it can gate a deploy.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrowserDriver } from './browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(HERE, '..', '..', 'docs', 'night', 'shots');

const BASE = process.argv[2] || 'http://localhost:5173';
const URL_UNDER_TEST = `${BASE.replace(/\/$/, '')}/nga/search?demo=sofa`;
const VIEWPORT = { width: 1440, height: 900 };

const box = async (locator) => {
  try {
    if (!(await locator.count())) return null;
    return await locator.first().boundingBox();
  } catch {
    return null;
  }
};

const main = async () => {
  const { chromium } = await resolveBrowserDriver();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });

  // Every model-call route, refused. If any of this needed an agent the run
  // fails here rather than quietly proving the wrong thing.
  let modelCalls = 0;
  await page.route('**/api/public-agent/**', (route) => {
    modelCalls += 1;
    return route.abort();
  });

  await page.goto(URL_UNDER_TEST, { waitUntil: 'domcontentloaded' });

  // The seed's flags are what arm Enter. Wait for them, not for a timer.
  await page.waitForSelector('[data-flag="pick"]', { timeout: 60_000 });
  await page.waitForSelector('[data-flag="reject"]', { timeout: 60_000 });

  const bar = page.locator('.lt-agent-bar textarea, .lt-agent-bar input').first();
  await bar.click();
  await bar.press('Enter');

  await page.waitForSelector('[data-testid="deal-board-grid"]', { timeout: 60_000 });
  await page.waitForTimeout(1200); // let the FLIP settle before measuring

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const note = await box(page.locator('.paillette-wall-label'));
  const grid = await box(page.locator('[data-testid="deal-board-grid"]'));
  const barBox = await box(page.locator('.lt-agent-bar'));

  const cards = await page.locator('[data-testid="deal-board-grid"] .paillette-card').all();
  const cardBoxes = (await Promise.all(cards.map((card) => card.boundingBox())))
    .filter(Boolean);
  const fullyVisible = cardBoxes.filter(
    (b) => b.y >= 0 && b.y + b.height <= VIEWPORT.height
  ).length;

  // The three that have to share one screen.
  const inFrame = (b) => Boolean(b) && b.y >= 0 && b.y + b.height <= VIEWPORT.height;

  const report = {
    url: URL_UNDER_TEST,
    viewport: VIEWPORT,
    modelCallsAttempted: modelCalls,
    noteInFrame: inFrame(note),
    note: note && { y: Math.round(note.y), height: Math.round(note.height) },
    barInFrame: inFrame(barBox),
    bar: barBox && { y: Math.round(barBox.y), height: Math.round(barBox.height) },
    grid: grid && {
      y: Math.round(grid.y),
      height: Math.round(grid.height),
      bottom: Math.round(grid.y + grid.height),
    },
    cards: cardBoxes.length,
    cardsFullyVisible: fullyVisible,
  };

  // How much of its slot each work actually occupies — the "30-60% aligned
  // top-left" the critique measured.
  const fill = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="deal-board-grid"] .paillette-card')];
    return cards.map((card) => {
      const img = card.querySelector('img');
      if (!img) return null;
      const c = card.getBoundingClientRect();
      const i = img.getBoundingClientRect();
      return {
        fill: Math.round(((i.width * i.height) / (c.width * c.height)) * 100),
        // Distance from the image's centre to the slot's centre, horizontally.
        offCentre: Math.round(Math.abs((i.x + i.width / 2) - (c.x + c.width / 2))),
      };
    }).filter(Boolean);
  });
  report.slotFillPercent = fill.map((f) => f.fill);
  report.maxOffCentrePx = Math.max(...fill.map((f) => f.offCentre));

  // Titles: clipped mid-word, or ellipsised?
  report.clippedTitles = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('[data-testid="deal-board-grid"] h2')];
    return titles
      .filter((t) => t.scrollWidth > t.clientWidth + 1)
      .map((t) => ({
        text: t.textContent.slice(0, 46),
        ellipsis: getComputedStyle(t).textOverflow === 'ellipsis',
      }));
  });

  await mkdir(SHOTS, { recursive: true });
  const shot = path.join(SHOTS, 'fix2-01-note-board-and-bar.png');
  await page.screenshot({ path: shot });
  report.screenshot = path.relative(path.resolve(HERE, '..', '..'), shot);

  console.log(JSON.stringify(report, null, 2));

  const failures = [];
  if (!report.noteInFrame) failures.push('the agent note is not fully in frame at scrollY=0');
  if (!report.barInFrame) failures.push('the utterance bar is not fully in frame at scrollY=0');
  if (report.cardsFullyVisible < 12)
    failures.push(`only ${report.cardsFullyVisible}/12 cards fully visible`);
  if (report.modelCallsAttempted > 0)
    failures.push(`${report.modelCallsAttempted} model call(s) attempted — the deal must be deterministic`);
  const badTitles = report.clippedTitles.filter((t) => !t.ellipsis);
  if (badTitles.length) failures.push(`${badTitles.length} title(s) clipped without an ellipsis`);

  await browser.close();

  if (failures.length) {
    console.error('\nFAIL');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.error('\nPASS — note, twelve cards and the bar are all inside 1440x900.');
  }
};

await main();
