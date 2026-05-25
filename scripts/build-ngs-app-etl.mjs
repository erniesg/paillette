#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

const dbPath = process.argv[2] || '/tmp/paillette-stg-ngs.sqlite';
const outputPath = process.argv[3] || '/tmp/paillette-ngs-app-etl.sql';
const apiOrigin = (
  process.argv[4] || 'https://paillette-api-stg.berlayar.ai'
).replace(/\/+$/, '');
const captionsPath =
  process.env.NGS_CAPTIONS_JSONL ||
  new URL('../eval/captions.jsonl', import.meta.url).pathname;
const groundingPath =
  process.env.NGS_GROUNDING_JSONL ||
  new URL('../eval/corpus_grounding.jsonl', import.meta.url).pathname;
const rootsDescriptionOverridesPath =
  process.env.NGS_ROOTS_DESCRIPTION_OVERRIDES_JSON ||
  new URL('../eval/ngs-roots-description-overrides.json', import.meta.url)
    .pathname;
const rootsCaptionOverridesPath =
  process.env.NGS_ROOTS_CAPTION_OVERRIDES_JSON ||
  new URL('../eval/ngs-roots-caption-overrides.json', import.meta.url).pathname;

const systemUserId = '00000000-0000-4000-8000-000000000001';
const ngsOrgId = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';
const legacyNgsOrgId = '00000000-0000-4000-8000-000000000101';
const nationalCollectionId = '47ad207e-9962-4742-8c54-d8bbdddb4f0f';
const legacyNationalCollectionId = '00000000-0000-4000-8000-000000000201';
const verifiedRootsDescriptionRecords = new Map();

const query = (sql) => {
  const output = execFileSync('sqlite3', ['-json', dbPath, sql], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  }).trim();

  return output ? JSON.parse(output) : [];
};

const jsonOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeComparableText = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\d{4}[^)]*\)/g, ' ')
    .replace(/[\u2018\u2019\u201c\u201d"'`\[\]]/g, '')
    .replace(/\b(not titled|title unknown|sans titre)\b/g, 'untitled')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const comparableTextMatches = (left, right) => {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);

  if (!normalizedLeft || !normalizedRight) return true;
  if (normalizedLeft === normalizedRight) return true;

  const [shorter, longer] =
    normalizedLeft.length <= normalizedRight.length
      ? [normalizedLeft, normalizedRight]
      : [normalizedRight, normalizedLeft];

  return shorter.length >= 8 && longer.includes(shorter);
};

const firstText = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const text = firstText(...value);
      if (text) return text;
    }
  }

  return null;
};

const getNgsTitle = (ngsRecord, artwork) =>
  firstText(ngsRecord?.objObjectTitleTxt, ngsRecord?.title, artwork.title);

const getNgsArtist = (ngsRecord, artwork) =>
  firstText(
    ngsRecord?.artistAvailableNames,
    ...(Array.isArray(ngsRecord?.artistCfs)
      ? ngsRecord.artistCfs.map((artist) => artist?.availableName)
      : []),
    artwork.artist
  );

const getRootsTitle = (rootsRecord) =>
  firstText(
    rootsRecord?.title,
    rootsRecord?.objectTitle,
    rootsRecord?.object_title
  );

const getRootsArtist = (rootsRecord) =>
  firstText(rootsRecord?.creator, rootsRecord?.artist, rootsRecord?.maker);

const hasRecordContent = (record) =>
  record &&
  typeof record === 'object' &&
  Object.values(record).some((value) => {
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value && typeof value === 'object');
  });

const rootsRecordMatchesArtwork = (artwork, ngsRecord, rootsRecord) => {
  if (!hasText(artwork.roots_listing_url) || !rootsRecord) return false;

  const rootsTitle = getRootsTitle(rootsRecord);
  const rootsArtist = getRootsArtist(rootsRecord);
  const ngsTitle = getNgsTitle(ngsRecord, artwork);
  const ngsArtist = getNgsArtist(ngsRecord, artwork);

  if (rootsTitle && ngsTitle) {
    return comparableTextMatches(rootsTitle, ngsTitle);
  }

  return comparableTextMatches(rootsArtist, ngsArtist);
};

const isRootsAsset = (asset) =>
  /roots\.gov\.sg/i.test(
    `${asset.source_url || ''} ${asset.source_provider || ''} ${asset.source_type || ''}`
  );

const normalizeSourceKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .trim();

const isNgsDescriptionSource = (value) =>
  [
    'ngs',
    'ngs_source_data',
    'stored_ngs_source_data',
    'national_gallery_singapore',
    'nationalgallerysingapore',
    'ngs_artplus_catalog',
    'artplus',
    'ngs_art+_catalogue',
  ].includes(normalizeSourceKey(value));

const getVerifiedRootsDescriptionText = (artwork, fieldSources, decision) => {
  if (!decision?.trustedRoots || !hasText(artwork.roots_listing_url)) {
    return null;
  }

  const override = verifiedRootsDescriptionRecords.get(artwork.id);
  if (!override) return null;

  const overrideCaption = firstText(override.caption);
  if (overrideCaption) return overrideCaption;

  if (
    hasText(artwork.description) &&
    isNgsDescriptionSource(fieldSources.description)
  ) {
    return artwork.description;
  }

  return null;
};

const shouldAttributeDescriptionToRoots = (artwork, fieldSources, decision) =>
  Boolean(getVerifiedRootsDescriptionText(artwork, fieldSources, decision));

const withDerivedRootsDescription = (
  rootsRecord,
  artwork,
  fieldSources,
  decision
) => {
  const rootsDescriptionText = getVerifiedRootsDescriptionText(
    artwork,
    fieldSources,
    decision
  );

  if (!rootsDescriptionText) {
    return rootsRecord;
  }

  return {
    ...(rootsRecord || {}),
    caption:
      rootsRecord?.caption || rootsRecord?.description || rootsDescriptionText,
  };
};

const sqlValue = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
};

const sqlJson = (value) => sqlValue(JSON.stringify(value ?? {}));

const assetUrl = (assetId) =>
  assetId
    ? `${apiOrigin}/api/v1/assets/${encodeURIComponent(assetId)}/content`
    : null;

const firstYear = (dateText) => {
  const match = String(dateText || '').match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return match ? Number(match[1]) : null;
};

const emitInsertMany = (lines, table, columns, rows, chunkSize = 25) => {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    lines.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES`);
    lines.push(`${chunk.map((row) => `(${row.join(', ')})`).join(',\n')};`);
  }
};

const loadJsonlMap = (path) => {
  if (!existsSync(path)) return new Map();

  const map = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;

    const row = JSON.parse(line);
    if (row.id) {
      map.set(row.id, row);
    }
  }

  return map;
};

const loadVerifiedRootsDescriptionRecords = (...paths) => {
  const records = [];

  for (const path of paths) {
    if (!existsSync(path)) continue;

    const payload = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(payload?.verified_roots_description_records)) {
      records.push(...payload.verified_roots_description_records);
    }
    if (Array.isArray(payload?.verified_roots_caption_records)) {
      records.push(...payload.verified_roots_caption_records);
    }
  }

  return records
    .map((record) =>
      typeof record === 'string' ? { id: record } : record || {}
    )
    .filter((record) => typeof record.id === 'string' && record.id.trim())
    .map((record) => ({
      ...record,
      id: record.id.trim(),
    }));
};

const institution = query(
  "SELECT * FROM institutions WHERE id = 'ngs' LIMIT 1"
)[0];
const collection = query(
  "SELECT * FROM collections WHERE id = 'national-collection' LIMIT 1"
)[0];
const hasText = (value) => String(value ?? '').trim().length > 0;

const candidateSourceArtworks = query(`
  SELECT
    id,
    accession_no,
    institution_id,
    collection_id,
    title,
    artist,
    artist_bio,
    date_text,
    classification,
    medium,
    dimensions,
    credit_line,
    rights,
    description,
    colour_palette,
    subject_tags,
    on_display,
    in_ngs_catalog,
    metadata_sources,
    provenance,
    ngs_detail_url,
    ngs_image_url,
    roots_listing_url,
    created_at
  FROM artworks
  WHERE coalesce(ngs_detail_url, '') <> ''
    OR coalesce(roots_listing_url, '') <> ''
  ORDER BY id
`);
const candidateSourceArtworkIds = new Set(
  candidateSourceArtworks.map((artwork) => artwork.id)
);
let sourceAssets = query(`
  SELECT
    id,
    bucket,
    key,
    artwork_id,
    role,
    source_type,
    source_provider,
    source_url,
    visibility,
    mime_type,
    width,
    height,
    bytes,
    checksum,
    created_at
  FROM assets
  ORDER BY artwork_id, role
`).filter((asset) => candidateSourceArtworkIds.has(asset.artwork_id));

const buildAssetsByArtwork = (assets) => {
  const byArtwork = new Map();
  for (const asset of assets) {
    const entry = byArtwork.get(asset.artwork_id) || {};
    entry[asset.role] = asset;
    byArtwork.set(asset.artwork_id, entry);
  }

  return byArtwork;
};

let assetsByArtwork = buildAssetsByArtwork(sourceAssets);

const dateTextOverrides = new Map([
  // The Roots public record lists 1953; the source corpus currently has a malformed "153".
  ['2019-00157', '1953'],
]);

const normalizedDateText = (artwork) =>
  dateTextOverrides.get(artwork.id) || artwork.date_text || null;

const captionsByArtwork = loadJsonlMap(captionsPath);
const groundingByArtwork = loadJsonlMap(groundingPath);
for (const record of loadVerifiedRootsDescriptionRecords(
  rootsDescriptionOverridesPath,
  rootsCaptionOverridesPath
)) {
  verifiedRootsDescriptionRecords.set(record.id, {
    ...verifiedRootsDescriptionRecords.get(record.id),
    ...record,
  });
}
const sourceDecisions = new Map();

for (const artwork of candidateSourceArtworks) {
  const grounding = groundingByArtwork.get(artwork.id);
  const ngsRecord = jsonOrNull(grounding?.raw_ngs);
  const rootsRecord = jsonOrNull(grounding?.raw_roots);
  const hasNgsSource =
    hasText(artwork.ngs_detail_url) ||
    hasText(grounding?.ngs_detail_url) ||
    hasRecordContent(ngsRecord);
  const trustedRoots = rootsRecordMatchesArtwork(
    artwork,
    ngsRecord,
    rootsRecord
  );

  sourceDecisions.set(artwork.id, {
    ngsRecord,
    rootsRecord: trustedRoots ? rootsRecord : null,
    trustedRoots,
    hasNgsSource,
    ngsDetailUrl: grounding?.ngs_detail_url || artwork.ngs_detail_url || null,
    rootsListingUrl:
      trustedRoots &&
      (grounding?.roots_listing_url || artwork.roots_listing_url)
        ? grounding?.roots_listing_url || artwork.roots_listing_url
        : null,
  });
}

const sourceArtworks = candidateSourceArtworks.filter(
  (artwork) =>
    hasText(artwork.accession_no) &&
    hasText(artwork.title) &&
    (sourceDecisions.get(artwork.id)?.hasNgsSource ||
      sourceDecisions.get(artwork.id)?.trustedRoots)
);
const sourceArtworkIds = new Set(sourceArtworks.map((artwork) => artwork.id));
sourceAssets = sourceAssets.filter((asset) => {
  if (!sourceArtworkIds.has(asset.artwork_id)) return false;

  const decision = sourceDecisions.get(asset.artwork_id);
  return Boolean(decision?.trustedRoots || !isRootsAsset(asset));
});
assetsByArtwork = buildAssetsByArtwork(sourceAssets);

const lines = [
  '-- Generated by scripts/build-ngs-app-etl.mjs',
  `DELETE FROM artwork_usage_events WHERE org_id IN (${sqlValue(ngsOrgId)}, ${sqlValue(legacyNgsOrgId)});`,
  `DELETE FROM api_usage_events WHERE org_id IN (${sqlValue(ngsOrgId)}, ${sqlValue(legacyNgsOrgId)});`,
  `DELETE FROM collection_artworks WHERE collection_id IN (${sqlValue(nationalCollectionId)}, ${sqlValue(legacyNationalCollectionId)});`,
  `DELETE FROM assets WHERE org_id IN (${sqlValue(ngsOrgId)}, ${sqlValue(legacyNgsOrgId)});`,
  `DELETE FROM artworks WHERE org_id IN (${sqlValue(ngsOrgId)}, ${sqlValue(legacyNgsOrgId)});`,
  `DELETE FROM collections WHERE org_id IN (${sqlValue(ngsOrgId)}, ${sqlValue(legacyNgsOrgId)}) OR id IN (${sqlValue(nationalCollectionId)}, ${sqlValue(legacyNationalCollectionId)});`,
  `DELETE FROM org_users WHERE org_id IN (${sqlValue(ngsOrgId)}, ${sqlValue(legacyNgsOrgId)});`,
  `DELETE FROM orgs WHERE id IN (${sqlValue(ngsOrgId)}, ${sqlValue(legacyNgsOrgId)});`,
  '',
];

emitInsertMany(
  lines,
  'users',
  ['id', 'email', 'password_hash', 'name', 'role'],
  [
    [
      sqlValue(systemUserId),
      sqlValue('system@paillette.local'),
      sqlValue('external-system'),
      sqlValue('Paillette System'),
      sqlValue('admin'),
    ],
  ]
);

emitInsertMany(
  lines,
  'orgs',
  [
    'id',
    'name',
    'slug',
    'description',
    'location_country',
    'location_city',
    'website',
    'settings',
    'api_key',
    'api_key_hash',
    'owner_id',
  ],
  [
    [
      sqlValue(ngsOrgId),
      sqlValue(institution?.name || 'National Gallery Singapore'),
      sqlValue('national-gallery-singapore'),
      sqlValue(
        'National Gallery Singapore public collection records ingested from the NGS source corpus.'
      ),
      sqlValue(institution?.country || 'Singapore'),
      sqlValue('Singapore'),
      sqlValue(institution?.website || 'https://www.nationalgallery.sg'),
      sqlJson({
        allowPublicAccess: false,
        enableEmbeddingProjector: true,
        defaultLanguage: 'en',
        supportedLanguages: ['en'],
        source: 'paillette-stg.ngs',
      }),
      sqlValue('ngs-staging-system-key'),
      sqlValue('ngs-staging-system-key-hash'),
      sqlValue(systemUserId),
    ],
  ]
);

emitInsertMany(
  lines,
  'org_users',
  ['org_id', 'user_id', 'role'],
  [[sqlValue(ngsOrgId), sqlValue(systemUserId), sqlValue('admin')]]
);

emitInsertMany(
  lines,
  'collections',
  [
    'id',
    'org_id',
    'name',
    'description',
    'artwork_count',
    'created_at',
    'created_by',
  ],
  [
    [
      sqlValue(nationalCollectionId),
      sqlValue(ngsOrgId),
      sqlValue(collection?.name || 'National Collection'),
      sqlValue(collection?.description || null),
      '0',
      sqlValue(collection?.created_at || null),
      sqlValue(systemUserId),
    ],
  ]
);

const artworkColumns = [
  'id',
  'org_id',
  'collection_id',
  'image_url',
  'thumbnail_url',
  'original_filename',
  'image_hash',
  'embedding_id',
  'title',
  'artist',
  'year',
  'date_text',
  'medium',
  'classification',
  'description',
  'credit_line',
  'rights',
  'accession_number',
  'source_url',
  'source_institution',
  'source_collection',
  'source_record_id',
  'field_sources',
  'translations',
  'custom_metadata',
  'created_at',
  'updated_at',
  'uploaded_by',
];

const artworkRows = sourceArtworks.map((artwork) => {
  const decision = sourceDecisions.get(artwork.id) || {};
  const assets = assetsByArtwork.get(artwork.id) || {};
  const originalAsset = assets.original;
  const thumbAsset = assets.thumb;
  const fieldSources = jsonOrNull(artwork.metadata_sources) || {};
  const rootsDescriptionText = getVerifiedRootsDescriptionText(
    artwork,
    fieldSources,
    decision
  );
  const publicFieldSources = rootsDescriptionText
    ? {
        ...fieldSources,
        description: 'roots',
      }
    : fieldSources;
  const sourceProvenance = jsonOrNull(artwork.provenance);
  const publicSourceProvenance = rootsDescriptionText
    ? {
        ...sourceProvenance,
        description: {
          source: 'roots',
          ref: decision.rootsListingUrl || artwork.roots_listing_url || null,
          type: 'web',
        },
      }
    : sourceProvenance;
  const caption = captionsByArtwork.get(artwork.id);
  const ngsRecord = decision.ngsRecord;
  const rootsRecord = withDerivedRootsDescription(
    decision.rootsRecord,
    artwork,
    fieldSources,
    decision
  );
  const customMetadata = {
    artist_bio: artwork.artist_bio || null,
    dimensions_text: artwork.dimensions || null,
    geographic_association: ngsRecord?.objAssociatedPlaceTxt || null,
    colour_palette:
      jsonOrNull(artwork.colour_palette) ?? artwork.colour_palette ?? null,
    subject_tags:
      jsonOrNull(artwork.subject_tags) ?? artwork.subject_tags ?? null,
    on_display:
      artwork.on_display === null ? null : Boolean(artwork.on_display),
    in_ngs_catalog: Boolean(artwork.in_ngs_catalog),
    ngs_image_url: artwork.ngs_image_url || null,
    roots_listing_url: decision.rootsListingUrl || null,
    source_provenance: publicSourceProvenance,
    generated_caption: caption
      ? {
          text: caption.caption || null,
          model: caption.model || null,
          prompt_version: caption.prompt_version || null,
          generated_at: caption.generated_at || null,
          sources: caption.sources || [],
        }
      : null,
    source_records:
      decision.hasNgsSource || decision.trustedRoots
        ? {
            ngs: ngsRecord,
            roots: rootsRecord,
            ngs_detail_url: decision.ngsDetailUrl || null,
            roots_listing_url: decision.rootsListingUrl || null,
          }
        : null,
  };

  return [
    sqlValue(artwork.id),
    sqlValue(ngsOrgId),
    sqlValue(nationalCollectionId),
    sqlValue(assetUrl(originalAsset?.id)),
    sqlValue(assetUrl(thumbAsset?.id)),
    sqlValue(originalAsset ? basename(originalAsset.key) : null),
    sqlValue(originalAsset?.checksum || null),
    sqlValue(originalAsset ? artwork.id : null),
    sqlValue(artwork.title || 'Untitled'),
    sqlValue(artwork.artist || null),
    sqlValue(firstYear(normalizedDateText(artwork))),
    sqlValue(normalizedDateText(artwork)),
    sqlValue(artwork.medium || null),
    sqlValue(artwork.classification || null),
    sqlValue(rootsDescriptionText || artwork.description || null),
    sqlValue(artwork.credit_line || null),
    sqlValue(artwork.rights || null),
    sqlValue(artwork.accession_no || null),
    sqlValue(decision.ngsDetailUrl || decision.rootsListingUrl || null),
    sqlValue(institution?.name || 'National Gallery Singapore'),
    sqlValue(collection?.name || 'National Collection'),
    sqlValue(artwork.id),
    sqlJson(publicFieldSources),
    sqlJson({}),
    sqlJson(customMetadata),
    sqlValue(artwork.created_at || null),
    sqlValue(new Date().toISOString()),
    sqlValue(systemUserId),
  ];
});

emitInsertMany(lines, 'artworks', artworkColumns, artworkRows, 1);

const assetColumns = [
  'id',
  'artwork_id',
  'org_id',
  'role',
  'storage_provider',
  'bucket',
  'object_key',
  'url',
  'mime_type',
  'width',
  'height',
  'size_bytes',
  'checksum',
  'metadata',
  'created_at',
  'updated_at',
];

const assetRows = sourceAssets.map((asset) => [
  sqlValue(asset.id),
  sqlValue(asset.artwork_id),
  sqlValue(ngsOrgId),
  sqlValue(asset.role),
  sqlValue('r2'),
  sqlValue(asset.bucket || 'paillette-assets-stg'),
  sqlValue(asset.key),
  sqlValue(assetUrl(asset.id)),
  sqlValue(asset.mime_type || null),
  sqlValue(asset.width),
  sqlValue(asset.height),
  sqlValue(asset.bytes),
  sqlValue(asset.checksum || null),
  sqlJson({
    source_type: asset.source_type || null,
    source_provider: asset.source_provider || null,
    source_url: asset.source_url || null,
    visibility: asset.visibility || null,
    source_asset_id: asset.id,
  }),
  sqlValue(asset.created_at || null),
  sqlValue(new Date().toISOString()),
]);

emitInsertMany(lines, 'assets', assetColumns, assetRows);

const collectionArtworkRows = sourceArtworks.map((artwork, index) => [
  sqlValue(nationalCollectionId),
  sqlValue(artwork.id),
  String(index + 1),
]);

emitInsertMany(
  lines,
  'collection_artworks',
  ['collection_id', 'artwork_id', 'position'],
  collectionArtworkRows,
  100
);

lines.push(
  `UPDATE collections SET artwork_count = (SELECT COUNT(*) FROM collection_artworks WHERE collection_id = ${sqlValue(nationalCollectionId)}) WHERE id = ${sqlValue(nationalCollectionId)};`,
  ''
);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, lines.join('\n'));

console.log(`Wrote ${outputPath}`);
console.log(`Artworks: ${sourceArtworks.length}`);
console.log(`Assets: ${sourceAssets.length}`);
