#!/usr/bin/env node
/**
 * Capture harness for the WebMCP demo's agent beat.
 *
 * Why this exists — headless Chromium cannot perform real speech recognition:
 * there is no microphone, and `webkitSpeechRecognition` either does not exist
 * or immediately errors in a headless context. A *genuine spoken take* must be
 * filmed on a real machine. What this harness reproduces is the post-transcript
 * path — the in-page agent receiving an instruction exactly the way the
 * recogniser's final result would deliver it — and it records the rest of the
 * beat (the tool chain, the approval gate, the finished board) end to end.
 *
 * Two ways to drive that path:
 *   - default: type the instruction into AgentPrompt and submit, as a typed goal.
 *   - --speak: deliver the instruction the way the recogniser would — the words
 *     appear in the input (interim), then a final submit fires — so the captured
 *     footage matches what a spoken run looks like, minus the audio. There is no
 *     real speech recognition here; the flag reproduces the transcript path only.
 *
 * The page must register its tools before the agent can be driven. Headless
 * Chromium has no WebMCP host, so `?webmcp-debug` is appended to install the
 * page's own stub `document.modelContext` (the same flag the page uses to
 * exercise its tools outside a WebMCP-capable browser). If the page still never
 * registers tools, this script exits non-zero with a readable message.
 *
 * Usage:
 *   node scripts/demo/capture.mjs <url> "<instruction>"
 *   node scripts/demo/capture.mjs --speak <url> "<instruction>"
 *
 * Output (default scripts/demo/captures/<timestamp>/):
 *   capture.mp4   — screen recording, 1440x900 @2x
 *   beats.json    — timestamped list of every tool the activity panel showed
 *   steps/        — one screenshot per tool step
 *
 * No new dependencies. playwright-core is resolved from a machine-local npx
 * cache (override with PLAYWRIGHT_CORE); ffmpeg (for webm -> mp4) is from PATH.
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// playwright-core is not a workspace dependency; resolve it from a machine-local
// npx cache (override with PLAYWRIGHT_CORE if yours lives elsewhere).
const PLAYWRIGHT_CORE =
  process.env.PLAYWRIGHT_CORE ??
  '/Users/erniesg/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs';

const { chromium } = await import(PLAYWRIGHT_CORE);

const WIDTH = 1440;
const HEIGHT = 900;
const QUIET_MS = 3000;
const DEADLINE_MS = 180_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const timestamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
};

const usage = () => {
  process.stderr.write(
    'usage: node scripts/demo/capture.mjs [--speak] <url> "<instruction>"\n'
  );
  process.exit(1);
};

/** Adds `name` to a URL's query string without disturbing existing params. */
const withQueryParam = (url, name) => {
  const parsed = new URL(url);
  parsed.searchParams.set(name, '');
  return parsed.toString();
};

/** Reads the tool-call entries the activity panel is currently showing. */
const readEntries = (page) =>
  page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label="Agent activity"]');
    const list = aside?.querySelector('ol');
    if (!list) return [];
    return [...list.children].map((li) => {
      const tool =
        li.querySelector('div code')?.textContent?.trim() ?? '';
      const text = li.textContent ?? '';
      const status = text.includes('running')
        ? 'running'
        : text.includes('cancelled')
          ? 'aborted'
          : text.includes('error')
            ? 'error'
            : 'ok';
      return { tool, status };
    });
  });

const runFfmpeg = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
    );
  });

const main = async () => {
  const argv = process.argv.slice(2);
  let speak = false;
  if (argv[0] === '--speak') {
    speak = true;
    argv.shift();
  }
  const [url, instruction, ...extra] = argv;
  if (!url || !instruction || extra.length > 0) usage();

  const outDir = path.join(__dirname, 'captures', timestamp());
  const stepsDir = path.join(outDir, 'steps');
  await mkdir(stepsDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
    recordVideo: { dir: outDir, size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await context.newPage();

  const t0 = Date.now();
  const beats = [];
  const screenshots = [];

  const log = (message) =>
    process.stderr.write(`[capture] ${message}\n`);

  try {
    const target = withQueryParam(url, 'webmcp-debug');
    log(`opening ${target}`);
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // The stub host installs on ?webmcp-debug, which is what makes
    // `document.modelContext` (and therefore the in-page agent) exist here.
    try {
      await page.waitForFunction(() => Boolean(document.modelContext), {
        timeout: 30_000,
      });
    } catch {
      throw new Error(
        'The page never exposed document.modelContext (is ?webmcp-debug honoured?).'
      );
    }

    // Tools register once the bridge mounts; fail loudly if they never do.
    try {
      await page.waitForFunction(
        async () => {
          if (!window.__paillette_webmcp) return false;
          const tools = await window.__paillette_webmcp.tools();
          return tools.length > 0;
        },
        { timeout: 30_000 }
      );
    } catch {
      throw new Error('The page never registered its WebMCP tools.');
    }

    const input = page.locator('input[aria-label="Ask the agent"]');
    try {
      await input.waitFor({ timeout: 30_000 });
    } catch {
      throw new Error(
        'The page registered its tools but never showed the in-page agent input ' +
          '(input[aria-label="Ask the agent"]). The deployed build may predate ' +
          'the in-page agent.'
      );
    }

    if (speak) {
      // Deliver the transcript the way the recogniser's onresult would: the
      // words land in the input as interim text, then a final submit fires.
      const chunks = instruction.split(/\s+/);
      const interim = [];
      const chunk = Math.max(1, Math.ceil(chunks.length / 3));
      for (let i = 0; i < chunks.length; i += chunk) {
        interim.push(chunks.slice(i, i + chunk).join(' '));
      }
      for (const part of interim) {
        await page.evaluate((value) => {
          const el = document.querySelector(
            'input[aria-label="Ask the agent"]'
          );
          if (!el) return;
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
          )?.set;
          setter?.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, part);
        await sleep(450);
      }
      await input.press('Enter');
      beats.push({
        t: new Date().toISOString(),
        elapsedMs: Date.now() - t0,
        event: 'speak',
        transcript: instruction,
      });
    } else {
      await input.fill(instruction);
      await input.press('Enter');
      beats.push({
        t: new Date().toISOString(),
        elapsedMs: Date.now() - t0,
        event: 'type',
        instruction,
      });
    }

    // Drive + observe until the agent goes quiet or the deadline passes.
    let previous = [];
    let quietSince = null;
    let step = 0;

    while (Date.now() - t0 < DEADLINE_MS) {
      // The approval gate: a mutating tool parks here until a human clicks.
      const approve = page.getByRole('button', { name: /^approve$/i }).first();
      if (await approve.count()) {
        await approve.click({ timeout: 2_000 }).catch(() => {});
        beats.push({
          t: new Date().toISOString(),
          elapsedMs: Date.now() - t0,
          event: 'approve',
        });
      }

      const entries = await readEntries(page);
      const oldestFirst = [...entries].reverse();

      for (let i = 0; i < oldestFirst.length; i += 1) {
        const current = oldestFirst[i];
        const prior = previous[i];
        if (!prior) {
          step += 1;
          const shot = path.join(stepsDir, `step-${step}.png`);
          await page.screenshot({ path: shot }).catch(() => {});
          screenshots.push(`steps/step-${step}.png`);
          beats.push({
            t: new Date().toISOString(),
            elapsedMs: Date.now() - t0,
            event: 'tool',
            tool: current.tool,
            status: current.status,
          });
        } else if (prior.status !== current.status) {
          beats.push({
            t: new Date().toISOString(),
            elapsedMs: Date.now() - t0,
            event: 'tool',
            tool: current.tool,
            status: current.status,
          });
        }
      }
      previous = oldestFirst;

      const running = entries.some((entry) => entry.status === 'running');
      const busy = await input.isDisabled();
      if (!running && !busy && previous.length > 0) {
        quietSince = quietSince ?? Date.now();
        if (Date.now() - quietSince > QUIET_MS) break;
      } else {
        quietSince = null;
      }

      await sleep(250);
    }

    await page.screenshot({
      path: path.join(stepsDir, 'final.png'),
    }).catch(() => {});

    const summary = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label="Agent activity"]');
      return aside?.textContent ?? '';
    });
    log(`final panel:\n${summary}`);
  } finally {
    await context.close();
    await browser.close();
  }

  // Playwright records webm; remux to the mp4 the demo wants.
  const webmFile = (await readdir(outDir)).find((f) => f.endsWith('.webm'));
  const mp4Path = path.join(outDir, 'capture.mp4');
  if (webmFile) {
    const webmPath = path.join(outDir, webmFile);
    await runFfmpeg([
      '-i',
      webmPath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-y',
      mp4Path,
    ]);
    await rename(webmPath, path.join(outDir, 'capture.webm')).catch(() => {});
  }

  const payload = {
    url,
    instruction,
    mode: speak ? 'speak' : 'type',
    startedAt: new Date(t0).toISOString(),
    durationMs: Date.now() - t0,
    toolsFired: beats
      .filter((b) => b.event === 'tool')
      .map((b) => b.tool),
    screenshots,
    beats,
  };
  const beatsPath = path.join(outDir, 'beats.json');
  await writeFile(beatsPath, `${JSON.stringify(payload, null, 2)}\n`);

  log(`mp4   -> ${mp4Path}`);
  log(`beats -> ${beatsPath}`);
};

main().catch((error) => {
  process.stderr.write(`[capture] ${error.message}\n`);
  process.exit(1);
});
