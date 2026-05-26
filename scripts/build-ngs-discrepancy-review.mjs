#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { webImageSourcesByAccession as rawWebImageSourcesByAccession } from './ngs-web-image-sources.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const [key, inlineValue] = arg.slice(2).split('=', 2);
  const value =
    inlineValue !== undefined
      ? inlineValue
      : process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
        ? process.argv[++i]
        : 'true';
  args.set(key, value);
}

const sourceDbName = args.get('source-d1') || 'paillette-stg';
const appDbName = args.get('app-d1') || 'paillette-db-stg';
const corpusPath =
  args.get('corpus') ||
  new URL('../eval/corpus.jsonl', import.meta.url).pathname;
const captionsPath =
  args.get('captions') ||
  new URL('../eval/captions.jsonl', import.meta.url).pathname;
const rootsCaptionOverridesPath =
  args.get('roots-caption-overrides') ||
  new URL('../eval/ngs-roots-caption-overrides.json', import.meta.url).pathname;
const rootsCollectionAuditPath =
  args.get('roots-collection-audit') ||
  new URL('../eval/ngs-roots-collection-audit.json', import.meta.url).pathname;
const evalManifestPath =
  args.get('out') ||
  new URL('../eval/ngs-discrepancy-review-manifest.json', import.meta.url)
    .pathname;
const webManifestPath =
  args.get('web-out') ||
  new URL(
    '../apps/web/app/generated/ngs-discrepancy-review-manifest.json',
    import.meta.url
  ).pathname;
const apiAllowlistPath =
  args.get('api-allowlist-out') ||
  new URL(
    '../apps/api/src/generated/ngs-review-image-allowlist.ts',
    import.meta.url
  ).pathname;

const wranglerCandidates = [
  join(process.cwd(), 'apps/api/node_modules/.bin/wrangler'),
  join(process.cwd(), 'apps/web/node_modules/.bin/wrangler'),
  join(process.cwd(), 'node_modules/.bin/wrangler'),
  'wrangler',
];
const wrangler =
  wranglerCandidates.find((candidate) => existsSync(candidate)) || 'wrangler';

const canonicalMatches = new Map(
  [
    ['1993-00014_o3', ['1993-00014', 4.86]],
    ['2007-01077_o3', ['2007-01077', 2.91]],
    ['2010-00753_o3', ['2010-00753', 1.56]],
    ['2008‐06871', ['2008-06871', 11.98]],
    ['data_aws10K_1991-00226', ['1991-00226', 0.18]],
    ['data_aws10K_1991-00227', ['1991-00227', 0.44]],
    ['data_aws10K_1991-00228', ['1991-00228', 0.64]],
    ['data_aws10K_1991-00229', ['1991-00229', 0.42]],
    ['data_aws10K_1991-00236', ['1991-00236', 0.15]],
    ['data_aws10K_1991-00243', ['1991-00243', 0.5]],
    ['data_aws10K_1991-00244', ['1991-00244', 0.55]],
    ['data_aws10K_1991-00254', ['1991-00254', 0.35]],
    ['data_aws10K_1991-00256', ['1991-00256', 0.3]],
    ['data_aws10K_1991-00257', ['1991-00257', 0.34]],
  ].map(([staleId, [targetAccession, meanAbsDiffRgb]]) => [
    staleId,
    { targetAccession, meanAbsDiffRgb },
  ])
);

const suffixMatches = new Map(
  [
    ['GI-0105', ['GI-0105-(PC)', 3.04]],
    ['GI-0206', ['GI-0206-(PC)', 4.04]],
    ['GI-0207', ['GI-0207-(PC)', 2.52]],
    ['GI-0330', ['GI-0330-(PC)', 3.59]],
  ].map(([staleId, [targetAccession, meanAbsDiffRgb]]) => [
    staleId,
    { targetAccession, meanAbsDiffRgb },
  ])
);

const liveMetadataSuffixMatches = new Map(
  [
    [
      'GI-0006',
      'GI-0006-(PC)',
      'New Robe',
      'https://www.roots.gov.sg/Collection-Landing/listing/1030612',
    ],
    [
      'GI-0016',
      'GI-0016-(PC)',
      'Fragrance and Wing Drops',
      'https://www.roots.gov.sg/Collection-Landing/listing/1031942',
    ],
    [
      'GI-0049',
      'GI-0049-(PC)',
      'Lyrica Landscape',
      'https://www.roots.gov.sg/Collection-Landing/listing/1034192',
    ],
    ['GI-0072', 'GI-0072-(PC)', 'Kama Sutra IV'],
    [
      'GI-0090',
      'GI-0090-(PC)',
      'Durbar Stall (Nepal)',
      'https://www.roots.gov.sg/Collection-Landing/listing/1029262',
    ],
    [
      'GI-0098',
      'GI-0098-(PC)',
      'Autumn Mist',
      'https://www.roots.gov.sg/Collection-Landing/listing/1034860',
    ],
    [
      'GI-0100',
      'GI-0100-(PC)',
      'Drying Nets',
      'https://www.roots.gov.sg/Collection-Landing/listing/1030300',
    ],
    [
      'GI-0101',
      'GI-0101-(PC)',
      'Flutist',
      'https://www.roots.gov.sg/Collection-Landing/listing/1034888',
    ],
    [
      'GI-0111',
      'GI-0111-(PC)',
      'Fu Lu Shou',
      'https://www.roots.gov.sg/Collection-Landing/listing/1030074',
    ],
    [
      'GI-0119',
      'GI-0119-(PC)',
      'Flowing Series',
      'https://www.roots.gov.sg/Collection-Landing/listing/1031229',
    ],
    [
      'GI-0120',
      'GI-0120-(PC)',
      'I Ching Modulation',
      'https://www.roots.gov.sg/Collection-Landing/listing/1030358',
    ],
    [
      'GI-0124',
      'GI-0124-(PC)',
      'Otosos I',
      'https://www.roots.gov.sg/Collection-Landing/listing/1033703',
    ],
    ['GI-0134', 'GI-0134-(PC)', 'Mental Revolution'],
    ['GI-0140', 'GI-0140-(PC)', '[Not titled] (Pot)'],
    [
      'GI-0149',
      'GI-0149-(PC)',
      'Twin Clouds',
      'https://www.roots.gov.sg/Collection-Landing/listing/1031988',
    ],
    [
      'GI-0150',
      'GI-0150-(PC)',
      'Warlord II',
      'https://www.roots.gov.sg/Collection-Landing/listing/1032486',
    ],
    ['GI-0158', 'GI-0158-(PC)', 'Large Pot'],
    [
      'GI-0167',
      'GI-0167-(PC)',
      'Improvisation : Birds',
      'https://www.roots.gov.sg/Collection-Landing/listing/1034815',
    ],
    [
      'GI-0168',
      'GI-0168-(PC)',
      'Untitled # 3 - 5',
      'https://www.roots.gov.sg/Collection-Landing/listing/1032542',
    ],
    [
      'GI-0181',
      'GI-0181-(PC)',
      'A scene in Bali',
      'https://www.roots.gov.sg/Collection-Landing/listing/1033867',
    ],
    ['GI-0203', 'GI-0203-(PC)', 'The Man, the Broom and the Struggle'],
    [
      'GI-0213',
      'GI-0213-(PC)',
      'Bird Series # 5 : Bird and the big bad wolf',
      'https://www.roots.gov.sg/Collection-Landing/listing/1033328',
    ],
    [
      'GI-0241',
      'GI-0241-(PC)',
      'Melody of Great Metropolitan',
      'https://www.roots.gov.sg/Collection-Landing/listing/1031677',
    ],
    [
      'GI-0243',
      'GI-0243-(PC)',
      'Winter in Iowa',
      'https://www.roots.gov.sg/Collection-Landing/listing/1031538',
    ],
    ['GI-0259', 'GI-0259-(PC)', 'Old Man Cigarette'],
    [
      'GI-0263',
      'GI-0263-(PC)',
      "S'pore River Boat Quay",
      'https://www.roots.gov.sg/Collection-Landing/listing/1031367',
    ],
    [
      'GI-0277',
      'GI-0277-(PC)',
      'Dancer',
      'https://www.roots.gov.sg/Collection-Landing/listing/1031969',
    ],
    ['GI-0350', 'GI-0350-(PC)', 'Wall D'],
    ['GI-0358', 'GI-0358-(PC)', 'Beach I'],
    [
      'GI-0382',
      'GI-0382-(PC)',
      'The Thin Dvide',
      'https://www.roots.gov.sg/Collection-Landing/listing/1034341',
    ],
    [
      'GI-0476',
      'GI-0476-(PC)',
      'Woman Supporting the Roof',
      'https://www.roots.gov.sg/Collection-Landing/listing/1034169',
    ],
    [
      'GI-0519',
      'GI-0519-(PC)',
      'Two Pigeons',
      'https://www.roots.gov.sg/Collection-Landing/listing/1031174',
    ],
    [
      'GI-0583',
      'GI-0583-(PC)',
      'Mother and Twins',
      'https://www.roots.gov.sg/Collection-Landing/listing/1031484',
    ],
    [
      'GI-0683',
      'GI-0683-(PC)',
      'Mountain',
      'https://www.roots.gov.sg/Collection-Landing/listing/1032817',
    ],
  ].map(([staleId, targetAccession, rootsTitle, rootsUrl]) => [
    staleId,
    { targetAccession, rootsTitle, rootsUrl },
  ])
);

const reviewerConfirmedMatches = new Map([
  [
    '2011-01720',
    {
      targetAccession: '1992-00235',
      additionalCandidateAccessions: ['P-1244'],
      explanation:
        'Reviewer identified the yellowed-background stale Gibbons image as Chen Wen Hsi, Gibbons at Play, accession 1992-00235. P-1244 is kept as a separate same-title Gibbons candidate, not this stale image.',
      imageEvidenceNote:
        'Reviewer visual confirmation from the yellowed-background image; source page identifies this work as Gibbons at Play, accession 1992-00235.',
    },
  ],
]);

const reviewerApprovedComponentPlaceholders = new Map([
  [
    'P-0121',
    {
      note: 'Reviewer confirmed the placeholder should resolve to the referenced source-backed child records P-0121-A and P-0121-B. Include child records for v2 and exclude the parent placeholder.',
    },
  ],
  [
    'P-0204',
    {
      note: 'Reviewer confirmed the placeholder should resolve to the referenced source-backed child records P-0204-A and P-0204-B. Include child records for v2 and exclude the parent placeholder.',
    },
  ],
  [
    'P-0354',
    {
      note: 'The stale parent image asset is sourced from P-0354-V_o3.jpg. Resolve the parent placeholder to source-backed child record P-0354-V and exclude the parent placeholder.',
    },
  ],
]);

const manualReferencedAccessionsByStaleId = new Map([['P-0354', ['P-0354-V']]]);

const reviewerApprovedLegacyImageAccessionsRaw = [
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

const duplicateTitleImageMismatchIds = new Set();

const exactCandidateAccessions = new Map([
  ['2011-01720', ['1992-00235', 'P-1244']],
]);

const categoryLabels = {
  suggested_canonical: 'Suggested canonical',
  suggested_suffix: 'Suggested suffix',
  duplicate_title_image_mismatch: 'Duplicate title / image mismatch',
  no_live_source_match: 'No live source match',
  no_title_orphan_image: 'No title / orphan image',
};

const readJsonLines = (path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

const chunk = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const sqlQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const d1 = (dbName, sql) => {
  const output = execFileSync(
    wrangler,
    ['d1', 'execute', dbName, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  const payload = JSON.parse(output);
  if (!Array.isArray(payload) || !payload[0]?.success) {
    throw new Error(`D1 query failed for ${dbName}: ${output.slice(0, 1000)}`);
  }
  return payload[0].results || [];
};

const normalizeAccession = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const reviewerApprovedLegacyImageAccessions = new Set(
  reviewerApprovedLegacyImageAccessionsRaw.map(normalizeAccession)
);

const webImageSourcesByAccession = new Map(
  [...rawWebImageSourcesByAccession].map(([accession, source]) => [
    normalizeAccession(accession),
    source,
  ])
);

const reviewerRequestedDoneAccessions = new Set(
  [
    '1993-00014',
    '2007-01077',
    '2008-06871',
    '2010-00753',
    '1992-00235',
    '1991-00226',
    '1991-00227',
    '1991-00228',
    '1991-00229',
    '1991-00236',
    '1991-00243',
    '1991-00244',
    '1991-00254',
    '1991-00256',
    '1991-00257',
    'GI-0105-(PC)',
    'GI-0206-(PC)',
    'GI-0207-(PC)',
    'GI-0330-(PC)',
  ].map(normalizeAccession)
);

const reviewerCaptionDecisionsByAccession = new Map(
  [
    [
      '2008-06871',
      {
        kind: 'legacy_v1_generated',
        note: 'Reviewer requested the v1 generated caption for Company.',
      },
    ],
    [
      '1992-00235',
      {
        kind: 'target_generated',
        note: 'Reviewer requested the Gibbons at Play generated target caption.',
      },
    ],
    [
      '1991-00226',
      {
        kind: 'target_generated',
        note: 'Reviewer requested the Blue Dancer generated target caption.',
      },
    ],
    ...[
      '1991-00227',
      '1991-00228',
      '1991-00243',
      '1991-00244',
      '1991-00254',
      '1991-00256',
      'GI-0207-(PC)',
    ].map((accession) => [
      accession,
      {
        kind: 'target_generated',
        note: 'Reviewer requested the generated target caption.',
      },
    ]),
    [
      '1991-00257',
      {
        kind: 'ngs_catalogue',
        note: 'Reviewer requested keeping the NGS catalogue caption with link/source provenance.',
      },
    ],
  ].map(([accession, decision]) => [normalizeAccession(accession), decision])
);

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const firstText = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
    if (Array.isArray(value)) {
      const text = firstText(...value);
      if (text) return text;
    }
  }
  return null;
};

const repairMojibake = (value) => {
  if (typeof value !== 'string') return value;
  if (!/[ÃÂâ]/.test(value)) return value;

  return value
    .replace(/â€™/g, '’')
    .replace(/â€˜/g, '‘')
    .replace(/â€œ/g, '“')
    .replace(/â€/g, '”')
    .replace(/â€¦/g, '…')
    .replace(/â€“/g, '–')
    .replace(/â€”/g, '—')
    .replace(/Â©/g, '©')
    .replace(/Â®/g, '®')
    .replace(/Â /g, ' ')
    .replace(/Ã©/g, 'é')
    .replace(/Ã¨/g, 'è')
    .replace(/Ãª/g, 'ê')
    .replace(/Ã¡/g, 'á')
    .replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ãº/g, 'ú')
    .replace(/Ã±/g, 'ñ')
    .replace(/Ã§/g, 'ç');
};

const cleanText = (...values) => {
  const text = firstText(...values);
  return text ? repairMojibake(text) : null;
};

const parseJson = (value) => {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const compactObject = (record) => {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
};

const normalizeUrlForAudit = (value) =>
  String(value || '')
    .trim()
    .replace(/^http:\/\//i, 'https://')
    .replace(/\/+$/g, '');

const rootsPageIdFromUrl = (value) =>
  String(value || '').match(/\/listing\/(\d+)/i)?.[1] || null;

const isNgsCollectionName = (value) =>
  /(^|\b)National Gallery Singapore(\b|$)/i.test(String(value || ''));

const rootsCollectionOfFromRaw = (record) =>
  firstText(
    record?.collectionOf,
    record?.collection_of,
    record?.collection,
    record?.metadata_collection_of,
    record?.metadata_collection_of_0
  );

const loadRootsCollectionAudit = (path) => {
  const empty = {
    summary: null,
    nonNgsRoots: [],
    extraUrls: [],
    byUrl: new Map(),
    byPageId: new Map(),
    byAccession: new Map(),
  };
  if (!existsSync(path)) return empty;

  const payload = JSON.parse(readFileSync(path, 'utf8'));
  const entries = [
    ...(Array.isArray(payload.nonNgsRoots) ? payload.nonNgsRoots : []),
    ...(Array.isArray(payload.extraUrls) ? payload.extraUrls : []),
  ];
  const byUrl = new Map();
  const byPageId = new Map();
  const byAccession = new Map();

  for (const entry of entries) {
    const url = normalizeUrlForAudit(entry.rootsUrl);
    const pageId = entry.rootsPageId || rootsPageIdFromUrl(url);
    const accession = normalizeAccession(
      entry.accession || entry.rootsAccession
    );
    if (url) byUrl.set(url, entry);
    if (pageId) byPageId.set(pageId, entry);
    if (accession) byAccession.set(accession, entry);
  }

  return {
    auditedAt: payload.auditedAt || null,
    rule: payload.rule || null,
    summary: payload.summary || null,
    nonNgsRoots: Array.isArray(payload.nonNgsRoots) ? payload.nonNgsRoots : [],
    extraUrls: Array.isArray(payload.extraUrls) ? payload.extraUrls : [],
    byUrl,
    byPageId,
    byAccession,
  };
};

const rootsAuditEntryForSourceRow = (sourceRow, audit) => {
  if (!sourceRow || !audit) return null;
  const url = normalizeUrlForAudit(sourceRow.roots_listing_url);
  const pageId = rootsPageIdFromUrl(url);
  const accession = normalizeAccession(sourceRow.accession_no || sourceRow.id);
  return (
    audit.byUrl?.get(url) ||
    audit.byPageId?.get(pageId) ||
    audit.byAccession?.get(accession) ||
    null
  );
};

const normalizeSourceLabel = (value) => {
  const source = String(value || '')
    .trim()
    .toLowerCase();
  if (!source) return null;
  if (source.includes('roots')) return 'roots';
  if (source.includes('artplus')) return 'ngs_artplus_catalog';
  if (source.includes('ngs') || source.includes('national_gallery'))
    return 'ngs_artplus_catalog';
  return source;
};

const parseFieldSources = (value) => {
  const parsed = parseJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed
    : {};
};

const referencedAccessionsFromText = (...values) => {
  const accessions = new Set();
  for (const value of values) {
    if (!hasText(value)) continue;
    const matches = value.match(/\b[A-Z]{1,4}-\d{3,5}(?:-[A-Z])?\b/gi) || [];
    for (const match of matches) {
      accessions.add(match.toUpperCase());
    }
  }
  return [...accessions];
};

const buildDimensions = (row) => {
  if (hasText(row.dimensions)) return row.dimensions.trim();

  const parts = [
    row.dimensions_height ? `H ${row.dimensions_height}` : null,
    row.dimensions_width ? `W ${row.dimensions_width}` : null,
    row.dimensions_depth ? `D ${row.dimensions_depth}` : null,
  ].filter(Boolean);

  if (parts.length === 0) return null;
  return `${parts.join(' x ')}${row.dimensions_unit ? ` ${row.dimensions_unit}` : ''}`;
};

const algoliaHeaders = {
  'X-Algolia-Application-Id': 'TJMUSR60N2',
  'X-Algolia-API-Key': '23fa828b71e81459128719d920fc4d09',
  'Content-Type': 'application/json',
};
const algoliaUrl =
  'https://TJMUSR60N2-dsn.algolia.net/1/indexes/prod_ngs_collections/query';
const algoliaCache = new Map();

const queryAlgolia = async (query, hitsPerPage = 5) => {
  const key = `${query}\0${hitsPerPage}`;
  if (algoliaCache.has(key)) return algoliaCache.get(key);

  const response = await fetch(algoliaUrl, {
    method: 'POST',
    headers: algoliaHeaders,
    body: JSON.stringify({ query, hitsPerPage }),
  });

  if (!response.ok) {
    throw new Error(`Algolia query failed ${response.status}: ${query}`);
  }

  const payload = await response.json();
  const hits = Array.isArray(payload.hits) ? payload.hits : [];
  algoliaCache.set(key, hits);
  return hits;
};

const imageUrlFromNgsPath = (path) =>
  path
    ? `https://www.nationalgallery.sg${encodeURI(path)}/_jcr_content/renditions/cq5dam.web.1280.1280.jpeg`
    : null;

const sourceUrlFromNgsPath = (path) => {
  if (!path) return null;
  const relativePath = path
    .replace('/content/dam/national-collections-artworks', '')
    .replace(/\.(jpg|jpeg|tif|tiff|png)$/i, '.$1.html');
  return `https://www.nationalgallery.sg/sg/en/our-collections/search-collection.artwork.html${encodeURI(relativePath)}`;
};

const ngsHitToCandidate = (hit, matchBasis, extra = {}) => {
  const metadata = hit?.metadata || {};
  const accession = firstText(metadata.objObjectNumberTxt);
  const title = firstText(metadata.objObjectTitleTxt, hit?.title);
  const artist = firstText(
    metadata.artistAvailableNames,
    ...(Array.isArray(metadata.artistCfs)
      ? metadata.artistCfs.map((artist) => artist?.availableName)
      : [])
  );

  return compactObject({
    source: 'ngs',
    accession,
    title: cleanText(title),
    artist: cleanText(artist),
    dateText: cleanText(metadata.objDateDatingTxt),
    classification: cleanText(metadata.objClassificationVoc),
    medium: cleanText(metadata.objMaterialTechniqueTxt),
    dimensions: cleanText(metadata.publishedDimension, metadata.dimensions),
    creditLine: cleanText(metadata.objCreditLineTxt),
    description: cleanText(metadata.objDescriptionClb, metadata.ocspWebText),
    descriptionSource: cleanText(metadata.objDescriptionClb)
      ? 'ngs_artplus_catalog'
      : null,
    sourceUrl: sourceUrlFromNgsPath(hit?.path),
    imageUrl: imageUrlFromNgsPath(hit?.path),
    matchBasis,
    ...extra,
  });
};

const findNgsCandidates = async (row, targetAccession = null) => {
  const query =
    targetAccession || [row.title, row.artist].filter(Boolean).join(' ');
  if (!query) return [];

  const hits = await queryAlgolia(query, targetAccession ? 6 : 4);
  const desired = targetAccession ? normalizeAccession(targetAccession) : null;
  const candidates = hits
    .map((hit) =>
      ngsHitToCandidate(
        hit,
        targetAccession ? 'accession_search' : 'title_artist_search_unapproved'
      )
    )
    .filter((candidate) => candidate.accession);

  if (!desired) return candidates.slice(0, 4);

  const exact = candidates.find(
    (candidate) => normalizeAccession(candidate.accession) === desired
  );
  return exact ? [exact] : candidates.slice(0, 2);
};

const rootsFromSourceRow = (sourceRow, rootsCollectionAudit) => {
  const rawRoots = parseJson(sourceRow?.raw_roots);
  const auditEntry = rootsAuditEntryForSourceRow(
    sourceRow,
    rootsCollectionAudit
  );
  const collectionOf = cleanText(
    auditEntry?.rootsCollectionOf,
    rootsCollectionOfFromRaw(rawRoots)
  );
  const collectionVerdict = collectionOf
    ? isNgsCollectionName(collectionOf)
      ? 'ngs'
      : 'not_ngs'
    : auditEntry?.collectionVerdict || null;

  if (collectionVerdict === 'not_ngs') {
    return [];
  }

  const hasRawRoots =
    rawRoots &&
    typeof rawRoots === 'object' &&
    Object.values(rawRoots).some((value) => {
      if (typeof value === 'string') return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      return Boolean(value);
    });

  if (!sourceRow?.roots_listing_url && !hasRawRoots) {
    return [];
  }

  return [
    compactObject({
      source: 'roots',
      title: cleanText(rawRoots?.title, rawRoots?.objectTitle, rawRoots?.name),
      artist: cleanText(rawRoots?.creator, rawRoots?.artist, rawRoots?.maker),
      accession: cleanText(
        rawRoots?.accession,
        rawRoots?.accessionNo,
        rawRoots?.accession_no,
        rawRoots?.accessionNumber
      ),
      dateText: cleanText(rawRoots?.date, rawRoots?.dateText),
      medium: cleanText(rawRoots?.medium, rawRoots?.format),
      dimensions: cleanText(rawRoots?.dimensions),
      creditLine: cleanText(rawRoots?.creditLine),
      description: cleanText(
        rawRoots?.caption,
        rawRoots?.description,
        rawRoots?.summary,
        rawRoots?.synopsis,
        rawRoots?.content,
        rawRoots?.text
      ),
      sourceUrl: sourceRow?.roots_listing_url,
      descriptionSource: 'roots',
      collectionOf,
      collectionVerdict,
      matchBasis: 'stored_source_row_only_unapproved',
      note: collectionOf
        ? 'Roots candidate is shown only because its Collection of field is compatible with National Gallery Singapore. It still needs accession/title/artist and image/source evidence.'
        : 'Roots enrichment is not trusted unless accession/title/artist, image/source evidence, and Roots Collection of evidence agree.',
    }),
  ];
};

const rootsFromLiveSuffixMatch = (match) => {
  if (!match?.rootsUrl) return [];

  return [
    compactObject({
      source: 'roots',
      accession: match.targetAccession,
      title: cleanText(match.rootsTitle),
      sourceUrl: match.rootsUrl,
      descriptionSource: 'roots',
      collectionOf: 'National Gallery Singapore',
      collectionVerdict: 'ngs',
      matchBasis: 'live_roots_accession_search',
      note: 'Roots live search returned this suffixed accession with Collection of = National Gallery Singapore. This is accession/source metadata evidence, not stale-image evidence.',
    }),
  ];
};

const appSummary = (row) => {
  if (!row) return null;

  const fieldSources = parseFieldSources(row.field_sources);
  const customMetadata = parseJson(row.custom_metadata);
  const rootsSourceUrl = cleanText(
    customMetadata?.roots_listing_url,
    customMetadata?.source_records?.roots_listing_url
  );

  return compactObject({
    id: row.id,
    accession: row.accession_number,
    title: cleanText(row.title),
    artist: cleanText(row.artist),
    dateText: cleanText(row.date_text),
    classification: cleanText(row.classification),
    medium: cleanText(row.medium),
    dimensions: cleanText(buildDimensions(row)),
    creditLine: cleanText(row.credit_line),
    description: cleanText(row.description),
    descriptionSource: normalizeSourceLabel(fieldSources.description),
    sourceUrl: row.source_url,
    rootsSourceUrl,
    sourceRecordId: row.source_record_id,
    imageUrl: row.image_url,
    thumbnailUrl: row.thumbnail_url,
  });
};

const captionPolicyForRow = ({
  staleId,
  targetAccession,
  appMatch,
  captionsById,
  rootsCaptionsById,
}) => {
  if (!targetAccession) return null;

  const normalizedTargetAccession = normalizeAccession(targetAccession);
  const reviewerRequestedDone = reviewerRequestedDoneAccessions.has(
    normalizedTargetAccession
  );
  const reviewerCaptionDecision = reviewerCaptionDecisionsByAccession.get(
    normalizedTargetAccession
  );
  const targetCaption = captionsById.get(targetAccession);
  const staleCaption = captionsById.get(staleId);

  if (
    reviewerCaptionDecision?.kind === 'legacy_v1_generated' &&
    staleCaption?.caption
  ) {
    return compactObject({
      requestedCaption: true,
      approvedForV2: true,
      status: 'legacy_v1_caption_approved',
      source: 'generated',
      sourceUrl: staleCaption.sources?.[0],
      note: reviewerCaptionDecision.note,
    });
  }

  if (
    reviewerCaptionDecision?.kind === 'target_generated' &&
    targetCaption?.caption
  ) {
    return compactObject({
      requestedCaption: true,
      approvedForV2: true,
      status: 'generated_caption_approved',
      source: 'generated',
      sourceUrl: targetCaption.sources?.[0],
      note: reviewerCaptionDecision.note,
    });
  }

  if (
    reviewerCaptionDecision?.kind === 'ngs_catalogue' &&
    appMatch?.description
  ) {
    return compactObject({
      requestedCaption: true,
      approvedForV2: true,
      status: 'ngs_catalogue_caption_approved',
      source: normalizeSourceLabel(appMatch.descriptionSource) || 'ngs',
      sourceUrl: appMatch.sourceUrl,
      note: reviewerCaptionDecision.note,
    });
  }

  const rootsOverride = rootsCaptionsById.get(targetAccession);
  if (rootsOverride?.caption) {
    return compactObject({
      requestedRootsCaption: true,
      approvedForV2: true,
      status: 'roots_caption_verified',
      source: 'roots',
      sourceUrl: rootsOverride.rootsUrl,
      rootsTitle: cleanText(rootsOverride.rootsTitle),
      note: 'Resolved mapping uses verified Roots catalogue text and keeps source=roots.',
    });
  }

  if (appMatch?.descriptionSource === 'roots' && appMatch.description) {
    return compactObject({
      requestedRootsCaption: true,
      approvedForV2: true,
      status: 'roots_caption_in_app',
      source: 'roots',
      sourceUrl: appMatch.rootsSourceUrl,
      note: 'Current app row already stores catalogue description with source=roots.',
    });
  }

  if (appMatch?.rootsSourceUrl) {
    return compactObject({
      requestedRootsCaption: true,
      status: 'roots_page_has_no_caption',
      source: 'roots',
      sourceUrl: appMatch.rootsSourceUrl,
      note: 'Roots listing exists, but no public caption text was found on the live page.',
    });
  }

  if (!reviewerRequestedDone) return null;

  return {
    requestedRootsCaption: true,
    status: 'no_roots_listing_found',
    source: null,
    note: 'No Roots listing was found in source DB, current app metadata, corpus grounding, or targeted Roots search. Do not invent a Roots caption.',
  };
};

const sourceSummary = (corpusRow, sourceRow) =>
  compactObject({
    id: corpusRow.id,
    accession: sourceRow?.accession_no || corpusRow.id,
    title: cleanText(sourceRow?.title, corpusRow.title),
    artist: cleanText(sourceRow?.artist, corpusRow.artist),
    dateText: cleanText(sourceRow?.date_text, corpusRow.date_text),
    classification: cleanText(
      sourceRow?.classification,
      corpusRow.classification
    ),
    medium: cleanText(sourceRow?.medium),
    dimensions: cleanText(sourceRow?.dimensions),
    creditLine: cleanText(sourceRow?.credit_line),
    description: cleanText(sourceRow?.description, corpusRow.description),
    descriptionSource: sourceRow?.description
      ? 'source_db'
      : corpusRow.description
        ? 'legacy_corpus_unverified'
        : null,
    sourceUrl: cleanText(sourceRow?.ngs_detail_url),
    imageUrl: cleanText(sourceRow?.ngs_image_url),
    image: compactObject({
      thumbKey: corpusRow.thumb_key,
      originalKey: corpusRow.original_key,
      thumbPath: `/api/v1/ngs-review/stale-assets/${encodeURIComponent(
        corpusRow.id
      )}/thumb`,
      originalPath: `/api/v1/ngs-review/stale-assets/${encodeURIComponent(
        corpusRow.id
      )}/original`,
    }),
  });

const sourceRecordSummary = (sourceRow) => {
  if (!sourceRow) return null;
  return compactObject({
    id: sourceRow.id,
    accession: sourceRow.accession_no || sourceRow.id,
    title: cleanText(sourceRow.title),
    artist: cleanText(sourceRow.artist),
    dateText: cleanText(sourceRow.date_text),
    classification: cleanText(sourceRow.classification),
    medium: cleanText(sourceRow.medium),
    dimensions: cleanText(sourceRow.dimensions),
    creditLine: cleanText(sourceRow.credit_line),
    description: cleanText(sourceRow.description),
    descriptionSource: sourceRow.description ? 'source_db' : null,
    sourceUrl: cleanText(sourceRow.ngs_detail_url),
    imageUrl: cleanText(sourceRow.ngs_image_url),
    rootsSourceUrl: cleanText(sourceRow.roots_listing_url),
    matchBasis: 'referenced_by_stale_placeholder',
  });
};

const hasComponentSourceAndImage = (record) => {
  const appRecord = record.currentAppMatch;
  const sourceRecord = record.sourceRecord;

  return Boolean(
    (appRecord?.title || sourceRecord?.title) &&
      (appRecord?.imageUrl ||
        appRecord?.thumbnailUrl ||
        sourceRecord?.imageUrl) &&
      (appRecord?.sourceUrl || sourceRecord?.sourceUrl) &&
      (appRecord?.rootsSourceUrl || sourceRecord?.rootsSourceUrl)
  );
};

const legacyImageResolutionSummary = (artworkId, assets) => {
  const original = assets?.original || null;
  const thumb = assets?.thumb || null;
  if (!original && !thumb) return null;

  return compactObject({
    status: 'legacy_image_source_approved_for_v2',
    sourceRecordRef: `paillette-stg.assets (artwork_id = ${artworkId})`,
    sourceProvider: cleanText(original?.source_provider),
    sourceType: cleanText(original?.source_type),
    sourceUrl: cleanText(original?.source_url),
    originalAssetId: original?.id,
    originalKey: original?.key,
    thumbAssetId: thumb?.id,
    thumbKey: thumb?.key,
    note: 'Reviewer requested remaining titled legacy rows with available image assets be included for v2. No live NGS/Roots image page was verified; keep the paillette-stg asset provenance for display and downstream embedding/search decisions.',
  });
};

const webImageSourceSummary = (source) =>
  source
    ? compactObject({
        status: 'web_image_source_found',
        sourceProvider: cleanText(source.sourceProvider),
        sourceType: cleanText(source.sourceType),
        pageUrl: cleanText(source.pageUrl),
        imageUrl: cleanText(source.imageUrl),
        thumbnailUrl: cleanText(source.thumbnailUrl),
        sourceTitle: cleanText(source.sourceTitle),
        sourceArtist: cleanText(source.sourceArtist),
        sourceDate: cleanText(source.sourceDate),
        sourceInstitution: cleanText(source.sourceInstitution),
        rights: cleanText(source.rights),
        corroboratingUrl: cleanText(source.corroboratingUrl),
        matchBasis: cleanText(source.matchBasis),
        note: cleanText(source.note),
      })
    : null;

const loadAppRecords = () => {
  const rows = d1(
    appDbName,
    `
    SELECT id, accession_number
    FROM artworks
    WHERE deleted_at IS NULL
      AND (image_url IS NOT NULL OR thumbnail_url IS NOT NULL OR embedding_id IS NOT NULL)
    `
  );

  return new Set(
    rows.flatMap((row) => [row.id, row.accession_number]).filter(Boolean)
  );
};

const loadRowsByIds = (dbName, table, ids, select) => {
  const rows = [];
  for (const idChunk of chunk([...ids], 90)) {
    if (idChunk.length === 0) continue;
    rows.push(
      ...d1(
        dbName,
        `
        SELECT ${select}
        FROM ${table}
        WHERE id IN (${idChunk.map(sqlQuote).join(',')})
        `
      )
    );
  }
  return rows;
};

const loadAssetRowsByArtworkIds = (artworkIds) => {
  const rows = [];
  for (const idChunk of chunk([...artworkIds], 90)) {
    if (idChunk.length === 0) continue;
    rows.push(
      ...d1(
        sourceDbName,
        `
        SELECT id, artwork_id, role, bucket, key, source_type,
               source_provider, source_url, mime_type, width, height,
               bytes, checksum, created_at
        FROM assets
        WHERE artwork_id IN (${idChunk.map(sqlQuote).join(',')})
        ORDER BY artwork_id, role
        `
      )
    );
  }

  const byArtwork = new Map();
  for (const row of rows) {
    const entry = byArtwork.get(row.artwork_id) || {};
    entry[row.role] = row;
    byArtwork.set(row.artwork_id, entry);
  }

  return byArtwork;
};

const loadAppRowsByAccessions = (accessions) => {
  const rows = [];
  for (const accessionChunk of chunk([...accessions], 80)) {
    if (accessionChunk.length === 0) continue;
    const list = accessionChunk.map(sqlQuote).join(',');
    rows.push(
      ...d1(
        appDbName,
        `
        SELECT id, accession_number, title, artist, date_text, medium,
               classification, dimensions_height, dimensions_width,
               dimensions_depth, dimensions_unit, credit_line, description,
               image_url, thumbnail_url, source_url, source_record_id,
               field_sources, custom_metadata
        FROM artworks
        WHERE deleted_at IS NULL
          AND (id IN (${list}) OR accession_number IN (${list}))
        `
      )
    );
  }
  return rows;
};

const loadCaptions = (path) => {
  if (!existsSync(path)) return new Map();
  const rows = readJsonLines(path);
  return new Map(rows.filter((row) => row.id).map((row) => [row.id, row]));
};

const loadRootsCaptionOverrides = (path) => {
  if (!existsSync(path)) return new Map();
  const payload = JSON.parse(readFileSync(path, 'utf8'));
  const entries = Array.isArray(payload.verified_roots_caption_records)
    ? payload.verified_roots_caption_records
    : [];

  return new Map(
    entries.filter((entry) => entry.id).map((entry) => [entry.id, entry])
  );
};

const sourceLabelsFromUrls = (sources = []) => {
  const labels = new Set();
  for (const source of sources) {
    if (/roots\.gov\.sg/i.test(source)) labels.add('roots');
    if (/nationalgallery\.sg/i.test(source)) labels.add('ngs');
  }
  return [...labels];
};

const rootsUrlFromSources = (sources = []) =>
  sources.find((source) => /roots\.gov\.sg/i.test(source)) || null;

const sourceUrlForDescription = (
  source,
  appMatch,
  targetCaption,
  rootsOverride
) => {
  if (source === 'roots') {
    return (
      rootsOverride?.rootsUrl ||
      rootsUrlFromSources(targetCaption?.sources) ||
      null
    );
  }

  if (source === 'ngs' || source === 'ngs_artplus_catalog') {
    return appMatch?.sourceUrl || null;
  }

  return null;
};

const captionEvidenceForRow = ({
  staleId,
  targetAccession,
  appMatch,
  ngsCandidates,
  captionsById,
  rootsCaptionsById,
}) => {
  const targetId = targetAccession || appMatch?.accession || staleId;
  const targetCaption = captionsById.get(targetId);
  const staleCaption = captionsById.get(staleId);
  const rootsOverride = rootsCaptionsById.get(targetId);
  const evidence = [];
  const catalogueDescription = cleanText(appMatch?.description);

  if (catalogueDescription) {
    const source =
      normalizeSourceLabel(appMatch?.descriptionSource) || 'unknown';
    evidence.push(
      compactObject({
        kind: 'catalogue_description',
        label:
          source === 'ngs_artplus_catalog'
            ? 'NGS catalogue API description'
            : 'Current app catalogue description',
        source,
        text: catalogueDescription,
        sourceUrl: sourceUrlForDescription(
          source,
          appMatch,
          targetCaption,
          rootsOverride
        ),
        note:
          source === 'roots'
            ? 'Imported as catalogue description with Roots provenance.'
            : source === 'ngs_artplus_catalog'
              ? 'Imported from NGS catalogue/API metadata. The public NGS artwork page is a record identity link, not proof that this text is visibly rendered there.'
              : 'Catalogue description exists but source is not explicit.',
      })
    );
  }

  const ngsDescription = cleanText(ngsCandidates?.[0]?.description);
  if (
    ngsDescription &&
    ngsDescription !== catalogueDescription &&
    ngsCandidates?.[0]?.sourceUrl
  ) {
    evidence.push(
      compactObject({
        kind: 'ngs_candidate_description',
        label: 'NGS catalogue API candidate description',
        source: 'ngs_artplus_catalog',
        text: ngsDescription,
        sourceUrl: ngsCandidates[0].sourceUrl,
        note: 'Matched by NGS accession/API metadata. Do not treat this as a public-page caption unless the live page visibly renders the same text.',
      })
    );
  }

  if (rootsOverride?.caption) {
    evidence.push(
      compactObject({
        kind: 'verified_roots_caption',
        label: 'Verified Roots catalogue text',
        source: 'roots',
        text: cleanText(rootsOverride.caption),
        sourceUrl: rootsOverride.rootsUrl,
        rootsTitle: cleanText(rootsOverride.rootsTitle),
        note: 'Loaded from eval/ngs-roots-caption-overrides.json.',
      })
    );
  }

  if (targetCaption?.caption) {
    evidence.push(
      compactObject({
        kind: 'generated_caption',
        label: 'Generated target image caption',
        source: 'generated',
        text: cleanText(targetCaption.caption),
        model: targetCaption.model,
        promptVersion: targetCaption.prompt_version,
        generatedAt: targetCaption.generated_at,
        sources: targetCaption.sources,
        sourceLabels: sourceLabelsFromUrls(targetCaption.sources),
        rootsSourceUrl: rootsUrlFromSources(targetCaption.sources),
        note: 'Generated caption; source URLs are provenance context, not proof that the sentence is copied from the source.',
      })
    );
  }

  if (
    staleCaption?.caption &&
    staleId !== targetId &&
    cleanText(staleCaption.caption) !== cleanText(targetCaption?.caption)
  ) {
    evidence.push(
      compactObject({
        kind: 'legacy_stale_generated_caption',
        label: 'Legacy stale v1 generated caption',
        source: 'generated',
        text: cleanText(staleCaption.caption),
        model: staleCaption.model,
        promptVersion: staleCaption.prompt_version,
        generatedAt: staleCaption.generated_at,
        sources: staleCaption.sources,
        sourceLabels: sourceLabelsFromUrls(staleCaption.sources),
        note: 'Shown for audit only. This belongs to the stale v1 ID and should not be carried into v2 without approval.',
      })
    );
  }

  return evidence;
};

const main = async () => {
  const corpusRows = readJsonLines(corpusPath);
  const captionsById = loadCaptions(captionsPath);
  const rootsCaptionsById = loadRootsCaptionOverrides(
    rootsCaptionOverridesPath
  );
  const rootsCollectionAudit = loadRootsCollectionAudit(
    rootsCollectionAuditPath
  );
  const appIds = loadAppRecords();
  const staleCorpusRows = corpusRows.filter((row) => !appIds.has(row.id));

  if (staleCorpusRows.length !== 93) {
    throw new Error(
      `Expected 93 stale v1 rows, found ${staleCorpusRows.length}. Refusing to write manifest.`
    );
  }

  const staleIds = staleCorpusRows.map((row) => row.id);
  const sourceRows = loadRowsByIds(
    sourceDbName,
    'artworks',
    staleIds,
    [
      'id',
      'accession_no',
      'title',
      'artist',
      'date_text',
      'classification',
      'medium',
      'dimensions',
      'credit_line',
      'description',
      'ngs_detail_url',
      'ngs_image_url',
      'roots_listing_url',
      'raw_roots',
    ].join(', ')
  );
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));

  const referencedAccessionsByStaleId = new Map();
  const referencedAccessions = new Set();
  for (const corpusRow of staleCorpusRows) {
    const sourceRow = sourceById.get(corpusRow.id) || {};
    const accessions = [
      ...new Set([
        ...referencedAccessionsFromText(sourceRow.title, corpusRow.title),
        ...(manualReferencedAccessionsByStaleId.get(corpusRow.id) || []),
      ]),
    ].filter(
      (accession) =>
        normalizeAccession(accession) !== normalizeAccession(corpusRow.id)
    );

    if (accessions.length > 0) {
      referencedAccessionsByStaleId.set(corpusRow.id, accessions);
      for (const accession of accessions) referencedAccessions.add(accession);
    }
  }

  const relatedSourceRows = loadRowsByIds(
    sourceDbName,
    'artworks',
    referencedAccessions,
    [
      'id',
      'accession_no',
      'title',
      'artist',
      'date_text',
      'classification',
      'medium',
      'dimensions',
      'credit_line',
      'description',
      'ngs_detail_url',
      'ngs_image_url',
      'roots_listing_url',
      'raw_roots',
    ].join(', ')
  );
  const relatedSourceById = new Map(
    relatedSourceRows.map((row) => [normalizeAccession(row.id), row])
  );
  const legacyAssetsByArtworkId = loadAssetRowsByArtworkIds(staleIds);

  const targetAccessions = new Set([
    ...[...canonicalMatches.values()].map((value) => value.targetAccession),
    ...[...suffixMatches.values()].map((value) => value.targetAccession),
    ...[...liveMetadataSuffixMatches.values()].map(
      (value) => value.targetAccession
    ),
    ...referencedAccessions,
  ]);
  const appRows = loadAppRowsByAccessions(targetAccessions);
  const appByAccession = new Map();
  for (const row of appRows) {
    if (row.id) appByAccession.set(normalizeAccession(row.id), row);
    if (row.accession_number) {
      appByAccession.set(normalizeAccession(row.accession_number), row);
    }
  }

  const rows = [];
  for (const corpusRow of staleCorpusRows) {
    const sourceRow = sourceById.get(corpusRow.id) || {};
    let category = 'no_live_source_match';
    let targetAccession = null;
    let proposedStatus = 'unresolved_quarantined';
    let explanation =
      'No accession-backed live NGS/Roots match has been verified for this stale v1 record.';
    let imageEvidence = null;
    let currentAppMatch = null;

    const canonical = canonicalMatches.get(corpusRow.id);
    const suffix = suffixMatches.get(corpusRow.id);
    const liveMetadataSuffix = liveMetadataSuffixMatches.get(corpusRow.id);
    const reviewerConfirmed = reviewerConfirmedMatches.get(corpusRow.id);
    const referencedAccessions =
      referencedAccessionsByStaleId.get(corpusRow.id) || [];
    const relatedRecords = referencedAccessions
      .map((accession) =>
        compactObject({
          accession,
          currentAppMatch: appSummary(
            appByAccession.get(normalizeAccession(accession))
          ),
          sourceRecord: sourceRecordSummary(
            relatedSourceById.get(normalizeAccession(accession))
          ),
        })
      )
      .filter((record) => record.currentAppMatch || record.sourceRecord);
    const componentPlaceholderApproval =
      reviewerApprovedComponentPlaceholders.get(corpusRow.id);
    const isComponentRecordsResolved =
      Boolean(componentPlaceholderApproval) &&
      referencedAccessions.length > 0 &&
      relatedRecords.length === referencedAccessions.length &&
      relatedRecords.every(hasComponentSourceAndImage);
    const legacyImageResolution = legacyImageResolutionSummary(
      corpusRow.id,
      legacyAssetsByArtworkId.get(corpusRow.id)
    );
    const webImageSource = webImageSourceSummary(
      webImageSourcesByAccession.get(normalizeAccession(corpusRow.id))
    );
    const isLegacyImageResolved =
      reviewerApprovedLegacyImageAccessions.has(
        normalizeAccession(corpusRow.id)
      ) &&
      Boolean(legacyImageResolution) &&
      (hasText(sourceRow.title) || hasText(corpusRow.title));

    if (reviewerConfirmed) {
      category = 'suggested_canonical';
      targetAccession = reviewerConfirmed.targetAccession;
      proposedStatus = 'suggested_needs_approval';
      explanation = reviewerConfirmed.explanation;
      imageEvidence = {
        method: 'reviewer_visual_confirmation',
        verdict: 'image_match',
        note: reviewerConfirmed.imageEvidenceNote,
      };
      currentAppMatch = appSummary(
        appByAccession.get(normalizeAccession(targetAccession))
      );
    } else if (canonical) {
      category = 'suggested_canonical';
      targetAccession = canonical.targetAccession;
      proposedStatus = 'suggested_needs_approval';
      explanation =
        'Stale v1 ID normalizes to an existing current app accession and the image audit found the same work.';
      imageEvidence = {
        method: 'local_vs_current_app_image_diff',
        meanAbsDiffRgb: canonical.meanAbsDiffRgb,
        verdict: 'image_match',
      };
      currentAppMatch = appSummary(
        appByAccession.get(normalizeAccession(targetAccession))
      );
    } else if (suffix) {
      category = 'suggested_suffix';
      targetAccession = suffix.targetAccession;
      proposedStatus = 'suggested_needs_approval';
      explanation =
        'Live/current NGS accession differs by the known -(PC) suffix while the image audit found the same work.';
      imageEvidence = {
        method: 'local_vs_current_app_image_diff',
        meanAbsDiffRgb: suffix.meanAbsDiffRgb,
        verdict: 'image_match',
      };
      currentAppMatch = appSummary(
        appByAccession.get(normalizeAccession(targetAccession))
      );
    } else if (liveMetadataSuffix) {
      category = 'suggested_suffix';
      targetAccession = liveMetadataSuffix.targetAccession;
      currentAppMatch = appSummary(
        appByAccession.get(normalizeAccession(targetAccession))
      );
      proposedStatus = currentAppMatch
        ? 'resolved_metadata_suffix_in_current_app'
        : 'resolved_metadata_suffix_add_to_v2';
      explanation = currentAppMatch
        ? 'No-title stale image has no safe standalone identity, but live NGS accession search found the suffixed record and the canonical record already exists in the current app. Include the canonical metadata record and exclude the stale image-only placeholder.'
        : 'No-title stale image has no safe standalone identity, but live NGS accession search found the suffixed record. Add the canonical metadata-only v2 record without an image embedding and exclude the stale image-only placeholder.';
    } else if (duplicateTitleImageMismatchIds.has(corpusRow.id)) {
      category = 'duplicate_title_image_mismatch';
      proposedStatus = 'manual_research_required';
      explanation =
        'Title/artist search returns plausible NGS records, but image evidence differs. This must not auto-map by title/artist.';
    } else if (isLegacyImageResolved) {
      category = 'no_live_source_match';
      targetAccession = corpusRow.id;
      proposedStatus = 'resolved_legacy_image_source_approved';
      explanation =
        webImageSource
          ? 'Reviewer requested this titled legacy row be included for v2. Use the existing paillette-stg image asset for display and add the found web image/source reference as enrichment provenance.'
          : 'Reviewer requested this titled legacy row be included for v2. No live NGS/Roots image page was verified; use the existing paillette-stg image asset with its recorded legacy import source and source-row metadata provenance.';
      imageEvidence = {
        method: webImageSource
          ? 'legacy_r2_asset_with_web_image_source'
          : 'legacy_r2_asset_source',
        verdict: 'legacy_image_available',
        note: webImageSource
          ? `Web image/source found: ${webImageSource.pageUrl}`
          : legacyImageResolution.note,
      };
    } else if (!hasText(sourceRow.title) && !hasText(corpusRow.title)) {
      category = 'no_title_orphan_image';
      proposedStatus = 'manual_research_required';
      explanation =
        'Stale record has an image but no usable title in the old source row, so it cannot be matched safely.';
    }

    if (isComponentRecordsResolved) {
      proposedStatus = 'resolved_component_records_approved';
      explanation =
        'Stale parent row is a placeholder. The referenced child records have source-backed NGS/Roots metadata and image assets, so include the child records for v2 and exclude this parent placeholder.';
    }

    const captionPolicy = captionPolicyForRow({
      staleId: corpusRow.id,
      targetAccession,
      appMatch: currentAppMatch,
      captionsById,
      rootsCaptionsById,
    });
    const reviewerRequestedDone =
      targetAccession &&
      reviewerRequestedDoneAccessions.has(normalizeAccession(targetAccession));
    const isResolvedApproved =
      reviewerRequestedDone && Boolean(captionPolicy?.approvedForV2);
    const isLiveMetadataSuffixResolved = Boolean(liveMetadataSuffix);

    if (isResolvedApproved) {
      proposedStatus = 'resolved_approved_mapping';
      explanation =
        'Reviewer marked this mapping done. It is hidden from the active resolve queue and kept only as approved audit evidence for v2.';
    }

    const candidateQueries =
      !isLegacyImageResolved &&
      (targetAccession ||
        exactCandidateAccessions.has(corpusRow.id) ||
        (category !== 'no_title_orphan_image' && hasText(sourceRow.title)));
    let ngsCandidates = [];

    if (targetAccession && !isLegacyImageResolved) {
      ngsCandidates = await findNgsCandidates(sourceRow, targetAccession);
      if (ngsCandidates[0] && imageEvidence) {
        ngsCandidates[0].imageEvidence = imageEvidence;
      }
      if (reviewerConfirmed?.additionalCandidateAccessions?.length) {
        for (const accession of reviewerConfirmed.additionalCandidateAccessions) {
          const relatedCandidates = await findNgsCandidates(
            sourceRow,
            accession
          );
          ngsCandidates.push(
            ...relatedCandidates.map((candidate) => ({
              ...candidate,
              matchBasis: 'same_title_candidate_kept_separate',
              imageEvidence: {
                method: 'reviewer_visual_confirmation',
                verdict: 'separate_same_title_candidate',
                note: 'Reviewer identified this as the separate same-title Gibbons candidate, not the yellowed-background stale image.',
              },
            }))
          );
        }
      }
    } else if (exactCandidateAccessions.has(corpusRow.id)) {
      const candidates = [];
      for (const accession of exactCandidateAccessions.get(corpusRow.id)) {
        const exactCandidates = await findNgsCandidates(sourceRow, accession);
        candidates.push(...exactCandidates);
      }
      ngsCandidates = candidates.map((candidate) => ({
        ...candidate,
        matchBasis: 'title_artist_candidate_rejected_by_image',
        imageEvidence: {
          method: 'visual_review',
          verdict: 'image_mismatch',
          note: 'The stale v1 image is not the same image as this NGS candidate.',
        },
      }));
    } else if (candidateQueries) {
      ngsCandidates = (await findNgsCandidates(sourceRow)).map((candidate) => ({
        ...candidate,
        matchBasis: 'title_artist_search_unapproved',
      }));
    }

    rows.push(
      compactObject({
        staleId: corpusRow.id,
        category,
        categoryLabel: categoryLabels[category],
        proposedStatus,
        targetAccession,
        explanation,
        stale: sourceSummary(corpusRow, sourceRow),
        currentAppMatch,
        ngsCandidates,
        rootsCandidates: [
          ...rootsFromSourceRow(sourceRow, rootsCollectionAudit),
          ...rootsFromLiveSuffixMatch(liveMetadataSuffix),
        ],
        resolutionState:
          isResolvedApproved ||
          isLiveMetadataSuffixResolved ||
          isComponentRecordsResolved ||
          isLegacyImageResolved
            ? 'resolved_approved'
            : 'active',
        componentResolution: isComponentRecordsResolved
          ? {
              status: 'child_records_approved_for_v2',
              approvedAccessions: relatedRecords.map(
                (record) => record.accession
              ),
              note: componentPlaceholderApproval.note,
            }
          : null,
        legacyImageResolution: isLegacyImageResolved
          ? legacyImageResolution
          : null,
        webImageSource,
        captionPolicy,
        relatedRecords,
        captionEvidence: captionEvidenceForRow({
          staleId: corpusRow.id,
          targetAccession,
          appMatch: currentAppMatch,
          ngsCandidates,
          captionsById,
          rootsCaptionsById,
        }),
        defaultVerdict:
          isResolvedApproved ||
          isLiveMetadataSuffixResolved ||
          isComponentRecordsResolved ||
          isLegacyImageResolved
            ? 'approve_mapping'
            : category === 'suggested_canonical' ||
                category === 'suggested_suffix'
              ? 'needs_manual_research'
              : 'exclude_from_v2',
      })
    );
  }

  rows.sort((left, right) => {
    const order = [
      'suggested_canonical',
      'suggested_suffix',
      'duplicate_title_image_mismatch',
      'no_live_source_match',
      'no_title_orphan_image',
    ];
    const categoryDelta =
      order.indexOf(left.category) - order.indexOf(right.category);
    return categoryDelta || left.staleId.localeCompare(right.staleId);
  });

  const countsByCategory = rows.reduce((counts, row) => {
    counts[row.category] = (counts[row.category] || 0) + 1;
    return counts;
  }, {});
  const resolvedApproved = rows.filter(
    (row) => row.resolutionState === 'resolved_approved'
  ).length;
  const activeRows = rows.length - resolvedApproved;
  const activeNeedsResearch = rows.filter(
    (row) =>
      row.resolutionState !== 'resolved_approved' &&
      row.defaultVerdict === 'needs_manual_research'
  ).length;
  const activeExcludeFromV2 = rows.filter(
    (row) =>
      row.resolutionState !== 'resolved_approved' &&
      row.defaultVerdict === 'exclude_from_v2'
  ).length;
  const unresolvedQuarantined = rows.filter(
    (row) =>
      row.resolutionState !== 'resolved_approved' &&
      [
        'duplicate_title_image_mismatch',
        'no_live_source_match',
        'no_title_orphan_image',
      ].includes(row.category)
  ).length;

  const summary = {
    total: rows.length,
    activeRows,
    resolvedApproved,
    activeNeedsResearch,
    activeExcludeFromV2,
    suggestedCanonical: countsByCategory.suggested_canonical || 0,
    suggestedSuffix: countsByCategory.suggested_suffix || 0,
    unresolvedQuarantined,
    countsByCategory,
    expected: {
      total: 93,
      suggestedCanonical: 15,
      suggestedSuffix: 38,
      unresolvedQuarantined: 7,
    },
  };

  if (
    summary.suggestedCanonical !== 15 ||
    summary.suggestedSuffix !== 38 ||
    summary.unresolvedQuarantined !== 7
  ) {
    throw new Error(
      `Unexpected manifest bucket counts: ${JSON.stringify(summary)}`
    );
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: {
      corpusPath,
      captionsPath,
      rootsCaptionOverridesPath,
      rootsCollectionAuditPath,
      sourceDbName,
      appDbName,
      rule: 'Review-only manifest. No vector/image changes are applied by this artifact. Live NGS/Roots-backed suffixed accessions are approved for v2 metadata inclusion, including metadata-only records with no image embedding. Placeholder rows whose referenced child records have source-backed NGS/Roots metadata and image assets are resolved by including the child records and excluding the parent placeholder. Reviewer-approved titled legacy rows with existing paillette-stg image assets are included for v2 with legacy image/source provenance, and any found web image/source references are recorded as enrichment provenance. Unresolved stale rows default to exclude_from_v2 until a reviewer approves accession and source evidence.',
    },
    categoryLabels,
    summary,
    rootsCollectionAudit: {
      auditedAt: rootsCollectionAudit.auditedAt || null,
      rule:
        rootsCollectionAudit.rule ||
        'Only Roots pages whose Collection of field is National Gallery Singapore are trusted for NGS enrichment.',
      summary: rootsCollectionAudit.summary,
      nonNgsRoots: rootsCollectionAudit.nonNgsRoots,
      extraUrls: rootsCollectionAudit.extraUrls,
    },
    regressionChecks: [
      {
        id: '1993-00014_o3',
        expected: '1993-00014 / Great Earth',
        actual: rows.find((row) => row.staleId === '1993-00014_o3')
          ?.targetAccession,
      },
      {
        id: 'GI-0105',
        expected: 'GI-0105-(PC) / Orange Seller',
        actual: rows.find((row) => row.staleId === 'GI-0105')?.targetAccession,
      },
      {
        id: '2011-01720',
        expected: '1992-00235 / Gibbons at Play; P-1244 kept separate',
        actual: rows.find((row) => row.staleId === '2011-01720')
          ?.targetAccession,
      },
    ],
    rows,
  };

  for (const path of [evalManifestPath, webManifestPath]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const allowlist = {};
  for (const row of rows) {
    allowlist[row.staleId] = {
      thumb: row.stale.image?.thumbKey || null,
      original: row.stale.image?.originalKey || null,
    };
  }

  mkdirSync(dirname(apiAllowlistPath), { recursive: true });
  writeFileSync(
    apiAllowlistPath,
    `// Generated by scripts/build-ngs-discrepancy-review.mjs. Do not edit by hand.\n` +
      `export const ngsReviewImageAllowlist = ${JSON.stringify(
        allowlist,
        null,
        2
      )} as const;\n\n` +
      `export type NgsReviewStaleId = keyof typeof ngsReviewImageAllowlist;\n` +
      `export type NgsReviewImageRole = 'thumb' | 'original';\n`
  );

  console.log(
    JSON.stringify(
      {
        evalManifestPath,
        webManifestPath,
        apiAllowlistPath,
        summary,
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
