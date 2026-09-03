/**
 * Relevance feedback over the real collection, judged by eye.
 *
 * Everything else about the engine is tested against hand-built vectors, which
 * proves the arithmetic and nothing about the pictures. This points the same
 * formula at the 63,253 works in the staging index and prints titles, so a
 * person can read the result and say whether it is sensible.
 *
 * Two questions, and neither has a green tick — read the lists:
 *
 *   1. Does the centroid of three shipwrecks land among seascapes?
 *   2. Does one strong rejection push a whole region away? The same positives
 *      are run twice, once with a negative, and the difference is printed.
 *      `max` over the negatives is the whole reason a single X is supposed to
 *      matter; if the two lists are identical, it does not.
 *
 * Setup, in two shells:
 *
 *   cd apps/api/scripts
 *   ../node_modules/.bin/wrangler dev -c exemplar-probe.wrangler.toml \
 *     --experimental-vectorize-bind-to-prod --port 8790
 *
 *   node apps/api/scripts/verify-exemplars-live.mjs
 *
 * Titles come from a read-only SELECT against the staging D1 over the wrangler
 * CLI. Nothing here writes anything, and no key is needed.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PROBE = process.argv[2] ?? 'http://localhost:8790';

/** Found with the staging text search; ids are stable, titles are for reading. */
const SEA = [
  'open-access-art:nga:123678', // Storm at Sea — Thorvald Simeon Niss
  'open-access-art:nga:121881', // Storm-Tossed Ships Wrecked on a Rocky Coast
  'open-access-art:nga:152396', // Shipwreck — Alexandre Calame
];

const resolve = async (ids) => {
  if (!ids.length) return new Map();
  const list = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
  const { stdout } = await run(
    '../node_modules/.bin/wrangler',
    [
      'd1',
      'execute',
      'paillette-db-stg',
      '--env',
      'staging',
      '--remote',
      '--json',
      '--command',
      `SELECT id, title, artist FROM artworks WHERE id IN (${list})`,
    ],
    { cwd: new URL('.', import.meta.url).pathname, maxBuffer: 32 * 1024 * 1024 }
  );
  const parsed = JSON.parse(stdout.slice(stdout.indexOf('[')));
  const rows = parsed?.[0]?.results ?? [];
  return new Map(rows.map((row) => [row.id, row]));
};

const ask = async (body) => {
  const response = await fetch(PROBE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`probe ${response.status}`);
  return response.json();
};

const show = async (label, outcome) => {
  const titles = await resolve(outcome.results.map((entry) => entry.id));
  console.log(`\n${label}`);
  for (const [rank, entry] of outcome.results.entries()) {
    const row = titles.get(entry.id);
    console.log(
      `  ${String(rank + 1).padStart(2)}. ${entry.score.toFixed(4)}  ` +
        `${(row?.title ?? entry.id).slice(0, 52).padEnd(52)} ${(row?.artist ?? '').slice(0, 28)}`
    );
  }
  return outcome.results.map((entry) => entry.id);
};

const seaTitles = await resolve(SEA);
console.log('positives — three wrecks and a storm:');
for (const id of SEA) {
  const row = seaTitles.get(id);
  console.log(`   ${row?.title ?? id} — ${row?.artist ?? ''}`);
}

const plain = await ask({ positiveIds: SEA, topK: 10 });
console.log(
  `\nvectors: asked for ${plain.positivesAsked} embeddings by id, got ` +
    `${plain.positiveVectorsFound}, ${plain.dimensions} dimensions each. ` +
    `Candidate pool ${plain.candidatePool}.`
);
const before = await show('nearest to the centroid, no rejections:', plain);

// The negative: the single highest-scoring neighbour from the run above. If
// `max` over the negatives does what it is supposed to, rejecting this should
// move everything that looked like it, not merely remove the one work.
const [strongest] = before;
const withNegative = await ask({
  positiveIds: SEA,
  negativeIds: [strongest],
  topK: 10,
});
const after = await show(
  `same positives, rejecting the top result (${strongest}):`,
  withNegative
);

const dropped = before.filter((id) => !after.includes(id) && id !== strongest);
const arrived = after.filter((id) => !before.includes(id));
const droppedTitles = await resolve([...dropped, ...arrived]);

console.log(`\none rejection moved ${dropped.length + arrived.length} places:`);
for (const id of dropped) {
  console.log(`  out  ${droppedTitles.get(id)?.title ?? id}`);
}
for (const id of arrived) {
  console.log(`  in   ${droppedTitles.get(id)?.title ?? id}`);
}
if (!dropped.length && !arrived.length) {
  console.log('  nothing — the negative term is not doing anything.');
}

const shifted = before.filter((id, index) => after[index] !== id).length;
console.log(
  `\n${shifted} of ${before.length} positions changed. Read the titles above ` +
    'rather than trusting this number.'
);

// ---------------------------------------------------------------------------
// max, not mean — the one design decision this engine actually makes
// ---------------------------------------------------------------------------
//
// Two rejections: the seascape that was ranked first, and a portrait that has
// nothing to do with anything. Averaging them halves the penalty on works that
// look like the seascape, because the portrait's near-zero similarity drags the
// average down. Taking the worst single match ignores the portrait entirely.
//
// The claim under test is that this is the difference between one X mattering
// and one X being diluted by unrelated ones.

const PORTRAIT = 'open-access-art:nga:223424'; // Portrait of a Woman

const withMax = await ask({
  positiveIds: SEA,
  negativeIds: [strongest, PORTRAIT],
  topK: 10,
  negativeAggregate: 'max',
});
const withMean = await ask({
  positiveIds: SEA,
  negativeIds: [strongest, PORTRAIT],
  topK: 10,
  negativeAggregate: 'mean',
});

const maxIds = await show(
  'rejecting the top seascape AND an unrelated portrait — max:',
  withMax
);
const meanIds = await show(
  'the same two rejections — mean:',
  withMean
);

// The honest comparison is not how many positions moved — the penalty shifts
// every score, so almost everything moves either way. It is which works the
// mean lets back onto the board that the max keeps off, and whether those are
// the ones that look like the thing the human rejected.
const readmitted = meanIds.filter((id) => !maxIds.includes(id));
const readmittedTitles = await resolve(readmitted);

console.log('\nwhat the mean lets back in that the max keeps out:');
if (!readmitted.length) {
  console.log('  nothing — on this pair of rejections the two agree.');
}
for (const id of readmitted) {
  const row = readmittedTitles.get(id);
  const wasThereBefore = before.includes(id) ? ' (and it was on the board before the rejection)' : '';
  console.log(`  ${row?.title ?? id} — ${row?.artist ?? ''}${wasThereBefore}`);
}
console.log(
  '\nThat is the dilution the max exists to prevent: an unrelated second ' +
    'rejection halves the penalty, and the region the human actually pushed ' +
    'away comes back.'
);
