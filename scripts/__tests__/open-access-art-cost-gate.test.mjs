import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { buildOpenAccessCostGate } from '../lib/open-access-art-cost-gate.mjs';

const sampleManifest = {
  collection: {
    slug: 'open-access-art',
    name: 'Open Access Art',
  },
  totals: {
    candidateCount: 63_228,
    captionCoverage: {
      total: 63_228,
      withInstitutionCaption: 61_701,
      missingInstitutionCaption: 1_527,
    },
  },
  costs: {
    jina: {
      model: 'jina-clip-v2',
      tokensPerImage: 4000,
      imageEmbeddingTokens: 252_912_000,
    },
    vectorize: {
      totalStoredDimensions: 65_918_208,
      estimatedMonthlyUsd: 1.199413824,
    },
    r2: {
      totalGigabytes: 36.179351806640625,
      estimatedStorageMonthlyUsd: 0.39269027709960935,
    },
    d1: {
      rows: 63_228,
      estimatedInitialWrites: 252_912,
    },
    estimatedMonthlyCloudflareUsd: 1.5921041010996095,
    estimatedInitialCloudflareWriteUsd: 0,
  },
};

describe('open access art cost gate', () => {
  it('blocks when provider choices are still pending', () => {
    const report = buildOpenAccessCostGate({
      manifest: sampleManifest,
      generatedAt: '2026-06-23T00:00:00.000Z',
      env: {},
    });

    assert.equal(report.result, 'blocked');
    assert.equal(report.exitCode, 4);
    assert.equal(report.counts.artworkCount, 63_228);
    assert.equal(report.counts.missingCaptionCount, 1_527);
    assert.equal(report.counts.jinaImageEmbeddingTokens, 252_912_000);
    assert.equal(report.requiredHumanDecisions.length, 3);
  });

  it('returns missing-secret status for Jina lanes without printing values', () => {
    const report = buildOpenAccessCostGate({
      manifest: sampleManifest,
      generatedAt: '2026-06-23T00:00:00.000Z',
      providers: {
        imageEmbeddings: 'jina',
        captionGeneration: 'defer',
        captionEmbeddings: 'jina',
      },
      approvedBulk: true,
      env: {},
    });

    assert.equal(report.result, 'blocked');
    assert.equal(report.exitCode, 3);
    assert.deepEqual(report.requiredSecrets, ['JINA_API_KEY']);
    assert.equal(report.lanes.imageEmbeddings.status, 'missing_secret');
    assert.equal(report.lanes.captionEmbeddings.status, 'missing_secret');
  });

  it('allows an explicit metadata-only launch by deferring vector and caption work', () => {
    const report = buildOpenAccessCostGate({
      manifest: sampleManifest,
      generatedAt: '2026-06-23T00:00:00.000Z',
      providers: {
        imageEmbeddings: 'defer',
        captionGeneration: 'defer',
        captionEmbeddings: 'defer',
      },
      env: {},
    });

    assert.equal(report.result, 'ready');
    assert.equal(report.exitCode, 0);
    assert.equal(report.requiredHumanDecisions.length, 0);
  });

  it('requires approval for local bulk captioning above the sample threshold', () => {
    const report = buildOpenAccessCostGate({
      manifest: sampleManifest,
      generatedAt: '2026-06-23T00:00:00.000Z',
      providers: {
        imageEmbeddings: 'defer',
        captionGeneration: 'local',
        captionEmbeddings: 'defer',
      },
      env: {},
    });

    assert.equal(report.result, 'blocked');
    assert.equal(report.exitCode, 4);
    assert.equal(report.lanes.captionGeneration.status, 'needs_approval');
  });

  it('CLI exits 3 when a selected Jina lane lacks JINA_API_KEY', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paillette-gate-'));
    const manifest = join(dir, 'manifest.json');
    writeFileSync(manifest, JSON.stringify(sampleManifest), 'utf8');
    const env = { ...process.env };
    delete env.JINA_API_KEY;

    const result = spawnSync(
      process.execPath,
      [
        'scripts/open-access-art-cost-gate.mjs',
        '--manifest',
        manifest,
        '--image-embeddings=jina',
        '--caption-generation=defer',
        '--caption-embeddings=defer',
        '--approve-bulk',
      ],
      {
        cwd: process.cwd(),
        env,
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 3);
    assert.match(result.stdout, /JINA_API_KEY/u);
    assert.doesNotMatch(result.stdout, /Bearer /u);
    assert.equal(result.stderr, '');
  });
});
