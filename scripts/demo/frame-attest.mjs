/**
 * Shoot the frame, then prove what is in it.
 *
 * The evidence defect, twice running: a report named a screenshot and described
 * contents that file does not have. Iteration 4 found it of `e2e-report` §1 and
 * `integration` §5; the sentence was rewritten to name a different file and was
 * still false of that file. Both times the frame had been *chosen* by measuring
 * one element and then *described* from memory.
 *
 * So the description is not written by hand here. This script sweeps for a
 * scroll position where both inks and a whole board are inside one 1440×900
 * viewport, screenshots it, and then reads the pixels back out of the saved PNG
 * to attest what the file contains — the human's sentence, the agent's
 * sentence, the two rules beside them sampled as actual RGB, and a census of
 * every other word in the frame. The attestation is written next to the shot,
 * and the report quotes it rather than paraphrasing it.
 *
 * The pixel read is the part that matters. Measuring the DOM proves the page
 * was in the right state; only sampling the file proves the file is.
 *
 *   node scripts/demo/frame-attest.mjs <base-url> <out-dir>
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/frame-attest';
const QUERY = process.env.FRAME_QUERY ?? 'storms at sea';
const SAID =
  'I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.';

await mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => process.stdout.write(`${line}\n`);

const waitForQuiet = async (page, deadlineMs = 210_000) => {
  const bar = page.locator('input[aria-label="Ask the agent"]');
  const started = Date.now();
  await page
    .waitForFunction(
      () =>
        document.querySelector('input[aria-label="Ask the agent"]')?.disabled ===
        true,
      { timeout: 25_000 }
    )
    .catch(() => {});
  let quiet = null;
  while (Date.now() - started < deadlineMs) {
    const busy = await bar.isDisabled().catch(() => false);
    if (!busy) {
      quiet = quiet ?? Date.now();
      if (Date.now() - quiet > 3500) return Date.now() - started;
    } else {
      quiet = null;
    }
    await sleep(250);
  }
  return -1;
};

/**
 * How much of what the frame is supposed to show is inside the viewport at the
 * current scroll position.
 *
 * "Whole cards" means whole: a frame of twelve half-cards is the thing every
 * previous attempt at this shot produced, and it is why the sentence describing
 * it kept drifting from the file.
 */
const scoreViewport = (page) =>
  page.evaluate(() => {
    const height = window.innerHeight;
    const inside = (el) => {
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return {
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        left: Math.round(box.left),
        whole: box.top >= 0 && box.bottom <= height,
        // What the page says the rule is, so the sample taken out of the PNG
        // has something to be checked against that is not a constant typed
        // into this script from memory.
        rule: getComputedStyle(el).borderLeftColor,
      };
    };
    const human = [
      ...document.querySelectorAll(
        'section[aria-label="Ask the agent"] [data-provenance="human"]'
      ),
    ].at(-1);
    const note = document.querySelector('.paillette-wall-label');
    const cards = [
      ...document.querySelectorAll('[data-testid="deal-board-grid"] [data-artwork-id]'),
    ];
    const wholeCards = cards.filter((el) => {
      const box = el.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= height;
    }).length;
    return {
      scrollY: Math.round(window.scrollY),
      // Whose marks are on the cards in the frame. §7.2 is a claim about a
      // screenshot, so it belongs in the attestation of one rather than in a
      // sentence someone wrote after looking at it.
      marks: {
        human: cards.filter((el) => el.getAttribute('data-flag-by') === 'human')
          .length,
        agent: cards.filter((el) => el.getAttribute('data-flag-by') === 'agent')
          .length,
      },
      human: inside(human),
      humanText: human?.textContent?.trim() ?? null,
      note: inside(note),
      noteText: note?.textContent?.trim() ?? null,
      noteProvenance: note?.getAttribute('data-provenance') ?? null,
      cards: cards.length,
      wholeCards,
    };
  });

/**
 * Every word in the frame that is not artwork data and not either sentence.
 *
 * §5b's argument is about density, and the last measurement of it — 48 words,
 * 23 of them in one band — is what the chrome fold was built against. Counted
 * the same way here so the two numbers can be put side by side.
 */
const chromeCensus = (page) =>
  page.evaluate(() => {
    const height = window.innerHeight;
    const width = window.innerWidth;
    const words = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      const text = node.textContent?.trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el) continue;
      if (el.closest('[data-artwork-id]')) continue;
      if (el.closest('[data-board-note]')) continue;
      if (el.closest('section[aria-label="Ask the agent"] ol')) continue;
      // Off-screen text is not chrome. `sr-only` clips to a 1px box on
      // purpose, and counting it as a visible word is the same class of
      // mistake as describing a screenshot from memory — the first draft of
      // this script counted the screen-reader sentence under the bar and
      // reported it as prose on screen, which it is not.
      if (el.closest('[aria-hidden="true"]')) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (Number(style.opacity) === 0) continue;
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      if (box.bottom <= 0 || box.top >= height) continue;
      if (box.right <= 0 || box.left >= width) continue;
      words.push(text);
    }
    const colours = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const box = el.getBoundingClientRect();
      if (box.bottom <= 0 || box.top >= height || box.width === 0) continue;
      if (!el.textContent?.trim()) continue;
      colours.add(getComputedStyle(el).color);
    }
    return {
      strings: words,
      words: words.join(' ').split(/\s+/).filter(Boolean).length,
      textColours: [...colours].length,
    };
  });

/**
 * Read the saved file back and sample it.
 *
 * Decoded in a blank page's canvas rather than with an image library, so the
 * bytes on disk are what is measured and nothing in this repo is trusted to
 * have written them correctly.
 */
const samplePng = async (browser, file, points) => {
  const bytes = await readFile(file);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('about:blank');
  const sampled = await page.evaluate(
    async ([dataUrl, spots]) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = dataUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const hex = (n) => n.toString(16).padStart(2, '0');
      return {
        size: { width: canvas.width, height: canvas.height },
        points: spots.map((spot) => {
          // A 3px column centred on the rule: sub-pixel placement can put a
          // 1px border between two device pixels, and the neighbour is the
          // background rather than a different ink.
          let best = null;
          for (let dx = -1; dx <= 1; dx += 1) {
            const [r, g, b] = ctx.getImageData(spot.x + dx, spot.y, 1, 1).data;
            const luminance = r + g + b;
            if (!best || luminance > best.luminance) {
              best = { luminance, hex: `#${hex(r)}${hex(g)}${hex(b)}` };
            }
          }
          return { name: spot.name, x: spot.x, y: spot.y, hex: best.hex };
        }),
      };
    },
    [`data:image/png;base64,${bytes.toString('base64')}`, points]
  );
  await context.close();
  return sampled;
};

const main = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/nga/search?q=${encodeURIComponent(QUERY)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-artwork-id]').length > 0,
    { timeout: 60_000 }
  );
  await sleep(1500);

  // Flag by hand, deal by hand, then say something. Both inks have to have
  // been *earned* in the frame: a note the harness wrote is not evidence.
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')]
      .map((el) => el.getAttribute('data-artwork-id'))
      .slice(0, 3)
  );
  for (const [index, id] of ids.entries()) {
    await page.evaluate(() => document.activeElement?.blur?.());
    const card = page.locator(`[data-artwork-id="${id}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.keyboard.press(index === 2 ? 'p' : 'x');
    await sleep(300);
  }
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('Enter');
  await sleep(4000);

  const bar = page.locator('input[aria-label="Ask the agent"]');
  await bar.click();
  await bar.fill(SAID);
  await bar.press('Enter');
  const quietMs = await waitForQuiet(page);
  await sleep(2000);

  // --- the sweep -------------------------------------------------------
  const sweep = [];
  let best = null;
  const documentHeight = await page.evaluate(
    () => document.documentElement.scrollHeight
  );
  for (let y = 0; y <= Math.max(0, documentHeight - 900); y += 20) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await sleep(120);
    const shot = await scoreViewport(page);
    sweep.push(shot);
    if (!shot.human?.whole || !shot.note?.whole) continue;
    if (!best || shot.wholeCards > best.wholeCards) best = shot;
  }

  const attestation = { base: BASE, quietMs, sweep, best };

  if (best) {
    await page.evaluate((top) => window.scrollTo(0, top), best.scrollY);
    await sleep(400);
    const file = path.join(OUT, 'two-inks.png');
    await page.screenshot({ path: file });

    const rects = await scoreViewport(page);
    const chrome = await chromeCensus(page);
    // The 1px rule down the left of each sentence: a solid run of the ink,
    // where the glyphs themselves are anti-aliased and would sample muddy.
    const sampled = await samplePng(browser, file, [
      {
        name: 'human rule',
        x: rects.human.left,
        y: Math.round((rects.human.top + rects.human.bottom) / 2),
      },
      {
        name: 'agent rule',
        x: rects.note.left,
        y: Math.round((rects.note.top + rects.note.bottom) / 2),
      },
    ]);
    attestation.frame = {
      file,
      scrollY: best.scrollY,
      viewport: { width: 1440, height: 900 },
      humanText: rects.humanText,
      noteText: rects.noteText,
      noteProvenance: rects.noteProvenance,
      wholeCards: rects.wholeCards,
      cardsOnBoard: rects.cards,
      marks: rects.marks,
      png: sampled.size,
      inkSamples: sampled.points.map((point) => ({
        ...point,
        cssRule: point.name.startsWith('human')
          ? rects.human.rule
          : rects.note.rule,
      })),
      chrome,
    };
  }

  await writeFile(
    path.join(OUT, 'frame.json'),
    `${JSON.stringify(attestation, null, 2)}\n`
  );
  await context.close();
  await browser.close();

  if (!attestation.frame) {
    log('no scroll position held both inks whole — nothing to name in a report');
    process.exitCode = 1;
    return;
  }
  const { frame } = attestation;
  log(`\nframe ${frame.file} at scrollY ${frame.scrollY}, ${frame.png.width}×${frame.png.height}`);
  log(`  human: "${frame.humanText}"`);
  log(`  agent (${frame.noteProvenance}): "${frame.noteText}"`);
  log(`  whole cards in frame: ${frame.wholeCards} of ${frame.cardsOnBoard}`);
  log(
    `  marks on those cards: ${frame.marks.human} human, ${frame.marks.agent} agent`
  );
  for (const point of frame.inkSamples) {
    log(`  sampled ${point.name} at ${point.x},${point.y}: ${point.hex}`);
  }
  log(`  other words in frame: ${frame.chrome.words} — ${frame.chrome.strings.join(' · ')}`);
  log(`  distinct text colours in frame: ${frame.chrome.textColours}`);
};

await main();
