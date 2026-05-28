import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAssetUrls,
  selectImageForBackfill,
  sqlString,
} from '../lib/ngs-missing-image-backfill.mjs';

describe('selectImageForBackfill', () => {
  const row = {
    id: '1991-00935',
    download: {
      ok: true,
      path: '/tmp/1991-00935-zoom2048.jpg',
      url: 'https://example.test/ngs/1991-00935.jpg',
      contentType: 'image/jpeg',
      bytes: 123,
    },
  };

  const crop = {
    name: '1991-00935-zoom2048.jpg',
    action: 'crop',
    output_path: '/tmp/extracted/1991-00935-zoom2048.tif',
    reason: 'ranked_sam3',
  };

  it('uses the original NGS download when no crop is explicitly accepted', () => {
    const selected = selectImageForBackfill(row, {
      sam3ByName: new Map([[crop.name, crop]]),
      cropDecisionsByName: new Map(),
    });

    assert.equal(selected.kind, 'original');
    assert.equal(selected.path, row.download.path);
    assert.equal(selected.sourceUrl, row.download.url);
  });

  it('uses extracted output only for explicitly accepted SAM3 crops', () => {
    const selected = selectImageForBackfill(row, {
      sam3ByName: new Map([[crop.name, crop]]),
      cropDecisionsByName: new Map([[crop.name, { decision: 'accept' }]]),
    });

    assert.equal(selected.kind, 'extracted');
    assert.equal(selected.path, crop.output_path);
    assert.equal(selected.originalPath, row.download.path);
    assert.equal(selected.sam3Reason, crop.reason);
  });

  it('rejects rows without a validated download', () => {
    assert.equal(
      selectImageForBackfill({ id: 'GI-0304', download: { ok: false } }, {}).ok,
      false
    );
  });
});

describe('asset helpers', () => {
  it('builds stable asset API URLs from asset ids', () => {
    assert.deepEqual(
      buildAssetUrls({
        apiBase: 'https://paillette-api-stg.berlayar.ai/api/v1/assets',
        originalAssetId: 'asset-a',
        thumbnailAssetId: 'asset-b',
      }),
      {
        imageUrl:
          'https://paillette-api-stg.berlayar.ai/api/v1/assets/asset-a/content',
        thumbnailUrl:
          'https://paillette-api-stg.berlayar.ai/api/v1/assets/asset-b/content',
      }
    );
  });

  it('escapes SQL literals', () => {
    assert.equal(sqlString("Tan's image"), "Tan''s image");
  });
});
