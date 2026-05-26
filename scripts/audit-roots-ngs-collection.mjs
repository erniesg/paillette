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

const sourceDbName = args.get('source-d1') || 'paillette-stg';
const outPath =
  args.get('out') ||
  new URL('../eval/ngs-roots-collection-audit.json', import.meta.url).pathname;
const rootsCsvPath =
  args.get('roots-csv') ||
  new URL('../data/df_10K_nhb_all.csv', import.meta.url).pathname;
const extraUrls = String(args.get('extra-url') || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const fetchMissing = args.get('fetch-missing') === 'true';
const fetchConcurrency = Math.max(
  1,
  Number(args.get('fetch-concurrency') || 12)
);
const fetchTimeoutMs = Math.max(
  1000,
  Number(args.get('fetch-timeout-ms') || 15_000)
);

const wranglerCandidates = [
  join(process.cwd(), 'apps/api/node_modules/.bin/wrangler'),
  join(process.cwd(), 'apps/web/node_modules/.bin/wrangler'),
  join(process.cwd(), 'node_modules/.bin/wrangler'),
  'wrangler',
];
const wrangler =
  wranglerCandidates.find((candidate) => existsSync(candidate)) || 'wrangler';

const sqlQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const normalizeUrl = (value) =>
  String(value || '')
    .trim()
    .replace(/^http:\/\//i, 'https://')
    .replace(/\/+$/g, '');
const pageIdFromUrl = (value) =>
  String(value || '').match(/\/listing\/(\d+)/i)?.[1] || null;
const isNgsCollectionName = (value) =>
  /(^|\b)National Gallery Singapore(\b|$)/i.test(String(value || ''));

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

const firstText = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

const loadRootsCsv = (path) => {
  const byPageId = new Map();
  const byUrl = new Map();
  if (!existsSync(path)) return { byPageId, byUrl };

  const parsed = Papa.parse(readFileSync(path, 'utf8'), {
    header: true,
    skipEmptyLines: true,
  });

  for (const row of parsed.data || []) {
    if (!row || typeof row !== 'object') continue;
    const url = normalizeUrl(row.documents_0_path);
    const pageId = firstText(row.documents_0_metadata_pageId, pageIdFromUrl(url));
    const record = {
      url,
      pageId,
      title: firstText(row.documents_0_title),
      accession: firstText(
        row.documents_0_metadata_accession_no,
        row.documents_0_metadata_accession_no_csv,
        row.documents_0_metadata_accession_no_0
      ),
      collectionOf: firstText(
        row.documents_0_metadata_collection_of,
        row.documents_0_metadata_collection_of_0
      ),
      source: 'roots_csv',
    };
    if (record.pageId) byPageId.set(record.pageId, record);
    if (record.url) byUrl.set(record.url, record);
  }

  return { byPageId, byUrl };
};

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
    headers: { 'User-Agent': 'Mozilla/5.0 paillette-ngs-roots-audit' },
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });
  if (!response.ok) {
    return { url, fetchError: `HTTP ${response.status}` };
  }

  const lines = htmlToTextLines(await response.text());
  const valueAfter = (labelPattern) => {
    const index = lines.findIndex((line) => labelPattern.test(line));
    return index >= 0 ? lines[index + 1] || null : null;
  };

  return {
    url,
    pageId: pageIdFromUrl(url),
    title: valueAfter(/^title$/i),
    accession: valueAfter(/^accession no\.$/i),
    collectionOf: valueAfter(/^collection of$/i),
    source: 'live_roots',
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

const sourceRows = d1(
  sourceDbName,
  `
    SELECT id, accession_no, title, artist, credit_line, ngs_detail_url, roots_listing_url
    FROM artworks
    WHERE roots_listing_url IS NOT NULL AND trim(roots_listing_url) <> ''
    ORDER BY id
  `
);
const rootsCsv = loadRootsCsv(rootsCsvPath);

const entries = [];
const missingRows = [];
for (const row of sourceRows) {
  const url = normalizeUrl(row.roots_listing_url);
  const pageId = pageIdFromUrl(url);
  const csvRecord = rootsCsv.byUrl.get(url) || rootsCsv.byPageId.get(pageId);
  if (!csvRecord) missingRows.push(row);

  entries.push({
    id: row.id,
    accession: row.accession_no,
    title: row.title,
    artist: row.artist,
    creditLine: row.credit_line,
    ngsDetailUrl: row.ngs_detail_url,
    rootsUrl: url,
    rootsPageId: pageId,
    rootsTitle: csvRecord?.title || null,
    rootsAccession: csvRecord?.accession || null,
    rootsCollectionOf: csvRecord?.collectionOf || null,
    rootsCollectionSource: csvRecord?.source || null,
    collectionVerdict: csvRecord?.collectionOf
      ? isNgsCollectionName(csvRecord.collectionOf)
        ? 'ngs'
        : 'not_ngs'
      : 'unknown',
  });
}

const extraEntries = [];
for (const url of extraUrls) {
  extraEntries.push({
    rootsUrl: normalizeUrl(url),
    rootsPageId: pageIdFromUrl(url),
    inSourceDb: sourceRows.some(
      (row) => normalizeUrl(row.roots_listing_url) === normalizeUrl(url)
    ),
  });
}

const fetchTargets = [
  ...(fetchMissing ? missingRows.map((row) => normalizeUrl(row.roots_listing_url)) : []),
  ...extraEntries.map((entry) => entry.rootsUrl),
].filter(Boolean);
const liveRecords = new Map();
let fetched = 0;
await runLimited([...new Set(fetchTargets)], fetchConcurrency, async (url) => {
  const record = await fetchRootsPageSummary(url);
  liveRecords.set(url, record);
  fetched += 1;
  if (fetched % 100 === 0 || fetched === fetchTargets.length) {
    process.stderr.write(`fetched roots collection ${fetched}/${fetchTargets.length}\n`);
  }
});

for (const entry of entries) {
  const liveRecord = liveRecords.get(entry.rootsUrl);
  if (!liveRecord?.collectionOf) continue;
  entry.rootsTitle = liveRecord.title || entry.rootsTitle;
  entry.rootsAccession = liveRecord.accession || entry.rootsAccession;
  entry.rootsCollectionOf = liveRecord.collectionOf;
  entry.rootsCollectionSource = liveRecord.source;
  entry.collectionVerdict = isNgsCollectionName(liveRecord.collectionOf)
    ? 'ngs'
    : 'not_ngs';
}

for (const entry of extraEntries) {
  const liveRecord = liveRecords.get(entry.rootsUrl);
  entry.rootsTitle = liveRecord?.title || null;
  entry.rootsAccession = liveRecord?.accession || null;
  entry.rootsCollectionOf = liveRecord?.collectionOf || null;
  entry.rootsCollectionSource = liveRecord?.source || null;
  entry.collectionVerdict = liveRecord?.collectionOf
    ? isNgsCollectionName(liveRecord.collectionOf)
      ? 'ngs'
      : 'not_ngs'
    : 'unknown';
  entry.fetchError = liveRecord?.fetchError || null;
}

const nonNgsEntries = entries.filter(
  (entry) => entry.collectionVerdict === 'not_ngs'
);
const unknownEntries = entries.filter(
  (entry) => entry.collectionVerdict === 'unknown'
);
const report = {
  auditedAt: new Date().toISOString(),
  sourceDbName,
  rootsCsvPath,
  rule: 'Only Roots pages whose Collection of field is National Gallery Singapore are trusted for NGS enrichment.',
  summary: {
    sourceRowsWithRootsUrl: sourceRows.length,
    csvMatched: entries.length - missingRows.length,
    csvMissing: missingRows.length,
    liveFetched: liveRecords.size,
    ngsRoots: entries.filter((entry) => entry.collectionVerdict === 'ngs')
      .length,
    nonNgsRoots: nonNgsEntries.length,
    unknownRoots: unknownEntries.length,
    extraUrls: extraEntries.length,
  },
  nonNgsRoots: nonNgsEntries,
  unknownRootsSample: unknownEntries.slice(0, 100),
  extraUrls: extraEntries,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (nonNgsEntries.length > 0) {
  process.exitCode = 1;
}
