import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';

import {
  PILOT_OBJECT_IDS,
  STAGING_ORG_ID,
  sha256,
  validatePreflightBindings,
} from '../lib/nga-artist-backfill.mjs';

const scriptPath = resolve('scripts/capture-nga-artist-backfill-preflight.mjs');
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const createMockWrangler = () => {
  const root = mkdtempSync(join(tmpdir(), 'nga-capture-test-'));
  temporaryDirectories.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const rows = PILOT_OBJECT_IDS.map((objectId, index) => ({
    id: `open-access-art:nga:${objectId}`,
    org_id: STAGING_ORG_ID,
    primary_artist_id: null,
    title: `Original ${index}`,
    custom_metadata: JSON.stringify({ provider: 'nga', retained: index }),
    field_sources: JSON.stringify({ title: 'nga.objects' }),
  }));
  const vectors = rows.map((row, index) => ({
    id: row.id,
    values: [index, index + 0.5],
    metadata: { artworkId: row.id, provider: 'nga', retained: index },
  }));
  const mock = `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
if (args.includes('d1 time-travel info')) {
  process.stdout.write(JSON.stringify({ bookmark: '00000000-0000000a-00004c16-00000000', timestamp: '2026-08-22T00:00:00Z' }));
} else if (args.includes('d1 execute')) {
  process.stdout.write(JSON.stringify([{ results: JSON.parse(process.env.NGA_CAPTURE_TEST_ROWS) }]));
} else if (args.includes('vectorize get-vectors')) {
  if (process.env.NGA_CAPTURE_TEST_VECTOR_PREFIX) {
    process.stdout.write(process.env.NGA_CAPTURE_TEST_VECTOR_PREFIX + '\\n');
  }
  process.stdout.write(JSON.stringify({ vectors: JSON.parse(process.env.NGA_CAPTURE_TEST_VECTORS) }));
} else {
  process.stderr.write('unexpected mock command: ' + args);
  process.exit(2);
}
`;
  const command = join(bin, 'pnpm');
  writeFileSync(command, mock);
  chmodSync(command, 0o755);
  return { root, bin, rows, vectors };
};

test('accepts Wrangler Vectorize status text before the JSON payload', () => {
  const fixture = createMockWrangler();
  const outDir = join(fixture.root, 'prefixed-vector-output');
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      '--environment=staging',
      '--phase=pilot',
      `--out-dir=${outDir}`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixture.bin}:${process.env.PATH}`,
        NGA_CAPTURE_TEST_ROWS: JSON.stringify(fixture.rows),
        NGA_CAPTURE_TEST_VECTORS: JSON.stringify(fixture.vectors),
        NGA_CAPTURE_TEST_VECTOR_PREFIX: '📋 Fetching vectors...',
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(
    readFileSync(join(outDir, 'preflight-manifest.json'), 'utf8')
  );
  assert.equal(manifest.counts.imageVectors, PILOT_OBJECT_IDS.length);
});

test('captures and hash-binds a usable D1 recovery point before staged rows', async () => {
  const fixture = createMockWrangler();
  const outDir = join(fixture.root, 'preflight');
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      '--environment=staging',
      '--phase=pilot',
      `--out-dir=${outDir}`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixture.bin}:${process.env.PATH}`,
        NGA_CAPTURE_TEST_ROWS: JSON.stringify(fixture.rows),
        NGA_CAPTURE_TEST_VECTORS: JSON.stringify(fixture.vectors),
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const manifestPath = join(outDir, 'preflight-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const recovery = manifest.rollback.d1TimeTravel;
  const recoveryPath = join(outDir, recovery.path);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.captureKind, 'preflight');
  assert.equal(recovery.path, 'd1-time-travel.json');
  assert.equal(recovery.sha256, sha256(readFileSync(recoveryPath)));
  assert.equal(
    manifest.rollback.recoveryPoint.bookmark,
    '00000000-0000000a-00004c16-00000000'
  );

  await assert.doesNotReject(
    validatePreflightBindings({
      phase: 'pilot',
      expectedOrgId: STAGING_ORG_ID,
      preflightManifestPaths: [manifestPath],
      stagedRecordPaths: [join(outDir, 'staged-nga-records.json')],
      imageVectorPaths: [join(outDir, 'image-vectors')],
    })
  );

  writeFileSync(recoveryPath, '{"bookmark":"tampered"}\n');
  await assert.rejects(
    validatePreflightBindings({
      phase: 'pilot',
      expectedOrgId: STAGING_ORG_ID,
      preflightManifestPaths: [manifestPath],
      stagedRecordPaths: [join(outDir, 'staged-nga-records.json')],
      imageVectorPaths: [join(outDir, 'image-vectors')],
    }),
    /time-travel|rollback|SHA-256|digest mismatch/i
  );
});
