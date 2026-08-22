#!/usr/bin/env node

import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Papa from 'papaparse';

import { buildNgaArtistMetadata } from './lib/nga-artist-metadata.mjs';
import {
  EXPECTED_NGA_SOURCE_SHA256,
  NGA_SOURCE_COMMIT,
  NGA_SOURCE_HEADERS,
  STAGING_D1_DATABASE,
  STAGING_IMAGE_VECTOR_INDEX,
  assertStagingBackfillIdentity,
  buildNgaBackfillArtifacts,
  canonicalJson,
  consumeValidatedPreflightInputs,
  publishPreparedArtifacts,
  sha256,
  validateNgaSourceFiles,
  validatePreflightBindings,
} from './lib/nga-artist-backfill.mjs';

const repeatable = new Set([
  'preflight-manifest',
  'staged-records',
  'image-vectors',
]);
const parsedArgs = new Map();
for (const argument of process.argv.slice(2)) {
  if (!argument.startsWith('--'))
    throw new Error(`unexpected argument ${argument}`);
  const [key, ...rest] = argument.slice(2).split('=');
  const value = rest.join('=');
  if (!value) throw new Error(`--${key} requires a value`);
  if (repeatable.has(key)) {
    parsedArgs.set(key, [...(parsedArgs.get(key) || []), value]);
  } else if (parsedArgs.has(key)) {
    throw new Error(`--${key} may be supplied only once`);
  } else {
    parsedArgs.set(key, value);
  }
}

const allowed = new Set([
  'source-commit',
  'preflight-manifest',
  'staged-records',
  'image-vectors',
  'expected-org-id',
  'out-dir',
  'phase',
]);
for (const key of parsedArgs.keys()) {
  if (!allowed.has(key)) throw new Error(`unsupported option --${key}`);
}
for (const key of [...allowed].filter((key) => key !== 'preflight-manifest')) {
  if (!parsedArgs.has(key)) throw new Error(`--${key} is required`);
}

const sourceCommit = parsedArgs.get('source-commit');
const expectedOrgId = parsedArgs.get('expected-org-id');
const phase = parsedArgs.get('phase');
const outputDirectory = resolve(parsedArgs.get('out-dir'));
if (sourceCommit !== NGA_SOURCE_COMMIT) {
  throw new Error(`--source-commit must equal ${NGA_SOURCE_COMMIT}`);
}
if (!['pilot', 'full'].includes(phase))
  throw new Error('--phase must be pilot or full');
assertStagingBackfillIdentity(expectedOrgId);

const parseCsv = (text, filename) => {
  const result = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (result.errors.length) {
    throw new Error(`malformed ${filename}: ${result.errors[0].message}`);
  }
  return result.data;
};

const normalizeJsonRows = (value) => {
  if (Array.isArray(value)) {
    if (
      value.every(
        (item) => item && typeof item === 'object' && !Array.isArray(item)
      )
    ) {
      if (value.length === 1 && Array.isArray(value[0].results))
        return value[0].results;
      return value;
    }
    return value.flatMap(normalizeJsonRows);
  }
  if (Array.isArray(value?.results)) return value.results;
  if (Array.isArray(value?.records)) return value.records;
  throw new Error('staged-records JSON must contain an array of complete rows');
};

const parseJsonColumn = (value, field) => {
  if (value === null || value === undefined || value === '') return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`malformed staged ${field}`);
  }
};

const normalizeStagedRecords = (payloads) => {
  const records = [];
  for (const payload of payloads) {
    for (const row of normalizeJsonRows(payload)) {
      records.push({
        ...row,
        custom_metadata: parseJsonColumn(
          row.custom_metadata,
          'custom_metadata'
        ),
        field_sources: parseJsonColumn(row.field_sources, 'field_sources'),
      });
    }
  }
  return records;
};

const chunk = (values, size) => {
  const chunks = [];
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size));
  }
  return chunks;
};

const assertEmptyOutput = async () => {
  try {
    const info = await stat(outputDirectory);
    if (!info.isDirectory() || (await readdir(outputDirectory)).length) {
      throw new Error('--out-dir must be an empty directory or not exist');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

await assertEmptyOutput();
const preflightValidation = await validatePreflightBindings({
  phase,
  expectedOrgId,
  preflightManifestPaths:
    parsedArgs.get('preflight-manifest') ||
    parsedArgs
      .get('staged-records')
      .map((path) => join(dirname(resolve(path)), 'preflight-manifest.json')),
  stagedRecordPaths: parsedArgs.get('staged-records'),
  imageVectorPaths: parsedArgs.get('image-vectors'),
});
const downloadDirectory = await mkdtemp(join(tmpdir(), 'nga-artist-source-'));
try {
  const sourceFiles = {};
  const sourceRows = {};
  await Promise.all(
    Object.keys(EXPECTED_NGA_SOURCE_SHA256).map(async (filename) => {
      const url = `https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/${sourceCommit}/data/${filename}`;
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`failed to fetch ${filename}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const text = bytes.toString('utf8');
      const header = text.split(/\r?\n/, 1)[0].replace(/^\uFEFF/, '');
      const digest = sha256(bytes);
      await writeFile(join(downloadDirectory, filename), bytes, { flag: 'wx' });
      sourceFiles[filename] = { commit: sourceCommit, sha256: digest, header };
      sourceRows[filename] = parseCsv(text, filename);
    })
  );
  validateNgaSourceFiles(sourceFiles, sourceCommit);

  const objectsById = new Set(
    sourceRows['objects.csv']
      .map((row) => String(row.objectid || '').trim())
      .filter(Boolean)
  );
  const sourceCandidateIds = new Set();
  for (const image of sourceRows['published_images.csv']) {
    const objectId = String(image.depictstmsobjectid || '').trim();
    if (
      String(image.openaccess || '').trim() === '1' &&
      objectId &&
      objectsById.has(objectId)
    ) {
      sourceCandidateIds.add(objectId);
    }
  }

  const consumedPreflightInputs =
    await consumeValidatedPreflightInputs(preflightValidation);
  const stagedRecords = normalizeStagedRecords(
    consumedPreflightInputs.stagedPayloads
  );
  const requiredObjectIds = new Set(
    stagedRecords.map((record) =>
      String(record.id || '').replace(/^open-access-art:nga:/, '')
    )
  );
  const artistMetadata = buildNgaArtistMetadata({
    relationships: sourceRows['objects_constituents.csv'],
    constituents: sourceRows['constituents.csv'],
    alternativeNames: sourceRows['constituents_altnames.csv'],
    requiredObjectIds,
  });
  const vectors = consumedPreflightInputs.vectors;
  const artifacts = buildNgaBackfillArtifacts({
    phase,
    expectedOrgId,
    stagedRecords,
    sourceCandidateIds,
    artistMetadata,
    vectors,
  });

  const fileContents = new Map();
  const fileRecordCounts = new Map();
  const addJson = (path, value) =>
    fileContents.set(path, `${JSON.stringify(value, null, 2)}\n`);
  const sourceManifest = {
    schemaVersion: 1,
    sourceCommit,
    files: Object.fromEntries(
      Object.keys(EXPECTED_NGA_SOURCE_SHA256).map((filename) => [
        filename,
        {
          sha256: sourceFiles[filename].sha256,
          rowCount: sourceRows[filename].length,
          header: NGA_SOURCE_HEADERS[filename],
        },
      ])
    ),
    candidateCount: sourceCandidateIds.size,
  };
  addJson('source-manifest.json', sourceManifest);
  addJson('mapping.json', artifacts.mapping);
  fileRecordCounts.set('mapping.json', artifacts.mapping.length);

  const mutationArtifacts = [];
  for (const [index, rows] of chunk(artifacts.sql, 500).entries()) {
    const content = `${rows.join('\n')}\n`;
    const path = `sql/artist-${String(index + 1).padStart(4, '0')}-${sha256(content).slice(0, 16)}.sql`;
    fileContents.set(path, content);
    fileRecordCounts.set(path, rows.length);
    mutationArtifacts.push({
      kind: 'd1-sql',
      path,
      sha256: sha256(content),
      recordCount: rows.length,
    });
  }
  for (const [index, rows] of chunk(artifacts.enrichedVectors, 500).entries()) {
    const content = `${rows.map((row) => canonicalJson(row)).join('\n')}\n`;
    const path = `vectors/enriched-${String(index + 1).padStart(4, '0')}-${sha256(content).slice(0, 16)}.ndjson`;
    fileContents.set(path, content);
    fileRecordCounts.set(path, rows.length);
    mutationArtifacts.push({
      kind: 'image-vectors',
      path,
      sha256: sha256(content),
      recordCount: rows.length,
    });
  }
  for (const [index, rows] of chunk(artifacts.rollbackVectors, 500).entries()) {
    const content = `${rows.map((row) => canonicalJson(row)).join('\n')}\n`;
    const path = `rollback/image-vectors-${String(index + 1).padStart(4, '0')}-${sha256(content).slice(0, 16)}.ndjson`;
    fileContents.set(path, content);
    fileRecordCounts.set(path, rows.length);
  }
  addJson('vector-value-hashes.json', artifacts.vectorValueHashes);
  fileRecordCounts.set(
    'vector-value-hashes.json',
    artifacts.vectorValueHashes.length
  );

  const files = [...fileContents.entries()].map(([path, content]) => ({
    path,
    sha256: sha256(content),
    bytes: Buffer.byteLength(content),
    ...(fileRecordCounts.has(path)
      ? { recordCount: fileRecordCounts.get(path) }
      : {}),
  }));
  const artifactManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: 'staging',
    phase,
    expectedOrgId,
    resources: {
      d1Database: STAGING_D1_DATABASE,
      imageVectorIndex: STAGING_IMAGE_VECTOR_INDEX,
    },
    source: {
      commit: sourceCommit,
      manifestSha256: sha256(fileContents.get('source-manifest.json')),
    },
    preflightInputs: preflightValidation.bindings,
    invariants: {
      stagedRecordCount: artifacts.mapping.length,
      mappingCount: artifacts.mapping.length,
      imageVectorCount: artifacts.enrichedVectors.length,
      rollbackVectorCount: artifacts.rollbackVectors.length,
      vectorValuesUnchanged: artifacts.vectorValueHashes.every(
        (row) => row.originalSha256 === row.enrichedSha256
      ),
      captionVectorsChanged: 0,
    },
    files,
    orderedArtifacts: mutationArtifacts,
  };
  addJson('artifact-manifest.json', artifactManifest);

  await publishPreparedArtifacts(
    outputDirectory,
    [...fileContents].map(([path, content]) => ({
      path,
      content,
      sha256: sha256(content),
    }))
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: 'dry-run',
        phase,
        outputDirectory,
        sourceCommit,
        recordCount: artifacts.mapping.length,
        artifactManifest: join(outputDirectory, 'artifact-manifest.json'),
        artifactManifestSha256: sha256(
          fileContents.get('artifact-manifest.json')
        ),
      },
      null,
      2
    )}\n`
  );
} finally {
  await rm(downloadDirectory, { force: true, recursive: true });
}
