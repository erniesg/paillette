/**
 * Headless capture of the activity glyph and its log, so the states can be
 * judged without running the app.
 *
 * Usage:
 *   pnpm --filter web dev --port 5222 --strictPort     # one shell
 *   node apps/web/scripts/capture-activity-shots.mjs [baseUrl] [outDir]
 *
 * What is real here and what is not, because it matters for what the shots can
 * be used to claim:
 *
 * - The page is the real `/nga/search`, the tools are the real tools registered
 *   on `document.modelContext`, and every call is made the way a host makes it,
 *   through `window.__paillette_webmcp.call`. The glyph and the log are reacting
 *   to genuine tool traffic.
 * - The **transport** is stubbed. A dev server has no bearer token for the
 *   public-search API, so the endpoints answer from a fixture. These shots
 *   therefore prove nothing about retrieval quality — the ranking is the
 *   fixture's order.
 * - The latency is stubbed too, deliberately: a call that returns in 4ms cannot
 *   be photographed mid-animation. The endpoints are held open so the running
 *   state lasts long enough to shoot. The animation is not slowed down; only
 *   the network is.
 *
 * Two kinds of work cannot be held open at all, because neither `flag_artworks`
 * nor `get_view_context` touches the network — they are page-local and settle
 * in about a millisecond. Their motion is captured on the contact sheet instead,
 * from the frame table read out of `activity-glyph.ts`. To keep that sheet
 * honest the script cross-checks it: every frame it actually observes on the
 * live glyph must appear in the parsed table, or it exits non-zero.
 */

import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const baseUrl = process.argv[2] ?? 'http://localhost:5222';
const outDir = process.argv[3] ?? 'docs/night/shots/activity';

const VIEWPORT = { width: 1440, height: 940 };
/** The glyph lives in the bottom-left corner; this is the close-up. */
const GLYPH_CLIP = { x: 0, y: VIEWPORT.height - 60, width: 320, height: 60 };

let failures = 0;
const check = (label, ok) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures += 1;
};

/**
 * Read the frame tables out of the source rather than restating them here, so
 * the contact sheet cannot drift away from what the component actually plays.
 */
async function parseFrameTable() {
  const source = await readFile(
    new URL('../app/lib/webmcp/activity-glyph.ts', import.meta.url),
    'utf8'
  );
  const body = source.slice(source.indexOf('GLYPH_ANIMATIONS'));
  const kinds = {};
  const blockPattern =
    /(\w+): \{\s*ms: (\d+),\s*frames: \[([^\]]*)\],?\s*\}/g;
  let match;
  while ((match = blockPattern.exec(body))) {
    const [, kind, ms, list] = match;
    const frames = [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    if (frames.length) kinds[kind] = { ms: Number(ms), frames };
  }
  const stills = {};
  const stillBody = source.slice(source.indexOf('GLYPH_STILLS'));
  for (const m of stillBody
    .slice(0, stillBody.indexOf('};'))
    .matchAll(/(\w+): '([^']*)'/g)) {
    stills[m[1]] = m[2];
  }
  return { kinds, stills };
}

async function loadFixtureWorks() {
  const source = await readFile(
    new URL('../app/lib/board/demo-works.ts', import.meta.url),
    'utf8'
  );
  const works = [];
  for (const block of source.split('  {\n').slice(1)) {
    const field = (name) =>
      block.match(new RegExp(`${name}:\\s*\\n?\\s*'([^']*)'`))?.[1] ?? '';
    const id = field('id');
    if (!id) continue;
    works.push({
      id,
      galleryId: 'nga',
      title: field('title'),
      artist: field('artist'),
      imageUrl: field('imageUrl'),
      thumbnailUrl: field('thumbnailUrl'),
      similarity: 0.92 - works.length * 0.01,
      metadata: {
        accessionNumber: field('accession'),
        classification: 'Painting',
        medium: 'oil on canvas',
      },
    });
  }
  return works;
}

/**
 * Watch the live glyph and collect the distinct frames it paints. This is what
 * makes the contact sheet evidence rather than a transcription.
 */
async function observeFrames(page, ms = 1400, every = 35) {
  return page.evaluate(
    ([duration, interval]) =>
      new Promise((resolve) => {
        const seen = [];
        const tick = () => {
          const node = document.querySelector('.pa-activity-cells');
          const text = node?.textContent ?? '';
          if (text && !seen.includes(text)) seen.push(text);
        };
        tick();
        const timer = window.setInterval(tick, interval);
        window.setTimeout(() => {
          window.clearInterval(timer);
          resolve(seen);
        }, duration);
      }),
    [ms, every]
  );
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const { kinds, stills } = await parseFrameTable();
  console.log(
    `frame table: ${Object.keys(kinds).join(', ')} (${Object.values(kinds).reduce((n, k) => n + k.frames.length, 0)} frames)`
  );
  const works = await loadFixtureWorks();

  const browser = await chromium.launch();

  /** Latency the stubbed endpoints answer with. Raised to hold a call open. */
  let hold = 0;

  const makeContext = async (reducedMotion) => {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
    });

    await context.route(
      (url) =>
        url.pathname.includes('/api/public-search/') ||
        url.pathname.includes('/api/public-describe'),
      async (route) => {
        if (hold) await new Promise((resolve) => setTimeout(resolve, hold));
        const leaf = new URL(route.request().url()).pathname.split('/').pop();

        /*
         * Honour `excludeIds` even though this is a stub. The real engine does,
         * and a stub that hands the same twelve works back on every redeal puts
         * a work on the board twice — which React then reports as a duplicate
         * key. That would be a capture artefact reading as a product bug.
         */
        let sent;
        try {
          sent = JSON.parse(route.request().postData() ?? '{}');
        } catch {
          sent = {};
        }
        const blocked = new Set([
          ...(sent.excludeIds ?? []),
          ...(sent.positiveIds ?? []),
          ...(sent.negativeIds ?? []),
        ]);
        const available = works.filter((work) => !blocked.has(work.id));

        const body =
          leaf === 'quota'
            ? { success: true, data: { remaining: 998, limit: 1000 } }
            : leaf === 'public-describe'
              ? {
                  success: true,
                  data: {
                    caption:
                      'A low grey horizon under a bank of cloud, with two boats at anchor.',
                  },
                }
              : {
                  success: true,
                  data: {
                    results: available.slice(0, 12),
                    count: Math.min(12, available.length),
                    queryTime: 118,
                  },
                };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      }
    );

    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') {
        console.log(`  ! ${message.text().slice(0, 140)}`);
      }
    });
    await page.goto(`${baseUrl}/nga/search?q=estuary&webmcp-debug`, {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(() => Boolean(window.__paillette_webmcp));
    await page.waitForTimeout(2500);
    return { context, page };
  };

  const shoot = async (page, name, { clip } = {}) => {
    await page.screenshot({
      path: path.join(outDir, name),
      ...(clip ? { clip: GLYPH_CLIP } : {}),
    });
    console.log(`  → ${name}`);
  };

  /** Start a tool call without awaiting it, so the running state can be shot. */
  const start = (page, tool, input) =>
    page.evaluate(
      ([name, args]) => {
        window.__pa_pending = window.__paillette_webmcp
          .call(name, args)
          .then((result) => {
            window.__pa_last = result;
            return result;
          })
          .catch((error) => {
            window.__pa_last = { threw: String(error) };
          });
        return true;
      },
      [tool, input]
    );

  const { context, page } = await makeContext(false);

  // ── idle ───────────────────────────────────────────────────────────────────
  console.log('\nidle');
  await shoot(page, '01-idle-page.png');
  await shoot(page, '01b-idle-glyph.png', { clip: true });
  check(
    'the glyph rests on the dotted field',
    (await page.textContent('.pa-activity-cells')) === '·····'
  );
  check(
    'no panel is open and no label says what it is',
    (await page.locator('.pa-activity-log').count()) === 0 &&
      !(await page.evaluate(() =>
        document.body.innerText.includes('Agent activity')
      ))
  );

  // ── the tool surface, before anything has run ──────────────────────────────
  console.log('\nthe tool surface');
  await page.click('.pa-activity-glyph');
  await page.waitForTimeout(200);
  await shoot(page, '02-log-tool-surface.png');
  const listed = await page.locator('.pa-activity-surface li').count();
  check(`the log lists the registered tools (${listed})`, listed >= 21);
  await page.click('.pa-activity-glyph');
  await page.waitForTimeout(200);

  // A human pick, made through the page's own control, so `redeal` has a
  // direction to deal in. Without it the tool correctly refuses and there is
  // nothing running to photograph.
  const firstCard = await page.getAttribute('.paillette-card', 'data-artwork-id');
  await page
    .locator('.paillette-flag-button[data-flag-action="pick"]')
    .first()
    .click();
  await page.waitForTimeout(300);
  check('a work is picked, so a redeal has somewhere to go', Boolean(firstCard));

  // ── the motions that can be held open ──────────────────────────────────────
  const live = [
    { kind: 'scan', tool: 'search_artworks', input: { query: 'estuary at dusk' } },
    {
      kind: 'look',
      tool: 'describe_artwork',
      input: { artwork: firstCard },
    },
    { kind: 'deal', tool: 'redeal', input: { count: 12 } },
  ];

  const observed = {};
  for (const { kind, tool, input } of live) {
    console.log(`\n${kind} — ${tool}`);
    hold = 6_000;
    await start(page, tool, input);
    await page.waitForTimeout(250);

    const phase = await page.getAttribute('.pa-activity-cells', 'data-phase');
    const shown = await page.getAttribute('.pa-activity-cells', 'data-kind');
    check(`the glyph is running as "${kind}"`, phase === 'running' && shown === kind);

    for (let frame = 1; frame <= 3; frame += 1) {
      await shoot(page, `03-${kind}-${frame}.png`, { clip: true });
      await page.waitForTimeout(kinds[kind] ? kinds[kind].ms : 130);
    }
    if (kind === 'scan') await shoot(page, '03-scan-page.png');

    observed[kind] = await observeFrames(page);
    check(
      `it paints more than one frame (${observed[kind].length} distinct)`,
      observed[kind].length > 1
    );
    check(
      'every frame it painted is in the table the contact sheet uses',
      observed[kind].every((f) => kinds[kind]?.frames.includes(f))
    );

    hold = 0;
    await page.evaluate(() => window.__pa_pending);
    await page.waitForTimeout(700);
  }

  // ── settle ─────────────────────────────────────────────────────────────────
  console.log('\nsettle');
  await shoot(page, '04-settled-glyph.png', { clip: true });
  check(
    'it settles back to the field',
    (await page.getAttribute('.pa-activity-cells', 'data-phase')) === 'idle'
  );

  // ── build, held open by the consent gate rather than by the network ────────
  console.log('\nbuild — create_collection, parked on consent');
  await start(page, 'create_collection', { name: 'Storm-lit seascapes' });
  await page.waitForTimeout(400);
  check(
    'the glyph is running as "build"',
    (await page.getAttribute('.pa-activity-cells', 'data-kind')) === 'build'
  );
  check(
    'a question the human must answer opens the log by itself',
    (await page.locator('.pa-activity-ask').count()) === 1
  );
  await shoot(page, '05-consent-gate.png');
  await shoot(page, '05b-build-glyph.png', { clip: true });
  observed.build = await observeFrames(page);
  check(
    'every build frame is in the table',
    observed.build.length > 1 &&
      observed.build.every((f) => kinds.build.frames.includes(f))
  );
  await page.click('.pa-activity-ask button:not([data-approve])');
  await page.waitForTimeout(500);

  // ── failure ────────────────────────────────────────────────────────────────
  console.log('\nfailure');
  await page.evaluate(() =>
    window.__paillette_webmcp
      .call('flag_artworks', {
        flags: [{ artworkId: 'no-such-work', flag: 'pick', reason: 'test' }],
      })
      .catch(() => {})
  );
  await page.waitForTimeout(400);
  check(
    'a tool that refused without throwing rests as a failure',
    (await page.getAttribute('.pa-activity-cells', 'data-phase')) === 'failed'
  );
  await shoot(page, '06-failed-glyph.png', { clip: true });

  // ── the log, after a burst ─────────────────────────────────────────────────
  console.log('\nthe log');
  for (const [tool, input] of [
    ['get_view_context', {}],
    ['search_artworks', { query: 'warm, not busy, nothing grim' }],
    ['search_by_color', { color: 'amber' }],
    ['set_view', { view: 'salon' }],
    ['redeal', { count: 12, note: 'Warmer, and quieter.' }],
  ]) {
    await page.evaluate(
      ([name, args]) =>
        window.__paillette_webmcp.call(name, args).catch(() => {}),
      [tool, input]
    );
    await page.waitForTimeout(180);
  }
  if ((await page.locator('.pa-activity-log').count()) === 0) {
    await page.click('.pa-activity-glyph');
  }
  await page.waitForTimeout(300);
  await shoot(page, '07-log-open.png');
  const rowCount = await page.locator('.pa-activity-row').count();
  check(`the log holds the session (${rowCount} calls)`, rowCount >= 6);
  check(
    'a failure is drawn as a failure',
    (await page.locator('.pa-activity-row[data-bad="true"]').count()) >= 1
  );
  await page
    .locator('.pa-activity-log')
    .screenshot({ path: path.join(outDir, '07b-log-detail.png') });
  console.log('  → 07b-log-detail.png');

  // ── one row expanded onto the payload ──────────────────────────────────────
  const searchRow = page
    .locator('.pa-activity-row[data-tool="search_artworks"]')
    .first();
  await searchRow.click();
  await page.waitForTimeout(250);
  check(
    'a row expands onto the arguments and the result',
    (await page.locator('.pa-activity-detail').count()) >= 1
  );
  await page
    .locator('.pa-activity-log')
    .screenshot({ path: path.join(outDir, '08-log-row-expanded.png') });
  console.log('  → 08-log-row-expanded.png');
  await shoot(page, '08b-log-row-expanded-page.png');

  // ── history survives a collapse ────────────────────────────────────────────
  await page.click('.pa-activity-glyph');
  await page.waitForTimeout(200);
  check(
    'closing it hides it',
    (await page.locator('.pa-activity-log').count()) === 0
  );
  await page.click('.pa-activity-glyph');
  await page.waitForTimeout(200);
  check(
    'reopening it still holds the whole session',
    (await page.locator('.pa-activity-row').count()) === rowCount
  );

  // ── the contact sheet ──────────────────────────────────────────────────────
  console.log('\ncontact sheet');
  await page.click('.pa-activity-glyph');
  await page.waitForTimeout(200);
  await page.evaluate(
    ([table, stillTable]) => {
      const host = document.createElement('div');
      host.id = 'pa-sheet';
      host.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:200',
        'background:var(--lt-ground,#1a1a1d)',
        'padding:34px 40px',
        'font-family:"IBM Plex Mono",ui-monospace,monospace',
        'overflow:auto',
      ].join(';');
      const rows = Object.entries(table)
        .map(([kind, spec]) => {
          const cells = spec.frames
            .map(
              (frame) =>
                `<span style="color:var(--ink-agent,#5ec8d8);text-shadow:0 0 6px var(--ink-agent-soft),0 0 16px var(--ink-agent-wash);white-space:pre;letter-spacing:0.08em">${frame}</span>`
            )
            .join(
              '<span style="color:var(--ink-human-faint,#8a8880);padding:0 9px">·</span>'
            );
          return `<tr>
            <td style="color:var(--ink-human,#e6e3dc);padding:11px 22px 11px 0;vertical-align:middle">${kind}</td>
            <td style="padding:11px 22px 11px 0;font-size:15px;vertical-align:middle">${cells}</td>
            <td style="color:var(--ink-human-faint,#8a8880);padding:11px 22px 11px 0;vertical-align:middle">${spec.ms}ms</td>
            <td style="color:var(--ink-agent,#5ec8d8);font-size:15px;white-space:pre;letter-spacing:0.08em;padding:11px 0;vertical-align:middle">${stillTable[kind]}</td>
          </tr>`;
        })
        .join('');
      host.innerHTML = `
        <table style="border-collapse:collapse;font-size:12px">
          <tr style="color:var(--ink-human-faint,#8a8880);font-size:10.5px;letter-spacing:0.12em;text-transform:uppercase">
            <td style="padding:0 22px 12px 0">kind</td>
            <td style="padding:0 22px 12px 0">frames</td>
            <td style="padding:0 22px 12px 0">pace</td>
            <td style="padding:0 0 12px 0">reduced motion</td>
          </tr>
          ${rows}
        </table>`;
      document.body.appendChild(host);
    },
    [kinds, stills]
  );
  await page.waitForTimeout(300);
  await page.locator('#pa-sheet table').screenshot({
    path: path.join(outDir, '09-frames-contact-sheet.png'),
  });
  console.log('  → 09-frames-contact-sheet.png');
  await page.evaluate(() => document.getElementById('pa-sheet')?.remove());

  // ── the light theme, where every token flips ───────────────────────────────
  console.log('\nlight theme');
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.colorScheme = 'light';
  });
  await page.click('.pa-activity-glyph');
  await page.waitForTimeout(400);
  const inkOnPaper = await page.evaluate(() => {
    const name = document.querySelector('.pa-activity-name');
    const bad = document.querySelector('.pa-activity-out[data-bad="true"]');
    return {
      name: name && getComputedStyle(name).color,
      bad: bad && getComputedStyle(bad).color,
    };
  });
  check(
    'the agent ink and the failure tone are different values on paper',
    Boolean(inkOnPaper.name) &&
      Boolean(inkOnPaper.bad) &&
      inkOnPaper.name !== inkOnPaper.bad
  );
  await page
    .locator('.pa-activity-log')
    .screenshot({ path: path.join(outDir, '11-log-light-theme.png') });
  console.log(`  → 11-log-light-theme.png  (${inkOnPaper.name} / ${inkOnPaper.bad})`);
  await shoot(page, '11b-light-theme-page.png');

  // ── a session longer than the log can hold ─────────────────────────────────
  console.log('\ntruncation');
  await page.evaluate(async () => {
    for (let index = 0; index < 125; index += 1) {
      await window.__paillette_webmcp.call('get_view_context', {}).catch(() => null);
    }
  });
  await page.waitForTimeout(400);
  if ((await page.locator('.pa-activity-log').count()) === 0) {
    await page.click('.pa-activity-glyph');
  }
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const scroll = document.querySelector('.pa-activity-scroll');
    if (scroll) scroll.scrollTop = 0;
  });
  await page.waitForTimeout(200);
  const earlier = (
    await page.locator('.pa-activity-earlier').textContent()
  )?.trim();
  check(
    'a truncated log says how much it dropped',
    /^…\s\d+\searlier$/.test(earlier ?? ''),
    earlier
  );
  await page
    .locator('.pa-activity-log')
    .screenshot({ path: path.join(outDir, '13-log-truncated.png') });
  console.log('  → 13-log-truncated.png');

  await context.close();

  // ── a browser with no WebMCP at all ────────────────────────────────────────
  console.log('\nno host');
  const bare = await browser.newContext({ viewport: VIEWPORT });
  const barePage = await bare.newPage();
  await barePage.route(
    (url) => url.pathname.includes('/api/public-search/'),
    async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { results: works.slice(0, 12), count: 12, queryTime: 100 },
        }),
      })
  );
  await barePage.goto(`${baseUrl}/nga/search?q=estuary`, {
    waitUntil: 'networkidle',
  });
  await barePage.waitForTimeout(2500);
  check(
    'no glyph, no panel, nothing at all without a host',
    (await barePage.locator('.pa-activity').count()) === 0
  );
  await barePage.screenshot({
    path: path.join(outDir, '12-no-host.png'),
    clip: GLYPH_CLIP,
  });
  console.log('  → 12-no-host.png');
  await bare.close();

  // ── reduced motion ─────────────────────────────────────────────────────────
  console.log('\nprefers-reduced-motion');
  const reduced = await makeContext(true);
  const reducedCard = await reduced.page.getAttribute(
    '.paillette-card',
    'data-artwork-id'
  );
  await reduced.page
    .locator('.paillette-flag-button[data-flag-action="pick"]')
    .first()
    .click();
  await reduced.page.waitForTimeout(300);

  const stillShots = [];
  for (const [kind, tool, input] of [
    ['scan', 'search_artworks', { query: 'estuary at dusk' }],
    ['look', 'describe_artwork', { artwork: reducedCard }],
    ['deal', 'redeal', { count: 12 }],
  ]) {
    hold = 4_000;
    await start(reduced.page, tool, input);
    await reduced.page.waitForTimeout(300);
    const before = await reduced.page.textContent('.pa-activity-cells');
    await reduced.page.waitForTimeout(1_200);
    const after = await reduced.page.textContent('.pa-activity-cells');
    check(`${kind}: the mark does not move`, before === after);
    check(`${kind}: it is the still for its kind`, after === stills[kind]);
    stillShots.push(after);
    await shoot(reduced.page, `10-reduced-${kind}.png`, { clip: true });
    hold = 0;
    await reduced.page.evaluate(() => window.__pa_pending);
    await reduced.page.waitForTimeout(500);
  }
  check(
    'the three stills are distinguishable from one another',
    new Set(stillShots).size === stillShots.length
  );
  await shoot(reduced.page, '10-reduced-idle.png', { clip: true });
  await reduced.context.close();

  await browser.close();

  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
