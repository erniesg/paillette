import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  mapReviewBoxToSourcePixels,
  reviewCropArtworkStatement,
  reviewCropBackfillPayload,
  reviewSourceCropSpec,
  selectReviewedCropsForBackfill,
} from '../lib/ngs-reviewed-crop-backfill.mjs';

describe('selectReviewedCropsForBackfill', () => {
  const rows = [
    {
      id: '2015-00240',
      title: 'Old Chinatown Teacher',
      artist: 'Yip Cheong Fun',
      dateText: '1950s',
      original: 'assets/2015-00240-original.jpg',
      fullWidth: 512,
      fullHeight: 342,
    },
    {
      id: 'GI-0001',
      title: 'Rejected Work',
      artist: 'Example Artist',
      dateText: 'Undated',
      original: 'assets/GI-0001-original.jpg',
    },
  ];

  const decisionsPayload = {
    decisions: {
      '2015-00240': 'accept',
      'GI-0001': 'reject',
    },
    selected: {
      '2015-00240': {
        choice: 'generated:frame-edge',
        choiceLabel: 'luma projection',
        box: [22, 20, 386, 325],
        sourceTransform: {
          sourceUrl: 'assets/2015-00240-source-auto-straighten.jpg?v=1',
          angleDegrees: -0.5,
        },
        activeResult: {
          method: 'api-frame-detector',
          cropUrl:
            'assets/2015-00240-api-frame-detector-crop.jpg?v=1780119016103',
          overlayUrl:
            'assets/2015-00240-api-frame-detector-overlay.jpg?v=1780119016103',
        },
      },
      'GI-0001': {
        choice: 'generated:snap-rectangle',
        activeResult: {
          cropUrl: 'assets/GI-0001-snap-crop.jpg?v=1',
        },
      },
    },
  };

  it('uses only accepted review choices and resolves the selected crop asset', () => {
    const selected = selectReviewedCropsForBackfill({
      reviewDir: '/tmp/review',
      decisionsPayload,
      rows,
      exists: (path) =>
        path === '/tmp/review/assets/2015-00240-api-frame-detector-crop.jpg',
    });

    assert.equal(selected.length, 1);
    assert.equal(selected[0].id, '2015-00240');
    assert.equal(
      selected[0].selectedImage.path,
      '/tmp/review/assets/2015-00240-api-frame-detector-crop.jpg'
    );
    assert.equal(selected[0].selectedImage.kind, 'review_crop');
    assert.equal(
      selected[0].selectedImage.reviewChoice,
      'generated:frame-edge'
    );
    assert.equal(
      selected[0].selectedImage.reviewChoiceLabel,
      'luma projection'
    );
    assert.deepEqual(selected[0].selectedImage.reviewBox, [22, 20, 386, 325]);
    assert.equal(
      selected[0].selectedImage.reviewCropUrl,
      'assets/2015-00240-api-frame-detector-crop.jpg?v=1780119016103'
    );
    assert.deepEqual(selected[0].selectedImage.reviewSource, {
      path: '/tmp/review/assets/2015-00240-source-auto-straighten.jpg',
      sourceUrl: 'assets/2015-00240-source-auto-straighten.jpg?v=1',
      width: 512,
      height: 342,
      box: [22, 20, 386, 325],
    });
  });

  it('fails loud when an accepted review choice has no crop asset', () => {
    assert.throws(
      () =>
        selectReviewedCropsForBackfill({
          reviewDir: '/tmp/review',
          decisionsPayload,
          rows,
          exists: () => false,
        }),
      /accepted review crop is missing/
    );
  });
});

describe('mapReviewBoxToSourcePixels', () => {
  it('maps review coordinates onto the actual source image size', () => {
    assert.deepEqual(
      mapReviewBoxToSourcePixels({
        box: [10, 20, 110, 220],
        reviewSize: { width: 200, height: 400 },
        sourceSize: { width: 1000, height: 2000 },
      }),
      { left: 50, top: 100, width: 500, height: 1000 }
    );
  });

  it('clamps boxes to the source image bounds', () => {
    assert.deepEqual(
      mapReviewBoxToSourcePixels({
        box: [-5, 10, 210, 450],
        reviewSize: { width: 200, height: 400 },
        sourceSize: { width: 1000, height: 2000 },
      }),
      { left: 0, top: 50, width: 1000, height: 1950 }
    );
  });
});

describe('reviewSourceCropSpec', () => {
  it('returns the extraction region for a reviewed crop source image', () => {
    assert.deepEqual(
      reviewSourceCropSpec(
        {
          reviewSource: {
            path: '/tmp/review/source.jpg',
            width: 512,
            height: 342,
            box: [22, 20, 386, 325],
          },
        },
        { width: 1200, height: 801 }
      ),
      {
        inputPath: '/tmp/review/source.jpg',
        extract: { left: 52, top: 47, width: 853, height: 714 },
      }
    );
  });

  it('returns null when review source context is incomplete', () => {
    assert.equal(
      reviewSourceCropSpec(
        { reviewSource: { path: '/tmp/review/source.jpg', box: [0, 0, 10, 10] } },
        { width: 1200, height: 801 }
      ),
      null
    );
  });
});

describe('reviewCropBackfillPayload', () => {
  it('records enough provenance to explain display and embedding images', () => {
    const payload = reviewCropBackfillPayload(
      {
        id: '2015-00240',
        selectedImage: {
          reviewChoice: 'generated:frame-edge',
          reviewChoiceLabel: 'luma projection',
          reviewBox: [22, 20, 386, 325],
          reviewCropUrl:
            'assets/2015-00240-api-frame-detector-crop.jpg?v=1780119016103',
          reviewOverlayUrl:
            'assets/2015-00240-api-frame-detector-overlay.jpg?v=1780119016103',
          activeMethod: 'api-frame-detector',
          sourceTransform: { angleDegrees: -0.5 },
        },
      },
      {
        originalAssetId: 'asset-original',
        thumbnailAssetId: 'asset-thumb',
        appliedAt: '2026-05-30T00:00:00.000Z',
        version: 'ngs-reviewed-crops-v1',
      }
    );

    assert.deepEqual(payload, {
      version: 'ngs-reviewed-crops-v1',
      applied_at: '2026-05-30T00:00:00.000Z',
      source: 'ngs_remaining_sam3_human_review',
      selected_kind: 'review_crop',
      selected_source: 'accepted_review_crop',
      review_choice: 'generated:frame-edge',
      review_choice_label: 'luma projection',
      review_method: 'api-frame-detector',
      review_box: [22, 20, 386, 325],
      review_crop_url:
        'assets/2015-00240-api-frame-detector-crop.jpg?v=1780119016103',
      review_overlay_url:
        'assets/2015-00240-api-frame-detector-overlay.jpg?v=1780119016103',
      source_transform: { angleDegrees: -0.5 },
      original_asset_id: 'asset-original',
      thumbnail_asset_id: 'asset-thumb',
    });
  });
});

describe('reviewCropArtworkStatement', () => {
  it('updates display image fields and embedding id from the reviewed crop assets', () => {
    const sql = reviewCropArtworkStatement(
      {
        id: '2015-00240',
        imageUrl: 'https://api.example/assets/original/content',
        thumbnailUrl: 'https://api.example/assets/thumb/content',
        originalAssetId: 'asset-original',
        thumbnailAssetId: 'asset-thumb',
        colors: {
          dominantColors: [{ color: '#112233' }],
          palette: [{ color: '#112233' }],
        },
        colorExtractedAt: '2026-05-30T00:01:00.000Z',
        selectedImage: {
          reviewChoice: "generated:frame-edge's",
          reviewChoiceLabel: 'luma projection',
          activeMethod: 'api-frame-detector',
          reviewBox: [22, 20, 386, 325],
          reviewCropUrl:
            'assets/2015-00240-api-frame-detector-crop.jpg?v=1780119016103',
          reviewOverlayUrl: null,
          sourceTransform: null,
        },
      },
      {
        orgId: 'org-1',
        appliedAt: '2026-05-30T00:00:00.000Z',
        version: 'ngs-reviewed-crops-v1',
      }
    );

    assert.match(
      sql,
      /image_url = 'https:\/\/api\.example\/assets\/original\/content'/
    );
    assert.match(
      sql,
      /thumbnail_url = 'https:\/\/api\.example\/assets\/thumb\/content'/
    );
    assert.match(sql, /embedding_id = '2015-00240'/);
    assert.match(sql, /color_extraction_version = 'ngs-reviewed-crops-v1'/);
    assert.match(
      sql,
      /json_set\(COALESCE\(NULLIF\(custom_metadata, ''\), '\{\}'\), '\$\.image_backfill'/
    );
    assert.match(sql, /generated:frame-edge''s/);
    assert.match(sql, /WHERE id = '2015-00240'\n  AND org_id = 'org-1'/);
  });
});
