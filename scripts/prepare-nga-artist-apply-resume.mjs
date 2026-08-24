#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  STAGING_IMAGE_VECTOR_INDEX,
  inspectNgaArtistPostApplyState,
  isSafeRelativeEvidencePath,
  parseNgaD1ApplyFacts,
  parseNgaVectorUpsertFacts,
  validateNgaApplyResumeLineageV1,
  validateNgaVectorSettlementIncidentV1,
} from './lib/nga-artist-backfill.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const values = new Map();
for (const argument of process.argv.slice(2)) {
  if (!argument.startsWith('--') || !argument.includes('=')) {
    throw new Error(`unexpected argument ${argument}`);
  }
  const [key, ...rest] = argument.slice(2).split('=');
  const current = values.get(key) || [];
  current.push(rest.join('='));
  values.set(key, current);
}
const allowed = new Set([
  'phase',
  'manifest',
  'confirm-manifest-sha256',
  'source-evidence-root',
  'response',
  'confirm-response-sha256',
  'parent-lineage',
  'confirm-parent-lineage-sha256',
  'incident',
  'confirm-incident-sha256',
  'out-dir',
]);
for (const key of values.keys()) {
  if (!allowed.has(key)) throw new Error(`unsupported option --${key}`);
}
const one = (key, required = true) => {
  const entries = values.get(key) || [];
  if (entries.length !== (required ? 1 : Math.min(entries.length, 1))) {
    throw new Error(`--${key} must be supplied exactly once`);
  }
  return entries[0];
};
const phase = one('phase');
if (!['pilot', 'full'].includes(phase)) {
  throw new Error('--phase must be pilot or full');
}
const manifestArgument = resolve(one('manifest'));
const manifestRequestRoot = dirname(manifestArgument);
const manifestPath = realpathSync(manifestArgument);
const manifestBytes = readFileSync(manifestPath);
const manifestSha256 = sha256(manifestBytes);
if (manifestSha256 !== one('confirm-manifest-sha256')) {
  throw new Error('manifest SHA-256 confirmation mismatch');
}
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.environment !== 'staging' || manifest.phase !== phase) {
  throw new Error('manifest is outside the requested staging phase');
}
const artifactRoot = realpathSync(dirname(manifestPath));

const sourceRootArgument = resolve(one('source-evidence-root'));
if (lstatSync(sourceRootArgument).isSymbolicLink()) {
  throw new Error('source evidence root must not be a symlink');
}
const sourceRoot = realpathSync(sourceRootArgument);
const sourceParts = sourceRoot.split(sep);
const ngaIndex = sourceParts.findIndex(
  (part, index) =>
    part === '.agent' &&
    sourceParts[index + 1] === 'evidence' &&
    sourceParts[index + 2] === 'nga-staging'
);
const sourceGitSha = sourceParts[ngaIndex + 3];
const sourceTimestamp = sourceParts[ngaIndex + 4];
if (
  ngaIndex < 0 ||
  ngaIndex + 5 !== sourceParts.length ||
  !/^[a-f0-9]{40}$/.test(String(sourceGitSha || '')) ||
  !/^\d{8}T\d{6}Z$/.test(String(sourceTimestamp || ''))
) {
  throw new Error('source evidence root lacks an exact git/timestamp identity');
}
const sourceEvidenceRoot = `.agent/evidence/nga-staging/${sourceGitSha}/${sourceTimestamp}`;

const resolveSource = (pathValue, label, expectedKind = 'file') => {
  if (
    typeof pathValue !== 'string' ||
    !pathValue ||
    isAbsolute(pathValue) ||
    pathValue.split(/[\\/]/).includes('..') ||
    /(?:^|[\/_.-])production(?:[\/_.-]|$)/i.test(pathValue)
  ) {
    throw new Error(`${label} path is unsafe`);
  }
  let current = sourceRoot;
  for (const component of pathValue.split(/[\\/]/)) {
    current = join(current, component);
    const info = lstatSync(current);
    if (info.isSymbolicLink()) throw new Error(`${label} path contains a symlink`);
  }
  const path = realpathSync(resolve(sourceRoot, pathValue));
  const info = statSync(path);
  if (
    !path.startsWith(`${sourceRoot}${sep}`) ||
    (expectedKind === 'file' ? !info.isFile() : !info.isDirectory())
  ) {
    throw new Error(`${label} escapes the source evidence root`);
  }
  return path;
};

const outArgument = resolve(one('out-dir'));
if (statSync(outArgument, { throwIfNoEntry: false })) {
  throw new Error('--out-dir must not exist');
}
const outParent = realpathSync(dirname(outArgument));
if (
  outParent !== artifactRoot &&
  !outParent.startsWith(`${artifactRoot}${sep}`)
) {
  throw new Error('--out-dir must be under the manifest artifact root');
}
mkdirSync(outArgument);
const outRoot = realpathSync(outArgument);
mkdirSync(join(outRoot, 'responses'));
mkdirSync(join(outRoot, 'provenance'));
mkdirSync(join(outRoot, 'provenance', 'parent-lineages'));

const sourceManifest = resolveSource(
  `backfill/${phase}/artifact-manifest.json`,
  'source artifact manifest'
);
if (sha256(readFileSync(sourceManifest)) !== manifestSha256) {
  throw new Error('source and target artifact manifests differ');
}
const preflightManifests = manifest.preflightInputs.map((binding) => ({
  phase: binding.phase,
  sourcePath:
    binding.phase === 'pilot'
      ? 'preflight/pilot/preflight-manifest.json'
      : 'preflight/full-remaining/preflight-manifest.json',
  sha256: binding.manifestSha256,
}));
for (const descriptor of preflightManifests) {
  const path = resolveSource(descriptor.sourcePath, 'source preflight manifest');
  if (sha256(readFileSync(path)) !== descriptor.sha256) {
    throw new Error('source preflight manifest SHA-256 mismatch');
  }
}

const readManifestFile = (relativePath) => {
  const descriptor = manifest.files?.find((entry) => entry?.path === relativePath);
  if (
    !descriptor ||
    !isSafeRelativeEvidencePath(relativePath) ||
    !/^[a-f0-9]{64}$/.test(String(descriptor.sha256 || ''))
  ) {
    throw new Error(`manifest support artifact is invalid: ${relativePath}`);
  }
  const path = realpathSync(resolve(artifactRoot, relativePath));
  if (!path.startsWith(`${artifactRoot}${sep}`)) {
    throw new Error(`manifest support artifact escapes its root: ${relativePath}`);
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== descriptor.sha256) {
    throw new Error(`manifest support artifact SHA-256 mismatch: ${relativePath}`);
  }
  return bytes;
};
const mapping = JSON.parse(readManifestFile('mapping.json').toString('utf8'));
const rollbackD1Records = JSON.parse(
  readManifestFile('rollback/d1-records.json').toString('utf8')
);
const rollbackVectors = (manifest.files || [])
  .filter(
    (entry) =>
      typeof entry?.path === 'string' &&
      entry.path.startsWith('rollback/') &&
      entry.path.endsWith('.ndjson')
  )
  .sort((left, right) => left.path.localeCompare(right.path))
  .flatMap((entry) =>
    readManifestFile(entry.path)
      .toString('utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  );

const parentPaths = values.get('parent-lineage') || [];
const parentHashes = values.get('confirm-parent-lineage-sha256') || [];
if (parentPaths.length !== parentHashes.length) {
  throw new Error('parent lineage paths and confirmations must be paired');
}
const parentDocuments = [];
const parentLineages = parentPaths.map((sourcePath, index) => {
  const source = resolveSource(sourcePath, 'parent lineage');
  const bytes = readFileSync(source);
  if (sha256(bytes) !== parentHashes[index]) {
    throw new Error('parent lineage SHA-256 confirmation mismatch');
  }
  const document = JSON.parse(bytes.toString('utf8'));
  validateNgaApplyResumeLineageV1(document, {
    phase,
    artifactManifestSha256: manifestSha256,
    preflightManifests,
  });
  parentDocuments.push(document);
  const copiedPath = `provenance/parent-lineages/${String(index + 1).padStart(4, '0')}.json`;
  copyFileSync(source, join(outRoot, copiedPath), constants.COPYFILE_EXCL);
  return {
    sequence: index + 1,
    sourceGitSha,
    sourceEvidenceRoot,
    sourcePath,
    copiedPath: relative(artifactRoot, join(outRoot, copiedPath)),
    sha256: sha256(bytes),
  };
});

const incidentPaths = values.get('incident') || [];
const incidentHashes = values.get('confirm-incident-sha256') || [];
if (incidentPaths.length !== incidentHashes.length || incidentPaths.length > 1) {
  throw new Error('at most one incident path and confirmation are allowed');
}
let incident = null;
let priorSettlementEvidence = null;
const priorStateDocuments = [];
const priorStateOutcomes = [];
if (incidentPaths.length) {
  const sourcePath = incidentPaths[0];
  const source = resolveSource(sourcePath, 'settlement incident');
  const bytes = readFileSync(source);
  if (sha256(bytes) !== incidentHashes[0]) {
    throw new Error('settlement incident SHA-256 confirmation mismatch');
  }
  incident = JSON.parse(bytes.toString('utf8'));
  if (
    incident.schemaVersion !== 'nga-vector-settlement-incident-v1' ||
    incident.gitSha !== sourceGitSha ||
    incident.boundaries?.fullBackfillStarted !== false ||
    incident.boundaries?.productionChanged !== false ||
    incident.boundaries?.cachePurged !== false
  ) {
    throw new Error('settlement incident scope is invalid');
  }
  const incidentCopiedPath = 'provenance/vector-settlement-incident.json';
  copyFileSync(
    source,
    join(outRoot, incidentCopiedPath),
    constants.COPYFILE_EXCL
  );
  mkdirSync(join(outRoot, 'provenance', 'prior-attempts'));
  const attempts = [];
  const priorSources = [
    ['immediate', incident.immediateCapture],
    ['settled-diagnostic', incident.settledDiagnostic],
  ];
  for (const [index, [kind, descriptor]] of priorSources.entries()) {
    const stateSource = resolveSource(descriptor.path, `${kind} state manifest`);
    const stateBytes = readFileSync(stateSource);
    if (sha256(stateBytes) !== descriptor.sha256) {
      throw new Error(`${kind} state manifest SHA-256 mismatch`);
    }
    const state = JSON.parse(stateBytes.toString('utf8'));
    priorStateDocuments.push(state);
    const attemptRoot = join(
      outRoot,
      'provenance',
      'prior-attempts',
      String(index + 1).padStart(4, '0')
    );
    mkdirSync(attemptRoot);
    const stateData = { ids: null, records: null, vectors: [] };
    for (const [inputKind, input] of [
      ['ids', state.inputs?.ids],
      ['records', state.inputs?.stagedRecords],
      ...(state.inputs?.imageVectors || []).map((input) => ['vector', input]),
    ]) {
      const relativeInput = String(input?.path || '');
      if (
        !relativeInput ||
        isAbsolute(relativeInput) ||
        /^[A-Za-z]:[\\/]/.test(relativeInput) ||
        relativeInput.split(/[\\/]/).includes('..') ||
        /(?:^|[\/_.-])production(?:[\/_.-]|$)/i.test(relativeInput)
      ) {
        throw new Error(`${kind} state input path is unsafe`);
      }
      const inputSource = resolveSource(
        join(dirname(descriptor.path), relativeInput),
        `${kind} state input`
      );
      const inputBytes = readFileSync(inputSource);
      if (sha256(inputBytes) !== input.sha256) {
        throw new Error(`${kind} state input SHA-256 mismatch`);
      }
      if (inputKind === 'vector') {
        stateData.vectors.push(
          ...inputBytes
            .toString('utf8')
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        );
      } else {
        stateData[inputKind] = JSON.parse(inputBytes.toString('utf8'));
      }
      const inputTarget = resolve(attemptRoot, relativeInput);
      if (!inputTarget.startsWith(`${attemptRoot}${sep}`)) {
        throw new Error(`${kind} state input escapes its copied attempt root`);
      }
      mkdirSync(dirname(inputTarget), { recursive: true });
      copyFileSync(inputSource, inputTarget, constants.COPYFILE_EXCL);
    }
    priorStateOutcomes.push(
      inspectNgaArtistPostApplyState({
        phase,
        mapping,
        originalRecords: rollbackD1Records,
        originalVectors: rollbackVectors,
        postIds: stateData.ids,
        postRecords: stateData.records,
        postVectors: stateData.vectors,
      }).outcome
    );
    copyFileSync(
      stateSource,
      join(attemptRoot, 'state-manifest.json'),
      constants.COPYFILE_EXCL
    );
    attempts.push({
      kind,
      sourcePath: descriptor.path,
      copiedPath: relative(
        artifactRoot,
        join(attemptRoot, 'state-manifest.json')
      ),
      sha256: sha256(stateBytes),
    });
  }
  priorSettlementEvidence = {
    sourceGitSha,
    sourceEvidenceRoot,
    incident: {
      sourcePath,
      copiedPath: relative(artifactRoot, join(outRoot, incidentCopiedPath)),
      sha256: sha256(bytes),
    },
    attempts,
  };
}

const responsePaths = values.get('response') || [];
const responseHashes = values.get('confirm-response-sha256') || [];
if (!responsePaths.length || responsePaths.length !== responseHashes.length) {
  throw new Error('response paths and confirmations must form a non-empty list');
}
if (responsePaths.length > manifest.orderedArtifacts.length) {
  throw new Error('response list exceeds the ordered artifact inventory');
}
const responses = responsePaths.map((sourcePath, index) => {
  const sequence = index + 1;
  const step = manifest.orderedArtifacts[index];
  const expectedName = `${String(sequence).padStart(4, '0')}.json`;
  if (!sourcePath.endsWith(`/${expectedName}`)) {
    throw new Error('responses must be a contiguous sequence from 0001');
  }
  const source = resolveSource(sourcePath, 'apply response');
  const bytes = readFileSync(source);
  if (sha256(bytes) !== responseHashes[index]) {
    throw new Error('apply response SHA-256 confirmation mismatch');
  }
  const response = JSON.parse(bytes.toString('utf8'));
  if (
    response.sequence !== sequence ||
    response.kind !== step.kind ||
    response.path !== step.path ||
    response.status !== 0 ||
    typeof response.stdout !== 'string' ||
    typeof response.stderr !== 'string'
  ) {
    throw new Error('apply response does not match the ordered artifact');
  }
  if (step.kind === 'd1-sql') {
    parseNgaD1ApplyFacts(response.stdout, {
      expectedQueryCount: step.recordCount,
      label: 'D1 apply response',
    });
  } else {
    parseNgaVectorUpsertFacts(response.stdout, {
      expectedIndex: STAGING_IMAGE_VECTOR_INDEX,
      expectedCount: step.recordCount,
    });
  }
  const copiedPath = `responses/${expectedName}`;
  copyFileSync(source, join(outRoot, copiedPath), constants.COPYFILE_EXCL);
  const parentIndex = parentDocuments.findIndex((document) =>
    document.responses?.some(
      (entry) => entry?.sequence === sequence && entry.sha256 === sha256(bytes)
    )
  );
  const incidentMatch =
    incident?.stagingMutation?.rawResponse?.path === sourcePath &&
    incident?.stagingMutation?.rawResponse?.sha256 === sha256(bytes);
  return {
    sequence,
    sourceGitSha,
    sourceEvidenceRoot,
    sourcePath,
    copiedPath: relative(artifactRoot, join(outRoot, copiedPath)),
    sha256: sha256(bytes),
    parentLineage: parentIndex < 0 ? null : parentIndex + 1,
    incident: incidentMatch ? 'vector-settlement' : null,
  };
});

if (incident) {
  const incidentResponses = responses.filter(
    (response) => response.incident === 'vector-settlement'
  );
  if (
    incidentResponses.length !== 1 ||
    manifest.orderedArtifacts[incidentResponses[0].sequence - 1]?.kind !==
      'image-vectors'
  ) {
    throw new Error(
      'settlement incident response does not match the supplied vector response provenance'
    );
  }
  const incidentResponse = incidentResponses[0];
  const responseEnvelope = JSON.parse(
    readFileSync(resolveSource(incidentResponse.sourcePath, 'incident response'))
  );
  const vectorFacts = parseNgaVectorUpsertFacts(responseEnvelope.stdout, {
    expectedIndex: STAGING_IMAGE_VECTOR_INDEX,
    expectedCount:
      manifest.orderedArtifacts[incidentResponse.sequence - 1].recordCount,
  });
  validateNgaVectorSettlementIncidentV1(incident, {
    sourceGitSha,
    expectedVectorCount:
      manifest.orderedArtifacts[incidentResponse.sequence - 1].recordCount,
    vectorResponse: {
      path: incidentResponse.sourcePath,
      sha256: incidentResponse.sha256,
      mutationId: vectorFacts.mutationId,
    },
    immediateState: priorStateDocuments[0],
    settledState: priorStateDocuments[1],
    immediateOutcome: priorStateOutcomes[0],
    settledOutcome: priorStateOutcomes[1],
  });
}

for (const parent of parentLineages) {
  if (!responses.some((response) => response.parentLineage === parent.sequence)) {
    throw new Error('parent lineage is not used by any supplied response');
  }
}

const lineage = {
  schemaVersion: 'nga-apply-resume-lineage-v2',
  phase,
  artifactManifest: {
    sourcePath: `backfill/${phase}/artifact-manifest.json`,
    sha256: manifestSha256,
  },
  preflightManifests,
  responses,
  parentLineages,
  priorSettlementEvidence,
};
const lineageText = `${JSON.stringify(lineage, null, 2)}\n`;
writeFileSync(join(outRoot, 'resume-lineage.json'), lineageText, { flag: 'wx' });
const reportedOutRoot = join(
  manifestRequestRoot,
  relative(artifactRoot, outRoot)
);
process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: lineage.schemaVersion,
      responseDirectory: join(reportedOutRoot, 'responses'),
      resumeLineage: join(reportedOutRoot, 'resume-lineage.json'),
      resumeLineageSha256: sha256(lineageText),
    },
    null,
    2
  )}\n`
);
