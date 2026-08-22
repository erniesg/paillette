#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  FULL_STAGED_COUNT,
  NGA_SOURCE_COMMIT,
  PILOT_OBJECT_IDS,
  STAGING_D1_DATABASE,
  STAGING_IMAGE_VECTOR_INDEX,
  STAGING_ORG_ID,
  canonicalJson,
  verifyNgaArtistPostApplyState,
} from './lib/nga-artist-backfill.mjs';
import { buildNgaArtistUpdateSql } from './lib/nga-structured-search-backfill.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const args = new Map();
for (const argument of process.argv.slice(2)) {
  if (!argument.startsWith('--'))
    throw new Error(`unexpected argument ${argument}`);
  const [key, ...rest] = argument.slice(2).split('=');
  args.set(key, rest.length ? rest.join('=') : true);
}

const allowedOptions = new Set([
  'environment',
  'phase',
  'manifest',
  'confirm-manifest-sha256',
  'execute',
  'd1-database',
  'image-vector-index',
  'post-apply-out-dir',
]);
for (const key of args.keys()) {
  if (!allowedOptions.has(key)) throw new Error(`unsupported option --${key}`);
}
if (args.has('execute') && args.get('execute') !== true) {
  throw new Error('--execute is a flag and does not accept a value');
}

const environment = String(args.get('environment') || '');
const phase = String(args.get('phase') || '');
const d1Database = String(args.get('d1-database') || STAGING_D1_DATABASE);
const imageVectorIndex = String(
  args.get('image-vector-index') || STAGING_IMAGE_VECTOR_INDEX
);
const postApplyOutDirectoryValue = args.get('post-apply-out-dir');
if (environment !== 'staging') {
  throw new Error(
    'only --environment=staging is allowed; production is forbidden'
  );
}
if (!['pilot', 'full'].includes(phase)) {
  throw new Error('--phase must be pilot or full');
}
if (d1Database !== STAGING_D1_DATABASE) {
  throw new Error(`only staging D1 database ${STAGING_D1_DATABASE} is allowed`);
}
if (imageVectorIndex !== STAGING_IMAGE_VECTOR_INDEX) {
  throw new Error(
    `only staging image-vector index ${STAGING_IMAGE_VECTOR_INDEX} is allowed`
  );
}
if (args.has('execute')) {
  if (!postApplyOutDirectoryValue || postApplyOutDirectoryValue === true) {
    throw new Error('--post-apply-out-dir is required with --execute');
  }
  if (
    /(?:^|[\\/_.-])production(?:[\\/_.-]|$)/i.test(
      String(postApplyOutDirectoryValue)
    )
  ) {
    throw new Error('production-named post-apply evidence is forbidden');
  }
  const existingPostApply = statSync(resolve(String(postApplyOutDirectoryValue)), {
    throwIfNoEntry: false,
  });
  if (existingPostApply && readdirSync(resolve(String(postApplyOutDirectoryValue))).length) {
    throw new Error('--post-apply-out-dir must be empty before execution');
  }
}

const manifestArgument = args.get('manifest');
const confirmation = args.get('confirm-manifest-sha256');
if (!manifestArgument || manifestArgument === true)
  throw new Error('--manifest is required');
if (!confirmation || confirmation === true) {
  throw new Error('--confirm-manifest-sha256 is required');
}
if (!/^[a-f0-9]{64}$/.test(String(confirmation))) {
  throw new Error(
    '--confirm-manifest-sha256 must be a lowercase SHA-256 digest'
  );
}
if (/(?:^|[\\/_.-])production(?:[\\/_.-]|$)/i.test(String(manifestArgument))) {
  throw new Error('production-named manifests are forbidden');
}

const manifestPath = realpathSync(resolve(String(manifestArgument)));
const manifestText = readFileSync(manifestPath);
const actualManifestSha256 = sha256(manifestText);
if (actualManifestSha256 !== confirmation) {
  throw new Error(
    `manifest SHA-256 mismatch: expected ${confirmation}, got ${actualManifestSha256}`
  );
}
const manifest = JSON.parse(manifestText.toString('utf8'));
if (manifest.environment !== environment || manifest.phase !== phase) {
  throw new Error(
    'manifest environment/phase does not match the requested staging scope'
  );
}
if (manifest.expectedOrgId !== STAGING_ORG_ID) {
  throw new Error('manifest organization does not match the staging allowlist');
}
if (
  manifest.source?.commit !== NGA_SOURCE_COMMIT ||
  !/^[a-f0-9]{64}$/.test(String(manifest.source?.manifestSha256 || ''))
) {
  throw new Error('manifest source is not bound to the pinned NGA snapshot');
}
const preflightInputs = manifest.preflightInputs;
if (!Array.isArray(preflightInputs) || !preflightInputs.length) {
  throw new Error('manifest preflightInputs must be hash-bound');
}
const preflightPhases = [];
let preflightRecordCount = 0;
for (const binding of preflightInputs) {
  const vectorCount = Array.isArray(binding?.imageVectors)
    ? binding.imageVectors.reduce(
        (total, entry) => total + Number(entry?.count || 0),
        0
      )
    : -1;
  if (
    !/^[a-f0-9]{64}$/.test(String(binding?.manifestSha256 || '')) ||
    !['pilot', 'full'].includes(binding?.phase) ||
    binding?.expectedOrgId !== STAGING_ORG_ID ||
    binding?.resources?.d1Database !== STAGING_D1_DATABASE ||
    binding?.resources?.imageVectorIndex !== STAGING_IMAGE_VECTOR_INDEX ||
    !Array.isArray(binding?.imageVectors) ||
    binding?.rollback?.d1TimeTravel?.path !== 'd1-time-travel.json' ||
    !/^[a-f0-9]{64}$/.test(
      String(binding?.rollback?.d1TimeTravel?.sha256 || '')
    ) ||
    !['bookmark', 'timestamp'].some(
      (field) =>
        typeof binding?.rollback?.recoveryPoint?.[field] === 'string' &&
        Boolean(binding.rollback.recoveryPoint[field].trim())
    ) ||
    !/^[a-f0-9]{64}$/.test(String(binding?.ids?.sha256 || '')) ||
    !/^[a-f0-9]{64}$/.test(String(binding?.stagedRecords?.sha256 || '')) ||
    binding?.counts?.ids !== binding?.ids?.count ||
    binding?.counts?.stagedRecords !== binding?.stagedRecords?.count ||
    binding?.counts?.imageVectors !== vectorCount ||
    binding?.counts?.ids !== binding?.counts?.stagedRecords ||
    binding?.counts?.ids !== binding?.counts?.imageVectors ||
    binding.imageVectors.some(
      (entry) => !/^[a-f0-9]{64}$/.test(String(entry?.sha256 || ''))
    )
  ) {
    throw new Error(
      'manifest contains an invalid preflight input or rollback binding'
    );
  }
  preflightPhases.push(binding.phase);
  preflightRecordCount += binding.counts.stagedRecords;
}
const requiredPreflightPhases = phase === 'pilot' ? 'pilot' : 'full,pilot';
if (
  preflightPhases.sort().join(',') !== requiredPreflightPhases ||
  preflightRecordCount !==
    (phase === 'pilot' ? PILOT_OBJECT_IDS.length : FULL_STAGED_COUNT)
) {
  throw new Error(`preflight inputs do not form the exact ${phase} scope`);
}
if (
  manifest.resources?.d1Database !== d1Database ||
  manifest.resources?.imageVectorIndex !== imageVectorIndex
) {
  throw new Error(
    'manifest resource identity does not match the staging allowlist'
  );
}
if (
  !Array.isArray(manifest.orderedArtifacts) ||
  !manifest.orderedArtifacts.length
) {
  throw new Error('manifest orderedArtifacts must be a non-empty array');
}

const artifactRoot = realpathSync(dirname(manifestPath));
const resolveManifestFile = (artifact) => {
  if (
    typeof artifact?.path !== 'string' ||
    !artifact.path ||
    isAbsolute(artifact.path) ||
    artifact.path.split(/[\\/]/).includes('..')
  ) {
    throw new Error('manifest path escapes the artifact root');
  }
  if (/(?:^|[\\/_.-])production(?:[\\/_.-]|$)/i.test(artifact.path)) {
    throw new Error('production-named artifacts are forbidden');
  }
  const resolvedPath = realpathSync(resolve(artifactRoot, artifact.path));
  if (
    resolvedPath !== artifactRoot &&
    !resolvedPath.startsWith(`${artifactRoot}${sep}`)
  ) {
    throw new Error('manifest path escapes the artifact root');
  }
  const digest = sha256(readFileSync(resolvedPath));
  if (digest !== artifact.sha256) {
    throw new Error(
      `artifact SHA-256 mismatch for ${artifact.path}: expected ${artifact.sha256}, got ${digest}`
    );
  }
  return { ...artifact, resolvedPath };
};

if (!Array.isArray(manifest.files) || !manifest.files.length) {
  throw new Error('manifest files must bind every prepared artifact');
}
const declaredFiles = new Map();
for (const artifact of manifest.files) {
  if (declaredFiles.has(artifact?.path)) {
    throw new Error(`duplicate manifest file ${artifact?.path}`);
  }
  declaredFiles.set(artifact.path, resolveManifestFile(artifact));
}
if (
  declaredFiles.get('source-manifest.json')?.sha256 !==
  manifest.source.manifestSha256
) {
  throw new Error('source manifest digest is not bound into manifest files');
}

const parseDeclaredJson = (path) => {
  const artifact = declaredFiles.get(path);
  if (!artifact) throw new Error(`manifest is missing ${path}`);
  try {
    return JSON.parse(readFileSync(artifact.resolvedPath, 'utf8'));
  } catch {
    throw new Error(`malformed JSON artifact ${path}`);
  }
};
const mapping = parseDeclaredJson('mapping.json');
if (!Array.isArray(mapping))
  throw new Error('mapping.json must contain an array');
const expectedRecordCount =
  phase === 'pilot' ? PILOT_OBJECT_IDS.length : FULL_STAGED_COUNT;
if (mapping.length !== expectedRecordCount) {
  throw new Error(`mapping count must be exactly ${expectedRecordCount}`);
}
const mappingById = new Map();
for (const row of mapping) {
  if (!/^open-access-art:nga:\d+$/.test(String(row?.id || ''))) {
    throw new Error(`invalid mapping ID ${row?.id}`);
  }
  if (!/^\d+$/.test(String(row?.primaryArtistId || ''))) {
    throw new Error(`invalid primary artist for ${row.id}`);
  }
  if (mappingById.has(row.id))
    throw new Error(`duplicate mapping ID ${row.id}`);
  mappingById.set(row.id, row);
}
if (
  phase === 'pilot' &&
  (PILOT_OBJECT_IDS.some(
    (id) => !mappingById.has(`open-access-art:nga:${id}`)
  ) ||
    [...mappingById].some(
      ([id]) =>
        !PILOT_OBJECT_IDS.includes(id.replace(/^open-access-art:nga:/, ''))
    ))
) {
  throw new Error('mapping differs from the exact pilot allowlist');
}

const rollbackD1Records = parseDeclaredJson('rollback/d1-records.json');
if (!Array.isArray(rollbackD1Records)) {
  throw new Error('D1 rollback source must contain an array');
}
const rollbackD1Artifact = declaredFiles.get('rollback/d1-records.json');
if (
  rollbackD1Records.length !== expectedRecordCount ||
  rollbackD1Artifact?.recordCount !== expectedRecordCount ||
  new Set(rollbackD1Records.map((row) => String(row?.id || ''))).size !==
    expectedRecordCount ||
  rollbackD1Records.some(
    (row) => {
      let customMetadata;
      try {
        customMetadata =
          typeof row?.custom_metadata === 'string'
            ? JSON.parse(row.custom_metadata)
            : row?.custom_metadata;
      } catch {
        return true;
      }
      return (
        !mappingById.has(String(row?.id || '')) ||
        row?.org_id !== STAGING_ORG_ID ||
        customMetadata?.provider !== 'nga' ||
        !Object.prototype.hasOwnProperty.call(row, 'primary_artist_id') ||
        !Object.prototype.hasOwnProperty.call(row, 'custom_metadata') ||
        !Object.prototype.hasOwnProperty.call(row, 'field_sources')
      );
    }
  )
) {
  throw new Error('D1 rollback source is incomplete or outside the exact scope');
}

const splitSqlStatements = (text, path) => {
  const statements = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    current += character;
    if (character === "'") {
      if (quoted && text[index + 1] === "'") {
        current += text[index + 1];
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ';' && !quoted) {
      statements.push(current.trim());
      current = '';
    }
  }
  if (quoted || current.trim()) throw new Error(`malformed SQL chunk ${path}`);
  return statements;
};

const assertExactSqlMutationScope = (statement, mappingRow) => {
  const expectedStatement = buildNgaArtistUpdateSql(mappingRow, STAGING_ORG_ID);
  if (statement !== expectedStatement) {
    throw new Error(
      'SQL mutation scope differs from the exact generated statement'
    );
  }
};

const parseNdjson = (artifact) => {
  const lines = readFileSync(artifact.resolvedPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`malformed NDJSON at ${artifact.path}:${index + 1}`);
    }
  });
};

const assertExactIds = (label, ids) => {
  const unique = new Set(ids);
  if (unique.size !== ids.length) throw new Error(`duplicate ${label} ID`);
  if (
    ids.length !== mappingById.size ||
    [...mappingById.keys()].some((id) => !unique.has(id))
  ) {
    throw new Error(`${label} ID gap or extra relative to mapping`);
  }
};

const kindOrder = new Map([
  ['d1-sql', 0],
  ['image-vectors', 1],
]);
let previousKind = -1;
let previousPath = '';
const resolvedArtifacts = manifest.orderedArtifacts.map((artifact) => {
  if (!kindOrder.has(artifact?.kind)) {
    throw new Error(`unsupported artifact kind ${artifact?.kind}`);
  }
  if (
    typeof artifact.path !== 'string' ||
    !artifact.path ||
    isAbsolute(artifact.path) ||
    artifact.path.split(/[\\/]/).includes('..')
  ) {
    throw new Error('manifest path escapes the artifact root');
  }
  if (
    !Number.isInteger(artifact.recordCount) ||
    artifact.recordCount < 1 ||
    artifact.recordCount > 500
  ) {
    throw new Error(`invalid manifest record count for ${artifact.path}`);
  }
  const declared = declaredFiles.get(artifact.path);
  if (
    !declared ||
    declared.sha256 !== artifact.sha256 ||
    declared.recordCount !== artifact.recordCount
  ) {
    throw new Error(
      `ordered artifact is not hash-bound in files: ${artifact.path}`
    );
  }
  const currentKind = kindOrder.get(artifact.kind);
  if (
    currentKind < previousKind ||
    (currentKind === previousKind && artifact.path <= previousPath)
  ) {
    throw new Error('manifest chunks are unordered; D1 must precede vectors');
  }
  previousKind = currentKind;
  previousPath = artifact.path;
  return { ...artifact, resolvedPath: declared.resolvedPath };
});
const sqlIds = [];
const expectedD1ChangesByPath = new Map();
const enrichedIds = [];
const enrichedById = new Map();
for (const artifact of resolvedArtifacts) {
  if (artifact.kind === 'd1-sql') {
    const statements = splitSqlStatements(
      readFileSync(artifact.resolvedPath, 'utf8'),
      artifact.path
    );
    if (statements.length !== artifact.recordCount) {
      throw new Error(
        `SQL statement count mismatch for ${artifact.path}: declared ${artifact.recordCount}, actual ${statements.length}`
      );
    }
    const artifactIds = [];
    for (const statement of statements) {
      const matches = [
        ...statement.matchAll(/^\s*AND id = '([^']+)'\s*;?\s*$/gm),
      ];
      if (matches.length !== 1)
        throw new Error(`SQL chunk has no exact scoped ID`);
      const mappingRow = mappingById.get(matches[0][1]);
      if (!mappingRow)
        throw new Error('SQL mutation scope has an unapproved ID');
      assertExactSqlMutationScope(statement, mappingRow);
      sqlIds.push(matches[0][1]);
      artifactIds.push(matches[0][1]);
    }
    expectedD1ChangesByPath.set(
      artifact.path,
      phase === 'pilot'
        ? artifactIds.length
        : artifactIds.filter(
            (id) =>
              !PILOT_OBJECT_IDS.includes(
                id.replace(/^open-access-art:nga:/, '')
              )
          ).length
    );
  } else {
    const rows = parseNdjson(artifact);
    if (rows.length !== artifact.recordCount) {
      throw new Error(
        `enriched vector count mismatch for ${artifact.path}: declared ${artifact.recordCount}, actual ${rows.length}`
      );
    }
    for (const row of rows) {
      const id = String(row?.id || '');
      if (row?.metadata?.artworkId !== id) {
        throw new Error(`enriched vector artwork ID mismatch for ${id}`);
      }
      if (
        String(row?.metadata?.primaryArtistId || '') !==
        String(mappingById.get(id)?.primaryArtistId || '')
      ) {
        throw new Error(`enriched vector primary artist mismatch for ${id}`);
      }
      enrichedIds.push(id);
      enrichedById.set(id, row);
    }
  }
}
assertExactIds('SQL', sqlIds);
assertExactIds('enriched vector', enrichedIds);

const rollbackArtifacts = [...declaredFiles.values()]
  .filter(
    (artifact) =>
      artifact.path.startsWith('rollback/') && artifact.path.endsWith('.ndjson')
  )
  .sort((left, right) => left.path.localeCompare(right.path));
const rollbackIds = [];
const rollbackById = new Map();
for (const artifact of rollbackArtifacts) {
  const rows = parseNdjson(artifact);
  if (
    !Number.isInteger(artifact.recordCount) ||
    artifact.recordCount < 1 ||
    artifact.recordCount > 500 ||
    rows.length !== artifact.recordCount
  ) {
    throw new Error(`rollback vector count mismatch for ${artifact.path}`);
  }
  for (const row of rows) {
    const id = String(row?.id || '');
    if (row?.metadata?.artworkId !== id) {
      throw new Error(`rollback vector artwork ID mismatch for ${id}`);
    }
    rollbackIds.push(id);
    rollbackById.set(id, row);
  }
}
assertExactIds('rollback vector', rollbackIds);

const valueHashes = parseDeclaredJson('vector-value-hashes.json');
if (!Array.isArray(valueHashes)) {
  throw new Error('vector-value-hashes.json must contain an array');
}
assertExactIds(
  'vector value hash',
  valueHashes.map((row) => row.id)
);
for (const row of valueHashes) {
  const original = rollbackById.get(row.id);
  const enriched = enrichedById.get(row.id);
  const originalDigest = sha256(canonicalJson(original?.values));
  const enrichedDigest = sha256(canonicalJson(enriched?.values));
  if (
    row.originalSha256 !== originalDigest ||
    row.enrichedSha256 !== enrichedDigest ||
    originalDigest !== enrichedDigest
  ) {
    throw new Error(`vector value hash mismatch for ${row.id}`);
  }
  const expectedEnriched = structuredClone(original);
  expectedEnriched.metadata = {
    ...(expectedEnriched.metadata || {}),
    primaryArtistId: String(mappingById.get(row.id).primaryArtistId),
  };
  if (canonicalJson(enriched) !== canonicalJson(expectedEnriched)) {
    throw new Error(
      `enriched vector structure changed beyond metadata.primaryArtistId for ${row.id}`
    );
  }
}

const d1RecordCount = resolvedArtifacts
  .filter((artifact) => artifact.kind === 'd1-sql')
  .reduce((total, artifact) => total + Number(artifact.recordCount || 0), 0);
const vectorRecordCount = resolvedArtifacts
  .filter((artifact) => artifact.kind === 'image-vectors')
  .reduce((total, artifact) => total + Number(artifact.recordCount || 0), 0);
if (
  manifest.invariants?.stagedRecordCount !== expectedRecordCount ||
  manifest.invariants?.mappingCount !== expectedRecordCount ||
  manifest.invariants?.expectedD1Changes !==
    (phase === 'pilot'
      ? PILOT_OBJECT_IDS.length
      : FULL_STAGED_COUNT - PILOT_OBJECT_IDS.length) ||
  manifest.invariants?.imageVectorCount !== expectedRecordCount ||
  manifest.invariants?.rollbackD1RecordCount !== expectedRecordCount ||
  manifest.invariants?.rollbackVectorCount !== expectedRecordCount ||
  manifest.invariants?.vectorValuesUnchanged !== true ||
  manifest.invariants?.captionVectorsChanged !== 0 ||
  d1RecordCount !== expectedRecordCount ||
  vectorRecordCount !== expectedRecordCount
) {
  throw new Error(
    `manifest does not contain a complete ${phase} mutation plan with matching D1 and vector counts`
  );
}

const steps = resolvedArtifacts.map((artifact, index) => ({
  sequence: index + 1,
  kind: artifact.kind,
  path: relative(artifactRoot, artifact.resolvedPath),
  sha256: artifact.sha256,
  ...(artifact.kind === 'd1-sql'
    ? { expectedChanges: expectedD1ChangesByPath.get(artifact.path) }
    : {}),
  command:
    artifact.kind === 'd1-sql'
      ? [
          'pnpm',
          '--dir',
          'apps/api',
          'exec',
          'wrangler',
          'd1',
          'execute',
          d1Database,
          '--env',
          'staging',
          '--remote',
          '--file',
          artifact.resolvedPath,
          '--json',
          '--yes',
        ]
      : [
          'pnpm',
          '--dir',
          'apps/api',
          'exec',
          'wrangler',
          'vectorize',
          'upsert',
          imageVectorIndex,
          '--env',
          'staging',
          '--file',
          artifact.resolvedPath,
          '--json',
        ],
}));

const d1ChangesFromResponse = (stdout, path) => {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error(`D1 apply response is not JSON for ${path}`);
  }
  const changes = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(value, 'meta')) {
      const count = value.meta?.changes;
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`D1 apply response has invalid changes for ${path}`);
      }
      changes.push(count);
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(payload);
  if (!changes.length) {
    throw new Error(`D1 apply response has no changes count for ${path}`);
  }
  return changes.reduce((total, count) => total + count, 0);
};

if (!args.has('execute')) {
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: 'dry-run',
        environment,
        phase,
        manifest: manifestPath,
        manifestSha256: actualManifestSha256,
        steps,
      },
      null,
      2
    )}\n`
  );
} else {
  const responseDirectory = join(
    artifactRoot,
    'apply-responses',
    `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`
  );
  mkdirSync(responseDirectory, { recursive: true });
  const responses = [];
  const responseEvidence = [];
  for (const step of steps) {
    const currentDigest = sha256(
      readFileSync(resolve(artifactRoot, step.path))
    );
    if (currentDigest !== step.sha256) {
      throw new Error(
        `artifact SHA-256 changed before execution: ${step.path}`
      );
    }
    const [command, ...commandArgs] = step.command;
    const result = spawnSync(command, commandArgs, { encoding: 'utf8' });
    const response = {
      sequence: step.sequence,
      kind: step.kind,
      path: step.path,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    const responsePath = join(
      responseDirectory,
      `${String(step.sequence).padStart(4, '0')}.json`
    );
    const responseText = `${JSON.stringify(response, null, 2)}\n`;
    writeFileSync(responsePath, responseText, {
      flag: 'wx',
    });
    responses.push(response);
    if (result.status !== 0) {
      throw new Error(
        `serial apply failed at ${step.path}; see ${responsePath}`
      );
    }
    const actualChanges =
      step.kind === 'd1-sql'
        ? d1ChangesFromResponse(result.stdout, step.path)
        : undefined;
    if (step.kind === 'd1-sql') {
      if (actualChanges !== step.expectedChanges) {
        throw new Error(
          `D1 changes mismatch for ${step.path}: expected ${step.expectedChanges}, got ${actualChanges}; see ${responsePath}`
        );
      }
    }
    responseEvidence.push({ step, responseText, actualChanges });
  }

  const postApplyOutDirectory = resolve(String(postApplyOutDirectoryValue));
  const captureScript = fileURLToPath(
    new URL('./capture-nga-artist-backfill-preflight.mjs', import.meta.url)
  );
  const capture = spawnSync(
    process.execPath,
    [
      captureScript,
      '--environment=staging',
      `--phase=${phase}`,
      '--capture-kind=post-apply',
      `--out-dir=${postApplyOutDirectory}`,
    ],
    { encoding: 'utf8' }
  );
  if (capture.status !== 0) {
    throw new Error(
      `post-apply state capture failed: ${capture.stderr || capture.stdout}`
    );
  }
  const postApplyRoot = realpathSync(postApplyOutDirectory);
  const stateManifestPath = join(postApplyRoot, 'state-manifest.json');
  const stateManifestText = readFileSync(stateManifestPath);
  const stateManifest = JSON.parse(stateManifestText.toString('utf8'));
  const resolveStateFile = (descriptor) => {
    if (
      typeof descriptor?.path !== 'string' ||
      !descriptor.path ||
      isAbsolute(descriptor.path) ||
      descriptor.path.split(/[\\/]/).includes('..') ||
      !/^[a-f0-9]{64}$/.test(String(descriptor.sha256 || ''))
    ) {
      throw new Error('post-apply state manifest contains an invalid path');
    }
    const path = realpathSync(resolve(postApplyRoot, descriptor.path));
    if (path !== postApplyRoot && !path.startsWith(`${postApplyRoot}${sep}`)) {
      throw new Error('post-apply state path escapes its evidence root');
    }
    const content = readFileSync(path);
    if (sha256(content) !== descriptor.sha256) {
      throw new Error(
        `post-apply state SHA-256 mismatch for ${descriptor.path}`
      );
    }
    return content;
  };
  if (
    stateManifest.schemaVersion !== 2 ||
    stateManifest.captureKind !== 'post-apply' ||
    stateManifest.environment !== 'staging' ||
    stateManifest.phase !== phase ||
    stateManifest.expectedOrgId !== STAGING_ORG_ID ||
    canonicalJson(stateManifest.resources) !==
      canonicalJson({ d1Database, imageVectorIndex }) ||
    stateManifest.counts?.ids !== expectedRecordCount ||
    stateManifest.counts?.stagedRecords !== expectedRecordCount ||
    stateManifest.counts?.imageVectors !== expectedRecordCount
  ) {
    throw new Error('post-apply state manifest identity or counts mismatch');
  }
  resolveStateFile(stateManifest.inputs?.ids);
  const postRecords = JSON.parse(
    resolveStateFile(stateManifest.inputs?.stagedRecords).toString('utf8')
  );
  const postVectors = (stateManifest.inputs?.imageVectors || []).flatMap(
    (descriptor) =>
      resolveStateFile(descriptor)
        .toString('utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
  );
  const summary = verifyNgaArtistPostApplyState({
    phase,
    mapping,
    originalRecords: rollbackD1Records,
    originalVectors: [...rollbackById.values()],
    postRecords,
    postVectors,
  });
  const boundResponseDirectory = join(postApplyRoot, 'apply-responses');
  mkdirSync(boundResponseDirectory, { recursive: false });
  const applyResponses = responseEvidence.map(
    ({ step, responseText, actualChanges }) => {
      const path = `apply-responses/${String(step.sequence).padStart(4, '0')}.json`;
      writeFileSync(join(postApplyRoot, path), responseText, { flag: 'wx' });
      return {
        sequence: step.sequence,
        kind: step.kind,
        path,
        artifactPath: step.path,
        sha256: sha256(responseText),
        ...(step.kind === 'd1-sql'
          ? {
              expectedChanges: step.expectedChanges,
              actualChanges,
            }
          : {}),
      };
    }
  );
  const d1Responses = applyResponses.filter(
    (response) => response.kind === 'd1-sql'
  );
  const applySummary = {
    responseCount: applyResponses.length,
    d1ChunkCount: d1Responses.length,
    expectedD1Changes: d1Responses.reduce(
      (total, response) => total + response.expectedChanges,
      0
    ),
    actualD1Changes: d1Responses.reduce(
      (total, response) => total + response.actualChanges,
      0
    ),
  };
  const verification = {
    schemaVersion: 'nga-post-apply-verification-v2',
    verifiedAt: new Date().toISOString(),
    environment,
    phase,
    artifactManifestSha256: actualManifestSha256,
    stateManifest: {
      path: 'state-manifest.json',
      sha256: sha256(stateManifestText),
    },
    preflightInputs,
    applyResponses,
    applySummary,
    summary,
  };
  const verificationText = `${JSON.stringify(verification, null, 2)}\n`;
  writeFileSync(join(postApplyRoot, 'verification.json'), verificationText, {
    flag: 'wx',
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: 'execute',
        environment,
        phase,
        manifestSha256: actualManifestSha256,
        postApplyVerification: {
          path: join(postApplyRoot, 'verification.json'),
          sha256: sha256(verificationText),
        },
        responses,
      },
      null,
      2
    )}\n`
  );
}
