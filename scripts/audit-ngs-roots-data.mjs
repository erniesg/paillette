#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Papa from 'papaparse';

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

const dbName = args.get('d1') || 'paillette-stg';
const chunkSize = Number(args.get('chunk-size') || 500);
const outPath = args.get('out') || null;
const fetchRoots = args.get('fetch-roots') || 'false';
const fetchRootsMode =
  fetchRoots === 'all' ? 'all' : fetchRoots === 'true' ? 'issues' : 'none';
const fetchConcurrency = Math.max(
  1,
  Number(args.get('fetch-concurrency') || 8)
);
const fetchTimeoutMs = Math.max(
  1000,
  Number(args.get('fetch-timeout-ms') || 15_000)
);
const rootsCachePath =
  args.get('roots-cache') || '/tmp/paillette-roots-page-cache.json';
const rootsCsvPaths = String(
  args.get('roots-csv') ||
    new URL('../data/df_10K_nhb_all.csv', import.meta.url).pathname
)
  .split(',')
  .map((path) => path.trim())
  .filter(Boolean);

const rootsDescriptionOverridesPath =
  args.get('roots-description-overrides') ||
  new URL('../eval/ngs-roots-description-overrides.json', import.meta.url)
    .pathname;
const rootsCaptionOverridesPath =
  args.get('roots-caption-overrides') ||
  new URL('../eval/ngs-roots-caption-overrides.json', import.meta.url).pathname;

const wranglerCandidates = [
  join(process.cwd(), 'apps/api/node_modules/.bin/wrangler'),
  join(process.cwd(), 'apps/web/node_modules/.bin/wrangler'),
  join(process.cwd(), 'node_modules/.bin/wrangler'),
  'wrangler',
];
const wrangler =
  wranglerCandidates.find((candidate) => existsSync(candidate)) || 'wrangler';

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

const parseJson = (value) => {
  if (!value || typeof value !== 'string') return value || null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readJsonFile = (path, fallback) => {
  if (!path || !existsSync(path)) return fallback;

  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};

const asRecord = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const d1 = (sql) => {
  const output = execFileSync(
    wrangler,
    ['d1', 'execute', dbName, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  const payload = JSON.parse(output);
  if (!Array.isArray(payload) || !payload[0]?.success) {
    throw new Error(`D1 query failed: ${output.slice(0, 1000)}`);
  }
  return payload[0].results || [];
};

const loadRootsOverrides = (...paths) => {
  const records = new Map();
  for (const path of paths) {
    if (!existsSync(path)) continue;

    const payload = JSON.parse(readFileSync(path, 'utf8'));
    const entries = [
      ...(Array.isArray(payload.verified_roots_description_records)
        ? payload.verified_roots_description_records
        : []),
      ...(Array.isArray(payload.verified_roots_caption_records)
        ? payload.verified_roots_caption_records
        : []),
    ];

    for (const entry of entries) {
      if (!entry?.id) continue;
      records.set(entry.id, {
        ...records.get(entry.id),
        ...entry,
      });
    }
  }
  return records;
};

const getNgsTitle = (ngs, row) =>
  firstText(ngs.objObjectTitleTxt, ngs.title, row.title);

const getNgsArtist = (ngs, row) =>
  firstText(
    ngs.artistAvailableNames,
    ...(Array.isArray(ngs.artistCfs)
      ? ngs.artistCfs.map(
          (artist) => artist?.availableName || artist?.perNameTxt
        )
      : []),
    row.artist
  );

const getNgsDescription = (ngs) =>
  firstText(
    ngs.objDescriptionClb,
    ngs.ocspWebText,
    ngs.description,
    ngs.caption,
    ngs.summary,
    ngs.text
  );

const getRootsTitle = (roots) =>
  firstText(roots.title, roots.objectTitle, roots.object_title, roots.name);

const getRootsArtist = (roots) =>
  firstText(roots.creator, roots.artist, roots.maker, roots.author);

const getNgsAccession = (ngs, row) =>
  firstText(
    row.accession_no,
    row.accession_number,
    row.id,
    ngs.objObjectNumberTxt,
    ngs.accessionNo,
    ngs.accession_no,
    ngs.accessionNumber,
    ngs.accession_number,
    ngs.objectNumber
  );

const getRootsAccession = (roots) =>
  firstText(
    roots.accession,
    roots.accessionNo,
    roots.accession_no,
    roots.accessionNumber,
    roots.accession_number,
    roots.metadata_accession_no,
    roots.metadata_accession_no_csv,
    roots.metadata_accession_no_0
  );

const normalizeAccession = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const accessionsMatch = (left, right) => {
  const normalizedLeft = normalizeAccession(left);
  const normalizedRight = normalizeAccession(right);
  return Boolean(
    normalizedLeft && normalizedRight && normalizedLeft === normalizedRight
  );
};

const isNgsCollectionName = (value) =>
  /(^|\b)National Gallery Singapore(\b|$)/i.test(String(value || ''));

const normalizeRootsUrl = (value) =>
  String(value || '')
    .trim()
    .replace(/^http:\/\//i, 'https://')
    .replace(/\/+$/g, '');

const rootsPageIdFromUrl = (value) =>
  String(value || '').match(/\/listing\/(\d+)/i)?.[1] || null;

const loadRootsSourceRecords = (paths) => {
  const byUrl = new Map();
  const byPageId = new Map();
  const byAccession = new Map();

  for (const path of paths) {
    if (!existsSync(path)) continue;

    const parsed = Papa.parse(readFileSync(path, 'utf8'), {
      header: true,
      skipEmptyLines: true,
    });
    for (const row of parsed.data || []) {
      if (!row || typeof row !== 'object') continue;
      const record = {
        accession: firstText(
          row.documents_0_metadata_accession_no,
          row.documents_0_metadata_accession_no_csv,
          row.documents_0_metadata_accession_no_0
        ),
        collection: firstText(
          row.documents_0_metadata_collection_of,
          row.documents_0_metadata_collection_of_0
        ),
        creator: firstText(
          row.documents_0_metadata_creator,
          row.documents_0_metadata_creator_0
        ),
        pageId: firstText(
          row.documents_0_metadata_pageId,
          row.documents_0_metadata_pageId_0
        ),
        title: firstText(row.documents_0_title),
        url: normalizeRootsUrl(row.documents_0_path),
      };

      if (!record.url && record.pageId) {
        record.url = `https://www.roots.gov.sg/Collection-Landing/listing/${record.pageId}`;
      }
      if (!record.pageId) record.pageId = rootsPageIdFromUrl(record.url);

      if (record.url) byUrl.set(record.url, record);
      if (record.pageId) byPageId.set(record.pageId, record);
      if (record.accession)
        byAccession.set(normalizeAccession(record.accession), record);
    }
  }

  return { byAccession, byPageId, byUrl };
};

const sourceKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .trim();

const isTrustedDescriptionSource = (value) =>
  [
    'ngs',
    'ngs_source_data',
    'stored_ngs_source_data',
    'national_gallery_singapore',
    'nationalgallerysingapore',
    'ngs_artplus_catalog',
    'ngs_art+_catalogue',
    'artplus',
    'roots',
    'nhb_roots',
    'roots_nhb',
  ].includes(sourceKey(value));

const isNgsDescriptionSource = (value) =>
  [
    'ngs',
    'ngs_source_data',
    'stored_ngs_source_data',
    'national_gallery_singapore',
    'nationalgallerysingapore',
    'ngs_artplus_catalog',
    'ngs_art+_catalogue',
    'artplus',
  ].includes(sourceKey(value));

const isRootsDescriptionSource = (value) =>
  ['roots', 'nhb_roots', 'roots_nhb'].includes(sourceKey(value));

const canonicalPersonName = (value) =>
  String(value || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const htmlToTextLines = (html) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const fetchRootsPageSummary = async (url) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 paillette-source-audit' },
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });
  if (!response.ok) return null;
  const lines = htmlToTextLines(await response.text());
  const shareIndex = lines.findIndex((line) => /^share on$/i.test(line));
  const collectionIndex = lines.findIndex((line) =>
    /^collection of$/i.test(line)
  );
  const descriptionLines =
    collectionIndex >= 0 && shareIndex > collectionIndex
      ? lines
          .slice(collectionIndex + 2, shareIndex)
          .filter((line) => line.length > 40)
      : [];

  return {
    title: lines[lines.findIndex((line) => /^title$/i.test(line)) + 1] || null,
    creator:
      lines[lines.findIndex((line) => /^creator$/i.test(line)) + 1] || null,
    accession:
      lines[lines.findIndex((line) => /^accession no\.$/i.test(line)) + 1] ||
      null,
    collectionOf:
      collectionIndex >= 0 ? lines[collectionIndex + 1] || null : null,
    description: descriptionLines.join(' ') || null,
  };
};

const runLimited = async (items, limit, worker) => {
  let index = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const current = index;
        index += 1;
        if (current >= items.length) return;
        await worker(items[current], current);
      }
    }
  );
  await Promise.all(workers);
};

const columns = d1('PRAGMA table_info(artworks)').map((column) => column.name);
const hasColumn = (name) => columns.includes(name);
const selectColumns = [
  'id',
  'title',
  'artist',
  'date_text',
  hasColumn('accession_no') ? 'accession_no' : null,
  hasColumn('accession_number') ? 'accession_number' : null,
  'medium',
  'dimensions',
  'credit_line',
  'description',
  hasColumn('metadata_sources') ? 'metadata_sources' : null,
  hasColumn('field_sources') ? 'field_sources' : null,
  'raw_ngs',
  'raw_roots',
  'ngs_detail_url',
  'roots_listing_url',
].filter((column) => column && hasColumn(column));

const rows = [];
for (let offset = 0; ; offset += chunkSize) {
  const page = d1(
    `SELECT ${selectColumns.join(', ')} FROM artworks ORDER BY rowid LIMIT ${chunkSize} OFFSET ${offset}`
  );
  rows.push(...page);
  process.stderr.write(`audited input ${rows.length}\n`);
  if (page.length < chunkSize) break;
}

const rootsOverrides = loadRootsOverrides(
  rootsDescriptionOverridesPath,
  rootsCaptionOverridesPath
);
const rootsSourceRecords = loadRootsSourceRecords(rootsCsvPaths);

const knownTitles = rows
  .map((row) => ({
    id: row.id,
    title: row.title,
    key: normalizeComparableText(row.title),
  }))
  .filter((entry) => entry.key.length >= 8)
  .sort((a, b) => b.key.length - a.key.length);

const knownArtists = rows
  .map((row) => ({
    id: row.id,
    artist: canonicalPersonName(row.artist),
    key: normalizeComparableText(canonicalPersonName(row.artist)),
  }))
  .filter(
    (entry, index, array) =>
      entry.key.length >= 10 &&
      entry.key.includes(' ') &&
      array.findIndex((candidate) => candidate.key === entry.key) === index
  );

const descriptionClaimsOtherArtistAsAuthor = (descriptionKey, artistKey) => {
  const authorVerbs =
    '(?:is|was|created|painted|depicts|portrays|brings|uses|draws|drew|sketched|produced|features|employs|presented|made|captures|conveys|explores|references|shows|recalls|constructs|combines|developed)';
  return new RegExp(
    `(?:^|\\bhere\\s+)${artistKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${authorVerbs}\\b`
  ).test(descriptionKey);
};

let issues = [];
const addIssue = (row, code, severity, details = {}) => {
  issues.push({
    id: row.id,
    title: row.title,
    artist: row.artist,
    code,
    severity,
    roots_listing_url: row.roots_listing_url || null,
    ngs_detail_url: row.ngs_detail_url || null,
    ...details,
  });
};

for (const row of rows) {
  const ngs = asRecord(parseJson(row.raw_ngs));
  const roots = asRecord(parseJson(row.raw_roots));
  const fieldSources = asRecord(
    parseJson(row.metadata_sources || row.field_sources)
  );
  const rootsOverride = rootsOverrides.get(row.id);
  const description = firstText(row.description);
  const ngsTitle = getNgsTitle(ngs, row);
  const ngsArtist = getNgsArtist(ngs, row);
  const rootsTitle = getRootsTitle(roots);
  const rootsArtist = getRootsArtist(roots);
  const ngsDescription = getNgsDescription(ngs);
  const verifiedRootsDescription = firstText(rootsOverride?.caption);
  const ngsAccession = getNgsAccession(ngs, row);
  const rootsAccession = getRootsAccession(roots);
  const rootsSourceRecord =
    rootsSourceRecords.byUrl.get(normalizeRootsUrl(row.roots_listing_url)) ||
    rootsSourceRecords.byPageId.get(
      roots.pageid || roots.pageId || rootsPageIdFromUrl(row.roots_listing_url)
    );
  const rootsSourceAccession = rootsSourceRecord?.accession || null;

  if (
    row.roots_listing_url &&
    rootsSourceRecord?.collection &&
    !isNgsCollectionName(rootsSourceRecord.collection)
  ) {
    addIssue(row, 'roots_source_collection_not_ngs', 'error', {
      actual: rootsSourceRecord.collection,
      rootsSourceTitle: rootsSourceRecord.title || null,
      rootsSourceAccession,
      rootsSourceUrl: rootsSourceRecord.url || null,
    });
  }

  if (
    rootsAccession &&
    ngsAccession &&
    !accessionsMatch(rootsAccession, ngsAccession)
  ) {
    addIssue(row, 'roots_raw_accession_mismatch', 'error', {
      expected: ngsAccession,
      actual: rootsAccession,
    });
  }

  if (
    row.roots_listing_url &&
    rootsSourceAccession &&
    ngsAccession &&
    !accessionsMatch(rootsSourceAccession, ngsAccession)
  ) {
    addIssue(row, 'roots_source_accession_mismatch', 'error', {
      expected: ngsAccession,
      actual: rootsSourceAccession,
      rootsSourceTitle: rootsSourceRecord?.title || null,
      rootsSourceUrl: rootsSourceRecord?.url || null,
    });
  }

  if (row.roots_listing_url && !rootsAccession && !rootsSourceAccession) {
    addIssue(row, 'roots_accession_unverified', 'warning', {
      expected: ngsAccession || null,
      rootsPageId:
        roots.pageid ||
        roots.pageId ||
        rootsPageIdFromUrl(row.roots_listing_url),
    });
  }

  if (Object.keys(ngs).length > 0) {
    if (ngsTitle && row.title && !comparableTextMatches(ngsTitle, row.title)) {
      addIssue(row, 'title_mismatch_ngs', 'error', {
        expected: ngsTitle,
        actual: row.title,
      });
    }
    if (
      ngsArtist &&
      row.artist &&
      !comparableTextMatches(ngsArtist, canonicalPersonName(row.artist))
    ) {
      addIssue(row, 'artist_mismatch_ngs', 'error', {
        expected: ngsArtist,
        actual: row.artist,
      });
    }
  } else if (Object.keys(roots).length > 0) {
    if (
      rootsTitle &&
      row.title &&
      !comparableTextMatches(rootsTitle, row.title)
    ) {
      addIssue(row, 'title_mismatch_roots', 'warning', {
        expected: rootsTitle,
        actual: row.title,
      });
    }
    if (
      rootsArtist &&
      row.artist &&
      !comparableTextMatches(rootsArtist, canonicalPersonName(row.artist))
    ) {
      addIssue(row, 'artist_mismatch_roots', 'warning', {
        expected: rootsArtist,
        actual: row.artist,
      });
    }
  }

  if (
    description &&
    ngsDescription &&
    isNgsDescriptionSource(fieldSources.description) &&
    !comparableTextMatches(description, ngsDescription)
  ) {
    addIssue(row, 'description_mismatch_ngs', 'error', {
      expectedPrefix: ngsDescription.slice(0, 220),
      actualPrefix: description.slice(0, 220),
      descriptionSource: fieldSources.description || null,
    });
  }

  if (
    description &&
    verifiedRootsDescription &&
    (isRootsDescriptionSource(fieldSources.description) ||
      !isTrustedDescriptionSource(fieldSources.description)) &&
    !comparableTextMatches(description, verifiedRootsDescription)
  ) {
    addIssue(row, 'description_stale_vs_verified_roots', 'error', {
      expectedPrefix: verifiedRootsDescription.slice(0, 220),
      actualPrefix: description.slice(0, 220),
      descriptionSource: fieldSources.description || null,
    });
  }

  if (
    description &&
    !ngsDescription &&
    !verifiedRootsDescription &&
    !isTrustedDescriptionSource(fieldSources.description)
  ) {
    addIssue(row, 'unverified_description_source', 'warning', {
      actualPrefix: description.slice(0, 220),
      descriptionSource: fieldSources.description || null,
    });
  }

  if (description) {
    const hasTrustedDescription =
      Boolean(ngsDescription || verifiedRootsDescription) ||
      isTrustedDescriptionSource(fieldSources.description);
    const crossReferenceSeverity = hasTrustedDescription ? 'warning' : 'error';
    const descriptionKey = normalizeComparableText(description);
    const foreignTitle = knownTitles.find(
      (entry) =>
        entry.id !== row.id &&
        !comparableTextMatches(entry.title, row.title) &&
        !descriptionKey.startsWith(
          `${entry.key} ${normalizeComparableText(row.title)}`
        ) &&
        descriptionKey.startsWith(`${entry.key} `)
    );
    if (foreignTitle) {
      addIssue(row, 'foreign_title_in_description', crossReferenceSeverity, {
        foreignTitle: foreignTitle.title,
        actualPrefix: description.slice(0, 220),
      });
    }

    const ownArtistKey = normalizeComparableText(
      canonicalPersonName(row.artist)
    );
    const foreignArtist = knownArtists.find(
      (entry) =>
        entry.id !== row.id &&
        entry.key !== ownArtistKey &&
        descriptionClaimsOtherArtistAsAuthor(descriptionKey, entry.key)
    );
    if (foreignArtist) {
      addIssue(row, 'foreign_artist_in_description', crossReferenceSeverity, {
        foreignArtist: foreignArtist.artist,
        actualPrefix: description.slice(0, 220),
      });
    }
  }
}

if (fetchRootsMode !== 'none') {
  const liveVerifiedAccessions = new Set();
  const issueCandidates = issues
    .filter((issue) => issue.roots_listing_url)
    .map((issue) => ({ issue, row: rows.find((row) => row.id === issue.id) }));
  const allCandidates = rows
    .filter((row) => row.roots_listing_url)
    .map((row) => ({ issue: null, row }));
  const fetchCandidates =
    fetchRootsMode === 'all' ? allCandidates : issueCandidates;
  const rootsPageCache = new Map(
    Object.entries(readJsonFile(rootsCachePath, {}))
  );
  const rootsPagePromises = new Map();
  const flushRootsCache = () => {
    mkdirSync(dirname(rootsCachePath), { recursive: true });
    writeFileSync(
      rootsCachePath,
      `${JSON.stringify(Object.fromEntries(rootsPageCache), null, 2)}\n`
    );
  };
  const getRootsPage = (url) => {
    const cacheKey = normalizeRootsUrl(url);
    if (rootsPageCache.has(cacheKey)) return rootsPageCache.get(cacheKey);
    if (!rootsPagePromises.has(cacheKey)) {
      rootsPagePromises.set(
        cacheKey,
        fetchRootsPageSummary(cacheKey)
          .then((rootsPage) => {
            rootsPageCache.set(cacheKey, rootsPage);
            return rootsPage;
          })
          .finally(() => {
            rootsPagePromises.delete(cacheKey);
          })
      );
    }
    return rootsPagePromises.get(cacheKey);
  };
  let fetched = 0;

  await runLimited(fetchCandidates, fetchConcurrency, async (candidate) => {
    const row = candidate.row;
    const issue = candidate.issue;
    if (!row?.roots_listing_url) return;

    try {
      const rootsPage = await getRootsPage(row.roots_listing_url);
      fetched += 1;
      if (fetched % 100 === 0 || fetched === fetchCandidates.length) {
        process.stderr.write(
          `fetched live roots ${fetched}/${fetchCandidates.length}\n`
        );
        flushRootsCache();
      }

      if (rootsPage?.description) {
        if (issue) {
          issue.officialRootsTitle = rootsPage.title;
          issue.officialRootsAccession = rootsPage.accession;
          issue.officialRootsDescriptionPrefix = rootsPage.description.slice(
            0,
            220
          );
        }
      }

      if (fetchRootsMode === 'all') {
        const ngs = asRecord(parseJson(row.raw_ngs));
        const expected = getNgsAccession(ngs, row);
        if (rootsPage?.collectionOf && !isNgsCollectionName(rootsPage.collectionOf)) {
          addIssue(row, 'roots_live_collection_not_ngs', 'error', {
            expected: 'National Gallery Singapore',
            actual: rootsPage.collectionOf,
            officialRootsTitle: rootsPage.title,
            officialRootsAccession: rootsPage.accession,
          });
        }
        if (
          rootsPage?.accession &&
          !accessionsMatch(expected, rootsPage.accession)
        ) {
          addIssue(row, 'roots_live_accession_mismatch', 'error', {
            expected,
            actual: rootsPage.accession,
            officialRootsTitle: rootsPage.title,
          });
        } else if (rootsPage?.accession) {
          liveVerifiedAccessions.add(row.id);
        } else if (!rootsPage?.accession) {
          addIssue(row, 'roots_live_accession_missing', 'warning', {
            expected,
          });
        }
      }
    } catch (error) {
      if (issue) {
        issue.officialRootsFetchError =
          error instanceof Error ? error.message : String(error);
      } else {
        addIssue(row, 'roots_live_fetch_failed', 'warning', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
  flushRootsCache();

  if (fetchRootsMode === 'all' && liveVerifiedAccessions.size > 0) {
    issues = issues.filter(
      (issue) =>
        issue.code !== 'roots_accession_unverified' ||
        !liveVerifiedAccessions.has(issue.id)
    );
  }
}

const summary = issues.reduce(
  (acc, issue) => {
    acc.total += 1;
    acc.bySeverity[issue.severity] = (acc.bySeverity[issue.severity] || 0) + 1;
    acc.byCode[issue.code] = (acc.byCode[issue.code] || 0) + 1;
    return acc;
  },
  { rows: rows.length, total: 0, bySeverity: {}, byCode: {} }
);
const report = {
  audited_at: new Date().toISOString(),
  database: dbName,
  live_roots_fetch:
    fetchRootsMode === 'none'
      ? null
      : {
          mode: fetchRootsMode,
          concurrency: fetchConcurrency,
          timeout_ms: fetchTimeoutMs,
          cache_path: rootsCachePath,
        },
  roots_description_overrides: rootsDescriptionOverridesPath,
  roots_caption_overrides: rootsCaptionOverridesPath,
  summary,
  issues,
};

if (outPath) {
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));

if ((summary.bySeverity.error || 0) > 0) {
  process.exitCode = 1;
}
