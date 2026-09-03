#!/usr/bin/env node
/**
 * Checks the demo path against §9 of the brief, headlessly, and prints what is
 * true rather than what was intended.
 *
 * The submission may only claim what a run of this reports as `pass`. Anything
 * a lane has not landed yet comes back `skip` with the reason, never `pass`.
 *
 * Two rules it exists to enforce, both of which are easy to lose by accident:
 *
 *  - **Text first.** Every check runs with `SpeechRecognition` deleted from the
 *    window before the page loads. If any beat needs a microphone, it fails
 *    here rather than on camera.
 *  - **No LLM in the deterministic loop.** Requests to the agent endpoint are
 *    counted, so "redeal with no model call" is a measurement, not a claim.
 *
 * Usage:
 *   node scripts/demo/verify-demo-path.mjs [url] [--head] [--json <path>]
 *
 * Default url is http://localhost:5183/nga/search. Exits non-zero if any check
 * fails; skips do not fail the run.
 */

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Find a browser driver without hardcoding anyone's machine.
 *
 * `@playwright/test` is already a devDependency of `apps/web`, and pnpm's strict
 * layout means it only resolves from inside that package — not from `scripts/`
 * and not from the workspace root. So anchor the lookup there and let it chain
 * to playwright-core. `PLAYWRIGHT_CORE` remains an override for a checkout that
 * keeps it somewhere else.
 */
const resolveDriver = () => {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;

  const anchors = [
    path.join(__dirname, '..', '..', 'apps', 'web', 'package.json'),
    path.join(process.cwd(), 'apps', 'web', 'package.json'),
    fileURLToPath(import.meta.url),
  ];

  for (const anchor of anchors) {
    for (const spec of ['playwright-core', 'playwright', '@playwright/test']) {
      try {
        const entry = createRequire(anchor).resolve(spec);
        // The umbrella packages re-export chromium; core is preferred when the
        // chain exposes it, because it is the smaller surface.
        try {
          return createRequire(entry).resolve('playwright-core');
        } catch {
          return entry;
        }
      } catch {
        /* try the next specifier */
      }
    }
  }

  throw new Error(
    'No Playwright found. `pnpm install` in apps/web, or set PLAYWRIGHT_CORE.'
  );
};

const loadChromium = async () => {
  const mod = await import(resolveDriver());
  const chromium = mod.chromium ?? mod.default?.chromium;
  if (!chromium) throw new Error('Playwright resolved but exposes no chromium.');
  return chromium;
};

const AGENT_ENDPOINT = '/api/public-agent/turn';
const AGENT_INPUT = 'input[aria-label="Ask the agent"]';

const results = [];
const record = (id, status, detail) => {
  results.push({ id, status, detail });
  const mark = { pass: 'PASS', fail: 'FAIL', skip: 'skip' }[status];
  process.stdout.write(`${mark}  ${id.padEnd(26)}  ${detail}\n`);
};

const check = async (id, fn) => {
  try {
    const outcome = await fn();
    if (outcome && outcome.skip) return record(id, 'skip', outcome.skip);
    record(id, 'pass', outcome?.detail ?? 'ok');
  } catch (error) {
    record(id, 'fail', error instanceof Error ? error.message : String(error));
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

/**
 * Waits for the tool surface to stop changing, not merely to become non-empty.
 * Two identical reads a beat apart is enough to step over a remount.
 */
const waitForSettledTools = async (page, { timeout = 30_000 } = {}) => {
  const read = () =>
    page.evaluate(async () =>
      window.__paillette_webmcp
        ? (await window.__paillette_webmcp.tools()).map((tool) => tool.name)
        : []
    );

  const deadline = Date.now() + timeout;
  let previous = null;
  while (Date.now() < deadline) {
    const current = await read();
    const key = current.join(',');
    if (current.length > 0 && key === previous) return current;
    previous = key;
    await page.waitForTimeout(300);
  }
  return read();
};

/**
 * An id the page has actually loaded, so flag/compare checks exercise the real
 * path rather than the refusal path. Returns null when nothing is on screen —
 * which is the honest answer wherever search needs credentials this run does
 * not have.
 */
const firstLoadedArtworkId = async (callTool) => {
  const outcome = await callTool('get_view_context');
  const view = outcome.value?.data ?? outcome.value ?? {};
  const candidates = [
    ...(view.board?.order ?? []),
    ...(view.humanResults?.visible ?? []).map((work) => work?.id),
    ...(view.agentResults?.visible ?? []).map((work) => work?.id),
  ];
  return candidates.find((id) => typeof id === 'string' && id.length > 0) ?? null;
};

const countPanelEntries = (page) =>
  page.evaluate(
    () =>
      document.querySelectorAll('aside[aria-label="Agent activity"] ol > li')
        .length
  );

const withDebugParam = (url) => {
  const parsed = new URL(url);
  parsed.searchParams.set('webmcp-debug', '');
  return parsed.toString();
};

const main = async () => {
  const argv = process.argv.slice(2);
  const headed = argv.includes('--head');
  const jsonIndex = argv.indexOf('--json');
  const jsonPath =
    jsonIndex >= 0 ? argv[jsonIndex + 1] : path.join(__dirname, 'verify.json');
  const url =
    argv.find((arg) => arg.startsWith('http')) ??
    'http://localhost:5183/nga/search';

  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  // Text first: the page must never see a recogniser. Anything that needs one
  // breaks here, in the dark, rather than during a take.
  await context.addInitScript(() => {
    delete window.webkitSpeechRecognition;
    delete window.SpeechRecognition;
  });

  const page = await context.newPage();

  let agentTurnCount = 0;
  page.on('request', (request) => {
    if (request.url().includes(AGENT_ENDPOINT)) agentTurnCount += 1;
  });

  const callTool = (name, args = {}) =>
    page.evaluate(
      async ([toolName, toolArgs]) => {
        try {
          return {
            ok: true,
            value: await window.__paillette_webmcp.call(toolName, toolArgs),
          };
        } catch (error) {
          return { ok: false, error: String(error?.message ?? error) };
        }
      },
      [name, args]
    );

  const toolNames = async () =>
    page.evaluate(async () =>
      (await window.__paillette_webmcp.tools()).map((tool) => tool.name)
    );

  const target = withDebugParam(url);
  process.stdout.write(`\n${target}\n\n`);

  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  let registered = [];

  await check('host.installs', async () => {
    await page.waitForFunction(() => Boolean(document.modelContext), {
      timeout: 30_000,
    });
    const stubbed = await page.evaluate(
      () => window.__paillette_webmcp?.stubbed
    );
    return { detail: `document.modelContext present, stubbed=${stubbed}` };
  });

  await check('tools.register', async () => {
    // Settled, not merely non-empty. React's development remount unregisters
    // and re-registers the whole surface, so there is a real window in which
    // `getTools()` returns nothing; a driver that samples once can catch it and
    // conclude the page has no tools.
    registered = await waitForSettledTools(page);
    assert(registered.length > 0, 'no tools registered');
    return { detail: `${registered.length} tools, stable` };
  });

  await check('tools.noDuplicates', async () => {
    const seen = new Set(registered);
    assert(
      seen.size === registered.length,
      `duplicate names: ${registered.length - seen.size}`
    );
    return { detail: 'every name unique' };
  });

  await check('agent.rendersHeadless', async () => {
    // Regression guard. The in-page agent decides whether to render by reading
    // document.modelContext in a mount effect; if the host is installed later
    // than that effect runs, it latches off and no headless take is possible.
    await page.locator(AGENT_INPUT).waitFor({ timeout: 20_000 });
    return { detail: 'agent input present under ?webmcp-debug' };
  });

  await check('agent.noMicWithoutSpeech', async () => {
    const mic = await page.getByRole('button', { name: /speak your request/i }).count();
    assert(mic === 0, `mic button rendered with no SpeechRecognition (${mic})`);
    const input = await page.locator(AGENT_INPUT).count();
    assert(input === 1, 'agent input missing when speech is unavailable');
    return { detail: 'no mic, input still there' };
  });

  await check('context.readable', async () => {
    const outcome = await callTool('get_view_context');
    assert(outcome.ok, `get_view_context failed: ${outcome.error}`);
    const keys = Object.keys(outcome.value?.data ?? outcome.value ?? {});
    assert(keys.length > 0, 'get_view_context returned nothing');
    return { detail: `keys: ${keys.slice(0, 6).join(', ')}` };
  });

  await check('context.reportsFlags', async () => {
    if (!registered.includes('flag_artworks')) {
      return { skip: 'flag_artworks not registered on this build' };
    }
    const outcome = await callTool('get_view_context');
    const payload = outcome.value?.data ?? outcome.value ?? {};
    assert('flags' in payload, 'get_view_context has no `flags` key');
    return { detail: '`flags` present' };
  });

  await check('flags.rejectsStaleId', async () => {
    if (!registered.includes('flag_artworks')) {
      return { skip: 'flag_artworks not registered on this build' };
    }
    // Ids go stale between boards and sessions. Flagging one the page never
    // loaded must be a refusal the agent can read, not a silent no-op.
    const outcome = await callTool('flag_artworks', {
      flags: [{ artworkId: 'verify-probe-not-a-real-id', flag: 'pick' }],
    });
    const body = outcome.value ?? {};
    assert(body.ok === false, 'flagging an unloaded id was accepted');
    assert(
      typeof body.error?.code === 'string' && body.error.code.length > 0,
      'refusal carries no error code'
    );
    return { detail: body.error.code };
  });
  await check('resilience.unknownId', async () => {
    // Ids go stale between sessions and boards. A tool handed one must say so,
    // not throw something opaque or wedge the page.
    const outcome = await callTool('show_artwork', {
      artworkId: 'definitely-not-a-real-id',
    });
    const message = outcome.ok
      ? JSON.stringify(outcome.value)
      : outcome.error ?? '';
    assert(message.length > 0, 'no response at all for an unresolvable id');
    assert(
      !/undefined|\[object Object\]|TypeError/.test(message),
      `unreadable failure for a stale id: ${message.slice(0, 160)}`
    );
    const alive = await page.evaluate(() => Boolean(document.body));
    assert(alive, 'page died on an unresolvable id');
    return { detail: `handled: ${message.slice(0, 60)}` };
  });

  await check('resilience.badArgs', async () => {
    const outcome = await callTool('search_artworks', { topK: 'not-a-number' });
    const message = outcome.ok
      ? JSON.stringify(outcome.value)
      : outcome.error ?? '';
    assert(
      !/TypeError|Cannot read prop/.test(message),
      `crashed rather than rejected: ${message.slice(0, 160)}`
    );
    return { detail: 'rejected without throwing internals' };
  });

  // Tool calls this script made itself are already in the panel. Only growth
  // past this mark can be credited to the agent.
  const panelEntriesBeforeTurn = await countPanelEntries(page);
  let typedTurnFired = false;

  await check('agent.typedTriggerFires', async () => {
    // The whole loop, by typing, with no recogniser in the page at all.
    const before = agentTurnCount;
    const input = page.locator(AGENT_INPUT);
    await input.fill('something warm for above the sofa', { timeout: 15_000 });
    await input.press('Enter');
    await page.waitForTimeout(5_000);
    assert(
      agentTurnCount > before,
      'typing an instruction and pressing Enter sent no turn'
    );
    typedTurnFired = true;
    return { detail: `${agentTurnCount - before} turn(s) from typed input` };
  });

  await check('agent.toolsExecuteFromTypedTurn', async () => {
    if (!typedTurnFired) {
      return { skip: 'no typed turn was sent, so nothing to attribute' };
    }
    const grew = await page
      .waitForFunction(
        (baseline) =>
          document.querySelectorAll('aside[aria-label="Agent activity"] ol > li')
            .length > baseline,
        panelEntriesBeforeTurn,
        { timeout: 45_000 }
      )
      .then(() => true)
      .catch(() => false);
    assert(
      grew,
      `no new tool call in 45s (panel still at ${panelEntriesBeforeTurn} from this script's own probes)`
    );
    const after = await countPanelEntries(page);
    return {
      detail: `${after - panelEntriesBeforeTurn} tool call(s) attributable to the typed turn`,
    };
  });
  await check('flags.roundTrip', async () => {
    if (!registered.includes('flag_artworks')) {
      return { skip: 'flag_artworks not registered on this build' };
    }
    const id = await firstLoadedArtworkId(callTool);
    if (!id) {
      return {
        skip: 'no artwork loaded into this session (search needs credentials here)',
      };
    }
    const flagged = await callTool('flag_artworks', {
      flags: [{ artworkId: id, flag: 'pick', reason: 'probe' }],
    });
    assert(flagged.value?.ok !== false, `flag_artworks refused: ${JSON.stringify(flagged.value?.error)}`);
    const after = await callTool('get_view_context');
    const picks = (after.value?.data ?? after.value ?? {}).flags?.picks ?? [];
    assert(
      picks.some((pick) => pick.id === id),
      'the flag did not come back out of get_view_context'
    );
    return { detail: `${id} read back as a pick` };
  });
  await check('redeal.noModelCall', async () => {
    if (!registered.includes('redeal')) {
      return { skip: 'redeal not registered on this build' };
    }
    const before = agentTurnCount;
    const outcome = await callTool('redeal', {});
    // A redeal with an empty board is allowed to decline; what must never
    // happen is a model call.
    const after = agentTurnCount;
    assert(
      after === before,
      `redeal made ${after - before} request(s) to ${AGENT_ENDPOINT}`
    );
    return {
      detail: `0 model calls (redeal ${outcome.ok ? 'ran' : 'declined cleanly'})`,
    };
  });
  await check('panel.rendersActivity', async () => {
    const aside = await page
      .locator('aside[aria-label="Agent activity"]')
      .count();
    assert(aside === 1, 'activity panel absent after tools ran');
    return { detail: 'panel present once something happened' };
  });

  const shotDir = path.join(__dirname, 'verify-shots');
  await mkdir(shotDir, { recursive: true });
  await page
    .screenshot({ path: path.join(shotDir, 'final.png'), fullPage: false })
    .catch(() => {});

  await context.close();
  await browser.close();

  const summary = {
    url: target,
    speechRecognition: 'removed before load',
    agentTurns: agentTurnCount,
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    skip: results.filter((r) => r.status === 'skip').length,
    results,
  };
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);

  process.stdout.write(
    `\n${summary.pass} pass · ${summary.fail} fail · ${summary.skip} skip` +
      `  ·  ${agentTurnCount} model turn(s)\n${jsonPath}\n`
  );
  process.exit(summary.fail > 0 ? 1 : 0);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
