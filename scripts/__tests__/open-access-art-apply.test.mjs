import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_OPEN_ACCESS_COLLECTION_ID,
  DEFAULT_OPEN_ACCESS_ORG_ID,
  buildOpenAccessApplyPlan,
  buildOpenAccessSeedSql,
  buildOpenAccessVectorLine,
  writeOpenAccessD1Sql,
} from '../lib/open-access-art-apply.mjs';

const sampleArtwork = {
  id: 'open-access-art:artic:27992',
  collection_id: 'open-access-art',
  image_url: 'https://www.artic.edu/iiif/2/abc123/full/843,/0/default.jpg',
  thumbnail_url: 'https://www.artic.edu/iiif/2/abc123/full/200,/0/default.jpg',
  title: "The Child's Bath",
  artist: 'Mary Cassatt',
  year: 1893,
  date_text: '1893',
  medium: 'Oil on canvas',
  classification: 'Painting',
  culture: null,
  origin: 'United States',
  dimensions_text: '100 x 66 cm',
  description: 'A short curatorial caption.',
  credit_line: 'Museum purchase',
  rights: 'Public Domain / CC0',
  accession_number: '1910.2',
  source_url: 'https://www.artic.edu/artworks/27992',
  source_institution: 'Art Institute of Chicago',
  source_collection: 'Open Access',
  source_record_id: '27992',
  field_sources: {
    title: 'artic',
    image_url: 'artic',
  },
  custom_metadata: {
    provider: 'artic',
    providerRecordId: '27992',
    imageUse: 'public_domain_or_cc0_source',
  },
  caption: {
    hasInstitutionCaption: true,
    text: 'A short curatorial caption.',
    sourceField: 'description',
  },
};

describe('open access art seed SQL', () => {
  it('creates idempotent system user, org, org membership, and collection rows', () => {
    const sql = buildOpenAccessSeedSql({
      generatedAt: '2026-06-05T00:00:00.000Z',
    });

    assert.match(sql, /INSERT INTO users/u);
    assert.match(sql, /INSERT INTO orgs/u);
    assert.match(sql, /INSERT INTO org_users/u);
    assert.match(sql, /INSERT INTO collections/u);
    assert.match(sql, /open-access-art/u);
    assert.match(sql, /Open Access Art/u);
    assert.match(sql, /ON CONFLICT\(id\) DO UPDATE/u);
    assert.match(sql, /ON CONFLICT\(org_id, user_id\) DO UPDATE/u);
  });
});

describe('open access art apply plan', () => {
  it('uses normalized sample records to plan cached R2 assets and D1 artwork rows', () => {
    const plan = buildOpenAccessApplyPlan({
      manifest: {
        collection: { slug: 'open-access-art', name: 'Open Access Art' },
        providers: {
          artic: {
            normalizedSamples: [sampleArtwork],
          },
        },
      },
      generatedAt: '2026-06-05T00:00:00.000Z',
      apiBase: 'https://paillette-api-stg.berlayar.ai/api/v1/assets',
      bucket: 'paillette-assets-stg',
    });

    assert.equal(plan.orgId, DEFAULT_OPEN_ACCESS_ORG_ID);
    assert.equal(plan.collectionId, DEFAULT_OPEN_ACCESS_COLLECTION_ID);
    assert.equal(plan.records.length, 1);
    assert.equal(plan.records[0].id, sampleArtwork.id);
    assert.equal(
      plan.records[0].imageObjectKey,
      'open-access-art/artic/27992/web.jpg'
    );
    assert.equal(
      plan.records[0].thumbnailObjectKey,
      'open-access-art/artic/27992/thumb.jpg'
    );
    assert.equal(
      plan.records[0].imageUrl,
      `https://paillette-api-stg.berlayar.ai/api/v1/assets/${plan.records[0].imageAssetId}/content`
    );
    assert.equal(plan.records[0].sourceImageUrl, sampleArtwork.image_url);
    assert.equal(plan.records[0].customMetadata.provider, 'artic');
    assert.equal(
      plan.records[0].customMetadata.openAccessArt.sourceImageUrl,
      sampleArtwork.image_url
    );
  });

  it('can leave selected providers as external hotlinks while caching others', () => {
    const plan = buildOpenAccessApplyPlan({
      manifest: {
        providers: {
          artic: {
            normalizedSamples: [sampleArtwork],
          },
        },
      },
      generatedAt: '2026-06-05T00:00:00.000Z',
      externalProviders: ['artic'],
    });

    assert.equal(plan.records[0].assetMode, 'external');
    assert.equal(plan.records[0].imageUrl, sampleArtwork.image_url);
    assert.equal(plan.records[0].thumbnailUrl, sampleArtwork.thumbnail_url);
    assert.equal(plan.records[0].customMetadata.openAccessArt.assetMode, 'external');
  });

  it('writes D1 SQL for seed rows, artwork upserts, asset upserts, and collection membership', () => {
    const plan = buildOpenAccessApplyPlan({
      manifest: {
        providers: {
          artic: {
            normalizedSamples: [sampleArtwork],
          },
        },
      },
      generatedAt: '2026-06-05T00:00:00.000Z',
    });
    const files = writeOpenAccessD1Sql(plan, { batchSize: 20 });

    assert.equal(files.length, 1);
    assert.match(files[0].sql, /INSERT INTO orgs/u);
    assert.match(files[0].sql, /INSERT INTO artworks/u);
    assert.match(files[0].sql, /ON CONFLICT\(id\) DO UPDATE/u);
    assert.match(files[0].sql, /INSERT INTO assets/u);
    assert.match(files[0].sql, /storage_provider/u);
    assert.match(files[0].sql, /INSERT INTO collection_artworks/u);
    assert.match(files[0].sql, /UPDATE collections SET artwork_count/u);
    assert.match(files[0].sql, /The Child''s Bath/u);
  });
});

describe('open access art vector rows', () => {
  it('builds Vectorize NDJSON lines with searchable provider metadata', () => {
    const plan = buildOpenAccessApplyPlan({
      manifest: {
        providers: {
          artic: {
            normalizedSamples: [sampleArtwork],
          },
        },
      },
      generatedAt: '2026-06-05T00:00:00.000Z',
    });
    const row = JSON.parse(
      buildOpenAccessVectorLine(plan.records[0], [0.6, 0.8], {
        channel: 'image',
        model: 'test-model',
        sourceKind: 'image_embedding',
        sourceField: 'image_url',
        generatedAt: '2026-06-05T00:00:00.000Z',
      })
    );

    assert.equal(row.id, sampleArtwork.id);
    assert.deepEqual(row.values, [0.6, 0.8]);
    assert.equal(row.metadata.orgId, DEFAULT_OPEN_ACCESS_ORG_ID);
    assert.equal(row.metadata.provider, 'artic');
    assert.equal(row.metadata.sourceInstitution, 'Art Institute of Chicago');
    assert.equal(row.metadata.sourceCollection, 'Open Access');
    assert.equal(row.metadata.embeddingVersion, 'v2');
  });
});
