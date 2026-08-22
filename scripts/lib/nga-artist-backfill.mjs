import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { buildNgaArtistUpdateSql } from './nga-structured-search-backfill.mjs';

export const NGA_SOURCE_COMMIT = '79d114c2186ca38af27a9478717f1e509d799495';
export const FULL_STAGED_COUNT = 63_253;
export const PILOT_OBJECT_IDS = Object.freeze([
  '131994',
  '110821',
  '11236',
  '38',
  '579',
]);
export const STAGING_D1_DATABASE = 'paillette-db-stg';
export const STAGING_IMAGE_VECTOR_INDEX = 'paillette-embeddings-v2-stg';
export const STAGING_ORG_ID = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

export function assertStagingBackfillIdentity(expectedOrgId) {
  if (expectedOrgId !== STAGING_ORG_ID) {
    throw new Error(
      `expected organization must be the staging organization ${STAGING_ORG_ID}`
    );
  }
}

export const NGA_SOURCE_HEADERS = Object.freeze({
  'objects.csv':
    'objectid,uuid,accessioned,accessionnum,locationid,title,displaydate,beginyear,endyear,visualbrowsertimespan,medium,dimensions,inscription,markings,attributioninverted,attribution,provenancetext,creditline,classification,subclassification,visualbrowserclassification,parentid,isvirtual,departmentabbr,portfolio,series,volume,watermarks,lastdetectedmodification,wikidataid,customprinturl',
  'published_images.csv':
    'uuid,iiifurl,iiifthumburl,viewtype,sequence,width,height,maxpixels,openaccess,created,modified,depictstmsobjectid,assistivetext',
  'objects_constituents.csv':
    'objectid,constituentid,displayorder,roletype,role,prefix,suffix,displaydate,beginyear,endyear,country,zipcode',
  'constituents.csv':
    'constituentid,uuid,ulanid,preferreddisplayname,forwarddisplayname,lastname,displaydate,artistofngaobject,beginyear,endyear,visualbrowsertimespan,nationality,visualbrowsernationality,constituenttype,wikidataid',
  'constituents_altnames.csv':
    'altnameid,constituentid,lastname,displayname,forwarddisplayname,nametype',
});

export const EXPECTED_NGA_SOURCE_SHA256 = Object.freeze({
  'objects.csv':
    '0435ee2468c5043046daef4a0c39badb586d52d4ed24712287423a4897961d67',
  'published_images.csv':
    '8fb22d56ba09490937fb54ff07560c18ca4eb3468c24aa91167eeb4e9cc3a16d',
  'objects_constituents.csv':
    'a460accc402ad8b0130e3b108f9bc9d03ac9621721db9ef713f944205eba6c1d',
  'constituents.csv':
    '090ed9c7d71a3fb83660bbf0e52d6b6a133eab60bf87b4115a4b36bb9042d3b9',
  'constituents_altnames.csv':
    '129547888f858aa15d951dff27c6761abd308357a1c0787438ded8091964a44f',
});

export const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');

export const canonicalJson = (value) => {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, normalize(item[key])])
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
};

export function validateNgaSourceFiles(entries, sourceCommit) {
  if (sourceCommit !== NGA_SOURCE_COMMIT) {
    throw new Error(`source commit must be pinned to ${NGA_SOURCE_COMMIT}`);
  }
  const filenames = Object.keys(EXPECTED_NGA_SOURCE_SHA256);
  if (
    Object.keys(entries || {}).length !== filenames.length ||
    filenames.some((filename) => !entries?.[filename]?.sha256)
  ) {
    throw new Error('all five NGA source SHA-256 digests are required');
  }
  for (const filename of filenames) {
    const entry = entries[filename];
    if (entry.commit !== sourceCommit) {
      throw new Error(`mixed source commit for ${filename}`);
    }
    if (entry.sha256 !== EXPECTED_NGA_SOURCE_SHA256[filename]) {
      throw new Error(`source SHA-256 mismatch for ${filename}`);
    }
    if (entry.header !== NGA_SOURCE_HEADERS[filename]) {
      throw new Error(`NGA source header drift for ${filename}`);
    }
  }
  return entries;
}

const resolveBoundPreflightFile = async (root, entry) => {
  if (
    typeof entry?.path !== 'string' ||
    !entry.path ||
    isAbsolute(entry.path) ||
    entry.path.split(/[\\/]/).includes('..')
  ) {
    throw new Error('preflight input path escapes its manifest root');
  }
  const path = await realpath(resolve(root, entry.path));
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error('preflight input path escapes its manifest root');
  }
  const content = await readFile(path);
  const digest = sha256(content);
  if (digest !== entry.sha256) {
    throw new Error(`preflight SHA-256 digest mismatch for ${entry.path}`);
  }
  return { ...entry, resolvedPath: path, content };
};

const expandNdjsonInputs = async (paths) => {
  const files = [];
  for (const input of paths || []) {
    const path = await realpath(resolve(input));
    const info = await stat(path);
    if (!info.isDirectory()) {
      files.push(path);
      continue;
    }
    const entries = await readdir(path, { withFileTypes: true });
    files.push(
      ...entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ndjson'))
        .map((entry) => resolve(path, entry.name))
        .sort()
    );
  }
  return files;
};

export async function validatePreflightBindings({
  phase,
  expectedOrgId,
  preflightManifestPaths,
  stagedRecordPaths,
  imageVectorPaths,
}) {
  assertStagingBackfillIdentity(expectedOrgId);
  if (!['pilot', 'full'].includes(phase)) {
    throw new Error('--phase must be pilot or full');
  }
  if (!preflightManifestPaths?.length) {
    throw new Error('at least one --preflight-manifest is required');
  }

  const suppliedStagedPaths = new Set(
    await Promise.all(
      (stagedRecordPaths || []).map((path) => realpath(resolve(path)))
    )
  );
  const suppliedVectorPaths = new Set(
    await expandNdjsonInputs(imageVectorPaths)
  );
  const boundStagedPaths = new Set();
  const boundVectorPaths = new Set();
  const bindings = [];
  const validatedStagedRecordFiles = [];
  const validatedImageVectorFiles = [];

  for (const inputPath of preflightManifestPaths) {
    const manifestPath = await realpath(resolve(inputPath));
    const manifestContent = await readFile(manifestPath);
    const manifest = JSON.parse(manifestContent.toString('utf8'));
    if (
      manifest.environment !== 'staging' ||
      !['pilot', 'full'].includes(manifest.phase) ||
      manifest.expectedOrgId !== STAGING_ORG_ID ||
      manifest.resources?.d1Database !== STAGING_D1_DATABASE ||
      manifest.resources?.imageVectorIndex !== STAGING_IMAGE_VECTOR_INDEX
    ) {
      throw new Error(
        'preflight manifest identity is outside the staging allowlist'
      );
    }
    const root = await realpath(dirname(manifestPath));
    const ids = await resolveBoundPreflightFile(root, manifest.inputs?.ids);
    const staged = await resolveBoundPreflightFile(
      root,
      manifest.inputs?.stagedRecords
    );
    const vectors = [];
    for (const entry of manifest.inputs?.imageVectors || []) {
      vectors.push(await resolveBoundPreflightFile(root, entry));
    }

    let parsedIds;
    let parsedStaged;
    let parsedVectors;
    try {
      parsedIds = JSON.parse(ids.content.toString('utf8'));
      parsedStaged = JSON.parse(staged.content.toString('utf8'));
      parsedVectors = vectors.flatMap((entry) =>
        entry.content
          .toString('utf8')
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      );
    } catch {
      throw new Error(
        'malformed JSON/NDJSON in hash-confirmed preflight input'
      );
    }
    const vectorCount = parsedVectors.length;
    if (
      !Array.isArray(parsedIds) ||
      !Array.isArray(parsedStaged) ||
      parsedIds.length !== manifest.counts?.ids ||
      parsedStaged.length !== manifest.counts?.stagedRecords ||
      vectorCount !== manifest.counts?.imageVectors ||
      ids.count !== manifest.counts?.ids ||
      staged.count !== manifest.counts?.stagedRecords ||
      vectors.reduce((total, entry) => total + entry.count, 0) !==
        manifest.counts?.imageVectors
    ) {
      throw new Error('preflight input counts do not match its manifest');
    }
    const expectedIds = new Set(parsedIds);
    const stagedIds = parsedStaged.map((row) => String(row?.id || ''));
    const vectorIds = parsedVectors.map((row) =>
      String(row?.metadata?.artworkId || row?.id || '')
    );
    if (
      expectedIds.size !== parsedIds.length ||
      stagedIds.some((id) => !/^open-access-art:nga:\d+$/.test(id)) ||
      vectorIds.some((id) => !/^open-access-art:nga:\d+$/.test(id)) ||
      new Set(stagedIds).size !== stagedIds.length ||
      new Set(vectorIds).size !== vectorIds.length ||
      stagedIds.some((id) => !expectedIds.has(id)) ||
      vectorIds.some((id) => !expectedIds.has(id))
    ) {
      throw new Error('preflight ID mismatch, duplicate, or gap');
    }
    if (boundStagedPaths.has(staged.resolvedPath)) {
      throw new Error('duplicate preflight staged-records binding');
    }
    boundStagedPaths.add(staged.resolvedPath);
    validatedStagedRecordFiles.push({
      path: staged.resolvedPath,
      sha256: staged.sha256,
    });
    for (const vector of vectors) {
      if (boundVectorPaths.has(vector.resolvedPath)) {
        throw new Error('duplicate preflight image-vector binding');
      }
      boundVectorPaths.add(vector.resolvedPath);
      validatedImageVectorFiles.push({
        path: vector.resolvedPath,
        sha256: vector.sha256,
      });
    }
    bindings.push({
      manifestSha256: sha256(manifestContent),
      phase: manifest.phase,
      expectedOrgId: manifest.expectedOrgId,
      resources: manifest.resources,
      counts: manifest.counts,
      ids: { path: ids.path, sha256: ids.sha256, count: ids.count },
      stagedRecords: {
        path: staged.path,
        sha256: staged.sha256,
        count: staged.count,
      },
      imageVectors: vectors.map((entry) => ({
        path: entry.path,
        sha256: entry.sha256,
        count: entry.count,
      })),
    });
  }

  if (
    suppliedStagedPaths.size !== boundStagedPaths.size ||
    [...suppliedStagedPaths].some((path) => !boundStagedPaths.has(path))
  ) {
    throw new Error('unmanifested staged-records input set');
  }
  if (
    suppliedVectorPaths.size !== boundVectorPaths.size ||
    [...suppliedVectorPaths].some((path) => !boundVectorPaths.has(path))
  ) {
    throw new Error('unmanifested image-vectors input set');
  }
  const phases = bindings
    .map((binding) => binding.phase)
    .sort()
    .join(',');
  const totalCount = bindings.reduce(
    (total, binding) => total + binding.counts.stagedRecords,
    0
  );
  if (
    (phase === 'pilot' && (phases !== 'pilot' || totalCount !== 5)) ||
    (phase === 'full' &&
      (phases !== 'full,pilot' || totalCount !== FULL_STAGED_COUNT))
  ) {
    throw new Error(`preflight manifests do not form the exact ${phase} scope`);
  }
  return {
    bindings: bindings.sort((left, right) =>
      left.phase.localeCompare(right.phase)
    ),
    stagedRecordFiles: validatedStagedRecordFiles,
    imageVectorFiles: validatedImageVectorFiles,
  };
}

const readStillBoundPreflightFile = async ({ path, sha256: expected }) => {
  const content = await readFile(path);
  if (sha256(content) !== expected) {
    throw new Error(
      `preflight input changed after preflight validation: ${path}`
    );
  }
  return content;
};

export async function consumeValidatedPreflightInputs(validation) {
  if (
    !Array.isArray(validation?.stagedRecordFiles) ||
    !Array.isArray(validation?.imageVectorFiles)
  ) {
    throw new Error('validated preflight input descriptors are required');
  }
  const stagedPayloads = [];
  const vectors = [];
  try {
    for (const input of validation.stagedRecordFiles) {
      const content = await readStillBoundPreflightFile(input);
      stagedPayloads.push(JSON.parse(content.toString('utf8')));
    }
    for (const input of validation.imageVectorFiles) {
      const content = await readStillBoundPreflightFile(input);
      for (const line of content
        .toString('utf8')
        .split(/\r?\n/)
        .filter(Boolean)) {
        vectors.push(JSON.parse(line));
      }
    }
  } catch (error) {
    if (/changed after preflight validation/.test(String(error?.message))) {
      throw error;
    }
    throw new Error('malformed JSON/NDJSON in consumed preflight input');
  }
  return { stagedPayloads, vectors };
}

export async function publishPreparedArtifacts(outputDirectory, files) {
  const finalDirectory = resolve(outputDirectory);
  const parent = dirname(finalDirectory);
  await mkdir(parent, { recursive: true });
  let finalDirectoryExists = false;
  try {
    const info = await stat(finalDirectory);
    if (!info.isDirectory() || (await readdir(finalDirectory)).length) {
      throw new Error('artifact output directory must be empty or not exist');
    }
    finalDirectoryExists = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const temporaryDirectory = await mkdtemp(
    join(parent, `.${basename(finalDirectory)}.tmp-`)
  );
  let published = false;
  try {
    const seen = new Set();
    for (const file of files || []) {
      if (
        typeof file?.path !== 'string' ||
        !file.path ||
        isAbsolute(file.path) ||
        file.path.split(/[\\/]/).includes('..') ||
        seen.has(file.path)
      ) {
        throw new Error(`invalid generated artifact path ${file?.path}`);
      }
      seen.add(file.path);
      const destination = resolve(temporaryDirectory, file.path);
      if (!destination.startsWith(`${temporaryDirectory}${sep}`)) {
        throw new Error(`generated artifact path escapes output ${file.path}`);
      }
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content, { flag: 'wx' });
    }
    for (const file of files || []) {
      const digest = sha256(
        await readFile(resolve(temporaryDirectory, file.path))
      );
      if (digest !== file.sha256) {
        throw new Error(`generated artifact SHA-256 mismatch for ${file.path}`);
      }
    }
    if (finalDirectoryExists) await rmdir(finalDirectory);
    await rename(temporaryDirectory, finalDirectory);
    published = true;
  } finally {
    if (!published) {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  }
}

const objectIdFromArtworkId = (id) => {
  const match = /^open-access-art:nga:(\d+)$/.exec(String(id || ''));
  if (!match) throw new Error(`invalid staged NGA artwork ID: ${id}`);
  return match[1];
};

export function validateStagedNgaScope(
  stagedRecords,
  { phase, sourceCandidateIds }
) {
  if (!['pilot', 'full'].includes(phase)) {
    throw new Error('--phase must be pilot or full');
  }
  const ids = [];
  const seen = new Set();
  for (const record of stagedRecords || []) {
    const objectId = objectIdFromArtworkId(record?.id);
    if (seen.has(objectId)) throw new Error(`duplicate staged ID ${objectId}`);
    seen.add(objectId);
    ids.push(objectId);
  }

  if (phase === 'pilot') {
    if (ids.length !== PILOT_OBJECT_IDS.length) {
      throw new Error('pilot must contain exactly five staged IDs');
    }
    if (
      ids.some((id) => !PILOT_OBJECT_IDS.includes(id)) ||
      PILOT_OBJECT_IDS.some((id) => !seen.has(id))
    ) {
      throw new Error('pilot scope differs from the approved pilot allowlist');
    }
  } else if (ids.length !== FULL_STAGED_COUNT) {
    throw new Error(`full scope must contain exactly 63,253 staged IDs`);
  }

  const candidates = new Set(sourceCandidateIds || []);
  const missing = ids.filter((id) => !candidates.has(id));
  if (missing.length) {
    throw new Error(`staged ID absent from pinned source: ${missing[0]}`);
  }
  if (phase === 'full') {
    const additions = [...candidates].filter((id) => !seen.has(id));
    if (additions.length) {
      throw new Error(
        `upstream addition outside staged membership: ${additions[0]}`
      );
    }
  }

  return phase === 'pilot'
    ? [...PILOT_OBJECT_IDS]
    : [...ids].sort((a, b) => Number(a) - Number(b));
}

export function enrichNgaArtistVector(vector, record) {
  if (!Array.isArray(vector?.values)) {
    throw new Error(`vector ${vector?.id || '<unknown>'} is missing values`);
  }
  if (!/^\d+$/.test(String(record?.primaryArtistId || ''))) {
    throw new Error('vector enrichment requires a decimal primaryArtistId');
  }
  const rollback = structuredClone(vector);
  const enriched = structuredClone(vector);
  enriched.metadata = {
    ...(enriched.metadata || {}),
    primaryArtistId: String(record.primaryArtistId),
  };
  const originalValuesSha256 = sha256(canonicalJson(rollback.values));
  const enrichedValuesSha256 = sha256(canonicalJson(enriched.values));
  if (originalValuesSha256 !== enrichedValuesSha256) {
    throw new Error(`vector values changed for ${vector.id}`);
  }
  return {
    enriched,
    rollback,
    originalValuesSha256,
    enrichedValuesSha256,
  };
}

const vectorArtworkId = (vector) =>
  String(vector?.metadata?.artworkId || vector?.id || '');

export function buildNgaBackfillArtifacts({
  phase,
  expectedOrgId,
  stagedRecords,
  sourceCandidateIds,
  artistMetadata,
  vectors,
}) {
  const orderedIds = validateStagedNgaScope(stagedRecords, {
    phase,
    sourceCandidateIds,
  });
  const stagedByObjectId = new Map(
    stagedRecords.map((record) => [objectIdFromArtworkId(record.id), record])
  );
  const stagedArtworkIds = new Set(stagedRecords.map((record) => record.id));
  const vectorsByArtworkId = new Map();
  for (const vector of vectors || []) {
    const artworkId = vectorArtworkId(vector);
    if (String(vector?.id || '') !== artworkId) {
      throw new Error(`vector ID does not match artwork ID ${artworkId}`);
    }
    if (vectorsByArtworkId.has(artworkId)) {
      throw new Error(`duplicate vector ID ${artworkId}`);
    }
    vectorsByArtworkId.set(artworkId, vector);
  }

  const mapping = [];
  const sql = [];
  const enrichedVectors = [];
  const rollbackVectors = [];
  const vectorValueHashes = [];
  for (const objectId of orderedIds) {
    const metadata = artistMetadata.get(objectId);
    if (!metadata) {
      throw new Error(`missing artist relationship for ${objectId}`);
    }
    const staged = stagedByObjectId.get(objectId);
    if (staged.org_id !== expectedOrgId) {
      throw new Error(`unexpected organization for ${staged.id}`);
    }
    if (staged.custom_metadata?.provider !== 'nga') {
      throw new Error(`unexpected provider for ${staged.id}`);
    }
    const record = {
      id: staged.id,
      primaryArtistId: metadata.primaryArtistId,
      customMetadata: {
        ngaArtists: {
          sourceCommit: NGA_SOURCE_COMMIT,
          relationships: metadata.relationships,
        },
      },
      fieldSources: { primary_artist_id: 'nga.objects_constituents' },
    };
    const vector = vectorsByArtworkId.get(staged.id);
    if (!vector) throw new Error(`vector-ID gap for ${staged.id}`);
    const enriched = enrichNgaArtistVector(vector, record);
    mapping.push(record);
    sql.push(buildNgaArtistUpdateSql(record, expectedOrgId));
    enrichedVectors.push(enriched.enriched);
    rollbackVectors.push(enriched.rollback);
    vectorValueHashes.push({
      id: staged.id,
      originalSha256: enriched.originalValuesSha256,
      enrichedSha256: enriched.enrichedValuesSha256,
    });
  }
  const extras = [...vectorsByArtworkId.keys()].filter(
    (id) => !stagedArtworkIds.has(id)
  );
  if (extras.length) throw new Error(`unexpected vector ID ${extras[0]}`);

  return { mapping, sql, enrichedVectors, rollbackVectors, vectorValueHashes };
}
