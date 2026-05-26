#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import Papa from 'papaparse';
import { webImageSourcesByAccession as rawWebImageSourcesByAccession } from './ngs-web-image-sources.mjs';

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
const rootsSourceCsvPath =
  process.env.NGS_ROOTS_SOURCE_CSV ||
  new URL('../data/df_10K_nhb_all.csv', import.meta.url).pathname;

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

const getRootsDescription = (rootsRecord) =>
  firstText(
    rootsRecord?.caption,
    rootsRecord?.description,
    rootsRecord?.summary,
    rootsRecord?.synopsis,
    rootsRecord?.content,
    rootsRecord?.text
  );

const getRootsCollectionOf = (rootsRecord) =>
  firstText(
    rootsRecord?.collectionOf,
    rootsRecord?.collection_of,
    rootsRecord?.collection,
    rootsRecord?.metadata_collection_of,
    rootsRecord?.metadata_collection_of_0
  );

const normalizeAccession = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const reviewedRootsMetadataAccessions = new Set(
  ['P-0121-A', 'P-0121-B', 'P-0204-A', 'P-0204-B'].map(normalizeAccession)
);

const legacyImageApprovedArtworkIds = [
  '2008-06596',
  '2011-00869',
  '2012-00436',
  '2017-00002',
  '2017-00003',
  '2017-00004',
  '2017-00005',
  '2017-00006',
  '2017-00007',
  '2017-00009',
  '2017-00016',
  '2017-00017',
  '2017-00018',
  '2017-00019',
  '2017-00020',
  '2017-00039',
  '2017-00040',
  '2017-00041',
  'GI-0014',
  'GI-0246-(PC)',
  'GI-0249-(OT)',
  'GI-0312',
  'GI-0313',
  'P-0292',
  'P-0486',
  'P-0809',
  'P-1057',
  'P-1119',
  'P-1196',
  'P-1241',
];

const legacyImageApprovedAccessions = new Set(
  legacyImageApprovedArtworkIds.map(normalizeAccession)
);

const webImageSourcesByAccession = new Map(
  [...rawWebImageSourcesByAccession].map(([accession, source]) => [
    normalizeAccession(accession),
    source,
  ])
);

const getNgsAccession = (ngsRecord, artwork) =>
  firstText(
    artwork.accession_no,
    ngsRecord?.objObjectNumberTxt,
    ngsRecord?.accessionNo,
    ngsRecord?.accession_no,
    ngsRecord?.accessionNumber,
    ngsRecord?.accession_number,
    ngsRecord?.objectNumber
  );

const getRootsAccession = (rootsRecord) =>
  firstText(
    rootsRecord?.accession,
    rootsRecord?.accessionNo,
    rootsRecord?.accession_no,
    rootsRecord?.accessionNumber,
    rootsRecord?.accession_number,
    rootsRecord?.metadata_accession_no,
    rootsRecord?.metadata_accession_no_csv,
    rootsRecord?.metadata_accession_no_0
  );

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

  const ngsAccession = normalizeAccession(getNgsAccession(ngsRecord, artwork));
  const rootsAccession = normalizeAccession(getRootsAccession(rootsRecord));
  const rootsTitle = getRootsTitle(rootsRecord);
  const rootsArtist = getRootsArtist(rootsRecord);
  const ngsTitle = getNgsTitle(ngsRecord, artwork);
  const ngsArtist = getNgsArtist(ngsRecord, artwork);
  const hasHardMetadataConflict =
    rootsTitle &&
    ngsTitle &&
    rootsArtist &&
    ngsArtist &&
    !comparableTextMatches(rootsTitle, ngsTitle) &&
    !comparableTextMatches(rootsArtist, ngsArtist);

  if (ngsAccession && rootsAccession) {
    return ngsAccession === rootsAccession && !hasHardMetadataConflict;
  }

  if (ngsAccession && !rootsAccession) {
    return false;
  }

  if (rootsTitle && ngsTitle) {
    return comparableTextMatches(rootsTitle, ngsTitle);
  }

  return comparableTextMatches(rootsArtist, ngsArtist);
};

const rootsRecordTitleArtistMatchesArtwork = (
  artwork,
  ngsRecord,
  rootsRecord
) => {
  if (!hasText(artwork.roots_listing_url) || !rootsRecord) return false;

  const rootsTitle = getRootsTitle(rootsRecord);
  const rootsArtist = getRootsArtist(rootsRecord);
  const ngsTitle = getNgsTitle(ngsRecord, artwork);
  const ngsArtist = getNgsArtist(ngsRecord, artwork);

  if (!rootsTitle || !ngsTitle) return false;
  if (!comparableTextMatches(rootsTitle, ngsTitle)) return false;

  if (rootsArtist && ngsArtist) {
    return comparableTextMatches(rootsArtist, ngsArtist);
  }

  return true;
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

  const rootsDescription = getRootsDescription(decision.rootsRecord);
  if (rootsDescription) return rootsDescription;

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

const basenameFromUrl = (value) => {
  if (!value) return null;
  try {
    const name = basename(new URL(value).pathname);
    return name || null;
  } catch {
    return null;
  }
};

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

const sourceArtworkScore = (artwork) =>
  Number(hasText(artwork.ngs_detail_url)) * 100 +
  Number(hasText(artwork.date_text)) * 10 +
  Number(hasText(artwork.medium)) * 5 +
  Number(hasText(artwork.dimensions)) * 3 +
  Number(hasText(artwork.credit_line)) * 2 +
  Number(hasText(artwork.roots_listing_url));

const publicArtworkIdFor = (artwork) =>
  normalizeAccession(artwork.accession_no || artwork.id) || artwork.id;

const metadataOnlySourceArtworks = [
  {
    id: 'GI-0120-(PC)',
    accession_no: 'GI-0120-(PC)',
    institution_id: 'ngs',
    collection_id: 'national-collection',
    title: 'I Ching Modulation',
    artist: 'Chng Seok Tin',
    artist_bio: null,
    date_text: '1982',
    classification: 'Prints',
    medium: 'Colour etching and monotype',
    dimensions: 'Image size: 100 x 69 cm, Frame size: H117.4 x W81.2 x D2 cm',
    credit_line: 'Collection of National Gallery Singapore',
    rights: null,
    description: null,
    colour_palette: null,
    subject_tags: null,
    on_display: null,
    in_ngs_catalog: 1,
    metadata_sources: JSON.stringify({}),
    provenance: JSON.stringify({}),
    ngs_detail_url:
      'https://www.nationalgallery.sg/sg/en/our-collections/search-collection.artwork.html/national-collection/chng-seok-tin/gi/gi-0120-(pc)_cropped.tif.html',
    ngs_image_url: null,
    roots_listing_url:
      'https://www.roots.gov.sg/Collection-Landing/listing/1030358',
    raw_ngs: JSON.stringify({
      objObjectNumberTxt: 'GI-0120-(PC)',
      objObjectTitleTxt: 'I Ching Modulation',
      artistAvailableNames: ['Chng Seok Tin'],
      objDateDatingTxt: '1982',
      objClassificationVoc: 'Prints',
      objMaterialTechniqueTxt: 'Colour etching and monotype',
      objCreditLineTxt: 'Collection of National Gallery Singapore',
      objAssociatedPlaceTxt: 'Singapore',
      objDescriptionClb: '',
      ocspWebText: '',
    }),
    raw_roots: JSON.stringify({
      title: 'I Ching Modulation',
      creator: 'Chng Seok Tin',
      accession: 'GI-0120-(PC)',
      medium: 'Colour etching and monotype',
      dimensions: 'Image size: 100 x 69 cm, Frame size: H117.4 x W81.2 x D2 cm',
      collectionOf: 'National Gallery Singapore',
      caption:
        "Born in 1946, Chng Seok Tin graduated from the Nanyang Academy of Fine Arts in 1972. In 1980, she took up post-graduate studies in printmaking which was followed by a year's practice under S.W. Hayter at Atelier 17, Paris. Since the 1980s, Chng has been instrumental in promoting interest in printmaking and has held more than 20 solo exhibitions. In May 2005, Chng was the first Singaporean to hold a solo exhibition at the United Nations Headquarter and was awarded the Cultural Medallion in the same year. In the early 1980s, Chng became interested in the I-Ching (Book of Changes) as a resource. I Ching Modulation is a result of her investigations into variation and chance.",
    }),
    created_at: null,
  },
  {
    id: 'GI-0519-(PC)',
    accession_no: 'GI-0519-(PC)',
    institution_id: 'ngs',
    collection_id: 'national-collection',
    title: 'Two Pigeons',
    artist: 'Choo Keng Kwang',
    artist_bio: null,
    date_text: 'Undated',
    classification: 'Paintings',
    medium: 'Oil on masonite',
    dimensions: 'Image size: 60 x 80.5 cm, Frame size: H81 x W101.5 x D4 cm',
    credit_line: 'Collection of National Gallery Singapore',
    rights: null,
    description: null,
    colour_palette: null,
    subject_tags: null,
    on_display: null,
    in_ngs_catalog: 1,
    metadata_sources: JSON.stringify({}),
    provenance: JSON.stringify({}),
    ngs_detail_url:
      'https://www.nationalgallery.sg/sg/en/our-collections/search-collection.artwork.html/national-collection/choo-keng-kwang/gi/GI-0519-(PC)(1).tif.html',
    ngs_image_url: null,
    roots_listing_url:
      'https://www.roots.gov.sg/Collection-Landing/listing/1031174',
    raw_ngs: JSON.stringify({
      objObjectNumberTxt: 'GI-0519-(PC)',
      objObjectTitleTxt: 'Two Pigeons',
      artistAvailableNames: ['Choo Keng Kwang'],
      objDateDatingTxt: 'Undated',
      objClassificationVoc: 'Paintings',
      objMaterialTechniqueTxt: 'Oil on masonite',
      objCreditLineTxt: 'Collection of National Gallery Singapore',
      objAssociatedPlaceTxt: 'Singapore',
      objDescriptionClb: '',
      ocspWebText: '',
    }),
    raw_roots: JSON.stringify({
      title: 'Two Pigeons',
      creator: 'Choo Keng Kwang',
      accession: 'GI-0519-(PC)',
      medium: 'Oil on masonite',
      dimensions: 'Image size: 60 x 80.5 cm, Frame size: H81 x W101.5 x D4 cm',
      collectionOf: 'National Gallery Singapore',
      caption:
        'Born in 1931, Choo Keng Kwang is widely recognized for realistic renditions of landscape, animals and nature in the oil medium. Sympathetic to local working classes, Choo features them in many of his works. Graduating in 1953 from Nanyang Academy of Fine Arts (NAFA), he worked as a teacher, eventually returning to NAFA to helm the Art Education Department in 1984. Choo has since held many solo exhibitions and has participated in group art exhibitions in Southeast Asia, Japan, Europe and USA. Since the 1950s, Choo has received many awards for his many contributions to art and education, among which is the Public Service Medal (PBM) in 1976.',
    }),
    created_at: null,
  },
];

const legacyImageApprovedSqlList = legacyImageApprovedArtworkIds
  .map(sqlValue)
  .join(', ');

const rawCandidateSourceArtworks = [
  ...query(`
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
    raw_ngs,
    raw_roots,
    created_at
  FROM artworks
  WHERE coalesce(ngs_detail_url, '') <> ''
    OR coalesce(roots_listing_url, '') <> ''
    OR id IN (${legacyImageApprovedSqlList})
  ORDER BY id
`),
  ...metadataOnlySourceArtworks,
];
const candidateSourceByAccession = new Map();
const rootsUrlByAccession = new Map();
const rootsRecordByAccession = new Map();

for (const artwork of rawCandidateSourceArtworks) {
  const accession = publicArtworkIdFor(artwork);
  if (!accession) continue;

  if (hasText(artwork.roots_listing_url)) {
    rootsUrlByAccession.set(accession, artwork.roots_listing_url);
  }
  if (hasText(artwork.raw_roots)) {
    rootsRecordByAccession.set(accession, artwork.raw_roots);
  }

  const current = candidateSourceByAccession.get(accession);
  if (!current || sourceArtworkScore(artwork) > sourceArtworkScore(current)) {
    candidateSourceByAccession.set(accession, artwork);
  }
}

const sourceArtworkIdAliases = new Map();
const candidateSourceArtworks = Array.from(
  candidateSourceByAccession,
  ([accession, artwork]) => {
    sourceArtworkIdAliases.set(artwork.id, accession);
    return {
      ...artwork,
      id: accession,
      accession_no: accession,
      source_artwork_id: artwork.id,
      roots_listing_url:
        artwork.roots_listing_url || rootsUrlByAccession.get(accession) || null,
      raw_roots: artwork.raw_roots || rootsRecordByAccession.get(accession),
    };
  }
);
const candidateSourceArtworkIds = new Set(
  candidateSourceArtworks.map((artwork) => artwork.source_artwork_id)
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
    const artworkId =
      sourceArtworkIdAliases.get(asset.artwork_id) || asset.artwork_id;
    const entry = byArtwork.get(artworkId) || {};
    entry[asset.role] = asset;
    byArtwork.set(artworkId, entry);
  }

  return byArtwork;
};

let assetsByArtwork = buildAssetsByArtwork(sourceAssets);

const dateTextOverrides = new Map([
  // The Roots public record lists 1953; the source corpus currently has a malformed "153".
  ['2019-00157', '1953'],
]);

const ngsDetailUrlOverrides = new Map([
  [
    '2009-03192',
    'https://www.nationalgallery.sg/sg/en/our-collections/search-collection.artwork.html/national-collection/cheong-soo-pieng/2009/2009-03192(1).tif.html',
  ],
  // The NGS detail page currently renders the site's 404 page; Roots is the live public record.
  ['2010-03468', null],
]);

const normalizedDateText = (artwork) =>
  dateTextOverrides.get(artwork.id) || artwork.date_text || null;

const normalizedNgsDetailUrl = (artwork, grounding) => {
  const accession = publicArtworkIdFor(artwork);
  if (ngsDetailUrlOverrides.has(accession)) {
    return ngsDetailUrlOverrides.get(accession);
  }

  return grounding?.ngs_detail_url || artwork.ngs_detail_url || null;
};

const normalizeUrlForCompare = (value) =>
  String(value || '')
    .trim()
    .replace(/^http:\/\//i, 'https://')
    .replace(/\/+$/g, '');

const rootsPageIdFromUrl = (value) =>
  String(value || '').match(/\/listing\/(\d+)/i)?.[1] || null;

const isNgsCollectionName = (value) =>
  /(^|\b)National Gallery Singapore(\b|$)/i.test(String(value || ''));

const isNgsCreditLine = (value) =>
  /(^|\b)National Gallery Singapore(\b|$)/i.test(String(value || ''));

const loadRootsSourceRecords = (path) => {
  const byPageId = new Map();
  const byUrl = new Map();
  const byAccession = new Map();
  if (!existsSync(path)) return { byPageId, byUrl, byAccession };

  const parsed = Papa.parse(readFileSync(path, 'utf8'), {
    header: true,
    skipEmptyLines: true,
  });

  for (const row of parsed.data || []) {
    if (!row || typeof row !== 'object') continue;
    const url = normalizeUrlForCompare(row.documents_0_path);
    const pageId = firstText(
      row.documents_0_metadata_pageId,
      rootsPageIdFromUrl(url)
    );
    const accession = normalizeAccession(
      firstText(
        row.documents_0_metadata_accession_no,
        row.documents_0_metadata_accession_no_csv,
        row.documents_0_metadata_accession_no_0
      )
    );
    const record = {
      url,
      pageId,
      accession,
      collectionOf: firstText(
        row.documents_0_metadata_collection_of,
        row.documents_0_metadata_collection_of_0
      ),
    };

    if (record.url) byUrl.set(record.url, record);
    if (record.pageId) byPageId.set(record.pageId, record);
    if (record.accession) byAccession.set(record.accession, record);
  }

  return { byPageId, byUrl, byAccession };
};

const rootsSourceRecords = loadRootsSourceRecords(rootsSourceCsvPath);

const findRootsSourceRecord = (artwork, grounding) => {
  const url = normalizeUrlForCompare(
    grounding?.roots_listing_url || artwork.roots_listing_url
  );
  const pageId = rootsPageIdFromUrl(url);
  const accession = normalizeAccession(artwork.accession_no || artwork.id);

  return (
    rootsSourceRecords.byUrl.get(url) ||
    rootsSourceRecords.byPageId.get(pageId) ||
    rootsSourceRecords.byAccession.get(accession) ||
    null
  );
};

const sourceRecordRef = (artwork) =>
  `paillette-stg.artworks (Accession No. = ${
    artwork.accession_no || artwork.id
  })`;

const webImageSourceForMetadata = (source) =>
  source
    ? {
        source_provider: source.sourceProvider || null,
        source_type: source.sourceType || null,
        page_url: source.pageUrl || null,
        image_url: source.imageUrl || null,
        thumbnail_url: source.thumbnailUrl || null,
        source_title: source.sourceTitle || null,
        source_artist: source.sourceArtist || null,
        source_date: source.sourceDate || null,
        source_institution: source.sourceInstitution || null,
        rights: source.rights || null,
        corroborating_url: source.corroboratingUrl || null,
        match_basis: source.matchBasis || null,
        note: source.note || null,
      }
    : null;

const rewriteNgsWebProvenanceRefs = (provenance, artwork, decision) => {
  const rawUrl = normalizeUrlForCompare(decision.rawNgsDetailUrl);
  if (!rawUrl) return provenance;

  const replacementUrl = normalizeUrlForCompare(decision.ngsDetailUrl);
  return Object.fromEntries(
    Object.entries(provenance).map(([field, entry]) => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        entry.type !== 'web' ||
        normalizeUrlForCompare(entry.ref) !== rawUrl
      ) {
        return [field, entry];
      }

      if (replacementUrl) {
        return [field, { ...entry, ref: replacementUrl }];
      }

      return [
        field,
        {
          ...entry,
          ref: sourceRecordRef(artwork),
          type: 'source_record',
        },
      ];
    })
  );
};

const captionsByArtwork = loadJsonlMap(captionsPath);
const captionsByNormalizedArtwork = new Map(
  [...captionsByArtwork].map(([id, caption]) => [
    normalizeAccession(id),
    caption,
  ])
);
const captionForArtwork = (artwork) =>
  captionsByArtwork.get(artwork.id) ||
  captionsByArtwork.get(artwork.accession_no) ||
  captionsByNormalizedArtwork.get(normalizeAccession(artwork.id)) ||
  captionsByNormalizedArtwork.get(normalizeAccession(artwork.accession_no));
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
  const grounding =
    groundingByArtwork.get(artwork.source_artwork_id) ||
    groundingByArtwork.get(artwork.id);
  const ngsRecord = jsonOrNull(grounding?.raw_ngs || artwork.raw_ngs);
  const rootsRecord = jsonOrNull(grounding?.raw_roots || artwork.raw_roots);
  const rootsSourceRecord = findRootsSourceRecord(artwork, grounding);
  const normalizedAccession = normalizeAccession(
    artwork.accession_no || artwork.id
  );
  const artworkAssets = assetsByArtwork.get(artwork.id) || {};
  const legacyImageApproved =
    legacyImageApprovedAccessions.has(normalizedAccession) &&
    Boolean(artworkAssets.original || artworkAssets.thumb);
  const webImageSource =
    webImageSourcesByAccession.get(normalizedAccession) || null;
  const reviewedRootsMetadata =
    reviewedRootsMetadataAccessions.has(normalizedAccession) &&
    rootsRecordTitleArtistMatchesArtwork(artwork, ngsRecord, rootsRecord);
  const rootsCollectionOf = firstText(
    rootsSourceRecord?.collectionOf,
    getRootsCollectionOf(rootsRecord),
    reviewedRootsMetadata ? 'National Gallery Singapore' : null
  );
  const rootsCollectionVerdict = rootsCollectionOf
    ? isNgsCollectionName(rootsCollectionOf)
      ? 'ngs'
      : 'not_ngs'
    : 'unknown';
  const rawNgsDetailUrl = grounding?.ngs_detail_url || artwork.ngs_detail_url;
  const ngsDetailUrl = normalizedNgsDetailUrl(artwork, grounding);
  const hasNgsPublicEvidence =
    hasText(ngsDetailUrl) || isNgsCreditLine(artwork.credit_line);
  const hasNgsSource =
    hasNgsPublicEvidence &&
    (hasText(ngsDetailUrl) || hasRecordContent(ngsRecord));
  const trustedRoots =
    rootsCollectionVerdict !== 'not_ngs' &&
    (rootsRecordMatchesArtwork(artwork, ngsRecord, rootsRecord) ||
      reviewedRootsMetadata);
  const trustedRootsRecord = trustedRoots
    ? {
        ...(rootsRecord || {}),
        accession:
          getRootsAccession(rootsRecord) ||
          rootsSourceRecord?.accession ||
          artwork.accession_no ||
          artwork.id,
        collectionOf: rootsCollectionOf || undefined,
      }
    : null;

  sourceDecisions.set(artwork.id, {
    ngsRecord,
    rootsRecord: trustedRootsRecord,
    rootsCollectionOf,
    rootsCollectionVerdict,
    trustedRoots,
    hasNgsSource,
    hasNgsPublicEvidence,
    legacyImageApproved,
    webImageSource,
    rawNgsDetailUrl,
    ngsDetailUrl,
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
      sourceDecisions.get(artwork.id)?.trustedRoots ||
      sourceDecisions.get(artwork.id)?.legacyImageApproved ||
      sourceDecisions.get(artwork.id)?.webImageSource)
);
const sourceArtworkSourceIds = new Set(
  sourceArtworks.map((artwork) => artwork.source_artwork_id)
);
sourceAssets = sourceAssets.filter((asset) => {
  if (!sourceArtworkSourceIds.has(asset.artwork_id)) return false;

  const artworkId =
    sourceArtworkIdAliases.get(asset.artwork_id) || asset.artwork_id;
  const decision = sourceDecisions.get(artworkId);
  if (decision?.legacyImageApproved) return true;
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
  const webImageSource = webImageSourceForMetadata(decision.webImageSource);
  const displayImageUrl = assetUrl(originalAsset?.id) || webImageSource?.image_url;
  const displayThumbUrl =
    assetUrl(thumbAsset?.id) ||
    webImageSource?.thumbnail_url ||
    webImageSource?.image_url;
  const fieldSources = jsonOrNull(artwork.metadata_sources) || {};
  const rootsDescriptionText = getVerifiedRootsDescriptionText(
    artwork,
    fieldSources,
    decision
  );
  const ngsDescriptionText = isNgsDescriptionSource(fieldSources.description)
    ? artwork.description || null
    : null;
  const legacyDescriptionText =
    decision.legacyImageApproved && hasText(artwork.description)
      ? artwork.description
      : null;
  const publicDescription =
    rootsDescriptionText || ngsDescriptionText || legacyDescriptionText;
  const publicFieldSources = { ...fieldSources };
  if (rootsDescriptionText) {
    publicFieldSources.description = 'roots';
  } else if (legacyDescriptionText) {
    publicFieldSources.description =
      publicFieldSources.description || 'legacy_source_db';
  } else if (!publicDescription) {
    delete publicFieldSources.description;
  }
  const sourceProvenance = jsonOrNull(artwork.provenance) || {};
  const publicSourceProvenance = rewriteNgsWebProvenanceRefs(
    sourceProvenance,
    artwork,
    decision
  );
  if (rootsDescriptionText) {
    publicSourceProvenance.description = {
      source: 'roots',
      ref: decision.rootsListingUrl || artwork.roots_listing_url || null,
      type: 'web',
    };
  } else if (legacyDescriptionText) {
    publicSourceProvenance.description = publicSourceProvenance.description || {
      source: publicFieldSources.description || 'legacy_source_db',
      ref: sourceRecordRef(artwork),
      type: 'source_record',
    };
  } else if (!publicDescription) {
    delete publicSourceProvenance.description;
  }
  if (decision.legacyImageApproved && originalAsset) {
    publicSourceProvenance.image = {
      source: 'legacy_ngs_image_import',
      ref:
        originalAsset.source_url ||
        `paillette-stg.assets (artwork_id = ${artwork.source_artwork_id || artwork.id}, role = original)`,
      type: originalAsset.source_url
        ? /^https?:\/\//i.test(originalAsset.source_url)
          ? 'web'
          : 'local_file'
        : 'source_record',
      asset_id: originalAsset.id,
      object_key: originalAsset.key,
    };
  }
  if (webImageSource) {
    publicSourceProvenance.web_image = {
      source: webImageSource.source_provider || 'web_image_source',
      ref: webImageSource.page_url,
      type: 'web',
      image_url: webImageSource.image_url || null,
      thumbnail_url: webImageSource.thumbnail_url || null,
      corroborating_url: webImageSource.corroborating_url || null,
      match_basis: webImageSource.match_basis || null,
    };
    if (!originalAsset && webImageSource.image_url) {
      publicSourceProvenance.image = publicSourceProvenance.image || {
        source: webImageSource.source_provider || 'web_image_source',
        ref: webImageSource.page_url,
        type: 'web',
        image_url: webImageSource.image_url,
      };
    }
  }
  const caption = captionForArtwork(artwork);
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
    roots_collection_of: decision.rootsCollectionOf || null,
    roots_collection_verdict: decision.rootsCollectionVerdict || null,
    legacy_image_source:
      decision.legacyImageApproved && originalAsset
        ? {
            source_provider: originalAsset.source_provider || null,
            source_type: originalAsset.source_type || null,
            source_url: originalAsset.source_url || null,
            source_record_ref: sourceRecordRef(artwork),
            asset_id: originalAsset.id,
            object_key: originalAsset.key,
            note: webImageSource
              ? 'Reviewer approved this titled legacy image row for v2. Display uses the existing paillette-stg image asset; a found web image/source reference is recorded separately for enrichment provenance.'
              : 'Reviewer approved this titled legacy image row for v2. No live NGS/Roots image page was verified; display uses the existing paillette-stg image asset and preserves source-row provenance.',
          }
        : null,
    web_image_source: webImageSource,
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
      decision.hasNgsSource ||
      decision.trustedRoots ||
      decision.legacyImageApproved ||
      webImageSource
        ? {
            ngs: ngsRecord,
            roots: rootsRecord,
            ngs_detail_url: decision.ngsDetailUrl || null,
            roots_listing_url: decision.rootsListingUrl || null,
            roots_collection_of: decision.rootsCollectionOf || null,
            roots_collection_verdict: decision.rootsCollectionVerdict || null,
            legacy_image_source:
              decision.legacyImageApproved && originalAsset
                ? {
                    source_provider: originalAsset.source_provider || null,
                    source_type: originalAsset.source_type || null,
                    source_url: originalAsset.source_url || null,
                    source_record_ref: sourceRecordRef(artwork),
                    asset_id: originalAsset.id,
                    object_key: originalAsset.key,
                  }
                : null,
            web_image_source: webImageSource,
          }
        : null,
  };

  return [
    sqlValue(artwork.id),
    sqlValue(ngsOrgId),
    sqlValue(nationalCollectionId),
    sqlValue(displayImageUrl || null),
    sqlValue(displayThumbUrl || null),
    sqlValue(
      originalAsset
        ? basename(originalAsset.key)
        : basenameFromUrl(webImageSource?.image_url)
    ),
    sqlValue(originalAsset?.checksum || null),
    sqlValue(originalAsset ? artwork.id : null),
    sqlValue(artwork.title || 'Untitled'),
    sqlValue(artwork.artist || null),
    sqlValue(firstYear(normalizedDateText(artwork))),
    sqlValue(normalizedDateText(artwork)),
    sqlValue(artwork.medium || null),
    sqlValue(artwork.classification || null),
    sqlValue(publicDescription),
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
  sqlValue(sourceArtworkIdAliases.get(asset.artwork_id) || asset.artwork_id),
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
