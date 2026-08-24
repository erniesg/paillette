import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  R2_BUCKET_ENV,
  R2_CREDENTIAL_NAMES,
  WRANGLER_AUTH_NAME,
  buildDryRunManifest,
  buildQueuePlan,
  buildR2ReadinessReport,
  uploadLedgerAssetsToR2,
} from '../lib/open-access-art.mjs';

describe('open access art proof helpers', () => {
  it('builds a bounded NGA dry-run manifest with R2 object keys', () => {
    const manifest = buildDryRunManifest({
      providers: ['nga'],
      sampleSize: 5,
      sampleCaption: 'any',
      now: '2026-06-29T00:00:00.000Z',
    });

    assert.equal(manifest.records.length, 5);
    assert.equal(manifest.summary.image_count, 5);
    assert.equal(manifest.summary.downloaded_bytes, 0);
    assert.equal(manifest.safety.uploads_performed, false);
    assert.equal(manifest.safety.d1_apply_performed, false);
    assert.equal(manifest.safety.queue_enqueue_performed, false);
    assert.equal(manifest.sample_caption.action, 'not_generated');
    for (const record of manifest.records) {
      assert.match(record.target.object_key, /^generated\/open-access\/nga\//u);
      assert.equal(record.target.bucket_env, R2_BUCKET_ENV);
      assert.equal(record.openaccess, true);
    }
  });

  it('records queue batch sizing and retry behavior without enqueueing', () => {
    const manifest = buildDryRunManifest({ sampleSize: 5 });
    const plan = buildQueuePlan(manifest, {
      limit: 5,
      batchSize: 2,
      maxAttempts: 3,
      assetMode: 'r2',
    });

    assert.equal(plan.enqueue, false);
    assert.equal(plan.queue.batch_size, 2);
    assert.equal(plan.queue.max_attempts, 3);
    assert.equal(plan.batches.length, 3);
    assert.deepEqual(
      plan.batches.map((batch) => batch.batch_size),
      [2, 2, 1]
    );
    assert.match(
      plan.queue.retry_behavior.retryable_failures.join(','),
      /upload_error/u
    );
  });

  it('blocks R2 readiness on missing bucket decision before secret checks', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'paillette-r2-no-config-'));
    try {
      const report = buildR2ReadinessReport({
        env: {},
        repoRoot,
        now: '2026-06-29T00:00:00.000Z',
      });

      assert.equal(report.status, 'blocked');
      assert.equal(report.exit_code, 4);
      assert.equal(report.blocked_reason, 'missing_human_bucket_decision');
      assert.ok(report.missing_names.includes(R2_BUCKET_ENV));
      for (const name of R2_CREDENTIAL_NAMES) {
        assert.ok(report.missing_names.includes(name));
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('uses tracked storage config for the non-secret bucket fallback', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'paillette-r2-readiness-'));
    try {
      mkdirSync(join(repoRoot, '.agent'));
      writeFileSync(
        join(repoRoot, '.agent/storage.yaml'),
        `object_storage:\n  provider: r2\n  bucket: paillette-assets-stg\n`,
        'utf8'
      );

      const report = buildR2ReadinessReport({
        env: {},
        repoRoot,
        now: '2026-06-29T00:00:00.000Z',
      });

      assert.equal(report.status, 'blocked');
      assert.equal(report.exit_code, 3);
      assert.equal(report.blocked_reason, 'missing_secret_or_auth_names');
      assert.equal(report.bucket_name, 'paillette-assets-stg');
      assert.equal(report.bucket_name_source, '.agent/storage.yaml');
      assert.equal(report.missing_names.includes(R2_BUCKET_ENV), false);
      assert.ok(report.present_names.includes(R2_BUCKET_ENV));
      for (const name of R2_CREDENTIAL_NAMES) {
        assert.ok(report.missing_names.includes(name));
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('allows trusted Wrangler auth without direct R2 credentials', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'paillette-r2-wrangler-'));
    const calls = [];
    try {
      mkdirSync(join(repoRoot, '.agent'));
      writeFileSync(
        join(repoRoot, '.agent/storage.yaml'),
        `object_storage:\n  provider: r2\n  bucket: paillette-assets-stg\n`,
        'utf8'
      );

      const report = buildR2ReadinessReport({
        env: {},
        repoRoot,
        uploadAuth: 'wrangler',
        now: '2026-06-29T00:00:00.000Z',
        runner: (command, args, options) => {
          calls.push({ command, args, cwd: options.cwd });
          return 'logged in';
        },
      });

      assert.equal(report.status, 'ready');
      assert.equal(report.exit_code, 0);
      assert.equal(report.upload_auth, 'wrangler');
      assert.equal(report.bucket_name, 'paillette-assets-stg');
      assert.equal(report.bucket_name_source, '.agent/storage.yaml');
      assert.deepEqual(report.missing_names, []);
      assert.ok(report.present_names.includes(WRANGLER_AUTH_NAME));
      assert.equal(report.auth_checks.wrangler.ready, true);
      assert.equal(report.auth_checks.wrangler.output_recorded, false);
      for (const name of R2_CREDENTIAL_NAMES) {
        assert.equal(report.required_names.credential_names.includes(name), false);
      }
      assert.deepEqual(calls.map((call) => call.args.slice(-2)), [
        ['wrangler', 'whoami'],
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('blocks Wrangler auth readiness when Wrangler is unavailable', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'paillette-r2-wrangler-missing-'));
    try {
      mkdirSync(join(repoRoot, '.agent'));
      writeFileSync(
        join(repoRoot, '.agent/storage.yaml'),
        `object_storage:\n  provider: r2\n  bucket: paillette-assets-stg\n`,
        'utf8'
      );

      const report = buildR2ReadinessReport({
        env: {},
        repoRoot,
        uploadAuth: 'wrangler',
        runner: () => {
          const error = new Error('wrangler missing');
          error.code = 'ENOENT';
          throw error;
        },
      });

      assert.equal(report.status, 'blocked');
      assert.equal(report.exit_code, 3);
      assert.ok(report.missing_names.includes(WRANGLER_AUTH_NAME));
      assert.equal(report.auth_checks.wrangler.ready, false);
      assert.equal(report.auth_checks.wrangler.error_code, 'ENOENT');
      assert.equal(report.auth_checks.wrangler.output_recorded, false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('reports only names and booleans when R2 readiness is present', () => {
    const env = {
      [R2_BUCKET_ENV]: 'example-bucket-value',
      CLOUDFLARE_ACCOUNT_ID: 'example-account-value',
      CLOUDFLARE_API_TOKEN: 'example-token-value',
      R2_ACCESS_KEY_ID: 'example-access-key',
      R2_SECRET_ACCESS_KEY: 'example-secret-key',
      R2_ENDPOINT: 'https://example-endpoint.test',
    };
    const report = buildR2ReadinessReport({
      env,
      now: '2026-06-29T00:00:00.000Z',
    });
    const reportText = JSON.stringify(report);

    assert.equal(report.exit_code, 0);
    assert.equal(report.status, 'ready');
    assert.deepEqual(report.missing_names, []);
    for (const value of Object.values(env)) {
      assert.equal(reportText.includes(value), false);
    }
    assert.equal(report.redaction_checks.report_contains_secret_values, false);
  });

  it('allows documented bucket names without treating them as secret leaks', () => {
    const env = {
      [R2_BUCKET_ENV]: 'paillette-assets-stg',
      CLOUDFLARE_ACCOUNT_ID: 'example-account-value',
      CLOUDFLARE_API_TOKEN: 'example-token-value',
      R2_ACCESS_KEY_ID: 'example-access-key',
      R2_SECRET_ACCESS_KEY: 'example-secret-key',
      R2_ENDPOINT: 'https://example-endpoint.test',
    };
    const report = buildR2ReadinessReport({
      env,
      now: '2026-06-29T00:00:00.000Z',
    });
    const reportText = JSON.stringify(report);

    assert.equal(report.exit_code, 0);
    assert.equal(report.status, 'ready');
    assert.equal(report.redaction_checks.report_contains_secret_values, false);
    assert.ok(reportText.includes('paillette-assets-stg'));
    for (const [name, value] of Object.entries(env)) {
      if (name === R2_BUCKET_ENV) continue;
      assert.equal(reportText.includes(value), false);
    }
  });

  it('uploads through Wrangler with the bounded R2 command shape', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'paillette-r2-wrangler-upload-'));
    const calls = [];
    try {
      mkdirSync(join(repoRoot, '.agent'));
      writeFileSync(
        join(repoRoot, '.agent/storage.yaml'),
        `object_storage:\n  provider: r2\n  bucket: paillette-assets-stg\n`,
        'utf8'
      );
      const imagePath = join(repoRoot, 'sample.jpg');
      writeFileSync(imagePath, Buffer.from('fake image bytes'));
      const ledger = {
        records: [
          {
            id: 'nga:17387:test',
            target_object_key: 'generated/open-access/nga/17387/test.jpg',
            content_type: 'image/jpeg',
            download: {
              status: 'downloaded',
              path: imagePath,
              content_type: 'image/jpeg',
            },
            upload: {
              status: 'not_requested',
              object_key: 'generated/open-access/nga/17387/test.jpg',
              r2_bucket_env: R2_BUCKET_ENV,
              etag: null,
              error: null,
            },
          },
        ],
      };

      const uploaded = await uploadLedgerAssetsToR2(ledger, {
        uploadAuth: 'wrangler',
        uploadLimit: 1,
        repoRoot,
        env: {},
        runner: (command, args, options) => {
          calls.push({ command, args, cwd: options.cwd });
          return '';
        },
      });

      assert.equal(uploaded.records[0].upload.status, 'uploaded');
      assert.equal(uploaded.records[0].upload.upload_auth, 'wrangler');
      assert.equal(uploaded.records[0].upload.bytes, 'fake image bytes'.length);
      assert.deepEqual(calls, [
        {
          command: 'pnpm',
          args: [
            '--dir',
            'apps/api',
            'exec',
            'wrangler',
            'r2',
            'object',
            'put',
            'paillette-assets-stg/generated/open-access/nga/17387/test.jpg',
            '--file',
            imagePath,
            '--content-type',
            'image/jpeg',
          ],
          cwd: repoRoot,
        },
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
