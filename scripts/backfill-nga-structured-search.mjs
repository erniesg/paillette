#!/usr/bin/env node

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

const parseInteger = (value, name, { minimum, defaultValue }) => {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  const parsed = Number(value);
  if (
    String(value).trim() === '' ||
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < minimum
  ) {
    throw new Error(
      `${name} must be a ${minimum === 0 ? 'nonnegative' : 'positive'} finite integer`
    );
  }
  return parsed;
};

const parseCandidateCount = (value) => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(
      'manifest.providers.nga.candidateCount must be a nonnegative finite integer'
    );
  }
  return value;
};

const outDir = resolve(
  args.get('out-dir') || 'tmp/nga-structured-search-backfill'
);
const limit = parseInteger(args.get('limit'), '--limit', {
  minimum: 0,
  defaultValue: 0,
});
const chunkSize = parseInteger(args.get('sql-chunk-size'), '--sql-chunk-size', {
  minimum: 1,
  defaultValue: 500,
});
const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
const isNgaRecord = (record) => record?.id?.startsWith('open-access-art:nga:');
const freshRecords = (manifest.providers?.nga?.normalizedSamples || []).filter(
  isNgaRecord
);
const fallbackPlanPath = args.get('fallback-plan');
const fallbackRecords = (
  fallbackPlanPath
    ? JSON.parse(readFileSync(resolve(fallbackPlanPath), 'utf8')).records || []
    : []
).filter(isNgaRecord);
const seenRecordIds = new Set();
const allRecords = mergeAuthoritativeRecords(
  freshRecords,
  fallbackRecords
).filter((record) => {
  if (seenRecordIds.has(record.id)) return false;
  seenRecordIds.add(record.id);
  return true;
});
const sourceCandidateCount = parseCandidateCount(
  manifest.providers?.nga?.candidateCount
);
const availableRecordCount = allRecords.length;
const sourceCoverageComplete = availableRecordCount >= sourceCandidateCount;
const sampleOnly = args.has('sample-only');

if (!sourceCoverageComplete && !sampleOnly) {
  throw new Error(
    `NGA backfill source is incomplete: ${availableRecordCount} authoritative records for ${sourceCandidateCount} candidates; provide --fallback-plan or use --sample-only for a pilot`
  );
}

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
    `${records
      .slice(offset, offset + chunkSize)
      .map(buildStructuredMetadataUpdateSql)
      .join('\n')}\n`
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
  sourceCandidateCount,
  availableRecordCount,
  recordCount: records.length,
  mode: sampleOnly ? 'sample' : 'full',
  sourceCoverageComplete,
  sqlFiles,
  vectorFiles,
  enrichedVectorCount,
};
writeFileSync(
  join(outDir, 'summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`
);
console.log(JSON.stringify(summary, null, 2));
