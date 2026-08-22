import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { spawnSync } from 'node:child_process';

import { buildNgaArtistUpdateSql } from '../lib/nga-structured-search-backfill.mjs';
import {
  validateNgaApplyResumeLineageV1,
  validateNgaVectorSettlementIncidentV1,
} from '../lib/nga-artist-backfill.mjs';

const scriptPath = resolve('scripts/apply-nga-artist-backfill.mjs');
const prepareResumeScriptPath = resolve(
  'scripts/prepare-nga-artist-apply-resume.mjs'
);
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

let evidenceFixtureSequence = 0;
const createArtifacts = (
  overrides = {},
  { evidenceLayout = false, lookalikeEvidenceLayout = false } = {}
) => {
  let evidenceRoot;
  if (evidenceLayout) {
    const evidenceSha = sha256(
      `${process.pid}:${Date.now()}:${evidenceFixtureSequence++}`
    ).slice(0, 40);
    const shaRoot = resolve(
      '.agent',
      'evidence',
      'nga-staging',
      evidenceSha
    );
    evidenceRoot = join(shaRoot, '20990101T000000Z');
    temporaryDirectories.push(shaRoot);
  } else {
    evidenceRoot = mkdtempSync(join(tmpdir(), 'nga-apply-'));
    temporaryDirectories.push(evidenceRoot);
  }
  const root =
    evidenceLayout || lookalikeEvidenceLayout
      ? join(evidenceRoot, 'backfill', 'pilot')
      : evidenceRoot;
  if (root !== evidenceRoot) mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'sql'));
  mkdirSync(join(root, 'vectors'));
  mkdirSync(join(root, 'rollback'));
  const mappingRows = pilotIds.map((id, index) => ({
    id,
    primaryArtistId: String(1000 + index),
    customMetadata: {
      ngaArtists: {
        sourceCommit: '79d114c2186ca38af27a9478717f1e509d799495',
        relationships: [],
      },
    },
    fieldSources: { primary_artist_id: 'nga.objects_constituents' },
  }));
  const sql = mappingRows
    .map((row) =>
      buildNgaArtistUpdateSql(row, 'eabbf000-708e-4d4c-8ac8-966b59d4fcac')
    )
    .join('\n');
  const vectorRows = mappingRows.map((row, index) => ({
    id: row.id,
    values: [index / 10, 0.5],
    namespace: 'image',
    dimensions: 2,
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
  const rollbackD1Rows = mappingRows.map((row, index) => ({
    id: row.id,
    org_id: 'eabbf000-708e-4d4c-8ac8-966b59d4fcac',
    title: `Original ${index}`,
    primary_artist_id: null,
    custom_metadata: JSON.stringify({ provider: 'nga', retained: index }),
    field_sources: JSON.stringify({ title: 'nga.objects' }),
    updated_at: '2026-08-22T00:00:00Z',
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
  const rollbackD1 = `${JSON.stringify(rollbackD1Rows)}\n`;
  const sourceManifest = `${JSON.stringify({ sourceCommit: '79d114c2186ca38af27a9478717f1e509d799495' })}\n`;
  writeFileSync(join(root, 'sql', 'artist-0001.sql'), sql);
  writeFileSync(join(root, 'vectors', 'artist-0001.ndjson'), vectors);
  writeFileSync(join(root, 'rollback', 'image-vectors-0001.ndjson'), rollback);
  writeFileSync(join(root, 'rollback', 'd1-records.json'), rollbackD1);
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
        rollback: {
          d1TimeTravel: {
            path: 'd1-time-travel.json',
            sha256: '6'.repeat(64),
          },
          recoveryPoint: {
            bookmark: '00000000-0000000a-00004c16-00000000',
            timestamp: '2026-08-22T00:00:00Z',
          },
        },
      },
    ],
    resources: {
      d1Database: 'paillette-db-stg',
      imageVectorIndex: 'paillette-embeddings-v2-stg',
    },
    invariants: {
      stagedRecordCount: 5,
      mappingCount: 5,
      expectedD1Changes: 5,
      imageVectorCount: 5,
      rollbackVectorCount: 5,
      rollbackD1RecordCount: 5,
      vectorValuesUnchanged: true,
      captionVectorsChanged: 0,
    },
    files: [
      { path: 'source-manifest.json', sha256: sha256(sourceManifest) },
      { path: 'mapping.json', sha256: sha256(mapping) },
      { path: 'vector-value-hashes.json', sha256: sha256(valueHashes) },
      {
        path: 'rollback/d1-records.json',
        sha256: sha256(rollbackD1),
        recordCount: 5,
      },
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
  return {
    evidenceRoot,
    root,
    manifestPath,
    manifestSha256: sha256(manifestText),
  };
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

const createMockPnpm = (
  artifact,
  {
    d1Changes = 5,
    d1QueryCount = 5,
    d1Prefix = '',
    mutateRows = (rows) => rows,
    mutateVectors = (rows) => rows,
    staleVectorReads = 0,
    vectorStdout = null,
  } = {}
) => {
  const bin = join(artifact.root, 'bin');
  mkdirSync(bin);
  const mapping = JSON.parse(readFileSync(join(artifact.root, 'mapping.json')));
  const originalRows = JSON.parse(
    readFileSync(join(artifact.root, 'rollback', 'd1-records.json'))
  );
  const postRows = originalRows.map((row, index) => ({
    ...row,
    primary_artist_id: mapping[index].primaryArtistId,
    custom_metadata: JSON.stringify({
      ...JSON.parse(row.custom_metadata),
      ngaArtists: mapping[index].customMetadata.ngaArtists,
    }),
    field_sources: JSON.stringify({
      ...JSON.parse(row.field_sources),
      primary_artist_id: 'nga.objects_constituents',
    }),
    updated_at: '2026-08-22T00:05:00Z',
  }));
  const postVectors = readFileSync(
    join(artifact.root, 'vectors', 'artist-0001.ndjson'),
    'utf8'
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const originalVectors = readFileSync(
    join(artifact.root, 'rollback', 'image-vectors-0001.ndjson'),
    'utf8'
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const mock = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2).join(' ');
if (args.includes('d1 execute') && args.includes('--file')) {
  if (process.env.NGA_APPLY_TEST_D1_MARKER) appendFileSync(process.env.NGA_APPLY_TEST_D1_MARKER, 'd1\\n');
  process.stdout.write(process.env.NGA_APPLY_TEST_D1_PREFIX + JSON.stringify([{
    results: [{ 'Total queries executed': Number(process.env.NGA_APPLY_TEST_D1_QUERY_COUNT) }],
    success: true,
    finalBookmark: '00000000-0000000a-00004c16-00000000',
    meta: {
      changes: Number(process.env.NGA_APPLY_TEST_D1_CHANGES),
      rows_read: 10,
      rows_written: 15,
      changed_db: true
    }
  }]));
} else if (args.includes('d1 execute') && args.includes('--command=')) {
  process.stdout.write(JSON.stringify([{ results: JSON.parse(process.env.NGA_APPLY_TEST_POST_ROWS) }]));
} else if (args.includes('vectorize upsert')) {
  if (process.env.NGA_APPLY_TEST_VECTOR_MARKER) appendFileSync(process.env.NGA_APPLY_TEST_VECTOR_MARKER, 'vector\\n');
  process.stdout.write(process.env.NGA_APPLY_TEST_VECTOR_STDOUT);
} else if (args.includes('vectorize get-vectors')) {
  let readIndex = 0;
  if (process.env.NGA_APPLY_TEST_VECTOR_READ_MARKER) {
    if (existsSync(process.env.NGA_APPLY_TEST_VECTOR_READ_MARKER)) {
      readIndex = readFileSync(process.env.NGA_APPLY_TEST_VECTOR_READ_MARKER, 'utf8').trim().split('\\n').filter(Boolean).length;
    }
    appendFileSync(process.env.NGA_APPLY_TEST_VECTOR_READ_MARKER, 'read\\n');
  }
  const snapshots = JSON.parse(process.env.NGA_APPLY_TEST_VECTOR_SNAPSHOTS);
  process.stdout.write(JSON.stringify({ vectors: snapshots[Math.min(readIndex, snapshots.length - 1)] }));
} else {
  process.stderr.write('unexpected mock command: ' + args);
  process.exit(2);
}
`;
  const command = join(bin, 'pnpm');
  writeFileSync(command, mock);
  chmodSync(command, 0o755);
  return {
    PATH: `${bin}:${process.env.PATH}`,
    NGA_APPLY_TEST_D1_CHANGES: String(d1Changes),
    NGA_APPLY_TEST_D1_QUERY_COUNT: String(d1QueryCount),
    NGA_APPLY_TEST_D1_PREFIX: d1Prefix,
    NGA_APPLY_TEST_VECTOR_STDOUT:
      vectorStdout ||
      "✨ Enqueued 5 vectors into index 'paillette-embeddings-v2-stg' for upsertion. Mutation changeset identifier: 283fa906-9e2a-4fbe-a6b1-34617719f705\n" +
        JSON.stringify({ index: 'paillette-embeddings-v2-stg', count: 5 }),
    NGA_APPLY_TEST_POST_ROWS: JSON.stringify(
      mutateRows(postRows, originalRows)
    ),
    NGA_APPLY_TEST_VECTOR_SNAPSHOTS: JSON.stringify([
      ...Array.from({ length: staleVectorReads }, () => originalVectors),
      mutateVectors(postVectors),
    ]),
  };
};

const liveD1Stdout = ({ queryCount = 5, changes = 11, prefix = '' } = {}) =>
  `${prefix}${JSON.stringify([
    {
      results: [{ 'Total queries executed': queryCount }],
      success: true,
      finalBookmark: '00000000-0000000a-00004c16-00000000',
      meta: {
        changes,
        rows_read: 10,
        rows_written: 15,
        changed_db: true,
      },
    },
  ])}`;

const createResumeResponseDirectory = (artifact, mutate = (value) => value) => {
  const directory = join(artifact.root, 'resume-responses');
  mkdirSync(directory);
  const response = mutate({
    sequence: 1,
    kind: 'd1-sql',
    path: 'sql/artist-0001.sql',
    status: 0,
    stdout: liveD1Stdout({
      prefix:
        '├ Checking if file needs uploading\n│\n├ 🌀 Uploading fixture.sql\n│ 🌀 Uploading complete.\n│\n',
    }),
    stderr: '',
  });
  writeFileSync(
    join(directory, '0001.json'),
    `${JSON.stringify(response, null, 2)}\n`
  );
  return directory;
};

const addVectorResumeResponse = (artifact, directory) => {
  const response = {
    sequence: 2,
    kind: 'image-vectors',
    path: 'vectors/artist-0001.ndjson',
    status: 0,
    stdout:
      "✨ Enqueued 5 vectors into index 'paillette-embeddings-v2-stg' for upsertion. Mutation changeset identifier: 283fa906-9e2a-4fbe-a6b1-34617719f705\n" +
      JSON.stringify({ index: 'paillette-embeddings-v2-stg', count: 5 }),
    stderr: '',
  };
  writeFileSync(
    join(directory, '0002.json'),
    `${JSON.stringify(response, null, 2)}\n`
  );
  return directory;
};

const createResumeLineage = (
  artifact,
  resumeDirectory,
  mutate = (value) => value
) => {
  const responseNames = ['0001.json', '0002.json'].filter((name) =>
    existsSync(join(resumeDirectory, name))
  );
  const lineage = mutate({
    schemaVersion: 'nga-apply-resume-lineage-v2',
    phase: 'pilot',
    artifactManifest: {
      sourcePath: 'backfill/pilot/artifact-manifest.json',
      sha256: artifact.manifestSha256,
    },
    preflightManifests: [
      {
        phase: 'pilot',
        sourcePath: 'preflight/pilot/preflight-manifest.json',
        sha256: '2'.repeat(64),
      },
    ],
    responses: responseNames.map((name, index) => ({
        sequence: index + 1,
        sourceGitSha: 'c5913a3193beff80f92bc5a90215f73869bc3cb6',
        sourceEvidenceRoot:
          '.agent/evidence/nga-staging/c5913a3193beff80f92bc5a90215f73869bc3cb6/20260822T134448Z',
        sourcePath:
          `backfill/pilot/apply-responses/2026-08-22T13-49-24-534Z-1855/${name}`,
        copiedPath: `resume-responses/${name}`,
        sha256: sha256(readFileSync(join(resumeDirectory, name))),
        parentLineage: null,
        incident: null,
      })),
    parentLineages: [],
    priorSettlementEvidence: null,
  });
  const path = join(artifact.root, 'resume-lineage.json');
  const text = `${JSON.stringify(lineage, null, 2)}\n`;
  writeFileSync(path, text);
  return { path, sha256: sha256(text) };
};

const resumeArguments = (artifact, resumeDirectory, mutateLineage) => {
  const lineage = createResumeLineage(artifact, resumeDirectory, mutateLineage);
  return [
    `--resume-response-dir=${resumeDirectory}`,
    `--resume-lineage=${lineage.path}`,
    `--confirm-resume-lineage-sha256=${lineage.sha256}`,
  ];
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

test('rejects a preflight binding without a durable D1 recovery point', () => {
  const artifact = createArtifacts();
  const manifest = JSON.parse(readFileSync(artifact.manifestPath, 'utf8'));
  delete manifest.preflightInputs[0].rollback;
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(artifact.manifestPath, text);

  const result = runApply({ ...artifact, manifestSha256: sha256(text) });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /preflight.*rollback|recovery point|time-travel/i
  );
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

test('rejects rehashed SQL that changes unrelated columns or required guards', () => {
  const sqlPath = 'sql/artist-0001.sql';
  const mutations = [
    (sql) =>
      sql.replace(
        '  updated_at = CURRENT_TIMESTAMP',
        "  updated_at = CURRENT_TIMESTAMP,\n  title = 'tampered'"
      ),
    (sql) =>
      sql.replace(
        "WHERE org_id = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac'",
        "WHERE org_id = '00000000-0000-0000-0000-000000000000'"
      ),
    (sql) =>
      sql.replace(
        "  AND json_extract(custom_metadata, '$.provider') = 'nga'",
        "  AND json_extract(custom_metadata, '$.provider') = 'met'"
      ),
    (sql) =>
      sql.replace(
        "  AND id LIKE 'open-access-art:nga:%'",
        "  AND id LIKE 'open-access-art:%'"
      ),
    (sql) =>
      sql.replace(
        "  AND id = 'open-access-art:nga:131994'",
        "  AND id <> 'open-access-art:nga:131994'"
      ),
    (sql) =>
      sql.replace(
        "WHERE org_id = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac'\n",
        ''
      ),
    (sql) =>
      sql.replace(
        "  AND json_extract(custom_metadata, '$.provider') = 'nga'\n",
        ''
      ),
    (sql) => sql.replace("  AND id LIKE 'open-access-art:nga:%'\n", ''),
    (sql) => sql.replace("  AND id = 'open-access-art:nga:131994'\n", ''),
  ];

  for (const mutate of mutations) {
    let artifact = createArtifacts();
    const sql = readFileSync(join(artifact.root, sqlPath), 'utf8');
    const mutatedSql = mutate(sql);
    assert.notEqual(mutatedSql, sql, 'test mutation must alter its fixture');
    artifact = replaceArtifact(artifact, sqlPath, mutatedSql);
    const result = runApply(artifact);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SQL.*(?:column|guard|scope|ID)/i);
  }
});

test('rejects rehashed SQL with block comments or trailing assignment tokens', () => {
  const sqlPath = 'sql/artist-0001.sql';
  const mutations = [
    (sql) =>
      sql.replace(
        '  updated_at = CURRENT_TIMESTAMP',
        '  updated_at = CURRENT_TIMESTAMP /*'
      ),
    (sql) =>
      sql.replace(
        '  updated_at = CURRENT_TIMESTAMP',
        '  updated_at = CURRENT_TIMESTAMP /* hand edit */'
      ),
    (sql) =>
      sql.replace(
        '  updated_at = CURRENT_TIMESTAMP',
        '  updated_at = CURRENT_TIMESTAMP + 0'
      ),
  ];

  for (const mutate of mutations) {
    let artifact = createArtifacts();
    const sql = readFileSync(join(artifact.root, sqlPath), 'utf8');
    const mutatedSql = mutate(sql);
    assert.notEqual(mutatedSql, sql, 'test mutation must alter its fixture');
    artifact = replaceArtifact(artifact, sqlPath, mutatedSql);
    const result = runApply(artifact);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SQL.*(?:exact|generated|mutation|scope)/i);
  }
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

test('rejects any enriched-vector change beyond metadata.primaryArtistId', () => {
  const vectorPath = 'vectors/artist-0001.ndjson';
  const mutations = [
    (row) => ({ ...row, dimensions: 3 }),
    (row) => {
      const { namespace: _removed, ...rest } = row;
      return rest;
    },
    (row) => ({ ...row, extraTopLevel: true }),
    (row) => ({ ...row, metadata: { ...row.metadata, provider: 'met' } }),
    (row) => {
      const { provider: _removed, ...metadata } = row.metadata;
      return { ...row, metadata };
    },
    (row) => ({ ...row, metadata: { ...row.metadata, extraMetadata: true } }),
  ];

  for (const mutate of mutations) {
    let artifact = createArtifacts();
    const rows = readFileSync(join(artifact.root, vectorPath), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    rows[0] = mutate(rows[0]);
    artifact = replaceArtifact(
      artifact,
      vectorPath,
      `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
    );
    const result = runApply(artifact);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /vector.*(?:structure|metadata|unchanged)/i);
  }
});

test('rejects a rollback chunk whose declared line count is false', () => {
  const artifact = createArtifacts();
  const manifest = JSON.parse(readFileSync(artifact.manifestPath, 'utf8'));
  manifest.files.find(
    (entry) =>
      entry.path.startsWith('rollback/') && entry.path.endsWith('.ndjson')
  ).recordCount = 4;
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(artifact.manifestPath, text);
  const result = runApply({ ...artifact, manifestSha256: sha256(text) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /rollback.*count|declared.*rollback/i);
});

test('rejects a prepared manifest without a complete D1 rollback source', () => {
  const artifact = createArtifacts();
  const manifest = JSON.parse(readFileSync(artifact.manifestPath, 'utf8'));
  manifest.files = manifest.files.filter(
    (entry) => entry.path !== 'rollback/d1-records.json'
  );
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(artifact.manifestPath, text);

  const result = runApply({ ...artifact, manifestSha256: sha256(text) });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /D1 rollback|rollback.*D1/i);
});

test('execute is explicit and rejects a manifest whose artifact hash changed', () => {
  const artifact = createArtifacts();
  writeFileSync(join(artifact.root, 'sql', 'artist-0001.sql'), 'SELECT 2;\n');
  const result = runApply({
    ...artifact,
    extra: [
      '--execute',
      `--post-apply-out-dir=${join(artifact.root, 'post-apply')}`,
    ],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /artifact SHA-256 mismatch/i);
});

test('active settlement requires an exclusive absent output directory', () => {
  const artifact = createArtifacts();
  const outDir = join(artifact.root, 'post-apply');
  mkdirSync(outDir);

  const result = runApply({
    ...artifact,
    extra: ['--execute', `--post-apply-out-dir=${outDir}`],
    env: createMockPnpm(artifact),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /post-apply.*(?:absent|exist)|exclusive/i);
});

test('active settlement safely creates a missing stable output parent', () => {
  const artifact = createArtifacts();
  const outDir = join(artifact.root, 'candidate', 'post-apply', 'pilot');

  const result = runApply({
    ...artifact,
    extra: ['--execute', `--post-apply-out-dir=${outDir}`],
    env: createMockPnpm(artifact),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(outDir, 'verification.json')), true);
});

test('active settlement allows the documented candidate sibling under its evidence root', () => {
  const artifact = createArtifacts({}, { evidenceLayout: true });
  const outDir = join(
    artifact.evidenceRoot,
    'candidate',
    'post-apply',
    'pilot'
  );

  const result = runApply({
    ...artifact,
    extra: ['--execute', `--post-apply-out-dir=${outDir}`],
    env: createMockPnpm(artifact),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(outDir, 'verification.json')), true);
});

test('active settlement does not widen a lookalike backfill path to an evidence root', () => {
  const artifact = createArtifacts({}, { lookalikeEvidenceLayout: true });
  const outDir = join(
    artifact.evidenceRoot,
    'candidate',
    'post-apply',
    'pilot'
  );
  const mutationMarker = join(artifact.root, 'mutation-marker');
  const result = runApply({
    ...artifact,
    extra: ['--execute', `--post-apply-out-dir=${outDir}`],
    env: {
      ...createMockPnpm(artifact),
      NGA_APPLY_TEST_D1_MARKER: mutationMarker,
      NGA_APPLY_TEST_VECTOR_MARKER: mutationMarker,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /post-apply output escapes.*root/i);
  assert.equal(existsSync(mutationMarker), false);
});

test('active settlement rejects an output outside the artifact root before mutation', () => {
  const artifact = createArtifacts();
  const outsideRoot = `${artifact.root}-outside`;
  temporaryDirectories.push(outsideRoot);
  const mutationMarker = join(artifact.root, 'mutation-marker');
  const result = runApply({
    ...artifact,
    extra: [
      '--execute',
      `--post-apply-out-dir=${join(outsideRoot, 'post-apply')}`,
    ],
    env: {
      ...createMockPnpm(artifact),
      NGA_APPLY_TEST_D1_MARKER: mutationMarker,
      NGA_APPLY_TEST_VECTOR_MARKER: mutationMarker,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /post-apply.*artifact root|escapes/i);
  assert.equal(existsSync(mutationMarker), false);
});

test('active settlement rejects a symlinked output parent before mutation', () => {
  const artifact = createArtifacts();
  const outsideRoot = `${artifact.root}-outside`;
  temporaryDirectories.push(outsideRoot);
  mkdirSync(outsideRoot);
  symlinkSync(outsideRoot, join(artifact.root, 'candidate'));
  const mutationMarker = join(artifact.root, 'mutation-marker');
  const result = runApply({
    ...artifact,
    extra: [
      '--execute',
      `--post-apply-out-dir=${join(
        artifact.root,
        'candidate',
        'post-apply',
        'pilot'
      )}`,
    ],
    env: {
      ...createMockPnpm(artifact),
      NGA_APPLY_TEST_D1_MARKER: mutationMarker,
      NGA_APPLY_TEST_VECTOR_MARKER: mutationMarker,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /post-apply.*symlink/i);
  assert.equal(existsSync(mutationMarker), false);
});

test('active settlement rejects a symlinked evidence root before mutation', () => {
  const artifact = createArtifacts({}, { evidenceLayout: true });
  const aliasHolder = mkdtempSync(join(tmpdir(), 'nga-apply-alias-'));
  temporaryDirectories.push(aliasHolder);
  const evidenceAlias = join(aliasHolder, 'evidence');
  symlinkSync(artifact.evidenceRoot, evidenceAlias);
  const mutationMarker = join(artifact.root, 'mutation-marker');
  const result = runApply({
    ...artifact,
    manifestPath: join(
      evidenceAlias,
      'backfill',
      'pilot',
      'artifact-manifest.json'
    ),
    extra: [
      '--execute',
      `--post-apply-out-dir=${join(
        evidenceAlias,
        'candidate',
        'post-apply',
        'pilot'
      )}`,
    ],
    env: {
      ...createMockPnpm(artifact),
      NGA_APPLY_TEST_D1_MARKER: mutationMarker,
      NGA_APPLY_TEST_VECTOR_MARKER: mutationMarker,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /post-apply evidence root.*real directory/i);
  assert.equal(existsSync(mutationMarker), false);
});

test('execute succeeds only after exact post-apply state is re-exported and verified', () => {
  const passing = createArtifacts();
  const passingOut = join(passing.root, 'post-apply');
  const passed = runApply({
    ...passing,
    extra: ['--execute', `--post-apply-out-dir=${passingOut}`],
    env: createMockPnpm(passing),
  });
  assert.equal(passed.status, 0, passed.stderr);
  const verification = JSON.parse(
    readFileSync(join(passingOut, 'verification.json'), 'utf8')
  );
  assert.equal(verification.schemaVersion, 'nga-post-apply-verification-v4');
  assert.equal(verification.phase, 'pilot');
  assert.equal(verification.summary.recordCount, 5);
  assert.equal(verification.summary.vectorCount, 5);
  assert.deepEqual(verification.applySummary, {
    responseCount: 2,
    resumedResponseCount: 0,
    executedResponseCount: 2,
    d1ChunkCount: 1,
    expectedD1QueryCount: 5,
    actualD1QueryCount: 5,
    vectorChunkCount: 1,
    expectedVectorCount: 5,
    actualVectorCount: 5,
    vectorMutationIds: ['283fa906-9e2a-4fbe-a6b1-34617719f705'],
    expectedApplicationRecordChanges: 5,
    verifiedApplicationRecordChanges: 5,
  });
  assert.deepEqual(
    verification.applyResponses.map((response) => ({
      sequence: response.sequence,
      kind: response.kind,
      path: response.path,
      artifactPath: response.artifactPath,
      execution: response.execution,
      expectedQueryCount: response.expectedQueryCount,
      actualQueryCount: response.actualQueryCount,
    })),
    [
      {
        sequence: 1,
        kind: 'd1-sql',
        path: 'apply-responses/0001.json',
        artifactPath: 'sql/artist-0001.sql',
        execution: 'executed',
        expectedQueryCount: 5,
        actualQueryCount: 5,
      },
      {
        sequence: 2,
        kind: 'image-vectors',
        path: 'apply-responses/0002.json',
        artifactPath: 'vectors/artist-0001.ndjson',
        execution: 'executed',
        expectedQueryCount: undefined,
        actualQueryCount: undefined,
      },
    ]
  );
  for (const response of verification.applyResponses) {
    assert.match(response.sha256, /^[a-f0-9]{64}$/);
    const responsePath = join(passingOut, response.path);
    assert.equal(existsSync(responsePath), true);
    assert.equal(sha256(readFileSync(responsePath)), response.sha256);
    const captured = JSON.parse(readFileSync(responsePath, 'utf8'));
    assert.equal(captured.sequence, response.sequence);
    assert.equal(captured.kind, response.kind);
    assert.equal(captured.path, response.artifactPath);
    assert.equal(captured.status, 0);
  }
  assert.deepEqual(verification.applyResponses[1].vectorMutation, {
    index: 'paillette-embeddings-v2-stg',
    count: 5,
    mutationId: '283fa906-9e2a-4fbe-a6b1-34617719f705',
  });
  assert.deepEqual(
    verification.settlement.attempts.map((attempt) => attempt.outcome),
    ['settled']
  );

  const failures = [
    {
      label: 'zero-query D1 execution',
      options: { d1QueryCount: 0 },
      pattern: /D1 quer(?:y|ies).*expected 5|expected 5.*D1 quer(?:y|ies)/i,
    },
    {
      label: 'partial D1 state',
      options: { mutateRows: (rows) => rows.slice(0, -1) },
      pattern: /post-apply.*(?:D1|coverage)/i,
    },
    {
      label: 'incomplete vector upsert',
      options: { mutateVectors: (rows) => rows.slice(0, -1) },
      pattern: /post-apply.*(?:vector|coverage)/i,
    },
    {
      label: 'changed unrelated field',
      options: {
        mutateRows: (rows) => [
          { ...rows[0], title: 'Unexpected drift' },
          ...rows.slice(1),
        ],
      },
      pattern: /unrelated D1 fields changed/i,
    },
  ];
  for (const fixture of failures) {
    const artifact = createArtifacts();
    const outDir = join(artifact.root, 'post-apply');
    const result = runApply({
      ...artifact,
      extra: ['--execute', `--post-apply-out-dir=${outDir}`],
      env: createMockPnpm(artifact, fixture.options),
    });
    assert.notEqual(result.status, 0, fixture.label);
    assert.match(result.stderr, fixture.pattern, fixture.label);
  }
});

test('accepts live-shaped prefixed D1 output and derives exact application-record changes from post-state', () => {
  const artifact = createArtifacts();
  const outDir = join(artifact.root, 'post-apply');
  const result = runApply({
    ...artifact,
    extra: ['--execute', `--post-apply-out-dir=${outDir}`],
    env: createMockPnpm(artifact, {
      d1Changes: 11,
      d1QueryCount: 5,
      d1Prefix:
        '├ Checking if file needs uploading\n│\n├ 🌀 Uploading fixture.sql\n│ 🌀 Uploading complete.\n│\n',
    }),
  });

  assert.equal(result.status, 0, result.stderr);
  const verification = JSON.parse(
    readFileSync(join(outDir, 'verification.json'), 'utf8')
  );
  assert.equal(verification.schemaVersion, 'nga-post-apply-verification-v4');
  assert.deepEqual(verification.applySummary, {
    responseCount: 2,
    resumedResponseCount: 0,
    executedResponseCount: 2,
    d1ChunkCount: 1,
    expectedD1QueryCount: 5,
    actualD1QueryCount: 5,
    vectorChunkCount: 1,
    expectedVectorCount: 5,
    actualVectorCount: 5,
    vectorMutationIds: ['283fa906-9e2a-4fbe-a6b1-34617719f705'],
    expectedApplicationRecordChanges: 5,
    verifiedApplicationRecordChanges: 5,
  });
  assert.deepEqual(verification.applyResponses[0].telemetry, {
    changes: [11],
    rowsRead: [10],
    rowsWritten: [15],
    changedDb: [true],
    finalBookmarks: ['00000000-0000000a-00004c16-00000000'],
  });
});

test('rejects vector responses without exact index count and one mutation identity', () => {
  const fixtures = [
    {
      label: 'missing mutation identity',
      stdout: JSON.stringify({
        index: 'paillette-embeddings-v2-stg',
        count: 5,
      }),
    },
    {
      label: 'wrong index',
      stdout:
        "✨ Enqueued 5 vectors into index 'other-index' for upsertion. Mutation changeset identifier: 283fa906-9e2a-4fbe-a6b1-34617719f705\n" +
        JSON.stringify({ index: 'other-index', count: 5 }),
    },
    {
      label: 'wrong count',
      stdout:
        "✨ Enqueued 4 vectors into index 'paillette-embeddings-v2-stg' for upsertion. Mutation changeset identifier: 283fa906-9e2a-4fbe-a6b1-34617719f705\n" +
        JSON.stringify({ index: 'paillette-embeddings-v2-stg', count: 4 }),
    },
    {
      label: 'duplicate mutation identity',
      stdout:
        "✨ Enqueued 5 vectors into index 'paillette-embeddings-v2-stg' for upsertion. Mutation changeset identifier: 283fa906-9e2a-4fbe-a6b1-34617719f705\nMutation changeset identifier: 00000000-0000-4000-8000-000000000000\n" +
        JSON.stringify({
          index: 'paillette-embeddings-v2-stg',
          count: 5,
        }),
    },
  ];

  for (const fixture of fixtures) {
    const artifact = createArtifacts();
    const result = runApply({
      ...artifact,
      extra: [
        '--execute',
        `--post-apply-out-dir=${join(artifact.root, 'post-apply')}`,
      ],
      env: createMockPnpm(artifact, { vectorStdout: fixture.stdout }),
    });
    assert.notEqual(result.status, 0, fixture.label);
    assert.match(result.stderr, /vector.*(?:index|count|mutation)/i, fixture.label);
  }
});

test('polls stale vector state until settled without re-executing mutations', () => {
  const artifact = createArtifacts();
  const d1Marker = join(artifact.root, 'd1-called');
  const vectorMarker = join(artifact.root, 'vector-called');
  const vectorReadMarker = join(artifact.root, 'vector-read');
  const outDir = join(artifact.root, 'post-apply');
  const result = runApply({
    ...artifact,
    extra: [
      '--execute',
      '--settlement-timeout-ms=500',
      '--settlement-poll-ms=1',
      `--post-apply-out-dir=${outDir}`,
    ],
    env: {
      ...createMockPnpm(artifact, { staleVectorReads: 1 }),
      NGA_APPLY_TEST_D1_MARKER: d1Marker,
      NGA_APPLY_TEST_VECTOR_MARKER: vectorMarker,
      NGA_APPLY_TEST_VECTOR_READ_MARKER: vectorReadMarker,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(d1Marker, 'utf8'), 'd1\n');
  assert.equal(readFileSync(vectorMarker, 'utf8'), 'vector\n');
  assert.equal(readFileSync(vectorReadMarker, 'utf8'), 'read\nread\n');
  const verification = JSON.parse(
    readFileSync(join(outDir, 'verification.json'), 'utf8')
  );
  assert.equal(verification.schemaVersion, 'nga-post-apply-verification-v4');
  assert.deepEqual(
    verification.settlement.attempts.map((attempt) => attempt.outcome),
    ['pending', 'settled']
  );
  assert.equal(
    existsSync(join(outDir, 'settlement-attempts/0001/state-manifest.json')),
    true
  );
  assert.equal(
    existsSync(join(outDir, 'settlement-attempts/0002/state-manifest.json')),
    true
  );
});

test('times out pending settlement without re-executing mutations', () => {
  const artifact = createArtifacts();
  const d1Marker = join(artifact.root, 'd1-called');
  const vectorMarker = join(artifact.root, 'vector-called');
  const vectorReadMarker = join(artifact.root, 'vector-read');
  const outDir = join(artifact.root, 'post-apply');
  const result = runApply({
    ...artifact,
    extra: [
      '--execute',
      '--settlement-timeout-ms=20',
      '--settlement-poll-ms=1',
      `--post-apply-out-dir=${outDir}`,
    ],
    env: {
      ...createMockPnpm(artifact, { staleVectorReads: 100 }),
      NGA_APPLY_TEST_D1_MARKER: d1Marker,
      NGA_APPLY_TEST_VECTOR_MARKER: vectorMarker,
      NGA_APPLY_TEST_VECTOR_READ_MARKER: vectorReadMarker,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /settlement.*timeout/i);
  assert.equal(readFileSync(d1Marker, 'utf8'), 'd1\n');
  assert.equal(readFileSync(vectorMarker, 'utf8'), 'vector\n');
  assert.equal(existsSync(join(outDir, 'settlement-timeout.json')), true);
  assert.equal(existsSync(join(outDir, 'verification.json')), false);
  assert.ok(
    readFileSync(vectorReadMarker, 'utf8').trim().split('\n').length >= 1
  );
});

test('rejects absent, malformed, trailing, failed, or wrong-query-count D1 payloads', () => {
  const fixtures = [
    {
      label: 'absent JSON payload',
      stdout: '├ Checking only\n',
      pattern: /D1 apply response.*JSON|JSON payload/i,
    },
    {
      label: 'malformed JSON payload',
      stdout: '├ Checking\n[{',
      pattern: /D1 apply response.*JSON|JSON payload/i,
    },
    {
      label: 'trailing payload',
      stdout: `${liveD1Stdout()}\ntrailing`,
      pattern: /D1 apply response.*JSON|trailing/i,
    },
    {
      label: 'failed result',
      stdout: liveD1Stdout().replace('"success":true', '"success":false'),
      pattern: /D1 apply response.*success/i,
    },
    {
      label: 'wrong query count',
      stdout: liveD1Stdout({ queryCount: 4 }),
      pattern: /quer(?:y|ies).*expected 5|expected 5.*quer(?:y|ies)/i,
    },
    {
      label: 'misplaced query count',
      stdout: JSON.stringify([
        {
          results: [],
          success: true,
          meta: { 'Total queries executed': 5 },
        },
      ]),
      pattern: /exactly one direct query-count fact/i,
    },
    {
      label: 'split query count facts',
      stdout: JSON.stringify([
        {
          results: [
            { 'Total queries executed': 2 },
            { 'Total queries executed': 3 },
          ],
          success: true,
        },
      ]),
      pattern: /exactly one direct query-count fact/i,
    },
    {
      label: 'split top-level results',
      stdout: JSON.stringify([
        {
          results: [{ 'Total queries executed': 2 }],
          success: true,
        },
        {
          results: [{ 'Total queries executed': 3 }],
          success: true,
        },
      ]),
      pattern: /exactly one successful result/i,
    },
  ];
  for (const fixture of fixtures) {
    const artifact = createArtifacts();
    const bin = join(artifact.root, 'bin');
    mkdirSync(bin);
    const mock = `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
if (args.includes('d1 execute') && args.includes('--file')) {
  process.stdout.write(process.env.NGA_APPLY_TEST_D1_STDOUT);
} else {
  process.stderr.write('unexpected command after invalid D1 response');
  process.exit(2);
}
`;
    const command = join(bin, 'pnpm');
    writeFileSync(command, mock);
    chmodSync(command, 0o755);
    const result = runApply({
      ...artifact,
      extra: [
        '--execute',
        `--post-apply-out-dir=${join(artifact.root, 'post-apply')}`,
      ],
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        NGA_APPLY_TEST_D1_STDOUT: fixture.stdout,
      },
    });
    assert.notEqual(result.status, 0, fixture.label);
    assert.match(result.stderr, fixture.pattern, fixture.label);
  }
});

test('resumes an exact successful D1 prefix without re-executing it and executes the vector suffix once', () => {
  const artifact = createArtifacts();
  const resumeDirectory = createResumeResponseDirectory(artifact);
  const outDir = join(artifact.root, 'post-apply');
  const d1Marker = join(artifact.root, 'd1-called');
  const vectorMarker = join(artifact.root, 'vector-called');
  const result = runApply({
    ...artifact,
    extra: [
      '--execute',
      `--post-apply-out-dir=${outDir}`,
      ...resumeArguments(artifact, resumeDirectory),
    ],
    env: {
      ...createMockPnpm(artifact),
      NGA_APPLY_TEST_D1_MARKER: d1Marker,
      NGA_APPLY_TEST_VECTOR_MARKER: vectorMarker,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    existsSync(d1Marker),
    false,
    'resumed D1 must not execute again'
  );
  assert.equal(readFileSync(vectorMarker, 'utf8'), 'vector\n');
  const verification = JSON.parse(
    readFileSync(join(outDir, 'verification.json'), 'utf8')
  );
  assert.equal(verification.schemaVersion, 'nga-post-apply-verification-v4');
  assert.equal(verification.applyResponses[0].execution, 'resumed');
  assert.equal(verification.applyResponses[1].execution, 'executed');
  assert.deepEqual(verification.applyResponses[0].source, {
    path: 'resume-responses/0001.json',
    sha256: sha256(readFileSync(join(resumeDirectory, '0001.json'))),
  });
  assert.deepEqual(verification.resumeLineage, {
    path: 'resume-lineage.json',
    sha256: sha256(readFileSync(join(artifact.root, 'resume-lineage.json'))),
  });
  for (const descriptor of verification.applyResponses) {
    assert.equal(
      sha256(readFileSync(join(outDir, descriptor.path))),
      descriptor.sha256
    );
  }
});

test('settle-only requires complete v2 provenance and executes no mutation command', () => {
  const artifact = createArtifacts();
  const resumeDirectory = addVectorResumeResponse(
    artifact,
    createResumeResponseDirectory(artifact)
  );
  const outDir = join(artifact.root, 'post-apply');
  const d1Marker = join(artifact.root, 'd1-called');
  const vectorMarker = join(artifact.root, 'vector-called');
  const vectorReadMarker = join(artifact.root, 'vector-read');
  const result = runApply({
    ...artifact,
    extra: [
      '--settle-only',
      '--settlement-timeout-ms=500',
      '--settlement-poll-ms=1',
      `--post-apply-out-dir=${outDir}`,
      ...resumeArguments(artifact, resumeDirectory),
    ],
    env: {
      ...createMockPnpm(artifact),
      NGA_APPLY_TEST_D1_MARKER: d1Marker,
      NGA_APPLY_TEST_VECTOR_MARKER: vectorMarker,
      NGA_APPLY_TEST_VECTOR_READ_MARKER: vectorReadMarker,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(d1Marker), false);
  assert.equal(existsSync(vectorMarker), false);
  assert.equal(
    existsSync(join(artifact.root, 'apply-responses')),
    false,
    'settle-only must not create a mutation-response run directory'
  );
  assert.equal(readFileSync(vectorReadMarker, 'utf8'), 'read\n');
  const verification = JSON.parse(
    readFileSync(join(outDir, 'verification.json'), 'utf8')
  );
  assert.equal(verification.schemaVersion, 'nga-post-apply-verification-v4');
  assert.equal(verification.applySummary.resumedResponseCount, 2);
  assert.equal(verification.applySummary.executedResponseCount, 0);
  assert.deepEqual(
    verification.applyResponses.map((response) => response.execution),
    ['resumed', 'resumed']
  );
});

test('prepares generic v2 provenance that settle-only can consume without mutations', () => {
  const artifact = createArtifacts();
  const preflightText = '{"fixture":"preflight"}\n';
  const manifest = JSON.parse(readFileSync(artifact.manifestPath, 'utf8'));
  manifest.preflightInputs[0].manifestSha256 = sha256(preflightText);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(artifact.manifestPath, manifestText);
  artifact.manifestSha256 = sha256(manifestText);

  const sourceRoot = join(
    artifact.root,
    'source',
    '.agent',
    'evidence',
    'nga-staging',
    'a'.repeat(40),
    '20260822T150634Z'
  );
  mkdirSync(join(sourceRoot, 'backfill', 'pilot'), { recursive: true });
  mkdirSync(join(sourceRoot, 'preflight', 'pilot'), { recursive: true });
  copyFileSync(
    artifact.manifestPath,
    join(sourceRoot, 'backfill', 'pilot', 'artifact-manifest.json')
  );
  writeFileSync(
    join(sourceRoot, 'preflight', 'pilot', 'preflight-manifest.json'),
    preflightText
  );
  const fixtureResponses = addVectorResumeResponse(
    artifact,
    createResumeResponseDirectory(artifact)
  );
  const sourceResponseRoot = join(
    sourceRoot,
    'backfill',
    'pilot',
    'apply-responses',
    'fixture-run'
  );
  mkdirSync(sourceResponseRoot, { recursive: true });
  for (const name of ['0001.json', '0002.json']) {
    copyFileSync(join(fixtureResponses, name), join(sourceResponseRoot, name));
  }
  const outDir = join(artifact.root, 'prepared-resume');
  const prepared = spawnSync(
    process.execPath,
    [
      prepareResumeScriptPath,
      '--phase=pilot',
      `--manifest=${artifact.manifestPath}`,
      `--confirm-manifest-sha256=${artifact.manifestSha256}`,
      `--source-evidence-root=${sourceRoot}`,
      '--response=backfill/pilot/apply-responses/fixture-run/0001.json',
      `--confirm-response-sha256=${sha256(readFileSync(join(sourceResponseRoot, '0001.json')))}`,
      '--response=backfill/pilot/apply-responses/fixture-run/0002.json',
      `--confirm-response-sha256=${sha256(readFileSync(join(sourceResponseRoot, '0002.json')))}`,
      `--out-dir=${outDir}`,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(prepared.status, 0, prepared.stderr);
  const preparedValue = JSON.parse(prepared.stdout);
  const applyOut = join(artifact.root, 'post-apply');
  const d1Marker = join(artifact.root, 'd1-called');
  const vectorMarker = join(artifact.root, 'vector-called');
  const settled = runApply({
    ...artifact,
    extra: [
      '--settle-only',
      '--settlement-timeout-ms=500',
      '--settlement-poll-ms=1',
      `--resume-response-dir=${preparedValue.responseDirectory}`,
      `--resume-lineage=${preparedValue.resumeLineage}`,
      `--confirm-resume-lineage-sha256=${preparedValue.resumeLineageSha256}`,
      `--post-apply-out-dir=${applyOut}`,
    ],
    env: {
      ...createMockPnpm(artifact),
      NGA_APPLY_TEST_D1_MARKER: d1Marker,
      NGA_APPLY_TEST_VECTOR_MARKER: vectorMarker,
    },
  });

  assert.equal(settled.status, 0, settled.stderr);
  assert.equal(existsSync(d1Marker), false);
  assert.equal(existsSync(vectorMarker), false);
});

test('prepares mixed parent and incident provenance with immutable prior attempts', () => {
  const artifact = createArtifacts();
  const preflightText = '{"fixture":"preflight"}\n';
  const manifest = JSON.parse(readFileSync(artifact.manifestPath, 'utf8'));
  manifest.preflightInputs[0].manifestSha256 = sha256(preflightText);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(artifact.manifestPath, manifestText);
  artifact.manifestSha256 = sha256(manifestText);

  const firstApply = join(artifact.root, 'first-apply');
  const mockEnvironment = createMockPnpm(artifact, { staleVectorReads: 1 });
  const localApply = runApply({
    ...artifact,
    extra: [
      '--execute',
      '--settlement-timeout-ms=500',
      '--settlement-poll-ms=1',
      `--post-apply-out-dir=${firstApply}`,
    ],
    env: {
      ...mockEnvironment,
      NGA_APPLY_TEST_VECTOR_READ_MARKER: join(artifact.root, 'vector-reads'),
    },
  });
  assert.equal(localApply.status, 0, localApply.stderr);

  const sourceGitSha = 'b'.repeat(40);
  const sourceRoot = join(
    artifact.root,
    'source',
    '.agent',
    'evidence',
    'nga-staging',
    sourceGitSha,
    '20260822T150634Z'
  );
  mkdirSync(join(sourceRoot, 'backfill', 'pilot'), { recursive: true });
  mkdirSync(join(sourceRoot, 'preflight', 'pilot'), { recursive: true });
  copyFileSync(
    artifact.manifestPath,
    join(sourceRoot, 'backfill', 'pilot', 'artifact-manifest.json')
  );
  writeFileSync(
    join(sourceRoot, 'preflight', 'pilot', 'preflight-manifest.json'),
    preflightText
  );
  const d1Relative =
    'backfill/pilot/apply-responses/2026-08-22T13-49-24-534Z-1855/0001.json';
  const vectorRelative =
    'backfill/pilot/apply-responses/2026-08-22T15-09-40-358Z-88212/0002.json';
  for (const [relativePath, name] of [
    [d1Relative, '0001.json'],
    [vectorRelative, '0002.json'],
  ]) {
    const target = join(sourceRoot, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(firstApply, 'apply-responses', name), target);
  }
  cpSync(
    join(firstApply, 'settlement-attempts', '0001'),
    join(sourceRoot, 'candidate', 'post-apply', 'pilot'),
    { recursive: true }
  );
  cpSync(
    join(firstApply, 'settlement-attempts', '0002'),
    join(sourceRoot, 'candidate', 'diagnostic-after-vector-processed'),
    { recursive: true }
  );
  const d1Sha = sha256(readFileSync(join(sourceRoot, d1Relative)));
  const vectorSha = sha256(readFileSync(join(sourceRoot, vectorRelative)));
  const parent = {
    schemaVersion: 'nga-apply-resume-lineage-v1',
    sourceGitSha: 'c'.repeat(40),
    sourceEvidenceRoot: `.agent/evidence/nga-staging/${'c'.repeat(40)}/20260822T134448Z`,
    artifactManifest: {
      sourcePath: 'backfill/pilot/artifact-manifest.json',
      sha256: artifact.manifestSha256,
    },
    preflightManifests: [
      {
        phase: 'pilot',
        sourcePath: 'preflight/pilot/preflight-manifest.json',
        sha256: sha256(preflightText),
      },
    ],
    responses: [
      {
        sequence: 1,
        sourcePath: d1Relative,
        copiedPath: d1Relative.replace('backfill/pilot/', ''),
        sha256: d1Sha,
      },
    ],
  };
  const parentText = `${JSON.stringify(parent, null, 2)}\n`;
  const parentRelative = 'backfill/pilot/resume-lineage.json';
  writeFileSync(join(sourceRoot, parentRelative), parentText);
  const immediateRelative = 'candidate/post-apply/pilot/state-manifest.json';
  const settledRelative =
    'candidate/diagnostic-after-vector-processed/state-manifest.json';
  const immediateStateDocument = JSON.parse(
    readFileSync(join(sourceRoot, immediateRelative), 'utf8')
  );
  const settledStateDocument = JSON.parse(
    readFileSync(join(sourceRoot, settledRelative), 'utf8')
  );
  const immediateVectorSha =
    immediateStateDocument.inputs.imageVectors[0].sha256;
  const settledVectorSha = settledStateDocument.inputs.imageVectors[0].sha256;
  const incident = {
    schemaVersion: 'nga-vector-settlement-incident-v1',
    recordedAt: new Date(
      Date.parse(settledStateDocument.capturedAt) + 1000
    ).toISOString(),
    gitSha: sourceGitSha,
    status: 'paused-after-single-vector-upsert-before-official-verification',
    stagingMutation: {
      d1CommandsExecutedThisResume: 0,
      vectorUpsertCommandsExecutedThisResume: 1,
      vectorCount: 5,
      mutationId: '283fa906-9e2a-4fbe-a6b1-34617719f705',
      rawResponse: { path: vectorRelative, sha256: vectorSha },
    },
    immediateCapture: {
      path: immediateRelative,
      sha256: sha256(readFileSync(join(sourceRoot, immediateRelative))),
      vectorSha256: immediateVectorSha,
      interpretation: 'stale pre-upsert vector representation',
    },
    settledDiagnostic: {
      path: settledRelative,
      sha256: sha256(readFileSync(join(sourceRoot, settledRelative))),
      d1Sha256: settledStateDocument.inputs.stagedRecords.sha256,
      vectorSha256: settledVectorSha,
      expectedEnrichedVectorSha256: settledVectorSha,
      recordCount: 5,
    },
    boundaries: {
      fullBackfillStarted: false,
      productionChanged: false,
      cachePurged: false,
      nextExternalMutationAllowed: false,
    },
  };
  const incidentText = `${JSON.stringify(incident, null, 2)}\n`;
  writeFileSync(join(sourceRoot, 'VECTOR_SETTLEMENT_INCIDENT.json'), incidentText);
  const outDir = join(artifact.root, 'mixed-resume');
  const prepared = spawnSync(
    process.execPath,
    [
      prepareResumeScriptPath,
      '--phase=pilot',
      `--manifest=${artifact.manifestPath}`,
      `--confirm-manifest-sha256=${artifact.manifestSha256}`,
      `--source-evidence-root=${sourceRoot}`,
      `--response=${d1Relative}`,
      `--confirm-response-sha256=${d1Sha}`,
      `--response=${vectorRelative}`,
      `--confirm-response-sha256=${vectorSha}`,
      `--parent-lineage=${parentRelative}`,
      `--confirm-parent-lineage-sha256=${sha256(parentText)}`,
      '--incident=VECTOR_SETTLEMENT_INCIDENT.json',
      `--confirm-incident-sha256=${sha256(incidentText)}`,
      `--out-dir=${outDir}`,
    ],
    { encoding: 'utf8' }
  );

  assert.equal(prepared.status, 0, prepared.stderr);
  const lineage = JSON.parse(
    readFileSync(join(outDir, 'resume-lineage.json'), 'utf8')
  );
  assert.equal(lineage.responses[0].parentLineage, 1);
  assert.equal(lineage.responses[1].incident, 'vector-settlement');
  assert.deepEqual(
    lineage.priorSettlementEvidence.attempts.map((attempt) => attempt.kind),
    ['immediate', 'settled-diagnostic']
  );
  const preparedValue = JSON.parse(prepared.stdout);
  const settleOut = join(artifact.root, 'settled-from-mixed');
  const settled = runApply({
    ...artifact,
    extra: [
      '--settle-only',
      '--settlement-timeout-ms=500',
      '--settlement-poll-ms=1',
      `--resume-response-dir=${preparedValue.responseDirectory}`,
      `--resume-lineage=${preparedValue.resumeLineage}`,
      `--confirm-resume-lineage-sha256=${preparedValue.resumeLineageSha256}`,
      `--post-apply-out-dir=${settleOut}`,
    ],
    env: {
      ...mockEnvironment,
      NGA_APPLY_TEST_VECTOR_SNAPSHOTS: JSON.stringify([
        JSON.parse(mockEnvironment.NGA_APPLY_TEST_VECTOR_SNAPSHOTS).at(-1),
      ]),
      NGA_APPLY_TEST_VECTOR_READ_MARKER: '',
    },
  });
  assert.equal(settled.status, 0, settled.stderr);
  assert.equal(
    JSON.parse(readFileSync(join(settleOut, 'verification.json'), 'utf8'))
      .settlement.attemptCount,
    1,
    'prior diagnostic evidence must not substitute for a fresh capture'
  );

  incident.stagingMutation.rawResponse.sha256 = d1Sha;
  const mixedIncidentText = `${JSON.stringify(incident, null, 2)}\n`;
  writeFileSync(
    join(sourceRoot, 'VECTOR_SETTLEMENT_INCIDENT.json'),
    mixedIncidentText
  );
  const mixed = spawnSync(
    process.execPath,
    [
      prepareResumeScriptPath,
      '--phase=pilot',
      `--manifest=${artifact.manifestPath}`,
      `--confirm-manifest-sha256=${artifact.manifestSha256}`,
      `--source-evidence-root=${sourceRoot}`,
      `--response=${d1Relative}`,
      `--confirm-response-sha256=${d1Sha}`,
      `--response=${vectorRelative}`,
      `--confirm-response-sha256=${vectorSha}`,
      `--parent-lineage=${parentRelative}`,
      `--confirm-parent-lineage-sha256=${sha256(parentText)}`,
      '--incident=VECTOR_SETTLEMENT_INCIDENT.json',
      `--confirm-incident-sha256=${sha256(mixedIncidentText)}`,
      `--out-dir=${join(artifact.root, 'mixed-invalid')}`,
    ],
    { encoding: 'utf8' }
  );
  assert.notEqual(mixed.status, 0);
  assert.match(mixed.stderr, /incident.*response|mixed.*provenance/i);

  const immediatePath = join(sourceRoot, immediateRelative);
  const immediateState = JSON.parse(readFileSync(immediatePath, 'utf8'));
  const originalIdsPath = join(
    dirname(immediatePath),
    immediateState.inputs.ids.path
  );
  const escapedSource = join(sourceRoot, 'escaped-ids.json');
  copyFileSync(originalIdsPath, escapedSource);
  immediateState.inputs.ids.path = '../../../../escaped-ids.json';
  immediateState.inputs.ids.sha256 = sha256(readFileSync(escapedSource));
  immediateState.hashes.ids = immediateState.inputs.ids.sha256;
  const unsafeStateText = `${JSON.stringify(immediateState, null, 2)}\n`;
  writeFileSync(immediatePath, unsafeStateText);
  incident.stagingMutation.rawResponse.sha256 = vectorSha;
  incident.immediateCapture.sha256 = sha256(unsafeStateText);
  const unsafeIncidentText = `${JSON.stringify(incident, null, 2)}\n`;
  writeFileSync(
    join(sourceRoot, 'VECTOR_SETTLEMENT_INCIDENT.json'),
    unsafeIncidentText
  );
  const unsafeOut = join(artifact.root, 'unsafe-prior-path');
  const escapedDestination = join(artifact.root, 'escaped-ids.json');
  const unsafe = spawnSync(
    process.execPath,
    [
      prepareResumeScriptPath,
      '--phase=pilot',
      `--manifest=${artifact.manifestPath}`,
      `--confirm-manifest-sha256=${artifact.manifestSha256}`,
      `--source-evidence-root=${sourceRoot}`,
      `--response=${d1Relative}`,
      `--confirm-response-sha256=${d1Sha}`,
      `--response=${vectorRelative}`,
      `--confirm-response-sha256=${vectorSha}`,
      `--parent-lineage=${parentRelative}`,
      `--confirm-parent-lineage-sha256=${sha256(parentText)}`,
      '--incident=VECTOR_SETTLEMENT_INCIDENT.json',
      `--confirm-incident-sha256=${sha256(unsafeIncidentText)}`,
      `--out-dir=${unsafeOut}`,
    ],
    { encoding: 'utf8' }
  );
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /state input path.*unsafe|escapes/i);
  assert.equal(existsSync(escapedDestination), false);
});

test('rejects truncated parent ancestry and a replayed settled incident state', () => {
  const manifestSha256 = 'a'.repeat(64);
  const preflightManifests = [
    {
      phase: 'pilot',
      sourcePath: 'preflight/pilot/preflight-manifest.json',
      sha256: 'b'.repeat(64),
    },
  ];
  assert.throws(
    () =>
      validateNgaApplyResumeLineageV1(
        {
          schemaVersion: 'nga-apply-resume-lineage-v1',
          artifactManifest: {
            sourcePath: 'backfill/pilot/artifact-manifest.json',
            sha256: manifestSha256,
          },
          responses: [{ sequence: 1, sha256: 'c'.repeat(64) }],
        },
        { phase: 'pilot', artifactManifestSha256: manifestSha256, preflightManifests }
      ),
    /parent lineage v1 contract/i
  );

  const completeParent = {
    schemaVersion: 'nga-apply-resume-lineage-v1',
    sourceGitSha: 'f'.repeat(40),
    sourceEvidenceRoot: `.agent/evidence/nga-staging/${'f'.repeat(40)}/20260822T150634Z`,
    artifactManifest: {
      sourcePath: 'backfill/pilot/artifact-manifest.json',
      sha256: manifestSha256,
    },
    preflightManifests,
    responses: [
      {
        sequence: 1,
        sourcePath:
          'backfill/pilot/apply-responses/unexpected/nested/0001.json',
        copiedPath: 'apply-responses/unexpected/nested/0001.json',
        sha256: 'c'.repeat(64),
      },
    ],
  };
  assert.throws(
    () =>
      validateNgaApplyResumeLineageV1(completeParent, {
        phase: 'pilot',
        artifactManifestSha256: manifestSha256,
        preflightManifests,
      }),
    /response contract/i
  );

  const vectorSha256 = 'd'.repeat(64);
  const state = {
    capturedAt: '2026-08-22T15:11:01.833Z',
    counts: { imageVectors: 5 },
    inputs: {
      stagedRecords: { sha256: 'e'.repeat(64) },
      imageVectors: [{ sha256: vectorSha256 }],
    },
  };
  assert.throws(
    () =>
      validateNgaVectorSettlementIncidentV1(
        {
          schemaVersion: 'nga-vector-settlement-incident-v1',
          recordedAt: '2026-08-22T15:12:55.928Z',
          gitSha: 'f'.repeat(40),
          status:
            'paused-after-single-vector-upsert-before-official-verification',
          stagingMutation: {
            d1CommandsExecutedThisResume: 0,
            vectorUpsertCommandsExecutedThisResume: 1,
            vectorCount: 5,
            mutationId: '283fa906-9e2a-4fbe-a6b1-34617719f705',
            rawResponse: { path: 'response/0002.json', sha256: '1'.repeat(64) },
          },
          immediateCapture: {
            path: 'immediate/state-manifest.json',
            sha256: '2'.repeat(64),
            vectorSha256,
            interpretation: 'stale pre-upsert vector representation',
          },
          settledDiagnostic: {
            path: 'settled/state-manifest.json',
            sha256: '3'.repeat(64),
            d1Sha256: 'e'.repeat(64),
            vectorSha256,
            expectedEnrichedVectorSha256: vectorSha256,
            recordCount: 5,
          },
          boundaries: {
            fullBackfillStarted: false,
            productionChanged: false,
            cachePurged: false,
            nextExternalMutationAllowed: false,
          },
        },
        {
          sourceGitSha: 'f'.repeat(40),
          expectedVectorCount: 5,
          vectorResponse: {
            path: 'response/0002.json',
            sha256: '1'.repeat(64),
            mutationId: '283fa906-9e2a-4fbe-a6b1-34617719f705',
          },
          immediateState: state,
          settledState: state,
          immediateOutcome: 'settled',
          settledOutcome: 'settled',
        }
      ),
    /incident lifecycle/i
  );
});

test('resume requires current complete D1 state before it can verify success', () => {
  const artifact = createArtifacts();
  const resumeDirectory = createResumeResponseDirectory(artifact);
  const d1Marker = join(artifact.root, 'd1-called');
  const vectorMarker = join(artifact.root, 'vector-called');
  const result = runApply({
    ...artifact,
    extra: [
      '--execute',
      `--post-apply-out-dir=${join(artifact.root, 'post-apply')}`,
      ...resumeArguments(artifact, resumeDirectory),
    ],
    env: {
      ...createMockPnpm(artifact, {
        mutateRows: (_rows, originals) => originals,
      }),
      NGA_APPLY_TEST_D1_MARKER: d1Marker,
      NGA_APPLY_TEST_VECTOR_MARKER: vectorMarker,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /post-apply primary artist mismatch/i);
  assert.equal(
    existsSync(d1Marker),
    false,
    'resumed D1 must not execute again'
  );
  assert.equal(readFileSync(vectorMarker, 'utf8'), 'vector\n');
});

test('rejects unsafe, tampered, gapped, or mismatched resume prefixes', () => {
  const fixtures = [
    {
      label: 'failed status',
      mutate: (value) => ({ ...value, status: 1 }),
      pattern: /resume.*(?:status|successful|apply step)/i,
    },
    {
      label: 'wrong step path',
      mutate: (value) => ({ ...value, path: 'sql/other.sql' }),
      pattern: /resume.*(?:path|step|mismatch)/i,
    },
    {
      label: 'wrong query count',
      mutate: (value) => ({
        ...value,
        stdout: liveD1Stdout({ queryCount: 4 }),
      }),
      pattern: /resume.*quer(?:y|ies)|quer(?:y|ies).*expected 5/i,
    },
  ];
  for (const fixture of fixtures) {
    const artifact = createArtifacts();
    const resumeDirectory = createResumeResponseDirectory(
      artifact,
      fixture.mutate
    );
    const marker = join(artifact.root, 'd1-called');
    const result = runApply({
      ...artifact,
      extra: [
        '--execute',
        `--post-apply-out-dir=${join(artifact.root, 'post-apply')}`,
        ...resumeArguments(artifact, resumeDirectory),
      ],
      env: {
        ...createMockPnpm(artifact),
        NGA_APPLY_TEST_D1_MARKER: marker,
      },
    });
    assert.notEqual(result.status, 0, fixture.label);
    assert.match(result.stderr, fixture.pattern, fixture.label);
    assert.equal(existsSync(marker), false, fixture.label);
  }

  const gapArtifact = createArtifacts();
  const gapDirectory = createResumeResponseDirectory(gapArtifact);
  const gapResumeArguments = resumeArguments(gapArtifact, gapDirectory);
  renameSync(join(gapDirectory, '0001.json'), join(gapDirectory, '0002.json'));
  const gap = runApply({
    ...gapArtifact,
    extra: [
      '--execute',
      `--post-apply-out-dir=${join(gapArtifact.root, 'post-apply')}`,
      ...gapResumeArguments,
    ],
  });
  assert.notEqual(gap.status, 0);
  assert.match(gap.stderr, /resume.*(?:gap|contiguous|0001)/i);

  const extraArtifact = createArtifacts();
  const extraDirectory = createResumeResponseDirectory(extraArtifact);
  writeFileSync(join(extraDirectory, 'extra.json'), '{}\n');
  const extra = runApply({
    ...extraArtifact,
    extra: [
      '--execute',
      `--post-apply-out-dir=${join(extraArtifact.root, 'post-apply')}`,
      ...resumeArguments(extraArtifact, extraDirectory),
    ],
  });
  assert.notEqual(extra.status, 0);
  assert.match(extra.stderr, /resume.*(?:extra|inventory)/i);

  const symlinkArtifact = createArtifacts();
  const realDirectory = createResumeResponseDirectory(symlinkArtifact);
  const symlinkDirectory = join(symlinkArtifact.root, 'resume-link');
  symlinkSync(realDirectory, symlinkDirectory, 'dir');
  const symlinked = runApply({
    ...symlinkArtifact,
    extra: [
      '--execute',
      `--post-apply-out-dir=${join(symlinkArtifact.root, 'post-apply')}`,
      ...resumeArguments(symlinkArtifact, realDirectory),
      `--resume-response-dir=${symlinkDirectory}`,
    ],
  });
  assert.notEqual(symlinked.status, 0);
  assert.match(symlinked.stderr, /resume.*symlink/i);

  const intermediateSymlinkArtifact = createArtifacts();
  const intermediateRealDirectory = createResumeResponseDirectory(
    intermediateSymlinkArtifact
  );
  const intermediateLink = join(
    intermediateSymlinkArtifact.root,
    'resume-parent-link'
  );
  symlinkSync(intermediateSymlinkArtifact.root, intermediateLink, 'dir');
  const intermediate = runApply({
    ...intermediateSymlinkArtifact,
    extra: [
      '--execute',
      `--post-apply-out-dir=${join(intermediateSymlinkArtifact.root, 'post-apply')}`,
      ...resumeArguments(
        intermediateSymlinkArtifact,
        intermediateRealDirectory
      ),
      `--resume-response-dir=${join(intermediateLink, 'resume-responses')}`,
    ],
  });
  assert.notEqual(intermediate.status, 0);
  assert.match(intermediate.stderr, /resume.*symlink/i);
});

test('resume requires hash-confirmed preserved-source lineage and rejects response tamper', () => {
  const missingArtifact = createArtifacts();
  const missingDirectory = createResumeResponseDirectory(missingArtifact);
  const missing = runApply({
    ...missingArtifact,
    extra: [
      '--execute',
      `--post-apply-out-dir=${join(missingArtifact.root, 'post-apply')}`,
      `--resume-response-dir=${missingDirectory}`,
    ],
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /resume.*lineage/i);

  const tamperedArtifact = createArtifacts();
  const tamperedDirectory = createResumeResponseDirectory(tamperedArtifact);
  const tamperedArgs = resumeArguments(tamperedArtifact, tamperedDirectory);
  const responsePath = join(tamperedDirectory, '0001.json');
  const response = JSON.parse(readFileSync(responsePath, 'utf8'));
  response.stderr = 'tampered after lineage confirmation';
  writeFileSync(responsePath, `${JSON.stringify(response, null, 2)}\n`);
  const tampered = runApply({
    ...tamperedArtifact,
    extra: [
      '--execute',
      `--post-apply-out-dir=${join(tamperedArtifact.root, 'post-apply')}`,
      ...tamperedArgs,
    ],
  });
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /resume.*(?:SHA-256|lineage|tamper)/i);

  const traversalArtifact = createArtifacts();
  const traversalDirectory = createResumeResponseDirectory(traversalArtifact);
  const traversal = runApply({
    ...traversalArtifact,
    extra: [
      '--execute',
      `--post-apply-out-dir=${join(traversalArtifact.root, 'post-apply')}`,
      ...resumeArguments(traversalArtifact, traversalDirectory, (lineage) => {
        lineage.responses[0].sourcePath =
          'backfill/pilot/apply-responses/../0001.json';
        return lineage;
      }),
    ],
    env: createMockPnpm(traversalArtifact),
  });
  assert.notEqual(traversal.status, 0);
  assert.match(traversal.stderr, /resume.*lineage/i);
});

test('rejects a changed support artifact bound into the manifest', () => {
  const artifact = createArtifacts();
  writeFileSync(join(artifact.root, 'mapping.json'), '[]\n');
  const result = runApply(artifact);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /artifact SHA-256 mismatch.*mapping\.json/i);
});
