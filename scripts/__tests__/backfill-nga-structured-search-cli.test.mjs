import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { spawnSync } from 'node:child_process';

const scriptPath = resolve('scripts/backfill-nga-structured-search.mjs');
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const record = (id) => ({
  id,
  date_text: '1510/1515',
  classification: 'Print',
  medium: 'woodcut on laid paper',
});

const createManifest = ({ candidateCount = 2, normalizedSamples } = {}) => {
  const directory = mkdtempSync(join(tmpdir(), 'paillette-nga-backfill-'));
  temporaryDirectories.push(directory);
  const manifestPath = join(directory, 'manifest.json');
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      providers: {
        nga: {
          candidateCount,
          normalizedSamples: normalizedSamples || [
            record('open-access-art:nga:1'),
          ],
        },
      },
    })}\n`
  );
  return { directory, manifestPath };
};

const runBackfill = (args) =>
  spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  });

const summaryFields = (summary) => ({
  sourceCandidateCount: summary.sourceCandidateCount,
  availableRecordCount: summary.availableRecordCount,
  recordCount: summary.recordCount,
  mode: summary.mode,
  sourceCoverageComplete: summary.sourceCoverageComplete,
});

test('rejects incomplete NGA manifest before it creates output', () => {
  const { directory, manifestPath } = createManifest();
  const outputDirectory = join(directory, 'output');

  const result = runBackfill([
    `--manifest=${manifestPath}`,
    `--out-dir=${outputDirectory}`,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /incomplete/i);
  assert.equal(existsSync(outputDirectory), false);
});

test('labels an incomplete NGA backfill as an explicit sample pilot', () => {
  const { directory, manifestPath } = createManifest();
  const outputDirectory = join(directory, 'output');

  const result = runBackfill([
    `--manifest=${manifestPath}`,
    '--sample-only',
    `--out-dir=${outputDirectory}`,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(outputDirectory), true);
  const summary = JSON.parse(
    readFileSync(join(outputDirectory, 'summary.json'), 'utf8')
  );
  assert.deepEqual(summaryFields(summary), {
    sourceCandidateCount: 2,
    availableRecordCount: 1,
    recordCount: 1,
    mode: 'sample',
    sourceCoverageComplete: false,
  });
});

test('writes a full NGA backfill when fallback closes source coverage', () => {
  const { directory, manifestPath } = createManifest();
  const outputDirectory = join(directory, 'output');
  const fallbackPlanPath = join(directory, 'fallback.json');
  writeFileSync(
    fallbackPlanPath,
    `${JSON.stringify({ records: [record('open-access-art:nga:2')] })}\n`
  );

  const result = runBackfill([
    `--manifest=${manifestPath}`,
    `--fallback-plan=${fallbackPlanPath}`,
    `--out-dir=${outputDirectory}`,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(outputDirectory), true);
  const summary = JSON.parse(
    readFileSync(join(outputDirectory, 'summary.json'), 'utf8')
  );
  assert.deepEqual(summaryFields(summary), {
    sourceCandidateCount: 2,
    availableRecordCount: 2,
    recordCount: 2,
    mode: 'full',
    sourceCoverageComplete: true,
  });
});

test('rejects invalid limit and SQL chunk-size values before writing output', () => {
  for (const [flag, value, message] of [
    ['limit', '-1', /nonnegative finite integer/],
    ['limit', '1.5', /nonnegative finite integer/],
    ['limit', '', /nonnegative finite integer/],
    ['sql-chunk-size', '0', /positive finite integer/],
  ]) {
    const { directory, manifestPath } = createManifest();
    const outputDirectory = join(directory, 'output');

    const result = runBackfill([
      `--manifest=${manifestPath}`,
      '--sample-only',
      `--${flag}=${value}`,
      `--out-dir=${outputDirectory}`,
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.equal(existsSync(outputDirectory), false);
  }
});

test('rejects duplicate fresh NGA IDs that cannot complete source coverage', () => {
  const { directory, manifestPath } = createManifest({
    normalizedSamples: [
      record('open-access-art:nga:1'),
      record('open-access-art:nga:1'),
    ],
  });
  const outputDirectory = join(directory, 'output');

  const result = runBackfill([
    `--manifest=${manifestPath}`,
    `--out-dir=${outputDirectory}`,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /incomplete/i);
  assert.equal(existsSync(outputDirectory), false);
});

test('rejects duplicate fallback NGA IDs that cannot complete source coverage', () => {
  const { directory, manifestPath } = createManifest({ candidateCount: 3 });
  const outputDirectory = join(directory, 'output');
  const fallbackPlanPath = join(directory, 'fallback.json');
  writeFileSync(
    fallbackPlanPath,
    `${JSON.stringify({
      records: [
        record('open-access-art:nga:2'),
        record('open-access-art:nga:2'),
      ],
    })}\n`
  );

  const result = runBackfill([
    `--manifest=${manifestPath}`,
    `--fallback-plan=${fallbackPlanPath}`,
    `--out-dir=${outputDirectory}`,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /incomplete/i);
  assert.equal(existsSync(outputDirectory), false);
});

test('rejects malformed NGA candidate counts in full and sample modes', () => {
  for (const candidateCount of [-1, '2', 'not-a-number', 1.5]) {
    for (const sampleOnly of [false, true]) {
      const { directory, manifestPath } = createManifest({ candidateCount });
      const outputDirectory = join(directory, 'output');
      const result = runBackfill([
        `--manifest=${manifestPath}`,
        ...(sampleOnly ? ['--sample-only'] : []),
        `--out-dir=${outputDirectory}`,
      ]);

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /candidateCount must be a nonnegative finite integer/
      );
      assert.equal(existsSync(outputDirectory), false);
    }
  }
});
