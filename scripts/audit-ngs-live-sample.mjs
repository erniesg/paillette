#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
const sampleSize = Number(args.get('sample-size') || 500);
const seed = args.get('seed') || 'ngs-live-source-sample-v1';
const outPath = args.get('out') || '/tmp/paillette-ngs-live-sample-audit.json';
const fetchConcurrency = Math.max(
  1,
  Number(args.get('fetch-concurrency') || 8)
);
const fetchTimeoutMs = Math.max(
  1000,
  Number(args.get('fetch-timeout-ms') || 30_000)
);
const ngsCachePath =
  args.get('ngs-cache') || '/tmp/paillette-ngs-page-cache.json';
const rootsCachePath =
  args.get('roots-cache') || '/tmp/paillette-roots-page-cache.json';

const wranglerCandidates = [
  join(process.cwd(), 'apps/api/node_modules/.bin/wrangler'),
  join(process.cwd(), 'apps/web/node_modules/.bin/wrangler'),
  join(process.cwd(), 'node_modules/.bin/wrangler'),
  'wrangler',
];
const wrangler =
  wranglerCandidates.find((candidate) => existsSync(candidate)) || 'wrangler';

const readJsonFile = (path, fallback) => {
  if (!path || !existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};

const writeJsonFile = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const d1 = (database, sql) => {
  const output = execFileSync(
    wrangler,
    ['d1', 'execute', database, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
  );
  const payload = JSON.parse(output);
  if (!Array.isArray(payload) || !payload[0]?.success) {
    throw new Error(`D1 query failed: ${output.slice(0, 1000)}`);
  }
  return payload[0].results || [];
};

const parseJson = (value) => {
  if (!value || typeof value !== 'string') return value || null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const asRecord = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

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

const normalizeAccession = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeComparableText = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\d{4}[^)]*\)/g, ' ')
    .replace(/[\u2018\u2019\u201c\u201d"'`\[\]]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeLooseText = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
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

const exactEnough = (left, right) => {
  const normalizedLeft = normalizeLooseText(left);
  const normalizedRight = normalizeLooseText(right);
  return (
    !normalizedLeft ||
    !normalizedRight ||
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
};

const normalizeUrl = (value) =>
  String(value || '')
    .trim()
    .replace(/^http:\/\//i, 'https://')
    .replace(/\/+$/g, '');

const isNgsUrl = (value) => /nationalgallery\.sg/i.test(String(value || ''));
const isRootsUrl = (value) => /roots\.gov\.sg/i.test(String(value || ''));

const hashSortKey = (id) =>
  createHash('sha256').update(`${seed}:${id}`).digest('hex');

const htmlDecode = (value) =>
  String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    );

const htmlToTextLines = (html) =>
  htmlDecode(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const lineValueAfter = (lines, labels) => {
  const normalizedLabels = labels.map((label) =>
    normalizeLooseText(label).replace(/\.$/, '')
  );
  const index = lines.findIndex((line) => {
    const normalizedLine = normalizeLooseText(line).replace(/\.$/, '');
    return normalizedLabels.includes(normalizedLine);
  });
  return index >= 0 ? lines[index + 1] || null : null;
};

const extractJsonString = (html, key) => {
  const pattern = new RegExp(
    `"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
    'i'
  );
  const match = html.match(pattern);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return htmlDecode(match[1].replace(/\\"/g, '"'));
  }
};

const parseNgsPage = (url, html, status) => {
  const lines = htmlToTextLines(html);
  const titleFromHead =
    htmlDecode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])
      .replace(/\s*\|\s*National Gallery Singapore\s*$/i, '')
      .trim() || null;
  const title = lineValueAfter(lines, ['Title']) || titleFromHead;
  const accession = lineValueAfter(lines, ['Accession Number']);
  return {
    provider: 'ngs',
    url,
    status,
    ok: status >= 200 && status < 400 && title !== '404',
    error: title === '404' ? 'NGS page content is 404' : null,
    title,
    artist:
      lineValueAfter(lines, ['Artist Name(s)', 'Artist']) ||
      extractJsonString(html, 'artist'),
    accession,
    dateText:
      lineValueAfter(lines, ['Dating', 'Date']) ||
      extractJsonString(html, 'dateCreated'),
    medium:
      lineValueAfter(lines, ['Medium']) || extractJsonString(html, 'artMedium'),
    dimensions: lineValueAfter(lines, ['Dimensions (cm)', 'Dimensions']),
    creditLine: lineValueAfter(lines, ['Credit Line']),
    description: null,
  };
};

const parseRootsPage = (url, html, status) => {
  const lines = htmlToTextLines(html);
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
    provider: 'roots',
    url,
    status,
    ok: status >= 200 && status < 400,
    title: lineValueAfter(lines, ['Title']),
    artist: lineValueAfter(lines, ['Creator', 'Artist', 'Maker']),
    accession: lineValueAfter(lines, ['Accession No.', 'Accession No']),
    dateText: lineValueAfter(lines, ['Date/Period', 'Date', 'Dating']),
    medium: lineValueAfter(lines, ['Material', 'Medium']),
    dimensions: lineValueAfter(lines, ['Dimension', 'Dimensions']),
    creditLine: lineValueAfter(lines, ['Collection of']),
    description: descriptionLines.join(' ') || null,
  };
};

const fetchPage = async (url, parser) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 paillette-live-source-audit' },
    signal: AbortSignal.timeout(fetchTimeoutMs),
  });
  const html = await response.text();
  return parser(url, html, response.status);
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

const getNgsDescription = (ngs) =>
  firstText(
    ngs.objDescriptionClb,
    ngs.ocspWebText,
    ngs.description,
    ngs.caption,
    ngs.summary,
    ngs.labelText,
    ngs.label_text,
    ngs.text
  );

const getRootsDescription = (roots) =>
  firstText(
    roots.description,
    roots.caption,
    roots.summary,
    roots.synopsis,
    roots.content,
    roots.text
  );

const sourceScore = (row) =>
  Number(Boolean(row.ngs_detail_url)) * 100 +
  Number(Boolean(row.date_text)) * 10 +
  Number(Boolean(row.medium)) * 5 +
  Number(Boolean(row.dimensions)) * 3 +
  Number(Boolean(row.credit_line)) * 2 +
  Number(Boolean(row.roots_listing_url));

const trustedDescriptionSource = (value) =>
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
  ].includes(
    String(value || '')
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .trim()
  );

const accessionsMatch = (left, right) => {
  const normalizedLeft = normalizeAccession(left);
  const normalizedRight = normalizeAccession(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      (normalizedLeft === normalizedRight ||
        normalizedRight.endsWith(`-${normalizedLeft}`))
  );
};

const pageOk = (page) => Boolean(page?.ok || page?.accession);

const sourceRows = [];
for (let offset = 0; ; offset += 500) {
  const page = d1(
    sourceDbName,
    `SELECT id, accession_no, title, artist, date_text, medium, dimensions, credit_line, rights, description, metadata_sources, raw_ngs, raw_roots, ngs_detail_url, roots_listing_url FROM artworks ORDER BY rowid LIMIT 500 OFFSET ${offset}`
  );
  sourceRows.push(...page);
  if (page.length < 500) break;
}

const appRows = [];
for (let offset = 0; ; offset += 500) {
  const page = d1(
    appDbName,
    `SELECT id, title, artist, date_text, medium, classification, description, credit_line, rights, accession_number, source_url, field_sources, custom_metadata, source_institution FROM artworks WHERE deleted_at IS NULL AND source_institution LIKE '%National Gallery%' ORDER BY rowid LIMIT 500 OFFSET ${offset}`
  );
  appRows.push(...page);
  if (page.length < 500) break;
}

const sourceByAccession = new Map();
const sourceRootsUrlByAccession = new Map();
for (const row of sourceRows) {
  const accession = normalizeAccession(row.accession_no || row.id);
  if (!accession) continue;
  if (row.roots_listing_url) {
    sourceRootsUrlByAccession.set(accession, row.roots_listing_url);
  }
  const current = sourceByAccession.get(accession);
  if (!current || sourceScore(row) > sourceScore(current)) {
    sourceByAccession.set(accession, row);
  }
}

const getFieldSources = (row) => asRecord(parseJson(row.field_sources));
const getMetadata = (row) => asRecord(parseJson(row.custom_metadata));

const byHash = (rows) =>
  [...rows].sort((left, right) =>
    hashSortKey(left.accession_number || left.id).localeCompare(
      hashSortKey(right.accession_number || right.id)
    )
  );

const selected = new Map();
const addRows = (rows, count) => {
  for (const row of byHash(rows)) {
    if (selected.size >= sampleSize || count <= 0) break;
    if (selected.has(row.id)) continue;
    selected.set(row.id, row);
    count -= 1;
  }
};

const rootsDescriptionRows = appRows.filter(
  (row) => getFieldSources(row).description === 'roots'
);
const ngsDescriptionRows = appRows.filter(
  (row) => getFieldSources(row).description === 'ngs'
);
const rootsLinkedRows = appRows.filter((row) => {
  const meta = getMetadata(row);
  const source = sourceByAccession.get(
    normalizeAccession(row.accession_number)
  );
  return Boolean(meta.roots_listing_url || source?.roots_listing_url);
});

addRows(rootsDescriptionRows, Math.min(150, sampleSize - selected.size));
addRows(ngsDescriptionRows, Math.min(150, sampleSize - selected.size));
addRows(
  rootsLinkedRows.filter((row) => !selected.has(row.id)),
  Math.min(100, sampleSize - selected.size)
);
addRows(appRows, sampleSize - selected.size);

const sampleRows = Array.from(selected.values());
const ngsCache = new Map(Object.entries(readJsonFile(ngsCachePath, {})));
const rootsCache = new Map(Object.entries(readJsonFile(rootsCachePath, {})));
const pagePromises = new Map();

const getCachedPage = (cache, path, url, parser) => {
  const key = normalizeUrl(url);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  if (!pagePromises.has(key)) {
    pagePromises.set(
      key,
      fetchPage(key, parser)
        .then((page) => {
          cache.set(key, page);
          return page;
        })
        .catch((error) => {
          const page = {
            url: key,
            status: null,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
          cache.set(key, page);
          return page;
        })
        .finally(() => {
          pagePromises.delete(key);
          writeJsonFile(path, Object.fromEntries(cache));
        })
    );
  }
  return pagePromises.get(key);
};

const sampleWithSources = sampleRows.map((row) => {
  const meta = getMetadata(row);
  const source = sourceByAccession.get(
    normalizeAccession(row.accession_number)
  );
  const ngsUrl = normalizeUrl(
    firstText(
      isNgsUrl(row.source_url) ? row.source_url : null,
      meta.ngs_detail_url,
      meta.ngsDetailUrl,
      source?.ngs_detail_url
    )
  );
  const rootsUrl = normalizeUrl(
    firstText(
      meta.roots_listing_url,
      meta.rootsListingUrl,
      source?.roots_listing_url,
      sourceRootsUrlByAccession.get(normalizeAccession(row.accession_number))
    )
  );
  return { row, source, ngsUrl, rootsUrl };
});

await runLimited(sampleWithSources, fetchConcurrency, async (entry, index) => {
  const fetches = [];
  if (entry.ngsUrl) {
    fetches.push(
      Promise.resolve(
        getCachedPage(ngsCache, ngsCachePath, entry.ngsUrl, parseNgsPage)
      ).then((page) => {
        entry.ngsPage = page;
      })
    );
  }
  if (entry.rootsUrl) {
    fetches.push(
      Promise.resolve(
        getCachedPage(
          rootsCache,
          rootsCachePath,
          entry.rootsUrl,
          parseRootsPage
        )
      ).then((page) => {
        entry.rootsPage = page;
      })
    );
  }
  await Promise.all(fetches);
  if ((index + 1) % 50 === 0 || index + 1 === sampleWithSources.length) {
    process.stderr.write(`visited sample sources ${index + 1}/${sampleSize}\n`);
  }
});

writeJsonFile(ngsCachePath, Object.fromEntries(ngsCache));
writeJsonFile(rootsCachePath, Object.fromEntries(rootsCache));

const issues = [];
const addIssue = (entry, code, severity, details = {}) => {
  issues.push({
    id: entry.row.id,
    accession_number: entry.row.accession_number,
    title: entry.row.title,
    code,
    severity,
    ngs_url: entry.ngsUrl || null,
    roots_url: entry.rootsUrl || null,
    ...details,
  });
};

const checks = [];
const addCheck = (entry, values) => {
  checks.push({
    id: entry.row.id,
    accession_number: entry.row.accession_number,
    title: entry.row.title,
    ...values,
  });
};

for (const entry of sampleWithSources) {
  const row = entry.row;
  const source = entry.source;
  const fieldSources = getFieldSources(row);
  const meta = getMetadata(row);
  const rawNgs = asRecord(parseJson(source?.raw_ngs));
  const rawRoots = asRecord(parseJson(source?.raw_roots));
  const accession = normalizeAccession(row.accession_number || row.id);

  if (!source) {
    addIssue(entry, 'missing_source_row_for_accession', 'error');
    continue;
  }

  if (!entry.ngsUrl && !entry.rootsUrl) {
    addIssue(entry, 'missing_live_source_url', 'error');
  }

  if (entry.ngsUrl) {
    if (!pageOk(entry.ngsPage)) {
      addIssue(entry, 'ngs_url_fetch_failed', 'error', {
        status: entry.ngsPage?.status ?? null,
        error: entry.ngsPage?.error ?? null,
      });
    } else {
      if (
        entry.ngsPage.accession &&
        !accessionsMatch(row.accession_number, entry.ngsPage.accession)
      ) {
        addIssue(entry, 'ngs_live_accession_mismatch', 'error', {
          expected: row.accession_number,
          actual: entry.ngsPage.accession,
        });
      }
      if (
        entry.ngsPage.title &&
        row.title &&
        !comparableTextMatches(entry.ngsPage.title, row.title)
      ) {
        addIssue(entry, 'ngs_live_title_mismatch', 'error', {
          expected: entry.ngsPage.title,
          actual: row.title,
        });
      }
      if (
        entry.ngsPage.artist &&
        row.artist &&
        !comparableTextMatches(entry.ngsPage.artist, row.artist)
      ) {
        addIssue(entry, 'ngs_live_artist_mismatch', 'error', {
          expected: entry.ngsPage.artist,
          actual: row.artist,
        });
      }
    }
  }

  if (entry.rootsUrl) {
    if (!pageOk(entry.rootsPage)) {
      addIssue(entry, 'roots_url_fetch_failed', 'error', {
        status: entry.rootsPage?.status ?? null,
        error: entry.rootsPage?.error ?? null,
      });
    } else if (
      entry.rootsPage.accession &&
      !accessionsMatch(row.accession_number, entry.rootsPage.accession)
    ) {
      addIssue(entry, 'roots_live_accession_mismatch', 'error', {
        expected: row.accession_number,
        actual: entry.rootsPage.accession,
      });
    } else if (!entry.rootsPage.accession) {
      addIssue(entry, 'roots_live_accession_missing', 'error');
    } else if (
      entry.rootsPage.title &&
      row.title &&
      entry.rootsPage.artist &&
      row.artist &&
      !comparableTextMatches(entry.rootsPage.title, row.title) &&
      !comparableTextMatches(entry.rootsPage.artist, row.artist)
    ) {
      addIssue(entry, 'roots_live_metadata_conflict', 'error', {
        rootsTitle: entry.rootsPage.title,
        appTitle: row.title,
        rootsArtist: entry.rootsPage.artist,
        appArtist: row.artist,
      });
    }
  }

  const sourceExpected = {
    title: source.title,
    artist: source.artist,
    date_text: source.date_text,
    medium: source.medium,
    credit_line: source.credit_line,
    rights: source.rights,
    dimensions_text: source.dimensions,
  };
  const appActual = {
    title: row.title,
    artist: row.artist,
    date_text: row.date_text,
    medium: row.medium,
    credit_line: row.credit_line,
    rights: row.rights,
    dimensions_text: meta.dimensions_text,
  };
  for (const [field, expected] of Object.entries(sourceExpected)) {
    const actual = appActual[field];
    if ((expected || actual) && !exactEnough(expected, actual)) {
      addIssue(entry, `metadata_mismatch_${field}`, 'error', {
        expected,
        actual,
        fieldSource: fieldSources[field] || null,
      });
    }
  }

  const sourceNgsDescription = getNgsDescription(rawNgs);
  const sourceRootsDescription =
    getRootsDescription(rawRoots) || entry.rootsPage?.description || null;
  const descriptionSource = String(fieldSources.description || '')
    .toLowerCase()
    .trim();
  let expectedDescription = null;
  if (descriptionSource === 'ngs') expectedDescription = sourceNgsDescription;
  if (descriptionSource === 'roots')
    expectedDescription = sourceRootsDescription;

  if (row.description && !trustedDescriptionSource(descriptionSource)) {
    addIssue(entry, 'untrusted_public_description_source', 'error', {
      descriptionSource: fieldSources.description || null,
    });
  }

  if (row.description && expectedDescription) {
    if (!comparableTextMatches(row.description, expectedDescription)) {
      addIssue(entry, 'description_mismatch_declared_source', 'error', {
        descriptionSource,
        expectedPrefix: expectedDescription.slice(0, 220),
        actualPrefix: row.description.slice(0, 220),
      });
    }
  } else if (row.description && descriptionSource) {
    addIssue(entry, 'description_source_text_missing', 'error', {
      descriptionSource,
      actualPrefix: row.description.slice(0, 220),
    });
  }

  if (!row.description && sourceNgsDescription) {
    addIssue(entry, 'missing_ngs_catalogue_text', 'error', {
      expectedPrefix: sourceNgsDescription.slice(0, 220),
    });
  }

  if (!row.description && !sourceNgsDescription && sourceRootsDescription) {
    addIssue(entry, 'missing_roots_catalogue_text_candidate', 'warning', {
      expectedPrefix: sourceRootsDescription.slice(0, 220),
    });
  }

  addCheck(entry, {
    sample_bucket:
      descriptionSource === 'roots'
        ? 'roots_description'
        : descriptionSource === 'ngs'
          ? 'ngs_description'
          : entry.rootsUrl
            ? 'roots_linked'
            : 'metadata_only',
    ngs_url: entry.ngsUrl || null,
    roots_url: entry.rootsUrl || null,
    ngs_url_ok: pageOk(entry.ngsPage) || null,
    roots_url_ok: pageOk(entry.rootsPage) || null,
    description_source: descriptionSource || null,
    app_has_description: Boolean(row.description),
    source_has_ngs_description: Boolean(sourceNgsDescription),
    source_has_roots_description: Boolean(sourceRootsDescription),
  });
}

const summary = issues.reduce(
  (acc, issue) => {
    acc.total += 1;
    acc.bySeverity[issue.severity] = (acc.bySeverity[issue.severity] || 0) + 1;
    acc.byCode[issue.code] = (acc.byCode[issue.code] || 0) + 1;
    return acc;
  },
  {
    sampleSize: sampleWithSources.length,
    appRows: appRows.length,
    sourceRows: sourceRows.length,
    total: 0,
    bySeverity: {},
    byCode: {},
  }
);

summary.sampleBuckets = checks.reduce((acc, check) => {
  acc[check.sample_bucket] = (acc[check.sample_bucket] || 0) + 1;
  return acc;
}, {});
summary.liveUrls = checks.reduce(
  (acc, check) => {
    if (check.ngs_url) acc.ngs += 1;
    if (check.ngs_url_ok) acc.ngs_ok += 1;
    if (check.roots_url) acc.roots += 1;
    if (check.roots_url_ok) acc.roots_ok += 1;
    return acc;
  },
  { ngs: 0, ngs_ok: 0, roots: 0, roots_ok: 0 }
);
summary.catalogueText = checks.reduce(
  (acc, check) => {
    if (check.app_has_description) acc.app_description += 1;
    if (check.source_has_ngs_description) acc.ngs_source_description += 1;
    if (check.source_has_roots_description) acc.roots_source_description += 1;
    return acc;
  },
  { app_description: 0, ngs_source_description: 0, roots_source_description: 0 }
);

const report = {
  audited_at: new Date().toISOString(),
  seed,
  source_database: sourceDbName,
  app_database: appDbName,
  fetch: {
    concurrency: fetchConcurrency,
    timeout_ms: fetchTimeoutMs,
    ngs_cache_path: ngsCachePath,
    roots_cache_path: rootsCachePath,
  },
  summary,
  checks,
  issues,
};

writeJsonFile(outPath, report);
console.log(JSON.stringify(summary, null, 2));

if ((summary.bySeverity.error || 0) > 0) {
  process.exitCode = 1;
}
