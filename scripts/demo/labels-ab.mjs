#!/usr/bin/env node
/**
 * The one experiment that settles whether a wall label is contextual.
 *
 * §5c: *"the same painting in an exhibition about weather and one about grief
 * gets a different label. If the label reads the same regardless of the
 * statement, the feature is fake."* The code says so in five comments and the
 * unit tests all stub the model, so the strongest thing they can show is that
 * the statement reached the outbound HTTP body. That is transport, not
 * contextuality.
 *
 * So: the same six works, twice, under two genuinely different statements,
 * against the live model on a deployed build. Both sets of labels are written
 * out verbatim, whatever they say. If they come back the same, that is the
 * answer and the feature should be cut rather than filmed.
 *
 *   node scripts/demo/labels-ab.mjs <base-url> <out-dir>
 *
 * Costs two write_labels calls (one model call each).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from './browser.mjs';

const BASE = process.argv[2] ?? 'https://paillette-stg.berlayar.ai';
const OUT = process.argv[3] ?? '/tmp/labels-ab';
const QUERY = process.env.AB_QUERY ?? 'sunset landscape';

/**
 * Two statements about the same wall that could not be confused for each
 * other: one is about the weather in the pictures, the other is about who has
 * gone. Deliberately the brief's own example, so the result speaks to §5c
 * directly.
 */
const CONDITIONS = [
  {
    key: 'weather',
    title: 'Weather Report',
    statement:
      'A show about weather, and about painters who went outside to look at it. Every work here is a record of a particular hour of a particular day — the light going, the air thickening, a front coming in off the water. Nothing is symbolic. The subject is the sky and what it is doing to everything underneath it, and the works are hung so that the day appears to be passing as you walk the room.',
  },
  {
    key: 'leaving',
    title: 'After They Left',
    statement:
      'A show about departure, and about what a place looks like once the people are out of it. Every work here is somewhere that was recently occupied and is not now — a road out, a house at a distance, a shore with the boats already gone. Nothing here is about weather. The subject is absence, and the landscape is only the room the absence is standing in.',
  },
];

await mkdir(OUT, { recursive: true });

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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const modelCalls = [];
page.on('request', (r) => {
  if (r.url().includes('/public-agent/') || r.url().includes('/labels'))
    modelCalls.push(`${r.method()} ${r.url()}`);
});

await page.goto(
  `${BASE}/nga/search?q=${encodeURIComponent(QUERY)}&webmcp-debug`,
  { waitUntil: 'domcontentloaded', timeout: 60_000 }
);
await page.waitForFunction(() => Boolean(window.__paillette_webmcp), {
  timeout: 30_000,
});
await page.waitForFunction(
  () => document.querySelectorAll('[data-artwork-id]').length >= 6,
  { timeout: 45_000 }
);

// The same six works both times. Chosen off the top of the board rather than
// hand-picked, so nothing here is selected to make the point.
const ids = (
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-artwork-id]')].map((el) =>
      el.getAttribute('data-artwork-id')
    )
  )
).slice(0, 6);

const runs = [];
for (const condition of CONDITIONS) {
  await page.evaluate(
    async ([title, statement, works]) => {
      await window.__paillette_webmcp.call('set_exhibition', {
        title,
        statement,
        artworkIds: works,
      });
    },
    [condition.title, condition.statement, ids]
  );

  const written = unwrap(
    await page.evaluate(
      async (works) =>
        await window.__paillette_webmcp.call('write_labels', {
          artworkIds: works,
        }),
      ids
    )
  );

  const shown = unwrap(
    await page.evaluate(() =>
      window.__paillette_webmcp.call('get_exhibition', {})
    )
  );

  runs.push({
    condition: condition.key,
    title: condition.title,
    statement: condition.statement,
    tool: written,
    labels: (shown?.works ?? []).map((work) => ({
      artworkId: work.artworkId,
      title: work.title ?? null,
      label: work.label?.text ?? work.label ?? null,
    })),
  });

  process.stdout.write(`\n=== ${condition.key} — "${condition.title}"\n`);
  for (const work of runs.at(-1).labels) {
    process.stdout.write(`  ${work.title}\n    ${work.label ?? '(none)'}\n`);
  }
}

// The comparison, computed rather than eyeballed.
const [a, b] = runs;
const byId = (run) =>
  Object.fromEntries(run.labels.map((w) => [w.artworkId, w.label ?? '']));
const aById = byId(a);
const bById = byId(b);
const compared = ids.map((id) => ({
  artworkId: id,
  identical: (aById[id] ?? '') === (bById[id] ?? ''),
  weather: aById[id] ?? null,
  leaving: bById[id] ?? null,
}));
const identical = compared.filter((row) => row.identical).length;

process.stdout.write(
  `\n${identical} of ${ids.length} labels are byte-identical across the two statements.\n`
);
process.stdout.write(`model/label calls: ${modelCalls.length}\n`);

await writeFile(
  path.join(OUT, 'labels-ab.json'),
  `${JSON.stringify({ base: BASE, query: QUERY, ids, runs, compared, identical, modelCalls }, null, 2)}\n`
);
await page.screenshot({ path: path.join(OUT, 'board.png'), fullPage: true });
await browser.close();
