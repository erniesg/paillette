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
 * No new dependencies. The browser driver is found in the workspace, the pnpm
 * store or an npx cache, in that order (override with PLAYWRIGHT_CORE, which
 * must point at an index.mjs); ffmpeg (for webm -> mp4) is from PATH.
 */

import { spawn } from 'node:child_process';
import { readdir as readdirSync } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Find a browser driver, on whichever machine this is.
 *
 * This used to be one hardcoded path into one person's npx cache, so the
 * script ran on exactly one laptop and nowhere else — including the VM the
 * footage is captured on, where it failed at the first import with a
 * `Cannot find package` and no video was ever produced.
 *
 * Order: an explicit override, the workspace's own dependency, whatever pnpm
 * put in the store, then the npx caches. `~/.cache/ms-playwright` is where the
 * *browsers* live rather than the library, and is Playwright's own default, so
 * it is honoured by leaving `PLAYWRIGHT_BROWSERS_PATH` alone unless someone
 * has set it.
 */
const findFirstMatch = async (root, matches) => {
  if (!existsSync(root)) return null;
  let entries;
  try {
    entries = await readdirSync(root);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const candidate = matches(path.join(root, entry));
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
};

const resolveBrowserDriver = async () => {
  const tried = [];

  const explicit = process.env.PLAYWRIGHT_CORE;
  if (explicit) {
    tried.push(explicit);
    if (existsSync(explicit)) return await import(pathToFileURL(explicit).href);
    // An override that points at nothing is a typo, not a reason to guess.
    throw new Error(`PLAYWRIGHT_CORE is set but does not exist: ${explicit}`);
  }

  for (const specifier of ['playwright-core', '@playwright/test', 'playwright']) {
    tried.push(specifier);
    try {
      return await import(specifier);
    } catch {
      // Not installed here; keep looking.
    }
  }

  const stores = [
    // pnpm's virtual store, which is where this workspace's copy actually is.
    await findFirstMatch(path.join(REPO_ROOT, 'node_modules', '.pnpm'), (dir) =>
      path.basename(dir).startsWith('playwright-core@')
        ? path.join(dir, 'node_modules', 'playwright-core', 'index.mjs')
        : null
    ),
    // npx, where a `npx playwright` run leaves it.
    await findFirstMatch(path.join(homedir(), '.npm', '_npx'), (dir) =>
      path.join(dir, 'node_modules', 'playwright-core', 'index.mjs')
    ),
  ].filter(Boolean);

  for (const store of stores) {
    tried.push(store);
    return await import(pathToFileURL(store).href);
  }

  throw new Error(
    `Could not find playwright-core. Tried:\n  ${tried.join('\n  ')}\n` +
      'Set PLAYWRIGHT_CORE to its index.mjs, or run `pnpm add -D playwright-core`.'
  );
};

const { chromium } = await resolveBrowserDriver();

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

/**
 * Reads the tool-call entries the activity panel is showing.
 *
 * This used to look for `aside[aria-label="Agent activity"] ol` and find
 * nothing, ever, for two reasons: the panel is a `div.pa-activity` whose log
 * is a `section`, and — the one that matters — the log is **closed at rest by
 * design** and nothing the agent does opens it. So the harness read a shut
 * drawer and wrote `toolsFired: []` under a take in which the tools had all
 * fired. Each row carries its own `data-tool` and `data-status`, which is a
 * contract rather than a guess at where the text sits.
 */
const readEntries = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.pa-activity-list [data-tool]')]
      .map((row) => ({
        id: row.getAttribute('data-activity-id') ?? '',
        tool: row.getAttribute('data-tool') ?? '',
        status: row.getAttribute('data-status') ?? 'ok',
      }))
      // Newest first on screen; oldest first is the order things happened in.
      .reverse()
  );

/**
 * Open the log, once.
 *
 * Not a workaround for the reader above — it is the shot. §7.4's answer to
 * "how was WebMCP implemented" is a judge watching the real tools fire against
 * the page, and that is only on camera if the drawer is open. It stays a
 * click, made here rather than by the page, because a panel that opens itself
 * is the chat this design deliberately is not.
 */
const openActivityLog = async (page) => {
  const glyph = page.locator('button[aria-label="Agent activity"]');
  if ((await glyph.count()) === 0) return false;
  if ((await glyph.getAttribute('aria-expanded')) === 'true') return true;
  await glyph.click();
  await page.waitForSelector('.pa-activity-log', { timeout: 5000 }).catch(() => {});
  return true;
};

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
      // A recogniser's interim results are cumulative: each one is the whole
      // sentence heard so far, not the newest fragment. This wrote each chunk
      // over the last, so an 88-character instruction arrived as its final 29
      // characters and the agent silently answered a third of the sentence —
      // one baffling take and no explanation for it. Send the running total.
      const words = instruction.split(/\s+/);
      const chunk = Math.max(1, Math.ceil(words.length / 3));
      const growing = [];
      for (let i = 0; i < words.length; i += chunk) {
        growing.push(words.slice(0, Math.min(i + chunk, words.length)).join(' '));
      }
      for (const heardSoFar of growing) {
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
        }, heardSoFar);
        await sleep(450);
      }

      // The field has to hold the whole sentence before Enter, whatever the
      // page did with the interim events. Checked rather than assumed: this
      // is the exact failure the loop above used to have.
      const delivered = await input.inputValue();
      if (delivered.trim() !== instruction.trim()) {
        throw new Error(
          `--speak delivered a truncated instruction.\n  wanted: ${instruction}\n  got:    ${delivered}`
        );
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

    // Open the log before the loop starts, so the tools are on camera from the
    // first call rather than revealed after the fact.
    await openActivityLog(page);

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

      // Matched by id, not by position. The list reorders while calls are in
      // flight, so positional matching reported `list_collections` four times
      // for one call — a beats.json that overstates what happened is worse
      // than the empty one it replaced.
      const seen = new Map(previous.map((entry) => [entry.id, entry]));
      for (const current of entries) {
        const prior = seen.get(current.id);
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
      previous = entries;

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

    const summary = await page.evaluate(
      () =>
        document.querySelector('.pa-activity-log')?.textContent?.trim() ?? ''
    );
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
