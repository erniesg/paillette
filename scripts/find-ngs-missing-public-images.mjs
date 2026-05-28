#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_NGS_ORG_ID = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';

const args = new Map();
const flags = new Set();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) {
    flags.add(key);
  } else {
    args.set(key, next);
    index += 1;
  }
}

const outDir = resolve(args.get('out-dir') || 'tmp/ngs-missing-images');

const options = {
  database: args.get('database') || 'paillette-db-stg',
  orgId: args.get('org-id') || DEFAULT_NGS_ORG_ID,
  outDir,
  downloadDir: resolve(args.get('download-dir') || `${outDir}/images`),
  limit: Number(args.get('limit') || '0'),
  concurrency: Number(args.get('concurrency') || '12'),
  validate: flags.has('validate'),
  download: flags.has('download'),
  overwrite: flags.has('overwrite'),
  downloadDirectFallback: flags.has('download-direct-fallback'),
  prod: flags.has('prod'),
};

if (options.download) {
  options.validate = true;
}

if (flags.has('help')) {
  printHelp();
  process.exit(0);
}

if (options.prod && !args.has('database')) {
  options.database = 'paillette-db';
}

mkdirSync(options.outDir, { recursive: true });
if (options.download) {
  mkdirSync(options.downloadDir, { recursive: true });
}

const rows = loadMissingRows();
const rowsWithCandidates = rows.map(addCandidateUrls);
const validatedRows = options.validate
  ? await mapLimit(rowsWithCandidates, options.concurrency, async (row, index) => {
      if ((index + 1) % 50 === 0) {
        console.error(`validated ${index + 1}/${rowsWithCandidates.length}`);
      }
      return {
        ...row,
        validation: {
          renditionZoom2048: await validateImageUrl(row.renditionZoom2048),
          renditionWeb1280: await validateImageUrl(row.renditionWeb1280),
          renditionThumb319: await validateImageUrl(row.renditionThumb319),
          directImage: await validateImageUrl(row.ngsImageUrl),
        },
      };
    })
  : rowsWithCandidates;
const processedRows = options.download
  ? await mapLimit(validatedRows, options.concurrency, async (row, index) => {
      if ((index + 1) % 50 === 0) {
        console.error(`downloaded ${index + 1}/${validatedRows.length}`);
      }
      return downloadBestImage(row);
    })
  : validatedRows;

const prefix = options.prod ? 'prod' : options.database.replace(/[^a-z0-9]+/gi, '-');
const jsonPath = resolve(options.outDir, `${prefix}-missing-display-images.json`);
const jsonlPath = resolve(options.outDir, `${prefix}-missing-display-images.jsonl`);
const csvPath = resolve(options.outDir, `${prefix}-missing-display-images.csv`);
const summaryPath = resolve(options.outDir, `${prefix}-missing-display-images.summary.json`);

writeFileSync(jsonPath, `${JSON.stringify(processedRows, null, 2)}\n`);
writeFileSync(
  jsonlPath,
  `${processedRows.map((row) => JSON.stringify(row)).join('\n')}\n`
);
writeFileSync(csvPath, toCsv(processedRows));

const summary = summarize(processedRows);
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      count: processedRows.length,
      summary,
      outputs: {
        jsonPath,
        jsonlPath,
        csvPath,
        summaryPath,
        ...(options.download ? { downloadDir: options.downloadDir } : {}),
      },
    },
    null,
    2
  )
);
process.exit(0);

function loadMissingRows() {
  const limitSql = options.limit > 0 ? ` LIMIT ${options.limit}` : '';
  const sql = `
    SELECT
      id,
      title,
      artist,
      date_text,
      medium,
      dominant_colors,
      color_palette,
      json_extract(custom_metadata, '$.colour_palette') AS custom_colour_palette,
      json_extract(custom_metadata, '$.source_records.ngs.ocspArtworkAccessLevel') AS access_level,
      source_url AS ngs_page_url,
      json_extract(custom_metadata, '$.ngs_image_url') AS ngs_image_url
    FROM artworks
    WHERE org_id = '${sqlString(options.orgId)}'
      AND deleted_at IS NULL
      AND (image_url IS NULL OR trim(image_url) = '')
      AND json_extract(custom_metadata, '$.ngs_image_url') IS NOT NULL
      AND trim(json_extract(custom_metadata, '$.ngs_image_url')) <> ''
    ORDER BY access_level DESC, id
    ${limitSql}
  `;

  const output = execFileSync(
    'pnpm',
    [
      '--dir',
      'apps/api',
      'exec',
      'wrangler',
      'd1',
      'execute',
      options.database,
      '--remote',
      '--json',
      '--command',
      sql,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );

  const payload = JSON.parse(output);
  return payload?.[0]?.results?.map(toCamelRow) || [];
}

function addCandidateUrls(row) {
  const base = row.ngsImageUrl;
  return {
    ...row,
    renditionWeb1280: `${base}/_jcr_content/renditions/cq5dam.web.1280.1280.jpeg`,
    renditionZoom2048: `${base}/_jcr_content/renditions/cq5dam.zoom.2048.2048.jpeg`,
    renditionThumb319: `${base}/_jcr_content/renditions/cq5dam.thumbnail.319.319.png`,
  };
}

async function validateImageUrl(url) {
  try {
    let response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (
      !response.ok ||
      !String(response.headers.get('content-type') || '').startsWith('image/')
    ) {
      response = await fetch(url, {
        headers: { range: 'bytes=0-255' },
        redirect: 'follow',
      });
      await response.arrayBuffer();
    }

    return {
      ok:
        response.ok &&
        String(response.headers.get('content-type') || '').startsWith('image/'),
      status: response.status,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
      finalUrl: response.url,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function downloadBestImage(row) {
  const candidate = selectDownloadCandidate(row);
  if (!candidate) {
    return {
      ...row,
      download: {
        ok: false,
        reason: 'no_valid_candidate',
      },
    };
  }

  const extension = extensionForImage(candidate.validation.contentType, candidate.url);
  const path = resolve(
    options.downloadDir,
    `${safeFilename(row.id)}-${candidate.name}${extension}`
  );

  if (!options.overwrite && existsSync(path)) {
    return {
      ...row,
      download: {
        ok: true,
        skipped: true,
        reason: 'exists',
        rendition: candidate.name,
        url: candidate.url,
        path,
        contentType: candidate.validation.contentType || null,
        contentLength: candidate.validation.contentLength || null,
      },
    };
  }

  try {
    const response = await fetch(candidate.url, { redirect: 'follow' });
    const contentType = response.headers.get('content-type');
    if (!response.ok || !String(contentType || '').startsWith('image/')) {
      return {
        ...row,
        download: {
          ok: false,
          rendition: candidate.name,
          url: candidate.url,
          status: response.status,
          contentType,
          reason: 'download_failed',
        },
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(path, buffer);

    return {
      ...row,
      download: {
        ok: true,
        rendition: candidate.name,
        url: candidate.url,
        path,
        contentType,
        bytes: buffer.byteLength,
      },
    };
  } catch (error) {
    return {
      ...row,
      download: {
        ok: false,
        rendition: candidate.name,
        url: candidate.url,
        reason: 'download_error',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function selectDownloadCandidate(row) {
  const candidates = [
    ['renditionZoom2048', 'zoom2048', row.renditionZoom2048],
    ['renditionWeb1280', 'web1280', row.renditionWeb1280],
    ...(options.downloadDirectFallback
      ? [['directImage', 'direct', row.ngsImageUrl]]
      : []),
    ['renditionThumb319', 'thumb319', row.renditionThumb319],
  ];

  for (const [validationKey, name, url] of candidates) {
    const validation = row.validation?.[validationKey];
    if (validation?.ok) {
      return { validationKey, name, url, validation };
    }
  }

  return null;
}

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await fn(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  );
  return output;
}

function summarize(rows) {
  const byAccessLevel = {};
  const byValidation = {};
  const byDownload = {};
  const byDownloadRendition = {};
  let withAnyPalette = 0;
  let withNonEmptyPalette = 0;
  for (const row of rows) {
    const accessLevel = row.accessLevel || '(blank)';
    byAccessLevel[accessLevel] = (byAccessLevel[accessLevel] || 0) + 1;
    if (hasAnyPalette(row)) withAnyPalette += 1;
    if (hasNonEmptyPalette(row)) withNonEmptyPalette += 1;
    if (row.validation) {
      for (const [name, validation] of Object.entries(row.validation)) {
        const key = validation.ok
          ? `${name}_ok`
          : `${name}_failed_${validation.status || 'error'}`;
        byValidation[key] = (byValidation[key] || 0) + 1;
      }
    }
    if (row.download) {
      const key = row.download.ok
        ? row.download.skipped
          ? 'skipped_existing'
          : 'downloaded'
        : row.download.reason || 'failed';
      byDownload[key] = (byDownload[key] || 0) + 1;
      if (row.download.rendition) {
        byDownloadRendition[row.download.rendition] =
          (byDownloadRendition[row.download.rendition] || 0) + 1;
      }
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    database: options.database,
    orgId: options.orgId,
    total: rows.length,
    withAnyPalette,
    withNonEmptyPalette,
    byAccessLevel,
    byValidation,
    byDownload,
    byDownloadRendition,
  };
}

function toCamelRow(row) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    dateText: row.date_text,
    medium: row.medium,
    dominantColors: row.dominant_colors,
    colorPalette: row.color_palette,
    customColourPalette: row.custom_colour_palette,
    accessLevel: row.access_level,
    ngsPageUrl: row.ngs_page_url,
    ngsImageUrl: row.ngs_image_url,
  };
}

function hasAnyPalette(row) {
  return Boolean(row.dominantColors || row.colorPalette || row.customColourPalette);
}

function hasNonEmptyPalette(row) {
  return [row.dominantColors, row.colorPalette, row.customColourPalette].some(
    hasNonEmptyJsonValue
  );
}

function hasNonEmptyJsonValue(value) {
  if (value === null || value === undefined) return false;
  const text = typeof value === 'string' ? value.trim() : value;
  if (text === '' || text === '[]' || text === '{}') return false;

  try {
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (parsed && typeof parsed === 'object') {
      return Object.keys(parsed).length > 0;
    }
    return Boolean(parsed);
  } catch {
    return true;
  }
}

function sqlString(value) {
  return String(value).replaceAll("'", "''");
}

function csvCell(value) {
  return JSON.stringify(value ?? '');
}

function safeFilename(value) {
  return String(value)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function extensionForImage(contentType, url) {
  const normalizedType = String(contentType || '').toLowerCase();
  if (normalizedType.includes('jpeg') || normalizedType.includes('jpg')) {
    return '.jpg';
  }
  if (normalizedType.includes('png')) return '.png';
  if (normalizedType.includes('webp')) return '.webp';

  try {
    const path = new URL(url).pathname;
    const match = path.match(/\.(jpe?g|png|webp|gif|tiff?|bmp)$/i);
    if (match) return `.${match[1].toLowerCase().replace('jpeg', 'jpg')}`;
  } catch {
    // Fall through to a safe default.
  }

  return '.img';
}

function toCsv(rows) {
  const keys = [
    'id',
    'title',
    'artist',
    'dateText',
    'medium',
    'hasAnyPalette',
    'hasNonEmptyPalette',
    'accessLevel',
    'ngsPageUrl',
    'ngsImageUrl',
    'renditionWeb1280',
    'renditionZoom2048',
    'renditionThumb319',
    'renditionZoom2048Ok',
    'renditionWeb1280Ok',
    'renditionThumb319Ok',
    'directImageOk',
    'downloadOk',
    'downloadRendition',
    'downloadUrl',
    'downloadPath',
    'downloadBytes',
  ];
  const body = rows.map((row) =>
    keys
      .map((key) => {
        if (key === 'hasAnyPalette') {
          return csvCell(hasAnyPalette(row));
        }
        if (key === 'hasNonEmptyPalette') {
          return csvCell(hasNonEmptyPalette(row));
        }
        if (key === 'renditionZoom2048Ok') {
          return csvCell(row.validation?.renditionZoom2048?.ok);
        }
        if (key === 'renditionWeb1280Ok') {
          return csvCell(row.validation?.renditionWeb1280?.ok);
        }
        if (key === 'renditionThumb319Ok') {
          return csvCell(row.validation?.renditionThumb319?.ok);
        }
        if (key === 'directImageOk') {
          return csvCell(row.validation?.directImage?.ok);
        }
        if (key === 'downloadOk') {
          return csvCell(row.download?.ok);
        }
        if (key === 'downloadRendition') {
          return csvCell(row.download?.rendition);
        }
        if (key === 'downloadUrl') {
          return csvCell(row.download?.url);
        }
        if (key === 'downloadPath') {
          return csvCell(row.download?.path);
        }
        if (key === 'downloadBytes') {
          return csvCell(row.download?.bytes);
        }
        return csvCell(row[key]);
      })
      .join(',')
  );
  return `${keys.join(',')}\n${body.join('\n')}\n`;
}

function printHelp() {
  console.log(`Find NGS artworks that have public NGS image URLs but no app image_url.

Usage:
  node scripts/find-ngs-missing-public-images.mjs [--validate] [--download]

Options:
  --database <name>    D1 database name. Default: paillette-db-stg
  --prod               Shortcut for --database paillette-db
  --org-id <uuid>      Org id. Default: NGS public org
  --out-dir <path>     Output directory. Default: tmp/ngs-missing-images
  --limit <n>          Limit rows for testing
  --concurrency <n>    URL validation concurrency. Default: 12
  --validate           HEAD/range-check derived NGS rendition URLs
  --download           Download the best live rendition for each row
  --download-dir <dir> Directory for downloaded images. Default: <out-dir>/images
  --overwrite          Re-download files that already exist
  --download-direct-fallback
                      Allow original DAM files as fallback downloads when renditions fail
`);
}
