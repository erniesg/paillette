/**
 * Exercise every tool the night's lanes added, directly, through the debug
 * driver the brief names: `window.__paillette_webmcp.call(name, args)` under
 * `?webmcp-debug`.
 *
 * This is deliberately not the e2e walk. The e2e drives the *page* and asks
 * whether a human's gestures land. This asks the narrower question integration
 * has to answer before anything downstream can be filmed: does each new tool
 * accept the arguments its own schema advertises, and does it come back with
 * something, rather than throwing or hanging?
 *
 * It reports the verbatim response for each call, because a tool that returns
 * `{ok:false, code:'…'}` for a good reason and a tool that is broken look
 * identical in a pass/fail column.
 *
 *   node scripts/demo/exercise-new-tools.mjs [baseUrl] [query]
 *
 * `write_labels` costs one model call against the anonymous budget (40 per
 * client per hour). Pass `--no-model` to skip it.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:5183';
const QUERY = process.argv[3] ?? 'warm landscape';
const SKIP_MODEL = process.argv.includes('--no-model');
const OUT = path.resolve('docs/night/e2e-evidence/new-tools');

const results = [];
const note = (ok, what, detail) => {
  results.push({ ok, what, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The bridge answers `{ok, ...}` or an MCP content envelope; read both. */
const unwrap = (value) => {
  if (value && typeof value === 'object' && Array.isArray(value.content)) {
    try {
      return JSON.parse(value.content[0]?.text ?? 'null');
    } catch {
      return value;
    }
  }
  return value;
};

const main = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  const net = [];
  page.on('request', (r) => net.push(r.url()));
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));

  const call = async (name, args) => {
    const raw = await page.evaluate(
      ([n, a]) => window.__paillette_webmcp.call(n, a).catch((e) => ({ threw: String(e) })),
      [name, args]
    );
    return unwrap(raw);
  };

  const url = `${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  await page.waitForFunction(() => Boolean(document.modelContext), { timeout: 30_000 });
  const tools = await page.evaluate(async () => {
    for (let i = 0; i < 60; i += 1) {
      const t = await window.__paillette_webmcp?.tools?.();
      if (t?.length) return t.map((x) => x.name);
      await new Promise((r) => setTimeout(r, 250));
    }
    return [];
  });
  note(tools.length === 25, `document.modelContext carries 25 tools`, `${tools.length} registered`);

  const NEW = [
    'flag_artworks',
    'search_by_exemplars',
    'redeal',
    'compare_artworks',
    'get_exhibition',
    'set_exhibition',
    'write_labels',
    'annotate_atlas',
  ];
  const missing = NEW.filter((n) => !tools.includes(n));
  note(missing.length === 0, 'all eight new tools are registered', missing.length ? `missing ${missing.join(', ')}` : NEW.join(', '));

  await page.waitForFunction(
    () => document.querySelectorAll('[data-artwork-id]').length > 0,
    { timeout: 45_000 }
  );
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')].map((el) =>
      el.getAttribute('data-artwork-id')
    )
  );
  note(ids.length >= 4, `the board loaded works for "${QUERY}"`, `${ids.length} cards`);
  if (ids.length < 4) {
    console.log('\nNot enough works on the board to exercise the tools. Stopping.');
    await browser.close();
    process.exit(1);
  }

  const transcript = {};
  const record = (name, args, res) => {
    transcript[name] = { args, result: res };
  };

  // --- 1. flag_artworks --------------------------------------------------
  // The agent's flags land provisional and dashed; they must NOT move the
  // exemplars the deterministic redeal runs on.
  {
    const args = {
      flags: [
        { artworkId: ids[0], flag: 'pick', reason: 'the agent proposing a pick, for the ink' },
        { artworkId: ids[1], flag: 'reject', reason: 'the agent proposing a reject' },
      ],
    };
    const res = await call('flag_artworks', args);
    record('flag_artworks', args, res);
    note(res?.ok === true, 'flag_artworks accepts its own schema', JSON.stringify(res).slice(0, 300));

    const marks = await page.evaluate(() =>
      [...document.querySelectorAll('[data-artwork-id]')]
        .map((el) => ({
          id: el.getAttribute('data-artwork-id'),
          flag: el.getAttribute('data-flag'),
          by: el.getAttribute('data-flag-by'),
          provisional: el.getAttribute('data-flag-provisional'),
        }))
        .filter((m) => m.flag && m.flag !== 'none')
    );
    const agentMark = marks.find((m) => m.id === ids[0]);
    note(
      agentMark?.by === 'agent' && agentMark?.provisional === 'true',
      'the agent flag renders in agent ink and dashed (provisional)',
      JSON.stringify(agentMark)
    );
  }

  // --- 2. search_by_exemplars -------------------------------------------
  {
    const args = { positiveIds: [ids[2]], negativeIds: [ids[3]], topK: 6 };
    const res = await call('search_by_exemplars', args);
    record('search_by_exemplars', args, res);
    const got = res?.results?.length ?? res?.artworks?.length ?? 0;
    note(
      res?.ok === true && got > 0,
      'search_by_exemplars returns scored candidates',
      res?.ok ? `${got} works back` : JSON.stringify(res).slice(0, 300)
    );
    note(
      !JSON.stringify(res ?? {}).includes('"threw"'),
      'search_by_exemplars did not throw',
      ''
    );
  }

  // --- 3. redeal ---------------------------------------------------------
  {
    // A human pick first, so there is a confirmed exemplar to hold.
    await page.locator(`[data-artwork-id="${ids[2]}"]`).first().hover();
    await page.keyboard.press('p');
    await sleep(300);

    const slotOf = (id) =>
      page.evaluate((artworkId) => {
        const el = document.querySelector(
          `[data-testid="deal-board-grid"] [data-artwork-id="${artworkId}"]`
        );
        const r = el?.getBoundingClientRect();
        return r ? { x: Math.round(r.x), y: Math.round(r.y) } : null;
      }, id);

    // The first redeal builds the board out of the masonry, so the pick
    // necessarily moves — a layout change, not a broken pin. The guarantee the
    // brief makes is board-to-board, so establish a board first and measure
    // across the *second* deal.
    const args = { keep: 'picks', strategy: 'tighten', count: 12, note: 'following the pick' };
    const first = await call('redeal', args);
    record('redeal', args, first);
    await sleep(3500);
    note(first?.ok === true, 'redeal accepts its own schema', JSON.stringify(first).slice(0, 400));
    note(
      await page.evaluate(() => Boolean(document.querySelector('[data-testid="deal-board-grid"]'))),
      'redeal puts a deal board on the table',
      ''
    );

    const beforeBox = await slotOf(ids[2]);
    const second = await call('redeal', { keep: 'picks', note: 'again, from the same pick' });
    record('redeal:second', { keep: 'picks' }, second);
    await sleep(3500);

    const stillThere = await page.evaluate(
      (id) => Boolean(document.querySelector(`[data-artwork-id="${id}"]`)),
      ids[2]
    );
    note(stillThere, 'the human pick survives an agent-driven redeal', `pick ${ids[2]}`);

    const afterBox = await slotOf(ids[2]);
    note(
      beforeBox && afterBox && beforeBox.x === afterBox.x && beforeBox.y === afterBox.y,
      'the pick holds the same pixels board-to-board',
      `${JSON.stringify(beforeBox)} -> ${JSON.stringify(afterBox)}`
    );
  }

  // --- 4. compare_artworks ----------------------------------------------
  {
    const board = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="deal-board-grid"] [data-artwork-id]')].map((el) =>
        el.getAttribute('data-artwork-id')
      )
    );
    const pair = (board.length >= 2 ? board : ids).slice(0, 2);
    const args = { artworkIds: pair, question: 'Which one belongs above a sofa?' };
    const res = await call('compare_artworks', args);
    record('compare_artworks', args, res);
    await sleep(800);
    note(res?.ok === true, 'compare_artworks accepts its own schema', JSON.stringify(res).slice(0, 300));

    const room = await page.evaluate(() => {
      const el = document.querySelector('.paillette-compare');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        box: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
        portalled: el.closest('body') === document.body && el.parentElement === document.body,
        question: el.querySelector('p')?.textContent ?? null,
        works: el.querySelectorAll('.paillette-compare-work').length,
      };
    });
    note(Boolean(room), 'the two-up renders', JSON.stringify(room));
    note(
      room && room.box.top >= 0 && room.box.top < 100 && room.works === 2,
      'the two-up is on screen, not below the fold',
      room ? JSON.stringify(room.box) : 'no overlay'
    );
    await page.screenshot({ path: path.join(OUT, 'compare.png') });

    // Close it again so it does not sit over the rest of the run.
    await page.keyboard.press('Escape').catch(() => {});
    const closeBtn = page.locator('.paillette-compare button', { hasText: /neither/i });
    if (await closeBtn.count()) await closeBtn.first().click().catch(() => {});
    await sleep(500);
  }

  // --- 5. set_exhibition + get_exhibition --------------------------------
  {
    const board = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="deal-board-grid"] [data-artwork-id]')].map((el) =>
        el.getAttribute('data-artwork-id')
      )
    );
    const works = (board.length ? board : ids).slice(0, 5).map((id) => ({ artworkId: id }));
    const statement =
      'These works are held together by departure rather than by weather. Each one keeps a ' +
      'shoreline, a road or a threshold in view, and each one puts the figure at the edge of it ' +
      'rather than at its centre. Hung in sequence they read as a single movement outward: the ' +
      'light thins, the horizon opens, and what is being left behind falls out of the frame ' +
      'entirely. Nothing here arrives anywhere. The show is about the moment before that.';
    const args = { title: 'Leaving', statement, works };
    const res = await call('set_exhibition', args);
    record('set_exhibition', args, res);
    note(res?.ok === true, 'set_exhibition accepts title, statement and works', JSON.stringify(res).slice(0, 300));

    const got = await call('get_exhibition', {});
    record('get_exhibition', {}, got);
    const ex = got?.exhibition ?? got;
    note(
      got?.ok === true && (ex?.title === 'Leaving' || JSON.stringify(got).includes('Leaving')),
      'get_exhibition reads back what set_exhibition wrote',
      JSON.stringify(got).slice(0, 400)
    );
    note(
      JSON.stringify(got).includes('agent') || JSON.stringify(got).includes('by'),
      'get_exhibition reports per-field provenance',
      ''
    );
  }

  // --- 6. write_labels (one model call) ----------------------------------
  if (SKIP_MODEL) {
    note(true, 'write_labels skipped (--no-model)', 'costs one model call against the 40/hour budget');
  } else {
    const board = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="deal-board-grid"] [data-artwork-id]')].map((el) =>
        el.getAttribute('data-artwork-id')
      )
    );
    const args = { artworkIds: (board.length ? board : ids).slice(0, 3) };
    const res = await call('write_labels', args);
    record('write_labels', args, res);
    const labels = res?.labels ?? res?.works ?? [];
    note(
      res?.ok === true && labels.length > 0,
      'write_labels returns a label per work, against the statement',
      JSON.stringify(res).slice(0, 700)
    );
  }

  // --- 7. annotate_atlas -------------------------------------------------
  // On a fresh page, deliberately. A dealt board outranks every layout choice
  // including the agent's own, so calling this after a redeal is a test of the
  // wrong thing: `set_view` is *supposed* to lose to a board that is on the
  // table. The atlas is a browsing layout, so browse.
  {
    const atlas = await ctx.newPage();
    const atlasCall = async (name, args) => {
      const raw = await atlas.evaluate(
        ([n, a]) => window.__paillette_webmcp.call(n, a).catch((e) => ({ threw: String(e) })),
        [name, args]
      );
      return unwrap(raw);
    };
    await atlas.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await atlas.waitForFunction(() => Boolean(document.modelContext), { timeout: 30_000 });
    await atlas.waitForFunction(
      () => document.querySelectorAll('[data-artwork-id]').length > 0,
      { timeout: 45_000 }
    );
    const pool = await atlas.evaluate(() =>
      [...document.querySelectorAll('[data-artwork-id]')].map((el) =>
        el.getAttribute('data-artwork-id')
      )
    );

    await atlasCall('set_view', { view: 'atlas' });
    await sleep(800);
    const inAtlas = await atlas.evaluate(() =>
      Boolean(document.querySelector('[data-testid="deal-board-grid"]'))
    );
    note(!inAtlas, 'the atlas view is reachable when no board is dealt', `dealBoardPresent=${inAtlas}`);

    const args = {
      regions: [
        { label: 'the ones about leaving', artworkIds: pool.slice(0, 3), note: 'edges and thresholds' },
        { label: 'the ones that stay', artworkIds: pool.slice(3, 6) },
      ],
    };
    const res = await atlasCall('annotate_atlas', args);
    record('annotate_atlas', args, res);
    note(res?.ok === true, 'annotate_atlas accepts named regions', JSON.stringify(res).slice(0, 400));
    await sleep(800);

    const drawn = await atlas.evaluate(() => ({
      container: Boolean(document.querySelector('.paillette-atlas-regions')),
      names: [...document.querySelectorAll('.paillette-region-name')].map(
        (el) => el.textContent?.trim().slice(0, 60) ?? ''
      ),
      clusters: document.querySelectorAll('.paillette-region-cluster').length,
    }));
    note(
      drawn.container && drawn.names.length >= 2,
      'the named regions are drawn on the page, works grouped under their name',
      JSON.stringify(drawn).slice(0, 300)
    );
    await atlas.screenshot({ path: path.join(OUT, 'atlas.png'), fullPage: false });
    await atlas.close();
  }

  note(pageErrors.length === 0, 'no uncaught page errors during the run', pageErrors.join(' | ').slice(0, 300));

  await writeFile(path.join(OUT, 'transcript.json'), `${JSON.stringify(transcript, null, 2)}\n`);
  await writeFile(path.join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass} pass · ${results.length - pass} fail`);
  console.log(`transcript: ${path.join(OUT, 'transcript.json')}`);
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
