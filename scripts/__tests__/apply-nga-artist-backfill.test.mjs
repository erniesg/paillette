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
  const sql = 'SELECT 1;\n';
  const vectors = `${JSON.stringify({ id: 'open-access-art:nga:131994', values: [0.1] })}\n`;
  const mapping = `${JSON.stringify([{ id: 'open-access-art:nga:131994' }])}\n`;
  writeFileSync(join(root, 'sql', 'artist-0001.sql'), sql);
  writeFileSync(join(root, 'vectors', 'artist-0001.ndjson'), vectors);
  writeFileSync(join(root, 'mapping.json'), mapping);
  const manifest = {
    schemaVersion: 1,
    environment: 'staging',
    phase: 'pilot',
    expectedOrgId: 'eabbf000-708e-4d4c-8ac8-966b59d4fcac',
    source: {
      commit: '79d114c2186ca38af27a9478717f1e509d799495',
      manifestSha256: '1'.repeat(64),
    },
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
      { path: 'mapping.json', sha256: sha256(mapping) },
      { path: 'sql/artist-0001.sql', sha256: sha256(sql) },
      { path: 'vectors/artist-0001.ndjson', sha256: sha256(vectors) },
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
  assert.match(result.stderr, /complete.*mutation|vector.*count/i);
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
