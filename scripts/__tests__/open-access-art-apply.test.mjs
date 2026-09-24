import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_OPEN_ACCESS_COLLECTION_ID,
  DEFAULT_OPEN_ACCESS_ORG_ID,
  buildOpenAccessAssetDownloads,
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

  it('blocks live uploads when R2 auth names are missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paillette-apply-live-gate-'));
    const manifestPath = join(dir, 'manifest.json');
    const readinessPath = join(dir, 'readiness.json');
    const outDir = join(dir, 'out');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        providers: {
          artic: {
            normalizedSamples: [sampleArtwork],
          },
        },
      })
    );

    const proc = spawnSync(
      process.execPath,
      [
        'scripts/open-access-art-apply.mjs',
        '--manifest',
        manifestPath,
        '--out-dir',
        outDir,
        '--readiness-out',
        readinessPath,
        '--limit',
        '1',
        '--upload',
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );

    assert.equal(proc.status, 3);
    assert.match(
      `${proc.stderr}\n${proc.stdout}`,
      /R2 readiness blocked upload with exit code 3/u
    );
    assert.equal(existsSync(readinessPath), true);
    assert.equal(existsSync(join(outDir, 'asset-manifest.json')), true);
    const readiness = JSON.parse(readFileSync(readinessPath, 'utf8'));
    assert.equal(readiness.bucket_name, 'paillette-assets-stg');
    assert.equal(readiness.bucket_name_source, '.agent/storage.yaml');
    assert.deepEqual(readiness.missing_names, [
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_API_TOKEN',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_ENDPOINT',
    ]);
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

  it('plans local asset downloads only for R2-cached records', () => {
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
    const downloads = buildOpenAccessAssetDownloads(plan.records, {
      outDir: '/tmp/open-access-art',
    });

    assert.equal(downloads.length, 2);
    assert.equal(downloads[0].role, 'web');
    assert.equal(downloads[0].sourceUrl, sampleArtwork.image_url);
    assert.equal(
      downloads[0].localPath,
      `/tmp/open-access-art/assets/${plan.records[0].imageAssetId}.jpg`
    );
    assert.equal(downloads[1].role, 'thumb');

    const externalPlan = buildOpenAccessApplyPlan({
      manifest: {
        providers: {
          artic: {
            normalizedSamples: [sampleArtwork],
          },
        },
      },
      externalProviders: ['artic'],
    });
    assert.deepEqual(
      buildOpenAccessAssetDownloads(externalPlan.records, {
        outDir: '/tmp/open-access-art',
      }),
      []
    );
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
    assert.match(
      files[0].sql,
      /ON CONFLICT\(id\) DO UPDATE SET\n  artwork_id = excluded\.artwork_id,/u
    );
    assert.match(files[0].sql, /object_key = excluded\.object_key/u);
    assert.match(files[0].sql, /storage_provider/u);
    assert.match(files[0].sql, /INSERT INTO collection_artworks/u);
    assert.match(files[0].sql, /UPDATE collections SET artwork_count/u);
    assert.match(files[0].sql, /The Child''s Bath/u);
  });
});

/**
 * The schema D1 actually has, built from the migrations.
 *
 * Two early migrations do not run under plain SQLite — 0003 uses a `COMMENT`
 * clause and 0004 re-adds columns a later rebuild already carries — and
 * neither touches the dimension columns, so they are skipped by name rather
 * than by swallowing every error.
 */
const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../packages/database/migrations'
);
const SQLITE_INCOMPATIBLE_MIGRATIONS = new Set([
  '0003_add_translation_tables.sql',
  '0004_add_color_extraction_columns.sql',
]);
const migratedDatabase = () => {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (!file.endsWith('.sql') || SQLITE_INCOMPATIBLE_MIGRATIONS.has(file)) {
      continue;
    }
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
};

const ngaArtwork = (objectId, dimensionsText) => ({
  id: `open-access-art:nga:${objectId}`,
  collection_id: 'open-access-art',
  image_url: `https://api.nga.gov/iiif/${objectId}/full/843,/0/default.jpg`,
  title: `Object ${objectId}`,
  dimensions_text: dimensionsText,
  source_url: `https://www.nga.gov/collection/art-object-page.${objectId}.html`,
  source_record_id: String(objectId),
  custom_metadata: { provider: 'nga', providerRecordId: String(objectId) },
});

const appliedDimensions = (db) =>
  db
    .prepare(
      `SELECT id, dimensions_height AS height, dimensions_width AS width,
              dimensions_depth AS depth, dimensions_unit AS unit,
              json_extract(custom_metadata, '$.dimensions_text') AS text
       FROM artworks ORDER BY id`
    )
    .all()
    .map((row) => ({ ...row }));

describe('open access art dimensions', () => {
  const records = [
    ngaArtwork(1, 'overall: 62.5 x 96.8 cm (24 5/8 x 38 1/8 in.)'),
    ngaArtwork(2, 'overall (diameter): 30.5 cm (12 in.)'),
    ngaArtwork(3, 'overall: 50.8 x 40.6 x 2.5 cm (20 x 16 x 1 in.)'),
    ngaArtwork(4, null),
  ];
  const apply = (db, generatedAt) => {
    const plan = buildOpenAccessApplyPlan({ records, generatedAt });
    for (const file of writeOpenAccessD1Sql(plan, { batchSize: 20 })) {
      db.exec(file.sql);
    }
  };
  const expected = [
    {
      id: 'open-access-art:nga:1',
      height: 62.5,
      width: 96.8,
      depth: null,
      unit: 'cm',
      text: 'overall: 62.5 x 96.8 cm (24 5/8 x 38 1/8 in.)',
    },
    {
      id: 'open-access-art:nga:2',
      height: null,
      width: null,
      depth: null,
      unit: null,
      text: 'overall (diameter): 30.5 cm (12 in.)',
    },
    {
      id: 'open-access-art:nga:3',
      height: 50.8,
      width: 40.6,
      depth: 2.5,
      unit: 'cm',
      text: 'overall: 50.8 x 40.6 x 2.5 cm (20 x 16 x 1 in.)',
    },
    {
      id: 'open-access-art:nga:4',
      height: null,
      width: null,
      depth: null,
      unit: null,
      text: null,
    },
  ];

  it('writes the parsed columns and keeps the catalogue text in every case', () => {
    const db = migratedDatabase();
    apply(db, '2026-09-24T00:00:00.000Z');
    assert.deepEqual(appliedDimensions(db), expected);
  });

  it('fills the columns on a re-apply over rows the old ingest left null', () => {
    const db = migratedDatabase();
    apply(db, '2026-09-24T00:00:00.000Z');
    db.exec(`UPDATE artworks SET dimensions_height = NULL, dimensions_width = NULL,
      dimensions_depth = NULL, dimensions_unit = NULL,
      custom_metadata = json_remove(custom_metadata, '$.dimensions_text')`);
    apply(db, '2026-09-25T00:00:00.000Z');
    assert.deepEqual(appliedDimensions(db), expected);
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
