#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import {
  FULL_STAGED_COUNT,
  PILOT_OBJECT_IDS,
  STAGING_D1_DATABASE,
  STAGING_IMAGE_VECTOR_INDEX,
  STAGING_ORG_ID,
  canonicalJson,
  sha256,
} from './lib/nga-artist-backfill.mjs';

const args = new Map();
for (const argument of process.argv.slice(2)) {
  if (!argument.startsWith('--'))
    throw new Error(`unexpected argument ${argument}`);
  const [key, ...rest] = argument.slice(2).split('=');
  args.set(key, rest.length ? rest.join('=') : true);
}
const allowed = new Set([
  'environment',
  'd1-database',
  'image-vector-index',
  'phase',
  'capture-kind',
  'exclude-ids-file',
  'out-dir',
]);
for (const key of args.keys()) {
  if (!allowed.has(key)) throw new Error(`unsupported option --${key}`);
}

const environment = String(args.get('environment') || '');
const d1Database = String(args.get('d1-database') || STAGING_D1_DATABASE);
const imageVectorIndex = String(
  args.get('image-vector-index') || STAGING_IMAGE_VECTOR_INDEX
);
const phase = String(args.get('phase') || '');
const captureKind = String(args.get('capture-kind') || 'preflight');
if (!args.get('out-dir') || args.get('out-dir') === true)
  throw new Error('--out-dir is required');
const outputDirectory = resolve(String(args.get('out-dir')));
if (environment !== 'staging')
  throw new Error('only staging preflight capture is allowed');
if (d1Database !== STAGING_D1_DATABASE)
  throw new Error('production D1 names are forbidden');
if (imageVectorIndex !== STAGING_IMAGE_VECTOR_INDEX)
  throw new Error('production Vectorize names are forbidden');
if (!['pilot', 'full'].includes(phase))
  throw new Error('--phase must be pilot or full');
if (!['preflight', 'post-apply'].includes(captureKind)) {
  throw new Error('--capture-kind must be preflight or post-apply');
}
if (
  statSync(outputDirectory, { throwIfNoEntry: false }) &&
  readdirSync(outputDirectory).length
) {
  throw new Error('--out-dir must be empty');
}

const runWrangler = (wranglerArgs) => {
  const result = spawnSync(
    'pnpm',
    ['--dir', 'apps/api', 'exec', 'wrangler', ...wranglerArgs],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(`read-only Wrangler command failed: ${result.stderr}`);
  }
  return result.stdout;
};

const extractD1Rows = (payload) => {
  const value = JSON.parse(payload);
  if (Array.isArray(value) && Array.isArray(value[0]?.results))
    return value[0].results;
  if (Array.isArray(value?.results)) return value.results;
  throw new Error('unexpected Wrangler D1 JSON response');
};

const parseVectorizePayload = (output) => {
  const jsonOffset = output.search(/^[\t ]*[\[{]/m);
  if (jsonOffset === -1)
    throw new Error('unexpected Wrangler Vectorize JSON response');
  try {
    return JSON.parse(output.slice(jsonOffset));
  } catch {
    throw new Error('unexpected Wrangler Vectorize JSON response');
  }
};

const d1Query = (sql) =>
  extractD1Rows(
    runWrangler([
      'd1',
      'execute',
      d1Database,
      '--env',
      'staging',
      '--remote',
      `--command=${sql}`,
      '--json',
    ])
  );

const findRecoveryPoint = (value) => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findRecoveryPoint(entry);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const bookmark =
    typeof value.bookmark === 'string' && value.bookmark.trim()
      ? value.bookmark.trim()
      : null;
  const timestamp =
    typeof value.timestamp === 'string' && value.timestamp.trim()
      ? value.timestamp.trim()
      : null;
  if (bookmark || timestamp) return { bookmark, timestamp };
  for (const entry of Object.values(value)) {
    const found = findRecoveryPoint(entry);
    if (found) return found;
  }
  return null;
};
let recoveryPoint = null;
let timeTravelText = null;
if (captureKind === 'preflight') {
  const timeTravelOutput = runWrangler([
    'd1',
    'time-travel',
    'info',
    d1Database,
    '--env',
    'staging',
    '--json',
  ]);
  let timeTravelPayload;
  try {
    timeTravelPayload = JSON.parse(timeTravelOutput);
  } catch {
    throw new Error('unexpected Wrangler D1 time-travel JSON response');
  }
  recoveryPoint = findRecoveryPoint(timeTravelPayload);
  if (!recoveryPoint) {
    throw new Error('D1 time-travel response has no usable recovery point');
  }
  timeTravelText = timeTravelOutput.endsWith('\n')
    ? timeTravelOutput
    : `${timeTravelOutput}\n`;
}

const excluded = new Set();
if (args.has('exclude-ids-file')) {
  const values = JSON.parse(
    readFileSync(resolve(String(args.get('exclude-ids-file'))), 'utf8')
  );
  if (!Array.isArray(values))
    throw new Error('--exclude-ids-file must contain an ID array');
  for (const value of values) {
    const match = /^open-access-art:nga:(\d+)$/.exec(String(value));
    excluded.add(match ? match[1] : String(value));
  }
}

let objectIds;
if (phase === 'pilot') {
  objectIds = [...PILOT_OBJECT_IDS];
  if (excluded.size)
    throw new Error('pilot capture does not accept exclusions');
} else {
  const scopeRows = d1Query(`SELECT id FROM artworks
WHERE org_id = '${STAGING_ORG_ID}'
  AND json_extract(custom_metadata, '$.provider') = 'nga'
  AND id LIKE 'open-access-art:nga:%'
ORDER BY id;`);
  objectIds = scopeRows
    .map((row) => /^open-access-art:nga:(\d+)$/.exec(String(row.id || ''))?.[1])
    .filter(Boolean)
    .filter((id) => !excluded.has(id));
  const expected = FULL_STAGED_COUNT - excluded.size;
  if (objectIds.length !== expected || new Set(objectIds).size !== expected) {
    throw new Error(
      `staging membership mismatch: expected ${expected}, got ${objectIds.length}`
    );
  }
}

const chunks = [];
for (let offset = 0; offset < objectIds.length; offset += 100) {
  chunks.push(objectIds.slice(offset, offset + 100));
}
const stagedRecords = [];
const vectors = [];
for (const ids of chunks) {
  const artworkIds = ids.map((id) => `open-access-art:nga:${id}`);
  const sqlIds = artworkIds.map((id) => `'${id}'`).join(',');
  const rows = d1Query(`SELECT * FROM artworks
WHERE org_id = '${STAGING_ORG_ID}'
  AND json_extract(custom_metadata, '$.provider') = 'nga'
  AND id LIKE 'open-access-art:nga:%'
  AND id IN (${sqlIds})
ORDER BY id;`);
  stagedRecords.push(...rows);

  const output = runWrangler([
    'vectorize',
    'get-vectors',
    imageVectorIndex,
    '--env',
    'staging',
    '--ids',
    ...artworkIds,
  ]);
  const payload = parseVectorizePayload(output);
  const fetched = Array.isArray(payload) ? payload : payload.vectors;
  if (!Array.isArray(fetched))
    throw new Error('unexpected Wrangler Vectorize JSON response');
  vectors.push(...fetched);
}

if (
  stagedRecords.length !== objectIds.length ||
  vectors.length !== objectIds.length
) {
  throw new Error(
    `${captureKind} coverage gap: ${stagedRecords.length} D1 rows and ${vectors.length} vectors for ${objectIds.length} IDs`
  );
}
const expectedArtworkIds = new Set(
  objectIds.map((id) => `open-access-art:nga:${id}`)
);
for (const vector of vectors) {
  const id = String(vector?.metadata?.artworkId || vector?.id || '');
  if (!expectedArtworkIds.delete(id))
    throw new Error(`unexpected or duplicate vector ID ${id}`);
}
if (expectedArtworkIds.size)
  throw new Error(`vector-ID gap for ${[...expectedArtworkIds][0]}`);

mkdirSync(join(outputDirectory, 'image-vectors'), { recursive: true });
const idsText = `${JSON.stringify(
  objectIds.map((id) => `open-access-art:nga:${id}`),
  null,
  2
)}\n`;
const recordsText = `${canonicalJson(stagedRecords)}\n`;
writeFileSync(join(outputDirectory, 'ids.json'), idsText, { flag: 'wx' });
writeFileSync(join(outputDirectory, 'staged-nga-records.json'), recordsText, {
  flag: 'wx',
});
if (timeTravelText !== null) {
  writeFileSync(join(outputDirectory, 'd1-time-travel.json'), timeTravelText, {
    flag: 'wx',
  });
}
const vectorFiles = [];
for (let offset = 0; offset < vectors.length; offset += 500) {
  const content = `${vectors
    .slice(offset, offset + 500)
    .map(canonicalJson)
    .join('\n')}\n`;
  const path = `image-vectors/original-${String(offset / 500 + 1).padStart(4, '0')}-${sha256(content).slice(0, 16)}.ndjson`;
  writeFileSync(join(outputDirectory, path), content, { flag: 'wx' });
  vectorFiles.push({
    path,
    sha256: sha256(content),
    count: Math.min(500, vectors.length - offset),
  });
}
const manifest = {
  schemaVersion: 2,
  captureKind,
  capturedAt: new Date().toISOString(),
  environment,
  phase,
  expectedOrgId: STAGING_ORG_ID,
  resources: { d1Database, imageVectorIndex },
  counts: {
    ids: objectIds.length,
    stagedRecords: stagedRecords.length,
    imageVectors: vectors.length,
  },
  hashes: { ids: sha256(idsText), stagedRecords: sha256(recordsText) },
  vectorFiles,
  ...(timeTravelText === null
    ? {}
    : {
        rollback: {
          d1TimeTravel: {
            path: 'd1-time-travel.json',
            sha256: sha256(timeTravelText),
          },
          recoveryPoint,
        },
      }),
  inputs: {
    ids: { path: 'ids.json', sha256: sha256(idsText), count: objectIds.length },
    stagedRecords: {
      path: 'staged-nga-records.json',
      sha256: sha256(recordsText),
      count: stagedRecords.length,
    },
    imageVectors: vectorFiles,
  },
};
writeFileSync(
  join(
    outputDirectory,
    captureKind === 'preflight'
      ? 'preflight-manifest.json'
      : 'state-manifest.json'
  ),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: 'wx' }
);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
