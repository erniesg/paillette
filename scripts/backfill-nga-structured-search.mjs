#!/usr/bin/env node

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  buildStructuredMetadataUpdateSql,
  enrichVectorLine,
  mergeAuthoritativeRecords,
} from './lib/nga-structured-search-backfill.mjs';

const args = new Map();
for (const arg of process.argv.slice(2)) {
  if (!arg.startsWith('--')) continue;
  const [key, ...rest] = arg.slice(2).split('=');
  args.set(key, rest.join('='));
}

const manifestPath = args.get('manifest');
if (!manifestPath) {
  throw new Error('--manifest is required');
}

const outDir = resolve(args.get('out-dir') || 'tmp/nga-structured-search-backfill');
const limit = Number(args.get('limit') || 0);
const chunkSize = Number(args.get('sql-chunk-size') || 500);
const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
const freshRecords = Object.values(manifest.providers || {}).flatMap(
  (provider) => provider.normalizedSamples || []
);
const fallbackPlanPath = args.get('fallback-plan');
const fallbackRecords = fallbackPlanPath
  ? JSON.parse(readFileSync(resolve(fallbackPlanPath), 'utf8')).records || []
  : [];
const allRecords = mergeAuthoritativeRecords(freshRecords, fallbackRecords);
const records = limit > 0 ? allRecords.slice(0, limit) : allRecords;
const byId = new Map(records.map((record) => [record.id, record]));

mkdirSync(join(outDir, 'sql'), { recursive: true });
mkdirSync(join(outDir, 'vectors'), { recursive: true });

const sqlFiles = [];
for (let offset = 0; offset < records.length; offset += chunkSize) {
  const file = join(
    outDir,
    'sql',
    `nga-structured-${String(offset / chunkSize + 1).padStart(4, '0')}.sql`
  );
  writeFileSync(
    file,
    `${records.slice(offset, offset + chunkSize).map(buildStructuredMetadataUpdateSql).join('\n')}\n`
  );
  sqlFiles.push(file);
}

const vectorInputs = String(args.get('vector-input') || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .flatMap((value) => {
    const path = resolve(value);
    return statSync(path).isDirectory()
      ? readdirSync(path)
          .filter((name) => name.endsWith('.ndjson'))
          .map((name) => join(path, name))
      : [path];
  });

let enrichedVectorCount = 0;
const vectorFiles = [];
for (const input of vectorInputs) {
  const lines = readFileSync(input, 'utf8').split('\n').filter(Boolean);
  const enriched = lines.flatMap((line) => {
    const vector = JSON.parse(line);
    const artworkId = vector.metadata?.artworkId || vector.id;
    const record = byId.get(artworkId);
    return record ? [enrichVectorLine(line, record)] : [];
  });
  if (!enriched.length) continue;
  const file = join(outDir, 'vectors', basename(input));
  writeFileSync(file, `${enriched.join('\n')}\n`);
  vectorFiles.push(file);
  enrichedVectorCount += enriched.length;
}

const summary = {
  manifest: resolve(manifestPath),
  recordCount: records.length,
  sqlFiles,
  vectorFiles,
  enrichedVectorCount,
};
writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
