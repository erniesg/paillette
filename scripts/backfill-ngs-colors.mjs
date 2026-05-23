#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const colorRequire = createRequire(
  new URL('../packages/color-extraction/package.json', import.meta.url)
);
const imageRequire = createRequire(
  new URL('../packages/image-processing/package.json', import.meta.url)
);
const vibrantModule = await import(colorRequire.resolve('node-vibrant/node'));
const sharpModule = await import(imageRequire.resolve('sharp'));
const Vibrant = vibrantModule.Vibrant || vibrantModule.default?.Vibrant;
const sharp = sharpModule.default || sharpModule;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

if (!Vibrant) {
  throw new Error('Could not load node-vibrant/node');
}

if (!sharp) {
  throw new Error('Could not load sharp');
}

const DEFAULT_ORG_ID = '00000000-0000-4000-8000-000000000101';

const args = new Map();
const flags = new Set();
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--') && arg.includes('=')) {
    const [key, ...value] = arg.slice(2).split('=');
    args.set(key, value.join('='));
  } else if (arg.startsWith('--')) {
    flags.add(arg.slice(2));
  }
}

const options = {
  orgId: args.get('org') || DEFAULT_ORG_ID,
  database: args.get('database') || 'paillette-db-stg',
  env: args.get('env') || 'staging',
  limit: toInt(args.get('limit'), Infinity),
  batchSize: toInt(args.get('batch-size'), 50),
  writeSize: toInt(args.get('write-size'), 25),
  concurrency: toInt(args.get('concurrency'), 4),
  count: toInt(args.get('count'), 5),
  quality: toInt(args.get('quality'), 1),
  resize: toInt(args.get('resize'), 320),
  imageSource: args.get('image-source') || 'thumb',
  startAfter: args.get('start-after') || '',
  apply: flags.has('apply'),
  force: flags.has('force'),
};

if (flags.has('help')) {
  printHelp();
  process.exit(0);
}

if (!Number.isFinite(options.limit) && !options.apply) {
  console.error('Refusing an unlimited dry run. Pass --limit=N or --apply.');
  process.exit(1);
}

let scanned = 0;
let extracted = 0;
let failed = 0;
let written = 0;
let lastId = options.startAfter;

console.log(
  [
    `Backfilling NGS colours for org ${options.orgId}`,
    `database=${options.database}`,
    `env=${options.env}`,
    `limit=${Number.isFinite(options.limit) ? options.limit : 'all'}`,
    `concurrency=${options.concurrency}`,
    `imageSource=${options.imageSource}`,
    `resize=${options.resize}`,
    options.apply ? 'apply=true' : 'dry-run=true',
  ].join(' ')
);

while (scanned < options.limit) {
  const remaining = options.limit - scanned;
  const rows = fetchRows(Math.min(options.batchSize, remaining));
  if (!rows.length) break;

  scanned += rows.length;
  lastId = rows[rows.length - 1].id;

  const results = await mapLimit(rows, options.concurrency, async (row) => {
    try {
      const palette = await extractPalette(row.image_url);
      extracted += 1;
      return { row, palette, extractedAt: new Date().toISOString() };
    } catch (error) {
      failed += 1;
      console.warn(
        `Failed ${row.id} ${row.title || ''}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  });

  const successful = results.filter(Boolean);
  if (successful.length && options.apply) {
    for (let index = 0; index < successful.length; index += options.writeSize) {
      const chunk = successful.slice(index, index + options.writeSize);
      writeRows(chunk);
      written += chunk.length;
    }
  }

  const sample = successful[0];
  if (sample) {
    console.log(
      `Processed ${scanned}; extracted=${extracted}; written=${written}; failed=${failed}; last=${lastId}; sample ${sample.row.id} ${sample.palette
        .map((item) => item.color)
        .join(' ')}`
    );
  } else {
    console.log(
      `Processed ${scanned}; extracted=${extracted}; written=${written}; failed=${failed}; last=${lastId}`
    );
  }
}

console.log(
  `Done. scanned=${scanned} extracted=${extracted} written=${written} failed=${failed} last=${lastId}`
);

function fetchRows(limit) {
  const missingClause = options.force
    ? ''
    : "AND (dominant_colors IS NULL OR trim(dominant_colors) = '')";
  const imageExpression =
    options.imageSource === 'original'
      ? 'image_url'
      : 'COALESCE(thumbnail_url, image_url_processed, image_url)';
  const sql = `
    SELECT id, title, ${imageExpression} AS image_url
    FROM artworks
    WHERE org_id = ${sqlString(options.orgId)}
      AND deleted_at IS NULL
      AND image_url IS NOT NULL
      AND trim(image_url) <> ''
      ${missingClause}
      AND id > ${sqlString(lastId)}
    ORDER BY id
    LIMIT ${Math.max(1, Math.floor(limit))}
  `;

  return d1Command(sql)[0]?.results || [];
}

function writeRows(items) {
  const statements = items.map(({ row, palette, extractedAt }) => {
    const json = JSON.stringify(palette);
    return `
      UPDATE artworks
      SET
        dominant_colors = ${sqlString(json)},
        color_palette = ${sqlString(json)},
        color_extracted_at = ${sqlString(extractedAt)},
        color_extraction_version = 'v1',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${sqlString(row.id)}
        AND org_id = ${sqlString(options.orgId)}
        AND deleted_at IS NULL;
    `;
  });

  d1File(statements.join('\n'));
}

async function extractPalette(imageUrl) {
  const imageBuffer = await getAnalysisBuffer(imageUrl);
  const rawPalette = await Vibrant.from(imageBuffer)
    .maxColorCount(options.count * 2)
    .quality(options.quality)
    .getPalette();

  const swatches = Object.values(rawPalette)
    .filter(Boolean)
    .sort((a, b) => getPopulation(b) - getPopulation(a))
    .slice(0, options.count);

  if (!swatches.length) {
    throw new Error('No colour swatches returned');
  }

  const totalPopulation = swatches.reduce(
    (sum, swatch) => sum + getPopulation(swatch),
    0
  );
  const equalPercentage = 100 / swatches.length;

  return swatches.map((swatch) => {
    const [r, g, b] = getRgb(swatch).map((value) => Math.round(value));
    const population = getPopulation(swatch);
    return {
      color: rgbToHex(r, g, b),
      rgb: { r, g, b },
      percentage:
        totalPopulation > 0
          ? (population / totalPopulation) * 100
          : equalPercentage,
    };
  });
}

async function getAnalysisBuffer(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Image fetch failed with ${response.status}`);
  }

  const input = Buffer.from(await response.arrayBuffer());
  return sharp(input, { limitInputPixels: false })
    .rotate()
    .resize({
      width: options.resize,
      height: options.resize,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}

function d1Command(command) {
  return runWrangler(['--command', command]);
}

function d1File(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'paillette-colors-'));
  const file = join(dir, 'updates.sql');
  writeFileSync(file, sql);
  try {
    return runWrangler(['--file', file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runWrangler(extraArgs) {
  const proc = spawnSync(
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
      '--env',
      options.env,
      '--json',
      ...extraArgs,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 50,
    }
  );

  if (proc.status !== 0) {
    throw new Error(
      proc.stderr || proc.stdout || `wrangler exited ${proc.status}`
    );
  }

  const jsonStart = proc.stdout.indexOf('[');
  const jsonEnd = proc.stdout.lastIndexOf(']');
  const jsonText =
    jsonStart >= 0 && jsonEnd >= jsonStart
      ? proc.stdout.slice(jsonStart, jsonEnd + 1)
      : proc.stdout;

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Failed to parse wrangler JSON: ${proc.stdout}`);
  }
}

async function mapLimit(items, concurrency, fn) {
  const output = new Array(items.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        output[index] = await fn(items[index], index);
      }
    })
  );

  return output;
}

function getRgb(swatch) {
  if (typeof swatch.getRgb === 'function') return swatch.getRgb();
  const rgb = swatch.rgb || swatch._rgb;
  if (!rgb || rgb.length < 3) throw new Error('Swatch missing RGB data');
  return rgb;
}

function getPopulation(swatch) {
  if (typeof swatch.getPopulation === 'function') return swatch.getPopulation();
  return swatch.population || swatch._population || 0;
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function toInt(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/backfill-ngs-colors.mjs --limit=10
  node scripts/backfill-ngs-colors.mjs --apply --limit=100 --concurrency=4
  node scripts/backfill-ngs-colors.mjs --apply

Options:
  --apply               Write canonical dominant_colors/color_palette to D1.
  --force               Re-extract rows that already have canonical colours.
  --limit=N             Maximum artworks to scan. Required for dry runs.
  --concurrency=N       Parallel image extractions. Default: 4.
  --batch-size=N        Rows fetched from D1 per loop. Default: 50.
  --write-size=N        Updates per D1 SQL file. Default: 25.
  --quality=N           node-vibrant sampling quality. Default: 1.
  --count=N             Palette colour count. Default: 5.
  --resize=N            Resize longest side before extraction. Default: 320.
  --image-source=thumb  Use thumbnail/processed/original fallback. Use original to force originals.
  --start-after=ID      Resume keyset scan after an artwork id.
  --database=NAME       D1 database binding/name. Default: paillette-db-stg.
  --env=NAME            Wrangler environment. Default: staging.
  --org=UUID            Org id. Defaults to the NGS staging org.
`);
}
