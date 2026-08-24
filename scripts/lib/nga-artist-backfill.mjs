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

export function parseWranglerJsonOutput(output, label = 'Wrangler') {
  if (typeof output !== 'string') {
    throw new Error(`${label} response has no JSON payload`);
  }
  const match = /^[\t ]*[\[{]/m.exec(output);
  if (!match) throw new Error(`${label} response has no JSON payload`);
  let payload;
  try {
    payload = JSON.parse(output.slice(match.index));
  } catch {
    throw new Error(`${label} response has malformed or trailing JSON payload`);
  }
  if (
    payload === null ||
    (typeof payload !== 'object' && !Array.isArray(payload))
  ) {
    throw new Error(
      `${label} response JSON payload must be an object or array`
    );
  }
  return payload;
}

export function parseNgaD1ApplyFacts(
  output,
  { expectedQueryCount, label = 'D1 apply response' }
) {
  const payload = parseWranglerJsonOutput(output, label);
  const results = Array.isArray(payload) ? payload : [payload];
  if (
    results.length !== 1 ||
    results.some(
      (result) =>
        !result || typeof result !== 'object' || result.success !== true
    )
  ) {
    throw new Error(`${label} must contain exactly one successful result`);
  }
  const countOccurrences = (value) => {
    if (Array.isArray(value)) {
      return value.reduce(
        (total, entry) => total + countOccurrences(entry),
        0
      );
    }
    if (!value || typeof value !== 'object') return 0;
    return Object.entries(value).reduce(
      (total, [key, child]) =>
        total +
        (key === 'Total queries executed' ? 1 : countOccurrences(child)),
      0
    );
  };
  const queryCounts = results.map((result) => {
    if (
      !Array.isArray(result.results) ||
      result.results.length !== 1 ||
      !result.results[0] ||
      typeof result.results[0] !== 'object' ||
      !Object.hasOwn(result.results[0], 'Total queries executed') ||
      countOccurrences(result) !== 1
    ) {
      throw new Error(
        `${label} must contain exactly one direct query-count fact per successful result`
      );
    }
    const count = result.results[0]['Total queries executed'];
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`${label} has an invalid query count`);
    }
    return count;
  });
  const actualQueryCount = queryCounts.reduce(
    (total, count) => total + count,
    0
  );
  if (actualQueryCount !== expectedQueryCount) {
    throw new Error(
      `${label}: D1 queries mismatch: expected ${expectedQueryCount}, got ${actualQueryCount}`
    );
  }
  return { results, actualQueryCount };
}

export function parseNgaVectorUpsertFacts(
  output,
  { expectedIndex, expectedCount }
) {
  const payload = parseWranglerJsonOutput(output, 'Vectorize apply response');
  const jsonStart = /^[\t ]*[\[{]/m.exec(output)?.index;
  const prefix = Number.isInteger(jsonStart) ? output.slice(0, jsonStart) : '';
  const mutationMatches = [
    ...prefix.matchAll(
      /Mutation changeset identifier:\s*([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/gi
    ),
  ];
  const enqueueMatches = [
    ...prefix.matchAll(
      /Enqueued\s+(\d+)\s+vectors\s+into\s+index\s+'([^']+)'\s+for\s+upsertion\./gi
    ),
  ];
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    payload.index !== expectedIndex ||
    payload.count !== expectedCount ||
    mutationMatches.length !== 1 ||
    enqueueMatches.length !== 1 ||
    enqueueMatches[0][2] !== expectedIndex ||
    Number(enqueueMatches[0][1]) !== expectedCount
  ) {
    throw new Error(
      'Vectorize apply response must prove the exact index, count, and one mutation identity'
    );
  }
  return {
    index: expectedIndex,
    count: expectedCount,
    mutationId: mutationMatches[0][1].toLowerCase(),
  };
}

export const isSafeRelativeEvidencePath = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  !isAbsolute(value) &&
  !/^[A-Za-z]:[\\/]/.test(value) &&
  !value.split(/[\\/]/).includes('..') &&
  !/(?:^|[\/_.-])production(?:[\/_.-]|$)/i.test(value);

const isUtcTimestamp = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value));

export function validateNgaApplyResumeLineageV1(
  document,
  { phase, artifactManifestSha256, preflightManifests }
) {
  if (
    !document ||
    typeof document !== 'object' ||
    Array.isArray(document) ||
    Object.keys(document).sort().join(',') !==
      'artifactManifest,preflightManifests,responses,schemaVersion,sourceEvidenceRoot,sourceGitSha' ||
    document.schemaVersion !== 'nga-apply-resume-lineage-v1' ||
    !/^[a-f0-9]{40}$/.test(String(document.sourceGitSha || '')) ||
    !new RegExp(
      `^\\.agent/evidence/nga-staging/${document.sourceGitSha}/\\d{8}T\\d{6}Z$`
    ).test(String(document.sourceEvidenceRoot || '')) ||
    canonicalJson(document.artifactManifest) !==
      canonicalJson({
        sourcePath: `backfill/${phase}/artifact-manifest.json`,
        sha256: artifactManifestSha256,
      }) ||
    canonicalJson(document.preflightManifests) !==
      canonicalJson(preflightManifests) ||
    !Array.isArray(document.responses) ||
    !document.responses.length
  ) {
    throw new Error('resume parent lineage v1 contract is invalid');
  }
  for (const [index, response] of document.responses.entries()) {
    const sequence = index + 1;
    const expectedName = `${String(sequence).padStart(4, '0')}.json`;
    const sourceParts = String(response?.sourcePath || '').split('/');
    if (
      !response ||
      typeof response !== 'object' ||
      Array.isArray(response) ||
      Object.keys(response).sort().join(',') !==
        'copiedPath,sequence,sha256,sourcePath' ||
      response.sequence !== sequence ||
      !/^[a-f0-9]{64}$/.test(String(response.sha256 || '')) ||
      !isSafeRelativeEvidencePath(response.sourcePath) ||
      !isSafeRelativeEvidencePath(response.copiedPath) ||
      sourceParts.length !== 5 ||
      sourceParts[0] !== 'backfill' ||
      sourceParts[1] !== phase ||
      sourceParts[2] !== 'apply-responses' ||
      !sourceParts[3] ||
      sourceParts[3] === '.' ||
      sourceParts[4] !== expectedName ||
      response.copiedPath !==
        response.sourcePath.slice(`backfill/${phase}/`.length)
    ) {
      throw new Error('resume parent lineage v1 response contract is invalid');
    }
  }
  return document;
}

export function validateNgaVectorSettlementIncidentV1(
  incident,
  {
    sourceGitSha,
    expectedVectorCount,
    vectorResponse,
    immediateState,
    settledState,
    immediateOutcome,
    settledOutcome,
  }
) {
  const mutation = incident?.stagingMutation;
  const immediate = incident?.immediateCapture;
  const settled = incident?.settledDiagnostic;
  const boundaries = incident?.boundaries;
  const stateVector = (state) =>
    Array.isArray(state?.inputs?.imageVectors) &&
    state.inputs.imageVectors.length === 1
      ? state.inputs.imageVectors[0]
      : null;
  const immediateVector = stateVector(immediateState);
  const settledVector = stateVector(settledState);
  const immediateTime = Date.parse(String(immediateState?.capturedAt || ''));
  const settledTime = Date.parse(String(settledState?.capturedAt || ''));
  const recordedTime = Date.parse(String(incident?.recordedAt || ''));
  if (
    !incident ||
    typeof incident !== 'object' ||
    Array.isArray(incident) ||
    Object.keys(incident).sort().join(',') !==
      'boundaries,gitSha,immediateCapture,recordedAt,schemaVersion,settledDiagnostic,stagingMutation,status' ||
    incident.schemaVersion !== 'nga-vector-settlement-incident-v1' ||
    incident.gitSha !== sourceGitSha ||
    incident.status !==
      'paused-after-single-vector-upsert-before-official-verification' ||
    !isUtcTimestamp(incident.recordedAt) ||
    Object.keys(mutation || {}).sort().join(',') !==
      'd1CommandsExecutedThisResume,mutationId,rawResponse,vectorCount,vectorUpsertCommandsExecutedThisResume' ||
    mutation.d1CommandsExecutedThisResume !== 0 ||
    mutation.vectorUpsertCommandsExecutedThisResume !== 1 ||
    mutation.vectorCount !== expectedVectorCount ||
    mutation.mutationId !== vectorResponse?.mutationId ||
    canonicalJson(mutation.rawResponse) !==
      canonicalJson({
        path: vectorResponse?.path,
        sha256: vectorResponse?.sha256,
      }) ||
    Object.keys(immediate || {}).sort().join(',') !==
      'interpretation,path,sha256,vectorSha256' ||
    immediate.interpretation !== 'stale pre-upsert vector representation' ||
    Object.keys(settled || {}).sort().join(',') !==
      'd1Sha256,expectedEnrichedVectorSha256,path,recordCount,sha256,vectorSha256' ||
    settled.recordCount !== expectedVectorCount ||
    settled.vectorSha256 !== settled.expectedEnrichedVectorSha256 ||
    Object.keys(boundaries || {}).sort().join(',') !==
      'cachePurged,fullBackfillStarted,nextExternalMutationAllowed,productionChanged' ||
    Object.values(boundaries).some((value) => value !== false) ||
    !immediateState ||
    !settledState ||
    immediateState.counts?.imageVectors !== expectedVectorCount ||
    settledState.counts?.imageVectors !== expectedVectorCount ||
    immediateVector?.sha256 !== immediate.vectorSha256 ||
    settledVector?.sha256 !== settled.vectorSha256 ||
    settledState.inputs?.stagedRecords?.sha256 !== settled.d1Sha256 ||
    immediate.vectorSha256 === settled.expectedEnrichedVectorSha256 ||
    immediateOutcome !== 'pending' ||
    settledOutcome !== 'settled' ||
    !isUtcTimestamp(immediateState.capturedAt) ||
    !isUtcTimestamp(settledState.capturedAt) ||
    !(immediateTime < settledTime && settledTime <= recordedTime)
  ) {
    throw new Error('vector settlement incident lifecycle is invalid');
  }
  return incident;
}

const containsExactRecoveryValue = (value, field, expected) => {
  if (Array.isArray(value)) {
    return value.some((entry) =>
      containsExactRecoveryValue(entry, field, expected)
    );
  }
  if (!value || typeof value !== 'object') return false;
  if (value[field] === expected) return true;
  return Object.values(value).some((entry) =>
    containsExactRecoveryValue(entry, field, expected)
  );
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
      manifest.schemaVersion !== 2 ||
      manifest.captureKind !== 'preflight' ||
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
    const timeTravel = await resolveBoundPreflightFile(
      root,
      manifest.rollback?.d1TimeTravel
    );
    let timeTravelValue;
    try {
      timeTravelValue = JSON.parse(timeTravel.content.toString('utf8'));
    } catch {
      throw new Error('malformed D1 time-travel rollback input');
    }
    const declaredRecovery = manifest.rollback?.recoveryPoint;
    const recoveryFields = ['bookmark', 'timestamp'].filter(
      (field) =>
        typeof declaredRecovery?.[field] === 'string' &&
        Boolean(declaredRecovery[field].trim())
    );
    if (
      !declaredRecovery ||
      typeof declaredRecovery !== 'object' ||
      Array.isArray(declaredRecovery) ||
      recoveryFields.length === 0 ||
      !recoveryFields.every((field) =>
        containsExactRecoveryValue(
          timeTravelValue,
          field,
          declaredRecovery[field]
        )
      )
    ) {
      throw new Error('D1 time-travel rollback recovery point is invalid');
    }
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
      rollback: {
        d1TimeTravel: {
          path: timeTravel.path,
          sha256: timeTravel.sha256,
        },
        recoveryPoint: declaredRecovery,
      },
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

const stagedJsonObject = (value, field, artworkId) => {
  if (value === null || value === undefined || value === '') return {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // The field-specific error below is the stable public contract.
    }
  }
  throw new Error(`malformed staged ${field} for ${artworkId}`);
};

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
  const rollbackD1Records = [];
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
    const stagedCustomMetadata = stagedJsonObject(
      staged.custom_metadata,
      'custom_metadata',
      staged.id
    );
    stagedJsonObject(staged.field_sources, 'field_sources', staged.id);
    if (stagedCustomMetadata.provider !== 'nga') {
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
    rollbackD1Records.push(structuredClone(staged));
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

  return {
    mapping,
    sql,
    rollbackD1Records,
    enrichedVectors,
    rollbackVectors,
    vectorValueHashes,
  };
}

const postApplyJsonObject = (value, field, artworkId) => {
  if (value === null || value === undefined || value === '') return {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return structuredClone(value);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // The field-specific error below is the stable public contract.
    }
  }
  throw new Error(`malformed post-apply ${field} for ${artworkId}`);
};

const exactRowsByArtworkId = (rows, label) => {
  const byId = new Map();
  for (const row of rows || []) {
    const id = String(row?.id || row?.metadata?.artworkId || '');
    if (!/^open-access-art:nga:\d+$/.test(id) || byId.has(id)) {
      throw new Error(`duplicate or invalid ${label} ID ${id}`);
    }
    byId.set(id, row);
  }
  return byId;
};

export function inspectNgaArtistPostApplyState({
  phase,
  mapping,
  originalRecords,
  originalVectors,
  postIds,
  postRecords,
  postVectors,
}) {
  if (!['pilot', 'full'].includes(phase)) {
    throw new Error('post-apply phase must be pilot or full');
  }
  const expectedCount =
    phase === 'pilot' ? PILOT_OBJECT_IDS.length : FULL_STAGED_COUNT;
  const mappingById = exactRowsByArtworkId(mapping, 'mapping');
  const originalById = exactRowsByArtworkId(originalRecords, 'rollback D1');
  const originalVectorsById = exactRowsByArtworkId(
    originalVectors,
    'rollback vector'
  );
  const postById = exactRowsByArtworkId(postRecords, 'post-apply D1');
  const postVectorsById = exactRowsByArtworkId(
    postVectors,
    'post-apply vector'
  );
  if (
    mappingById.size !== expectedCount ||
    originalById.size !== expectedCount
  ) {
    throw new Error(
      `post-apply expected scope is ${expectedCount} records for ${phase}`
    );
  }
  if (postById.size !== expectedCount) {
    throw new Error(
      `post-apply D1 count mismatch: expected ${expectedCount}, got ${postById.size}`
    );
  }
  if (
    originalVectorsById.size !== expectedCount ||
    postVectorsById.size !== expectedCount
  ) {
    throw new Error(
      `post-apply vector count mismatch: expected ${expectedCount}, got ${postVectorsById.size}`
    );
  }
  const expectedIds = new Set(mappingById.keys());
  if (
    !Array.isArray(postIds) ||
    postIds.length !== expectedIds.size ||
    new Set(postIds).size !== expectedIds.size ||
    postIds.some(
      (id) => typeof id !== 'string' || !expectedIds.has(id)
    )
  ) {
    throw new Error('post-apply ID inventory does not exactly match mapping');
  }
  for (const [label, rows] of [
    ['rollback D1', originalById],
    ['rollback vector', originalVectorsById],
    ['post-apply D1', postById],
    ['post-apply vector', postVectorsById],
  ]) {
    if (
      rows.size !== expectedIds.size ||
      [...rows.keys()].some((id) => !expectedIds.has(id))
    ) {
      throw new Error(`${label} ID gap or extra relative to mapping`);
    }
  }

  const orderedIds = [...expectedIds].sort(
    (left, right) =>
      Number(left.split(':').at(-1)) - Number(right.split(':').at(-1))
  );
  let applicationRecordChanges = 0;
  const pendingVectorIds = [];
  for (const id of orderedIds) {
    const desired = mappingById.get(id);
    const original = structuredClone(originalById.get(id));
    const actual = structuredClone(postById.get(id));
    if (String(actual.primary_artist_id || '') !== desired.primaryArtistId) {
      throw new Error(`post-apply primary artist mismatch for ${id}`);
    }
    const originalCustom = postApplyJsonObject(
      original.custom_metadata,
      'custom_metadata',
      id
    );
    const actualCustom = postApplyJsonObject(
      actual.custom_metadata,
      'custom_metadata',
      id
    );
    const originalSources = postApplyJsonObject(
      original.field_sources,
      'field_sources',
      id
    );
    const actualSources = postApplyJsonObject(
      actual.field_sources,
      'field_sources',
      id
    );
    const expectedCustom = {
      ...originalCustom,
      ngaArtists: desired.customMetadata.ngaArtists,
    };
    const expectedSources = {
      ...originalSources,
      primary_artist_id: 'nga.objects_constituents',
    };
    if (
      canonicalJson(actualCustom) !== canonicalJson(expectedCustom) ||
      canonicalJson(actualSources) !== canonicalJson(expectedSources)
    ) {
      throw new Error(`post-apply NGA artist metadata mismatch for ${id}`);
    }
    const originalSemantic = {
      ...original,
      custom_metadata: originalCustom,
      field_sources: originalSources,
    };
    const actualSemantic = {
      ...actual,
      custom_metadata: actualCustom,
      field_sources: actualSources,
    };
    if (
      (phase === 'pilot' ||
        !PILOT_OBJECT_IDS.includes(id.replace(/^open-access-art:nga:/, ''))) &&
      canonicalJson(actualSemantic) !== canonicalJson(originalSemantic)
    ) {
      applicationRecordChanges += 1;
    }
    original.primary_artist_id = desired.primaryArtistId;
    original.custom_metadata = expectedCustom;
    original.field_sources = expectedSources;
    original.updated_at = actual.updated_at;
    actual.custom_metadata = actualCustom;
    actual.field_sources = actualSources;
    if (canonicalJson(actual) !== canonicalJson(original)) {
      throw new Error(`unrelated D1 fields changed for ${id}`);
    }

    const originalVector = originalVectorsById.get(id);
    const expectedVector = structuredClone(originalVector);
    expectedVector.metadata = {
      ...(expectedVector.metadata || {}),
      primaryArtistId: desired.primaryArtistId,
    };
    const actualVectorJson = canonicalJson(postVectorsById.get(id));
    if (actualVectorJson === canonicalJson(expectedVector)) {
      continue;
    }
    if (actualVectorJson === canonicalJson(originalVector)) {
      pendingVectorIds.push(id);
    } else {
      throw new Error(
        `post-apply vector changed beyond primaryArtistId for ${id}`
      );
    }
  }

  const expectedApplicationRecordChanges =
    phase === 'pilot'
      ? PILOT_OBJECT_IDS.length
      : FULL_STAGED_COUNT - PILOT_OBJECT_IDS.length;
  if (applicationRecordChanges !== expectedApplicationRecordChanges) {
    throw new Error(
      `post-apply application-record change count mismatch: expected ${expectedApplicationRecordChanges}, got ${applicationRecordChanges}`
    );
  }

  if (pendingVectorIds.length) {
    return {
      outcome: 'pending',
      pendingVectorCount: pendingVectorIds.length,
      pendingVectorIdsSha256: sha256(canonicalJson(pendingVectorIds)),
    };
  }

  const orderedPostRecords = orderedIds.map((id) => postById.get(id));
  const orderedPostVectors = orderedIds.map((id) => postVectorsById.get(id));
  return {
    outcome: 'settled',
    summary: {
      phase,
      recordCount: expectedCount,
      vectorCount: expectedCount,
      applicationRecordChanges,
      unrelatedFieldsUnchanged: true,
      vectorValuesUnchanged: true,
      idempotentD1State: true,
      postRecordsSha256: sha256(canonicalJson(orderedPostRecords)),
      postVectorsSha256: sha256(canonicalJson(orderedPostVectors)),
    },
  };
}

export function verifyNgaArtistPostApplyState(input) {
  const result = inspectNgaArtistPostApplyState(input);
  if (result.outcome !== 'settled') {
    throw new Error(
      `post-apply vector settlement pending for ${result.pendingVectorCount} records`
    );
  }
  return result.summary;
}
