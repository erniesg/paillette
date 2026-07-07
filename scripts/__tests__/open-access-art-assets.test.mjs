import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildOpenAccessApplyPlan } from '../lib/open-access-art-apply.mjs';
import {
  buildOpenAccessAssetLedgerInitSql,
  buildOpenAccessAssetLedgerRows,
} from '../lib/open-access-art-assets.mjs';

const sampleArtwork = {
  id: 'open-access-art:nga:41526',
  collection_id: 'open-access-art',
  image_url: 'https://api.nga.gov/iiif/example/full/843,/0/default.jpg',
  thumbnail_url: 'https://api.nga.gov/iiif/example/full/200,/0/default.jpg',
  title: 'Young Woman in White',
  artist: 'Amedeo Modigliani',
  year: 1918,
  rights: 'Open Access',
  source_url: 'https://www.nga.gov/collection/art-object-page.41526.html',
  source_institution: 'National Gallery of Art, Washington',
  source_record_id: '41526',
  custom_metadata: {
    provider: 'nga',
    providerRecordId: '41526',
  },
};

describe('open access art asset ledger', () => {
  it('plans resumable ledger rows for locally cached assets only', () => {
    const plan = buildOpenAccessApplyPlan({
      manifest: {
        providers: {
          nga: {
            normalizedSamples: [sampleArtwork],
          },
        },
      },
      generatedAt: '2026-06-06T00:00:00.000Z',
    });

    const rows = buildOpenAccessAssetLedgerRows(plan.records, {
      outDir: '/tmp/open-access-art-assets',
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, 'pending');
    assert.equal(rows[0].provider, 'nga');
    assert.equal(rows[0].role, 'web');
    assert.equal(rows[0].objectKey, 'open-access-art/nga/41526/web.jpg');
    assert.match(rows[0].localPath, /open-access-art-assets\/assets\/.+\.jpg$/u);

    const externalPlan = buildOpenAccessApplyPlan({
      manifest: {
        providers: {
          nga: {
            normalizedSamples: [sampleArtwork],
          },
        },
      },
      externalProviders: ['nga'],
    });

    assert.deepEqual(
      buildOpenAccessAssetLedgerRows(externalPlan.records, {
        outDir: '/tmp/open-access-art-assets',
      }),
      []
    );
  });

  it('builds idempotent SQLite SQL that resets stale asset bytes on source changes', () => {
    const plan = buildOpenAccessApplyPlan({
      manifest: {
        providers: {
          nga: {
            normalizedSamples: [sampleArtwork],
          },
        },
      },
    });
    const rows = buildOpenAccessAssetLedgerRows(plan.records, {
      outDir: '/tmp/open-access-art-assets',
    });
    const sql = buildOpenAccessAssetLedgerInitSql(rows, {
      generatedAt: '2026-06-06T00:00:00.000Z',
    });

    assert.match(sql, /CREATE TABLE IF NOT EXISTS open_access_asset_ledger/u);
    assert.match(sql, /asset_id TEXT PRIMARY KEY/u);
    assert.match(sql, /ON CONFLICT\(asset_id\) DO UPDATE/u);
    assert.match(sql, /source_url IS NOT excluded\.source_url/u);
    assert.match(sql, /THEN 'pending'/u);
    assert.match(sql, /downloaded_at = CASE/u);
    assert.match(sql, /sha256 = CASE/u);
  });
});
