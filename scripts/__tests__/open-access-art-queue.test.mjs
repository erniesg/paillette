import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildOpenAccessApplyPlan } from '../lib/open-access-art-apply.mjs';
import {
  buildCloudflareQueueBatchPayload,
  buildOpenAccessAssetIngestSeedSql,
  buildOpenAccessAssetQueueMessages,
} from '../lib/open-access-art-queue.mjs';

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

describe('open access art queue planning', () => {
  it('builds queue messages for R2-backed planned assets only', () => {
    const plan = buildOpenAccessApplyPlan({
      manifest: {
        providers: {
          nga: {
            normalizedSamples: [sampleArtwork],
          },
        },
      },
      generatedAt: '2026-06-07T00:00:00.000Z',
    });

    const messages = buildOpenAccessAssetQueueMessages(plan.records);

    assert.equal(messages.length, 2);
    assert.deepEqual(messages[0], {
      assetId: plan.records[0].imageAssetId,
      artworkId: 'open-access-art:nga:41526',
      orgId: plan.orgId,
      provider: 'nga',
      role: 'web',
      sourceUrl: sampleArtwork.image_url,
      objectKey: 'open-access-art/nga/41526/web.jpg',
      contentType: 'image/jpeg',
    });
    assert.equal(messages[1].role, 'thumb');

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
      buildOpenAccessAssetQueueMessages(externalPlan.records),
      []
    );
  });

  it('builds idempotent D1 seed SQL for resumable queue state', () => {
    const plan = buildOpenAccessApplyPlan({
      manifest: {
        providers: {
          nga: {
            normalizedSamples: [sampleArtwork],
          },
        },
      },
    });
    const messages = buildOpenAccessAssetQueueMessages(plan.records);
    const sql = buildOpenAccessAssetIngestSeedSql(messages, {
      generatedAt: '2026-06-07T00:00:00.000Z',
    });

    assert.match(sql, /INSERT INTO open_access_asset_ingest/u);
    assert.match(sql, /'queued'/u);
    assert.match(sql, /ON CONFLICT\(asset_id\) DO UPDATE/u);
    assert.match(sql, /open_access_asset_ingest\.status = 'uploaded'/u);
    assert.match(sql, /source_url IS excluded\.source_url/u);
    assert.match(sql, /THEN 'uploaded'/u);
  });

  it('builds Cloudflare Queue REST batch payloads', () => {
    const message = {
      assetId: 'asset-1',
      artworkId: 'open-access-art:nga:1',
      orgId: 'org-open-access',
      provider: 'nga',
      role: 'web',
      sourceUrl: 'https://example.org/image.jpg',
      objectKey: 'open-access-art/nga/1/web.jpg',
      contentType: 'image/jpeg',
    };

    assert.deepEqual(buildCloudflareQueueBatchPayload([message]), {
      messages: [
        {
          body: message,
          content_type: 'json',
        },
      ],
    });
  });
});
