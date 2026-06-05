import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { OPEN_ACCESS_ART_COLLECTION } from './open-access-art-ingest.mjs';

export const DEFAULT_OPEN_ACCESS_SYSTEM_USER_ID =
  '00000000-0000-4000-8000-000000000001';
export const DEFAULT_OPEN_ACCESS_ORG_ID =
  'eabbf000-708e-4d4c-8ac8-966b59d4fcac';
export const DEFAULT_OPEN_ACCESS_COLLECTION_ID =
  'ca8ae6ad-15c2-4e91-86e3-cc7bd5d1d0b7';
export const DEFAULT_OPEN_ACCESS_ASSET_VERSION = 'open-access-art-v1';
export const DEFAULT_STAGING_ASSET_API_BASE =
  'https://paillette-api-stg.berlayar.ai/api/v1/assets';

const OPEN_ACCESS_SYSTEM_EMAIL = 'system@paillette.local';
const OPEN_ACCESS_SYSTEM_API_KEY = 'open-access-art-staging-system-key';
const OPEN_ACCESS_SYSTEM_API_KEY_HASH =
  'open-access-art-staging-system-key-hash';

export function sqlString(value) {
  return String(value ?? '').replaceAll("'", "''");
}

function sqlValue(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  return `'${sqlString(value)}'`;
}

function sqlJson(value) {
  return `json('${sqlString(JSON.stringify(value ?? {}))}')`;
}

const compactObject = (record) =>
  Object.fromEntries(
    Object.entries(record || {}).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === 'string') return value.trim() !== '';
      if (Array.isArray(value)) return value.length > 0;
      return true;
    })
  );

function safePathSegment(value) {
  return (
    String(value || 'unknown')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown'
  );
}

function extensionFromUrl(value) {
  const pathname = (() => {
    try {
      return new URL(value).pathname;
    } catch {
      return String(value || '');
    }
  })();
  const match = pathname.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i) ||
    pathname.match(/\.([a-z0-9]{2,5})$/i);
  const extension = match?.[1]?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension || '')) {
    return extension === 'jpeg' ? 'jpg' : extension;
  }
  return 'jpg';
}

function contentTypeForExtension(extension) {
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function providerFromArtwork(artwork) {
  return (
    artwork?.custom_metadata?.provider ||
    String(artwork?.id || '').split(':')[1] ||
    'unknown'
  )
    .trim()
    .toLowerCase();
}

function sourceRecordIdFromArtwork(artwork) {
  return (
    artwork?.custom_metadata?.providerRecordId ||
    artwork?.source_record_id ||
    String(artwork?.id || '').split(':').slice(2).join(':') ||
    artwork?.id
  );
}

export function stableOpenAccessAssetId({
  artworkId,
  role,
  version = DEFAULT_OPEN_ACCESS_ASSET_VERSION,
}) {
  return createHash('sha256')
    .update(`${version}:${artworkId}:${role}`)
    .digest('hex')
    .slice(0, 32);
}

function assetContentUrl(apiBase, assetId) {
  return `${String(apiBase).replace(/\/+$/g, '')}/${assetId}/content`;
}

function recordsFromManifest(manifest) {
  const records = [];
  const seen = new Set();
  const addRecord = (record) => {
    if (!record?.id || seen.has(record.id)) return;
    seen.add(record.id);
    records.push(record);
  };

  for (const record of manifest?.records || manifest?.artworks || []) {
    addRecord(record);
  }

  for (const provider of Object.values(manifest?.providers || {})) {
    for (const record of provider?.normalizedSamples || []) {
      addRecord(record);
    }
  }

  return records;
}

export function buildOpenAccessSeedSql({
  orgId = DEFAULT_OPEN_ACCESS_ORG_ID,
  collectionId = DEFAULT_OPEN_ACCESS_COLLECTION_ID,
  systemUserId = DEFAULT_OPEN_ACCESS_SYSTEM_USER_ID,
  generatedAt = new Date().toISOString(),
} = {}) {
  const settings = {
    allowPublicAccess: true,
    enableEmbeddingProjector: true,
    defaultLanguage: 'en',
    supportedLanguages: ['en'],
    source: 'open-access-art',
    rightsNote:
      'Open Access Art contains public-domain, CC0, and source-designated open-access records from participating institutions.',
  };

  return [
    `INSERT INTO users (id, email, password_hash, name, role)
VALUES (${sqlValue(systemUserId)}, ${sqlValue(OPEN_ACCESS_SYSTEM_EMAIL)}, ${sqlValue('external-system')}, ${sqlValue('Paillette System')}, ${sqlValue('admin')})
ON CONFLICT(id) DO UPDATE SET
  email = excluded.email,
  name = excluded.name,
  role = excluded.role;`,
    `INSERT INTO orgs (
  id, name, slug, description, location_country, location_city, website,
  settings, api_key, api_key_hash, owner_id, created_at
) VALUES (
  ${sqlValue(orgId)},
  ${sqlValue(OPEN_ACCESS_ART_COLLECTION.name)},
  ${sqlValue(OPEN_ACCESS_ART_COLLECTION.slug)},
  ${sqlValue('Open-access public-domain and CC0 artwork records from partner museum APIs.')},
  ${sqlValue('Global')},
  NULL,
  NULL,
  ${sqlJson(settings)},
  ${sqlValue(OPEN_ACCESS_SYSTEM_API_KEY)},
  ${sqlValue(OPEN_ACCESS_SYSTEM_API_KEY_HASH)},
  ${sqlValue(systemUserId)},
  ${sqlValue(generatedAt)}
)
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  location_country = excluded.location_country,
  settings = excluded.settings,
  owner_id = excluded.owner_id;`,
    `INSERT INTO org_users (org_id, user_id, role)
VALUES (${sqlValue(orgId)}, ${sqlValue(systemUserId)}, ${sqlValue('admin')})
ON CONFLICT(org_id, user_id) DO UPDATE SET
  role = excluded.role;`,
    `INSERT INTO collections (
  id, org_id, name, description, artwork_count, created_at, created_by
) VALUES (
  ${sqlValue(collectionId)},
  ${sqlValue(orgId)},
  ${sqlValue(OPEN_ACCESS_ART_COLLECTION.name)},
  ${sqlValue('Public Domain & CC0 Art records grouped for public search and visual discovery.')},
  0,
  ${sqlValue(generatedAt)},
  ${sqlValue(systemUserId)}
)
ON CONFLICT(id) DO UPDATE SET
  org_id = excluded.org_id,
  name = excluded.name,
  description = excluded.description,
  created_by = excluded.created_by;`,
  ].join('\n\n');
}

export function buildOpenAccessApplyPlan({
  manifest = null,
  records = null,
  orgId = DEFAULT_OPEN_ACCESS_ORG_ID,
  collectionId = DEFAULT_OPEN_ACCESS_COLLECTION_ID,
  systemUserId = DEFAULT_OPEN_ACCESS_SYSTEM_USER_ID,
  bucket = 'paillette-assets-stg',
  apiBase = DEFAULT_STAGING_ASSET_API_BASE,
  assetMode = 'r2',
  assetVersion = DEFAULT_OPEN_ACCESS_ASSET_VERSION,
  externalProviders = [],
  generatedAt = new Date().toISOString(),
  limit = 0,
} = {}) {
  const sourceRecords = (records || recordsFromManifest(manifest)).slice(
    0,
    limit > 0 ? limit : undefined
  );
  const externalProviderSet = new Set(
    externalProviders.map((provider) => String(provider).trim().toLowerCase())
  );

  const plannedRecords = sourceRecords.map((artwork, index) => {
    const provider = providerFromArtwork(artwork);
    const recordAssetMode = externalProviderSet.has(provider)
      ? 'external'
      : assetMode;
    const sourceRecordId = String(sourceRecordIdFromArtwork(artwork));
    const imageAssetId = stableOpenAccessAssetId({
      artworkId: artwork.id,
      role: 'web',
      version: assetVersion,
    });
    const thumbnailAssetId = stableOpenAccessAssetId({
      artworkId: artwork.id,
      role: 'thumb',
      version: assetVersion,
    });
    const sourceImageUrl = artwork.image_url || null;
    const sourceThumbnailUrl = artwork.thumbnail_url || sourceImageUrl;
    const imageExtension = extensionFromUrl(sourceImageUrl);
    const thumbnailExtension = extensionFromUrl(sourceThumbnailUrl);
    const objectBase = `${OPEN_ACCESS_ART_COLLECTION.slug}/${safePathSegment(
      provider
    )}/${safePathSegment(sourceRecordId)}`;
    const imageObjectKey = `${objectBase}/web.${imageExtension}`;
    const thumbnailObjectKey = `${objectBase}/thumb.${thumbnailExtension}`;
    const imageUrl =
      recordAssetMode === 'r2'
        ? assetContentUrl(apiBase, imageAssetId)
        : sourceImageUrl;
    const thumbnailUrl =
      recordAssetMode === 'r2'
        ? assetContentUrl(apiBase, thumbnailAssetId)
        : sourceThumbnailUrl;
    const customMetadata = {
      ...(artwork.custom_metadata || {}),
      openAccessArt: compactObject({
        appliedAt: generatedAt,
        assetVersion,
        assetMode: recordAssetMode,
        sourceImageUrl,
        sourceThumbnailUrl,
        imageAssetId,
        thumbnailAssetId,
        imageObjectKey,
        thumbnailObjectKey,
        institutionCaption: artwork.caption
          ? {
              hasInstitutionCaption:
                artwork.caption.hasInstitutionCaption === true,
              sourceField: artwork.caption.sourceField || null,
            }
          : null,
      }),
    };

    return {
      ...artwork,
      orgId,
      collectionId,
      uploadedBy: systemUserId,
      position: index + 1,
      provider,
      providerRecordId: sourceRecordId,
      bucket,
      assetMode: recordAssetMode,
      imageAssetId,
      thumbnailAssetId,
      imageObjectKey,
      thumbnailObjectKey,
      sourceImageUrl,
      sourceThumbnailUrl,
      imageUrl,
      thumbnailUrl,
      customMetadata,
      fieldSources: compactObject(artwork.field_sources || {}),
    };
  });

  return {
    generatedAt,
    orgId,
    collectionId,
    systemUserId,
    bucket,
    apiBase,
    assetMode,
    assetVersion,
    records: plannedRecords,
  };
}

export function buildOpenAccessAssetDownloads(records, { outDir } = {}) {
  if (!outDir) {
    throw new Error('outDir is required for open-access asset downloads');
  }

  return records
    .filter((row) => row.assetMode === 'r2')
    .flatMap((row) => [
      {
        artworkId: row.id,
        provider: row.provider,
        role: 'web',
        assetId: row.imageAssetId,
        objectKey: row.imageObjectKey,
        sourceUrl: row.sourceImageUrl,
        localPath: resolve(
          outDir,
          'assets',
          `${row.imageAssetId}.${extensionFromUrl(row.sourceImageUrl)}`
        ),
        contentType: contentTypeForExtension(
          extensionFromUrl(row.sourceImageUrl)
        ),
      },
      {
        artworkId: row.id,
        provider: row.provider,
        role: 'thumb',
        assetId: row.thumbnailAssetId,
        objectKey: row.thumbnailObjectKey,
        sourceUrl: row.sourceThumbnailUrl,
        localPath: resolve(
          outDir,
          'assets',
          `${row.thumbnailAssetId}.${extensionFromUrl(row.sourceThumbnailUrl)}`
        ),
        contentType: contentTypeForExtension(
          extensionFromUrl(row.sourceThumbnailUrl)
        ),
      },
    ]);
}

function artworkStatement(row, generatedAt) {
  const fields = row.fieldSources || {};
  const customMetadata = row.customMetadata || {};
  const provenance = compactObject({
    source: 'open_access_art_ingest',
    provider: row.provider,
    source_url: row.source_url,
    source_image_url: row.sourceImageUrl,
  });

  return `INSERT INTO artworks (
  id, org_id, collection_id, image_url, thumbnail_url, original_filename,
  image_hash, embedding_id,
  title, artist, year, date_text, medium, classification, culture, origin,
  dimensions_height, dimensions_width, dimensions_depth, dimensions_unit,
  description, provenance, credit_line, rights, accession_number,
  source_url, source_institution, source_collection, source_record_id,
  field_sources, translations, dominant_colors, color_palette,
  color_extracted_at, color_extraction_version, custom_metadata, citation,
  created_at, updated_at, uploaded_by, deleted_at
) VALUES (
  ${sqlValue(row.id)},
  ${sqlValue(row.orgId)},
  ${sqlValue(row.collectionId)},
  ${sqlValue(row.imageUrl)},
  ${sqlValue(row.thumbnailUrl)},
  NULL,
  NULL,
  ${sqlValue(row.id)},
  ${sqlValue(row.title || 'Untitled')},
  ${sqlValue(row.artist)},
  ${sqlValue(row.year)},
  ${sqlValue(row.date_text)},
  ${sqlValue(row.medium)},
  ${sqlValue(row.classification)},
  ${sqlValue(row.culture)},
  ${sqlValue(row.origin)},
  NULL,
  NULL,
  NULL,
  NULL,
  ${sqlValue(row.description)},
  ${sqlJson(provenance)},
  ${sqlValue(row.credit_line)},
  ${sqlValue(row.rights)},
  ${sqlValue(row.accession_number)},
  ${sqlValue(row.source_url)},
  ${sqlValue(row.source_institution)},
  ${sqlValue(row.source_collection)},
  ${sqlValue(row.source_record_id)},
  ${sqlJson(fields)},
  ${sqlJson({})},
  NULL,
  NULL,
  NULL,
  ${sqlValue(row.assetVersion || DEFAULT_OPEN_ACCESS_ASSET_VERSION)},
  ${sqlJson(customMetadata)},
  NULL,
  ${sqlValue(generatedAt)},
  ${sqlValue(generatedAt)},
  ${sqlValue(row.uploadedBy)},
  NULL
)
ON CONFLICT(id) DO UPDATE SET
  org_id = excluded.org_id,
  collection_id = excluded.collection_id,
  image_url = excluded.image_url,
  thumbnail_url = excluded.thumbnail_url,
  embedding_id = excluded.embedding_id,
  title = excluded.title,
  artist = excluded.artist,
  year = excluded.year,
  date_text = excluded.date_text,
  medium = excluded.medium,
  classification = excluded.classification,
  culture = excluded.culture,
  origin = excluded.origin,
  description = excluded.description,
  provenance = excluded.provenance,
  credit_line = excluded.credit_line,
  rights = excluded.rights,
  accession_number = excluded.accession_number,
  source_url = excluded.source_url,
  source_institution = excluded.source_institution,
  source_collection = excluded.source_collection,
  source_record_id = excluded.source_record_id,
  field_sources = excluded.field_sources,
  custom_metadata = excluded.custom_metadata,
  updated_at = excluded.updated_at,
  uploaded_by = excluded.uploaded_by,
  deleted_at = NULL;`;
}

function assetStatement(row, role, generatedAt) {
  const isThumb = role === 'thumb';
  const assetId = isThumb ? row.thumbnailAssetId : row.imageAssetId;
  const objectKey = isThumb ? row.thumbnailObjectKey : row.imageObjectKey;
  const sourceUrl = isThumb ? row.sourceThumbnailUrl : row.sourceImageUrl;
  const url = isThumb ? row.thumbnailUrl : row.imageUrl;
  const metadata = compactObject({
    source: 'open_access_art_ingest',
    provider: row.provider,
    providerRecordId: row.providerRecordId,
    sourceUrl,
    derivedFrom: isThumb ? row.imageAssetId : null,
  });

  return `INSERT INTO assets (
  id, artwork_id, org_id, role, storage_provider, bucket, object_key, url,
  mime_type, width, height, size_bytes, checksum, metadata, created_at, updated_at
) VALUES (
  ${sqlValue(assetId)},
  ${sqlValue(row.id)},
  ${sqlValue(row.orgId)},
  ${sqlValue(role)},
  ${sqlValue(row.assetMode === 'r2' ? 'r2' : 'external')},
  ${row.assetMode === 'r2' ? sqlValue(row.bucket) : 'NULL'},
  ${sqlValue(row.assetMode === 'r2' ? objectKey : sourceUrl)},
  ${sqlValue(url)},
  ${sqlValue('image/jpeg')},
  NULL,
  NULL,
  NULL,
  NULL,
  ${sqlJson(metadata)},
  ${sqlValue(generatedAt)},
  ${sqlValue(generatedAt)}
)
ON CONFLICT(artwork_id, role, object_key) DO UPDATE SET
  storage_provider = excluded.storage_provider,
  bucket = excluded.bucket,
  url = excluded.url,
  mime_type = excluded.mime_type,
  metadata = excluded.metadata,
  updated_at = excluded.updated_at;`;
}

function collectionArtworkStatement(row) {
  return `INSERT INTO collection_artworks (collection_id, artwork_id, position)
VALUES (${sqlValue(row.collectionId)}, ${sqlValue(row.id)}, ${Number(row.position) || 0})
ON CONFLICT(collection_id, artwork_id) DO UPDATE SET
  position = excluded.position;`;
}

export function buildOpenAccessD1Statements(plan) {
  const statements = [buildOpenAccessSeedSql(plan)];
  for (const row of plan.records) {
    statements.push(artworkStatement(row, plan.generatedAt));
    statements.push(assetStatement(row, 'web', plan.generatedAt));
    statements.push(assetStatement(row, 'thumb', plan.generatedAt));
    statements.push(collectionArtworkStatement(row));
  }
  statements.push(
    `UPDATE collections SET artwork_count = (SELECT COUNT(*) FROM collection_artworks WHERE collection_id = ${sqlValue(plan.collectionId)}) WHERE id = ${sqlValue(plan.collectionId)};`
  );
  return statements;
}

export function writeOpenAccessD1Sql(plan, { outDir = null, batchSize = 50 } = {}) {
  const statements = buildOpenAccessD1Statements(plan);
  const files = [];
  const size = Math.max(1, Number(batchSize) || 50);

  if (outDir) mkdirSync(resolve(outDir, 'sql'), { recursive: true });

  for (let index = 0; index < statements.length; index += size) {
    const sql = `${statements.slice(index, index + size).join('\n\n')}\n`;
    const filename = `open-access-art-${String(files.length + 1).padStart(
      3,
      '0'
    )}.sql`;
    const file = outDir ? resolve(outDir, 'sql', filename) : filename;
    if (outDir) writeFileSync(file, sql, 'utf8');
    files.push({ file, sql });
  }

  return files;
}

export function buildOpenAccessVectorLine(
  row,
  values,
  {
    channel,
    model,
    sourceKind,
    sourceField,
    generatedAt = new Date().toISOString(),
  }
) {
  return JSON.stringify({
    id: row.id,
    values,
    metadata: {
      orgId: row.orgId,
      galleryId: row.orgId,
      artworkId: row.id,
      collectionId: row.collectionId,
      provider: row.provider,
      providerRecordId: row.providerRecordId,
      channel,
      sourceKind,
      sourceField,
      model,
      embeddingVersion: 'v2',
      title: row.title || '',
      artist: row.artist || '',
      medium: row.medium || '',
      classification: row.classification || '',
      year: row.year || 0,
      dateText: row.date_text || '',
      accessionNumber: row.accession_number || '',
      sourceInstitution: row.source_institution || '',
      sourceCollection: row.source_collection || '',
      sourceUrl: row.source_url || '',
      createdAt: generatedAt,
    },
  });
}

export function l2Normalize(values) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / Math.max(norm, 1e-8));
}
