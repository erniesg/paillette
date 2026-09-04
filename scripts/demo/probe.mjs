#!/usr/bin/env node
/**
 * A throwaway measuring stick for the fix loop: open a URL, report the numbers
 * the critique measured, and screenshot what it looks like.
 *
 * Not a test — it asserts nothing. It exists so a claim like "twelve cards fit
 * at 1440x900" is checked against a browser rather than against an intention.
 *
 * Usage: node scripts/demo/probe.mjs <url> [outdir]
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const resolveDriver = async () => {
  if (process.env.PLAYWRIGHT_CORE) {
    return await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
  }
  for (const specifier of ['playwright-core', '@playwright/test']) {
    try {
      return await import(specifier);
    } catch {
      /* keep looking */
    }
  }
  const store = path.join(REPO_ROOT, 'node_modules', '.pnpm');
  for (const entry of await readdir(store)) {
    if (!entry.startsWith('playwright-core@')) continue;
    const file = path.join(store, entry, 'node_modules', 'playwright-core', 'index.mjs');
    if (existsSync(file)) return await import(pathToFileURL(file).href);
  }
  throw new Error('no playwright');
};

const { chromium } = await resolveDriver();

const url = process.argv[2];
const outDir = process.argv[3] ?? path.join(__dirname, 'probe');
if (!url) {
  console.error('usage: node scripts/demo/probe.mjs <url> [outdir]');
  process.exit(2);
}
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForTimeout(2500);

const report = await page.evaluate(() => {
  const host = 'modelContext' in document && Boolean(document.modelContext);
  const bar = document.querySelector('input[aria-label="Ask the agent"]');
  const grid = document.querySelector('[data-testid="deal-board-grid"]');
  const tray = document.querySelector('.lt-tray');
  const room = document.querySelector('[data-compare-room]');
  const cards = grid ? [...grid.querySelectorAll('.paillette-card')] : [];
  const fully = cards.filter((card) => {
    const rect = card.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  const rect = (element) => {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      left: Math.round(r.left),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };
  return {
    host,
    debugDriver: Boolean(window.__paillette_webmcp),
    bar: Boolean(bar),
    barPlaceholder: bar?.getAttribute('placeholder') ?? null,
    grid: rect(grid),
    cards: cards.length,
    cardsFullyVisible: fully.length,
    tray: rect(tray),
    trayCards: tray ? tray.querySelectorAll('.lt-tray-card').length : null,
    compareRoom: rect(room),
    noteSwatches: document.querySelectorAll('.lt-note-swatch').length,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
});

const tools = await page
  .evaluate(async () => {
    const context = document.modelContext;
    if (!context?.getTools) return null;
    return (await context.getTools()).map((tool) => tool.name);
  })
  .catch(() => null);

report.tools = tools?.length ?? null;
report.toolNames = tools ?? null;
report.errors = errors;

console.log(JSON.stringify(report, null, 2));
await page.screenshot({ path: path.join(outDir, 'page.png') });
await page.screenshot({ path: path.join(outDir, 'page-full.png'), fullPage: true });
await writeFile(
  path.join(outDir, 'probe.json'),
  `${JSON.stringify(report, null, 2)}\n`
);
await browser.close();
