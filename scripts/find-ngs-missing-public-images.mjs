#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
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

const options = {
  database: args.get('database') || 'paillette-db-stg',
  orgId: args.get('org-id') || DEFAULT_NGS_ORG_ID,
  outDir: resolve(args.get('out-dir') || 'tmp/ngs-missing-images'),
  limit: Number(args.get('limit') || '0'),
  concurrency: Number(args.get('concurrency') || '12'),
  validate: flags.has('validate'),
  prod: flags.has('prod'),
};

if (flags.has('help')) {
  printHelp();
  process.exit(0);
}

if (options.prod && !args.has('database')) {
  options.database = 'paillette-db';
}

mkdirSync(options.outDir, { recursive: true });

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
          renditionWeb1280: await validateImageUrl(row.renditionWeb1280),
          directImage: await validateImageUrl(row.ngsImageUrl),
        },
      };
    })
  : rowsWithCandidates;

const prefix = options.prod ? 'prod' : options.database.replace(/[^a-z0-9]+/gi, '-');
const jsonPath = resolve(options.outDir, `${prefix}-missing-display-images.json`);
const jsonlPath = resolve(options.outDir, `${prefix}-missing-display-images.jsonl`);
const csvPath = resolve(options.outDir, `${prefix}-missing-display-images.csv`);
const summaryPath = resolve(options.outDir, `${prefix}-missing-display-images.summary.json`);

writeFileSync(jsonPath, `${JSON.stringify(validatedRows, null, 2)}\n`);
writeFileSync(
  jsonlPath,
  `${validatedRows.map((row) => JSON.stringify(row)).join('\n')}\n`
);
writeFileSync(csvPath, toCsv(validatedRows));

const summary = summarize(validatedRows);
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      count: validatedRows.length,
      summary,
      outputs: { jsonPath, jsonlPath, csvPath, summaryPath },
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
  for (const row of rows) {
    const accessLevel = row.accessLevel || '(blank)';
    byAccessLevel[accessLevel] = (byAccessLevel[accessLevel] || 0) + 1;
    if (row.validation) {
      const key = row.validation.renditionWeb1280.ok
        ? 'rendition_web_1280_ok'
        : `rendition_web_1280_failed_${row.validation.renditionWeb1280.status || 'error'}`;
      byValidation[key] = (byValidation[key] || 0) + 1;
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    database: options.database,
    orgId: options.orgId,
    total: rows.length,
    byAccessLevel,
    byValidation,
  };
}

function toCamelRow(row) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    dateText: row.date_text,
    medium: row.medium,
    accessLevel: row.access_level,
    ngsPageUrl: row.ngs_page_url,
    ngsImageUrl: row.ngs_image_url,
  };
}

function sqlString(value) {
  return String(value).replaceAll("'", "''");
}

function csvCell(value) {
  return JSON.stringify(value ?? '');
}

function toCsv(rows) {
  const keys = [
    'id',
    'title',
    'artist',
    'dateText',
    'medium',
    'accessLevel',
    'ngsPageUrl',
    'ngsImageUrl',
    'renditionWeb1280',
    'renditionZoom2048',
    'renditionThumb319',
    'renditionWeb1280Ok',
    'directImageOk',
  ];
  const body = rows.map((row) =>
    keys
      .map((key) => {
        if (key === 'renditionWeb1280Ok') {
          return csvCell(row.validation?.renditionWeb1280?.ok);
        }
        if (key === 'directImageOk') {
          return csvCell(row.validation?.directImage?.ok);
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
  node scripts/find-ngs-missing-public-images.mjs [--validate]

Options:
  --database <name>    D1 database name. Default: paillette-db-stg
  --prod               Shortcut for --database paillette-db
  --org-id <uuid>      Org id. Default: NGS public org
  --out-dir <path>     Output directory. Default: tmp/ngs-missing-images
  --limit <n>          Limit rows for testing
  --concurrency <n>    URL validation concurrency. Default: 12
  --validate           HEAD/range-check derived NGS rendition URLs
`);
}
