import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { spawnSync } from 'node:child_process';

const scriptPath = resolve('scripts/apply-nga-artist-backfill.mjs');
const temporaryDirectories = [];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const pilotIds = ['131994', '110821', '11236', '38', '579'].map(
  (id) => `open-access-art:nga:${id}`
);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const createArtifacts = (overrides = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'nga-apply-'));
  temporaryDirectories.push(root);
  mkdirSync(join(root, 'sql'));
  mkdirSync(join(root, 'vectors'));
  mkdirSync(join(root, 'rollback'));
  const mappingRows = pilotIds.map((id, index) => ({
    id,
    primaryArtistId: String(1000 + index),
  }));
  const sql = mappingRows
    .map(
      (row) => `UPDATE artworks SET
  primary_artist_id = '${row.primaryArtistId}'
WHERE org_id = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac'
  AND json_extract(custom_metadata, '$.provider') = 'nga'
  AND id LIKE 'open-access-art:nga:%'
  AND id = '${row.id}';`
    )
    .join('\n');
  const vectorRows = mappingRows.map((row, index) => ({
    id: row.id,
    values: [index / 10, 0.5],
    metadata: {
      artworkId: row.id,
      provider: 'nga',
      primaryArtistId: row.primaryArtistId,
    },
  }));
  const rollbackRows = vectorRows.map((row) => ({
    ...row,
    metadata: { artworkId: row.id, provider: 'nga' },
  }));
  const vectors = `${vectorRows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const rollback = `${rollbackRows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const valueHashes = `${JSON.stringify(
    vectorRows.map((row) => ({
      id: row.id,
      originalSha256: sha256(JSON.stringify(row.values)),
      enrichedSha256: sha256(JSON.stringify(row.values)),
    }))
  )}\n`;
  const mapping = `${JSON.stringify(mappingRows)}\n`;
  const sourceManifest = `${JSON.stringify({ sourceCommit: '79d114c2186ca38af27a9478717f1e509d799495' })}\n`;
  writeFileSync(join(root, 'sql', 'artist-0001.sql'), sql);
  writeFileSync(join(root, 'vectors', 'artist-0001.ndjson'), vectors);
  writeFileSync(join(root, 'rollback', 'image-vectors-0001.ndjson'), rollback);
  writeFileSync(join(root, 'vector-value-hashes.json'), valueHashes);
  writeFileSync(join(root, 'source-manifest.json'), sourceManifest);
  writeFileSync(join(root, 'mapping.json'), mapping);
  const manifest = {
    schemaVersion: 1,
    environment: 'staging',
    phase: 'pilot',
    expectedOrgId: 'eabbf000-708e-4d4c-8ac8-966b59d4fcac',
    source: {
      commit: '79d114c2186ca38af27a9478717f1e509d799495',
      manifestSha256: sha256(sourceManifest),
    },
    preflightInputs: [
      {
        manifestSha256: '2'.repeat(64),
        phase: 'pilot',
        expectedOrgId: 'eabbf000-708e-4d4c-8ac8-966b59d4fcac',
        resources: {
          d1Database: 'paillette-db-stg',
          imageVectorIndex: 'paillette-embeddings-v2-stg',
        },
        counts: { ids: 5, stagedRecords: 5, imageVectors: 5 },
        ids: { path: 'ids.json', sha256: '3'.repeat(64), count: 5 },
        stagedRecords: {
          path: 'staged-nga-records.json',
          sha256: '4'.repeat(64),
          count: 5,
        },
        imageVectors: [
          {
            path: 'image-vectors/original-0001.ndjson',
            sha256: '5'.repeat(64),
            count: 5,
          },
        ],
      },
    ],
    resources: {
      d1Database: 'paillette-db-stg',
      imageVectorIndex: 'paillette-embeddings-v2-stg',
    },
    invariants: {
      stagedRecordCount: 5,
      mappingCount: 5,
      imageVectorCount: 5,
      rollbackVectorCount: 5,
      vectorValuesUnchanged: true,
      captionVectorsChanged: 0,
    },
    files: [
      { path: 'source-manifest.json', sha256: sha256(sourceManifest) },
      { path: 'mapping.json', sha256: sha256(mapping) },
      { path: 'vector-value-hashes.json', sha256: sha256(valueHashes) },
      {
        path: 'rollback/image-vectors-0001.ndjson',
        sha256: sha256(rollback),
        recordCount: 5,
      },
      { path: 'sql/artist-0001.sql', sha256: sha256(sql), recordCount: 5 },
      {
        path: 'vectors/artist-0001.ndjson',
        sha256: sha256(vectors),
        recordCount: 5,
      },
    ],
    orderedArtifacts: [
      {
        kind: 'd1-sql',
        path: 'sql/artist-0001.sql',
        sha256: sha256(sql),
        recordCount: 5,
      },
      {
        kind: 'image-vectors',
        path: 'vectors/artist-0001.ndjson',
        sha256: sha256(vectors),
        recordCount: 5,
      },
    ],
    ...overrides,
  };
  const manifestPath = join(root, 'artifact-manifest.json');
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, manifestText);
  return { root, manifestPath, manifestSha256: sha256(manifestText) };
};

const replaceArtifact = (artifact, path, content) => {
  writeFileSync(join(artifact.root, path), content);
  const manifest = JSON.parse(readFileSync(artifact.manifestPath, 'utf8'));
  const digest = sha256(content);
  manifest.files.find((entry) => entry.path === path).sha256 = digest;
  const ordered = manifest.orderedArtifacts.find(
    (entry) => entry.path === path
  );
  if (ordered) ordered.sha256 = digest;
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(artifact.manifestPath, manifestText);
  return { ...artifact, manifestSha256: sha256(manifestText) };
};

const runApply = ({ manifestPath, manifestSha256, extra = [], env = {} }) =>
  spawnSync(
    process.execPath,
    [
      scriptPath,
      '--environment=staging',
      '--phase=pilot',
      `--manifest=${manifestPath}`,
      ...(manifestSha256
        ? [`--confirm-manifest-sha256=${manifestSha256}`]
        : []),
      ...extra,
    ],
    { encoding: 'utf8', env: { ...process.env, ...env } }
  );

test('dry-run is the default and prints a serial hash-confirmed plan', () => {
  const artifact = createArtifacts();
  const marker = join(artifact.root, 'wrangler-called');
  const result = runApply({
    ...artifact,
    env: { NGA_BACKFILL_TEST_MUTATION_MARKER: marker },
  });

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, 'dry-run');
  assert.deepEqual(
    plan.steps.map((step) => step.kind),
    ['d1-sql', 'image-vectors']
  );
  assert.equal(plan.steps[1].command.includes('upsert'), true);
  assert.equal(existsSync(marker), false);
});

test('rejects production environment and production resource names', () => {
  const artifact = createArtifacts();
  for (const extra of [
    ['--environment=production'],
    ['--d1-database=paillette-db'],
    ['--image-vector-index=paillette-embeddings-v2'],
  ]) {
    const result = runApply({ ...artifact, extra });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /staging|production/i);
  }
  const productionManifest = join(
    artifact.root,
    'production-artifact-manifest.json'
  );
  renameSync(artifact.manifestPath, productionManifest);
  const namedProduction = runApply({
    ...artifact,
    manifestPath: productionManifest,
  });
  assert.notEqual(namedProduction.status, 0);
  assert.match(namedProduction.stderr, /production/i);
});

test('rejects a missing or mismatched manifest confirmation hash', () => {
  const artifact = createArtifacts();
  const missing = runApply({ manifestPath: artifact.manifestPath });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /confirm-manifest-sha256/);
  const mismatch = runApply({ ...artifact, manifestSha256: '0'.repeat(64) });
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /manifest SHA-256 mismatch/i);
});

test('rejects manifest paths outside the artifact root and unordered chunks', () => {
  const outside = createArtifacts({
    orderedArtifacts: [
      { kind: 'd1-sql', path: '../escape.sql', sha256: '0'.repeat(64) },
    ],
  });
  const escaped = runApply(outside);
  assert.notEqual(escaped.status, 0);
  assert.match(escaped.stderr, /artifact root/i);

  const unordered = createArtifacts();
  const manifest = JSON.parse(readFileSync(unordered.manifestPath, 'utf8'));
  manifest.orderedArtifacts.reverse();
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(unordered.manifestPath, text);
  const result = runApply({ ...unordered, manifestSha256: sha256(text) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ordered|D1.*before.*vector/i);
});

test('rejects an incomplete ordered mutation plan', () => {
  const artifact = createArtifacts();
  const manifest = JSON.parse(readFileSync(artifact.manifestPath, 'utf8'));
  manifest.orderedArtifacts = manifest.orderedArtifacts.slice(0, 1);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(artifact.manifestPath, text);
  const result = runApply({ ...artifact, manifestSha256: sha256(text) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /complete.*mutation|vector.*(?:count|ID gap)/i);
});

test('rejects a confirmed artifact manifest without hashed preflight bindings', () => {
  const artifact = createArtifacts();
  const manifest = JSON.parse(readFileSync(artifact.manifestPath, 'utf8'));
  delete manifest.preflightInputs;
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(artifact.manifestPath, text);
  const result = runApply({ ...artifact, manifestSha256: sha256(text) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /preflight.*bound|preflightInputs/i);
});

test('rejects rehashed SQL chunks whose declared count hides an ID gap', () => {
  let artifact = createArtifacts();
  const sqlPath = 'sql/artist-0001.sql';
  const statements = readFileSync(join(artifact.root, sqlPath), 'utf8')
    .split(';')
    .filter((value) => value.trim());
  artifact = replaceArtifact(
    artifact,
    sqlPath,
    `${statements.slice(0, -1).join(';')};\n`
  );

  const result = runApply(artifact);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SQL.*count|ID gap/i);
});

test('rejects rehashed enriched and rollback vectors with duplicate or missing IDs', () => {
  let artifact = createArtifacts();
  const vectorPath = 'vectors/artist-0001.ndjson';
  const lines = readFileSync(join(artifact.root, vectorPath), 'utf8')
    .trim()
    .split('\n');
  artifact = replaceArtifact(
    artifact,
    vectorPath,
    `${[...lines.slice(0, -1), lines[0]].join('\n')}\n`
  );
  let result = runApply(artifact);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate.*vector|vector.*ID/i);

  artifact = createArtifacts();
  const rollbackPath = 'rollback/image-vectors-0001.ndjson';
  const rollbackLines = readFileSync(join(artifact.root, rollbackPath), 'utf8')
    .trim()
    .split('\n');
  artifact = replaceArtifact(
    artifact,
    rollbackPath,
    `${rollbackLines.slice(0, -1).join('\n')}\n`
  );
  result = runApply(artifact);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /rollback.*count|rollback.*ID gap/i);
});

test('rejects a rollback chunk whose declared line count is false', () => {
  const artifact = createArtifacts();
  const manifest = JSON.parse(readFileSync(artifact.manifestPath, 'utf8'));
  manifest.files.find((entry) =>
    entry.path.startsWith('rollback/')
  ).recordCount = 4;
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(artifact.manifestPath, text);
  const result = runApply({ ...artifact, manifestSha256: sha256(text) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /rollback.*count|declared.*rollback/i);
});

test('execute is explicit and rejects a manifest whose artifact hash changed', () => {
  const artifact = createArtifacts();
  writeFileSync(join(artifact.root, 'sql', 'artist-0001.sql'), 'SELECT 2;\n');
  const result = runApply({ ...artifact, extra: ['--execute'] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /artifact SHA-256 mismatch/i);
});

test('rejects a changed support artifact bound into the manifest', () => {
  const artifact = createArtifacts();
  writeFileSync(join(artifact.root, 'mapping.json'), '[]\n');
  const result = runApply(artifact);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /artifact SHA-256 mismatch.*mapping\.json/i);
});
